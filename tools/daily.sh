#!/usr/bin/env bash
# 每日数据更新链路（2026-10-21 固化）—— 严格按 docs/daily-task.md 顺序执行
# 用法：bash tools/daily.sh            # 全链路（含部署）
#       bash tools/daily.sh --no-deploy  # 只更新数据，不发布
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# 2026-10-23：互斥锁——每日任务与季度任务可能撞车（都写 data/），先到先跑，后来的直接跳过
LOCK="tmp/.mpf-job.lock"
mkdir -p tmp
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "另一个任务正在运行，等待其结束（最多 40 分钟）… $(date '+%F %T')"
  for i in $(seq 1 40); do
    sleep 60
    if mkdir "$LOCK" 2>/dev/null; then break; fi
    if [ "$i" = "40" ]; then echo "等待超时，本次跳过 $(date '+%F %T')"; exit 0; fi
  done
  echo "已获得锁，继续执行 $(date '+%F %T')"
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

PY="C:/Users/11718/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe"
# 2026-10-23：计划任务里 PATH 不含 node，显式加进来（否则 step1 报 node: command not found）
# 2026-10-23：计划任务的 Python 默认 GBK，打印 ✔ 会 UnicodeEncodeError（曾导致 step3 直接失败）
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1
NODE_DIR="C:/Users/11718/.workbuddy/binaries/node/versions/22.22.2-6"
case ":$PATH:" in *":$NODE_DIR:"*) ;; *) export PATH="$NODE_DIR:$PATH" ;; esac
command -v node >/dev/null 2>&1 || export PATH="/c/Users/11718/.workbuddy/binaries/node/versions/22.22.2-6:$PATH"
# 2026-10-26 修（阻断性）：write_ustat 用了 $NODE，但脚本只定义过 NODE_DIR →
# set -u 下首行即 "NODE: unbound variable" 退出（10-26 22:30 计划任务仅跑 2 秒）。
# 这里显式补上可执行的 node 路径（找不到时退回 NODE_DIR，仍找不到则不写状态文件）。
NODE="$(command -v node 2>/dev/null || true)"
[ -n "${NODE:-}" ] || NODE="$NODE_DIR/node.exe"
[ -x "$NODE" ] || [ -f "$NODE" ] || NODE=""
LOG="tmp/daily-$(date +%Y%m%d-%H%M).log"
mkdir -p tmp
exec > >(tee -a "$LOG") 2>&1
echo "=== 每日更新开始 $(date '+%F %T') ==="

# 2026-10-24：软步骤——抓取类步骤失败只记录，不中断整条链
# （曾因 bct_ffs_auto.py 退出码 130，导致后面的重算指标与推送全部没跑，线上当天没更新）
soft_step() {
  local n="$1"; shift
  echo ""
  echo "--- [$n] $* ---"
  write_ustat running "$n $*"
  "$@"
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "!!! [$n] 失败（退出码 $rc），已跳过，继续后续步骤"
  fi
  return 0
}

# 2026-10-26（用户要求）：更新进行中状态写盘 → /api/status → 前端顶部提示栏
USTAT="data/update-status.json"
write_ustat() {
  [ -n "${NODE:-}" ] || return 0
  "$NODE" -e "const fs=require('fs');try{fs.writeFileSync('$USTAT',JSON.stringify({phase:process.argv[1],step:process.argv[2],startedAt:process.argv[3]||undefined,finishedAt:process.argv[4]||undefined,host:'workbuddy'}))}catch(e){}" "$1" "$2" "${3:-}" "${4:-}" >/dev/null 2>&1 || true
}
USTART=$(date +%s)
USTARTH=$(date '+%H:%M')
write_ustat running "开始" "$USTARTH"

step() {
  local n="$1"; shift
  echo ""
  echo "--- [$n] $* ---"
  write_ustat running "$n $*"
  "$@"
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "!!! [$n] 失败（退出码 $rc），中止后续步骤，保留上次产物"
    write_ustat error "$n 失败：$*"
    exit $rc
  fi
}

