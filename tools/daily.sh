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
# 2026-11-22（用户要求）：各步骤耗时流水，收尾时出「最慢前 3 名」
STEP_TIMES="tmp/step-times-$(date +%Y%m%d).tsv"
: > "$STEP_TIMES" 2>/dev/null || true
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
  local t0; t0=$(date +%s)          # 2026-11-05：记每步耗时，便于定位瓶颈
  "$@"
  local rc=$?
  local dt=$(( $(date +%s) - t0 ))
  echo "    [耗时 ${dt}s]"
  echo "$n|$dt|$rc" >> "$STEP_TIMES"
  if [ $rc -ne 0 ]; then
    echo "!!! [$n] 失败（退出码 $rc），已跳过，继续后续步骤"
  fi
  return 0
}

# 2026-10-26（用户要求）：更新进行中状态写盘 → /api/status → 前端顶部提示栏
USTAT="data/update-status.json"
write_ustat() {
  [ -n "${NODE:-}" ] || return 0
  # 2026-11-05：补 day 字段（YYYY-MM-DD）——前端要判断「这条完成状态是不是今天的」，
  # 否则昨天/上一轮的 done 会让「更新窗口」提示一直挂着。
  "$NODE" -e "const fs=require('fs');try{fs.writeFileSync('$USTAT',JSON.stringify({phase:process.argv[1],step:process.argv[2],startedAt:process.argv[3]||undefined,finishedAt:process.argv[4]||undefined,day:process.argv[5],host:'workbuddy'}))}catch(e){}" "$1" "$2" "${3:-}" "${4:-}" "$(date '+%F')" >/dev/null 2>&1 || true
  # 2026-11-19（8.0）：同时推到 A 站（失败静默），线上顶部提示栏才能实时显示「正在更新」
  ( "$NODE" tools/push-status.js >/dev/null 2>&1 & ) || true
}
# 2026-11-21（用户要求）：周六源站不发布净值，全量班纯耗积分 —— 直接退出。
# 周日晚上照常跑全量；MPF_FORCE=1 可强制（补数据、修 bug 时用）。
if [ "$(date +%u)" = "6" ] && [ "${MPF_FORCE:-0}" != "1" ]; then
  echo "[$(date '+%F %H:%M')] 周六不更新（源站不发布净值），退出"
  "$NODE" tools/daily-log.js >/dev/null 2>&1 || true
  exit 0
fi

USTART=$(date +%s)
USTARTH=$(date '+%H:%M')
write_ustat running "开始" "$USTARTH"

step() {
  local n="$1"; shift
  echo ""
  echo "--- [$n] $* ---"
  write_ustat running "$n $*"
  local t0; t0=$(date +%s)
  "$@"
  local rc=$?
  local dt=$(( $(date +%s) - t0 ))
  echo "    [耗时 ${dt}s]"
  echo "$n|$dt|$rc" >> "$STEP_TIMES"
  if [ $rc -ne 0 ]; then
    echo "!!! [$n] 失败（退出码 $rc），中止后续步骤，保留上次产物"
    write_ustat error "$n 失败：$*"
    exit $rc
  fi
}

# 2026-11-21（用户要求）：无变化短路——先记净值指纹，抓完比对；
# 完全没变化就跳过后续派生重算与发布，避免「0 更新的班次」白烧时间与积分。
NAVSIG_BEFORE=$("$NODE" -e "const f=require('./data/funds.json').funds;const s=f.map(x=>x.id+':'+x.nav+':'+x.navAsOf).join('|');console.log(require('crypto').createHash('md5').update(s).digest('hex'))" 2>/dev/null || echo "")

