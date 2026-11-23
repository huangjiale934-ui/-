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
/* 2026-11-23（云端化）：原先用运行机器的本地时区取「今天」。GitHub runner 是 UTC，
   00:00 HKT 的全量班在 UTC 仍是前一天 16:00（周一 00:00 HKT = 周日 16:00 UTC），
   星期会整体偏移一天 → 计划日算错。这里统一按 HKT 计算，且不再用 Date 对象推季末。 */
const now = new Date(Date.now() + 8 * 3600e3);
const y = now.getUTCFullYear();
const m = now.getUTCMonth() + 1;      // 1-12（HKT）
const dow = now.getUTCDay();          // 0=周日（HKT）

/* 上一季度末（含当天）：3/6/9/12 月末，日期固定，无需构造 Date */
const qEndMonth = m <= 3 ? 12 : m <= 6 ? 3 : m <= 9 ? 6 : 9;
const qEndYear = m <= 3 ? y - 1 : y;
const qEndDay = qEndMonth === 6 || qEndMonth === 9 ? '30' : '31';
const qEndIso = qEndYear + '-' + String(qEndMonth).padStart(2, '0') + '-' + qEndDay;
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
log('HKT 今日 ' + y + '-' + String(m).padStart(2, '0') + '-' + String(now.getUTCDate()).padStart(2, '0') +
  ' · 季末 ' + qEndIso + '（第 ' + monthIdx + ' 个月）· 计划星期 ' + JSON.stringify(PLAN) +
  ' · 今日星期 ' + dow + ' · 完成 ' + done + '/' + total + '（' + Math.round(pct * 100) + '%）');

/* 已基本更新完（≥95%）→ 不再跑，下一季度重新计数 */
if (total && pct >= 0.95) {
  log('该季已更新 ' + Math.round(pct * 100) + '%（阈值 95%），跳过，下一季度重新计');
  process.exit(1);
}

if (PLAN.indexOf(dow) < 0) {
  log('今天不在计划日，跳过');
  process.exit(1);
}

log('今天该跑');
process.exit(0);
