#!/usr/bin/env bash
# 2026-10-23：计划任务用的推送入口（避免 .cmd 里嵌套引号）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export PATH="/c/Users/11718/.workbuddy/binaries/node/versions/22.22.2-6:$PATH"
node push.js --no-nav
