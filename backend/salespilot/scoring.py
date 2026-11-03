"""ICP Fit Score: 0-100 with an explanation per factor.

Inspired by Harvey's fit.py (one number + the reasons behind it), extended to
the five configurable factors SalesPilot needs. Each factor returns a value in
[0, 1] or None when there is no data. Missing factors are counted at a
conservative MISSING_VALUE so that a lack of data can never inflate a score;
``confidence`` is the share of weight that rested on real data.

    industry      industry / company type / geography vs ICP
    scale         employees and SKU count vs ICP range
    demand        researched pains & signals matching ICP pains or products
    tech          detected stack vs compatible platforms
    data_quality  completeness of profile + share of verified facts

Knock-outs (industry / geography outside the ICP) make a lead not qualified
regardless of its score, and are listed in the explanation.
"""

from __future__ import annotations

from .harvey_adapter import do_not_contact_domain_match

MISSING_VALUE = 0.3

FACTOR_LABELS = {
    "industry": "Соответствие отрасли",
    "scale": "Масштаб",
    "demand": "Сигналы спроса",
    "tech": "Технологическая совместимость",
    "data_quality": "Качество данных",
}


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _in(value: str, options: list[str]) -> bool:
    v = _norm(value)
    return bool(v) and any(_norm(o) == v for o in options or [])


def _clip(text: str, limit: int = 90) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def _keyword_hits(text: str, keywords: list[str]) -> list[str]:
    low = _norm(text)
    return [k for k in keywords if k and _norm(k) in low]


def factor_industry(company: dict, icp: dict):
    industries, types, geos = icp.get("industries") or [], icp.get("company_types") or [], icp.get("geographies") or []
    if not company.get("industry") and not company.get("country"):
        return None, "Отрасль и страна не указаны", ["industry", "country"]
    parts, notes, missing = [], [], []
    if industries:
        if not company.get("industry"):
            missing.append("industry")
        hit = _in(company.get("industry"), industries)
        parts.append((0.6, 1.0 if hit else 0.0))
        notes.append(f"отрасль «{company.get('industry') or '—'}» {'входит' if hit else 'не входит'} в ICP")
    if types:
        hit = _in(company.get("company_type"), types)
        parts.append((0.2, 1.0 if hit else 0.0))
        notes.append(f"тип «{company.get('company_type') or '—'}» {'подходит' if hit else 'не подходит'}")
    if geos:
        if not company.get("country"):
            missing.append("country")
        hit = _in(company.get("country"), geos) or _in(company.get("city"), geos)
        parts.append((0.2, 1.0 if hit else 0.0))
        notes.append(f"география «{company.get('country') or '—'}» {'в' if hit else 'вне'} ICP")
    if not parts:
        return 0.5, "ICP не задаёт отрасль, тип и географию — нейтральная оценка", missing
    total = sum(w for w, _ in parts)
    return sum(w * v for w, v in parts) / total, "; ".join(notes), missing


def factor_scale(company: dict, icp: dict):
    emp, sku = company.get("employees"), company.get("sku_count")
    lo, hi = icp.get("employees_min"), icp.get("employees_max")
    min_sku = icp.get("min_sku")
    if emp is None and sku is None:
        return None, "Нет данных о численности и ассортименте", ["employees", "sku_count"]
    parts, notes, missing = [], [], []
    if emp is not None:
        lo_v, hi_v = lo or 0, hi or 10 ** 9
        if lo_v <= emp <= hi_v:
            parts.append(1.0)
            notes.append(f"{emp} сотрудников — в диапазоне ICP")
        elif emp >= lo_v * 0.5 and emp <= hi_v * 1.5:
            parts.append(0.5)
            notes.append(f"{emp} сотрудников — близко к диапазону ICP")
        else:
            parts.append(0.1)
            notes.append(f"{emp} сотрудников — вне диапазона ICP")
    else:
        missing.append("employees")
    if sku is not None:
        if min_sku:
            ok = sku >= min_sku
            parts.append(1.0 if ok else max(0.1, sku / min_sku))
            notes.append(f"{sku} SKU {'≥' if ok else '<'} {min_sku}")
        else:
            parts.append(1.0 if sku >= 500 else 0.6 if sku >= 100 else 0.3)
            notes.append(f"{sku} SKU")
    else:
        missing.append("sku_count")
    return sum(parts) / len(parts), "; ".join(notes), missing


