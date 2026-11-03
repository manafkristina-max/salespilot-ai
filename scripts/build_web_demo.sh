#!/usr/bin/env bash
# Собрать сайт для GitHub Pages: лендинг (docs/) в корне и онлайн-демо в /app/.
# Онлайн-демо — это обычный интерфейс + backend.zip, который выполняется в браузере
# на Pyodide. Использование: scripts/build_web_demo.sh [папка-результата, по умолчанию _site]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

cp -R docs/. "$OUT/"
(cd frontend && [ -d node_modules ] || npm ci --no-fund --no-audit --loglevel=error)
(cd frontend && VITE_STATIC_DEMO=1 npm run build --silent -- --outDir "$OUT/app" --emptyOutDir >/dev/null)

[ -f vendor/harvey/harvey/__init__.py ] || git submodule update --init vendor/harvey
rm -f "$OUT/app/backend.zip"
zip -qr "$OUT/app/backend.zip" backend/salespilot -x '*__pycache__*'
(cd vendor/harvey && zip -qr "$OUT/app/backend.zip" LICENSE harvey/__init__.py harvey/untrusted.py \
  harvey/gate.py harvey/public_http.py harvey/integrations/__init__.py harvey/integrations/tech_detect.py)
touch "$OUT/.nojekyll"
echo "✓ Сайт собран: $OUT (лендинг: index.html, онлайн-демо: app/)"
