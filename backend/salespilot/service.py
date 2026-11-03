"""SalesPilot core: data access + the multi-agent pipeline.

Agents (each run is logged to agent_runs):
    scout          finds companies (demo dataset / CSV / manual); live search not connected
    research       collects facts with sources (demo dataset or live website fetch)
    qualifier      ICP Fit Score with explanation (scoring.py)
    sales          maps facts/pains to the best product
    writer         drafts a personalised email with traceable claims
    sender         sends ONLY approved emails; real send needs live mode + SMTP + per-email confirmation
    reply_handler  classifies replies (pasted manually until a mailbox is connected)
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from . import providers
from .config import Settings
from .db import Database, dumps, loads, now
from .harvey_adapter import do_not_contact_match, harvey_status
from .scoring import score_company
from .settings_store import SettingsStore

log = logging.getLogger("salespilot")

DEMO_FILE = Path(__file__).parent / "data" / "demo_companies.json"
AGENTS = ["scout", "research", "qualifier", "sales", "writer", "sender", "reply_handler"]
AGENT_LABELS = {"scout": "Агент поиска", "research": "Агент-исследователь", "qualifier": "Агент квалификации",
                "sales": "Агент подбора продукта", "writer": "Агент-автор писем", "sender": "Агент отправки",
                "reply_handler": "Обработчик ответов"}
STAGES = ["new", "researched", "qualified", "drafted", "approved", "sent", "replied", "meeting"]
EMAIL_RE = re.compile(r"^[^@\s<>\"',;]+@[^@\s<>\"',;]+\.[a-z0-9-]{2,}$", re.I)
EDITABLE = {"draft", "needs_review", "approved", "rejected"}


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def name_key(name: str) -> str:
    s = re.sub(r"[\"«»'`.,]", "", (name or "").lower())
    s = re.sub(r"\b(ооо|ао|пао|зао|llc|ltd|inc|gmbh)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def normalize_domain(value: str) -> str:
    v = (value or "").strip().lower()
    if not v:
        return ""
    if "://" not in v:
        v = "http://" + v
    host = (urlparse(v).hostname or "").rstrip(".")
    return host[4:] if host.startswith("www.") else host


class SalesPilot:
    def __init__(self, db: Database, env: Settings):
        self.db, self.env = db, env
        self.settings = SettingsStore(db)

    # ------------------------------------------------------------ logging

    @contextmanager
    def agent_run(self, agent: str, campaign_id=None, lead_id=None, provider: str = ""):
        started, t0 = now(), time.monotonic()
        ctx = {"message": "", "details": {}, "status": "success", "provider": provider}
        try:
            yield ctx
        except ServiceError as exc:
            ctx["status"], ctx["message"] = "error", str(exc)
            raise
        except Exception as exc:
            log.exception("agent %s failed", agent)
            ctx["status"], ctx["message"] = "error", f"{type(exc).__name__}: {exc}"
            raise
        finally:
            self.db.execute(
                "INSERT INTO agent_runs(agent, campaign_id, lead_id, status, message, details_json, provider, "
                "started_at, finished_at, duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (agent, campaign_id, lead_id, ctx["status"], ctx["message"][:1000], dumps(ctx["details"]),
                 ctx["provider"], started, now(), int((time.monotonic() - t0) * 1000)))

    @property
    def mode(self) -> str:
        if self.env.public_demo:
            return "demo"
        return self.settings.get("mode")

    def reset_demo(self, full: bool = True) -> dict:
        """Wipe all data and recreate the demo campaign. Demo mode only."""
        if self.mode != "demo":
            raise ServiceError("Сброс данных доступен только в демо-режиме", 409)
        with self.db.tx() as c:
            for table in ("campaigns", "companies", "agent_runs", "settings"):
                c.execute(f"DELETE FROM {table}")  # leads, facts, emails… cascade
            c.execute("DELETE FROM sqlite_sequence")
        from .seed import seed_demo
        return seed_demo(self, full=full)

    def is_empty(self) -> bool:
        return not self.db.scalar("SELECT COUNT(*) FROM campaigns") and \
            not self.db.scalar("SELECT COUNT(*) FROM companies")

    # ------------------------------------------------------------ campaigns

    def _campaign_row(self, row: dict) -> dict:
        row = dict(row)
        row["icp"] = loads(row.pop("icp_json"), {})
        return row

    def create_campaign(self, data: dict) -> dict:
        ts = now()
        cid = self.db.execute(
            "INSERT INTO campaigns(name, description, status, icp_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (data["name"].strip(), data.get("description", ""), "active", dumps(data.get("icp") or {}), ts, ts))
        return self.get_campaign(cid)

    def update_campaign(self, cid: int, data: dict) -> dict:
        cur = self.get_campaign(cid)
        icp = data.get("icp", cur["icp"])
        self.db.execute("UPDATE campaigns SET name=?, description=?, status=?, icp_json=?, updated_at=? WHERE id=?",
                        (data.get("name", cur["name"]), data.get("description", cur["description"]),
                         data.get("status", cur["status"]), dumps(icp), now(), cid))
        return self.get_campaign(cid)

    def get_campaign(self, cid: int) -> dict:
        row = self.db.one("SELECT * FROM campaigns WHERE id=?", (cid,))
        if not row:
            raise ServiceError("Кампания не найдена", 404)
        return self._campaign_row(row)

    def list_campaigns(self) -> list[dict]:
        rows = [self._campaign_row(r) for r in self.db.query("SELECT * FROM campaigns ORDER BY id DESC")]
        for r in rows:
            r["stats"] = self.db.one(
                "SELECT COUNT(*) AS leads, SUM(CASE WHEN json_extract(score_json,'$.qualified') THEN 1 ELSE 0 END) "
                "AS qualified, ROUND(AVG(score)) AS avg_score FROM leads WHERE campaign_id=?", (r["id"],))
        return rows

    def delete_campaign(self, cid: int) -> None:
        self.get_campaign(cid)
        self.db.execute("DELETE FROM campaigns WHERE id=?", (cid,))

    # ------------------------------------------------------------ companies

    def _company_row(self, row: dict) -> dict:
        row = dict(row)
        row["tech"] = loads(row.pop("tech_json"), [])
        row["is_demo"] = bool(row["is_demo"])
        return row

    def find_duplicate(self, name: str, domain: str) -> dict | None:
        if domain:
            row = self.db.one("SELECT * FROM companies WHERE domain=?", (domain,))
            if row:
                return row
        return self.db.one("SELECT * FROM companies WHERE name_key=?", (name_key(name),))

    def add_company(self, data: dict, source: str = "manual", is_demo: bool = False,
                    facts: list[dict] | None = None) -> tuple[dict, bool]:
        name = (data.get("name") or "").strip()
        if not name:
            raise ServiceError("Название компании обязательно")
        domain = normalize_domain(data.get("domain") or data.get("website") or "")
        if domain and "." not in domain:
            raise ServiceError(f"Некорректный домен: {domain}")
        dup = self.find_duplicate(name, domain)
        if dup:
            return self._company_row(dup), False
        website = data.get("website") or (f"https://{domain}" if domain else "")
        ts = now()
        cid = self.db.execute(
            "INSERT INTO companies(name, name_key, domain, website, industry, company_type, country, city, employees, "
            "revenue_band, sku_count, description, tech_json, is_demo, source, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (name, name_key(name), domain or None, website, data.get("industry", "").strip(),
             data.get("company_type", "").strip(), data.get("country", "").strip(), data.get("city", "").strip(),
             _int_or_none(data.get("employees")), data.get("revenue_band", "").strip(),
             _int_or_none(data.get("sku_count")), data.get("description", "").strip(),
             dumps(data.get("tech") or []), int(is_demo), source, ts, ts))
        for f in facts or []:
            self._insert_fact(cid, f, verification="demo" if is_demo else "unverified",
                              note="Демонстрационный источник: проверка по ссылке невозможна" if is_demo else "",
                              created_by="demo_dataset" if is_demo else "user")
        return self.get_company_row(cid), True

    def _insert_fact(self, company_id: int, f: dict, verification: str, note: str = "", created_by: str = "user",
                     checked_at: str | None = None) -> int:
        url = (f.get("source_url") or "").strip()
        if url and not re.match(r"^https?://", url):
            raise ServiceError("Ссылка на источник должна начинаться с http:// или https://")
        return self.db.execute(
            "INSERT INTO facts(company_id, kind, text, source_url, source_label, evidence, verification, "
            "verification_note, checked_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (company_id, f.get("kind", "info"), f["text"].strip(), url, f.get("source_label", ""),
             f.get("evidence", ""), verification, note, checked_at, created_by, now()))

    def add_fact(self, company_id: int, data: dict) -> dict:
        company = self.get_company_row(company_id)
        if not (data.get("text") or "").strip():
            raise ServiceError("Текст факта обязателен")
        if not (data.get("source_url") or "").strip():
            raise ServiceError("Укажите ссылку на источник — факты без источника не принимаются")
        fid = self._insert_fact(company_id, data, verification="demo" if company["is_demo"] else "unverified",
                                created_by="user")
        return self.db.one("SELECT * FROM facts WHERE id=?", (fid,))

    def get_company_row(self, cid: int) -> dict:
        row = self.db.one("SELECT * FROM companies WHERE id=?", (cid,))
        if not row:
            raise ServiceError("Компания не найдена", 404)
        return self._company_row(row)

    def update_company(self, cid: int, data: dict) -> dict:
        cur = self.get_company_row(cid)
        fields = ["industry", "company_type", "country", "city", "revenue_band", "description"]
        vals = {f: data.get(f, cur[f]) for f in fields}
        emp = _int_or_none(data["employees"]) if "employees" in data else cur["employees"]
        sku = _int_or_none(data["sku_count"]) if "sku_count" in data else cur["sku_count"]
        self.db.execute(
            "UPDATE companies SET industry=?, company_type=?, country=?, city=?, revenue_band=?, description=?, "
            "employees=?, sku_count=?, updated_at=? WHERE id=?",
            (*[vals[f] for f in fields], emp, sku, now(), cid))
        return self.get_company_row(cid)

    def get_company(self, cid: int) -> dict:
        c = self.get_company_row(cid)
        c["facts"] = self.db.query("SELECT * FROM facts WHERE company_id=? ORDER BY id", (cid,))
        c["contacts"] = self.db.query("SELECT * FROM contacts WHERE company_id=? ORDER BY id", (cid,))
        leads = self.db.query(
            "SELECT l.*, c.name AS campaign_name FROM leads l JOIN campaigns c ON c.id=l.campaign_id "
            "WHERE l.company_id=? ORDER BY l.id DESC", (cid,))
        for lead in leads:
            lead["score_detail"] = loads(lead.pop("score_json"), {})
            lead["match"] = loads(lead.pop("match_json"), {})
            lead["emails"] = [self._email_row(e) for e in self.db.query(
                "SELECT * FROM emails WHERE lead_id=? ORDER BY id DESC", (lead["id"],))]
            lead["meetings"] = self.db.query("SELECT * FROM meetings WHERE lead_id=?", (lead["id"],))
        c["leads"] = leads
        return c

    def list_companies(self, search: str = "", industry: str = "", country: str = "", campaign_id: int | None = None,
                       min_score: int | None = None, max_score: int | None = None, data: str = "all",
                       stage: str = "") -> list[dict]:
        where, params = [], []
        if search:
            where.append("(c.name LIKE ? OR c.domain LIKE ? OR c.description LIKE ?)")
            params += [f"%{search}%"] * 3
        if industry:
            where.append("c.industry = ?")
            params.append(industry)
        if country:
            where.append("c.country = ?")
            params.append(country)
        if data == "demo":
            where.append("c.is_demo = 1")
        elif data == "real":
            where.append("c.is_demo = 0")
        join = "LEFT JOIN leads l ON l.company_id = c.id"
        if campaign_id:
            join += " AND l.campaign_id = ?"
            params.insert(0, campaign_id)
            where.append("l.id IS NOT NULL")
        sql = (f"SELECT c.*, MAX(l.score) AS score, MAX(l.confidence) AS confidence, "
               f"GROUP_CONCAT(DISTINCT l.stage) AS stages, COUNT(DISTINCT l.id) AS lead_count, "
               f"(SELECT COUNT(*) FROM facts f WHERE f.company_id=c.id) AS fact_count "
               f"FROM companies c {join} {'WHERE ' + ' AND '.join(where) if where else ''} "
               f"GROUP BY c.id ORDER BY score IS NULL, score DESC, c.name")
        rows = [self._company_row(r) for r in self.db.query(sql, params)]
        if min_score is not None:
            rows = [r for r in rows if r["score"] is not None and r["score"] >= min_score]
        if max_score is not None:
            rows = [r for r in rows if r["score"] is not None and r["score"] <= max_score]
        if stage:
            rows = [r for r in rows if stage in (r["stages"] or "").split(",")]
        return rows

    def delete_company(self, cid: int) -> None:
        self.get_company_row(cid)
        self.db.execute("DELETE FROM companies WHERE id=?", (cid,))

    def add_contact(self, company_id: int, data: dict) -> dict:
        self.get_company_row(company_id)
        full_name = (data.get("full_name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        source = (data.get("source") or "manual").strip()
        if not full_name:
            raise ServiceError("Имя контакта обязательно")
        if email and not EMAIL_RE.match(email):
            raise ServiceError("Некорректный email")
        if not (data.get("source_note") or "").strip():
            raise ServiceError("Укажите, откуда получен контакт (источник) — система не принимает контакты без источника")
        if email and self.db.one("SELECT id FROM contacts WHERE company_id=? AND email=?", (company_id, email)):
            raise ServiceError("Такой контакт уже есть", 409)
        cid = self.db.execute(
            "INSERT INTO contacts(company_id, full_name, title, email, source, source_note, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (company_id, full_name, data.get("title", "").strip(), email, source, data["source_note"].strip(), now()))
        return self.db.one("SELECT * FROM contacts WHERE id=?", (cid,))

    def import_csv(self, text: str, campaign_id: int | None = None) -> dict:
        if campaign_id:
            self.get_campaign(campaign_id)
        reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
        if not reader.fieldnames or "name" not in [f.strip().lower() for f in reader.fieldnames]:
            raise ServiceError("CSV должен содержать заголовок с колонкой name")
        created, duplicates, errors, attached = [], [], [], 0
        for i, raw in enumerate(reader, start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
            try:
                company, is_new = self.add_company(row, source="csv")
                (created if is_new else duplicates).append(company["name"])
                if row.get("contact_name"):
                    try:
                        self.add_contact(company["id"], {
                            "full_name": row["contact_name"], "title": row.get("contact_title", ""),
                            "email": row.get("contact_email", ""), "source": "csv",
                            "source_note": row.get("contact_source") or "CSV-импорт пользователя"})
                    except ServiceError as exc:
                        if exc.status != 409:
                            errors.append(f"Строка {i}: контакт — {exc}")
                if campaign_id and self.attach(campaign_id, company["id"]):
                    attached += 1
            except ServiceError as exc:
                errors.append(f"Строка {i}: {exc}")
        return {"created": len(created), "duplicates": duplicates, "errors": errors, "attached": attached}

    # ------------------------------------------------------------ leads

    def attach(self, campaign_id: int, company_id: int) -> bool:
        if self.db.one("SELECT id FROM leads WHERE campaign_id=? AND company_id=?", (campaign_id, company_id)):
            return False
        ts = now()
        self.db.execute("INSERT INTO leads(campaign_id, company_id, stage, created_at, updated_at) VALUES (?,?,?,?,?)",
                        (campaign_id, company_id, "new", ts, ts))
        return True

    def get_lead(self, lead_id: int) -> dict:
        row = self.db.one("SELECT * FROM leads WHERE id=?", (lead_id,))
        if not row:
            raise ServiceError("Лид не найден", 404)
        row["score_detail"] = loads(row.pop("score_json"), {})
        row["match"] = loads(row.pop("match_json"), {})
        return row

    def _advance(self, lead_id: int, stage: str) -> None:
        """Move a lead forward only (never back). 'disqualified' ranks with 'qualified'."""
        cur = self.db.one("SELECT stage FROM leads WHERE id=?", (lead_id,))["stage"]
        order = {s: i for i, s in enumerate(STAGES)} | {"disqualified": STAGES.index("qualified")}
        if order.get(stage, 0) > order.get(cur, 0):
            self.db.execute("UPDATE leads SET stage=?, updated_at=? WHERE id=?", (stage, now(), lead_id))

    def leads_for(self, campaign_id: int) -> list[dict]:
        return self.db.query("SELECT * FROM leads WHERE campaign_id=? ORDER BY id", (campaign_id,))

    # ------------------------------------------------------------ agents: scout

    def demo_dataset(self) -> list[dict]:
        return json.loads(DEMO_FILE.read_text(encoding="utf-8"))["companies"]

    def scout(self, campaign_id: int, source: str = "demo", limit: int = 50) -> dict:
        campaign = self.get_campaign(campaign_id)
        icp = campaign["icp"]
        with self.agent_run("scout", campaign_id, provider=source) as run:
            if source != "demo":
                raise ServiceError("Внешний источник поиска компаний не подключён. Используйте демо-датасет, "
                                   "CSV-импорт или ручное добавление.")
            inds = {i.lower() for i in icp.get("industries") or []}
            geos = {g.lower() for g in icp.get("geographies") or []}
            types = {t.lower() for t in icp.get("company_types") or []}
            picked, skipped = [], 0
            for item in self.demo_dataset():
                hit = (not inds and not geos and not types) or item["industry"].lower() in inds \
                    or item["country"].lower() in geos or item["company_type"].lower() in types
                if not hit:
                    skipped += 1
                    continue
                facts = [{**f, "source_url": f"https://{item['domain']}{f.get('path', '/')}",
                          "source_label": "Сайт компании (демо)"} for f in item.get("facts", [])]
                company, created = self.add_company(item, source="demo_dataset", is_demo=True, facts=facts)
                new_lead = self.attach(campaign_id, company["id"])
                picked.append({"company": company["name"], "new_company": created, "new_lead": new_lead})
                if len(picked) >= limit:
                    break
            added = sum(1 for p in picked if p["new_lead"])
            run["details"] = {"matched": len(picked), "added_to_campaign": added, "skipped_by_icp": skipped}
            run["message"] = (f"Демо-датасет: подходят по ICP {len(picked)}, добавлено в кампанию {added}, "
                              f"не подошли {skipped}")
        return run["details"] | {"message": run["message"]}

    # ------------------------------------------------------------ agents: research

    def can_research_live(self, company: dict) -> tuple[bool, str]:
        if company["is_demo"]:
            return False, "демо-компания"
        if self.mode != "live":
            return False, "включён демо-режим"
        if not self.env.live_research_enabled:
            return False, "LIVE_RESEARCH_ENABLED=false в .env"
        if not company.get("website") or providers.is_reserved_domain(company.get("domain") or ""):
            return False, "нет публичного сайта"
        return True, ""

    def research_company(self, company_id: int, campaign_id=None, lead_id=None) -> dict:
        company = self.get_company_row(company_id)
        live, why = self.can_research_live(company)
        with self.agent_run("research", campaign_id, lead_id, provider="website" if live else "demo") as run:
            if company["is_demo"]:
                n = self.db.scalar("SELECT COUNT(*) FROM facts WHERE company_id=?", (company_id,))
                run["message"] = f"{company['name']}: демо-данные, {n} фактов из датасета, сетевых запросов нет"
                run["details"] = {"facts": n, "mode": "demo"}
            elif live:
                result = providers.research_website(company["website"])
                ts = now()
                added = 0
                existing = {r["text"] for r in self.db.query("SELECT text FROM facts WHERE company_id=?", (company_id,))}
                for f in result["facts"]:
                    if f["text"] in existing:
                        continue
                    self._insert_fact(company_id, {**f, "source_url": result["final_url"],
                                                   "source_label": "Главная страница сайта"},
                                      verification="verified", note="Получено с сайта при исследовании",
                                      created_by="research_agent", checked_at=ts)
                    added += 1
                tech = sorted(set(company["tech"]) | set(result["tech"]))
                self.db.execute("UPDATE companies SET tech_json=? WHERE id=?", (dumps(tech), company_id))
                run["message"] = f"{company['name']}: сайт прочитан, новых фактов {added}, стек: {', '.join(tech) or '—'}"
                run["details"] = {"facts_added": added, "tech": tech, "mode": "live"}
            else:
                run["status"] = "skipped"
                run["message"] = (f"{company['name']}: исследование сайта недоступно ({why}). "
                                  f"Используются только факты, добавленные вручную с источником.")
                run["details"] = {"mode": "skipped", "reason": why}
            self.db.execute("UPDATE companies SET researched_at=? WHERE id=?", (now(), company_id))
        if lead_id:
            self._advance(lead_id, "researched")
        return {"status": run["status"], "message": run["message"]}

    def verify_fact(self, fact_id: int) -> dict:
        fact = self.db.one("SELECT * FROM facts WHERE id=?", (fact_id,))
        if not fact:
            raise ServiceError("Факт не найден", 404)
        company = self.get_company_row(fact["company_id"])
        with self.agent_run("research", provider="verify") as run:
            if company["is_demo"]:
                status, note = "demo", "Демонстрационный источник (.test): проверка по ссылке невозможна"
            elif not fact["source_url"]:
                status, note = "not_found", "У факта нет ссылки на источник"
            else:
                ok, why = self.can_research_live(company)
                if not ok:
                    raise ServiceError(f"Проверка по ссылке недоступна: {why}")
                if not fact["evidence"]:
                    status, note = "unverified", "Нет фрагмента-доказательства для сверки — проверьте вручную"
                else:
                    status, note = providers.verify_evidence(fact["source_url"], fact["evidence"])
            self.db.execute("UPDATE facts SET verification=?, verification_note=?, checked_at=? WHERE id=?",
                            (status, note, now(), fact_id))
            run["message"] = f"Факт #{fact_id}: {status} — {note}"
        return self.db.one("SELECT * FROM facts WHERE id=?", (fact_id,))

    def mark_fact(self, fact_id: int, verification: str) -> dict:
        if verification not in ("verified", "unverified", "not_found"):
            raise ServiceError("Недопустимый статус проверки")
        fact = self.db.one("SELECT * FROM facts WHERE id=?", (fact_id,))
        if not fact:
            raise ServiceError("Факт не найден", 404)
        if self.get_company_row(fact["company_id"])["is_demo"]:
            raise ServiceError("Демо-факты нельзя отметить как проверенные")
        self.db.execute("UPDATE facts SET verification=?, verification_note=?, checked_at=? WHERE id=?",
                        (verification, "Отмечено пользователем вручную", now(), fact_id))
        return self.db.one("SELECT * FROM facts WHERE id=?", (fact_id,))

    # ------------------------------------------------------------ agents: qualifier / sales

    def qualify(self, lead_id: int) -> dict:
        lead = self.get_lead(lead_id)
        campaign = self.get_campaign(lead["campaign_id"])
        company = self.get_company_row(lead["company_id"])
        facts = self.db.query("SELECT * FROM facts WHERE company_id=? AND verification<>'not_found'", (company["id"],))
        contacts = self.db.query("SELECT * FROM contacts WHERE company_id=?", (company["id"],))
        threshold = int(self.settings.get("qualify_threshold"))
        with self.agent_run("qualifier", campaign["id"], lead_id, provider="rules") as run:
            result = score_company(company, facts, contacts, campaign["icp"], self.settings.get("scoring_weights"),
                                   self.settings.get("compatible_tech"), self.settings.get("products"),
                                   self.settings.get("do_not_contact"), threshold)
            result["threshold"], result["scored_at"] = threshold, now()
            stage = "qualified" if result["qualified"] else "disqualified"
            cur = self.db.one("SELECT stage FROM leads WHERE id=?", (lead_id,))["stage"]
            new_stage = cur if cur in STAGES[3:] else stage
            self.db.execute("UPDATE leads SET score=?, confidence=?, score_json=?, stage=?, updated_at=? WHERE id=?",
                            (result["score"], result["confidence"], dumps(result), new_stage, now(), lead_id))
            run["message"] = f"{company['name']}: {result['score']}/100, уверенность {int(result['confidence'] * 100)}%"
            run["details"] = {"score": result["score"], "qualified": result["qualified"]}
        return result

    def match_product(self, lead_id: int) -> dict:
        lead = self.get_lead(lead_id)
        campaign = self.get_campaign(lead["campaign_id"])
        company = self.get_company_row(lead["company_id"])
        facts = self.db.query("SELECT * FROM facts WHERE company_id=? AND verification<>'not_found'", (company["id"],))
        products = self.settings.get("products")
        with self.agent_run("sales", campaign["id"], lead_id, provider="rules") as run:
            ranking = []
            for p in products:
                kws = [k.lower() for k in p.get("keywords") or []]
                matched = []
                for f in facts:
                    low = f["text"].lower()
                    # Only the product's own keywords count: ICP pains apply to every
                    # product and would make the ranking a tie.
                    hits = [k for k in kws if k and k in low]
                    if hits:
                        matched.append({"fact_id": f["id"], "text": f["text"], "keywords": sorted(set(hits))})
                weight = sum(2 if f["kind"] == "pain" else 1 for f in facts if f["id"] in {m["fact_id"] for m in matched})
                ranking.append({"product_id": p["id"], "product": p["name"], "strength": weight, "matched": matched})
            ranking.sort(key=lambda r: r["strength"], reverse=True)
            fixed = campaign["icp"].get("product")
            if fixed and fixed != "auto":
                chosen = next((r for r in ranking if r["product_id"] == fixed), ranking[0])
                reason = "продукт задан в кампании"
            else:
                chosen = ranking[0] if ranking else None
                reason = "наибольшее число совпадений с фактами"
            if not chosen or chosen["strength"] == 0:
                rationale = "Явных болей, связанных с продуктами, не найдено — нужен дополнительный ресёрч."
            else:
                rationale = "; ".join(m["text"] for m in chosen["matched"][:2])
            result = {"recommended": chosen["product_id"] if chosen else None,
                      "recommended_name": chosen["product"] if chosen else None,
                      "reason": reason, "rationale": rationale, "ranking": ranking}
            self.db.execute("UPDATE leads SET match_json=?, updated_at=? WHERE id=?", (dumps(result), now(), lead_id))
            run["message"] = f"{company['name']}: {result['recommended_name']} ({reason})"
        return result

    # ------------------------------------------------------------ agents: writer

    def write_email(self, lead_id: int, contact_id: int | None = None, force: bool = False) -> dict:
        lead = self.get_lead(lead_id)
        company = self.get_company_row(lead["company_id"])
        approval = self.settings.get("approval")
        if lead["score"] is None:
            raise ServiceError("Сначала рассчитайте ICP Fit Score")
        if not force and lead["score"] < approval["min_score_to_draft"]:
            raise ServiceError(f"Score {lead['score']} ниже порога черновика ({approval['min_score_to_draft']})")
        match = lead["match"] or self.match_product(lead_id)
        products = {p["id"]: p for p in self.settings.get("products")}
        product = products.get(match.get("recommended")) or next(iter(products.values()))
        matched_ids = [m["fact_id"] for r in match.get("ranking", []) if r["product_id"] == product["id"]
                       for m in r["matched"]]
        facts = self.db.query("SELECT * FROM facts WHERE company_id=? AND verification<>'not_found' ORDER BY id",
                              (company["id"],))
        facts.sort(key=lambda f: (f["id"] not in matched_ids, f["kind"] != "pain", f["id"]))
        contacts = self.db.query("SELECT * FROM contacts WHERE company_id=? ORDER BY id", (company["id"],))
        contact = next((c for c in contacts if c["id"] == contact_id), None) if contact_id else \
            next((c for c in contacts if c["email"]), None)
        sender = self.settings.get("sender")
        brief = {"company": company, "product": product, "facts": facts, "contact": contact,
                 "rationale": "", "signature": sender.get("signature", "")}
        llm = providers.get_llm(self.env, self.mode)
        warnings = []
        with self.agent_run("writer", lead["campaign_id"], lead_id, provider=llm.name) as run:
            try:
                out = llm.write_email(brief)
            except Exception as exc:
                if not llm.is_live:
                    raise
                warnings.append(f"Внешняя языковая модель недоступна ({type(exc).__name__}), письмо написано по шаблону")
                out = providers.MockLLM().write_email(brief)
            by_id = {f["id"]: f for f in facts}
            claims = [{"n": i + 1, "fact_id": fid, "text": by_id[fid]["text"], "source_url": by_id[fid]["source_url"],
                       "verification": by_id[fid]["verification"]} for i, fid in enumerate(out["used_fact_ids"])
                      if fid in by_id]
            if not contact:
                warnings.append("Нет контакта с email — укажите получателя перед отправкой (контакты не генерируются)")
            if company["is_demo"]:
                warnings.append("Демо-компания: письмо можно только симулировать, реальная отправка невозможна")
            if any(c["verification"] == "unverified" for c in claims):
                warnings.append("Есть непроверенные утверждения — проверьте источники перед одобрением")
            if not claims:
                warnings.append("Письмо не содержит фактов о компании — персонализация слабая")
            ts = now()
            eid = self.db.execute(
                "INSERT INTO emails(lead_id, contact_id, to_email, subject, body, status, claims_json, warnings_json, "
                "provider, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (lead_id, contact["id"] if contact else None, contact["email"] if contact else "", out["subject"],
                 out["body"], "draft", dumps(claims), dumps(warnings), out["provider"], ts, ts))
            self._version(eid, "created", "writer_agent", note="по шаблону" if out["provider"] == "mock" else f"модель: {out['provider']}")
            run["message"] = f"{company['name']}: черновик #{eid} ({product['name']}), утверждений с источником: {len(claims)}"
            run["provider"] = out["provider"]
        self._advance(lead_id, "drafted")
        return self.get_email(eid)

    # ------------------------------------------------------------ pipeline

    def run_pipeline(self, campaign_id: int, write: bool = True) -> dict:
        self.get_campaign(campaign_id)
        min_draft = self.settings.get("approval")["min_score_to_draft"]
        summary = {"researched": 0, "qualified": 0, "disqualified": 0, "drafted": 0, "errors": []}
        for lead in self.leads_for(campaign_id):
            try:
                self.research_company(lead["company_id"], campaign_id, lead["id"])
                summary["researched"] += 1
                result = self.qualify(lead["id"])
                summary["qualified" if result["qualified"] else "disqualified"] += 1
                self.match_product(lead["id"])
                has_email = self.db.scalar("SELECT COUNT(*) FROM emails WHERE lead_id=? AND status<>'rejected'",
                                           (lead["id"],))
                if write and result["qualified"] and result["score"] >= min_draft and not has_email:
                    self.write_email(lead["id"])
                    summary["drafted"] += 1
            except Exception as exc:
                summary["errors"].append(f"lead {lead['id']}: {exc}")
        return summary

    # ------------------------------------------------------------ emails

    def _email_row(self, row: dict) -> dict:
        row = dict(row)
        row["claims"] = loads(row.pop("claims_json"), [])
        row["warnings"] = loads(row.pop("warnings_json"), [])
        return row

    def get_email(self, eid: int) -> dict:
        row = self.db.one(
            "SELECT e.*, l.campaign_id, l.company_id, c.name AS company_name, c.is_demo, cp.name AS campaign_name, "
            "ct.full_name AS contact_name FROM emails e JOIN leads l ON l.id=e.lead_id "
            "JOIN companies c ON c.id=l.company_id JOIN campaigns cp ON cp.id=l.campaign_id "
            "LEFT JOIN contacts ct ON ct.id=e.contact_id WHERE e.id=?", (eid,))
        if not row:
            raise ServiceError("Письмо не найдено", 404)
        email = self._email_row(row)
        email["is_demo"] = bool(email["is_demo"])
        email["versions"] = self.db.query("SELECT * FROM email_versions WHERE email_id=? ORDER BY version DESC", (eid,))
        email["replies"] = self.db.query("SELECT * FROM replies WHERE email_id=? ORDER BY id", (eid,))
        return email

    def list_emails(self, status: str = "", campaign_id: int | None = None) -> list[dict]:
        where, params = [], []
        if status:
            where.append("e.status=?")
            params.append(status)
        if campaign_id:
            where.append("l.campaign_id=?")
            params.append(campaign_id)
        rows = self.db.query(
            "SELECT e.*, c.name AS company_name, c.is_demo, cp.name AS campaign_name, l.score, l.company_id, "
            "(SELECT COUNT(*) FROM replies r WHERE r.email_id=e.id) AS reply_count "
            "FROM emails e JOIN leads l ON l.id=e.lead_id JOIN companies c ON c.id=l.company_id "
            "JOIN campaigns cp ON cp.id=l.campaign_id "
            f"{'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY e.updated_at DESC, e.id DESC", params)
        out = []
        for r in rows:
            r = self._email_row(r)
            r["is_demo"] = bool(r["is_demo"])
            out.append(r)
        return out

    def _version(self, eid: int, action: str, author: str, note: str = "") -> None:
        e = self.db.one("SELECT subject, body, status FROM emails WHERE id=?", (eid,))
        v = (self.db.scalar("SELECT MAX(version) FROM email_versions WHERE email_id=?", (eid,)) or 0) + 1
        self.db.execute("INSERT INTO email_versions(email_id, version, subject, body, status, action, author, note, "
                        "created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                        (eid, v, e["subject"], e["body"], e["status"], action, author, note, now()))

    def update_email(self, eid: int, data: dict) -> dict:
        email = self.get_email(eid)
        if email["status"] not in EDITABLE:
            raise ServiceError("Отправленное письмо нельзя редактировать", 409)
        subject = (data.get("subject", email["subject"]) or "").strip()
        body = (data.get("body", email["body"]) or "").strip()
        if not subject or not body:
            raise ServiceError("Тема и текст письма обязательны")
        if "\n" in subject or "\r" in subject:
            raise ServiceError("Тема не может содержать перенос строки")
        contact_id, to_email = email["contact_id"], email["to_email"]
        if "contact_id" in data:
            if data["contact_id"] is None:
                contact_id, to_email = None, ""
            else:
                c = self.db.one("SELECT * FROM contacts WHERE id=? AND company_id=?",
                                (data["contact_id"], email["company_id"]))
                if not c:
                    raise ServiceError("Контакт не принадлежит этой компании")
                contact_id, to_email = c["id"], c["email"]
        changed = subject != email["subject"] or body != email["body"] or contact_id != email["contact_id"]
        if not changed:
            return email
        status = email["status"]
        note = ""
        if status == "approved":
            status, note = "needs_review", "Одобрение снято: письмо изменено после одобрения"
        elif status == "rejected":
            status = "draft"
        self.db.execute("UPDATE emails SET subject=?, body=?, contact_id=?, to_email=?, status=?, approved_at=NULL, "
                        "updated_at=? WHERE id=?", (subject, body, contact_id, to_email, status, now(), eid))
        self._version(eid, "edited", "user", note)
        return self.get_email(eid)

    def set_email_status(self, eid: int, action: str, reason: str = "") -> dict:
        email = self.get_email(eid)
        transitions = {
            "submit": ({"draft"}, "needs_review"),
            "approve": ({"draft", "needs_review"}, "approved"),
            "reject": ({"draft", "needs_review", "approved"}, "rejected"),
            "reopen": ({"rejected"}, "draft"),
        }
        allowed, target = transitions[action]
        if email["status"] not in allowed:
            raise ServiceError(f"Действие «{action}» недоступно для статуса {email['status']}", 409)
        self.db.execute("UPDATE emails SET status=?, approved_at=?, rejected_reason=?, updated_at=? WHERE id=?",
                        (target, now() if target == "approved" else None,
                         reason if target == "rejected" else "", now(), eid))
        self._version(eid, action, "user", reason)
        if target == "approved":
            self._advance(email["lead_id"], "approved")
        return self.get_email(eid)

    def send_readiness(self, email: dict) -> dict:
        """What would happen on send, and why. Used by UI and by send()."""
        approval = self.settings.get("approval")
        blockers, live_blockers = [], []
        if email["status"] != "approved":
            blockers.append("Письмо не одобрено")
        if approval["sending_paused"]:
            blockers.append("Отправка приостановлена в настройках")
        sent_today = self.db.scalar("SELECT COUNT(*) FROM emails WHERE status='sent' AND sent_at >= ?",
                                    (datetime.now(timezone.utc).date().isoformat(),))
        if sent_today >= int(approval["daily_send_limit"]):
            blockers.append(f"Достигнут дневной лимит отправок ({approval['daily_send_limit']})")
        if self.mode != "live":
            live_blockers.append("включён демо-режим")
        if email["is_demo"]:
            live_blockers.append("демо-компания")
        if not self.env.live_sending_enabled:
            live_blockers.append("реальная отправка выключена (LIVE_SENDING_ENABLED=false)")
        if not self.env.smtp_configured:
            live_blockers.append("почта (SMTP) не настроена")
        if not email["to_email"]:
            live_blockers.append("не указан получатель")
        elif providers.is_reserved_domain(email["to_email"].rpartition("@")[2]):
            live_blockers.append("адрес на зарезервированном домене")
        if email["to_email"] and do_not_contact_match(email["to_email"], self.settings.get("do_not_contact")):
            blockers.append("Получатель в списке do-not-contact")
        return {"can_send": not blockers, "will_be_live": not blockers and not live_blockers,
                "blockers": blockers, "live_blockers": live_blockers}

    def send_email(self, eid: int, confirm: bool) -> dict:
        email = self.get_email(eid)
        ready = self.send_readiness(email)
        with self.agent_run("sender", email["campaign_id"], email["lead_id"],
                            provider="smtp" if ready["will_be_live"] else "simulated") as run:
            if not ready["can_send"]:
                raise ServiceError("Отправка невозможна: " + "; ".join(ready["blockers"]), 409)
            if self.settings.get("approval")["require_send_confirmation"] and not confirm:
                raise ServiceError("Требуется явное подтверждение отправки этого письма", 409)
            if ready["will_be_live"]:
                provider = providers.SMTPEmail(self.env)
                mode = "live"
            else:
                provider = providers.SimulatedEmail()
                mode = "simulated"
            message_id = provider.send(email["to_email"] or "(получатель не указан)", email["subject"], email["body"])
            self.db.execute("UPDATE emails SET status='sent', send_mode=?, sent_at=?, message_id=?, updated_at=? "
                            "WHERE id=?", (mode, now(), message_id, now(), eid))
            self._version(eid, "sent", "user", "реальная отправка" if mode == "live" else "симуляция, ничего не отправлено")
            run["message"] = (f"Письмо #{eid} отправлено через SMTP" if mode == "live" else
                              f"Письмо #{eid}: симуляция отправки (ничего не отправлено). Причина: "
                              + ", ".join(ready["live_blockers"]))
        self._advance(email["lead_id"], "sent")
        return self.get_email(eid)

    # ------------------------------------------------------------ replies / meetings

    REPLY_RULES = [
        ("unsubscribe", ["отпиш", "не пишите", "unsubscribe", "удалите меня", "больше не присылайте"]),
        ("out_of_office", ["в отпуске", "out of office", "автоответ", "вернусь"]),
        ("interested", ["интересно", "давайте", "созвон", "встреч", "подробнее", "пришлите", "interested", "демо"]),
        ("objection", ["дорого", "уже использ", "нет бюджета", "не сейчас", "позже", "есть решение"]),
        ("not_interested", ["не интерес", "нет, спасибо", "не актуально", "not interested"]),
    ]

    def classify_reply(self, body: str) -> tuple[str, float, str]:
        low = (body or "").lower()
        scores = []
        for label, kws in self.REPLY_RULES:
            hits = [k for k in kws if k in low]
            if hits:
                scores.append((len(hits), label, hits))
        if not scores:
            return "other", 0.3, "Ключевые признаки не найдены — нужна ручная разметка"
        # Priority order of REPLY_RULES wins on ties (opt-out first).
        scores.sort(key=lambda s: (-s[0], [r[0] for r in self.REPLY_RULES].index(s[1])))
        if any(s[1] == "unsubscribe" for s in scores):
            best = next(s for s in scores if s[1] == "unsubscribe")
        elif any(s[1] == "not_interested" for s in scores):
            best = next(s for s in scores if s[1] == "not_interested")
        else:
            best = scores[0]
        conf = min(0.95, 0.55 + 0.15 * best[0])
        return best[1], round(conf, 2), "Признаки: " + ", ".join(best[2])

    def add_reply(self, eid: int, body: str) -> dict:
        email = self.get_email(eid)
        if email["status"] != "sent":
            raise ServiceError("Ответ можно добавить только к отправленному письму", 409)
        if not (body or "").strip():
            raise ServiceError("Текст ответа пуст")
        with self.agent_run("reply_handler", email["campaign_id"], email["lead_id"], provider="rules") as run:
            label, conf, why = self.classify_reply(body)
            self.db.execute("INSERT INTO replies(email_id, body, classification, confidence, rationale, source, "
                            "received_at) VALUES (?,?,?,?,?,?,?)",
                            (eid, body.strip(), label, conf, why, "manual", now()))
            if label == "unsubscribe" and email["to_email"]:
                dnc = self.settings.get("do_not_contact")
                if email["to_email"] not in dnc:
                    self.settings.set("do_not_contact", dnc + [email["to_email"]])
            run["message"] = f"Ответ на письмо #{eid}: {label} ({int(conf * 100)}%), источник — ручной ввод"
        self._advance(email["lead_id"], "replied")
        return self.get_email(eid)

    def add_meeting(self, lead_id: int, scheduled_for: str, note: str) -> dict:
        self.get_lead(lead_id)
        mid = self.db.execute("INSERT INTO meetings(lead_id, scheduled_for, note, source, created_at) VALUES (?,?,?,?,?)",
                              (lead_id, scheduled_for or "", note or "", "manual", now()))
        self._advance(lead_id, "meeting")
        return self.db.one("SELECT * FROM meetings WHERE id=?", (mid,))

    # ------------------------------------------------------------ analytics

    def _lead_facts(self, campaign_id: int | None = None) -> list[dict]:
        params = []
        sql = ("SELECT l.id, l.campaign_id, l.stage, l.score, l.confidence, "
               "json_extract(l.score_json,'$.qualified') AS qualified, c.is_demo, c.researched_at, "
               "(SELECT COUNT(*) FROM emails e WHERE e.lead_id=l.id) AS emails, "
               "(SELECT COUNT(*) FROM emails e WHERE e.lead_id=l.id AND e.status IN ('draft','needs_review')) AS drafts, "
               "(SELECT COUNT(*) FROM emails e WHERE e.lead_id=l.id AND e.status IN ('approved','sent')) AS approved, "
               "(SELECT COUNT(*) FROM emails e WHERE e.lead_id=l.id AND e.status='sent' AND e.send_mode='live') AS sent_live, "
               "(SELECT COUNT(*) FROM emails e WHERE e.lead_id=l.id AND e.status='sent' AND e.send_mode='simulated') AS sent_sim, "
               "(SELECT COUNT(*) FROM replies r JOIN emails e ON e.id=r.email_id WHERE e.lead_id=l.id AND e.send_mode='live') AS replies_live, "
               "(SELECT COUNT(*) FROM replies r JOIN emails e ON e.id=r.email_id WHERE e.lead_id=l.id AND e.send_mode='simulated') AS replies_sim, "
               "(SELECT COUNT(*) FROM meetings m WHERE m.lead_id=l.id) AS meetings "
               "FROM leads l JOIN companies c ON c.id=l.company_id")
        if campaign_id:
            sql += " WHERE l.campaign_id=?"
            params.append(campaign_id)
        return self.db.query(sql, params)

    def analytics(self, campaign_id: int | None = None, scope: str = "all") -> dict:
        rows = self._lead_facts(campaign_id)
        if scope == "real":
            rows = [r for r in rows if not r["is_demo"]]
        elif scope == "demo":
            rows = [r for r in rows if r["is_demo"]]
        real_only = scope == "real"

        def sent(r):
            return r["sent_live"] if real_only else r["sent_live"] + r["sent_sim"]

        def replied(r):
            return r["replies_live"] if real_only else r["replies_live"] + r["replies_sim"]

        stages = [
            ("leads", "Лиды", lambda r: True),
            ("researched", "Исследованы", lambda r: bool(r["researched_at"])),
            ("qualified", "Квалифицированы", lambda r: bool(r["qualified"])),
            ("drafted", "Есть черновик", lambda r: r["emails"] > 0),
            ("approved", "Одобрено", lambda r: r["approved"] > 0),
            ("sent", "Отправлено" + (" (реально)" if real_only else ""), lambda r: sent(r) > 0),
            ("replied", "Ответили", lambda r: replied(r) > 0),
            ("meeting", "Встречи", lambda r: r["meetings"] > 0),
        ]
        funnel, prev = [], None
        for key, label, pred in stages:
            n = sum(1 for r in rows if pred(r))
            funnel.append({"key": key, "label": label, "count": n,
                           "conversion": None if prev in (None, 0) else round(n / prev * 100, 1)})
            prev = n
        buckets = [(0, 19), (20, 39), (40, 59), (60, 79), (80, 100)]
        dist = [{"range": f"{a}–{b}", "count": sum(1 for r in rows if r["score"] is not None and a <= r["score"] <= b)}
                for a, b in buckets]
        unscored = sum(1 for r in rows if r["score"] is None)
        camps = []
        for c in self.db.query("SELECT id, name FROM campaigns ORDER BY id DESC"):
            if campaign_id and c["id"] != campaign_id:
                continue
            cr = [r for r in rows if r["campaign_id"] == c["id"]]
            scores = [r["score"] for r in cr if r["score"] is not None]
            camps.append({"id": c["id"], "name": c["name"], "leads": len(cr),
                          "qualified": sum(1 for r in cr if r["qualified"]),
                          "avg_score": round(sum(scores) / len(scores)) if scores else None,
                          "drafts": sum(r["drafts"] for r in cr), "approved": sum(1 for r in cr if r["approved"]),
                          "sent_live": sum(r["sent_live"] for r in cr), "sent_simulated": sum(r["sent_sim"] for r in cr),
                          "replies_live": sum(r["replies_live"] for r in cr),
                          "replies_simulated": sum(r["replies_sim"] for r in cr),
                          "meetings": sum(r["meetings"] for r in cr)})
        return {"scope": scope, "funnel": funnel, "score_distribution": dist, "unscored": unscored,
                "campaigns": camps, "demo_leads": sum(1 for r in rows if r["is_demo"]),
                "real_leads": sum(1 for r in rows if not r["is_demo"])}

    def dashboard(self) -> dict:
        rows = self._lead_facts()
        companies = self.db.one("SELECT COUNT(*) AS total, SUM(is_demo) AS demo FROM companies")

        def split(fn):
            return {"real": sum(fn(r) for r in rows if not r["is_demo"]), "demo": sum(fn(r) for r in rows if r["is_demo"])}

        emails = self.db.one("SELECT SUM(status IN ('draft','needs_review')) AS drafts, SUM(status='needs_review') "
                             "AS review, SUM(status='approved') AS approved FROM emails")
        agents = []
        for a in AGENTS:
            last = self.db.one("SELECT * FROM agent_runs WHERE agent=? ORDER BY id DESC LIMIT 1", (a,))
            total = self.db.scalar("SELECT COUNT(*) FROM agent_runs WHERE agent=?", (a,))
            errors = self.db.scalar("SELECT COUNT(*) FROM agent_runs WHERE agent=? AND status='error'", (a,))
            agents.append({"agent": a, "label": AGENT_LABELS[a], "runs": total, "errors": errors,
                           "last": last, "provider": self._agent_provider(a)})
        return {
            "mode": self.mode,
            "companies": {"total": companies["total"] or 0, "demo": companies["demo"] or 0,
                          "real": (companies["total"] or 0) - (companies["demo"] or 0)},
            "qualified": split(lambda r: 1 if r["qualified"] else 0),
            "drafts": emails["drafts"] or 0, "needs_review": emails["review"] or 0,
            "approved": emails["approved"] or 0,
            "sent": {"live": sum(r["sent_live"] for r in rows), "simulated": sum(r["sent_sim"] for r in rows)},
            "replies": {"live": sum(r["replies_live"] for r in rows), "simulated": sum(r["replies_sim"] for r in rows)},
            "meetings": split(lambda r: r["meetings"]),
            "agents": agents,
            "funnel": self.analytics()["funnel"],
            "recent_runs": self.db.query("SELECT * FROM agent_runs ORDER BY id DESC LIMIT 8"),
        }

    def _agent_provider(self, agent: str) -> str:
        live = self.mode == "live"
        if agent == "scout":
            return "Демо-датасет · CSV · вручную"
        if agent == "research":
            return "Сайты компаний" if live and self.env.live_research_enabled else "Демо-факты · ручной ввод"
        if agent in ("qualifier", "sales"):
            return "Правила (детерминированно)"
        if agent == "writer":
            return "Anthropic API" if live and self.env.llm_provider == "anthropic" and self.env.anthropic_configured \
                else "Шаблоны писем"
        if agent == "sender":
            return "Почта (SMTP)" if live and self.env.live_sending_enabled and self.env.smtp_configured \
                else "Симуляция"
        return "Ручной ввод ответов (почта не подключена)"

    def integrations(self) -> list[dict]:
        e, live = self.env, self.mode == "live"
        hs = harvey_status()
        return [
            {"id": "harvey", "name": "Harvey — открытый агент, на котором основан продукт", "status": "connected" if hs["available"] else "error",
             "detail": "Переиспользуются модули: " + ", ".join(hs["reused"]) if hs["available"] else hs["error"]},
            {"id": "llm", "name": "Языковая модель (LLM)",
             "status": "connected" if e.llm_provider == "anthropic" and e.anthropic_configured else "mock",
             "detail": ("Anthropic API настроен" + ("" if live else " (работает только в рабочем режиме)"))
             if e.llm_provider == "anthropic" and e.anthropic_configured
             else "Письма пишутся по шаблонам. Чтобы подключить модель: LLM_PROVIDER=anthropic и ANTHROPIC_API_KEY в .env (платно)"},
            {"id": "research", "name": "Исследование сайтов",
             "status": "connected" if e.live_research_enabled else "disabled",
             "detail": "Загрузка публичных страниц через SSRF-защищённый клиент Harvey"
             + ("" if e.live_research_enabled else ". Выключено: LIVE_RESEARCH_ENABLED=false")},
            {"id": "smtp", "name": "Почта (SMTP)", "status": "connected" if e.smtp_configured else "not_configured",
             "detail": ("SMTP настроен" if e.smtp_configured else "Не настроен: SMTP_HOST/USER/PASSWORD/FROM")
             + ("; реальная отправка разрешена" if e.live_sending_enabled else "; LIVE_SENDING_ENABLED=false")},
            {"id": "inbox", "name": "Входящие (IMAP/Gmail)", "status": "not_configured",
             "detail": "Не реализовано в MVP: ответы добавляются вручную и классифицируются Reply Handler"},
            {"id": "discovery", "name": "Источник поиска компаний", "status": "not_configured",
             "detail": "Внешний поиск не подключён. Доступно: демо-датасет, CSV, ручное добавление"},
        ]

    # ------------------------------------------------------------ export

    def export_companies_csv(self, **filters) -> str:
        rows = self.list_companies(**filters)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "name", "domain", "industry", "company_type", "country", "city", "employees", "sku_count",
                    "best_score", "confidence", "stages", "facts", "data_type"])
        for r in rows:
            w.writerow([r["id"], r["name"], r["domain"] or "", r["industry"], r["company_type"], r["country"],
                        r["city"], r["employees"] or "", r["sku_count"] or "", r["score"] if r["score"] is not None else "",
                        r["confidence"] if r["confidence"] is not None else "", r["stages"] or "", r["fact_count"],
                        "demo" if r["is_demo"] else "real"])
        return buf.getvalue()

    def export_emails_csv(self, **filters) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "campaign", "company", "to", "subject", "status", "send_mode", "sent_at", "replies",
                    "data_type"])
        for e in self.list_emails(**filters):
            w.writerow([e["id"], e["campaign_name"], e["company_name"], e["to_email"], e["subject"], e["status"],
                        e["send_mode"] or "", e["sent_at"] or "", e["reply_count"], "demo" if e["is_demo"] else "real"])
        return buf.getvalue()

    def export_analytics_csv(self, campaign_id=None, scope="all") -> str:
        a = self.analytics(campaign_id, scope)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["section", "key", "label", "count", "conversion_pct"])
        for f in a["funnel"]:
            w.writerow(["funnel", f["key"], f["label"], f["count"], f["conversion"] if f["conversion"] is not None else ""])
        for d in a["score_distribution"]:
            w.writerow(["score_distribution", d["range"], d["range"], d["count"], ""])
        return buf.getvalue()

    def agent_runs(self, agent: str = "", limit: int = 200) -> list[dict]:
        if agent:
            rows = self.db.query("SELECT * FROM agent_runs WHERE agent=? ORDER BY id DESC LIMIT ?", (agent, limit))
        else:
            rows = self.db.query("SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?", (limit,))
        for r in rows:
            r["details"] = loads(r.pop("details_json"), {})
        return rows


def _int_or_none(v):
    if v in (None, ""):
        return None
    try:
        return int(str(v).replace(" ", "").replace(" ", ""))
    except ValueError:
        raise ServiceError(f"Ожидалось число, получено: {v}")
