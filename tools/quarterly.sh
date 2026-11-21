#!/usr/bin/env bash
# 季度持仓 / 资产分布刷新（2026-10-23）
# 目标：每季（3/6/9/12 月末报告发布后）重抓十大持仓与资产分布。
# 说明：各家披露节奏不同（月报/季报），这里跑"能自动跑的那部分"，其余靠人工核对。
set -u
cd "$(dirname "$0")/.."
# 2026-10-23：互斥锁——每日任务与季度任务可能撞车（都写 data/），先到先跑，后来的直接跳过
LOCK="tmp/.mpf-job.lock"
mkdir -p tmp
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "另一个任务正在运行（$LOCK 存在），本次跳过 $(date '+%F %T')"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
PY="C:/Users/11718/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
NODE="C:/Users/11718/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
LOG="data/holdings-update.log"
echo "[$(date '+%F %H:%M')] 季度持仓刷新开始" >> "$LOG"

# 2026-10-26 新增：写盘事务——本链路有 8+ 个解析器直接覆盖 holdings 条目，
# 一旦某个解析器退化（当日 BCT 空名称/分布塌缩），过去只能人工 diff 回滚。
"$NODE" tools/holdings-txn.js save >> "$LOG" 2>&1

run() {
  local name="$1"; shift
  if "$@" >> "$LOG" 2>&1; then echo "  ✔ $name" >> "$LOG"; else echo "  ✘ $name" >> "$LOG"; fi
}

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# --- PDF 下载（URL 固定 / 按季拼，原地覆盖式） ---
fetch_pdf() {
  local name="$1"; local url="$2"; local out="$3"
  if curl -s -L --max-time 180 -A "$UA" "$url" -o "$out" \
     && head -c 4 "$out" | grep -q "%PDF"; then
    echo "  ✔ $name → $out" >> "$LOG"
    return 0
  fi
  echo "  ✘ $name 下载失败（$url）" >> "$LOG"
  return 1
}

# 2026-10-24：换源后的季度链路（mpf.hk 转载已清零，全部走官方原件）
# 東亞：官網 FFS 按季拼 URL（mpf-2026-2nd.pdf；1st/2nd/3rd/4th = Q1-Q4）
Q_NTH=$(date +%-m | awk '{print int(($1-1)/3)+1}')
case "$Q_NTH" in 1) Q_EN=1st;; 2) Q_EN=2nd;; 3) Q_EN=3rd;; 4) Q_EN=4th;; esac
Q_YEAR=$(date +%Y)
# 季度末报告在下一季发布：当前月 1-3 月抓去年 4th，其余抓本年 (Q-1)
if [ "$(date +%-m)" -le 3 ]; then Q_YEAR=$((Q_YEAR-1)); Q_NTH=4; Q_EN=4th
else Q_NTH=$((Q_NTH-1)); case "$Q_NTH" in 1) Q_EN=1st;; 2) Q_EN=2nd;; 3) Q_EN=3rd;; 4) Q_EN=4th;; esac; fi

# 2026-11-20（用户反馈）：東亞 2026 年基金便覧官网只发布到第 1 季，Q2/Q3 尚未上线。
# 先探测再下载——源站未发布时输出「源站尚未发布，跳过」，不再每次报 ✘ 被误判成抓取故障。
BEA_URL="https://www.hkbea.com/pdf/fund-fact-sheet/${Q_YEAR}/mpf-${Q_YEAR}-${Q_EN}.pdf"
BEA_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -A "$UA" "$BEA_URL" 2>/dev/null || echo 000)
if [ "$BEA_CODE" = "200" ]; then
  fetch_pdf "東亞FFS" "$BEA_URL" tmp/bea_ffs.pdf \
    && run "東亞持仓(force)" "$PY" bea_holdings.py tmp/bea_ffs.pdf --force
else
  echo "  · 東亞FFS：源站尚未发布 ${Q_YEAR} 年第 ${Q_NTH} 季便覧（HTTP ${BEA_CODE}），跳过（非抓取故障）" >> "$LOG"
fi
[ -f bea_alloc_ingest.py ]  && run "東亞分布(读图)"           "$PY" bea_alloc_ingest.py

# 滙豐：固定 URL（內容隨季更新）；恒生：固定 URL
fetch_pdf "滙豐invrptce1" "https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/mpf/invrptce1.pdf" tmp/hsbc_invrptce1.pdf \
  && run "滙豐持仓(价格匹配)" "$PY" tools/replace-mpfhk-hsbc2.py --write
fetch_pdf "恒生FFS" "https://cms.hangseng.com/cms/pws/files/pdfs/FFS.pdf" tmp/hase_invrptce1.pdf \
  && run "恒生持仓(价格匹配)" "$PY" tools/replace-mpfhk-hsbc2.py --write

