#!/usr/bin/env node
/* 持仓写入事务（2026-10-26 新增）
   背景：2026-10-26 季度抓取把 19 只 top10 名称写成空、20 只资产分布塌缩成 1 行；
        holdings-guard.js 是「写盘后」检查，坏数据已经落地，只能人工 diff + 回滚。
   用法：
     node tools/holdings-txn.js save              # 抓取前快照（data/holdings.json → tmp/holdings-txn.json）
     node tools/holdings-txn.js check             # 只检查，不写盘（exit 1 表示检测到退化）
     node tools/holdings-txn.js check --restore   # 检测到退化则整档回滚到快照，并列出退化的基金
   判定与 tools/holdings_filter.py / holdings-guard.js 规则 B 同口径：
     ① top10 名称非空 ② 合计 ≤100.5 ③ 无统计行/评级桶 ④ alloc 存在时行数 ≥2
   另加「缩水」判定：快照 top10 ≥3 条且现值 <快照 60%，或快照 alloc ≥2 行且现值 <2 行。
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = path.join(ROOT, 'data', 'holdings.json');
const SNAP = path.join(ROOT, 'tmp', 'holdings-txn.json');

const STAT = /Fund Risk Indicator|Yield to Maturity|Expense Ratio|Modified Duration|Credit Rating/i;
const BUCKET = /^(AAA|AA\/Aa|A|BBB\/Baa|BBB|B|CCC|Others\*)$/i;

function errs(e) {
  if (!e) return ['空条目'];
  const out = [];
  const t = e.top10 || [];
  if (t.length) {
    if (t.some((x) => !String((x && x.name) || '').trim())) out.push('空名称');
    const s = t.reduce((a, x) => a + (+((x && x.weight) || 0)), 0);
    if (s > 100.5) out.push('合计' + s.toFixed(1));
    if (t.some((x) => STAT.test(String((x && x.name) || '')) || BUCKET.test(String((x && x.name) || '').trim()))) out.push('统计行');
  }
  const a = e.alloc;
  if (a !== undefined && a !== null && a.length < 2) out.push('分布塌缩');
  return out;
}

function degraded(before, now) {
  const why = [];
  const eb = errs(before), en = errs(now);
  if (!eb.length && en.length) why.push('新增不合规:' + en.join('/'));
  const tb = (before.top10 || []).length, tn = (now.top10 || []).length;
  if (tb >= 3 && tn < Math.max(2, Math.floor(tb * 0.6))) why.push('top10 缩水 ' + tb + '→' + tn);
  const ab = (before.alloc || []).length, an = (now.alloc || []).length;
  if (ab >= 2 && an < 2) why.push('分布 ' + ab + '→' + an);
  return why;
}

function main() {
  const mode = process.argv[2] || 'check';
  const restore = process.argv.includes('--restore');
  if (mode === 'save') {
    if (!fs.existsSync(P)) { console.log('没有 holdings.json，跳过快照'); return 0; }
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    fs.copyFileSync(P, SNAP);
    const j = JSON.parse(fs.readFileSync(P, 'utf8'));
    const bad = Object.entries(j.funds || {}).filter(([, v]) => errs(v).length).length;
    console.log('持仓快照已保存 → ' + path.relative(ROOT, SNAP) + '（' + Object.keys(j.funds || {}).length + ' 只，其中不合规 ' + bad + ' 只）');
    return 0;
  }
  if (!fs.existsSync(SNAP)) { console.log('无快照，跳过事务校验（首次运行请先执行 save）'); return 0; }
  const before = JSON.parse(fs.readFileSync(SNAP, 'utf8')).funds || {};
  const nowAll = JSON.parse(fs.readFileSync(P, 'utf8'));
  const now = nowAll.funds || {};
  const bad = [];
  Object.keys(now).forEach((id) => {
    if (!before[id]) return;                       /* 新增条目不在事务范围（无对照基线） */
    const w = degraded(before[id], now[id]);
    if (w.length) bad.push(id + ':' + w.join(';'));
  });
  if (!bad.length) { console.log('持仓事务校验：零退化 ✅（对照 ' + Object.keys(before).length + ' 只）'); return 0; }
  console.log('持仓事务校验：检测到退化 ' + bad.length + ' 只');
  console.log('  ' + bad.slice(0, 20).join('\n  ') + (bad.length > 20 ? '\n  … 其余 ' + (bad.length - 20) + ' 只' : ''));
  if (restore) {
    fs.copyFileSync(SNAP, P);
    console.log('已整档回滚到抓取前快照（tmp/holdings-txn.json）');
  } else {
    console.log('未写盘（加 --restore 可回滚）');
  }
  return 1;
}
process.exit(main());