# 2026-11-05（第四十轮，用户要求）：下面四家互相独立（各写自己的 hist，共享索引已是加锁 + 原子写入），
# 改成同一波并行。原先串行合计约 10 分钟，并行后由最慢的一家决定（约 3–4 分钟）。
# 注意：必须排在 navbuild 之后 —— 这四个脚本都要读 navbuild 刚写出的 funds.json 做映射。
PAR_DIR="tmp/par-daily-$$"
mkdir -p "$PAR_DIR"
: > "$PAR_DIR/jobs"
par() {
  local n="$1"; shift
  local safe; safe=$(printf '%s' "$n" | tr ' /' '__')
  echo ""; echo "--- [$n] $* ---"
  write_ustat running "$n"
  ( "$@"; echo $? > "$PAR_DIR/$safe.rc"; date +%s > "$PAR_DIR/$safe.end" ) > "$PAR_DIR/$safe.log" 2>&1 &
  echo "$n|$safe|$!|$(date +%s)" >> "$PAR_DIR/jobs"
}
wait_par() {
  while IFS='|' read -r n safe pid t0; do
    [ -n "${pid:-}" ] || continue
    wait "$pid"
    local rc t1
    rc=$(cat "$PAR_DIR/$safe.rc" 2>/dev/null || echo '?')
    t1=$(cat "$PAR_DIR/$safe.end" 2>/dev/null || date +%s)
    echo "    [$n] 完成：$(( t1 - t0 ))s，退出码 $rc"
    sed 's/^/    /' "$PAR_DIR/$safe.log" 2>/dev/null | tail -12
    if [ "$rc" != "0" ]; then echo "!!! [$n] 失败（$rc），已跳过，继续后续步骤"; fi
  done < "$PAR_DIR/jobs"
  : > "$PAR_DIR/jobs"
}

