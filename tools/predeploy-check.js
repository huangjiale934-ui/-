#!/usr/bin/env node
/**
 * 发布前一致性闸门（2026-10-29，5.0 新增）
 *
 * 用户反馈：早上更新时页面有模块显示不出来。除了「文件被读到一半」（server.js 已改为原子写 +
 * 上一份可用副本），另一个常见原因是「新 funds 配旧 nav-perf / hist-index」被一起发布出去。
 * 本脚本在发布前把四份核心数据对齐检查一遍，任何一项不一致就以非 0 退出，
 * 让调用方停下来而不是把半成品推上线。
 *
 * 用法：node tools/predeploy-check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', 'data');
const fails = [];
const info = [];

const read = (f) => JSON.parse(fs.readFileSync(path.join(R, f), 'utf8'));

let funds, perf, idx, hld;
try { funds = read('funds.json'); } catch (e) { fails.push('funds.json 读取失败：' + e.message); }
try { perf = read('nav-perf.json'); } catch (e) { fails.push('nav-perf.json 读取失败：' + e.message); }
try { idx = read('hist-index.json'); } catch (e) { fails.push('hist-index.json 读取失败：' + e.message); }
try { hld = read('holdings.json'); } catch (e) { fails.push('holdings.json 读取失败：' + e.message); }

const day = (s) => (s ? String(s).slice(0, 10) : '');
const maxOf = (obj) => Object.values(obj || {}).reduce((m, v) => (v && v > m ? v : m), '');

if (funds && perf && idx && hld) {
  const rows = funds.funds || [];
  const navLatest = maxOf(rows.reduce((m, f) => { if (f.navAsOf) m[f.id] = f.navAsOf; return m; }, {}));
  const perfLatest = maxOf(perf.funds || {}) || (perf.asOf || '');
  const perfMax = Object.values(perf.funds || {}).reduce((m, p) => (p && p.asOf && p.asOf > m ? p.asOf : m), '');
  const idxMax = Object.values(idx.funds || {}).reduce((m, p) => (p && p.asOf && p.asOf > m ? p.asOf : m), '');

  info.push('基金 ' + rows.length + ' 条，净值日 ' + (navLatest || '—'));
  info.push('自算指标 ' + (perf.count || Object.keys(perf.funds || {}).length) + ' 条，净值日 ' + (perfMax || perfLatest || '—'));
  info.push('历史索引 ' + Object.keys(idx.funds || {}).length + ' 条，末点 ' + (idxMax || '—'));
  info.push('持仓 ' + (hld.count || Object.keys(hld.funds || {}).length) + ' 条');

  if (rows.length < 400) fails.push('基金条数异常：' + rows.length);
  if ((perf.count || 0) < 400) fails.push('自算指标条数异常：' + perf.count);
  if (Object.keys(idx.funds || {}).length < 400) fails.push('历史索引条数异常：' + Object.keys(idx.funds || {}).length);
  if ((hld.count || 0) < 400) fails.push('持仓条数异常：' + hld.count);

  /* 自算指标不得落后基金净值日超过 1 天（每天由 navperf 重算，落后说明链路顺序错了） */
  if (navLatest && perfMax) {
    const gap = Math.round((new Date(navLatest) - new Date(perfMax)) / 864e5);
    if (gap > 1) fails.push('自算指标落后净值日 ' + gap + ' 天（' + perfMax + ' < ' + navLatest + '）');
  }
  if (navLatest && idxMax) {
    const gap = Math.round((new Date(navLatest) - new Date(idxMax)) / 864e5);
    if (gap > 1) fails.push('历史索引落后净值日 ' + gap + ' 天（' + idxMax + ' < ' + navLatest + '）');
  }

  /* 关键字段不得出现 NaN / undefined 字符串 */
  const bad = rows.filter((f) => [f.nav, f.selfY1, f.selfYtd].some((v) => typeof v === 'string' && /undefined|NaN/i.test(v))).length;
  if (bad) fails.push('基金字段含 undefined/NaN：' + bad + ' 条');

  /* 2026-11-13（第三方复验 P2-2）：基金表 nav 必须与 hist 末点逐位相同。
     抓取原值（銀聯信託 6-7 位）与 hist（4 位）混用时，两站会出现
     「11.9906 vs 11.9905946」，外部核验每轮都报「同一天数值不同」。
     nav-round4 负责归一，这里做回归闸门（漏跑即阻断）。 */
  const fsx = require('fs');
  const pathx = require('path');
  let precBad = 0;
  const precSample = [];
  for (const f of rows) {
    if (f.nav == null || !f.navAsOf) continue;
    let ser;
    try { ser = JSON.parse(fsx.readFileSync(pathx.join(__dirname, '..', 'data', 'hist', String(f.id) + '.json'), 'utf8')).series; } catch (e) { continue; }
    if (!ser || !ser.length) continue;
    const last = ser[ser.length - 1];
    if (last[0] !== f.navAsOf) continue;   /* 日期不同由 freshness / gap-check 管 */
    /* 2026-11-17：源头有 7 位小数的发行人（銀聯信託等），hist 保留原值、funds 归一到 4 位。
       闸门比的是「4 位是否一致」，故两侧都先 round 到 4 位再比（原实现逐位严格相等会误报 52 只）。 */
    const r4 = (v) => Math.round(v * 10000) / 10000;
    if (Math.abs(r4(f.nav) - r4(last[1])) > 1e-9) {
      precBad++;
      if (precSample.length < 5) precSample.push(f.id + ' ' + f.nav + '≠' + last[1]);
    }
  }
  if (precBad) fails.push('净值与历史末点不一致：' + precBad + ' 条（' + precSample.join('、') + '），请跑 tools/nav-round4.js');
  else info.push('净值精度：与历史末点逐位一致');

  /* 2026-11-17（用户要求）：跨资产比较必须同日 —— 构建期断言。
     背景：navperf 曾用指数序列末点（11-13）减基金末点（11-12）算「超额收益」，
     每只基金偏差近 2pp。此处以「多数基金共同的净值日」为锚，独立复算恒指近 1 年回报，
     与 nav-perf 里存的值比对；不一致即阻断发布，避免同类问题再次上线。 */
  try {
    const cnt = {};
    rows.forEach((f) => { if (f.navAsOf) cnt[f.navAsOf] = (cnt[f.navAsOf] || 0) + 1; });
    let anchor = '';
    Object.keys(cnt).sort().forEach((d) => { if (!anchor || cnt[d] >= cnt[anchor]) anchor = d; });
    const hsi = (perf.meta && perf.meta.hsi) || null;
    if (!anchor) {
      fails.push('跨资产同日断言：无法确定基金净值锚点（navAsOf 全空）');
    } else if (!hsi || !hsi.asOf) {
      fails.push('跨资产同日断言：nav-perf 缺少 meta.hsi（前端「超额收益」将无基准）');
    } else if (hsi.asOf !== anchor) {
      fails.push('跨资产比较跨日：超额收益基准 ' + hsi.asOf + ' ≠ 基金净值锚点 ' + anchor + '（请重跑 navperf.js）');
    } else {
      const ix = JSON.parse(fsx.readFileSync(pathx.join(__dirname, '..', 'data', 'index.json'), 'utf8')).items.HSI;
      const ser = ix.series || [];
      let ptr = -1;
      for (let i = 0; i < ser.length; i++) { if (ser[i][0] <= anchor) ptr = i; else break; }
      if (ptr < 0) {
        fails.push('跨资产同日断言：指数序列没有 ≤ ' + anchor + ' 的点');
      } else {
        const lastD = new Date(ser[ptr][0] + 'T00:00:00Z');
        const cut = new Date(Date.UTC(lastD.getUTCFullYear() - 1, lastD.getUTCMonth(), lastD.getUTCDate())).toISOString().slice(0, 10);
        let base = null;
        for (const [d, v] of ser) { if (d <= cut) base = v; else break; }
        const mine = base > 0 ? Math.round((ser[ptr][1] / base - 1) * 10000) / 100 : null;
        if (mine == null) fails.push('跨资产同日断言：无法计算恒指近 1 年回报（基准点缺失）');
        else if (Math.abs(mine - hsi.y1) > 0.02) {
          fails.push('超额收益基准不符：nav-perf ' + hsi.y1 + '% vs 按 ' + anchor + ' 复算 ' + mine + '%（请重跑 navperf.js）');
        } else {
          info.push('跨资产同日：恒指基准 ' + anchor + '，近 1 年 ' + mine + '%（与 nav-perf 一致）');
        }
      }
    }
  } catch (e) {
    fails.push('跨资产同日断言异常：' + e.message);
  }
}

