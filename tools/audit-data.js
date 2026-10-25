#!/usr/bin/env node
/* 数据齐全度体检（2026-10-22）
   输出：
   1) 净值序列「发行至今」覆盖率：hist 首点 vs 基金推出日
   2) 净值时效：navAsOf 距全站最新日
   3) 持仓 / 资产分布 缺口
   4) 明细 CSV（tmp/audit-detail.csv）
   用法：node tools/audit-data.js [--csv]
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');

const funds = JSON.parse(fs.readFileSync(path.join(D, 'funds.json'), 'utf8')).funds;
const idx = JSON.parse(fs.readFileSync(path.join(D, 'hist-index.json'), 'utf8')).funds;
const hold = JSON.parse(fs.readFileSync(path.join(D, 'holdings.json'), 'utf8')).funds;

const iso = (s) => {
  if (!s) return '';
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s);
};
const monthsBetween = (a, b) => {
  if (!a || !b) return null;
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};

const rows = [];
funds.forEach((f) => {
  const id = String(f.id);
  const h = idx[id] || {};
  const ho = hold[id] || {};
  const launch = iso(f.launch);
  const first = h.first || '';
  const gapM = launch && first ? monthsBetween(launch, first) : null;
  rows.push({
    id, fund: f.fundBase || f.fund, trustee: f.trustee, scheme: f.scheme, type: f.type,
    launch, first, asOf: h.asOf || '', points: h.points || 0,
    gapM: gapM == null ? '' : gapM,
    navAsOf: f.navAsOf || '',
    top10: (ho.top10 || []).length, alloc: (ho.alloc || []).length, holdAsOf: ho.asOf || '',
  });
});

const LAST = rows.map((r) => r.asOf).filter(Boolean).sort().pop();
const NAVLAST = rows.map((r) => r.navAsOf).filter(Boolean).sort().pop();

/* —— 1) 发行至今覆盖 —— */
const buckets = { '≤0（发行即开始）': 0, '1–6 个月': 0, '7–24 个月': 0, '25–60 个月': 0, '>60 个月': 0, '无净值或未知': 0 };
rows.forEach((r) => {
  if (!r.points || r.gapM === '') { buckets['无净值或未知']++; return; }
  const g = Number(r.gapM);
  if (g <= 0) buckets['≤0（发行即开始）']++;
  else if (g <= 6) buckets['1–6 个月']++;
  else if (g <= 24) buckets['7–24 个月']++;
  else if (g <= 60) buckets['25–60 个月']++;
  else buckets['>60 个月']++;
});
console.log('=== 1) 净值序列起点 vs 基金推出日 ===');
console.log('总基金', rows.length, '| 序列末点', LAST, '| 净值日', NAVLAST);
Object.entries(buckets).forEach(([k, v]) => console.log('  ', k.padEnd(14), v, '只'));

const worst = rows.filter((r) => r.gapM !== '' && Number(r.gapM) > 24)
  .sort((a, b) => Number(b.gapM) - Number(a.gapM));
console.log('\n起点晚于推出日 2 年以上的（前 25）：');
worst.slice(0, 25).forEach((r) => console.log('  ', r.gapM + '月', r.first, '|', r.id.padEnd(5), r.fund.slice(0, 26).padEnd(28), r.trustee));

/* —— 2) 时效 —— */
console.log('\n=== 2) 净值时效（全站最新 ' + NAVLAST + '）===');
const stale = {};
rows.forEach((r) => { const k = r.navAsOf || '无'; stale[k] = (stale[k] || 0) + 1; });
Object.entries(stale).sort().forEach(([k, v]) => console.log('  ', k, v, '只'));

/* —— 3) 持仓 / 分布 —— */
console.log('\n=== 3) 持仓与资产分布 ===');
const noTop = rows.filter((r) => !r.top10);
const noAlloc = rows.filter((r) => !r.alloc);
console.log('无十大持仓', noTop.length, '只 | 无资产分布', noAlloc.length, '只');
const byT = {};
rows.forEach((r) => {
  const t = r.trustee || '?';
  const o = byT[t] = byT[t] || { n: 0, noTop: 0, noAlloc: 0 };
  o.n++; if (!r.top10) o.noTop++; if (!r.alloc) o.noAlloc++;
});
Object.entries(byT).sort().forEach(([t, o]) => console.log('  ', t.padEnd(8), '共', String(o.n).padStart(3), '| 缺持仓', String(o.noTop).padStart(3), '| 缺分布', String(o.noAlloc).padStart(3)));

/* —— 4) 无净值序列的基金 —— */
console.log('\n=== 4) 完全没有历史净值的基金 ===');
const noHist = rows.filter((r) => !r.points);
console.log('共', noHist.length, '只');
noHist.slice(0, 20).forEach((r) => console.log('  ', r.id, r.fund, '|', r.trustee, '| launch', r.launch));

if (process.argv.includes('--csv')) {
  const head = 'id,基金,受托人,计划,类别,推出日,序列首日,缺口月数,序列末点,点数,净值日,十大持仓,资产分布,持仓截止';
  const lines = rows.map((r) => [r.id, r.fund, r.trustee, r.scheme, r.type, r.launch, r.first, r.gapM, r.asOf, r.points, r.navAsOf, r.top10, r.alloc, r.holdAsOf]
    .map((x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(','));
  const out = path.join(__dirname, '..', 'tmp', 'audit-detail.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '\ufeff' + head + '\n' + lines.join('\n'), 'utf8');
  console.log('\n[csv] 已写出', out);
}
