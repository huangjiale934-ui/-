/**
 * fix-nulls.js —— 修正「官方 n.a. 被解析成 0」的字段（2026-10-22）
 *
 * 背景：第三方核查 S2 —— 22 只保守基金 2021 年回报官方为 n.a.，
 *       站内被写成 0.00%，详情页因此画出一根「2021 年 0.00%」的零柱。
 * 用法：node tools/fix-nulls.js     （daily.sh 在 navperf 之后调用，防止被重新抓取覆盖）
 */
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'data', 'funds.json');
const j = JSON.parse(fs.readFileSync(P, 'utf8'));
let n = 0;

j.funds.forEach((f) => {
  if (f.cal && f.cal['2021'] === 0 && /保守/.test(String(f.fundBase || f.fund || ''))) {
    f.cal['2021'] = null;
    const vals = Object.keys(f.cal).filter((y) => f.cal[y] != null).map((y) => f.cal[y]);
    f.worstYear = vals.length ? Math.min.apply(null, vals) : null;
    n++;
  }
});

fs.writeFileSync(P, JSON.stringify(j));
console.log('[fix-nulls] 保守基金 2021 年 n.a. 修正 %d 只', n);
