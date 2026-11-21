/*
 * 季度持仓刷新「到期判定」（tools/quarterly-due.js）
 * ====================================================================
 * 2026-11-21（用户要求）：把季度刷新并入每晚全量任务，并按季度结束后的月份递增频率，
 * 直到绝大多数基金都更新到该季末为止：
 *   第 1 个月：每周 1 次 —— 周日
 *   第 2 个月：每周 2 次 —— 周三、周日
 *   第 3 个月：每周 3 次 —— 周二、周四、周日
 * （第 4 个月起进入下一季度，重新从「第 1 个月」计）
 *
 * 退出码：0 = 今天该跑；1 = 不跑（已全更新 / 今天不在计划日）
 * 用法：node tools/quarterly-due.js [--why]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WHY = process.argv.indexOf('--why') >= 0;
const now = new Date();
const y = now.getFullYear();
const m = now.getMonth() + 1;      // 1-12
const dow = now.getDay();          // 0=周日

/* 上一季度末（含当天） */
function prevQuarterEnd() {
  if (m <= 3) return new Date(y - 1, 11, 31);
  if (m <= 6) return new Date(y, 2, 31);
  if (m <= 9) return new Date(y, 5, 30);
  return new Date(y, 8, 30);
}
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const qEnd = prevQuarterEnd();
const qEndIso = iso(qEnd);
const qEndMonth = qEnd.getMonth() + 1;     // 3/6/9/12
let monthIdx = m - qEndMonth;              // 1/2/3
if (monthIdx <= 0) monthIdx += 12;         // 跨年（12 月季度末 → 次年 1 月 = 1）

/* 该月对应的星期集合 */
const PLAN = { 1: [0], 2: [3, 0], 3: [2, 4, 0] }[Math.min(monthIdx, 3)] || [0];

function log(s) { if (WHY) console.log('[quarterly-due] ' + s); }

/* 完成度：holdings 里 asOf >= 季末 的占比（忽略没有 asOf 的条目） */
let done = 0, total = 0;
try {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'holdings.json'), 'utf8'));
  Object.values(h.funds || {}).forEach((v) => {
    if (!v || !v.asOf) return;
    total += 1;
    if (v.asOf >= qEndIso) done += 1;
  });
} catch (e) { log('holdings.json 不可读，按「未完成」处理'); }

const pct = total ? done / total : 0;
log('季末 ' + qEndIso + '（第 ' + monthIdx + ' 个月）· 计划星期 ' + JSON.stringify(PLAN) +
  ' · 今日星期 ' + dow + ' · 完成 ' + done + '/' + total + '（' + Math.round(pct * 100) + '%）');

/* 已基本更新完（≥90%）→ 不再跑，等下一季度 */
if (total && pct >= 0.9) {
  log('该季已更新 ' + Math.round(pct * 100) + '%，跳过');
  process.exit(1);
}

if (PLAN.indexOf(dow) < 0) {
  log('今天不在计划日，跳过');
  process.exit(1);
}

log('今天该跑');
process.exit(0);
