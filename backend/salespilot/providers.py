"""Providers behind stable interfaces. Mock ones are the default; live ones
work only when configured in .env and enabled in Settings.

    LLM:      MockLLM (deterministic templates)  | AnthropicLLM (Messages API, paid)
    Email:    SimulatedEmail (writes nothing out) | SMTPEmail (real send)
    Research: website fetch through Harvey's SSRF-safe public_http client
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import smtplib
import uuid
from email.message import EmailMessage
from html import unescape
from typing import Protocol

import httpx

from .config import Settings
from .harvey_adapter import UNTRUSTED_RULE, detect_tech, fence, public_http_client

log = logging.getLogger("salespilot.providers")

DEMO_TLDS = (".test", ".example", ".invalid", ".localhost")


def is_reserved_domain(domain: str) -> bool:
    d = (domain or "").lower().rstrip(".")
    return d.endswith(DEMO_TLDS) or d in {"example.com", "example.org", "example.net"} or d.endswith(
        (".example.com", ".example.org", ".example.net"))


# ---------------------------------------------------------------- LLM

class LLMProvider(Protocol):
    name: str
    is_live: bool

    def write_email(self, brief: dict) -> dict: ...


class MockLLM:
    """Template writer. Uses ONLY facts passed in the brief; every factual
    sentence carries a [n] marker pointing at a fact with a source."""

    name, is_live = "mock", False

    def write_email(self, brief: dict) -> dict:
        company = brief["company"]["name"]
        product = brief["product"]
        facts = brief["facts"][:2]
        contact = brief.get("contact")
        greet = f"Здравствуйте, {contact['full_name'].split()[0]}!" if contact else "Здравствуйте!"
        lines = [greet, ""]
        used = []
        if facts:
            first = facts[0]
            lines.append(f"Изучая {company}, я обратил(а) внимание: {_lower_first(first['text'])} [1].")
            used.append(first["id"])
            if len(facts) > 1:
                lines.append(f"Также: {_lower_first(facts[1]['text'])} [2].")
                used.append(facts[1]["id"])
        else:
            lines.append(f"Пишу вам по поводу работы {company} с товарным контентом.")
        lines += ["", product["value_prop"], ""]
        if brief.get("rationale"):
            lines.append(f"Почему пишу именно вам: {brief['rationale']}")
            lines.append("")
        lines.append("Если тема актуальна, предлагаю 20-минутный звонок — покажу, как это выглядит на ваших товарах. "
                     "Удобно на следующей неделе?")
        lines += ["", brief.get("signature") or ""]
        hook = _short_hook(facts[0]["text"]) if facts else "товарный контент"
        subject = f"{company}: {hook} — идея с {product['name']}"
        return {"subject": subject[:140], "body": "\n".join(lines).strip(), "used_fact_ids": used,
                "provider": self.name}


class AnthropicLLM:
    """Live writer via the Anthropic Messages API. Paid: only active when
    LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY is set. Falls back to the
    mock writer (with a warning) on any error or invalid output."""

    name, is_live = "anthropic", True

    def __init__(self, api_key: str, model: str):
        self.api_key, self.model = api_key, model

    def write_email(self, brief: dict) -> dict:
        facts_block = "\n".join(f"[{f['id']}] {f['text']} (источник: {f['source_url']})" for f in brief["facts"])
        system = (
            "Ты пишешь короткие персонализированные B2B-письма на русском. Используй ТОЛЬКО факты из блока ниже, "
            "каждое утверждение о компании помечай [n], где n — порядковый номер факта в письме. Не выдумывай людей, "
            "цифры, email-адреса, ссылки и результаты. 80–140 слов. Ответь JSON: "
            '{"subject": str, "body": str, "used_fact_ids": [int]}. ' + UNTRUSTED_RULE)
        user = (f"Компания: {brief['company']['name']}\nПродукт: {brief['product']['name']} — "
                f"{brief['product']['value_prop']}\nКонтакт: "
                f"{brief['contact']['full_name'] if brief.get('contact') else 'неизвестен — без имени'}\n"
                f"Подпись:\n{brief.get('signature', '')}\n\n" + fence(facts_block, "research facts"))
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": self.model, "max_tokens": 800, "system": system,
                  "messages": [{"role": "user", "content": user}]},
            timeout=60,
        )
        resp.raise_for_status()
        text = "".join(b.get("text", "") for b in resp.json().get("content", []))
        match = re.search(r"\{.*\}", text, re.S)
        data = json.loads(match.group(0)) if match else {}
        allowed = {f["id"] for f in brief["facts"]}
        used = [i for i in data.get("used_fact_ids", []) if i in allowed]
        if not data.get("subject") or not data.get("body"):
            raise ValueError("LLM returned no subject/body")
        return {"subject": str(data["subject"])[:140], "body": str(data["body"]), "used_fact_ids": used,
                "provider": self.name}


class ClaudeLLM:
    """Writer on Claude through the operator's Claude Code subscription (see brain.py)."""

    name, is_live = "claude", True

    def __init__(self, brain):
        self.brain = brain

    def write_email(self, brief: dict) -> dict:
        return self.brain.write_email(brief)


def get_llm(settings: Settings, mode: str, brain=None) -> LLMProvider:
    if mode == "live" and settings.llm_provider == "anthropic" and settings.anthropic_configured:
        return AnthropicLLM(settings.anthropic_api_key, settings.anthropic_model)
    if mode == "live" and settings.llm_provider == "claude_cli" and brain is not None and brain.status()["available"]:
        return ClaudeLLM(brain)
    return MockLLM()


