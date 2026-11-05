#!/usr/bin/env node
/* 净值异动自动判定（2026-11-05 第三十九轮，用户要求「每天自动判断数据是否有误」）

背景（都是真实发生过的）：
  · 2026-10-30 BCT 把 23.3134 报成 24.2958（源站错价）
  · 2026-11-03 BCT 同一基金的两个单位类别被写成同一个价格（我们的抓取串档）
  · 2026-11-03 景順環球債券基金一天 +2.95%（同类债券基金 −0.1%~−0.3%）

判定分两类，互不干扰：

  ① 单位类别串档（高置信，几乎不误报）
     同一计划同一基金有多个单位类别，某天两个类别的净值完全相同，
     而它们在之前 20 个交易日里是有差别的 → 判定为串档。

  ② 单日异常（源站错价）
     同时满足：
       a) |当日涨跌| > max(类别上限, 5 × 该基金自身近一年日波动率)
       b) 与「同类别当日中位数」的偏离 > max(2.0, 10 × MAD)
     第一条把「韩国股票基金一天涨 5%」这类真实行情排除掉，
     只留下「这只基金平时很稳、今天突然跳」的情况。

输出：data/anomaly.json（页面/体检可读）+ 日志。退出码恒为 0（只告警）。

用法：node tools/anomaly-check.js [--days 5] [--json]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'hist');
const OUT = path.join(DATA, 'anomaly.json');

const args = process.argv.slice(2);
const DAYS = (() => { const i = args.indexOf('--days'); return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 5) : 5; })();
const JSON_ONLY = args.includes('--json');

const LIMIT = {
  '債券基金': 1.2,
  '货币市场基金': 0.4,
  '保證基金': 1.0,
  '混合資產基金': 2.5,
  '股票基金': 4.5,
};
function limitOf(type) {
  const t = String(type || '');
  if (t.indexOf('貨幣市場') === 0) return LIMIT['货币市场基金'];
  for (const k of Object.keys(LIMIT)) if (t.indexOf(k) >= 0) return LIMIT[k];
  return 3.0;
}
const median = (arr) => {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const stdev = (arr) => {
  if (arr.length < 20) return null;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1));
};

function main() {
  const funds = JSON.parse(fs.readFileSync(path.join(DATA, 'funds.json'), 'utf8')).funds || [];
  const rows = [];
  funds.forEach((f) => {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(HIST, f.id + '.json'), 'utf8')); } catch (e) { return; }
    const s = j.series || [];
    if (s.length < 2) return;
    const chgs = [];
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1][1], b = s[i][1];
      if (a > 0) chgs.push({ d: s[i][0], chg: (b / a - 1) * 100 });
    }
    const recent = chgs.slice(-250).map((x) => x.chg);
    rows.push({
      id: f.id, name: f.fundBase || f.fund, unit: f.unit || '', scheme: f.scheme || '',
      type: f.type || '', series: s, pts: chgs.slice(-DAYS), sigma: stdev(recent),
    });
  });

  /* ---------- ① 单位类别串档 ---------- */
  const groups = {};
  rows.forEach((r) => {
    const k = r.scheme + '|' + r.name;
    (groups[k] = groups[k] || []).push(r);
  });
  const classDup = [];
  Object.keys(groups).forEach((k) => {
    const g = groups[k];
    if (g.length < 2) return;
    const byDate = {};                       /* date → [{unit, v, id}] */
    g.forEach((r) => r.series.slice(-(DAYS + 25)).forEach(([d, v]) => {
      (byDate[d] = byDate[d] || []).push({ unit: r.unit || '-', v, id: r.id, name: r.name, scheme: r.scheme, type: r.type });
    }));
    const dates = Object.keys(byDate).sort();
    dates.slice(-DAYS).forEach((d) => {
      const arr = byDate[d];
      if (arr.length < 2) return;
      const vals = arr.map((a) => a.v);
      if (vals.length === new Set(vals).size) return;      /* 没有重复值 */
      /* 之前 20 个交易日里这些类别是否有「明显」差别：
         有差别才算串档；像景順中港 A/H 只差 0.001（四舍五入后偶尔相同）不算。 */
      const prior = dates.filter((x) => x < d).slice(-20);
      let differed = 0;
      const gaps = [];
      prior.forEach((pd) => {
        const pv = (byDate[pd] || []).map((a) => a.v);
        if (pv.length >= 2 && pv.length === new Set(pv).size) differed++;
        if (pv.length >= 2) gaps.push(Math.abs(pv[0] - pv[1]) / Math.max(1e-9, pv[0]) * 100);
      });
      if (differed < 10) return;
      const typicalGap = median(gaps) || 0;
      if (typicalGap < 0.05) return;          /* 两类本来就几乎同价，忽略 */
      classDup.push({ date: d, scheme: arr[0].scheme, name: arr[0].name, units: arr.map((a) => a.unit).join('/'), value: vals[0] });
    });
  });

  /* ---------- ② 单日异常 ---------- */
  const groups2 = {};
  rows.forEach((r) => r.pts.forEach((p) => {
    const k = p.d + '|' + r.type;
    (groups2[k] = groups2[k] || []).push(p.chg);
  }));
  const stats = {};
  Object.keys(groups2).forEach((k) => {
    const arr = groups2[k];
    if (arr.length < 5) return;
    const med = median(arr);
    stats[k] = { med, mad: median(arr.map((x) => Math.abs(x - med))), n: arr.length };
  });
  const outliers = [];
  rows.forEach((r) => {
    const base = limitOf(r.type);
    const lim = Math.max(base, 5 * (r.sigma || 0));
    r.pts.forEach((p) => {
      const st = stats[p.d + '|' + r.type];
      if (!st) return;
      const dev = Math.abs(p.chg - st.med);
      if (Math.abs(p.chg) > lim && dev > Math.max(2.0, st.mad * 10)) {
        outliers.push({
          date: p.d, id: r.id, name: r.name, unit: r.unit, scheme: r.scheme, type: r.type,
          chg: +p.chg.toFixed(2), peerMedian: +st.med.toFixed(2), dev: +dev.toFixed(2),
          peers: st.n, limit: +lim.toFixed(2), sigma: r.sigma ? +r.sigma.toFixed(2) : null,
        });
      }
    });
  });

  const dates = Array.from(new Set(rows.flatMap((r) => r.pts.map((p) => p.d)))).sort().slice(-DAYS);
  const out = {
    generatedAt: new Date().toISOString(),
    window: dates,
    scanned: rows.length,
    classDup,
    outliers,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0));

  if (JSON_ONLY) { console.log(JSON.stringify(out)); return; }
  console.log('[anomaly] 扫描 %d 只 · 窗口 %s ~ %s · 串档 %d · 异常 %d',
    rows.length, dates[0] || '—', dates[dates.length - 1] || '—', classDup.length, outliers.length);
  classDup.slice(0, 8).forEach((x) => {
    console.log('  ! %s %s %s：单位类别 %s 取到同一个值 %s（之前是有差别的 → 疑似串档）',
      x.date, x.scheme.slice(0, 12), x.name.slice(0, 18), x.units, x.value);
  });
  outliers.slice(0, 8).forEach((x) => {
    console.log('  ! %s %s %s 单日 %s%%（同类中位数 %s%%，偏离 %s 个百分点，5σ=%s%%，%d 只样本）',
      x.date, x.scheme.slice(0, 12), (x.name + (x.unit ? ' ' + x.unit : '')).slice(0, 22),
      x.chg, x.peerMedian, x.dev, x.limit, x.peers);
  });
  if (classDup.length || outliers.length) {
    console.log('  → 已写 data/anomaly.json。连续 2 天仍报同一只，多为源站错价，需人工核对官网原件。');
  }
}

main();
