#!/usr/bin/env node
/* 净值三处一致性巡检（2026-10-23，核验报告 P0）
   比对：funds.nav（列表/详情头） ↔ hist 末点 ↔ navperf.asOf
   规则：同一日期下 |funds.nav / hist末点 − 1| > 0.1% 记不一致；日期不一致单独列出。
   用法：node tools/nav-consistency.js [--strict]
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const funds = JSON.parse(fs.readFileSync(path.join(D, 'funds.json'), 'utf8')).funds;
let perf = { funds: {} };
try { perf = JSON.parse(fs.readFileSync(path.join(D, 'nav-perf.json'), 'utf8')); } catch (e) {}

let badVal = [], badDate = [], missing = 0;
funds.forEach((f) => {
  const id = String(f.id);
  const hp = path.join(D, 'hist', id + '.json');
  if (!fs.existsSync(hp)) { missing++; return; }
  const h = JSON.parse(fs.readFileSync(hp, 'utf8'));
  const last = (h.series || []).slice(-1)[0];
  if (!last) { missing++; return; }
  if (f.nav && Math.abs(last[1] / f.nav - 1) > 0.001) {
    badVal.push(id + ' ' + (f.fund || '').slice(0, 12) + ' nav=' + f.nav + ' hist=' + last[1] + ' 差' + ((last[1] / f.nav - 1) * 100).toFixed(2) + '%');
  }
  if (f.navAsOf && last[0] !== f.navAsOf) {
    badDate.push(id + ' navAsOf=' + f.navAsOf + ' hist=' + last[0]);
  }
  const p = (perf.funds || {})[id];
  if (p && p.asOf && f.navAsOf && p.asOf !== f.navAsOf) {
    badDate.push(id + ' navperf=' + p.asOf + ' navAsOf=' + f.navAsOf);
  }
});

console.log('净值一致性巡检：' + funds.length + ' 只（无历史 ' + missing + '）');
console.log('  数值不一致：' + badVal.length);
badVal.slice(0, 10).forEach((x) => console.log('    ' + x));
console.log('  日期不一致：' + badDate.length);
badDate.slice(0, 10).forEach((x) => console.log('    ' + x));
process.exit(process.argv.includes('--strict') && (badVal.length || badDate.length) ? 1 : 0);