def _lower_first(s: str) -> str:
    s = (s or "").strip().rstrip(".")
    if len(s) > 1 and s[0].isupper() and not s[1].isupper():
        return s[0].lower() + s[1:]
    return s


def _short_hook(text: str) -> str:
    words = re.sub(r"[«»\"()]", "", text).split()
    return _lower_first(" ".join(words[:5]).rstrip(",.;:"))


# ---------------------------------------------------------------- Email

class EmailProvider(Protocol):
    name: str
    is_live: bool

    def send(self, to: str, subject: str, body: str) -> str: ...


class SimulatedEmail:
    """Never sends anything. Returns a synthetic message id marked as simulated."""

    name, is_live = "simulated", False

    def send(self, to: str, subject: str, body: str) -> str:
        return f"simulated-{uuid.uuid4().hex[:12]}"


class SMTPEmail:
    name, is_live = "smtp", True

    def __init__(self, settings: Settings):
        self.s = settings

    def send(self, to: str, subject: str, body: str) -> str:
        for value in (to, subject):
            if "\r" in value or "\n" in value:
                raise ValueError("Header injection attempt blocked")
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.s.smtp_from, to, subject
        mid = f"<{uuid.uuid4().hex}@salespilot.local>"
        msg["Message-ID"] = mid
        msg.set_content(body)
        with smtplib.SMTP(self.s.smtp_host, self.s.smtp_port, timeout=30) as smtp:
            smtp.starttls()
            smtp.login(self.s.smtp_user, self.s.smtp_password)
            smtp.send_message(msg)
        return mid


# ---------------------------------------------------------------- Research

EXTRA_FINGERPRINTS = {
    "1C-Bitrix": [r"/bitrix/(js|templates|cache)/", r"bitrix_sessid"],
    "Tilda": [r"static\.tildacdn\.com", r"tilda\.ws"],
    "Magento": [r"mage/cookies", r"static/version\d+/frontend"],
    "Яндекс.Метрика": [r"mc\.yandex\.ru/metrika"],
}

SIGNAL_PATTERNS = [
    ("info", r"где купить|where to buy", "На сайте есть раздел «Где купить»"),
    ("info", r"ozon|wildberries|яндекс\s*маркет|amazon|маркетплейс", "Сайт упоминает присутствие на маркетплейсах"),
    ("info", r"интернет-магазин|online store|купить онлайн|в корзину", "У компании есть собственный интернет-магазин"),
    ("info", r"сеть (салонов|магазинов|бутиков)|\d+\s+(магазин|салон|бутик)", "У компании есть розничная сеть"),
    ("signal", r"ваканси|careers|карьера", "На сайте есть раздел вакансий"),
    ("info", r"каталог|catalog", "На сайте есть каталог товаров"),
    ("info", r"дилер|dealer|партн[её]р", "Сайт упоминает дилерскую/партнёрскую сеть"),
]


def _strip_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
    return re.sub(r"\s+", " ", unescape(re.sub(r"(?s)<[^>]+>", " ", html))).strip()


async def _fetch(url: str) -> tuple[int, str, str]:
    if public_http_client is None:
        raise RuntimeError("Harvey public_http недоступен")
    async with public_http_client(timeout=12.0, headers={"User-Agent": "SalesPilotResearch/0.1 (+manual review)"}) as c:
        r = await c.get(url)
        return r.status_code, str(r.url), r.text[:600_000]


def fetch_page(url: str) -> tuple[int, str, str]:
    return asyncio.run(_fetch(url))


def research_website(website: str) -> dict:
    """Facts that can be read off a public homepage. Never extracts people
    or email addresses. Returns {facts, tech, title}."""
    status, final_url, html = fetch_page(website)
    if status >= 400:
        raise RuntimeError(f"Сайт ответил HTTP {status}")
    tech = set(detect_tech(html))
    for name, patterns in EXTRA_FINGERPRINTS.items():
        if any(re.search(p, html[:300_000], re.I) for p in patterns):
            tech.add(name)
    text = _strip_html(html)
    title = (re.search(r"(?is)<title[^>]*>(.*?)</title>", html) or [None, ""])[1].strip()
    desc_m = re.search(r'(?is)<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', html)
    facts = []
    if desc_m:
        d = unescape(desc_m.group(1)).strip()[:300]
        facts.append({"kind": "info", "text": f"Описание на сайте: {d}", "evidence": d[:120]})
    for kind, pattern, label in SIGNAL_PATTERNS:
        m = re.search(pattern, text, re.I)
        if m:
            start = max(0, m.start() - 60)
            facts.append({"kind": kind, "text": label, "evidence": text[start:m.end() + 60].strip()})
    return {"facts": facts, "tech": sorted(tech), "title": unescape(title)[:200], "final_url": final_url}


def verify_evidence(url: str, evidence: str) -> tuple[str, str]:
    """('verified'|'not_found', note) after re-fetching the source."""
    status, _, html = fetch_page(url)
    if status >= 400:
        return "not_found", f"Источник ответил HTTP {status}"
    text = _strip_html(html).lower()
    needle = re.sub(r"\s+", " ", (evidence or "").lower()).strip()[:80]
    if needle and needle in text:
        return "verified", "Фрагмент найден на странице источника"
    return "not_found", "Фрагмент не найден на странице источника"
