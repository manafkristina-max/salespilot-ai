#!/usr/bin/env bash
# SalesPilot AI: установка (при первом запуске), сборка UI и запуск на http://127.0.0.1:8000
#   ./start.sh          — запустить
#   ./start.sh --demo   — при пустой базе сначала заполнить её демо-кампанией
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for c in python3.13 python3.12 python3.11 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "Нужен Python 3.11+ (macOS: brew install python@3.13)"; exit 1; }
command -v npm >/dev/null || { echo "Нужен Node.js 18+ (https://nodejs.org)"; exit 1; }

if [ ! -x backend/.venv/bin/python ]; then
  echo "→ Создаю виртуальное окружение ($PY)…"
  "$PY" -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi

if [ ! -f vendor/harvey/harvey/__init__.py ]; then
  echo "→ Загружаю Harvey (MIT) в vendor/harvey…"
  git submodule update --init vendor/harvey 2>/dev/null \
    || git clone https://github.com/ethanplusai/harvey.git vendor/harvey
fi

if [ ! -f frontend/dist/index.html ] || [ "${REBUILD:-0}" = "1" ]; then
  echo "→ Собираю интерфейс…"
  (cd frontend && npm install --no-fund --no-audit && npm run build)
fi

cd backend
if [ "${1:-}" = "--demo" ] && [ ! -f ../data/salespilot.db ]; then
  .venv/bin/python -m salespilot.seed
fi
echo "→ SalesPilot AI: http://127.0.0.1:8000  (остановка: Ctrl+C)"
exec .venv/bin/python -m salespilot
