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

fetch_pdf "東亞FFS" "https://www.hkbea.com/pdf/fund-fact-sheet/${Q_YEAR}/mpf-${Q_YEAR}-${Q_EN}.pdf" \
          tmp/bea_ffs.pdf \
  && run "東亞持仓(force)" "$PY" bea_holdings.py tmp/bea_ffs.pdf --force
[ -f bea_alloc_ingest.py ]  && run "東亞分布(读图)"           "$PY" bea_alloc_ingest.py

# 滙豐：固定 URL（內容隨季更新）；恒生：固定 URL
fetch_pdf "滙豐invrptce1" "https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/mpf/invrptce1.pdf" tmp/hsbc_invrptce1.pdf \
  && run "滙豐持仓(价格匹配)" "$PY" tools/replace-mpfhk-hsbc2.py --write
fetch_pdf "恒生FFS" "https://cms.hangseng.com/cms/pws/files/pdfs/FFS.pdf" tmp/hase_invrptce1.pdf \
  && run "恒生持仓(价格匹配)" "$PY" tools/replace-mpfhk-hsbc2.py --write

# 富達：積金局匯總月報（固定 URL，內容隨月更新；官网被 Akamai 拦）
fetch_pdf "富達MT00288" "https://www.mpfa.org.hk/assets/FF/MT00288.pdf" tmp/ff_fid.pdf \
  && run "富達持仓" "$PY" tools/parse-fidelity-ffs.py tmp/ff_fid.pdf --write

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

"$NODE" tools/holdings-normalize.js >> "$LOG" 2>&1
"$NODE" tools/holdings-guard.js --fix >> "$LOG" 2>&1
echo "[$(date '+%F %H:%M')] 季度持仓刷新结束" >> "$LOG"
