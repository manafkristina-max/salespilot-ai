#!/usr/bin/env python3
"""Smoke-тест основного сценария на живом сервере (без зависимостей, только stdlib).

    python3 scripts/smoke_test.py                       # http://127.0.0.1:8000
    python3 scripts/smoke_test.py https://example.app   # публичное демо

Создаёт отдельную тестовую кампанию и проходит путь пользователя:
кампания → поиск → агенты → карточка → письмо → правка → одобрение →
симуляция отправки → ответ → аналитика → экспорт. Ничего реально не отправляет.
Выход с кодом 1, если хотя бы одна проверка не прошла.
"""

import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
results: list[tuple[bool, str]] = []


def call(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
            return r.status, (payload.decode("utf-8-sig") if raw else json.loads(payload or b"null"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(ok, name):
    results.append((bool(ok), name))
    print(("  ✓ " if ok else "  ✗ ") + name)
    return ok


def main():
    t0 = time.time()
    print(f"Smoke-тест SalesPilot AI → {BASE}")
    s, h = call("GET", "/api/health")
    if not check(s == 200 and h.get("ok"), "API отвечает (/api/health)"):
        return finish(t0)
    s, page = call("GET", "/", raw=True)
    check(s == 200 and "<div id=\"root\">" in page, "Интерфейс отдаётся (index.html)")

    icp = {"industries": ["Электроника", "Бытовая техника", "Косметика", "DIY и инструменты", "Детские товары"],
           "geographies": ["Россия", "Казахстан", "Беларусь"], "company_types": ["Бренд-производитель", "Дистрибьютор"],
           "employees_min": 50, "employees_max": 3000, "min_sku": 300,
           "pains": ["карточки", "маркетплейс"], "product": "auto"}
    s, c = call("POST", "/api/campaigns", {"name": f"Smoke-тест {int(time.time())}", "icp": icp})
    check(s == 201, "Создание кампании с ICP")
    cid = c["id"]
    s, r = call("POST", f"/api/campaigns/{cid}/scout?source=demo")
    check(s == 200 and r["matched"] > 0, f"Агент поиска: подобрано {r.get('matched')} компаний")
    s, r = call("POST", f"/api/campaigns/{cid}/run")
    check(s == 200 and not r["errors"] and r["qualified"] > 0,
          f"Агенты: квалифицировано {r.get('qualified')}, черновиков {r.get('drafted')}")

    s, comps = call("GET", f"/api/companies?campaign_id={cid}")
    check(s == 200 and comps and all(x["is_demo"] for x in comps), "Таблица лидов кампании, все помечены как демо")
    s, high = call("GET", f"/api/companies?campaign_id={cid}&min_score=60")
    check(s == 200 and all(x["score"] >= 60 for x in high), "Фильтр по оценке ≥ 60")
    s, detail = call("GET", f"/api/companies/{comps[0]['id']}")
    lead = next(l for l in detail["leads"] if l["campaign_id"] == cid)
    sd = lead["score_detail"]
    check(len(sd["factors"]) == 5 and all(f["explanation"] for f in sd["factors"]),
          "Карточка: 5 факторов оценки с объяснением")
    check(detail["contacts"] == [] and all(f["source_url"] for f in detail["facts"]),
          "Контакты не выдуманы, у всех фактов есть источник")

    s, emails = call("GET", f"/api/emails?campaign_id={cid}")
    check(s == 200 and emails, f"Черновики писем созданы: {len(emails)}")
    eid = emails[0]["id"]
    s, e = call("GET", f"/api/emails/{eid}")
    check(e["claims"] and all(f"[{c['n']}]" in e["body"] for c in e["claims"]), "Утверждения в письме связаны с фактами")
    s, r = call("POST", f"/api/emails/{eid}/send", {"confirm": True})
    check(s == 409, "Неодобренное письмо отправить нельзя")
    s, e = call("PATCH", f"/api/emails/{eid}", {"subject": e["subject"] + " (правка)"})
    check(s == 200 and e["subject"].endswith("(правка)"), "Редактирование темы письма")
    s, e = call("POST", f"/api/emails/{eid}/approve", {"reason": ""})
    check(s == 200 and e["status"] == "approved", "Одобрение письма")
    s, e = call("POST", f"/api/emails/{eid}/send", {"confirm": True})
    check(s == 200 and e["status"] == "sent" and e["send_mode"] == "simulated",
          "Отправка демо-письма — только симуляция")
    s, e = call("POST", f"/api/emails/{eid}/replies", {"body": "Интересно, давайте созвонимся"})
    check(s == 201 and e["replies"][-1]["classification"] == "interested", "Обработчик ответов: «интерес»")
    if len(emails) > 1:
        s, e = call("POST", f"/api/emails/{emails[1]['id']}/reject", {"reason": "smoke"})
        check(s == 200 and e["status"] == "rejected", "Отклонение письма")

    s, a = call("GET", f"/api/analytics?campaign_id={cid}&scope=real")
    check(s == 200 and all(st["count"] == 0 for st in a["funnel"]), "Аналитика «реальные»: демо не попадает в реальные метрики")
    s, a = call("GET", f"/api/analytics?campaign_id={cid}&scope=all")
    check(next(st for st in a["funnel"] if st["key"] == "replied")["count"] >= 1, "Аналитика «все»: воронка до ответа")
    s, csv = call("GET", f"/api/export/companies.csv?campaign_id={cid}", raw=True)
    check(s == 200 and csv.startswith("id,name,domain"), "Экспорт CSV")
    s, st = call("GET", "/api/settings")
    check(s == 200 and st["values"]["approval"]["require_manual_approval"] is True, "Ручное одобрение включено и заблокировано")
    s, _ = call("DELETE", f"/api/campaigns/{cid}")
    check(s == 204, "Тестовая кампания удалена")
    return finish(t0)


def finish(t0):
    ok = sum(1 for r in results if r[0])
    print(f"\nИтог: {ok}/{len(results)} проверок пройдено за {time.time() - t0:.1f} с")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
