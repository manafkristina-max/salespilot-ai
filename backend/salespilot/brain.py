"""The agent's brain: Claude through the operator's own Claude Code subscription.

Reuses Harvey's isolated CLI runtime (vendor/harvey/harvey/claude_runtime.py):
every call runs `claude -p --safe-mode` with no tools, no MCP, none of the
operator's CLAUDE.md/settings, in an empty temp dir, prompt on stdin. Website
text reaches the model fenced as untrusted data (Harvey's untrusted.fence).

The model never gets the last word on facts: every fact must quote the page it
came from, and quotes that are not literally on that page are dropped.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import sys
import threading
from pathlib import Path

from .harvey_adapter import UNTRUSTED_RULE, fence

log = logging.getLogger("salespilot.brain")

_VENDOR = Path(__file__).resolve().parents[2] / "vendor" / "harvey"
if _VENDOR.exists() and str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))
try:
    from harvey import claude_runtime
except Exception as exc:  # pragma: no cover - only without vendor/
    claude_runtime = None
    _IMPORT_ERROR = str(exc)
else:
    _IMPORT_ERROR = ""

FACT_KINDS = {"pain", "signal", "info"}
COMPANY_TYPES = ["Бренд-производитель", "Дистрибьютор", "Ритейлер", "Маркетплейс-селлер", "Другое"]
_AUTH_HINTS = ("authenticate", "oauth", "login", "not logged in", "api key", "unauthorized", "401")
_LIMIT_HINTS = ("usage limit", "rate limit", "limit reached", "quota", "overloaded")


class BrainUnavailable(Exception):
    """Claude can't be used right now; the message says why, in Russian."""


class ClaudeBrain:
    name = "claude"

    def __init__(self, model: str = "", timeout: float = 180.0):
        self.model = model
        self.timeout = timeout
        self._status: dict | None = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------ status
    def status(self, refresh: bool = False) -> dict:
        """{'available': bool, 'reason': str}. Cheap: only checks the CLI binary
        and flags; a login problem shows up on the first real call."""
        if self._status is not None and not refresh:
            return self._status
        if claude_runtime is None:
            st = {"available": False, "reason": f"Модуль Harvey недоступен: {_IMPORT_ERROR}"}
        else:
            try:
                claude_runtime.check_cli()
                st = {"available": True, "reason": "Claude Code найден, вызовы изолированы (safe-mode, без инструментов)"}
            except Exception as exc:
                st = {"available": False, "reason": f"Claude Code недоступен: {exc}"}
        self._status = st
        return st

    def _mark_unavailable(self, reason: str):
        self._status = {"available": False, "reason": reason}

    # ------------------------------------------------------------ calls
    def call(self, prompt: str) -> str:
        st = self.status()
        if not st["available"]:
            raise BrainUnavailable(st["reason"])
        exe = claude_runtime.check_cli()
        cmd = claude_runtime.build_command(exe, self.model)
        with claude_runtime.isolated_cwd() as cwd:
            try:
                proc = subprocess.run(cmd, input=prompt.encode("utf-8"), cwd=cwd, env=claude_runtime.runtime_env(cwd),
                                      capture_output=True, timeout=self.timeout)
            except subprocess.TimeoutExpired:
                raise BrainUnavailable(f"Claude не ответил за {int(self.timeout)} с")
        text, payload = _parse_result(proc.stdout.decode("utf-8", "replace"))
        err = (text if payload and payload.get("is_error") else "") or proc.stderr.decode("utf-8", "replace")
        if proc.returncode != 0 or (payload and payload.get("is_error")):
            low = err.lower()
            if any(h in low for h in _AUTH_HINTS):
                reason = "Claude Code: нужен вход. Откройте терминал, выполните `claude` и войдите в аккаунт"
                self._mark_unavailable(reason)
                raise BrainUnavailable(reason)
            if any(h in low for h in _LIMIT_HINTS):
                reason = "Claude Code: исчерпан лимит подписки, попробуйте позже"
                self._mark_unavailable(reason)
                raise BrainUnavailable(reason)
            raise BrainUnavailable(f"Claude вернул ошибку: {err.strip()[:200] or proc.returncode}")
        return text

    def call_json(self, prompt: str):
        text = self.call(prompt)
        data = extract_json(text)
        if data is None:
            raise BrainUnavailable("Claude ответил не в формате JSON")
        return data

    # ------------------------------------------------------------ tasks
    def extract_facts(self, company: dict, pages: list[dict], icp: dict, products: list[dict]) -> dict:
        """Facts about a company from its own pages, each with a verbatim quote.
        Returns {'facts': [...], 'company_type': str|None, 'sku_count': int|None,
        'summary': str, 'dropped': int}."""
        page_blocks = "\n\n".join(
            fence(f"URL: {p['url']}\n{p['text'][:6000]}", f"page {i + 1}") for i, p in enumerate(pages))
        product_lines = "\n".join(f"- {p['name']}: {p['value_prop']}" for p in products)
        prompt = f"""Ты — аналитик B2B-продаж. Компания: {company['name']} ({company.get('website', '')}).
Мы продаём SaaS для e-commerce:
{product_lines}
Профиль идеального клиента: отрасли {', '.join(icp.get('industries') or []) or 'любые'}; боли: {', '.join(icp.get('pains') or []) or 'не заданы'}.

Ниже — текст страниц сайта компании. Найди до 6 фактов, важных для продажи наших продуктов:
боли (pain), сигналы спроса (signal: вакансии, запуски, выход в сети, маркетплейсы) и полезную информацию (info: ассортимент, каналы продаж, раздел «Где купить»).

Правила:
- Каждый факт — короткое утверждение по-русски (до 140 символов).
- Для каждого факта приведи "quote" — ДОСЛОВНУЮ цитату со страницы (5–20 слов), без изменений, и "url" страницы.
- Ничего не выдумывай. Не указывай людей, имена, email и телефоны.
- Если подходящих фактов нет — верни пустой список.
- company_type: одно из {COMPANY_TYPES} или null, если непонятно.
- sku_count: число товаров, только если оно прямо указано на странице (иначе null), и "sku_quote" с цитатой.
{UNTRUSTED_RULE}

Ответь строго JSON без пояснений:
{{"facts": [{{"kind": "pain|signal|info", "text": "...", "quote": "...", "url": "..."}}], "company_type": null, "sku_count": null, "sku_quote": null, "summary": "одно предложение о компании"}}

{page_blocks}"""
        data = self.call_json(prompt)
        return validate_facts(data, pages)

    def write_email(self, brief: dict) -> dict:
        facts = brief["facts"][:6]
        facts_block = "\n".join(f"[{f['id']}] {f['text']} (источник: {f['source_url']})" for f in facts)
        contact = brief.get("contact")
        prompt = f"""Ты пишешь короткое персональное B2B-письмо на русском языке.
Компания-получатель: {brief['company']['name']}.
Продукт: {brief['product']['name']} — {brief['product']['value_prop']}
Получатель: {contact['full_name'] + ', ' + (contact.get('title') or '') if contact else 'неизвестен — обращайся без имени'}.
Подпись:
{brief.get('signature', '')}

Факты о компании (используй только их; каждое утверждение о компании помечай [n], где n — номер факта по порядку упоминания в письме, начиная с 1):
{fence(facts_block, 'research facts')}

Правила: 80–140 слов; без выдуманных цифр, людей, ссылок, кейсов и результатов; один конкретный вопрос-призыв в конце; тон деловой, без клише.
{UNTRUSTED_RULE}
Ответь строго JSON: {{"subject": "...", "body": "...", "used_fact_ids": [id фактов в порядке упоминания]}}"""
        data = self.call_json(prompt)
        allowed = {f["id"] for f in facts}
        used = [i for i in (data.get("used_fact_ids") or []) if isinstance(i, int) and i in allowed]
        subject, body = str(data.get("subject") or "").strip(), str(data.get("body") or "").strip()
        if not subject or not body:
            raise BrainUnavailable("Claude не вернул тему или текст письма")
        if re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", body):
            raise BrainUnavailable("Claude добавил в письмо email-адрес — письмо отклонено")
        return {"subject": subject[:140].replace("\n", " "), "body": body, "used_fact_ids": used, "provider": "claude"}


