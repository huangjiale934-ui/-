#!/usr/bin/env node
/* 同计划内落后监控（2026-11-16，用户要求）
   ------------------------------------------------------------------
   背景：1525/1528 停在 11-10，而同计划另外 37 只已到 11-11；
   两站一致地错，site-diff 发现不了。唯一能发现的是「同一计划内部横向比较」。
   做法：按 scheme 分组，取该计划当天最大 navAsOf，逐只比较；
        落后 ≥1 个自然日即记录（月频计划整组同步前进，不会误报）。
   输出：data/plan-lag.json
        { at, maxDate, total, lagging, items:[{id,fund,scheme,asOf,maxDate,days}] }
   用法：node tools/plan-lag.js [--quiet]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FUNDS = path.join(ROOT, 'data', 'funds.json');
const OUT = path.join(ROOT, 'data', 'plan-lag.json');
const quiet = process.argv.includes('--quiet');

function dayGap(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
}

function main() {
  const funds = JSON.parse(fs.readFileSync(FUNDS, 'utf8')).funds || [];
  const groups = new Map();
  funds.forEach((f) => {
    if (!f.navAsOf || f.navStatus === 'na') return;
    const k = f.scheme || f.trustee || '未分组';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  });

  const items = [];
  let maxDate = '';
  groups.forEach((arr, scheme) => {
    const mx = arr.map((x) => x.navAsOf).sort().pop();
    if (mx > maxDate) maxDate = mx;
    arr.forEach((f) => {
      const d = dayGap(f.navAsOf, mx);
      if (d >= 1) {
        items.push({ id: String(f.id), fund: f.fund || '', scheme, asOf: f.navAsOf, maxDate: mx, days: d });
      }
    });
  });
  items.sort((a, b) => b.days - a.days || String(a.id).localeCompare(String(b.id)));

  const out = {
    at: new Date().toISOString(),
    maxDate,
    total: funds.length,
    lagging: items.length,
    items,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');

  if (!quiet) {
    console.log('[plan-lag] 全站最新 ' + maxDate + '，同计划内落后 ' + items.length + ' 只');
    items.slice(0, 12).forEach((x) => {
      console.log('  ' + x.id + ' ' + (x.fund || '').slice(0, 22) + ' | ' + x.scheme.slice(0, 18) +
        ' | ' + x.asOf + '（落后 ' + x.days + ' 天，计划内最新 ' + x.maxDate + '）');
    });
  }
  return 0;
}

process.exit(main());
