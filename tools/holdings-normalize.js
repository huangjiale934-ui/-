#!/usr/bin/env node
/* 持仓数据规范化（2026-10-23，核验报告 P0/P1）
   1) allocTitle 空值 → 「投資組合分布」
   2) top10 按权重降序
   3) asOf 贴近月末的日期归一（如 2026-06-29 → 2026-06-30）
*/
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'data', 'holdings.json');
const j = JSON.parse(fs.readFileSync(P, 'utf8'));
let t = 0, s = 0, d = 0;

const MONTH_END = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ym + '-' + String(last).padStart(2, '0');
};

Object.values(j.funds).forEach((x) => {
  if (!x) return;
  if ((x.alloc || []).length && !x.allocTitle) { x.allocTitle = '投資組合分布'; t++; }
  if ((x.top10 || []).length) {
    const sorted = x.top10.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
    if (sorted.some((v, i) => v !== x.top10[i])) { x.top10 = sorted; s++; }
  }
  if (x.asOf && /-\d{2}$/.test(x.asOf)) {
    const me = MONTH_END(x.asOf.slice(0, 7));
    if (x.asOf !== me) {
      const diff = Math.abs(new Date(x.asOf) - new Date(me)) / 864e5;
      if (diff <= 1) { x.asOf = me; d++; }
    }
  }
});
fs.writeFileSync(P, JSON.stringify(j));
console.log('规范化：补口径标题', t, '| 排序', s, '| 日期归一', d);
