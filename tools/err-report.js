#!/usr/bin/env node
/* 前端异常日报（2026-11-19）
   读取 data/err-log.json，按「页面 + 错误信息」聚合，打印最近 24h 的高频错误。
   用法：node tools/err-report.js [小时数，默认 24]
   线上异常由 /api/err 收集（见 server.js / common.js），本地不产生记录。 */
const fs = require('fs');
const path = require('path');

const HOURS = Number(process.argv[2]) || 24;
const FILE = path.join(__dirname, '..', 'data', 'err-log.json');

let rows = [];
try { rows = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { rows = []; }
if (!Array.isArray(rows) || !rows.length) { console.log('近 ' + HOURS + ' 小时没有前端异常记录。'); process.exit(0); }

const since = Date.now() - HOURS * 3600e3;
const recent = rows.filter((r) => {
  const t = Date.parse(r.at || '');
  return isFinite(t) && t >= since;
});
if (!recent.length) { console.log('近 ' + HOURS + ' 小时没有前端异常记录（历史共 ' + rows.length + ' 条）。'); process.exit(0); }

const map = new Map();
recent.forEach((r) => {
  const key = (r.page || '?') + ' | ' + String(r.msg || '').slice(0, 120);
  const x = map.get(key) || { n: 0, last: r.at, sample: r };
  x.n += 1; x.last = r.at; map.set(key, x);
});
const list = Array.from(map.entries()).sort((a, b) => b[1].n - a[1].n);
console.log('近 ' + HOURS + ' 小时前端异常：' + recent.length + ' 条 / ' + list.length + ' 类\n');
list.slice(0, 20).forEach(([key, v], i) => {
  console.log((i + 1) + '. [' + v.n + ' 次] ' + key);
  console.log('   最后 ' + v.last + (v.sample.src ? ' · ' + v.sample.src + ':' + (v.sample.line || 0) : ''));
  if (v.sample.stack) console.log('   ' + String(v.sample.stack).split('\n').slice(0, 2).join(' / ').slice(0, 220));
});