# ---------------------------------------------------------------- helpers

def _parse_result(raw: str) -> tuple[str, dict | None]:
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return raw, None
    if not isinstance(payload, dict) or payload.get("type") != "result":
        return raw, None
    return str(payload.get("result") or ""), payload


def extract_json(text: str):
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip())
    try:
        return json.loads(cleaned)
    except ValueError:
        pass
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(cleaned[start:end + 1])
        except ValueError:
            return None
    return None


def _norm(s: str) -> str:
    s = (s or "").lower().replace("ё", "е")
    s = re.sub(r"[«»\"'“”„]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def validate_facts(data: dict, pages: list[dict]) -> dict:
    """Keep only facts whose quote is literally on the page they cite."""
    by_url = {p["url"]: _norm(p["text"]) for p in pages}
    all_text = " ".join(by_url.values())
    facts, dropped = [], 0
    for f in (data.get("facts") or [])[:8]:
        if not isinstance(f, dict):
            dropped += 1
            continue
        quote, text = str(f.get("quote") or "").strip(), str(f.get("text") or "").strip()
        kind = f.get("kind") if f.get("kind") in FACT_KINDS else "info"
        nq = _norm(quote)
        url = f.get("url") if f.get("url") in by_url else None
        page_text = by_url.get(url, "") if url else ""
        if not text or len(nq) < 8 or (nq not in page_text and nq not in all_text):
            dropped += 1
            continue
        if not url:  # the model cited the wrong page: point at the page that has the quote
            url = next(u for u, t in by_url.items() if nq in t)
        facts.append({"kind": kind, "text": text[:200], "evidence": quote[:240], "source_url": url})
    ctype = data.get("company_type") if data.get("company_type") in COMPANY_TYPES[:-1] else None
    sku = data.get("sku_count")
    sku_quote = _norm(str(data.get("sku_quote") or ""))
    if not (isinstance(sku, int) and sku > 0 and sku_quote and sku_quote in all_text):
        sku = None
    return {"facts": facts, "company_type": ctype, "sku_count": sku,
            "summary": str(data.get("summary") or "")[:300], "dropped": dropped}
