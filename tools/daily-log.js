/*
 * 每日摘要（tools/daily-log.js）
 * 独立写入 data/daily-log.json：daily.sh 每班都调用，不再依赖 push.js。
 * 字段：date/syncAt/count/dataAsOf/navVerified/navNa/avgAnn1/navLatest/lagged/lagByTrustee/updated
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG = path.join(ROOT, 'data', 'daily-log.json');

function readFunds() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'funds.json'), 'utf8')); } catch (e) { return null; }
}
function readLog() {
  try { const a = JSON.parse(fs.readFileSync(LOG, 'utf8')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

const data = readFunds();
if (!data || !Array.isArray(data.funds)) {
  console.log('[daily-log] funds.json 不可读，跳过');
  process.exit(0);
}
const funds = data.funds;
const list = readLog();
const day = new Date().toISOString().slice(0, 10);
const prev = list.length ? list[list.length - 1] : null;

let navLatest = '';
funds.forEach((x) => { if (x.navAsOf && x.navAsOf > navLatest) navLatest = x.navAsOf; });

const withNav = funds.filter((x) => x.nav != null);
const lagged = funds.filter((x) => x.navAsOf && navLatest && x.navAsOf < navLatest);
const lagByTrustee = {};
lagged.forEach((x) => { const k = x.trustee || '—'; lagByTrustee[k] = (lagByTrustee[k] || 0) + 1; });

const anns = withNav.map((x) => x.ann1).filter((v) => typeof v === 'number' && isFinite(v));
const avgAnn1 = anns.length ? Math.round((anns.reduce((a, b) => a + b, 0) / anns.length) * 100) / 100 : null;

/* 与上一条记录相比前进了多少条：按 navAsOf 严格大于上一条记录的 navLatest 计 */
let updated = null;
if (prev && prev.navLatest) {
  updated = funds.filter((x) => x.navAsOf && x.navAsOf > prev.navLatest).length;
} else if (prev && prev.date && prev.date !== day) {
  updated = funds.filter((x) => x.navAsOf === navLatest).length;
}

const rec = {
  date: day,
  syncAt: new Date().toISOString(),
  count: funds.length,
  dataAsOf: data.dataAsOf || '',
  navVerified: withNav.length,
  navNa: funds.length - withNav.length,
  avgAnn1: avgAnn1,
  navLatest: navLatest,
  lagged: lagged.length,
  lagByTrustee: lagByTrustee,
  updated: updated,
};

/* 同一天多次运行 → 覆盖当天那条（保留最后一次，反映当日最终结果） */
const idx = list.findIndex((r) => r && r.date === day);
if (idx >= 0) list[idx] = Object.assign({}, list[idx], rec);
else list.push(rec);

try {
  fs.writeFileSync(LOG, JSON.stringify(list.slice(-400), null, 1));
  console.log('[daily-log] ' + day + ' 已记录：净值日 ' + navLatest + '，落后 ' + lagged.length + ' 只' +
    (updated == null ? '' : '，本班前进 ' + updated + ' 只'));
} catch (e) {
  console.log('[daily-log] 写入失败：' + e.message);
}
