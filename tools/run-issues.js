#!/usr/bin/env node
/* 夜间运行遗留问题汇总（2026-11-23）
 * ====================================================================
 * 用户要求：「每晚全量更新中，做不到的或有问题的，自己解决；解决不好的告诉我。」
 * 这个脚本只做一件事：把整条链路的「未自动解决项」汇成一份清单，
 *   ① 写 data/run-issues.json（给邮件/体检/前端复用）
 *   ② 在控制台与 GitHub Step Summary 里打印摘要
 * 判定为 critical 的（净值未匹配、抓取结构缺失、两站数值不一致）会触发邮件；
 * warn（如季度某源缺 PDF）只记录，避免天天刷屏。
 *
 * 用法：node tools/run-issues.js [--print]
 * 退出码恒 0（巡检类脚本不得阻断发布）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = (f) => path.join(ROOT, 'data', f);

function readJson(f, fb) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; }
}

const items = [];
const add = (level, text, extra) => items.push(Object.assign({ level, text }, extra || {}));

/* ① 季度链路：最近一次运行里未完成的步骤 */
(function () {
  let log = '';
  try { log = fs.readFileSync(D('holdings-update.log'), 'utf8'); } catch (e) { return; }
  const i = log.lastIndexOf('季度持仓刷新开始');
  if (i < 0) return;
  const tail = log.slice(i);
  const fails = tail.split('\n').filter((l) => l.indexOf('✘') >= 0)
    .map((l) => l.replace(/^.*✘\s*/, '').replace(/（http[^）]*）/g, '').trim())
    .filter(Boolean);
  fails.forEach((t) => add('warn', '季度链路未完成：' + t));
  /* 2026-11-26（用户要求）：便覽改用积金局回退源 = 某家受托人站已不可用，必须让我知道 */
  tail.split('\n').filter((l) => l.indexOf('MPFA 回退源') >= 0).forEach((l) => {
    add('warn', '季度便覽改用积金局回退源：' + l.replace(/^.*?✔\s*/, '').trim());
  });
  const m = tail.match(/季度持仓刷新结束：成功 (\d+) 步，失败 (\d+) 步/);
  if (m && Number(m[2]) === 0) items.push({ level: 'ok', text: '季度链路 ' + m[1] + ' 步全部成功' });
})();

/* ② 抓取节点级监控（结构缺失 / 空 / 失败） */
(function () {
  const s = readJson(D('scrape-health.json'), null);
  if (!s || !s.summary) return;
  const sm = s.summary;
  const bad = (s.sources || []).filter((x) => x.status && x.status !== 'ok');
  if (sm.structMiss || sm.empty || sm.failed) {
    add('critical', '抓取源异常：结构缺失 ' + (sm.structMiss || 0) + ' / 空 ' + (sm.empty || 0) +
      ' / 失败 ' + (sm.failed || 0) + '（' + bad.map((x) => x.label || x.key).slice(0, 6).join('、') + '）');
  }
})();

/* ③ 净值未匹配 / 待核实 */
(function () {
  const f = readJson(D('funds.json'), null);
  if (!f || !f.navStat) return;
  const st = f.navStat;
  if (st.unmatched) {
    const ids = (f.funds || []).filter((x) => x.navStatus === 'unmatched').map((x) => x.id);
    add('critical', '净值未匹配 ' + st.unmatched + ' 只（显示「待核实」）：' + ids.slice(0, 12).join(' '));
  }
  if (st.pending) add('warn', '净值待处理 ' + st.pending + ' 只');
})();

/* ④ 状态漂移（na / unmatched 集合变化） */
(function () {
  const d = readJson(D('status-drift.json'), null);
  const days = (d && d.days) || [];
  const today = days[days.length - 1];
  if (!today) return;
  if (today.changes && today.changes.length) {
    add('warn', '状态漂移：' + today.changes.slice(0, 6).join('；'));
  }
  const prev = days[days.length - 2];
  if (prev && prev.date && today.date) {
    const same = (today.naIds || []).filter((id) => (prev.naIds || []).indexOf(id) >= 0);
    if (same.length) add('critical', '连续 2 天状态异常（na 未恢复）：' + same.join(' '));
  }
})();

/* ⑤ 持仓：配置合计异常 / top10 不足 */
(function () {
  const h = readJson(D('holdings.json'), null);
  if (!h || !h.funds) return;
  const over = [];
  const short = [];
  Object.keys(h.funds).forEach((id) => {
    const x = h.funds[id] || {};
    const a = x.alloc || [];
    if (a.length) {
      const s = a.reduce((q, b) => q + (Number(b.weight) || 0), 0);
      if (s > 100.5) over.push(id + ':' + s.toFixed(1));
    }
    const t = (x.top10 || []).length;
    if (t > 0 && t < 10) short.push(id + ':' + t);
  });
  if (over.length) add('warn', '持仓配置合计 >100%：' + over.slice(0, 10).join(' ') + (over.length > 10 ? ' …' : ''));
  if (short.length) add('warn', '前十大不足 10 条：' + short.slice(0, 10).join(' ') + (short.length > 10 ? ' …' : ''));
})();

/* ⑥ 来源新鲜度 */
(function () {
  const f = readJson(D('freshness.json'), null);
  if (!f) return;
  if (f.hard) add('critical', '有来源净值停滞超过硬阈值（maxLag ' + f.maxLag + ' 天）');
  else if (f.maxLag > (f.fundLag || 1) + 2) add('warn', '部分来源净值滞后 ' + f.maxLag + ' 天（见 data/freshness.json）');
})();

/* ⑦ 两站交叉核验 */
(function () {
  const c = readJson(D('cross-check.json'), null);
  if (!c || !c.summary) return;
  if (c.summary.valueDiff) add('critical', '两站同净值日数值不一致 ' + c.summary.valueDiff + ' 条');
  if (c.summary.countDiff) add('critical', '两站条数不一致：' + JSON.stringify(c.summary));
})();

/* ---- 输出 ---- */
const critical = items.filter((x) => x.level === 'critical');
const warn = items.filter((x) => x.level === 'warn');
const ok = items.filter((x) => x.level === 'ok');
const now = new Date(Date.now() + 8 * 3600e3);
const checkedAt = now.toISOString().slice(0, 16).replace('T', ' ');
const out = {
  checkedAt: checkedAt + ' HKT',
  critical: critical.length,
  warn: warn.length,
  items: items.map((x) => ({ level: x.level, text: x.text })),
  signature: JSON.stringify(critical.map((x) => x.text)).slice(0, 400),
};
let prev = readJson(D('run-issues.json'), {}) || {};
out.lastMailed = prev.lastMailed || '';
fs.writeFileSync(D('run-issues.json'), JSON.stringify(out));

if (process.argv.includes('--print') || process.env.GITHUB_ACTIONS) {
  console.log('[issues] 遗留 ' + (critical.length + warn.length) + ' 项（critical ' + critical.length + ' / warn ' + warn.length + '）');
  items.forEach((x) => console.log('  - [' + x.level + '] ' + x.text));
}
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### 遗留问题\n\n' + (items.length ? items.map((x) => '- **' + x.level + '** ' + x.text).join('\n') : '- 无') + '\n');
  } catch (e) { /* 忽略 */ }
}
process.exit(0);
