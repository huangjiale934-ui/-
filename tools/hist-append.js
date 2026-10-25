#!/usr/bin/env node
/* 把 funds.json 的最新官方净值补进 hist 序列（2026-10-23）
   背景：navbuild 只更新 funds.json/nav.json，hist 由回补脚本维护，导致
   同一只基金在列表（funds.navAsOf）与详情（hist 末点）显示不同日期。
   规则：仅当 funds.navAsOf 晚于 hist 末点、且当日尚无点时追加一个点。
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const funds = JSON.parse(fs.readFileSync(path.join(D, 'funds.json'), 'utf8')).funds;
const idxP = path.join(D, 'hist-index.json');
const idx = JSON.parse(fs.readFileSync(idxP, 'utf8'));
let added = 0, fixed = 0;
funds.forEach((f) => {
  const id = String(f.id);
  if (!f.navAsOf || !(f.nav > 0)) return;
  const p = path.join(D, 'hist', id + '.json');
  if (!fs.existsSync(p)) return;
  let h;
  try { h = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return; }
  const s = h.series || [];
  if (!s.length) return;
  const last = s[s.length - 1];
  if (f.navAsOf > last[0]) {
    s.push([f.navAsOf, f.nav]);
    h.series = s; h.asOf = f.navAsOf; h.last = f.nav; h.points = s.length;
    fs.writeFileSync(p, JSON.stringify(h));
    if (idx.funds[id]) {
      idx.funds[id].asOf = f.navAsOf; idx.funds[id].last = f.nav;
      idx.funds[id].points = s.length;
    }
    added++;
  } else if (f.navAsOf < last[0]) {
    /* 官方净值日反而更早：说明 hist 里有源站已撤回的日期，记录但不删 */
    fixed++;
  }
});
fs.writeFileSync(idxP, JSON.stringify(idx));
console.log('[hist-append] 追加最新净值', added, '只；日期倒挂', fixed, '只');
