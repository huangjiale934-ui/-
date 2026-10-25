/* 全量区间统计生成器 allstats.js
   为「未选基金时统计表列出全部基金」提供预计算数据（与 trend.js 口径一致）：
   · 区间收益 = 末值 ÷ 区间锚点（最后一个 ≤ 区间起点的点）− 1
   · 区间最大回撤 = 运行峰值法（含锚点段），并给出峰值/谷值日期
   窗口：w1 / m1 / y1 / y3 / y5 / all（各自以「该基金最后一个数据点」为终点）
   用法：node allstats.js   →   data/allstats.json */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'hist-index.json'), 'utf8'));
const funds = JSON.parse(fs.readFileSync(path.join(DATA, 'funds.json'), 'utf8')).funds;
const fundOf = {};
funds.forEach((f) => { fundOf[String(f.id)] = f; });

const ts = (d) => Date.parse(d + 'T00:00:00Z');
function minusRange(lastTs, key) {
  const d = new Date(lastTs);
  if (key === 'w1') d.setUTCDate(d.getUTCDate() - 7);
  else if (key === 'm1') d.setUTCMonth(d.getUTCMonth() - 1);
  else if (key === 'y1') d.setUTCFullYear(d.getUTCFullYear() - 1);
  else if (key === 'y3') d.setUTCFullYear(d.getUTCFullYear() - 3);
  else if (key === 'y5') d.setUTCFullYear(d.getUTCFullYear() - 5);
  return d.getTime();
}
const r2 = (x) => Math.round(x * 100) / 100;

const out = { updatedAt: Date.now(), note: '未选基金时统计表使用；口径与走势图一致', windows: { w1: {}, m1: {}, y1: {}, y3: {}, y5: {}, all: {} } };
let ok = 0;
Object.keys(idx.funds).forEach((id) => {
  const h = idx.funds[id];
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(path.join(DATA, 'hist', id + '.json'), 'utf8'));
  } catch (e) { return; }
  const ser = obj.series || [];
  if (ser.length < 5) return;
  const endTsAll = ts(ser[ser.length - 1][0]);
  const f0 = fundOf[id] || {};
  const base = { last: ser[ser.length - 1][1], asOf: ser[ser.length - 1][0], unit: f0.unit || '', name: f0.fund || obj.name, trustee: f0.trustee || '', typeFull: f0.typeFull || '' };
  ['w1', 'm1', 'y1', 'y3', 'y5', 'all'].forEach((w) => {
    const startTs = w === 'all' ? ts(ser[0][0]) : minusRange(endTsAll, w);
    /* 锚点 = 最后一个 ≤ 起点的点；没有则用首点 */
    let anchor = ser[0];
    for (let i = 0; i < ser.length; i++) { if (ts(ser[i][0]) <= startTs) anchor = ser[i]; else break; }
    const win = ser.filter((p) => ts(p[0]) >= ts(anchor[0]));
    if (win.length < 2) return;
    const last = win[win.length - 1][1];
    const ret = (last / anchor[1] - 1) * 100;
    /* 最大回撤（运行峰值法） */
    let peak = win[0][1], peakT = win[0][0], mdd = 0, fromT = '', toT = '';
    win.forEach(([d, v]) => {
      if (v > peak) { peak = v; peakT = d; }
      const dd = v / peak - 1;
      if (dd < mdd) { mdd = dd; fromT = peakT; toT = d; }
    });
    out.windows[w][id] = { r: r2(ret), d: r2(mdd * 100), f: fromT, t: toT, last: last, asOf: base.asOf, unit: base.unit, name: base.name, trustee: base.trustee, tf: base.typeFull };
  });
  ok++;
});
fs.writeFileSync(path.join(DATA, 'allstats.json'), JSON.stringify(out), 'utf8');
const sz = fs.statSync(path.join(DATA, 'allstats.json')).size;
console.log('allstats：' + ok + ' 只基金 × 6 窗口 → data/allstats.json（' + (sz / 1024).toFixed(0) + ' KB）');
