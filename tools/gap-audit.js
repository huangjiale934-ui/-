#!/usr/bin/env node
/* 日度净值断档全面清查（2026-10-22 修订）
   交易日历判定：某日「有数据的发行人个数 ≥3」且「有数据基金数 ÷ 当日存续基金数 ≥ 0.5」
   —— 两侧同时成立才记交易日，可自动排除周末与香港公众假期（假期只有个别发行人返回前值）
   断档 = 基金在 [首点, 末点] 内缺失的交易日；末点早于全站最新日另计「时效落后」
   用法：node tools/gap-audit.js [--json out.json] */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');

const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'hist-index.json'), 'utf8')).funds;
const fundsJ = JSON.parse(fs.readFileSync(path.join(DATA, 'funds.json'), 'utf8')).funds;
const byId = {};
fundsJ.forEach((f) => { byId[String(f.id)] = f; });

const series = {}, dateCount = {}, dateTrustee = {}, firsts = {}, lasts = {};
Object.keys(idx).forEach((id) => {
  const p = path.join(DATA, 'hist', id + '.json');
  if (!fs.existsSync(p)) return;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const s = (j.series || []).filter((x) => x && x[0]);
  if (!s.length) return;
  series[id] = s;
  firsts[id] = s[0][0];
  lasts[id] = s[s.length - 1][0];
  const tr = (byId[id] || {}).trustee || id;
  s.forEach((pt) => {
    dateCount[pt[0]] = (dateCount[pt[0]] || 0) + 1;
    (dateTrustee[pt[0]] = dateTrustee[pt[0]] || new Set()).add(tr);
  });
});

const lastDate = Object.keys(dateCount).sort().pop();

/* 存续计数：首末点之间都算存续 */
const alive = {};
Object.keys(series).forEach((id) => {
  const a = firsts[id], b = lasts[id];
  Object.keys(dateCount).forEach(() => {});
  series[id].forEach(() => {});
  // 只遍历候选日期集合，成本可控
});

const allDates = Object.keys(dateCount).sort();
allDates.forEach((d) => {
  let n = 0;
  Object.keys(series).forEach((id) => { if (firsts[id] <= d && d <= lasts[id]) n++; });
  alive[d] = n;
});

const tradeList = allDates.filter((d) => {
  const cov = dateCount[d] / Math.max(1, alive[d]);
  return dateCount[d] >= 20 && (dateTrustee[d] ? dateTrustee[d].size : 0) >= 3 && cov >= 0.5;
});

const rows = [];
Object.keys(series).forEach((id) => {
  const s = series[id];
  const have = new Set(s.map((p) => p[0]));
  const a = s[0][0], b = s[s.length - 1][0];
  const miss = [];
  for (const d of tradeList) { if (d > a && d < b && !have.has(d)) miss.push(d); }
  const f = byId[id] || {};
  rows.push({
    id, name: (f.fundBase || f.fund || '').slice(0, 30), trustee: f.trustee || '',
    first: a, last: b, points: s.length, miss, missN: miss.length, stale: b < lastDate,
  });
});
rows.sort((x, y) => y.missN - x.missN || x.id.localeCompare(y.id));

const buckets = { '0': 0, '1-2': 0, '3-5': 0, '6-20': 0, '21-100': 0, '>100': 0 };
rows.forEach((r) => {
  const m = r.missN;
  if (m === 0) buckets['0']++; else if (m <= 2) buckets['1-2']++; else if (m <= 5) buckets['3-5']++;
  else if (m <= 20) buckets['6-20']++; else if (m <= 100) buckets['21-100']++; else buckets['>100']++;
});

const missByDate = {};
rows.forEach((r) => r.miss.forEach((d) => { missByDate[d] = (missByDate[d] || 0) + 1; }));
const topMissDates = Object.entries(missByDate).sort((a, b) => b[1] - a[1]).slice(0, 20);

const byTrustee = {};
rows.forEach((r) => {
  const t = r.trustee || '(未知)';
  const o = byTrustee[t] = byTrustee[t] || { n: 0, withGap: 0, gapSum: 0, gapMax: 0, stale: 0 };
  o.n++; if (r.missN) { o.withGap++; o.gapSum += r.missN; o.gapMax = Math.max(o.gapMax, r.missN); }
  if (r.stale) o.stale++;
});

const staleDist = {};
rows.filter((r) => r.stale).forEach((r) => { staleDist[r.last] = (staleDist[r.last] || 0) + 1; });

console.log('=== 总览 ===');
console.log('基金数', rows.length, '| 交易日', tradeList.length, '| 区间', tradeList[0], '→', tradeList[tradeList.length - 1]);
console.log('断档分布', JSON.stringify(buckets));
console.log('\n=== 断档最多的 25 只 ===');
rows.slice(0, 25).forEach((r) => console.log(
  String(r.missN).padStart(5), '|', r.id.padEnd(5), r.name.padEnd(30), '|', r.trustee.padEnd(6),
  '|', r.first, '→', r.last, '|', String(r.points).padStart(5), '点 |',
  r.missN ? r.miss.slice ? r.miss.slice(0, 6).join(',') : '' : ''));
console.log('\n=== 缺口最集中的交易日（Top20） ===');
topMissDates.forEach(([d, n]) => console.log(d, String(n).padStart(4), '只缺失'));
console.log('\n=== 按发行人 ===');
Object.entries(byTrustee).sort((a, b) => b[1].gapSum - a[1].gapSum).forEach(([t, o]) => {
  console.log(t.padEnd(8), '有断档', String(o.withGap).padStart(3), '/', String(o.n).padStart(3),
    '| 缺口合计', String(o.gapSum).padStart(6), '| 单只最多', String(o.gapMax).padStart(5), '| 末点落后', o.stale);
});
console.log('\n=== 时效落后（末点 < 全站最新 ' + lastDate + '） ===');
console.log(JSON.stringify(staleDist), '合计', rows.filter((r) => r.stale).length, '只');

if (process.argv.includes('--json')) {
  const out = process.argv[process.argv.indexOf('--json') + 1];
  fs.writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(), lastDate, tradeDays: tradeList.length,
    buckets, staleDist, byTrustee,
    funds: rows.map((r) => ({ id: r.id, name: r.name, trustee: r.trustee, first: r.first, last: r.last, points: r.points, missN: r.missN, miss: r.miss.slice(0, 40) })),
  }, null, 1), 'utf8');
  console.log('\n[json] 已写出', out);
}
