#!/usr/bin/env node
/**
 * 数据抽样核验（2026-10-29，5.0）
 * 从不同发行人/类型抽 12 只，核对：
 *   A. funds.nav 与 hist 同日点一致（末点落后只提示，不强行对齐）
 *   B. 自算近 1 年回报与 hist 重算一致（容差 0.15pp）
 *   C. 持仓 top10 权重非负、合计 ≤100.5；alloc 合计合理（现金可为负，幅度 ≤5%）
 *   D. 风险级别、推出日期、历年回报字段形态
 * 输出 data/spot-check-report.json；FAIL 项退出码 1。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const funds = read('funds.json').funds || [];
const perf = read('nav-perf.json').funds || {};
const holds = read('holdings.json').funds || {};
/* 每个净值来源取前 2 只，再补无风险评级、无近5年、无净值日期等边界样本 */
const AUTO = (() => {
  const bySrc = {};
  funds.forEach((f) => {
    const k = String(f.navSource || '未标').split('｜')[0];
    (bySrc[k] = bySrc[k] || []).push(f);
  });
  const ids = [];
  Object.values(bySrc).forEach((list) => list.slice(0, 2).forEach((f) => ids.push(String(f.id))));
  funds.filter((f) => f.risk == null).slice(0, 3).forEach((f) => ids.push(String(f.id)));
  funds.filter((f) => f.selfY5a == null).slice(0, 3).forEach((f) => ids.push(String(f.id)));
  funds.filter((f) => f.navStatus === 'na').slice(0, 2).forEach((f) => ids.push(String(f.id)));
  return Array.from(new Set(ids));
})();
const SAMPLES = AUTO;
const byId = Object.fromEntries(funds.map((f) => [String(f.id), f]));
const fails = [];
const warns = [];
const rows = [];

function num(v) { return typeof v === 'number' && isFinite(v); }
function daysBetween(a, b) { return Math.round((new Date(a) - new Date(b)) / 864e5); }

SAMPLES.forEach((id) => {
  const x = byId[id];
  const rec = { id, name: x ? x.fundBase : '(缺失)', checks: [] };
  if (!x) { fails.push(id + '：funds.json 无此基金'); rows.push(rec); return; }
  const p = perf[id] || null;
  const h = holds[id] || null;
  let hist = null;
  try { hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hist', id + '.json'), 'utf8')); } catch (e) {}

  /* A 净值与历史 */
  if (x.navStatus === 'verified') {
    if (!num(x.nav)) fails.push(id + '：verified 但 nav 非数值');
    if (!x.navAsOf) fails.push(id + '：verified 但无估值日');
    if (hist && Array.isArray(hist.series) && hist.series.length) {
      const last = hist.series[hist.series.length - 1];
      const same = hist.series.find((r) => r[0] === x.navAsOf);
      if (same && num(x.nav) && Math.abs(same[1] - x.nav) > 0.0002) {
        fails.push(id + '：funds.nav=' + x.nav + ' 与 hist 同日点 ' + same[1] + ' 不一致');
      }
      if (x.navAsOf && last[0] < x.navAsOf) {
        warns.push(id + '：hist 末点 ' + last[0] + ' 早于估值日 ' + x.navAsOf);
      }
      const badDate = hist.series.find((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r[0]) || r[0] > new Date().toISOString().slice(0, 10));
      if (badDate) fails.push(id + '：hist 有异常日期 ' + badDate[0]);
      const badVal = hist.series.find((r) => !num(r[1]) || r[1] <= 0);
      if (badVal) fails.push(id + '：hist 有非正净值 ' + badVal[0] + '=' + badVal[1]);
    } else if (x.navStatus === 'verified') {
      warns.push(id + '：无 hist 文件，走势图会空');
    }
  }

  /* B 自算近 1 年 */
  if (p && hist && hist.series.length > 20 && num(p.y1)) {
    const last = hist.series[hist.series.length - 1];
    const target = new Date(last[0]); target.setFullYear(target.getFullYear() - 1);
    const tstr = target.toISOString().slice(0, 10);
    let base = hist.series[0];
    for (const r of hist.series) { if (r[0] <= tstr) base = r; else break; }
    if (num(base[1]) && base[1] > 0) {
      const calc = (last[1] / base[1] - 1) * 100;
      if (Math.abs(calc - p.y1) > 0.15) {
        fails.push(id + '：自算近1年 ' + p.y1.toFixed(2) + '% 与 hist 重算 ' + calc.toFixed(2) + '% 不一致');
      } else {
        rec.y1 = { perf: p.y1, recalc: Number(calc.toFixed(2)) };
      }
    }
  }

  /* C 持仓 */
  if (h && h.top10) {
    const bad = h.top10.find((t) => !num(t.weight) || t.weight < 0 || t.weight > 100);
    if (bad) fails.push(id + '：持仓权重异常 ' + (bad.name || '?') + '=' + bad.weight);
    const sum = h.top10.reduce((a, t) => a + (t.weight || 0), 0);
    if (sum > 100.5) fails.push(id + '：前十大合计 ' + sum.toFixed(2) + '% > 100%');
    if (h.alloc && h.alloc.length) {
      const asum = h.alloc.reduce((a, t) => a + (+t.weight || 0), 0);
      if (asum > 102) fails.push(id + '：分布合计 ' + asum.toFixed(2) + '% 异常');
      const neg = h.alloc.find((t) => (+t.weight || 0) < -5);
      if (neg) fails.push(id + '：分布有大幅负值 ' + neg.label + '=' + neg.weight);
      rec.allocSum = Number(asum.toFixed(2));
    }
    rec.top10Sum = Number(h.top10.reduce((a, t) => a + (t.weight || 0), 0).toFixed(2));
  } else {
    warns.push(id + '：无持仓数据');
  }

  /* D 字段形态 */
  if (x.risk != null && (!Number.isInteger(x.risk) || x.risk < 1 || x.risk > 7)) fails.push(id + '：风险级别异常 ' + x.risk);
  if (x.launch && !/^\d{2}-\d{2}-\d{4}$/.test(x.launch) && !/^\d{4}-\d{2}-\d{2}$/.test(x.launch)) {
    warns.push(id + '：推出日期格式 ' + x.launch);
  }
  if (x.cal && typeof x.cal !== 'object') fails.push(id + '：cal 不是对象');
  if (x.cum1 != null && x.ann1 != null && Math.abs(x.cum1 - x.ann1) > 0.05) {
    warns.push(id + '：近1年累计与年化不一致（cum1=' + x.cum1 + ', ann1=' + x.ann1 + '）');
  }

  rec.source = x.navSource;
  rec.asOf = x.navAsOf;
  rows.push(rec);
});

const report = {
  generatedAt: new Date().toISOString(),
  samples: rows,
  failCount: fails.length,
  warnCount: warns.length,
  fails,
  warns,
};
fs.writeFileSync(path.join(ROOT, 'data', 'spot-check-report.json'), JSON.stringify(report, null, 2));
console.log('抽样 ' + rows.length + ' 只：FAIL ' + fails.length + '，WARN ' + warns.length);
fails.forEach((f) => console.log('  ✘ ' + f));
warns.forEach((w) => console.log('  ! ' + w));
process.exit(fails.length ? 1 : 0);
