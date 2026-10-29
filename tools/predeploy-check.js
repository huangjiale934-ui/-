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
}

info.forEach((s) => console.log('  · ' + s));
if (fails.length) {
  fails.forEach((f) => console.log('  ✘ ' + f));
  console.log('[predeploy] 未通过，禁止发布');
  process.exit(1);
}
console.log('[predeploy] 通过：四份核心数据一致，可发布');
