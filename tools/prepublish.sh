#!/usr/bin/env bash
# 发布前 UI 冒烟闸门（2026-11-22）
# ------------------------------------------------------------------
# 用户要求：把反复回归的交互（空图悬停残留、开关弹窗后悬停失效、切页签图表尺寸、
# 导出中心下拉误关）接进每日发布前流程 —— 冒烟不过就不发布。
#
# 做法：
#   1. 若本地 3999 已有服务，直接复用；
#   2. 否则自己起一个 node server.js，跑完只关自己起的那个；
#   3. 跑 tools/ui-smoke.js，退出码原样返回（daily.sh 的 step 会据此中止并写 error 状态）。
#
# 用法：bash tools/prepublish.sh [port]
set -u

cd "$(dirname "$0")/.." || exit 1
PORT="${1:-${PORT:-3999}}"
URL="http://127.0.0.1:${PORT}/index.html"
LOG="tmp/prepublish-server.log"
mkdir -p tmp

alive() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}/api/status"; }

[ -f tmp/.mpf-job.lock ] && { echo "（提示：存在 tmp/.mpf-job.lock，若有残留空目录可 rmdir）"; }

STARTED=0
SRV=""
if alive; then
  echo "复用已在运行的服务：${URL}"
else
  echo "启动临时服务：${URL}"
  PORT="$PORT" node server.js > "$LOG" 2>&1 &
  SRV=$!
  STARTED=1
  ok=0
  for _ in $(seq 1 40); do
    if alive; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != "1" ]; then
    echo "!!! 临时服务启动失败（40s 内 /api/status 未就绪），日志：$LOG"
    tail -20 "$LOG" 2>/dev/null
    kill "$SRV" 2>/dev/null
    exit 1
  fi
fi

node tools/ui-smoke.js "$URL"
rc=$?

if [ "$STARTED" = "1" ] && [ -n "$SRV" ]; then
  kill "$SRV" 2>/dev/null
  wait "$SRV" 2>/dev/null
fi

if [ "$rc" != "0" ]; then
  echo "!!! UI 冒烟未通过（退出码 $rc）—— 阻止发布，请修复后再发布"
else
  echo "✔ UI 冒烟通过，可继续发布"
fi
exit "$rc"
