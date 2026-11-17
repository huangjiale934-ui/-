#!/usr/bin/env node
/**
 * 把 hist 末点回填进 funds（2026-11-17）
 * =====================================
 * 背景：sync-hist-from-cloud 只补 data/hist/*.json，不会更新 funds.nav / funds.navAsOf，
 * 导致「历史已到 11-13、基金表还是 11-12」。server.js 读取时用 mergeLatestNav 临时补点，
 * 但派生文件（nav-perf / breadth / 导出）用的是 funds，必须先把数据层对齐。
 *
 * 规则（宁缺勿错）：
 *   · 只在 hist 末点日期 > funds.navAsOf 时回填；
 *   · 数值必须落在合理范围（|新/旧-1| < 20%），否则跳过并列出；
 *   · 同日期不覆盖（那是 nav-round4 / nav-recheck 的职责）。
 *
 * 用法：node tools/hist-apply-latest.js [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry');

const doc = JSON.parse(fs.readFileSync(path.join(DATA, 'funds.json'), 'utf8'));
let filled = 0;
let skipped = 0;
const odd = [];

for (const f of doc.funds || []) {
  if (!f.id) continue;
  let h;
  try {
    h = JSON.parse(fs.readFileSync(path.join(DATA, 'hist', String(f.id) + '.json'), 'utf8'));
  } catch (e) { continue; }
  const s = h.series || [];
  if (!s.length) continue;
  const last = s[s.length - 1];
  if (!f.navAsOf || last[0] <= f.navAsOf) continue;
  if (!(last[1] > 0)) continue;
  if (f.nav > 0 && Math.abs(last[1] / f.nav - 1) > 0.2) {
    skipped++;
    odd.push(f.id + ' ' + f.navAsOf + ':' + f.nav + ' → ' + last[0] + ':' + last[1]);
    continue;
  }
  if (!DRY) {
    f.nav = Math.round(last[1] * 10000) / 10000;
    f.navAsOf = last[0];
    if (!f.navSource && h.src) f.navSource = h.src;
  }
  filled++;
}

if (!DRY && filled) {
  fs.writeFileSync(path.join(DATA, 'funds.json'), JSON.stringify(doc), 'utf8');
}
console.log('[hist-apply] 回填 ' + filled + ' 只' + (skipped ? '｜数值异常跳过 ' + skipped + ' 只' : '') + (DRY ? '（dry-run 未写盘）' : ''));
odd.slice(0, 5).forEach((x) => console.log('  ! ' + x));
