#!/usr/bin/env bash
# 抓取 4 页渲染后 DOM（供 regcheck.js 使用）
# 2026-10-21：从 tmp/ 移到 tools/，避免「清 tmp」时被误删。
# 用法：bash tools/regdump.sh http://127.0.0.1:3999
set -u
BASE="${1:-http://127.0.0.1:3012}"
CHROME="${CHROME_PATH:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
DIR="$(cd "$(dirname "$0")" && pwd)/../tmp/reg"
mkdir -p "$DIR"

for pair in "home:/" "index:/index.html" "ranking:/index.html?rk=ann1" "analysis:/analysis.html"; do
  name="${pair%%:*}"
  page="${pair#*:}"
  profile="D:\\2026-10-08-11-05-17\\mpf-app\\tmp\\reg\\p_${name}"
  rm -rf "$DIR/p_${name}"
  timeout 120 "$CHROME" --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars \
    --virtual-time-budget=15000 --window-size=1440,3000 --dump-dom \
    --user-data-dir="$profile" "${BASE}${page}" > "$DIR/${name}.html" 2>/dev/null
  echo "  ${name}  $(wc -c < "$DIR/${name}.html") bytes"
done

rm -rf "$DIR"/p_*
