#!/usr/bin/env bash
# 季度持仓 / 资产分布刷新（2026-10-23）
# 目标：每季（3/6/9/12 月末报告发布后）重抓十大持仓与资产分布。
# 说明：各家披露节奏不同（月报/季报），这里跑"能自动跑的那部分"，其余靠人工核对。
# 2026-11-23（用户要求）：本脚本**两站共用**——本机 daily.sh 第 8.6 步调用，
#   GitHub Actions 的 quarterly job 也调用。因此不得写死任何本机路径。
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

# 解释器解析（2026-11-23）：不再写死任何本机绝对路径。
# 顺序：环境变量 → PATH 上的 python3/python → 本机 WorkBuddy 自带运行时（通配探测）。
# 判据不是「能执行」而是「依赖能导入」：PATH 上的 python 往往没有 curl_cffi/pdfplumber。
pick_python() {
  local c
  for c in "${MPF_PYTHON:-}" \
           "$(command -v python3 2>/dev/null || true)" \
           "$(command -v python 2>/dev/null || true)" \
           "$HOME"/.workbuddy*/binaries/python/envs/*/Scripts/python.exe \
           "$HOME"/.workbuddy*/binaries/python/envs/*/bin/python; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -c 'import pdfplumber, fitz' >/dev/null 2>&1; then printf '%s\n' "$c"; return 0; fi
  done
  return 1
}
PY="$(pick_python || true)"
NODE="${MPF_NODE:-$(command -v node 2>/dev/null || true)}"
if [ -z "${PY:-}" ]; then
  echo "!! 找不到可用的 python（需 pdfplumber + pymupdf）。可用 MPF_PYTHON=/path/to/python 指定" >&2
  exit 1
fi
if [ -z "${NODE:-}" ]; then
  echo "!! 找不到 node。可用 MPF_NODE=/path/to/node 指定" >&2
  exit 1
fi
# AMTD 的 Google Drive 下载要真浏览器（tools/amtd-fetch-chrome.js 读 CHROME_PATH）
if [ -z "${CHROME_PATH:-}" ]; then
  for c in "$(command -v google-chrome 2>/dev/null || true)" \
           "$(command -v chromium 2>/dev/null || true)" \
           "$(command -v chromium-browser 2>/dev/null || true)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then CHROME_PATH="$c"; break; fi
  done
  export CHROME_PATH
fi

LOG="data/holdings-update.log"
LOG_FROM=$(wc -l < "$LOG" 2>/dev/null || echo 0)
echo "[$(date '+%F %H:%M')] 季度持仓刷新开始（python=$PY node=$NODE chrome=${CHROME_PATH:-未找到}）" >> "$LOG"

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
# 2026-11-23：云端 runner 是 UTC，季度必须按 HKT 算 —— 每月 1 日 00:00 HKT 的班次在 UTC 还停在上月。
HKT_M=$(TZ=Asia/Hong_Kong date +%-m)
HKT_Y=$(TZ=Asia/Hong_Kong date +%Y)
Q_NTH=$(( (HKT_M - 1) / 3 + 1 ))
case "$Q_NTH" in 1) Q_EN=1st;; 2) Q_EN=2nd;; 3) Q_EN=3rd;; 4) Q_EN=4th;; esac
Q_YEAR=$HKT_Y
# 季度末报告在下一季发布：当前月 1-3 月抓去年 4th，其余抓本年 (Q-1)
if [ "$HKT_M" -le 3 ]; then Q_YEAR=$((Q_YEAR-1)); Q_NTH=4; Q_EN=4th
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
# 2026-11-23：bea_alloc_ingest.py 是「按 2026-06 便覧读图」的一次性静态入库（数据写死 ASOF），
# 只在本次真的下载到 PDF 时才跑；否则云端会拿旧快照覆盖更新的季度。
if [ -f bea_alloc_ingest.py ] && [ -f tmp/bea_ffs.pdf ]; then run "東亞分布(读图)" "$PY" bea_alloc_ingest.py; fi

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
  # sunlife_alloc_ingest.py 是按 2026-06 季报读图录入的静态数据（ASOF 写死），
  # 云端每季重跑只会把分布写回旧季度 → 只在明确指定时才跑（重新录入后手动开启）。
  if [ -f sunlife_alloc_ingest.py ] && [ "${MPF_QUARTERLY_STATIC:-0}" = "1" ]; then
    run "永明分布(静态录入)" "$PY" sunlife_alloc_ingest.py
  else
    echo "  · 永明分布：静态录入脚本（ASOF 固定），默认跳过" >> "$LOG"
  fi
else
  echo "  · 永明：本季持仓已齐，跳过下载/解析" >> "$LOG"
fi
if "$NODE" tools/source-due.js 中國人壽; then
  # 2026-11-22（用户要求）：优先发行人官网「基金表现便览」（简中版季度最全），失败才回退積金局 MT00083
  if "$PY" tools/fetch-chinalife-fpr.py >> "$LOG" 2>&1; then
    run "中國人壽持仓（官網）" "$PY" chinalife_holdings.py tmp/cl_fpr.pdf
  fi
else
  echo "  · 中國人壽：本季持仓已齐，跳过下载/解析" >> "$LOG"
fi
if "$NODE" tools/source-due.js AMTD; then
  run "AMTD下载(Chrome)" "$NODE" tools/amtd-fetch-chrome.js
  # 没下到 PDF 就不要解析（否则 parse 会在空目录上报错，污染日志）
  if [ -n "$(ls -A tmp/amtd 2>/dev/null | grep -v '^_dl$' || true)" ]; then
    run "AMTD持仓" "$PY" tools/parse-amtd-ffs.py --write
  else
    echo "  · AMTD：未下载到 PDF，跳过解析" >> "$LOG"
  fi
else
  echo "  · AMTD：本季持仓已齐，跳过下载/解析" >> "$LOG"
fi

[ -f fetch-manulife-detail.py ] && run "宏利持仓/分布（官方API）"    "$PY" fetch-manulife-detail.py
[ -f alloc_fill.py ]        && run "通用持仓/分布抓取(alloc_fill)"  "$PY" alloc_fill.py
[ -f bct_ffs_auto.py ]      && run "BCT 便览自动发现"               "$PY" bct_ffs_auto.py
# 2026-11-23（用户要求：不许再拿「缺输入 PDF」当借口）：
# 中銀保誠「我的強積金」基金便覽 —— 先按季度文件名探测并下载，再解析；下载失败才跳过。
if "$NODE" tools/fetch-pdf.js --bocpt tmp/bocpt_fs.pdf >> "$LOG" 2>&1; then
  echo "  ✔ 中銀保誠便覽下載" >> "$LOG"
  run "中銀保誠持仓" "$PY" bocpt_holdings.py
else
  echo "  ✘ 中銀保誠便覽下載失敗（源站改版或未发布，下次再试）" >> "$LOG"
fi
# bocpt_alloc_ingest.py 同样是静态录入（ASOF 固定 2026-06-30），默认跳过，避免覆盖更新的季度
if [ -f bocpt_alloc_ingest.py ] && [ "${MPF_QUARTERLY_STATIC:-0}" = "1" ]; then
  run "中銀保誠分布(静态录入)" "$PY" bocpt_alloc_ingest.py
fi
[ -f bocom_holdings.py ]    && run "交通持仓"                       "$PY" bocom_holdings.py
# 2026-11-23（用户要求）：海通改走官方「基金概覽」月度汇总 PDF（7 只共用一份，2026-10-30 版已可下），
# 用 fetch-pdf.js --ht 自动发现链接，解析用 tools/ht-apply.py。
# 旧的 ht_holdings3/2 已停用（ASSET 会在面板间串行、asOf 写死，属于已知污染源）。
if "$NODE" tools/fetch-pdf.js --ht tmp/ht_pdf3/Haitong_Korea_Fund.pdf >> "$LOG" 2>&1; then
  echo "  ✔ 海通便覽下載" >> "$LOG"
  run "海通持仓/分布(ht-apply)" "$PY" tools/ht-apply.py --write
  # 解析完立刻删掉，避免任何旧脚本拿这份 PDF 按旧 asOf 重写
  rm -f tmp/ht_pdf3/Haitong_Korea_Fund.pdf
else
  echo "  ✘ 海通便覽下載失敗（官网列表页未给出 PDF，下次再试）" >> "$LOG"
fi
[ -f bct_holdings.py ]      && run "BCT 持仓"                       "$PY" bct_holdings.py
# 友邦（月报）：URL 可按月拼（fetch-aia-fpr.py 的规律），但持仓解析页码需逐期核对，
# 未自动化；永明 SLR：官网 JS 拼接，需 Chrome 人工下载后跑 sunlife_holdings.py --force。
# AMTD：由自动化任务提示词单独处理（Chrome 下载 Google Drive）。

if "$NODE" tools/holdings-txn.js check --restore >> "$LOG" 2>&1; then
  echo "  ✔ 持仓事务校验：零退化" >> "$LOG"
else
  echo "  ⚠ 持仓事务校验：检测到退化，已按基金逐条回滚到抓取前快照" >> "$LOG"
fi
"$NODE" tools/holdings-normalize.js >> "$LOG" 2>&1
"$NODE" tools/holdings-guard.js --fix >> "$LOG" 2>&1

# 2026-11-23：云端日志里要一眼看到「跑成了几步、坏了几步」，不能只留一个结束时间。
RUN_OK=$(tail -n +$((LOG_FROM + 1)) "$LOG" | grep -c '✔' || true)
RUN_NG=$(tail -n +$((LOG_FROM + 1)) "$LOG" | grep -c '✘' || true)
echo "[$(date '+%F %H:%M')] 季度持仓刷新结束：成功 ${RUN_OK} 步，失败 ${RUN_NG} 步" >> "$LOG"
tail -n +$((LOG_FROM + 1)) "$LOG" | grep -E '✔|✘|·' | tail -60
