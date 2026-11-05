#!/usr/bin/env bash
# 清理可再生的工作区临时文件（2026-11-05，第三十八轮）
# 背景：发布平台对单个项目包有体积上限（实测 268MB）。项目曾涨到 305MB →
#       发布被拒。占用几乎全在 tmp/（抓取过程的 PDF、渲染快照、校验图），
#       这些都是「跑一次就能再生」的中间产物，不是数据。
# 保留：日志（*.log）、互斥锁、hist 合并快照、以及任何不在下面清单里的文件。
# 用法：bash tools/clean-scratch.sh [--dry]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
DRY=0
[ "${1:-}" = "--dry" ] && DRY=1

before=$(du -sm tmp 2>/dev/null | cut -f1)

# 目录：抓取过程的下载缓存 / 渲染快照 / 校验产物
DIRS="bct_auto bct_pdf amtd navsrc aia_fpr probe reg _dl chrome-dl-prof"
for d in $DIRS; do
  [ -d "tmp/$d" ] || continue
  if [ "$DRY" = "1" ]; then
    echo "[dry] rm -rf tmp/$d  ($(du -sh "tmp/$d" 2>/dev/null | cut -f1))"
  else
    rm -rf "tmp/$d"
  fi
done

# 单文件：PDF 原件（已解析进 data/holdings.json）、探测响应、临时二进制
for f in tmp/*.pdf tmp/*.PDF tmp/chk.bin tmp/bocom_pricedata.js tmp/*.png tmp/*.jpg; do
  [ -f "$f" ] || continue
  case "$f" in
    *live-*|*screenshot*) ;;   # 保留少量人工核查截图
  esac
  if [ "$DRY" = "1" ]; then echo "[dry] rm $f  ($(du -h "$f" 2>/dev/null | cut -f1))"; else rm -f "$f"; fi
done

# 备份目录：只留最近 1 个
ls -dt tmp/backup-* tmp/hist-backup-* 2>/dev/null | tail -n +2 | while read -r d; do
  if [ "$DRY" = "1" ]; then echo "[dry] rm -rf $d"; else rm -rf "$d"; fi
done

# 日志：保留最近 14 天
find tmp -maxdepth 1 -name '*.log' -mtime +14 -print0 2>/dev/null | while IFS= read -r -d '' f; do
  if [ "$DRY" = "1" ]; then echo "[dry] rm $f"; else rm -f "$f"; fi
done

after=$(du -sm tmp 2>/dev/null | cut -f1)
echo "tmp：${before:-?}MB → ${after:-?}MB（全项目 $(du -sh . 2>/dev/null | cut -f1)）"
