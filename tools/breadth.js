#!/usr/bin/env node
/* 首屏「近日基金上涨」占比 —— 唯一口径生成器（2026-11-13，第五十三轮）
 *
 * 为什么要有这个文件：
 *   原实现里「本周占比」取 nav-perf 的 w1（navperf.js 有 gap1<=20 护栏、有补点），
 *   「上周占比」却在 server.js 里另写一段读 hist 手算（无护栏、无补点、按每只基金
 *   自己的末点算窗口）。于是：
 *     · 两套口径相减 → delta 本身不可比；
 *     · 分母不同（WB 450 / GH 440）→ 同一时刻两站能差 4 个百分点（+1 / -3）。
 *   现改为：本周与上周用**同一个函数、同一批基金、同一个基准日**算，结果落盘
 *   data/breadth.json，两站都读这一份，site-diff 逐字段比对。
 *
 * 口径（对称）：
 *   asOf      = 全站 hist 末点日期的最大值（不是「多数」也不是「本机今天」）
 *   e         = 该基金最后一个 ≤ asOf 的净值点
 *   i7 / i14  = 从 e 的日期往前 7 / 14 个自然日，取最后一个 ≤ 目标日的点
 *   入样条件  = i7、i14 都存在，且窗口没有被断档拉长
 *               （e−i7 与 i7−i14 各自的实际跨度 ≤ 11 天；正常一周 5 个交易日 + 周末 + 假期 ≤ 11）
 *   本周涨跌  = e / i7 − 1
 *   上周涨跌  = i7 / i14 − 1
 *   pct       = 本周上涨只数 / 入样只数
 *   pctPrev   = 上周上涨只数 / 入样只数      ← 同一分母
 *   delta     = pct − pctPrev（百分点）
 *   pctDay    = 单日上涨只数 / 入样只数（同样只统计入样基金，避免三个数的分母各不相同）
 *
 * 断档基金（如新地 10 只 10 月缺 26 个交易日）会被入样条件排除，不再用「41 天涨幅」
 * 冒充「一周涨幅」——这正是 GH 与 WB 分母差 10 的来源。
 *
 * 用法：node tools/breadth.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const DATA = path.join(BASE, 'data');
const OUT = path.join(DATA, 'breadth.json');

const iso = (d) => d.toISOString().slice(0, 10);
const minusDays = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() - n);
  return iso(x);
};
const dayGap = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5);

/* 最后一个 date <= d 的下标，找不到返回 -1 */
function idxAt(series, d) {
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (series[m][0] <= d) { ans = m; lo = m + 1; } else { hi = m - 1; }
  }
  return ans;
}

/* 一周窗口允许的最大自然日跨度：正常 5 个交易日 + 前后周末 = 7，
   遇公众假期给到 11；超过 11 天说明中间有断档，不能当「一周」用。 */
const MAX_SPAN = 11;

