#!/usr/bin/env node
/* 按来源判断「这一季还需不需要重抓」（tools/source-due.js）—— 2026-11-22
 * ------------------------------------------------------------------
 * 背景：quarterly.sh 每次到期都会把永明 31 只、中國人壽 10 只、AMTD 16 只的
 * PDF 重新下载+解析一遍，哪怕它们已经是最新季度 —— 白花时间与积分。
 *
 * 判定：取 holdings.json 里 src 含指定关键字的条目，最大 asOf >= 上一季度末 → 已齐，跳过。
 * 用法：
 *   node tools/source-due.js 永明      # 0=该抓；1=已齐可跳过
 *   node tools/source-due.js --why 永明
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const WHY = args.includes('--why');
const key = args.filter((x) => !x.startsWith('--'))[0] || '';
if (!key) {
  console.error('用法：node tools/source-due.js [--why] <src关键字>');
  process.exit(2);
}

function prevQuarterEnd() {
  const d = new Date(Date.now() + 8 * 3600e3);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (m <= 3) return (y - 1) + '-12-31';
  if (m <= 6) return y + '-03-31';
  if (m <= 9) return y + '-06-30';
  return y + '-09-30';
}
const qEnd = prevQuarterEnd();
let max = '', n = 0;
try {
  const h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8'));
  Object.values(h.funds || {}).forEach((v) => {
    if (!v || !v.src || String(v.src).indexOf(key) < 0) return;
    n++;
    if (v.asOf && v.asOf > max) max = v.asOf;
  });
} catch (e) { /* 读不到按「该抓」处理 */ }

const due = !(n && max >= qEnd);
if (WHY) console.log('[source-due] ' + key + '：' + n + ' 条，最新 ' + (max || '无') + '，季末 ' + qEnd + ' → ' + (due ? '该抓' : '已齐，跳过'));
process.exit(due ? 0 : 1);
