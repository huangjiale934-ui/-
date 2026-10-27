#!/usr/bin/env bash
# 手动触发 GitHub Actions 的 workflow_dispatch（2026-10-27 新增）
#
# 用途：本仓库的 schedule 触发不稳定（见 docs/GitHub定时更新_PAT方案.md 的实测记录），
#      需要一个「不依赖 GitHub 调度器」的触发方式。这个脚本就是那条通道。
#
# 用法：
#   bash tools/gh-dispatch.sh <TOKEN>              # 直接传 token
#   bash tools/gh-dispatch.sh                      # 从 data/gh-token.txt 读（该文件已 gitignore）
#   bash tools/gh-dispatch.sh <TOKEN> deploy.yml   # 指定工作流文件
#
# Token 最小权限（Fine-grained PAT）：
#   仅选中仓库 huangjiale934-ui/-  →  Permissions: Actions = Read and write
#   有效期建议 90 天；不要勾选其他权限。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TOKEN="${1:-}"
WF="${2:-deploy.yml}"
if [ -z "$TOKEN" ]; then
  if [ -f data/gh-token.txt ]; then
    TOKEN="$(tr -d '\r\n' < data/gh-token.txt)"
  else
    echo "缺少 token：请传入参数，或把 token 写入 data/gh-token.txt"
    exit 1
  fi
fi

REPO="huangjiale934-ui/-"
API="https://api.github.com/repos/${REPO}/actions/workflows/${WF}/dispatches"

resp=$(curl -s -o /tmp/gh-dispatch.out -w "%{http_code}" --max-time 30 -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  -d '{"ref":"main"}')

if [ "$resp" = "204" ]; then
  echo "✔ 已触发 ${WF}（HTTP 204）。约 5–10 秒后可在 Actions 页面看到新运行。"
  exit 0
fi
echo "✘ 触发失败（HTTP ${resp}）"
cat /tmp/gh-dispatch.out 2>/dev/null | head -5
case "$resp" in
  401) echo "→ token 无效或已过期" ;;
  403) echo "→ token 权限不足（需要 Actions: write）或已过期" ;;
  404) echo "→ 仓库/工作流不存在，或 token 没有该仓库权限" ;;
esac
exit 1
