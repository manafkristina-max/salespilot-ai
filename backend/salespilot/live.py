"""Real-world data for the live agent: company discovery in Wikidata and
reading a few pages of each company's own website.

Wikidata (query.wikidata.org) is open data (CC0) with an official SPARQL
endpoint, so discovery is free and within its terms. Websites are fetched
politely: robots.txt is honoured, at most MAX_PAGES pages per company, through
Harvey's SSRF-safe public HTTP client. No people or email addresses are
collected anywhere.
"""

from __future__ import annotations

import asyncio
import re
from html import unescape
from typing import Callable
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from .harvey_adapter import detect_tech, public_http_client
from .providers import EXTRA_FINGERPRINTS, SIGNAL_PATTERNS, _strip_html, is_reserved_domain

USER_AGENT = "SalesPilotAI/0.1 (+https://github.com/manafkristina-max/salespilot-ai; research bot, human-reviewed)"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
MAX_PAGES = 4

COUNTRY_QIDS = {
    "россия": "Q159", "казахстан": "Q232", "беларусь": "Q184", "белоруссия": "Q184", "узбекистан": "Q265",
    "армения": "Q399", "кыргызстан": "Q813", "киргизия": "Q813", "грузия": "Q230", "азербайджан": "Q227",
    "германия": "Q183", "польша": "Q36", "турция": "Q43", "китай": "Q148", "сша": "Q30",
}

# ICP industry (as the user writes it) → English search terms for Wikidata
# industry items. Unknown industries are searched as written (in Russian).
INDUSTRY_SEARCH = {
    "электроника": ["consumer electronics", "electronics", "electronics industry"],
    "бытовая техника": ["home appliance", "household appliance", "small appliance"],
    "косметика": ["cosmetics", "cosmetics industry", "personal care", "perfume"],
    "diy и инструменты": ["tool", "power tool", "hardware", "home improvement"],
    "детские товары": ["toy", "toy industry", "children's clothing", "baby food"],
    "fashion": ["fashion", "clothing industry", "clothing", "footwear"],
    "fmcg": ["fast-moving consumer goods", "food industry", "beverage", "consumer goods"],
    "продукты питания": ["food industry", "food processing", "confectionery"],
    "спорттовары": ["sporting goods", "sportswear"],
    "товары для дома": ["furniture", "housewares", "home furnishings"],
    "зоотовары": ["pet food", "pet store"],
    "медицинские изделия": ["medical device", "pharmaceutical industry"],
    "ритейл": ["retail", "online shopping", "e-commerce", "supermarket"],
}

Log = Callable[[str], None]


def _wd_search(term: str, lang: str) -> list[tuple[str, str]]:
    r = httpx.get(WIKIDATA_API, params={"action": "wbsearchentities", "search": term, "language": lang, "uselang": "ru",
                                        "type": "item", "limit": 3, "format": "json"},
                  headers={"User-Agent": USER_AGENT}, timeout=20)
    r.raise_for_status()
    return [(h["id"], h.get("label", term)) for h in r.json().get("search", [])]


def resolve_industries(industries: list[str], log: Log) -> dict[str, str]:
    """{wikidata industry QID: ICP industry it stands for}."""
    from concurrent.futures import ThreadPoolExecutor

    def lookup(ind: str):
        terms = INDUSTRY_SEARCH.get(ind.strip().lower())
        try:
            if terms:
                return ind, [h for t in terms for h in _wd_search(t, "en")[:2]]
            return ind, _wd_search(ind, "ru")
        except httpx.HTTPError:
            return ind, None

    out: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lookup, industries or []))
    for ind, hits in results:
        if hits is None:
            log(f"Не удалось сопоставить отрасль «{ind}» с Wikidata — пропускаю")
            continue
        for qid, _ in hits:
            out.setdefault(qid, ind)
        if hits:
            log(f"Отрасль «{ind}» → Wikidata: {', '.join(dict.fromkeys(label for _, label in hits))}")
    return out


