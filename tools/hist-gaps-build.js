#!/usr/bin/env node
/* 历史净值「区间断档」清单（2026-11-13，第三方核验 P1-1）
   ------------------------------------------------------------------
   背景：原来的缺口监控只看「末点」（nav vs hist 末点），中间的整段空档看不见 ——
   新地 10 只 09-30 → 11-10 断了 26 个交易日，gap-check 一直报「真缺日：无」。
   同时 data/hist-gaps.json 是 10-29 的一次性产物，之后没人更新，前端却还在读它。

   本脚本：
     · 用「≥10% 基金都有净值的日期」当市场交易日历（避免把周末/假期算成缺日）；
     · 逐只扫自身序列，连续缺 ≥3 个交易日 → 记一段 gap；
     · 给每段一个 reason：monthly-early（2021 年前的月频期）/ source-outage（近 120 天内的源侧断档）/ source；
     · 写 data/hist-gaps.json（前端详情页据此显示提示）。

   用法：node tools/hist-gaps-build.js [--quiet]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HIST = path.join(ROOT, 'data', 'hist');
const FUNDS = path.join(ROOT, 'data', 'funds.json');
const OUT = path.join(ROOT, 'data', 'hist-gaps.json');
const MIN_GAP = 3;          /* 连续缺 ≥3 个交易日才算一段 */
const CAL_COVER = 0.10;     /* 覆盖率 ≥10% 的日期才算市场交易日 */

const quiet = process.argv.includes('--quiet');

function main() {
  const funds = JSON.parse(fs.readFileSync(FUNDS, 'utf8')).funds || [];
  const ids = funds.map((f) => String(f.id)).filter((id) => fs.existsSync(path.join(HIST, id + '.json')));

  /* 先建市场日历 */
  const cover = new Map();
  const seriesById = {};
  ids.forEach((id) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(HIST, id + '.json'), 'utf8'));
      const m = new Map((j.series || []).map(([d, v]) => [d, v]));
      seriesById[id] = m;
      m.forEach((_, d) => cover.set(d, (cover.get(d) || 0) + 1));
    } catch (e) { /* 跳过坏文件 */ }
  });
  const nFunds = Object.keys(seriesById).length;
  const cal = Array.from(cover.entries())
    .filter(([, n]) => n >= Math.max(2, Math.floor(nFunds * CAL_COVER)))
    .map(([d]) => d)
    .sort();

  const today = Date.now();
  const out = {};
  let withGap = 0;
  let recent = 0;

  Object.keys(seriesById).forEach((id) => {
    const m = seriesById[id];
    if (!m.size) return;
    let first = null;
    let last = null;
    m.forEach((_, d) => { if (!first || d < first) first = d; if (!last || d > last) last = d; });
    const gaps = [];
    let runStart = null;
    let runEnd = null;
    let runN = 0;
    const flush = () => {
      if (runN >= MIN_GAP) gaps.push([runStart, runEnd, runN]);
      runStart = null; runEnd = null; runN = 0;
    };
    for (let i = 0; i < cal.length; i++) {
      const d = cal[i];
      if (d < first || d > last) continue;
      if (m.has(d)) { flush(); continue; }
      if (!runStart) runStart = d;
      runEnd = d;
      runN++;
    }
    flush();
    if (!gaps.length) return;
    withGap++;
    /* 最近 120 天内的断档算「源侧近期断档」，更早的一般是早年月频 */
    const tail = gaps[gaps.length - 1];
    const fresh = (today - new Date(tail[1] + 'T00:00:00Z').getTime()) / 864e5 < 120;
    if (fresh) recent++;
    out[id] = {
      n: gaps.length,
      first: gaps[0][0],
      last: gaps[gaps.length - 1][1],
      gaps,
      reason: fresh ? 'source-outage' : 'monthly-early',
    };
  });

  const payload = { updatedAt: Date.now(), count: Object.keys(out).length, calendar: cal.length, minGap: MIN_GAP, funds: out };
  fs.writeFileSync(OUT, JSON.stringify(payload));
  if (!quiet) {
    console.log('[gaps] 市场日历 ' + cal.length + ' 日 · ' + nFunds + ' 只有历史 · 存在断档 ' + withGap + ' 只（近 120 天断档 ' + recent + ' 只）');
    const fresh = Object.entries(out).filter(([, v]) => v.reason === 'source-outage');
    if (fresh.length) {
      console.log('  近期断档：' + fresh.slice(0, 12).map(([id, v]) => '#' + id + ' ' + v.gaps[v.gaps.length - 1][0] + '~' + v.gaps[v.gaps.length - 1][1] + '(' + v.gaps[v.gaps.length - 1][2] + '日)').join(' '));
    }
  }
  return 0;
}

process.exit(main());
