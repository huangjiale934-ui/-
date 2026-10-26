#!/usr/bin/env bash
# 数据推送 GitHub（2026-10-26 新增）
# 背景：GitHub Actions 的 schedule（每日 22:40）自建仓以来一次都没触发过（近 30 次运行全部是 push 事件），
#       导致 GitHub 站长期停在上一次手工推送的数据（10-26 实测仍为 navLatest=10-22，本机已到 10-23）。
#       这里给本机链路一个兜底：每日数据跑完就提交 data/ 并推送，push 事件本身会触发 Pages 构建。
# 用法：bash tools/sync-github.sh [--dry]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1

git add -A data/ 2>/dev/null || true

# 顺手把自动化脚本/工作流的改动也带上（不含 public/ 前端，前端改动需人工确认后单独提交）
git add tools/ .github/ 2>/dev/null || true

if git diff --cached --quiet; then
  echo "无数据变更，跳过推送"
  exit 0
fi
echo "待提交：" $(git diff --cached --name-only | wc -l) "个文件"
if [ "$DRY" = "1" ]; then
  git diff --cached --stat | tail -3
  echo "（--dry：不提交不推送）"
  exit 0
fi

git commit -q -m "data: daily sync $(date +%F)" || { echo "提交失败"; exit 1; }
LOCAL=$(git rev-parse HEAD)
for i in 1 2 3; do
  if git push origin main 2>&1 | tail -2; then
    REMOTE=$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)
    if [ "$REMOTE" = "$LOCAL" ]; then
      echo "✔ 已推送 GitHub：${LOCAL:0:7}（push 事件将触发 Pages 构建）"
      exit 0
    fi
  fi
  echo "推送未生效（第 $i 次），尝试对齐远端后重试…"
  git pull --rebase --autostash origin main >/dev/null 2>&1 || true
  LOCAL=$(git rev-parse HEAD)
  sleep 3
done
echo "!!! 推送 GitHub 失败（3 次），请检查 SSH 443 通道或手动执行 git push"
exit 1
