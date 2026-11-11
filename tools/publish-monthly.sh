#!/usr/bin/env bash
# publish-monthly.sh —— 本機 OCR 出的積金局月度統計若比倉庫新，單檔提交並推送
#
# 為什麼需要（2026-11-11）：
#   月度統計靠 OCR 產出。雲端 1–12 日也會跑，但 GH runner 需要臨時 pip 安裝 OCR，
#   失敗機率比本機高；一旦雲端失手，GitHub 站就會停在舊月份，兩站不一致。
#   所以本機跑出更新的一期時，把這**一個檔案**提交推上去，雲端下次構建就會帶上。
#
# 安全：
#   · 只 add 一個檔案，不動其他改動；
#   · 只有本地 asOf 嚴格新於倉庫時才提交；
#   · 推送失敗（衝突/離線）只告警，不影響主流程；
#   · 提交信息帶 [skip ci]，避免為一個 JSON 觸發整條抓取鏈（下次定時構建自然帶上）。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

FILE="data/mpfa-monthly.json"
[ -f "$FILE" ] || { echo "SKIP 沒有 $FILE"; exit 0; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "SKIP 非 git 倉庫"; exit 0; }

L_ASOF=$(node -e "try{console.log(require('./data/mpfa-monthly.json').asOf||'')}catch(e){console.log('')}")
[ -n "$L_ASOF" ] || { echo "SKIP 本地無 asOf"; exit 0; }

timeout 60 git fetch origin main --quiet 2>/dev/null || echo "WARN 拉取遠端失敗，仍嘗試以本地狀態比較"
R_ASOF=$(git show origin/main:data/mpfa-monthly.json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).asOf||'')}catch(e){console.log('')}})")

if [ -n "$R_ASOF" ] && [ ! "$L_ASOF" \> "$R_ASOF" ]; then
  echo "SKIP 倉庫 $R_ASOF 不舊於本地 $L_ASOF"
  exit 0
fi

git add "$FILE" || { echo "WARN git add 失敗"; exit 1; }
if git diff --cached --quiet -- "$FILE"; then
  echo "SKIP 內容與倉庫相同"
  exit 0
fi
git -c core.hooksPath=/dev/null commit -q -m "data: 積金局月度統計 ${L_ASOF}（本機 OCR）[skip ci]" || { echo "WARN 提交失敗"; exit 1; }
for i in 1 2 3; do
  if timeout 90 git push origin HEAD:main 2>/dev/null; then
    echo "PUSHED 月度統計 ${L_ASOF} 已推送（雲端下次構建帶上）"
    exit 0
  fi
  git fetch origin main --quiet 2>/dev/null || true
  git rebase --autostash origin/main 2>/dev/null || git rebase --abort 2>/dev/null || true
done
echo "WARN 推送失敗（保留本地提交，下次再試）"
exit 0
