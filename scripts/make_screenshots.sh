#!/usr/bin/env bash
# Перегенерировать docs/screenshots/*.png из чистой демо-базы.
# Требуется Google Chrome (macOS). Запускает сервер на отдельной временной базе.
set -euo pipefail
cd "$(dirname "$0")/.."
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"; export SALESPILOT_DB="$TMP/demo.db" SALESPILOT_PORT=8765
(cd backend && .venv/bin/python -m salespilot.seed --full)
(cd backend && exec .venv/bin/python -m salespilot) & PID=$!; trap 'kill $PID; rm -rf "$TMP"' EXIT
sleep 3
B="http://127.0.0.1:$SALESPILOT_PORT"
V=$(curl -s "$B/api/companies?search=Velora" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
shot(){ "$CH" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$TMP/chrome" --window-size=1440,$3 \
  --force-device-scale-factor=2 --virtual-time-budget=4000 --screenshot="docs/screenshots/$1.png" "$B$2" >/dev/null 2>&1; }
mkdir -p docs/screenshots
shot dashboard "/" 900
shot campaign "/campaigns/1" 1250
shot leads "/leads" 900
shot company "/companies/1" 1500
shot company-knockout "/companies/$V" 1100
shot email "/outreach/1" 1300
shot outreach "/outreach" 700
shot analytics "/analytics" 900
shot settings "/settings" 1300
shot dashboard-dark "/?theme=dark" 900
shot company-dark "/companies/1?theme=dark" 1000
echo "Готово: docs/screenshots"
