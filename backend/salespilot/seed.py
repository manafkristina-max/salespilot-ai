"""python -m salespilot.seed [--full] — заполнить базу демо-кампанией за один шаг.

--full дополнительно проводит одно письмо через весь цикл (одобрение →
симуляция отправки → демо-ответ), одно отправляет на ревью и одно одобряет,
чтобы воронка и экраны Outreach были заполнены.

Создаёт кампанию с ICP по умолчанию, запускает Scout на демо-датасете и
весь конвейер агентов. Всё помечено как демо; ничего не отправляется.
Повторный запуск не создаёт дубликатов компаний.
"""

import sys

from .config import get_settings
from .db import Database
from .service import SalesPilot

ICP = {
    "industries": ["Электроника", "Бытовая техника", "Косметика", "DIY и инструменты", "Детские товары"],
    "geographies": ["Россия", "Казахстан", "Беларусь"],
    "company_types": ["Бренд-производитель", "Дистрибьютор"],
    "employees_min": 50, "employees_max": 3000, "min_sku": 300,
    "pains": ["карточки", "маркетплейс", "ассортимент", "где купить"],
    "product": "auto",
}


def full_scenario(sp: SalesPilot) -> None:
    emails = sorted(sp.list_emails(), key=lambda e: e["id"])
    if len(emails) < 3:
        return
    first, second, third = emails[:3]
    sp.set_email_status(first["id"], "approve")
    sp.send_email(first["id"], confirm=True)  # demo company → simulation only
    sp.add_reply(first["id"], "Добрый день! Интересно, давайте созвонимся на следующей неделе "
                              "и посмотрим на наших товарах. (демо-ответ)")
    sp.update_email(second["id"], {"body": second["body"].replace(
        "Удобно на следующей неделе?", "Удобно ли вам в четверг или пятницу?")})
    sp.set_email_status(second["id"], "submit")
    sp.set_email_status(third["id"], "approve")


def main() -> None:
    s = get_settings()
    sp = SalesPilot(Database(s.db_path), s)
    c = sp.create_campaign({"name": "E-commerce бренды — Rich Content / PIM",
                            "description": "Демо-кампания: бренды с большим ассортиментом на маркетплейсах",
                            "icp": ICP})
    scout = sp.scout(c["id"], "demo")
    run = sp.run_pipeline(c["id"])
    print(f"Кампания #{c['id']}: {scout['message']}")
    if "--full" in sys.argv:
        full_scenario(sp)
        print("Демо-сценарий: 1 письмо — симуляция отправки и демо-ответ, 1 на ревью, 1 одобрено")
    print(f"Агенты: квалифицировано {run['qualified']}, не подходят {run['disqualified']}, черновиков {run['drafted']}")
    print(f"Откройте http://{s.host}:{s.port}")


if __name__ == "__main__":
    main()
