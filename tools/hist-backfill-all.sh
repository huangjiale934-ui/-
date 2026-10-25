#!/usr/bin/env bash
# 一次性全量回补驱动（2026-10-22）：按影响面从大到小顺序跑，逐家落地
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
for g in bct bocpt aia yflife shkp sunlife chinalife bocom; do
  echo "########## $(date '+%F %T') $g ##########"
  bash tools/hist-topup.sh "$g"
done
echo "########## $(date '+%F %T') ALL DONE ##########"