# 2026-10-27：navbuild --render 可能卡死（实测 25 分钟无输出），加 1800s 硬超时，超时后继续后续步骤
soft_step "1/9 抓发行人最新净值" timeout 1800 node navbuild.js --render
# 2026-10-26 新增：富達独立兜底。navbuild 内嵌富達解析连续 3 天返回 0 只（页面恒 38KB），
# 而独立脚本 fetch-fidelity-hist.py 正常 → 固化进链路，避免每天靠人工补。
soft_step "1.2/9 富達历史（独立脚本兜底）" "$PY" fetch-fidelity-hist.py
soft_step "1.8/9 宏利历史增量" "$PY" fetch-manulife-hist.py
soft_step "2/9 etnet 日度补漏" "$PY" nav-etnet.py
soft_step "3/9 東亞日度历史" "$PY" fetch-bea-hist.py
# 2026-10-22 新增：其余发行人的历史序列近端补齐（近 10 天）。
# 原来只跑宏利/東亞，滙豐、中銀保誠、友邦、萬通、銀聯等 hist 会停在上一次运行日，
# 导出表就出现「前面有值、最后几格空白」。脚本内含快照合并，不会截断历史。
soft_step "3.5/9 各发行人历史近端补齐" bash tools/hist-topup.sh recent
soft_step "3.6/9 積金局新聞稿" "$PY" news_fetch.py
# 2026-10-26 新增：持仓写入事务——BCT / 资产分布两步会整条覆盖 holdings 条目，
# 解析退化（空名称/分布塌缩）过去要人工 diff 回滚，这里抓取前快照、写后自动判定并回滚。
node tools/holdings-txn.js save
soft_step "4/9 BCT 便览持仓" "$PY" bct_ffs_auto.py
soft_step "5/9 资产分布解析" "$PY" alloc_fill.py
node tools/holdings-txn.js check --restore || echo "!!! 持仓事务：已检测到退化并回滚到抓取前快照"
step "6/9 重算自算指标" node navperf.js
step "6.5/9 修正 n.a. 被写成 0 的字段" node tools/fix-nulls.js
step "7/9 指数补齐" node indexbuild.js
# 2026-10-24：merge-nav 必须在最后一次写 funds.json/hist 之后执行——
# 原先排在 1.5 位，后面步骤继续写档会覆盖对齐成果（核验 D08a：30 只净值与 hist 错位 1–2 天）
step "8/9 净值合并校准（最后写档后执行）" node tools/merge-nav.js
# 2026-10-24：链路末尾固化验收（不依赖 AI 纪律；核验 U01）
step "9/9 链路验收 nav-consistency" node tools/nav-consistency.js
soft_step "9.5/9 缺日检查" node tools/gap-check.js

echo ""
echo "=== 数据链路完成 $(date '+%F %T')；日志：$LOG ==="
if [ "${1:-}" = "--no-deploy" ]; then
  echo "（--no-deploy：跳过发布）"
  exit 0
fi

# 2026-10-26 新增：推送数据到 GitHub（视为「发布」的一部分，故放在 --no-deploy 之后）。
# 原因：GitHub Actions 的 schedule 自建仓以来从未触发（近 30 次运行全是 push 事件），
# 云端站点会一直停在上一次手工推送的数据。这里以本机为权威源兜底推送，
# push 事件本身会触发 Pages 构建；若云端 schedule 日后恢复，双方数据一致时本步自动跳过。
soft_step "10/10 同步数据到 GitHub" bash tools/sync-github.sh
echo "下一步：发布（由调用方执行 workbuddy_sites_deploy）"

# 2026-10-26：更新结束状态（提示栏收起）
UEND=$(date +%s)
write_ustat done "全部完成" "" "$(date '+%H:%M')"