def _country_qids(geos: list[str], log: Log) -> list[str]:
    out = []
    for g in geos or []:
        qid = COUNTRY_QIDS.get(g.strip().lower())
        if not qid:
            try:
                hit = (_wd_search(g, "ru") or [(None, "")])[0]
                qid = hit[0]
                if qid:
                    log(f"Страна «{g}» найдена в Wikidata как {hit[1]} ({qid})")
            except httpx.HTTPError:
                qid = None
        if qid:
            out.append(qid)
        else:
            log(f"Страну «{g}» не удалось найти в Wikidata — пропускаю")
    return out


def _sparql(query: str, log: Log) -> list[dict]:
    last = None
    for attempt in range(2):
        try:
            r = httpx.get(WIKIDATA_SPARQL, params={"query": query, "format": "json"},
                          headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"}, timeout=70)
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r.json()["results"]["bindings"]
        except httpx.HTTPError as exc:
            last = exc
            if attempt == 0:
                log("Wikidata перегружена или не ответила вовремя — повторяю запрос…")
    raise RuntimeError("Wikidata сейчас не отвечает (перегрузка сервиса). Попробуйте ещё раз через минуту "
                       "или выберите источник «Мои сайты»") from last


def discover_wikidata(icp: dict, limit: int, log: Log, exclude_domains: set[str] | None = None) -> list[dict]:
    """Real companies matching the ICP industries and countries, with an official website."""
    if not icp.get("industries"):
        raise ValueError("Укажите в ICP хотя бы одну отрасль — по ней агент ищет компании в Wikidata")
    log("Сопоставляю отрасли ICP с отраслями Wikidata…")
    industries = resolve_industries(icp["industries"], log)
    if not industries:
        raise RuntimeError("Ни одну отрасль ICP не удалось найти в Wikidata")
    countries = _country_qids(icp.get("geographies") or [], log)
    country_clause = f"VALUES ?country {{ {' '.join('wd:' + q for q in countries)} }}" if countries else ""
    query = f"""
SELECT ?item ?itemLabel ?site ?countryLabel ?ind (MAX(?emp) AS ?employees) WHERE {{
  VALUES ?ind {{ {' '.join('wd:' + q for q in industries)} }}
  {country_clause}
  ?item wdt:P452 ?ind ; wdt:P17 ?country ; wdt:P856 ?site .
  FILTER NOT EXISTS {{ ?item wdt:P576 ?dissolved }}
  OPTIONAL {{ ?item wdt:P1128 ?emp }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ru,en". ?item rdfs:label ?itemLabel . ?country rdfs:label ?countryLabel . }}
}} GROUP BY ?item ?itemLabel ?site ?countryLabel ?ind LIMIT {max(limit * 8, 40)}
"""
    log("Ищу компании в Wikidata по отраслям и странам…")
    rows = _sparql(query, log)
    log(f"Wikidata вернула {len(rows)} компаний с официальным сайтом")
    seen, out = set(exclude_domains or ()), []
    # Within each ICP industry, companies with a known headcount first (established
    # brands); then take them round-robin so one industry can't fill the whole list.
    rows.sort(key=lambda b: -float(b.get("employees", {}).get("value", 0) or 0))
    buckets: dict[str, list[dict]] = {}
    for b in rows:
        buckets.setdefault(industries.get(b["ind"]["value"].rsplit("/", 1)[-1], ""), []).append(b)
    ordered = []
    while any(buckets.values()):
        for key in list(buckets):
            if buckets[key]:
                ordered.append(buckets[key].pop(0))
    for b in ordered:
        site = b["site"]["value"]
        domain = (urlparse(site).hostname or "").lower().removeprefix("www.")
        name = b["itemLabel"]["value"]
        if not domain or domain in seen or re.fullmatch(r"Q\d+", name):
            continue
        seen.add(domain)
        qid = b["ind"]["value"].rsplit("/", 1)[-1]
        emp = b.get("employees", {}).get("value")
        out.append({
            "name": name, "website": site, "domain": domain,
            "industry": industries.get(qid, ""), "country": b.get("countryLabel", {}).get("value", ""),
            "employees": int(float(emp)) if emp else None,
            "description": f"Компания из Wikidata, отрасль: {industries.get(qid, '')} ({qid})",
            "wikidata_url": b["item"]["value"],
        })
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- websites

LINK_HINTS = [
    ("catalog", r"каталог|catalog|продукц|products?\b|товары|shop|магазин"),
    ("where_to_buy", r"где купить|where[- ]to[- ]buy|магазины|дилер|dealer|партн[её]р|stores"),
    ("about", r"о компании|about|о нас|компания|history|история"),
    ("careers", r"ваканси|карьер|careers?|jobs|работа у нас"),
]


async def _fetch(client, url: str) -> tuple[int, str, str]:
    r = await client.get(url)
    ctype = r.headers.get("content-type", "")
    text = r.text[:600_000] if ("html" in ctype or "text" in ctype or not ctype) else ""
    return r.status_code, str(r.url), text


async def _read_site(website: str, log: Log) -> dict:
    if public_http_client is None:
        raise RuntimeError("Безопасный HTTP-клиент Harvey недоступен")
    if "://" not in website:
        website = "https://" + website
    async with public_http_client(timeout=15.0, headers={"User-Agent": USER_AGENT}) as client:
        try:
            status, final, html = await _fetch(client, website)
        except httpx.HTTPError:
            if website.startswith("https://"):
                website = "http://" + website[len("https://"):]
                status, final, html = await _fetch(client, website)
            else:
                raise
        if status >= 400 or not html:
            raise RuntimeError(f"сайт ответил HTTP {status}")
        base = f"{urlparse(final).scheme}://{urlparse(final).netloc}"
        robots = RobotFileParser()
        try:
            rs, _, rtext = await _fetch(client, base + "/robots.txt")
            robots.parse(rtext.splitlines() if rs < 400 else [])
        except httpx.HTTPError:
            robots.parse([])
        pages = [{"url": final, "kind": "home", "html": html}]
        host = urlparse(final).hostname
        links = re.findall(r'(?is)<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', html)
        chosen: dict[str, str] = {}
        for href, label in links:
            url = urljoin(final, unescape(href.strip()))
            p = urlparse(url)
            if p.scheme not in ("http", "https") or p.hostname != host or url.rstrip("/") == final.rstrip("/"):
                continue
            label_text = _strip_html(label).lower()
            for kind, pat in LINK_HINTS:
                if kind not in chosen and (re.search(pat, label_text) or re.search(pat, p.path.lower())):
                    chosen[kind] = url
                    break
        for kind, url in list(chosen.items())[: MAX_PAGES - 1]:
            if not robots.can_fetch(USER_AGENT, url):
                log(f"robots.txt запрещает {url} — пропускаю")
                continue
            try:
                s, f, h = await _fetch(client, url)
                if s < 400 and h:
                    pages.append({"url": f, "kind": kind, "html": h})
            except httpx.HTTPError:
                continue
    tech = set(detect_tech(" ".join(p["html"][:300_000] for p in pages)))
    for name, patterns in EXTRA_FINGERPRINTS.items():
        if any(re.search(pat, p["html"][:300_000], re.I) for p in pages for pat in patterns):
            tech.add(name)
    title = (re.search(r"(?is)<title[^>]*>(.*?)</title>", html) or [None, ""])[1]
    for p in pages:
        p["text"] = _strip_html(p.pop("html"))[:20_000]
    return {"pages": pages, "tech": sorted(tech), "title": unescape(title).strip()[:200], "final_url": final}


def read_site(website: str, log: Log) -> dict:
    """Up to MAX_PAGES pages of a public website, as plain text, plus its tech stack."""
    domain = (urlparse(website if "://" in website else "https://" + website).hostname or "").lower()
    if is_reserved_domain(domain):
        raise RuntimeError("зарезервированный (демо) домен не загружается")
    return asyncio.run(_read_site(website, log))


def rule_facts(pages: list[dict]) -> list[dict]:
    """Fallback without the brain: keyword signals, each with the matched snippet as evidence."""
    out, seen = [], set()
    for p in pages:
        for kind, pattern, label in SIGNAL_PATTERNS:
            if label in seen:
                continue
            m = re.search(pattern, p["text"], re.I)
            if m:
                seen.add(label)
                start = max(0, m.start() - 60)
                out.append({"kind": kind, "text": label, "evidence": p["text"][start:m.end() + 60].strip(),
                            "source_url": p["url"]})
    return out
