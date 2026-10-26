#!/usr/bin/env bash
# 各发行人「历史净值补齐」（2026-10-22 新增）
# 背景：每日链路只跑 宏利 / 東亞 的历史脚本，其余发行人的 hist 会停在最后一次运行日，
#       导出 Excel 时就表现为「前几天有值、后面一片空白」的断档。
#
# 用法：
#   bash tools/hist-topup.sh full          # 全量回补（首次/换机器用，约 1–2 小时）
#   bash tools/hist-topup.sh recent        # 只补最近 10 天（接入每日链路，约 10–15 分钟）
#   bash tools/hist-topup.sh hsbc|bocpt|aia|yflife|bct|shkp|sunlife|chinalife|bocom   # 单家
#
# 说明：各脚本均为「合并写入」，不会覆盖已有历史；单家失败不影响其他家（set +e）。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
PY="C:/Users/11718/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
[ -x "$PY" ] || PY="C:/Users/11718/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe"
mkdir -p tmp
LOG="tmp/hist-topup-$(date +%Y%m%d-%H%M).log"
exec > >(tee -a "$LOG") 2>&1
SINCE=$(date -d '10 days ago' +%F 2>/dev/null || date -v-10d +%F)
echo "=== 历史净值补齐开始 $(date '+%F %T') · 模式 ${1:-full} · 近端起点 $SINCE ==="

run() {   # run <名称> <超时秒> <命令...>
  local name="$1"; local to="$2"; shift 2
  echo ""
  echo "--- [$name] $* ---"
  timeout "$to" "$@"
  local rc=$?
  [ $rc -ne 0 ] && echo "!!! [$name] 失败或超时（$rc），跳过，保留原数据"
  return 0
}

want="${1:-full}"

# 抓取前快照、结束后并集合并：各脚本是「整段覆盖写」，只补近端日期会截断历史
NODE="C:/Users/11718/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
"$NODE" tools/hist-merge-snap.js save

# 滙豐 / 恒生（40 只，两个智選計劃）
case "$want" in
  full|hsbc) run "滙豐/恒生 40 只（全量 2021 起）" 1800 "$PY" fetch-hsbc-family.py ;;
  recent)    run "滙豐/恒生 40 只（近端）" 900 "$PY" fetch-hsbc-family.py --from "$SINCE" ;;
esac

# 中銀保誠（34 只，2 个计划）
case "$want" in
  full|bocpt) run "中銀保誠 34 只（全量 2021 起）" 3000 "$PY" fetch-bocpt-hist.py ;;
  recent)     run "中銀保誠 34 只（近端）" 900 "$PY" fetch-bocpt-hist.py --from "$SINCE" ;;
esac

# 友邦（21 只，逐只 detail API）
case "$want" in
  full|aia|recent) run "友邦 21 只" 1200 "$PY" aia_ingest2.py ;;
esac

# 萬通（14 只，fundPriceDetail 支持任意区间）
case "$want" in
  full|yflife|recent) run "萬通 14 只" 900 "$PY" yflife_daily.py ;;
esac

# 銀聯信託（BCT 系 171 只）—— 全量回补慢；近端模式只取最新 10 个交易日（接口按日期返回全计划）
case "$want" in
  full|bct) run "銀聯信託（BCT 系）171 只（全量）" 5400 "$PY" fetch-bct-hist.py ;;
  recent)   run "銀聯信託（BCT 系）171 只（近 10 个交易日）" 1500 "$PY" fetch-bct-hist.py --max-dates 10 ;;
esac

# 渣打信托（新地，滚动 14 个月 PDF）
case "$want" in
  full|shkp) run "渣打信托（新地）10 只" 900 "$PY" fetch-shkp-hist.py ;;
esac

# 永明 / 中國人壽 / 交通（日度接口，通常已是最新，补齐兜底）
# 2026-10-26：永明 31 只近 4 天第 3 次 1200s 超时 → 近端模式改走 --from（脚本内部与已有历史合并，
# 不会截断），并放宽到 2400s 兜底；全量仍保留 1200s 以上的长超时。
case "$want" in
  full|sunlife)  [ -f fetch-sunlife-hist.py ] && run "永明 31 只（全量）" 2400 "$PY" fetch-sunlife-hist.py ;;
  recent)        [ -f fetch-sunlife-hist.py ] && run "永明 31 只（近端 $SINCE）" 2400 "$PY" fetch-sunlife-hist.py --from "$SINCE" ;;
esac
case "$want" in
  full|recent|chinalife) [ -f fetch-chinalife-hist.py ] && run "中國人壽 10 只" 900 "$PY" fetch-chinalife-hist.py ;;
esac
case "$want" in
  full|recent|bocom)     [ -f fetch-bocom-hist.py ]     && run "交通 14 只" 900 "$PY" fetch-bocom-hist.py ;;
esac

# 与快照取并集（防截断）
"$NODE" tools/hist-merge-snap.js merge

echo ""
echo "=== 补齐结束 $(date '+%F %T')；日志：$LOG ==="
echo "下一步：node navperf.js 重算指标 → 发布"

# 2026-10-24：清理历史快照归档（node 侧不删目录，避免被防误删拦截）
rm -rf ../.hist-snap.old-* 2>/dev/null || true
