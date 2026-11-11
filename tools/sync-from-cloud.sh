#!/usr/bin/env bash
# sync-from-cloud.sh —— 把本機 data/ 對齊到 GitHub 倉庫最新一次提交（雲端 22:40 那班）
#
# 為什麼（2026-11-11 用戶要求「兩個站點完全同步」）：
#   兩個站各自抓一次（本機 22:30 / 雲端 22:40），資料只能「大致相同」，
#   遇到剛好在這 10 分鐘內發布的發行人就會差一天。
#   這裡在每日任務結束後，把倉庫裡最新的 data/ 取過來當唯一版本，
#   再用同一份資料部署 WorkBuddy 站 → 兩站逐欄相同。
#
# 安全：只覆寫 data/（不含 git 忽略的 upload-token.txt 等本地檔）；
#       倉庫版本不比本機新時不動作（KEEP）。
#
# 用法：bash tools/sync-from-cloud.sh [--force]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FORCE=""
[ "${1:-}" = "--force" ] && FORCE="1"

git rev-parse --git-dir >/dev/null 2>&1 || { echo "FATAL 不是 git 倉庫，跳過同步"; exit 1; }

timeout 120 git fetch origin main --quiet 2>/dev/null || { echo "FATAL 拉取遠端失敗（網路？），保留本機資料"; exit 1; }

LOCAL_META=$(node tools/_funds-meta.js data/funds.json)
ORIGIN_META=$(git show origin/main:data/funds.json 2>/dev/null | node tools/_funds-meta.js)
[ -n "${ORIGIN_META:-}" ] || ORIGIN_META="0|-|-|0"

L_TS=${LOCAL_META%%|*}
O_TS=${ORIGIN_META%%|*}
L_REST=${LOCAL_META#*|}
O_REST=${ORIGIN_META#*|}

fmt() { date -d "@$(( $1 / 1000 ))" '+%F %T' 2>/dev/null || echo "$1"; }
echo "本機  版本 $(fmt "$L_TS")　資料 ${L_REST//|/ · }"
echo "倉庫  版本 $(fmt "$O_TS")　資料 ${O_REST//|/ · }"

if [ -z "$FORCE" ] && [ "${O_TS:-0}" -le $((L_TS + 30000)) ]; then
  echo "KEEP 倉庫版本不比本機新，保留本機資料"
  exit 0
fi

BK="tmp/data-before-sync-$(date +%Y%m%d-%H%M).tar"
mkdir -p tmp
tar -cf "$BK" data 2>/dev/null && echo "已備份 data/ → $BK"
git checkout origin/main -- data || { echo "FATAL 取出倉庫資料失敗"; exit 1; }
echo "TAKEN 已改用倉庫版本：$(node tools/_funds-meta.js data/funds.json | cut -d'|' -f4) 隻 / $(node tools/_funds-meta.js data/funds.json | cut -d'|' -f2)"
exit 0