# 富達：積金局匯總月報（固定 URL，內容隨月更新；官网被 Akamai 拦）
fetch_pdf "富達MT00288" "https://www.mpfa.org.hk/assets/FF/MT00288.pdf" tmp/ff_fid.pdf \
  && run "富達持仓" "$PY" tools/parse-fidelity-ffs.py tmp/ff_fid.pdf --write

# 2026-11-22（用户要求）：宏利 68 只走官网基金详情 JSON 接口（curl_cffi 浏览器指纹），
# 完全绕开「季度概覽」页面的 Akamai 反爬；接口按季度返回 top10Holdings / portfolioAllocation。
# 2026-11-22（用户要求：不允许再有「人工下载」）：三家改全自动
#  · 永明：官网固定 URL（SLR_MPF_Quarterly_Update.pdf，每季原地更新）
#  · 中國人壽：積金局匯總 MT00083.pdf（固定 URL，季度更新）
#  · AMTD：Google Drive 需真浏览器，用 tools/amtd-fetch-chrome.js 逐只下载
# 先用 source-due 判本季是否已齐 —— 已齐就不再下载/解析（省时间与积分）。
if "$NODE" tools/source-due.js 永明; then
  fetch_pdf "永明SLR" "https://www.sunlife.com.hk/content/dam/sunlife/regional/hong-kong/documents/pensions/SLR_MPF_Quarterly_Update.pdf" tmp/slr_mpf.pdf \
    && run "永明持仓" "$PY" sunlife_holdings.py tmp/slr_mpf.pdf
  [ -f sunlife_alloc_ingest.py ] && run "永明分布" "$PY" sunlife_alloc_ingest.py
else
  echo "  · 永明：本季持仓已齐，跳过下载/解析" >> "$LOG"
fi
if "$NODE" tools/source-due.js 中國人壽; then
  fetch_pdf "中國人壽MT00083" "https://www.mpfa.org.hk/assets/FF/MT00083.pdf" tmp/cl_mt83.pdf \
    && run "中國人壽持仓" "$PY" chinalife_holdings.py tmp/cl_mt83.pdf
else
  echo "  · 中國人壽：本季持仓已齐，跳过下载/解析" >> "$LOG"
fi
if "$NODE" tools/source-due.js AMTD; then
  run "AMTD下载(Chrome)" node tools/amtd-fetch-chrome.js
  run "AMTD持仓" "$PY" tools/parse-amtd-ffs.py --write
else
  echo "  · AMTD：本季持仓已齐，跳过下载/解析" >> "$LOG"
fi

[ -f fetch-manulife-detail.py ] && run "宏利持仓/分布（官方API）"    "$PY" fetch-manulife-detail.py
[ -f alloc_fill.py ]        && run "通用持仓/分布抓取(alloc_fill)"  "$PY" alloc_fill.py
[ -f bct_ffs_auto.py ]      && run "BCT 便览自动发现"               "$PY" bct_ffs_auto.py
[ -f bocpt_holdings.py ]    && run "中銀保誠持仓"                   "$PY" bocpt_holdings.py
[ -f bocpt_alloc_ingest.py ]&& run "中銀保誠分布"                   "$PY" bocpt_alloc_ingest.py
[ -f chinalife_holdings.py ]&& run "中國人壽持仓(需先下载FPR PDF)"   "$PY" chinalife_holdings.py
[ -f bocom_holdings.py ]    && run "交通持仓"                       "$PY" bocom_holdings.py
# 2026-10-25 修 P1-5：舊版 ht_holdings.py 輸出含污染（表演出行混入 top10、
# alloc 標籤含 FUND PERFORMANCE），會覆蓋已入庫的乾淨海通數據 → 改用 v3+v2
[ -f ht_holdings3.py ]      && run "海通持仓(逐頁v3)"               "$PY" ht_holdings3.py
[ -f ht_holdings2.py ]      && run "海通分布(v2)"                   "$PY" ht_holdings2.py
[ -f bct_holdings.py ]      && run "BCT 持仓"                       "$PY" bct_holdings.py
# 友邦（月报）：URL 可按月拼（fetch-aia-fpr.py 的规律），但持仓解析页码需逐期核对，
# 未自动化；永明 SLR：官网 JS 拼接，需 Chrome 人工下载后跑 sunlife_holdings.py --force。
# AMTD：由自动化任务提示词单独处理（Chrome 下载 Google Drive）。

if "$NODE" tools/holdings-txn.js check --restore >> "$LOG" 2>&1; then
  echo "  ✔ 持仓事务校验：零退化" >> "$LOG"
else
  echo "  ⚠ 持仓事务校验：检测到退化，已回滚到抓取前快照" >> "$LOG"
fi
"$NODE" tools/holdings-normalize.js >> "$LOG" 2>&1
"$NODE" tools/holdings-guard.js --fix >> "$LOG" 2>&1
echo "[$(date '+%F %H:%M')] 季度持仓刷新结束" >> "$LOG"
