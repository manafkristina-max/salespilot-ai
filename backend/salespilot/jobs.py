"""Background agent runs with a live, step-by-step log.

A job takes a campaign through the whole pipeline: find companies (Wikidata,
the user's own list of websites, or the demo dataset), then for every company
research → qualify → match a product → draft an email. Up to WORKERS companies
are processed at once. Every step is written to job_events so the UI can show
what the agent is doing right now. One job runs at a time; a job can be
cancelled between steps. Nothing is ever sent: emails stay drafts for review.
"""

from __future__ import annotations

import logging
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from .db import dumps, loads, now

log = logging.getLogger("salespilot.jobs")

WORKERS = 3
MAX_COMPANIES = 25
SOURCES = {"wikidata", "domains", "demo"}


class JobCancelled(Exception):
    pass


class JobRunner:
    def __init__(self, sp):
        self.sp = sp
        self.db = sp.db
        self._lock = threading.Lock()
        self._count_lock = threading.Lock()
        # A server restart kills running threads: their jobs did not finish.
        self.db.execute("UPDATE agent_jobs SET status='interrupted', finished_at=? WHERE status IN ('queued','running')",
                        (now(),))

    # ------------------------------------------------------------ capabilities
    def capabilities(self) -> dict:
        sp, env = self.sp, self.sp.env
        live = sp.mode == "live"
        brain = sp.brain.status() if env.llm_provider == "claude_cli" else {
            "available": False, "reason": "Не включён: задайте LLM_PROVIDER=claude_cli (./start.sh --live)"}
        hint = "Запустите приложение командой ./start.sh --live"
        return {
            "mode": sp.mode,
            "public_demo": env.public_demo,
            "sources": {
                "demo": {"available": True, "reason": "14 вымышленных компаний, без сети"},
                "wikidata": {"available": live and env.live_discovery_enabled,
                             "reason": "Реальные компании из открытой базы Wikidata" if live and env.live_discovery_enabled
                             else f"Нужен рабочий режим и LIVE_DISCOVERY_ENABLED. {hint}"},
                "domains": {"available": live and env.live_research_enabled,
                            "reason": "Ваш список сайтов" if live and env.live_research_enabled
                            else f"Нужен рабочий режим и LIVE_RESEARCH_ENABLED. {hint}"},
            },
            "research": {"available": live and env.live_research_enabled,
                         "reason": "Агент читает до 4 страниц сайта каждой компании" if live and env.live_research_enabled
                         else f"Выключено. {hint}"},
            "brain": {"available": live and env.llm_provider == "claude_cli" and brain["available"],
                      "reason": brain["reason"] if live else f"В демо-режиме не используется. {hint}",
                      "provider": "Claude (подписка Claude Code)" if env.llm_provider == "claude_cli" else "правила и шаблоны"},
            "running_job": self.active_job_id(),
        }

    def active_job_id(self):
        return self.db.scalar("SELECT id FROM agent_jobs WHERE status IN ('queued','running') ORDER BY id DESC LIMIT 1")

    # ------------------------------------------------------------ API
    def start(self, campaign_id: int, params: dict, background: bool = True) -> dict:
        from .service import ServiceError
        self.sp.get_campaign(campaign_id)
        source = params.get("source", "demo")
        if source not in SOURCES:
            raise ServiceError("Неизвестный источник компаний")
        caps = self.capabilities()
        if not caps["sources"][source]["available"]:
            raise ServiceError(caps["sources"][source]["reason"], 409)
        limit = max(1, min(int(params.get("limit") or 5), MAX_COMPANIES))
        domains = [d for d in re.split(r"[\s,;]+", params.get("domains") or "") if d.strip()][:MAX_COMPANIES]
        if source == "domains" and not domains:
            raise ServiceError("Вставьте хотя бы один сайт компании")
        clean = {"source": source, "limit": limit, "domains": domains, "write": bool(params.get("write", True))}
        with self._lock:
            if self.active_job_id():
                raise ServiceError("Агент уже работает. Дождитесь завершения или остановите текущий запуск", 409)
            job_id = self.db.execute(
                "INSERT INTO agent_jobs(campaign_id, status, params_json, created_at) VALUES (?,?,?,?)",
                (campaign_id, "queued", dumps(clean), now()))
        if background and sys.platform != "emscripten":  # no threads in the in-browser build
            threading.Thread(target=self._run, args=(job_id,), name=f"agent-job-{job_id}", daemon=True).start()
        else:
            self._run(job_id)
        return self.get(job_id)

    def get(self, job_id: int, after: int = 0) -> dict:
        from .service import ServiceError
        job = self.db.one("SELECT * FROM agent_jobs WHERE id=?", (job_id,))
        if not job:
            raise ServiceError("Запуск агента не найден", 404)
        job["params"] = loads(job.pop("params_json"), {})
        job["summary"] = loads(job.pop("summary_json"), {})
        job["events"] = self.db.query("SELECT * FROM job_events WHERE job_id=? AND id>? ORDER BY id LIMIT 500",
                                      (job_id, after))
        return job

    def list(self, campaign_id: int | None = None, limit: int = 10) -> list[dict]:
        sql = "SELECT id, campaign_id, status, params_json, progress_done, progress_total, summary_json, error, " \
              "created_at, started_at, finished_at FROM agent_jobs"
        rows = self.db.query(sql + (" WHERE campaign_id=?" if campaign_id else "") + " ORDER BY id DESC LIMIT ?",
                             ((campaign_id, limit) if campaign_id else (limit,)))
        for r in rows:
            r["params"] = loads(r.pop("params_json"), {})
            r["summary"] = loads(r.pop("summary_json"), {})
        return rows

    def cancel(self, job_id: int) -> dict:
        self.db.execute("UPDATE agent_jobs SET cancel_requested=1 WHERE id=? AND status IN ('queued','running')", (job_id,))
        return self.get(job_id)

    # ------------------------------------------------------------ worker
    def _event(self, job_id: int, agent: str, message: str, company: str = "", level: str = "info"):
        self.db.execute("INSERT INTO job_events(job_id, ts, agent, level, company, message) VALUES (?,?,?,?,?,?)",
                        (job_id, now(), agent, level, company, message[:500]))
        log.info("job %s [%s] %s %s", job_id, agent, company, message)

    def _check_cancel(self, job_id: int):
        if self.db.scalar("SELECT cancel_requested FROM agent_jobs WHERE id=?", (job_id,)):
            raise JobCancelled()

    def _run(self, job_id: int):
        sp = self.sp
        job = self.get(job_id)
        p, cid = job["params"], job["campaign_id"]
        t0 = time.monotonic()
        summary = {"found": 0, "researched": 0, "qualified": 0, "disqualified": 0, "drafted": 0, "errors": 0}
        self.db.execute("UPDATE agent_jobs SET status='running', started_at=? WHERE id=?", (now(), job_id))
        try:
            leads = self._discover(job_id, cid, p, summary)
            self.db.execute("UPDATE agent_jobs SET progress_total=? WHERE id=?", (len(leads), job_id))
            if not leads:
                self._event(job_id, "scout", "Новых компаний для обработки нет", level="warn")
            brain_note = "Claude" if sp.brain_enabled and sp.brain.status()["available"] else "правила и шаблоны"
            if leads:
                self._event(job_id, "orchestrator", f"Обрабатываю {len(leads)} компаний, до {WORKERS} одновременно. "
                                                    f"Анализ и письма: {brain_note}")
            if sys.platform == "emscripten":  # in-browser build: no threads
                for lead in leads:
                    self._process(job_id, lead, p, summary)
            else:
                with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                    for _ in pool.map(lambda lead: self._process(job_id, lead, p, summary), leads):
                        pass
            self._check_cancel(job_id)
            status, error = "done", ""
            self._event(job_id, "orchestrator",
                        f"Готово за {int(time.monotonic() - t0)} с: подходят {summary['qualified']}, "
                        f"не подходят {summary['disqualified']}, черновиков {summary['drafted']}"
                        + (f", ошибок {summary['errors']}" if summary["errors"] else "")
                        + (". Письма ждут вашей проверки в разделе «Письма»" if summary["drafted"] else ""),
                        level="success")
        except JobCancelled:
            status, error = "cancelled", ""
            self._event(job_id, "orchestrator", "Остановлено пользователем", level="warn")
        except Exception as exc:
            log.exception("job %s failed", job_id)
            status, error = "error", f"{type(exc).__name__}: {exc}"
            self._event(job_id, "orchestrator", f"Ошибка: {exc}", level="error")
        self.db.execute("UPDATE agent_jobs SET status=?, error=?, summary_json=?, finished_at=? WHERE id=?",
                        (status, error, dumps(summary), now(), job_id))

    def _discover(self, job_id: int, cid: int, p: dict, summary: dict) -> list[dict]:
        from .service import ServiceError, normalize_domain
        sp = self.sp
        before = {r["company_id"] for r in sp.leads_for(cid)}
        if p["source"] == "demo":
            self._event(job_id, "scout", "Подбираю компании из демо-датасета по ICP кампании…")
            r = sp.scout(cid, "demo")
            self._event(job_id, "scout", r["message"])
        elif p["source"] == "wikidata":
            from . import live
            icp = sp.get_campaign(cid)["icp"]
            known = {r["domain"] for r in sp.db.query("SELECT domain FROM companies WHERE domain IS NOT NULL")}
            found = live.discover_wikidata(icp, p["limit"], lambda m: self._event(job_id, "scout", m),
                                           exclude_domains=known)
            for item in found:
                self._check_cancel(job_id)
                company, _ = sp.add_company(item, source="wikidata")
                if item.get("wikidata_url"):
                    sp._insert_fact(company["id"], {"kind": "info", "text": item["description"],
                                                    "source_url": item["wikidata_url"], "source_label": "Wikidata",
                                                    "evidence": ""}, verification="verified",
                                    note="Данные Wikidata на момент поиска", created_by="wikidata", checked_at=now())
                sp.attach(cid, company["id"])
                self._event(job_id, "scout", f"Найдена компания: {company['name']} ({company['domain']})"
                            + (f", {company['employees']} сотрудников" if company.get("employees") else ""),
                            company=company["name"])
        else:
            for d in p["domains"]:
                self._check_cancel(job_id)
                domain = normalize_domain(d)
                try:
                    company, created = sp.add_company({"name": domain, "website": f"https://{domain}"}, source="domain")
                except ServiceError as exc:
                    self._event(job_id, "scout", f"{d}: {exc}", level="warn")
                    continue
                sp.attach(cid, company["id"])
                self._event(job_id, "scout", f"Добавлен сайт {domain}" + ("" if created else " (уже был в базе)"),
                            company=company["name"])
        leads = [l for l in sp.leads_for(cid) if l["company_id"] not in before or p["source"] == "domains"]
        if p["source"] == "domains":
            wanted = {sp.find_duplicate("", normalize_domain(d))["id"] for d in p["domains"]
                      if sp.find_duplicate("", normalize_domain(d))}
            leads = [l for l in sp.leads_for(cid) if l["company_id"] in wanted]
        if not leads and p["source"] == "demo":
            # Every demo company is already in the campaign: walk through them again so
            # the run still shows the whole pipeline (re-scoring is idempotent; existing
            # emails are kept, not duplicated).
            leads = sp.leads_for(cid)
            if leads:
                self._event(job_id, "scout", f"Новых компаний в демо-датасете нет — заново прохожу {len(leads)} "
                                             f"уже найденных: исследование, оценка, подбор продукта")
        summary["found"] = len(leads)
        return leads

    def _bump(self, summary: dict, key: str):
        with self._count_lock:
            summary[key] += 1

    def _process(self, job_id: int, lead: dict, p: dict, summary: dict):
        sp = self.sp
        company = sp.get_company_row(lead["company_id"])
        name = company["name"]
        ev = lambda agent, msg, level="info": self._event(job_id, agent, msg, company=name, level=level)  # noqa: E731
        try:
            self._check_cancel(job_id)
            sp.research_company(company["id"], lead["campaign_id"], lead["id"], log=lambda m: ev("research", m))
            if company["is_demo"]:
                ev("research", "Демо-компания: факты из датасета, сетевых запросов нет")
            self._bump(summary, "researched")
            self._check_cancel(job_id)
            r = sp.qualify(lead["id"])
            if r["qualified"]:
                self._bump(summary, "qualified")
                ev("qualifier", f"Соответствие ICP: {r['score']}/100, уверенность {int(r['confidence'] * 100)}% — подходит",
                   level="success")
            else:
                self._bump(summary, "disqualified")
                why = "; ".join(r.get("knockouts") or []) or (
                    "мало данных" if r["confidence"] < 0.6 else "ниже порога")
                ev("qualifier", f"Соответствие ICP: {r['score']}/100 — не подходит ({why})")
            m = sp.match_product(lead["id"])
            if r["qualified"]:
                ev("sales", f"Рекомендую продукт {m['recommended_name']}: {m['rationale'][:140]}")
            self._check_cancel(job_id)
            has_email = sp.db.scalar("SELECT COUNT(*) FROM emails WHERE lead_id=? AND status<>'rejected'", (lead["id"],))
            min_draft = sp.settings.get("approval")["min_score_to_draft"]
            if p["write"] and r["qualified"] and r["score"] >= min_draft and not has_email:
                if sp.brain_enabled and sp.brain.status()["available"]:
                    ev("writer", "Claude пишет персональное письмо по фактам с источниками…")
                e = sp.write_email(lead["id"])
                self._bump(summary, "drafted")
                ev("writer", f"Черновик готов: «{e['subject']}» · утверждений с источником: {len(e['claims'])}"
                   + (f" · {e['warnings'][0]}" if e["warnings"] and "Языковая модель" in e["warnings"][0] else ""),
                   level="success")
        except JobCancelled:
            raise
        except Exception as exc:
            self._bump(summary, "errors")
            msg = str(exc)
            if "non-public destination" in msg:
                msg = ("сайт резолвится во внутренний адрес, защита от SSRF его не пропускает. Частая причина — "
                       "VPN с подменой DNS (адреса 198.18.x.x): отключите его на время работы агента")
            ev("research", f"Не удалось обработать: {msg}", level="error")
        finally:
            self.db.execute("UPDATE agent_jobs SET progress_done=progress_done+1 WHERE id=?", (job_id,))
