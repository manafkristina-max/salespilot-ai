<div align="center">

# SalesPilot AI

**AI-SDR, который не выдумывает.**
Находит и квалифицирует B2B-клиентов для SaaS в e-commerce, готовит персонализированные письма с проверяемыми утверждениями и ничего не отправляет без одобрения человека.

[**Кейс-презентация**](https://manafkristina-max.github.io/salespilot-ai/) · [Product case (CASE_STUDY)](CASE_STUDY.md) · [Архитектура](ARCHITECTURE.md) · [Demo script](DEMO_SCRIPT.md)

[![CI](https://github.com/manafkristina-max/salespilot-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/manafkristina-max/salespilot-ai/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-green)

<img src="docs/screenshots/dashboard.png" alt="SalesPilot AI Dashboard" width="900">

</div>

---

## Зачем

SDR, продающий **Rich Content**, **Where-to-Buy** и **PIM** брендам, тратит часы на ресёрч аккаунтов, а AI-инструменты, которые это ускоряют, придумывают факты, имена и «встречи». SalesPilot делает ставку на **доверие вместо автопилота**:

| Принцип | Как это реализовано |
|---|---|
| Объяснимость | ICP Fit Score из 5 факторов с текстовым «почему», уверенностью, недостающими данными и стоп-критериями |
| Проверяемость | Каждое утверждение в письме помечено `[n]` и ведёт на факт с источником и датой проверки |
| Человек в контуре | Ручное одобрение каждого письма заблокировано в коде, плюс подтверждение отправки, дневной лимит и kill switch |
| Честные данные | Контакты не генерируются; демо и симуляции никогда не попадают в реальные метрики |

## Попробовать за 2 минуты

Нужны **Python 3.11+**, **Node.js 18+** и **git**. Ключи, почта и платные сервисы не нужны.

```bash
git clone --recursive https://github.com/manafkristina-max/salespilot-ai.git
cd salespilot-ai
./start.sh --demo
```

Откройте **http://127.0.0.1:8000**. Флаг `--demo` при пустой базе создаёт демо-кампанию и прогоняет агентов: 13 вымышленных компаний, 5 квалифицированных лидов, 5 черновиков писем. Без флага стартует пустой продукт, а кампанию можно создать в интерфейсе.

Остановка: `Ctrl+C`. Начать заново: удалить `data/salespilot.db`.

<details>
<parameter name="summary">Ручная установка, разработка, тесты</summary>

```bash
python3 -m venv backend/.venv                      # нужен Python 3.11+
backend/.venv/bin/pip install -r backend/requirements.txt
git submodule update --init                        # Harvey в vendor/harvey
(cd frontend && npm install && npm run build)
cd backend && .venv/bin/python -m salespilot.seed  # опционально: демо-данные
.venv/bin/python -m salespilot                     # http://127.0.0.1:8000
```

UI с hot reload: `cd frontend && npm run dev` (порт 5173, `/api` проксируется на 8000).

Тесты:

```bash
cd backend && .venv/bin/python -m pytest -q    # 20 сценариев end-to-end через HTTP API
cd frontend && npm run typecheck
```

Те же проверки запускаются в GitHub Actions на каждый push.

</details>

## Что внутри

<table>
<tr>
<td width="50%"><img src="docs/screenshots/company.png" alt="Карточка компании"><br><sub><b>Объяснимый score.</b> Факторы, уверенность, недостающие данные, подбор продукта, факты с источниками</sub></td>
<td width="50%"><img src="docs/screenshots/email.png" alt="Письмо"><br><sub><b>Письмо с проверяемыми утверждениями.</b> Статусы, история версий, панель готовности к отправке</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/company-knockout.png" alt="Стоп-критерий"><br><sub><b>Стоп-критерии ICP.</b> 70 баллов, но отрасль вне ICP, поэтому лид не квалифицируется</sub></td>
<td><img src="docs/screenshots/analytics.png" alt="Аналитика"><br><sub><b>Analytics.</b> Воронка, конверсии, распределение score, реальные и демо-данные раздельно</sub></td>
</tr>
</table>

**7 агентов:** Scout → Research → Qualifier → Sales → Writer → 👤 Review → Sender → Reply Handler. Каждый запуск логируется.

**Экраны:** Dashboard · Кампании и ICP · Lead Discovery (поиск, фильтры, ручное добавление, CSV-импорт, дедупликация, экспорт) · Карточка компании · Outreach · Analytics · Настройки (режим, веса скоринга, согласование, продукты, do-not-contact, интеграции, логи агентов) · светлая и тёмная тема.

**Стек:** FastAPI · SQLite · pydantic · React 18 · TypeScript · Tailwind · Recharts.

## Demo mode и реальные провайдеры

По умолчанию всё внешнее выключено. Live-провайдеры включаются через `.env` (см. [`.env.example`](.env.example)) и переключатель Live mode в настройках:

| Функция | По умолчанию | Live (реализовано, на реальных данных не проверялось) |
|---|---|---|
| Поиск компаний | демо-датасет, CSV, вручную | не подключён |
| Исследование | демо-факты, ручной ввод | чтение публичных сайтов (`LIVE_RESEARCH_ENABLED`) |
| Writer | детерминированные шаблоны | Anthropic API (`LLM_PROVIDER=anthropic`, платно) |
| Отправка | симуляция | SMTP, только при выполнении всех 9 условий безопасности |
| Ответы | вставляются вручную и классифицируются | чтение почты не реализовано |

Сервер слушает только `127.0.0.1`: в MVP нет аутентификации.

## Основано на Harvey

Перед разработкой проведён аудит open-source агента [Harvey](https://github.com/ethanplusai/harvey) (MIT). Он подключён как git submodule в `vendor/harvey` и не модифицируется. Через адаптер [`harvey_adapter.py`](backend/salespilot/harvey_adapter.py) переиспользуются `tech_detect`, `public_http` (SSRF-защита), `untrusted.fence` (защита от prompt-injection) и `gate.do_not_contact`. Heartbeat-цикл, Claude CLI-рантайм и Gmail/Instantly не используются. Почему, описано в [ARCHITECTURE.md](ARCHITECTURE.md).

## Честно о данных

Все компании, факты и ссылки в демо-датасете вымышлены (домены в зарезервированной зоне `.test`), контактных лиц в нём нет. Продукт не запускался на реальных клиентах, поэтому реальные продажи, ответы и встречи не заявляются. Целевые метрики в кейсе являются допущениями для проверки.

## Структура

```
backend/salespilot/   API, агенты (service.py), скоринг, провайдеры, адаптер Harvey, seed
backend/tests/        pytest
frontend/src/         React-приложение
docs/                 кейс-презентация (GitHub Pages) и скриншоты
scripts/              make_screenshots.sh — пересъёмка скриншотов
vendor/harvey/        Harvey (submodule)
```

## Лицензия

[MIT](LICENSE). Harvey распространяется по собственной лицензии MIT (`vendor/harvey/LICENSE`).
