#!/usr/bin/env node
/* MPF 市场平均指数（自算，2026-10-22）
   —— 口径：以各基金官网日度净值为基础，按日收益率加权链式累计（净价，不含分红再投资与费用）
   —— 权重：规模加权 = 基金资产规模（百万港元，积金局季度值，期内固定）；等权 = 1
   —— 基期：2015-01-02 = 1000（2015 年前多数基金只有月度价，另出月度指数精度不足，故不纳入）
   —— 输出：data/mpf-index.json，并合并进 data/index.json（供第三页「选择指数」直接选取）
   用法：node mpfindex.js [--no-merge]
*/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'hist');
const BASE_DATE = '2015-01-02';
const BASE_VAL = 1000;

const funds = JSON.parse(fs.readFileSync(path.join(DATA, 'funds.json'), 'utf8')).funds;
const byId = {};
funds.forEach((f) => { byId[String(f.id)] = f; });

/* 类别归并：基金种类 → 5 大类 */
function catOf(t) {
  const s = String(t || '');
  if (s.indexOf('股票') >= 0) return 'stock';
  if (s.indexOf('混合') >= 0) return 'mix';
  if (s.indexOf('債券') >= 0 || s.indexOf('债券') >= 0 || s.indexOf('債券') >= 0) return 'bond';
  if (s.indexOf('貨幣') >= 0 || s.indexOf('货币') >= 0) return 'money';
  if (s.indexOf('保證') >= 0 || s.indexOf('保证') >= 0) return 'guar';
  return 'other';
}

/* 读取全部序列 */
const series = {};   // id -> Map(date -> nav)
Object.keys(byId).forEach((id) => {
  const p = path.join(HIST, id + '.json');
  if (!fs.existsSync(p)) return;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const m = new Map();
    (j.series || []).forEach(([d, v]) => { if (v > 0) m.set(d, v); });
    if (m.size >= 2) series[id] = m;
  } catch (e) { /* ignore */ }
});
console.log('序列', Object.keys(series).length, '只');

/* 全站交易日历（并集，2015 起） */
const dates = new Set();
Object.values(series).forEach((m) => { m.forEach((v, d) => { if (d >= BASE_DATE) dates.add(d); }); });
const cal = Array.from(dates).sort();
console.log('交易日', cal.length, cal[0], '→', cal[cal.length - 1]);

/* 权重 */
const wSize = {};
Object.keys(series).forEach((id) => {
  const f = byId[id] || {};
  wSize[id] = Math.max(0, Number(f.size) || 0);
});

/* 加权链式：index[t] = index[t-1] * (1 + Σ w_i·r_i(t) / Σ w_i) */
function build(weightOf, filterFn) {
  const ids = Object.keys(series).filter((id) => (filterFn ? filterFn(byId[id] || {}) : true));
  let idx = BASE_VAL;
  const out = [[cal[0], idx]];
  let covered = 0, total = 0;
  for (let i = 1; i < cal.length; i++) {
    const d0 = cal[i - 1], d1 = cal[i];
    let sum = 0, wsum = 0, n = 0;
    for (const id of ids) {
      const m = series[id];
      const v1 = m.get(d1);
      if (v1 == null) continue;
      /* 取「上一个有值的日期」作为基准（允许个别基金中间停更一天） */
      let v0 = null;
      for (let k = i - 1; k >= 0 && k > i - 8; k--) {
        const vv = m.get(cal[k]);
        if (vv != null) { v0 = vv; break; }
      }
      if (!v0) continue;
      const r = v1 / v0 - 1;
      const w = weightOf[id];
      if (!(w > 0)) continue;
      sum += w * r; wsum += w; n++;
    }
    total++;
    if (n > 0 && wsum > 0) {
      idx = idx * (1 + sum / wsum);
      covered++;
    }
    out.push([d1, Math.round(idx * 100) / 100]);
  }
  return { series: out, coverage: total ? covered / total : 0 };
}

const catName = { stock: '股票基金', mix: '混合资产基金', bond: '债券基金', money: '货币市场基金', guar: '保证基金' };
const items = {};

/* 2026-10-22 性能：2022 年前降采样为「每周最后一个交易日」，把 4190 点压到约 1600 点，
   避免「选择指数」面板把 index.json 撑到 1MB+；2022 年起的日度点全部保留（近 1/3/5 年区间精度不受影响）。 */
function thin(series) {
  const out = [];
  let lastWeek = '';
  series.forEach(([d, v]) => {
    if (d >= '2022-01-01') { out.push([d, v]); return; }
    const t = new Date(d + 'T00:00:00Z');
    const wk = t.getUTCFullYear() + '-' + Math.floor((t.getTime() / 864e5 + 4) / 7);
    if (wk !== lastWeek) { lastWeek = wk; out.push([d, v]); }
    else { out[out.length - 1] = [d, v]; }   // 同一周保留最后一个交易日
  });
  return out;
}

function push(key, name, nameEn, res, count, extra) {
  const s = thin(res.series);
  const last = s[s.length - 1];
  items[key] = Object.assign({
    code: 'MPF.' + key,
    name, nameEn,
    first: s[0][0], asOf: last[0], points: s.length,
    series: s,
    selfCalc: true,
    source: '本站自算（发行人官网日度净值）',
    count,
    coverage: Math.round(res.coverage * 1000) / 1000,
  }, extra || {});
}

push('MPFAVG', 'MPF 市场平均指数（规模加权）', 'MPF Market Average Index (AUM-weighted)',
  build(wSize), Object.keys(series).length, { tip: '自算指数：按各基金资产规模加权，以官网日度净值计算日收益率后链式累计；基期 2015-01-02 = 1000；净价口径，不含分红再投资与费用。仅供参考，非积金局官方发布。' });
/* 2026-10-31（用户要求）：等权指数全部删除，五大类改规模加权（与 MPFAVG 同权重口径） */
Object.keys(catName).forEach((c) => {
  const res = build(wSize, (f) => catOf(f.type) === c);
  const n = Object.keys(series).filter((id) => catOf((byId[id] || {}).type) === c).length;
  if (n < 3) return;
  push('MPF_' + c.toUpperCase(), 'MPF ' + catName[c] + '指数（规模加权）', 'MPF ' + catName[c] + ' Index (AUM-weighted)',
    res, n, { tip: '自算指数：该类别内基金按资产规模加权；其余口径同 MPF 市场平均指数。仅供参考。' });
});

const out = {
  updatedAt: Date.now(),
  source: '东方财富行情（市场指数）+ 本站自算（MPF 市场平均指数）',
  baseDate: BASE_DATE, baseValue: BASE_VAL,
  note: '净价口径，不含分红再投资与费用；规模权重取积金局最近一期资产规模，期内固定；非积金局官方指数。',
  items,
};
fs.writeFileSync(path.join(DATA, 'mpf-index.json'), JSON.stringify(out), 'utf8');
console.log('已写出 data/mpf-index.json：', Object.keys(items).map((k) => k + '(' + items[k].points + ')').join(' '));

if (!process.argv.includes('--no-merge')) {
  const F = path.join(DATA, 'index.json');
  const j = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : { items: {} };
  j.items = j.items || {};
  Object.keys(items).forEach((k) => { j.items[k] = items[k]; });
  fs.writeFileSync(F, JSON.stringify(j), 'utf8');
  console.log('已合并进 data/index.json，共', Object.keys(j.items).length, '个指数');
}