# 2026-10-26 新增：富達独立兜底。navbuild 内嵌富達解析连续 3 天返回 0 只（页面恒 38KB），
# 而独立脚本 fetch-fidelity-hist.py 正常 → 固化进链路，避免每天靠人工补。
par "1.2/9 富達历史" "$PY" fetch-fidelity-hist.py
par "1.8/9 宏利历史" "$PY" fetch-manulife-hist.py
par "2/9 etnet 补漏" "$PY" nav-etnet.py
par "3/9 東亞历史"   "$PY" fetch-bea-hist.py
wait_par
rm -f "$PAR_DIR"/*.log "$PAR_DIR"/*.rc "$PAR_DIR"/*.end 2>/dev/null; rmdir "$PAR_DIR" 2>/dev/null || true
# 2026-10-22 新增：其余发行人的历史序列近端补齐（近 10 天）。
# 原来只跑宏利/東亞，滙豐、中銀保誠、友邦、萬通、銀聯等 hist 会停在上一次运行日，
# 导出表就出现「前面有值、最后几格空白」。脚本内含快照合并，不会截断历史。
soft_step "3.5/9 各发行人历史近端补齐" bash tools/hist-topup.sh recent
# 2026-11-22（用户要求）：净值构建挪到历史抓取之后 —— 永明/富達/海通/宏利的净值直接取
# API 历史序列（hist/*.json），必须先跑完上面的 par 与 3.5，否则拿到的是昨天的值。
# 2026-11-22（用户要求：提速降耗）：周日净值源站不更新，若库里已经是上周五的净值，
# 就不再重渲染 20 个官网页面（实测可省 20+ 分钟）。MPF_FORCE=1 可强制抓取。
SKIP_NAV="${MPF_SKIP_NAV:-0}"
if [ "$(date +%u)" = "7" ] && [ "${MPF_FORCE:-0}" != "1" ]; then
  LAST_FRI=$(date -d 'last friday' +%F 2>/dev/null || echo "")
  NAVL=$("$NODE" -e "const f=require('./data/funds.json').funds;let m='';f.forEach(x=>{if(x.navAsOf&&x.navAsOf>m)m=x.navAsOf});console.log(m)" 2>/dev/null || echo "")
  if [ -n "$LAST_FRI" ] && [ -n "$NAVL" ] && { [ "$NAVL" \> "$LAST_FRI" ] || [ "$NAVL" = "$LAST_FRI" ]; }; then
    SKIP_NAV=1
    echo "周日且净值已是上周五（$NAVL），跳过净值重渲染（省时省积分）"
  fi
fi
if [ "$SKIP_NAV" = "1" ]; then
  echo "--- [1/9 抓发行人最新净值] 跳过（复用周五数据） ---"
else
  # 2026-10-27：navbuild --render 可能卡死（实测 25 分钟无输出），加 1800s 硬超时，超时后继续后续步骤
  # 2026-11-22：拆成「渲染 → 解析」两段 —— 渲染超时也不会丢掉“用现有快照重建”的机会
  soft_step "1/9 抓发行人最新净值（渲染）" timeout 1500 node navbuild.js --render-only
  soft_step "1.02/9 解析净值快照" node navbuild.js
fi
# 2026-11-22（用户要求）：节点级抓取监控 —— 比 isValid 更早发现源站改版
# （价格表节点消失 / 只返回维护页 / 解析 0 条）。只告警，不阻断发布。
soft_step "1.05/9 抓取节点监控" node tools/scrape-health.js

soft_step "3.6/9 積金局新聞稿" "$PY" news_fetch.py
# 2026-10-26 新增：持仓写入事务——BCT / 资产分布两步会整条覆盖 holdings 条目，
# 解析退化（空名称/分布塌缩）过去要人工 diff 回滚，这里抓取前快照、写后自动判定并回滚。
node tools/holdings-txn.js save
soft_step "4/9 BCT 便览持仓" "$PY" bct_ffs_auto.py
soft_step "5/9 资产分布解析" "$PY" alloc_fill.py
node tools/holdings-txn.js check --restore || echo "!!! 持仓事务：已检测到退化并回滚到抓取前快照"
# 2026-11-05（第四十轮）：BCT 便览解析只写 allocLabel + alloc，缺 allocSum / allocTitle，
# health-check 会一直报「allocSum 缺失 83 只」。这里统一补齐（幂等，已有值不动）。
node tools/holdings-normalize.js || echo "!! 持仓字段归一失败（继续）"
# 2026-11-04（第三十六轮，用户要求）：最近 5 个交易日与官网重比对。
# 源站偶发错价（BCT 10-30 曾把 23.3134 报成 24.2958），只靠人工发现太被动：
# 这里逐只重抓、偏差 >0.2% 自动改正并写 data/nav-recheck.log，
# 紧随其后的 navperf 会把修正结果重新算进自算指标。
soft_step "5.5/9 近5交易日净值复核" "$PY" tools/nav-recheck.py --apply
# 2026-11-16：宏利列表页对个别基金滞後（1525/1528），逐只查 fundhistory 补最新点。
soft_step "5.55/9 宏利最新点补齐" "$PY" tools/manulife-latest.py
# 2026-11-16（用户要求）：同计划内落后监控——两站一致地错时，只有计划内横比能发现。
soft_step "5.6/9 同计划落后监控" node tools/plan-lag.js
# 2026-11-11（自查发现）：funds.json 的積金局字段（规模/年率化回报/风险/开支）
# 从来没有进入每日链路，一直停在上次手工跑 build.js 的月份（实测 09-30 vs 官网 10-31）。
# 新增外科式刷新：按 cfid 对齐，只覆盖積金局口径字段，保护 nav/navAsOf 等净值字段。
soft_step "5.8/9 積金局基金資訊表刷新" node tools/mpfa-refresh.js
# 2026-11-11（用户要求）：雅虎補空——官網當天還沒發布時，先用雅虎（與官網同源）的淨值補上，
# 官網一發布就被正常鏈路覆蓋。實測 32 隻映射基金與官網數值 100% 相同。
soft_step "5.7/9 雅虎補空" node tools/yahoo-fill.js
# 2026-11-12（核验发现）：新地官网的基金价格 PDF 路径带「编码空格 %20」，被其 WAF 一律
# 返回 HTTP 999（已用对照实验证明：给任何已知存在的 PDF 加 %20 也同样 999，不加则 200），
# 不是文件被撤。发行人 PDF 内文指定的每日渠道是 HKET，那里 10 只基金都有当日净值。
# 官网 PDF 恢复后仍由 fetch-shkp-hist.py 整段覆盖（含历史逐日），这里只补「当天」。
# 2026-11-16（用户要求「时刻等待官方放行」）：每天探一次官方 PDF，放行即整段回填；
# 结果写入 data/shkp-pdf-probe.json（ok / lastOk / blockedSince）。
soft_step "5.7/9 新地官网 PDF 探测/回填" "$PY" fetch-shkp-hist.py
soft_step "5.75/9 新地 HKET 兜底" "$PY" tools/shkp-hket.py
# 2026-11-11（用户要求自动化）：積金局月度統計（新聞稿表格是圖片）—— 每月 1–12 日試抓，
# 官方 6 日前後發佈；OCR 解析 + 三重校驗，官方未發佈或校驗不過就保留舊資料。
# 20 號前每天試一次：官方約 6 日發佈，萬一機器月初停機也能在恢復後補上
if [ "$(date +%d)" -le 20 ]; then
  soft_step "5.85/9 積金局月度統計" "$PY" tools/mpfa-monthly-sync.py
fi
# 2026-11-13（用户要求）：两站各自抓取，个别来源（etnet 日度、HKET 当日快照）
# 在不同时刻能抓到的最后一天不同。云端 02:26 可能已拿到今天、本机 09:40 只到昨天，
# 于是两站 funds 分布不同、breadth 差 1 个百分点。这里从 GitHub 站补「本地缺、远端有」
# 的点（严格校验：本地点必须与远端逐点相同，单只最多补 5 个点，否则跳过等人工）。
soft_step "5.9/9 云端补点（历史对齐）" node tools/sync-hist-from-cloud.js

# 2026-11-21（用户要求）：净值无变化 → 跳过派生重算与发布（MPF_FORCE=1 可强制跑全量）
NAVSIG_AFTER=$("$NODE" -e "const f=require('./data/funds.json').funds;const s=f.map(x=>x.id+':'+x.nav+':'+x.navAsOf).join('|');console.log(require('crypto').createHash('md5').update(s).digest('hex'))" 2>/dev/null || echo "")
if [ -n "$NAVSIG_BEFORE" ] && [ "$NAVSIG_BEFORE" = "$NAVSIG_AFTER" ] && [ "${MPF_FORCE:-0}" != "1" ]; then
  echo ""
  echo "--- [短路] 本班净值无变化（指纹 $NAVSIG_AFTER）→ 跳过派生重算与发布 ---"
  "$NODE" tools/daily-log.js 2>&1 | sed 's/^/    /' || true
  write_ustat done "无变化，已跳过" "" "$(date '+%H:%M')"
  exit 0
fi

step "6/9 重算自算指标" node navperf.js
# 2026-11-11（自查发现）：allstats 是「走势图未选基金时」的统计表数据源，
# 上次生成停在 10-28（两周前）→ 用户默认看到的是旧区间收益。6 秒可重算完。
soft_step "6.2/9 全量区间统计" node allstats.js
step "6.5/9 修正 n.a. 被写成 0 的字段" node tools/fix-nulls.js
step "6.7/9 自算指数（MPFAVG/五大类，2026-10-31 用户要求每日更新）" node mpfindex.js
step "7/9 指数补齐" node indexbuild.js
# 2026-10-24：merge-nav 必须在最后一次写 funds.json/hist 之后执行——
# 原先排在 1.5 位，后面步骤继续写档会覆盖对齐成果（核验 D08a：30 只净值与 hist 错位 1–2 天）
step "8/9 净值合并校准（最后写档后执行）" node tools/merge-nav.js
# 2026-10-29 修：merge-nav 会把「官方当日净值」追加进 data/hist/<id>.json，
# 但 navperf 已在第 6 步跑过 → 自算指标停在被追加前的末点（云端 10-28 有 16 只 AMTD 停在 10-23）。
# 追加后必须再算一遍，顺序不能反。
step "8.2/9 自算指标重算（hist 追加后）" node navperf.js
# 2026-11-13（用户反馈两站 50% vs 49%、较上周 +1 vs -3）：首屏涨跌占比原先是
# 「本周 w1 − 上周 server 手算」，两套口径、两个分母，两站必然不同。现由单一生成器
# 算好落盘 data/breadth.json（本周与上周同函数、同分母、同基准日），两站读同一份。
step "8.25/9 首屏涨跌占比（统一口径）" node tools/breadth.js
# 2026-11-05（第三十九轮，用户要求「每天自动判断数据是否有误」）：
# 扫最近 5 个净值日，按「绝对幅度 + 同类偏离」双判据标记疑似源站错价，
# 写 data/anomaly.json 并在日志里列出。只告警、不阻断（源站修正后自动消失）。
soft_step "8.3/9 净值异动检测" node tools/anomaly-check.js
# 2026-10-29 修：merge-nav 只写 hist 文件、不更新 hist-index.json，索引会长期落后于实际序列
# （10-28 本机 109 条、云端 25 条）。此处按文件对齐，幂等。
step "8.4/9 历史索引对齐" node tools/hist-index-sync.js
# 2026-11-13：funds.nav 是抓取原值（銀聯信託保留 6-7 位），hist 统一 4 位。
# 两者不一致会让外部核验反复报「净值精度截断」，且表/图数字无法逐位对上。
step "8.45/9 净值精度归一（表 = 历史末点，4 位）" node tools/hist-round4.js
node tools/nav-round4.js
# 2026-10-24：链路末尾固化验收（不依赖 AI 纪律；核验 U01）
# 2026-11-21（用户要求）：季度持仓并入每晚全量任务，按「季度结束后第 1/2/3 个月」
# 的频率自动判定（周日 / 周三+周日 / 周二+周四+周日），更新到 95% 即停（下一季度重新计）。
# 判定在 tools/quarterly-due.js，手动强制跑仍可直接 bash tools/quarterly.sh。
if "$NODE" tools/quarterly-due.js; then
  step "8.6/9 季度持仓（到期）" bash tools/quarterly.sh
else
  echo "    · 季度持仓：今天不到计划日或已基本更新完，跳过"
fi

# 2026-11-22（用户要求）：宏利是最重要的发行人，官网「季度概覽」页面有反爬，
# 改为每天探测其基金详情 JSON 接口的 asOfDate —— 新季一上线当天就全量刷新，
# 不必等季度计划日（计划日是第 1 个月每周日，最坏会晚 6 天）。
if MH_OUT=$("$PY" tools/manulife-holdings-probe.py 2>&1); then
  echo "$MH_OUT" | sed 's/^/    /'
  case "$MH_OUT" in
    *CHANGED*)
      step "8.65/9 宏利持仓刷新（新季已发布）" "$PY" fetch-manulife-detail.py
      step "8.66/9 持仓规范化" "$NODE" tools/holdings-normalize.js
      soft_step "8.67/9 持仓护栏" "$NODE" tools/holdings-guard.js --fix
      ;;
  esac
else
  echo "    · 宏利持仓探测失败（不影响主链）"
fi

step "9/9 链路验收 nav-consistency" node tools/nav-consistency.js
# 2026-11-03（第二十九轮）：缺日检查改成「真缺才补」的自动闭环 ——
# 旧版按 HSI 交易日历判缺，把源站未发布的日期（宏利退休精選 T+2 / AMTD 走 etnet / 新地按季）
# 全算成缺日，每天报 55–244 只且从不真去补。新版判据 = 净值日 > 历史末点；
# --fix 会先 merge-nav 追点、再按发行人重抓，幂等，可每天跑。
soft_step "9.5/9 缺日检查 + 自动补抓" node tools/gap-check.js --fix
# 2026-11-13（第三方核验 P1-2）：按来源的净值新鲜度闸门——新地那种「单渠道静默停 41 天」
# 以前只有告警、照常发布；这里写出 data/freshness.json，predeploy 在严重停滞时禁止发布。
soft_step "9.6/9 净值新鲜度闸门" node tools/freshness-guard.js
# 2026-11-13：区间断档清单（前端详情页的「有区间缺日」提示靠它）——以前是 10-29 的一次性产物
soft_step "9.65/9 区间断档清单" node tools/hist-gaps-build.js --quiet
# 2026-10-29（5.0）：链接巡检——友链 href 为空曾导致「点宏利跳回本站」，此前无任何环节检查。
# 结构问题（空 href / 缺官网地址 / undefined）会让退出码非 0；网络 403 只告警。
soft_step "9.7/9 链接巡检" node tools/link-audit.js
# 2026-10-29（5.0）：季度哨兵——汇丰/恒生/AMTD 一旦发布新季便览，自动下载并写复核报告
# 2026-11-05：裸 python 没装 pymupdf → 每天必报 ModuleNotFoundError（长期误报），改用 $PY
soft_step "9.8/9 季度便览哨兵" "$PY" tools/quarterly-watch.py

echo ""
echo "=== 数据链路完成 $(date '+%F %T')；日志：$LOG ==="
if [ "${1:-}" = "--no-deploy" ]; then
  echo "（--no-deploy：跳过发布）"
  # 2026-11-05（第四十轮）：原来直接 exit，done 状态没写 → 线上顶部一直显示「更新中」。
  write_ustat done "全部完成（未发布）" "" "$(date '+%H:%M')"
  exit 0
fi

# 2026-10-28：两站独立更新 —— 本机链路只负责 WorkBuddy 站，默认不再向 GitHub 推数据。
# GitHub 侧由云端 22:40 全量 / 09:40 仅净值自行抓取并发布；两边各写各的，避免同时写
# data/*.json 造成 rebase 冲突（10-28 早上 10:41 的云端任务就是这样挂的）。
# 需要人工兜底推送时显式加 --sync。
# 2026-11-17（用户明确要求）：**GitHub 站必须自己抓、自己更新**，不依赖本机推送。
# 因此默认不推；只有显式 `--sync` 才推（用于人工纠错）。
if [ "${1:-}" = "--sync" ]; then
  soft_step "10/10 同步数据到 GitHub" bash tools/sync-github.sh
else
  echo "（不推 GitHub：B 站由云端定时任务独立抓取；需人工纠错时加 --sync）"
fi
# 2026-11-05（第三十八轮）：发布前清一次临时文件。抓取过程的 PDF/渲染快照可达 130MB+，
# 而发布平台对项目包有 268MB 上限（曾因此发布被拒）。这些都是可再生中间产物，清掉不损失数据。
soft_step "10/10 清理临时文件" bash tools/clean-scratch.sh
# 2026-11-17：plan-lag 原来在 5.6 步跑（早于 funds 更新），清单里的 asOf 会滞后一天。
# 在派生数据全部重算后再跑一次，保证 status 里的计划内落后清单是当前值。
soft_step "9.9/9 同计划落后（末次）" node tools/plan-lag.js
# 2026-11-19（8.0 交接验收发现）：9.5 的补抓会把 2 位净值写回 funds（AMTD 经 etnet 锚定，
# 如 22.42），而 8.45 的 nav-round4 早已跑过 → predeploy 报「净值与历史末点不一致：16 条」
# 并中止发布（11-18 22:35 就是这样挂在 10/10）。发布前再归一一次，幂等。
step "9.95/9 净值精度复归（发布前）" node tools/nav-round4.js
# 2026-10-29（5.0）：发布闸门——四份核心数据不一致（如新 funds 配旧 nav-perf）时禁止发布
# 2026-11-21（用户反馈）：无论是否发布都写每日摘要，日志不再依赖 push.js
node tools/step-times.js "$STEP_TIMES" || true
soft_step "9.98/10 每日摘要" node tools/daily-log.js

step "10/10 发布前一致性" node tools/predeploy-check.js
echo "下一步：发布（由调用方执行 workbuddy_sites_deploy）"

# 2026-10-26：更新结束状态（提示栏收起）
UEND=$(date +%s)
write_ustat done "全部完成" "" "$(date '+%H:%M')"

# 2026-11-16（用户要求）：数据新鲜度看门狗——跑完立刻自检，异常时发邮件到指定邮箱。
# 配置见 data/mail.json（QQ 邮箱 SMTP 授权码，勿提交到仓库）；未配置时只记录不发信。
soft_step "10/10 新鲜度自检" node tools/freshness-watch.js --mail
