#!/usr/bin/env bash
# 交易日早晨「仅净值」更新（2026-10-27 新增）
# 用途：北京时间 09:40 再跑一次，补上「前一晚 22:30 之后到今早」发行人新发布的单位净值与自算指标。
# 范围：只抓净值渠道 + 重算自算指标；**不更新**指数、新闻、持仓、积金局月度档案。
# 用法：bash tools/morning-nav.sh [--sync]    # 默认不推 GitHub（两站独立更新）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

LOCK="tmp/.mpf-job.lock"
mkdir -p tmp
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "另一个任务正在运行（$LOCK），本次跳过 $(date '+%F %T')"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

PY="C:/Users/11718/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe"
NODE_DIR="C:/Users/11718/.workbuddy/binaries/node/versions/22.22.2-6"
case ":$PATH:" in *":$NODE_DIR:"*) ;; *) export PATH="$NODE_DIR:$PATH" ;; esac
command -v node >/dev/null 2>&1 || export PATH="/c/Users/11718/.workbuddy/binaries/node/versions/22.22.2-6:$PATH"
NODE="$(command -v node 2>/dev/null || true)"
[ -n "${NODE:-}" ] || NODE="$NODE_DIR/node.exe"
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

LOG="tmp/morning-$(date +%Y%m%d-%H%M).log"
exec > >(tee -a "$LOG") 2>&1
SINCE=$(date -d '10 days ago' +%F 2>/dev/null || date -v-10d +%F)
YMSINCE=$(date -d '10 days ago' +%Y-%m 2>/dev/null || date -v-10d +%Y-%m)
echo "=== 早晨净值更新开始 $(date '+%F %T') · 近端起点 $SINCE ==="

# 2026-10-28：与每日链路一致，把「更新中/完成/失败」写到 data/update-status.json，
# 前端顶部提示条据此显示（此前早晨任务不写状态，用户看不到任何提示）
USTAT="data/update-status.json"
write_ustat() {
  [ -n "${NODE:-}" ] || return 0
  "$NODE" -e "const fs=require('fs');try{fs.writeFileSync('$USTAT',JSON.stringify({phase:process.argv[1],step:process.argv[2],startedAt:process.argv[3]||undefined,finishedAt:process.argv[4]||undefined,host:'workbuddy'}))}catch(e){}" "$1" "$2" "${3:-}" "${4:-}" >/dev/null 2>&1 || true
}
write_ustat running "早晨净值更新：启动" "$(date '+%H:%M')"

soft() { local n="$1"; shift; echo ""; echo "--- [$n] $* ---"; write_ustat running "$n"; "$@"; local rc=$?; if [ $rc -ne 0 ]; then echo "!!! [$n] 失败（$rc），跳过"; write_ustat error "$n 失败（$rc）"; fi; return 0; }

# 1) 发行人官网快照（今日净值）
# 2026-10-27：实测 navbuild --render 可能卡在某个发行人页面（无输出、无限等待）。
# 加硬超时 25 分钟；超时后继续跑后续 hist 渠道（净值主来源），不至于整条链挂死。
# 紧急/无人值守场景可设 SKIP_NAVBUILD=1 直接跳过。
if [ "${SKIP_NAVBUILD:-0}" = "1" ]; then
  echo "（SKIP_NAVBUILD=1：跳过官网快照）"
else
  soft "1 官网快照" timeout 1500 node navbuild.js --render
fi
# 2) 各渠道近端历史（只补近 10 天）
soft "2 宏利" "$PY" fetch-manulife-hist.py
soft "3 東亞" "$PY" fetch-bea-hist.py
soft "4 富達" "$PY" fetch-fidelity-hist.py
soft "5 永明" "$PY" fetch-sunlife-hist.py --from "$SINCE"
soft "6 滙豐/恒生" "$PY" fetch-hsbc-family.py --from "$SINCE"
soft "7 中銀保誠" "$PY" fetch-bocpt-hist.py --from "$SINCE"
soft "8 交通" "$PY" fetch-bocom-hist.py
soft "9 中國人壽" "$PY" fetch-chinalife-hist.py
soft "10 友邦" "$PY" aia_ingest2.py
soft "11 新地" "$PY" fetch-shkp-hist.py
soft "12 萬通" "$PY" yflife_daily.py
soft "13 海通" "$PY" ht_daily.py
soft "14 BCT 净值" "$PY" tools/bct-recent.py

# 3) 自算指标与校准（与每日链路同口径）
write_ustat running "重算自算指标"
node navperf.js || { echo "!!! navperf 失败，中止"; write_ustat error "navperf 失败"; exit 1; }
node tools/fix-nulls.js || true
node tools/merge-nav.js || { echo "!!! merge-nav 失败，中止"; exit 1; }
node tools/nav-consistency.js || echo "!!! nav-consistency 未通过（详见输出）"
node tools/gap-check.js || true

echo ""
write_ustat done "早晨净值更新完成" "" "$(date '+%H:%M')"
echo "=== 早晨净值更新完成 $(date '+%F %T')；日志：$LOG ==="
# 2026-10-28：两站独立更新 —— 本机链路只负责 WorkBuddy 站，不再向 GitHub 推数据。
# GitHub 侧由云端 09:40 / 22:40 自行抓取并发布，避免两条链路同时写 data/*.json 打架。
# 需要人工兜底推送时显式加 --sync。
if [ "${1:-}" = "--sync" ]; then
  echo "（--sync：手动推送 GitHub）"
  soft "15 同步 GitHub" bash tools/sync-github.sh
else
  echo "（已跳过 GitHub 推送：两站独立更新；确需推送加 --sync）"
fi
echo "下一步：发布 WorkBuddy 站（由调用方执行 workbuddy_sites_deploy）"