function compute(opts) {
  const o = opts || {};
  const perf = JSON.parse(fs.readFileSync(path.join(DATA, 'nav-perf.json'), 'utf8')).funds || {};
  let idx = { items: {} };
  try { idx = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8')); } catch (e) { /* 指数缺失不影响占比 */ }

  const ids = Object.keys(perf);
  const seriesOf = new Map();
  let asOf = '';
  for (const id of ids) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(DATA, 'hist', id + '.json'), 'utf8'));
      const s = (j && j.series) || [];
      if (!s.length) continue;
      seriesOf.set(id, s);
      const last = s[s.length - 1][0];
      if (last > asOf) asOf = last;
    } catch (e) { /* 无 hist 的基金（声明 NA）跳过 */ }
  }

  let total = 0;
  let up = 0;
  let upPrev = 0;
  let upDay = 0;
  const excl = { noHist: 0, short: 0, gap: 0, stale: 0 };
  const staleness = [];
  /* 2026-11-13（用户要求）：明细也落盘 —— 出问题时直接对名单，不用重算。
     三组：本周上涨 / 本周下跌 / 上述两者之外的入样基金（持平），
     以及被剔除的基金与原因。 */
  const upIds = [];
  const downIds = [];
  const flatIds = [];
  const upPrevIds = [];
  const downPrevIds = [];
  const exclIds = { noHist: [], short: [], gap: [], stale: [] };

  for (const id of ids) {
    const s = seriesOf.get(id);
    if (!s) { excl.noHist++; exclIds.noHist.push(id); continue; }
    if (s.length < 3) { excl.short++; exclIds.short.push(id); continue; }
    /* 基准日对齐：只取 ≤ asOf 的末点，避免某只基金多一天就自成一套窗口 */
    let e = s.length - 1;
    while (e >= 0 && s[e][0] > asOf) e--;
    if (e < 0) { excl.noHist++; exclIds.noHist.push(id); continue; }
    const lastDate = s[e][0];
    const d7 = minusDays(lastDate, 7);
    const d14 = minusDays(lastDate, 14);
    const i7 = idxAt(s, d7);
    const i14 = idxAt(s, d14);
    if (i7 < 0 || i14 < 0 || !s[i7][1] || !s[i14][1]) { excl.short++; exclIds.short.push(id); continue; }
    const span1 = dayGap(lastDate, s[i7][0]);
    const span2 = dayGap(s[i7][0], s[i14][0]);
    if (span1 > MAX_SPAN || span2 > MAX_SPAN) { excl.gap++; exclIds.gap.push(id); continue; }
    /* 末日落后基准日太多（>7 天）视为停更，不参与，避免用陈旧值投票 */
    if (dayGap(asOf, lastDate) > 7) { excl.stale++; exclIds.stale.push(id + '@' + lastDate); staleness.push(id + '@' + lastDate); continue; }

    total++;
    const r1 = s[e][1] / s[i7][1] - 1;
    const r0 = s[i7][1] / s[i14][1] - 1;
    if (r1 > 0) { up++; upIds.push(id); } else if (r1 < 0) downIds.push(id); else flatIds.push(id);
    if (r0 > 0) { upPrev++; upPrevIds.push(id); } else if (r0 < 0) downPrevIds.push(id);
    const x = perf[id];
    if (x && x.d1 != null && x.asOf === lastDate && x.d1 > 0) upDay++;
  }

  const pct = total ? Math.round((up / total) * 100) : null;
  const pctPrev = total ? Math.round((upPrev / total) * 100) : null;
  const pctDay = total ? Math.round((upDay / total) * 100) : null;
  const delta = (pct != null && pctPrev != null) ? pct - pctPrev : null;

  /* 迷你柱：市场平均指数最近 7 个交易日 */
  const mpf = (idx.items && idx.items.MPFAVG && idx.items.MPFAVG.series) || [];
  const days = [];
  for (let i = Math.max(1, mpf.length - 7); i < mpf.length; i++) {
    const a = mpf[i - 1][1];
    const b = mpf[i][1];
    days.push({ d: mpf[i][0], chg: a ? Math.round((b / a - 1) * 10000) / 100 : 0 });
  }

  return {
    asOf,
    total,
    up,
    pct,
    upPrev,
    pctPrev,
    delta,
    pctDay,
    prevAsOf: asOf ? minusDays(asOf, 7) : null,
    days,
    excluded: excl,
    /* 明细名单（升序，便于 diff）：出问题时可直接对名单，不必重算 */
    upIds: upIds.sort(),
    downIds: downIds.sort(),
    flatIds: flatIds.sort(),
    upPrevIds: upPrevIds.sort(),
    downPrevIds: downPrevIds.sort(),
    excludedIds: exclIds,
    staleSample: staleness.slice(0, 5),
    generatedAt: new Date().toISOString(),
  };
}

function main() {
  const dry = process.argv.includes('--dry');
  const r = compute();
  const line = `[breadth] asOf ${r.asOf} 入样 ${r.total} 只（剔除 ${JSON.stringify(r.excluded)}）` +
    ` 本周 ${r.pct}%（${r.up}/${r.total}） 上周 ${r.pctPrev}%（${r.upPrev}/${r.total}） 差 ${r.delta} pp`;
  console.log(line);
  if (r.total < 380) {
    console.error('[breadth] 入样只数偏少（<380），疑似 hist 大面积缺失，拒绝落盘');
    process.exit(1);
  }
  if (!dry) {
    fs.writeFileSync(OUT, JSON.stringify(r), 'utf8');
    console.log('[breadth] 已写入 data/breadth.json');
  }
}

if (require.main === module) main();
module.exports = { compute, MAX_SPAN };