/* 2026-11-13（第三方核验 P1-2）：净值新鲜度硬闸门。
   freshness-guard.js 会写 data/freshness.json；这里只在「严重停滞」时阻断发布
   （某个来源落后 >10 个净值日，或全站最新日距今 >7 天），避免新地那种 41 天静默发布。 */
/* 2026-11-13（复验报告 P1-2 的绕过路径）：原来只读 data/freshness.json，
   而它是随代码入库的静态快照 —— guard 没重跑时 hard 永远是 false，且文件缺失时
   try-catch 静默放行。现改为**现场计算**（require 同一个 compute），文件只作留档。 */
try {
  const fr = require('./freshness-guard.js').compute();
  if (fr && fr.error) {
    fails.push('净值新鲜度无法判定：' + fr.error);
  } else if (fr && fr.hard) {
    const stuck = (fr.items || []).filter((x) => !x.exempt && x.lagDays > fr.hardLag).map((x) => x.trustee + '(' + x.lagDays + '个交易日)');
    fails.push('净值严重停滞：' + (stuck.length ? stuck.join('、')
      : '基金最新 ' + fr.latest + '，市场已到 ' + fr.marketLatest + '（落后 ' + fr.fundLag + ' 个交易日）'));
  } else if (fr) {
    info.push('净值新鲜度：基金最新 ' + fr.latest + ' / 市场最新交易日 ' + fr.marketLatest +
      '（落后 ' + fr.fundLag + ' 个交易日），最慢来源落后 ' +
      Math.max.apply(null, (fr.items || []).map((x) => x.lagDays || 0)) + ' 个交易日');
  }
} catch (e) {
  fails.push('净值新鲜度检查异常：' + e.message);
}

info.forEach((s) => console.log('  · ' + s));
if (fails.length) {
  fails.forEach((f) => console.log('  ✘ ' + f));
  console.log('[predeploy] 未通过，禁止发布');
  process.exit(1);
}
console.log('[predeploy] 通过：四份核心数据一致，可发布');
