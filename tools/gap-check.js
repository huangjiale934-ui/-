#!/usr/bin/env node
/* 近端缺日巡检 + 自动补抓（2026-10-23，杜绝"富达/海通缺 3 天"这类问题）
   交易日历来源：data/index.json 的 HSI 序列（最可靠，市场开市才有指数）
   用法：
     node tools/gap-check.js            只报告
     node tools/gap-check.js --json     输出待补抓的发行人清单（给服务端调度用）
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');

const idx = JSON.parse(fs.readFileSync(path.join(D, 'index.json'), 'utf8'));
const hsi = (idx.items.HSI.series || []).map((x) => x[0]);
/* 只检查「已过 T+1 宽限」的交易日：最新 1 个交易日当天多数发行人还没发布，不算缺 */
const recent = hsi.slice(-7, -1);
/* 已证实的渠道固有缺口豁免（2026-10-25 修 P1-4：原 /^AMTD/ 全跳让 etnet 日源 16 只缺日对巡检不可见；
   现只跳真正月频来源（新地），AMTD 参与巡检但豁免 etnet 无历史值的日期，渠道补上后移除即可恢复告警） */
const WAIVE_DAYS = {
  'AMTD強積金計劃': ['2026-10-15', '2026-10-16', '2026-10-22'],
};

const funds = JSON.parse(fs.readFileSync(path.join(D, 'funds.json'), 'utf8')).funds;
const byIssuer = {};
funds.forEach((f) => {
  const p = path.join(D, 'hist', String(f.id) + '.json');
  if (!fs.existsSync(p)) return;
  let s;
  try { s = JSON.parse(fs.readFileSync(p, 'utf8')).series || []; } catch (e) { return; }
  const have = new Set(s.map((x) => x[0]));
  const waived = WAIVE_DAYS[f.scheme || f.trustee] || [];
  const miss = recent.filter((d) => !have.has(d) && !waived.includes(d));
  if (!miss.length) return;
  const key = f.scheme || f.trustee;
  byIssuer[key] = byIssuer[key] || { n: 0, days: new Set(), trustee: f.trustee };
  byIssuer[key].n++;
  miss.forEach((d) => byIssuer[key].days.add(d));
});

/* 非日更来源（月度 PDF）不参与巡检/自动补抓。
   2026-10-25 修 P1-4：原 /^AMTD/ 全跳导致 etnet 日源 16 只缺日对巡检不可见；
   现只跳真正的月频来源（新地/SHKP），AMTD 参与巡检但豁免 etnet 渠道已证实的固有缺口，
   未来补上渠道后从 WAIVE_DAYS 移除即可恢复告警。 */
const SKIP = [/新地/];
const out = Object.entries(byIssuer)
  .filter(([k]) => !SKIP.some((r) => r.test(k)))
  .map(([k, v]) => ({ scheme: k, trustee: v.trustee, funds: v.n, days: [...v.days] }));
/* 发行人 → 补抓命令（供服务端夜间任务调用） */
const FETCH = [
  [/^富達/, ['fetch-fidelity-hist.py']],
  [/^AMTD/, ['nav-etnet.py']],   /* etnet 日源；历史缺口见 WAIVE_DAYS */
  [/^海通/, ['ht_daily.py']],
  [/^宏利/, ['fetch-manulife-hist.py']],
  [/^友邦/, ['aia_ingest2.py']],
  [/^東亞/, ['fetch-bea-hist.py']],
  [/智選計劃/, ['fetch-hsbc-family.py', '--from', '$FROM', '--days', '90']],
  [/^BCT/, ['fetch-bct-hist.py', '--max-dates', '8']],
  [/^(中銀保誠|我的強積金)/, ['fetch-bocpt-hist.py', '--from', '$FROM']],
  [/^永明/, ['fetch-sunlife-hist.py']],
  [/^中國人壽/, ['fetch-chinalife-hist.py']],
  [/^萬全/, ['yflife_daily.py']],
  [/^交通/, ['fetch-bocom-hist.py']],
];
const from = recent[recent.length - 1] || '';
out.forEach((o) => {
  const rule = FETCH.find(([re]) => re.test(o.scheme));
  if (rule) o.cmd = rule[1].map((x) => x.replace('$FROM', from));
});
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ recent, gaps: out }));
} else {
  console.log('近端交易日：' + recent.join(' '));
  if (!out.length) console.log('  无缺日 ✔');
  out.forEach((o) => console.log('  缺日 ' + o.days.length + ' 天 | ' + o.scheme + ' (' + o.trustee + ') ' + o.funds + ' 只'));
}
