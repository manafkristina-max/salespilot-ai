"""Workspace settings kept in SQLite (key -> JSON), with defaults."""

from __future__ import annotations

import copy

from .db import Database, dumps, loads

DEFAULT_PRODUCTS = [
    {
        "id": "rich_content",
        "name": "Rich Content",
        "value_prop": "Rich Content помогает брендам публиковать единые расширенные карточки (A+, инфографика, видео) "
                      "на маркетплейсах и сайтах ритейлеров — без ручного копирования.",
        "keywords": ["карточ", "контент", "описани", "инфографик", "rich", "a+", "конверси", "маркетплейс"],
    },
    {
        "id": "where_to_buy",
        "name": "Where-to-Buy",
        "value_prop": "Where-to-Buy добавляет на сайт бренда виджет «Где купить» с актуальным наличием у ритейлеров "
                      "и измеряет, сколько покупателей вы передаёте партнёрам.",
        "keywords": ["где купить", "where to buy", "дилер", "ритейлер", "партнёр", "сети", "магазин", "наличи"],
    },
    {
        "id": "pim",
        "name": "PIM",
        "value_prop": "PIM собирает данные о товарах в одном месте и выгружает их в нужных форматах для каждого "
                      "канала — маркетплейсов, сетей и дилеров.",
        "keywords": ["sku", "ассортимент", "атрибут", "excel", "таблиц", "формат", "поставщик", "характеристик", "pim"],
    },
]

DEFAULTS: dict = {
    "mode": "demo",  # demo | live
    "scoring_weights": {"industry": 25, "scale": 20, "demand": 25, "tech": 15, "data_quality": 15},
    "qualify_threshold": 60,
    "compatible_tech": ["Shopify", "WooCommerce", "BigCommerce", "Magento", "1C-Bitrix", "Next.js", "WordPress",
                        "Tilda", "Google Tag Manager"],
    "approval": {
        "require_manual_approval": True,   # locked: cannot be turned off in this MVP
        "require_send_confirmation": True,
        "min_score_to_draft": 50,
        "daily_send_limit": 20,
        "sending_paused": False,
    },
    "products": DEFAULT_PRODUCTS,
    "do_not_contact": [],
    "sender": {"name": "", "company": "", "signature": "С уважением,\n[Ваше имя]\n[Компания]"},
}

LOCKED = {("approval", "require_manual_approval"): True}


class SettingsStore:
    def __init__(self, db: Database):
        self.db = db

    def get(self, key: str):
        row = self.db.one("SELECT value_json FROM settings WHERE key = ?", (key,))
        default = copy.deepcopy(DEFAULTS.get(key))
        if row is None:
            return default
        value = loads(row["value_json"], default)
        if isinstance(default, dict) and isinstance(value, dict):
            merged = {**default, **value}
            for (k, sub), locked in LOCKED.items():
                if k == key:
                    merged[sub] = locked
            return merged
        return value

    def all(self) -> dict:
        return {k: self.get(k) for k in DEFAULTS}

    def set(self, key: str, value) -> None:
        if key not in DEFAULTS:
            raise KeyError(key)
        if isinstance(value, dict):
            for (k, sub), locked in LOCKED.items():
                if k == key:
                    value = {**value, sub: locked}
        self.db.execute(
            "INSERT INTO settings(key, value_json) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            (key, dumps(value)),
        )
