#!/usr/bin/env node
/* 季度窗口状态（2026-10-26 新增）
   背景：季度自动化按提示词里的「100 天容差」判定，而 Q2（06-30）距 Q3 季末仅 92 天 →
        永远落在容差内 → 判定「已齐」→ 抓取永不执行。这里给出可执行的严格口径。
   用法：
     node tools/quarter-status.js            # 人读摘要
     node tools/quarter-status.js --json     # 机器读（自动化据此决定是否抓取）
     node tools/quarter-status.js --q 2026-09-30   # 指定季末
   口径：
     K' = holdings.asOf >= 季末 的基金数（严格口径，判定用）
     K  = 100 天容差口径（仅参考，不得用于判定）
   退出码：0 = 已齐（无需抓取）；2 = 未齐（应执行抓取）
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const holdings = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'holdings.json'), 'utf8'));
const funds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'funds.json'), 'utf8')).funds || [];
const asJson = process.argv.includes('--json');
const qi = process.argv.indexOf('--q');
const explicit = qi >= 0 ? process.argv[qi + 1] : '';

/* 香港时间「最近一个已结束的季末」 */
function lastQuarterEnd() {
  const now = new Date(Date.now() + 8 * 3600e3);
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const ends = [[3, '03-31'], [6, '06-30'], [9, '09-30'], [12, '12-31']];
  let pick = null;
  for (const [mm, dd] of ends) if (m > mm) pick = y + '-' + dd;
  if (!pick) pick = (y - 1) + '-12-31';
  return pick;
}
const qEnd = explicit || lastQuarterEnd();
const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

const H = holdings.funds || {};
const ids = funds.map((f) => String(f.id));
const stat = { total: ids.length, strict: 0, tolerance: 0, missing: 0, noEntry: 0 };
const bySrc = {};
const lagging = {};
ids.forEach((id) => {
  const h = H[id];
  const f = funds.find((x) => String(x.id) === id) || {};
  const trustee = f.trustee || '未标注';
  if (!h) { stat.noEntry++; lagging[trustee] = (lagging[trustee] || 0) + 1; return; }
  const a = h.asOf || '';
  if (!a) { stat.missing++; lagging[trustee] = (lagging[trustee] || 0) + 1; return; }
  if (a >= qEnd) {
    stat.strict++;
    const k = (h.src || '未知来源').split('（')[0];
    bySrc[k] = (bySrc[k] || 0) + 1;
  } else {
    if (days(a, qEnd) <= 100) stat.tolerance++;
    lagging[trustee] = (lagging[trustee] || 0) + 1;
  }
});
const pct = (n) => (stat.total ? Math.round((n / stat.total) * 1000) / 10 : 0);
const ready = stat.strict === stat.total;

const out = {
  quarterEnd: qEnd,
  asOfToday: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10),
  total: stat.total,
  strict: stat.strict, strictPct: pct(stat.strict),
  tolerance: stat.tolerance, tolerancePct: pct(stat.tolerance),
  noEntry: stat.noEntry, noAsOf: stat.missing,
  ready, bySrc, lagging,
  note: '判定必须用 strict（asOf>=季末）；tolerance 为提示词旧口径（100 天），Q2 距 Q3 季末仅 92 天会永久显示已齐，不得用于判定',
};

if (asJson) {
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log('季度窗口：季末 ' + qEnd + '（今天 ' + out.asOfToday + '）');
  console.log('严格口径 K\'（asOf ≥ 季末）：' + stat.strict + '/' + stat.total + ' = ' + pct(stat.strict) + '%  → ' + (ready ? '已齐，无需抓取' : '未齐，应执行抓取'));
  console.log('旧容差口径 K（100 天，仅参考）：' + stat.tolerance + '/' + stat.total + ' = ' + pct(stat.tolerance) + '%  ← 不可用于判定');
  if (Object.keys(bySrc).length) console.log('已达季末：' + Object.entries(bySrc).map(([k, v]) => k + ' ' + v).join(' / '));
  const lag = Object.entries(lagging).sort((a, b) => b[1] - a[1]);
  if (lag.length) console.log('未达季末（按发行人）：' + lag.map(([k, v]) => k + ' ' + v).join(' / '));
}
process.exit(ready ? 0 : 2);
