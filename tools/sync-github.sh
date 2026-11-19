#!/usr/bin/env bash
# 数据推送 GitHub
# ================
# 2026-10-26：GitHub schedule 长期不触发 / 严重延迟，本机跑完就推一份，push 事件会触发 Pages 构建。
# 2026-11-17：改为「默认推送」，并加两道保险：
#   ① 逐只守卫：远端任一只基金比本地新 → 拒绝推送（fail-closed），防止用旧数据覆盖云端；
#   ② 不再 `pull --rebase`（大 JSON 必冲突，会把工作区搞成 UU，甚至回滚未提交的脚本）→
#      用 commit-tree 基于 origin/main 直接构建提交，天然快进。
# 用法：bash tools/sync-github.sh [--dry]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
# 2026-11-17（用户要求）：--code-only 只推前端与脚本，不带数据。
# 用于「界面改了、但数据还是旧的」时单独发一版，避免把半成品数据一起推上去。
CODE_ONLY=0; for a in "$@"; do [ "$a" = "--code-only" ] && CODE_ONLY=1; done
# 2026-11-18（用户明确要求）：除用户明确要求外，本机不再向 GitHub 推**数据**。
# 代码改动仍可推（--code-only），否则 B 站永远拿不到前端修复。
ALLOW_DATA=0; for a in "$@"; do [ "$a" = "--allow-data" ] && ALLOW_DATA=1; done
if [ "$CODE_ONLY" = "0" ] && [ "$ALLOW_DATA" = "0" ]; then
  echo "已阻止：默认不向 GitHub 推送数据（两站各自更新）。"
  echo "  只推代码：bash tools/sync-github.sh --code-only"
  echo "  确实要推数据请显式加：--allow-data"
  exit 2
fi

git fetch origin main >/dev/null 2>&1 || true

# ---------- 守卫：远端是否有更新的基金 ----------
GUARD=$(git show origin/main:data/funds.json 2>/dev/null | node -e "
let s='';process.stdin.setEncoding('utf8');
process.stdin.on('data',d=>s+=d).on('end',()=>{
  let remote=[];
  try{remote=JSON.parse(s).funds||[];}catch(e){console.log('UNKNOWN');return;}
  const loc=require('./data/funds.json').funds||[];
  const m=new Map(loc.map(f=>[String(f.id),f.navAsOf||'']));
  let ahead=0, sample=[];
  for(const f of remote){
    const l=m.get(String(f.id));
    if(l===undefined) continue;
    if((f.navAsOf||'')>(l||'')){ahead++; if(sample.length<3) sample.push(f.id+':'+l+'→'+f.navAsOf);}
  }
  console.log(ahead?('AHEAD '+ahead+' '+sample.join(',')):'OK');
});" 2>/dev/null)
[ "$CODE_ONLY" = "1" ] && GUARD="OK"
case "$GUARD" in
  OK) : ;;
  AHEAD*)
    echo "远端有更新的基金（$GUARD）→ 跳过推送，请先跑 site-reconcile --apply"
    exit 0 ;;
  *)
    echo "无法确认远端数据新旧（$GUARD）→ 为安全起见跳过推送"
    exit 0 ;;
esac

# ---------- 构建提交：索引 = origin/main + 工作区改动 ----------
git read-tree origin/main || { echo "read-tree 失败"; exit 1; }
if [ "$CODE_ONLY" = "1" ]; then
  echo "（--code-only：只推前端与脚本，不推 data/）"
else
  git add --ignore-removal data/ 2>/dev/null || true
fi
git add --ignore-removal tools/ .github/ 2>/dev/null || true
# 2026-11-17（用户反馈）：原来只推 data/tools/.github，**前端 public/ 从未推送** →
# 两站界面长期不一致（导出、分类、提示都在 A 站改了、B 站还是旧的）。这里一并推。
git add --ignore-removal public/ server.js navperf.js indexbuild.js 2>/dev/null || true
# 2026-11-17（用户反馈 B 站提示条关不掉）：update-status.json 被 .gitignore 忽略，普通 add 不会带上。
# 2026-11-18 修正：只在**推数据**时携带；只推代码时绝不带，否则 B 站会显示 host=workbuddy
# （用户会以为 GitHub 站的数据是本机推的）。
if [ "${ALLOW_DATA:-0}" = "1" ]; then
  git add -f data/update-status.json 2>/dev/null || true
fi

# 比较基准必须是 origin/main（比 HEAD 会误判「无变更」）
if git diff --cached --quiet origin/main; then
  echo "无变更，跳过推送"
  exit 0
fi
echo "待提交：" $(git diff --cached --name-only origin/main | wc -l) "个文件"
if [ "$DRY" = "1" ]; then
  git diff --cached --stat origin/main | tail -3
  echo "（--dry：不提交不推送）"
  exit 0
fi

TREE=$(git write-tree) || { echo "write-tree 失败"; exit 1; }
for i in 1 2 3 4 5; do
  PARENT=$(git rev-parse origin/main)
  # 2026-11-18（用户要求）：只有「探测样本/工具脚本」变化的提交不需要重新构建站点，
  # 用 [skip ci] 省掉一次 build（每天十几次空构建会挤掉定时队列）。
  # 注意：只要涉及 data/（除 data/probe）或 public/，就必须构建，不能加 skip。
  CHANGED=$(git diff --name-only "$PARENT" "$TREE" | grep -v '^data/probe/' || true)
  NEED_BUILD=$(printf '%s
' "$CHANGED" | grep -E '^(data/|public/|server\.js|navperf\.js|indexbuild\.js)' | head -1 || true)
  SKIP=""
  [ -z "$NEED_BUILD" ] && SKIP=" [skip ci]"
  # 2026-11-19：MPF_RUN_DATA=1 时在提交信息里带 [run-data]，手动催一次云端数据班
  # （GitHub schedule 实测会被丢弃/延迟数小时；deploy.yml 只在 schedule 或 [run-data] 时抓数据）
  TAG=""
  if [ "${MPF_RUN_DATA:-0}" = "1" ]; then TAG=" [run-data]"; SKIP=""; fi
  COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "data: daily sync $(date +%F)$TAG$SKIP") || { echo "commit-tree 失败"; exit 1; }
  if git push origin "$COMMIT:main" 2>&1 | tail -2; then
    if git ls-remote origin refs/heads/main 2>/dev/null | grep -q "$COMMIT"; then
      echo "✔ 已推送 GitHub：${COMMIT:0:7}（push 事件将触发 Pages 构建）"
      exit 0
    fi
  fi
  echo "推送未生效（第 $i 次），重新取远端后重试…"
  sleep 4
  git fetch origin main >/dev/null 2>&1 || true
done
echo "!!! 推送 GitHub 失败（5 次），请检查 SSH 通道；本地数据未受影响"
exit 1