def factor_demand(company: dict, facts: list[dict], icp: dict, products: list[dict]):
    if not facts:
        return None, "Исследование не нашло фактов о потребностях", ["facts"]
    keywords = list(icp.get("pains") or [])
    for p in products:
        if not icp.get("product") or icp.get("product") in ("auto", p["id"]):
            keywords += p.get("keywords") or []
    matched = []
    for f in facts:
        if f.get("kind") not in ("pain", "signal"):
            continue
        hits = _keyword_hits(f["text"], keywords)
        if hits:
            matched.append((f, hits))
    n = len(matched)
    value = 0.1 if n == 0 else 0.6 if n == 1 else 1.0
    if n == 0:
        note = "Факты есть, но сигналов спроса по ICP не найдено"
    else:
        note = f"Найдено сигналов спроса: {n}: " + "; ".join(_clip(f["text"]) for f, _ in matched[:3])
    return value, note, []


def factor_tech(company: dict, compatible: list[str]):
    tech = company.get("tech") or []
    if not tech:
        return None, "Технологический стек не определён", ["tech"]
    hits = [t for t in tech if _in(t, compatible)]
    if hits:
        return 1.0, "Совместимые платформы: " + ", ".join(hits), []
    return 0.3, "Стек определён (" + ", ".join(tech) + "), совместимых платформ не найдено", []


def factor_data_quality(company: dict, facts: list[dict], contacts: list[dict]):
    fields = ["website", "industry", "country", "employees", "sku_count", "company_type"]
    present = [f for f in fields if company.get(f) not in (None, "")]
    missing = [f for f in fields if f not in present]
    profile = len(present) / len(fields)
    if facts:
        # Demo facts can't be checked against a real page: half credit.
        checked = sum(1.0 if f.get("verification") == "verified" else 0.5 if f.get("verification") == "demo" else 0
                      for f in facts)
        fact_q = checked / len(facts)
    else:
        fact_q = 0.0
        missing.append("facts")
    contact_q = 1.0 if contacts else 0.0
    if not contacts:
        missing.append("contact")
    value = 0.5 * profile + 0.35 * fact_q + 0.15 * contact_q
    note = (f"Профиль заполнен на {round(profile * 100)}%, фактов с источником: {len(facts)}, "
            f"контактов: {len(contacts)}")
    return value, note, missing


def score_company(company: dict, facts: list[dict], contacts: list[dict], icp: dict,
                  weights: dict, compatible_tech: list[str], products: list[dict],
                  do_not_contact: list[str] | None = None, threshold: int = 60) -> dict:
    """Full, explainable score. Pure function: easy to test."""
    dnc = do_not_contact or []
    if company.get("domain") and dnc and do_not_contact_domain_match(company["domain"], dnc):
        return {"score": 0, "confidence": 1.0, "qualified": False, "factors": [],
                "missing": [], "summary": "Компания в списке do-not-contact"}

    computed = {
        "industry": factor_industry(company, icp),
        "scale": factor_scale(company, icp),
        "demand": factor_demand(company, facts, icp, products),
        "tech": factor_tech(company, compatible_tech),
        "data_quality": factor_data_quality(company, facts, contacts),
    }
    total_w = sum(max(0, float(weights.get(k, 0))) for k in computed) or 1.0
    score, known_w, factors, missing = 0.0, 0.0, [], []
    for key, (value, note, miss) in computed.items():
        w = max(0, float(weights.get(key, 0)))
        used = MISSING_VALUE if value is None else value
        points = w / total_w * 100 * used
        score += points
        if value is not None:
            known_w += w
        missing += miss
        factors.append({
            "key": key, "label": FACTOR_LABELS[key], "weight": w,
            "value": None if value is None else round(value, 2),
            "points": round(points, 1), "max_points": round(w / total_w * 100, 1),
            "explanation": note, "missing_data": value is None,
        })
    final = int(round(score))
    confidence = round(known_w / total_w, 2)
    knockouts = knockout_reasons(company, icp)
    qualified = final >= threshold and confidence >= 0.6 and not knockouts
    best = max(factors, key=lambda f: f["points"] / f["max_points"] if f["max_points"] else 0)
    worst = min(factors, key=lambda f: f["points"] / f["max_points"] if f["max_points"] else 1)
    summary = f"Сильнее всего: {best['label'].lower()}; слабее всего: {worst['label'].lower()}."
    if confidence < 0.6:
        summary += " Низкая уверенность — не хватает данных."
    if knockouts:
        summary += " Стоп-критерий: " + "; ".join(knockouts) + "."
    return {"score": final, "confidence": confidence, "qualified": qualified, "factors": factors,
            "missing": sorted(set(missing)), "knockouts": knockouts, "summary": summary}


def knockout_reasons(company: dict, icp: dict) -> list[str]:
    """Hard ICP filters: a lead outside the ICP industry or geography is not
    qualified, whatever its other factors add up to."""
    out = []
    if icp.get("industries") and company.get("industry") and not _in(company["industry"], icp["industries"]):
        out.append(f"отрасль «{company['industry']}» вне ICP")
    geos = icp.get("geographies")
    if geos and company.get("country") and not (_in(company["country"], geos) or _in(company.get("city"), geos)):
        out.append(f"география «{company['country']}» вне ICP")
    return out
