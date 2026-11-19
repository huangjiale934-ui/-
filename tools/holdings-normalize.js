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
let t = 0, s = 0, d = 0, a = 0, t0 = 0, q = 0;

const MONTH_END = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ym + '-' + String(last).padStart(2, '0');
};

Object.values(j.funds).forEach((x) => {
  if (!x) return;
  /* 2026-11-13（第三方核验 P1-4）：bocpt_alloc_ingest.py 曾把标题写成简体（行业分布/地区分布），
     与条目其余文案的繁体不一致（memory 里记过「中銀 allocTitle 变简体」的老毛病）。
     统一在这里归一成繁体，解析器那边也改了，双保险。 */
  if (x.allocTitle) {
    const HANT = { '行业分布': '行業分布', '地区分布': '地區分布', '投资组合分布': '投資組合分布', '资产分布': '資產分布' };
    const fixed = HANT[x.allocTitle];
    if (fixed) { x.allocTitle = fixed; t0++; }
  }
  if ((x.alloc || []).length && !x.allocTitle) { x.allocTitle = '投資組合分布'; t++; }
  if ((x.top10 || []).length) {
    /* 2026-11-19（8.0，外部核验 A3-a 的根治）：top10 的行情字段（code/unit/price/chg/date）
       由已废弃的 holdquote2.py 补写，与持仓报告期无关，且多次出现代码错配
       （西班牙/澳洲两只不同 ETF 同映射 EEMA；报价日 11-02 而报告期 07-31）。
       页面与导出都不渲染这些字段，regcheck 断言要求「不得出现」。
       放在归一链路末端统一剥离，防止抓取或事务回滚把旧字段带回来。 */
    x.top10.forEach((h) => {
      ['code', 'unit', 'price', 'chg', 'date'].forEach((k) => { if (k in h) { delete h[k]; q++; } });
    });
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
  /* 2026-11-05（第四十轮）：BCT 便览解析只写 allocLabel + alloc，没有 allocSum，
     health-check 的字段完整性哨兵会报「缺失 83 只」（页面不受影响，因为前端自己求和）。
     这里按逐项 weight 补上；已有值一律不动。 */
  if ((x.alloc || []).length) {
    const sum = Math.round(x.alloc.reduce((q, b) => q + (Number(b.weight) || 0), 0) * 100) / 100;
    if (x.allocSum == null) { x.allocSum = sum; a++; }
    /* 2026-11-17（外部核验 A3/P1）：原始披露逐项四舍五入会略超 100（≤100.5 属正常）；
       超过 100.5 的属实质超限（如 102.43），标记出来由前端归一显示并说明。 */
    if (sum > 100.5) x.allocOverflow = sum;
    else if (x.allocOverflow != null) delete x.allocOverflow;
  }
});
fs.writeFileSync(P, JSON.stringify(j));
console.log('规范化：补口径标题', t, '| 简→繁', t0, '| 排序', s, '| 日期归一', d, '| 补 allocSum', a, '| 剥离行情字段', q);
