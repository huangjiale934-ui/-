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
git add --ignore-removal data/ 2>/dev/null || true
git add --ignore-removal tools/ .github/ 2>/dev/null || true
# 2026-11-17（用户反馈）：原来只推 data/tools/.github，**前端 public/ 从未推送** →
# 两站界面长期不一致（导出、分类、提示都在 A 站改了、B 站还是旧的）。这里一并推。
git add --ignore-removal public/ server.js navperf.js indexbuild.js 2>/dev/null || true

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
  COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "data: daily sync $(date +%F)") || { echo "commit-tree 失败"; exit 1; }
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
