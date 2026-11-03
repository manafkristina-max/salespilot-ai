#!/usr/bin/env bash
# SalesPilot AI: установка (при первом запуске), сборка интерфейса и запуск.
#
#   ./start.sh            запустить (данные сохраняются между запусками)
#   ./start.sh --demo     то же, а при пустой базе сначала создать демо-кампанию
#   ./start.sh --reset    сохранить текущую базу в data/backups/ и начать с чистого демо
#   ./start.sh --live     настоящий агент: поиск компаний в Wikidata, чтение их сайтов,
#                         анализ и письма через Claude (ваша подписка Claude Code)
#   ./start.sh --no-open  не открывать браузер автоматически
#
# Порт: SALESPILOT_PORT=8010 ./start.sh   Остановка: Ctrl+C
set -euo pipefail
cd "$(dirname "$0")"

DEMO=0; RESET=0; OPEN=1; LIVE=0
for arg in "$@"; do
  case "$arg" in
    --demo) DEMO=1 ;;
    --reset) RESET=1; DEMO=1 ;;
    --no-open) OPEN=0 ;;
    --live) LIVE=1 ;;
    -h|--help) sed -n 2,11p "$0"; exit 0 ;;
    *) echo "Неизвестный параметр: $arg (см. ./start.sh --help)"; exit 2 ;;
  esac
done

PORT="${SALESPILOT_PORT:-8000}"
URL="http://127.0.0.1:$PORT"
DB="data/salespilot.db"

PY=""
for c in python3.13 python3.12 python3.11 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "✗ Нужен Python 3.11+. На macOS: brew install python@3.13"; exit 1; }
command -v npm >/dev/null || { echo "✗ Нужен Node.js 18+: https://nodejs.org или brew install node"; exit 1; }

if command -v lsof >/dev/null && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -fs "$URL/api/health" 2>/dev/null | grep -q '"ok":true'; then
    if [ "$RESET" = 1 ]; then
      echo "✗ SalesPilot уже запущен на $URL. Остановите его (Ctrl+C) и повторите --reset,"
      echo "  или нажмите «Сбросить демо-данные» в разделе Настройки."
      exit 1
    fi
    echo "✓ SalesPilot уже запущен: $URL"
    [ "$OPEN" = 1 ] && command -v open >/dev/null && open "$URL"
    exit 0
  fi
  echo "✗ Порт $PORT занят другой программой. Запустите на другом порту: SALESPILOT_PORT=8010 ./start.sh"
  exit 1
fi

# Python-зависимости: при первом запуске и при изменении requirements.txt
if [ ! -x backend/.venv/bin/python ]; then
  echo "→ Создаю виртуальное окружение ($PY)…"
  "$PY" -m venv backend/.venv
fi
if [ ! -f backend/.venv/.installed ] || [ backend/requirements.txt -nt backend/.venv/.installed ]; then
  echo "→ Устанавливаю зависимости backend…"
  backend/.venv/bin/pip install -q --disable-pip-version-check -r backend/requirements.txt
  touch backend/.venv/.installed
fi

# Harvey (MIT) — git submodule; для ZIP-архива без .git клонируется отдельно
if [ ! -f vendor/harvey/harvey/__init__.py ]; then
  echo "→ Загружаю Harvey в vendor/harvey…"
  git submodule update --init vendor/harvey 2>/dev/null \
    || git clone -q https://github.com/ethanplusai/harvey.git vendor/harvey
fi

# Интерфейс: при первом запуске и если исходники новее сборки
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/package.json frontend/index.html -newer frontend/dist/index.html 2>/dev/null | head -1)" ]; then
  echo "→ Собираю интерфейс…"
  (cd frontend
   if [ ! -f node_modules/.sp-installed ] || [ package-lock.json -nt node_modules/.sp-installed ]; then
     npm ci --no-fund --no-audit --loglevel=error && touch node_modules/.sp-installed
   fi
   npm run build --silent >/dev/null)
fi

if [ "$RESET" = 1 ] && [ -f "$DB" ]; then
  mkdir -p data/backups
  BK="data/backups/salespilot-$(date +%Y%m%d-%H%M%S).db"
  mv "$DB" "$BK"; rm -f "$DB-wal" "$DB-shm"
  echo "→ Прежняя база сохранена: $BK"
fi
if [ "$DEMO" = 1 ] && [ ! -f "$DB" ]; then
  echo "→ Создаю демо-кампанию…"
  if ! (cd backend && .venv/bin/python -m salespilot.seed --full); then
    rm -f "$DB" "$DB-wal" "$DB-shm"
    echo "✗ Не удалось создать демо-данные (ошибка выше). База не создана, можно запустить повторно."
    exit 1
  fi
fi

if [ "$LIVE" = 1 ]; then
  export SALESPILOT_MODE=live LIVE_DISCOVERY_ENABLED=true LIVE_RESEARCH_ENABLED=true LLM_PROVIDER=claude_cli
  # A VPN in fake-IP/TUN mode (Happ, Clash, sing-box…) resolves every site to 198.18.x.x,
  # which the SSRF guard blocks. Allow only that range, and only when it is really in use.
  if backend/.venv/bin/python -c 'import socket,sys; sys.exit(0 if socket.gethostbyname("wikidata.org").startswith(("198.18.","198.19.")) else 1)' 2>/dev/null; then
    export SALESPILOT_ALLOW_VPN_FAKE_IP=true
    echo "→ Обнаружен VPN с подменой DNS (адреса 198.18.x.x): разрешаю только этот диапазон для чтения сайтов."
  fi
  if command -v claude >/dev/null; then
    echo "→ Рабочий режим: Wikidata + чтение сайтов + Claude (подписка Claude Code)."
    echo "  Если Claude попросит вход, выполните в терминале: claude"
  else
    echo "→ Рабочий режим без Claude: claude не найден, факты и письма — по правилам и шаблонам."
  fi
  echo "  Реальные письма не отправляются: только черновики на вашу проверку."
fi

echo ""
echo "✓ SalesPilot AI: $URL"
echo "  Остановка: Ctrl+C"
echo ""
if [ "$OPEN" = 1 ] && command -v open >/dev/null; then
  ( for _ in $(seq 1 40); do curl -fs "$URL/api/health" >/dev/null 2>&1 && { open "$URL"; break; }; sleep 0.25; done ) &
fi
cd backend
SALESPILOT_PORT="$PORT" exec .venv/bin/python -m salespilot
