#!/usr/bin/env node
/**
 * _funds-meta.js —— 从 stdin 或文件读 funds.json，打印「版本时间 + 数据截至 + 净值分布」
 * 供 shell 脚本调用，避免在 bash 里拼长 node -e 引号（曾因漏一个括号整段失效）。
 * 用法：git show origin/main:data/funds.json | node tools/_funds-meta.js
 *       node tools/_funds-meta.js data/funds.json
 */
const fs = require('fs');

function report(obj) {
  const tally = {};
  (obj.funds || []).forEach((f) => { tally[f.navAsOf] = (tally[f.navAsOf] || 0) + 1; });
  const latest = Object.keys(tally).sort().pop() || '-';
  const ts = Number(obj.updatedAt) || 0;
  console.log(ts + '|' + (obj.dataAsOf || '-') + '|' + latest + '|' + (obj.count || (obj.funds || []).length));
}

const file = process.argv[2];
if (file) {
  report(JSON.parse(fs.readFileSync(file, 'utf8')));
} else {
  let s = '';
  process.stdin.on('data', (d) => { s += d; });
  process.stdin.on('end', () => {
    try { report(JSON.parse(s)); } catch (e) { console.log('0|-|-|0'); }
  });
}
