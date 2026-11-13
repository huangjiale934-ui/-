#!/usr/bin/env node
/**
 * 上线前全量数据体检 —— 广州精研数据有限公司 · 香港强积金数据平台
 * ============================================================
 * 只读，不改任何数据。逐项检查：
 *   A 基金表字段 / 净值与历史一致性 / 重复 id
 *   B 历史序列（日期单调、无重复、末点、异常净值）
 *   C 自算指标（nav-perf）范围与日期一致性
 *   D 指数与行情接口（6 个指数、末点、日线长度）
 *   E 持仓与投资分布（条数、权重、报告期、合计）
 *   F 积金局月度 / 新闻 / 其他统计文件
 * 用法：node tools/final-audit.js [--base http://127.0.0.1:4840]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'data');
const read = (p, def) => { try { return JSON.parse(fs.readFileSync(path.join(D, p), 'utf8')); } catch (e) { return def; } };

let fail = 0, warn = 0;
const ok = (t) => console.log('  ok   ' + t);
const bad = (t) => { fail++; console.log('  FAIL ' + t); };
const wrn = (t) => { warn++; console.log('  warn ' + t); };

const fundsJ = read('funds.json', { funds: [] });
const funds = fundsJ.funds || [];
const ids = new Set(funds.map((f) => String(f.id)));

console.log('== A 基金表 ==');
console.log('  条数 ' + funds.length + ' · dataAsOf ' + fundsJ.dataAsOf + ' · 声明总数 ' + fundsJ.declaredTotal);
/* 2026-11-11（自查发现）：積金局資訊表按月更新（月底数据约次月 6 日上线）。
   曾经停在 09-30 而官网已到 10-31，站内「规模/年率化/风险」整整旧一个月。 */
if (/^\d{4}-\d{2}-\d{2}$/.test(fundsJ.dataAsOf || '')) {
  const mpfaAge = Math.floor((Date.now() - new Date(fundsJ.dataAsOf + 'T00:00:00Z').getTime()) / 864e5);
  if (mpfaAge > 45) bad('積金局資料已 ' + mpfaAge + ' 天未刷新（dataAsOf ' + fundsJ.dataAsOf + '）');
  else ok('積金局資料日期 ' + fundsJ.dataAsOf + '（' + mpfaAge + ' 天前，按月更新属正常）');
}
if (!funds.length) bad('funds.json 为空');
if (ids.size !== funds.length) bad('存在重复 id：' + (funds.length - ids.size) + ' 条');
/* 2026-11-13（第三方核验发现 GH 站 391 计划名含 3 个 U+FFFD）：全表扫一遍替换字符，
   这类编码瑕疵肉眼很难发现，但会直接显示在页面上。 */
const fffd = funds.filter((f) => /\uFFFD/.test(JSON.stringify(f)));
if (fffd.length) bad('字段含替换字符 U+FFFD ' + fffd.length + ' 只：' + fffd.slice(0, 5).map((f) => f.id).join(','));
else ok('无 U+FFFD 乱码字段');
/* navStatus === 'na' 是发行人明确不提供单位价格（保证／非单位化基金），算已知项不算故障 */
const noNav = funds.filter((f) => f.nav == null || !isFinite(f.nav) || f.nav <= 0);
const naOk = noNav.filter((f) => f.navStatus === 'na');
const noNavBad = noNav.filter((f) => f.navStatus !== 'na');
if (noNavBad.length) bad('净值缺失/非正 ' + noNavBad.length + ' 只：' + noNavBad.slice(0, 5).map((f) => f.id).join(','));
else ok('净值全部有效（' + (funds.length - naOk.length) + ' 只有净值，' + naOk.length + ' 只官方标注 n.a.）');
const noAsOf = funds.filter((f) => f.navStatus !== 'na' && !/^\d{4}-\d{2}-\d{2}$/.test(f.navAsOf || ''));
if (noAsOf.length) bad('净值日期格式异常 ' + noAsOf.length + ' 只');
const navDates = {};
funds.forEach((f) => { navDates[f.navAsOf] = (navDates[f.navAsOf] || 0) + 1; });
const navMax = Object.keys(navDates).sort().pop();
console.log('  净值日期分布（末 6 档）：' + Object.keys(navDates).sort().slice(-6).map((d) => d + '×' + navDates[d]).join(' · '));
const lag = funds.filter((f) => f.navAsOf < navMax);
if (lag.length) wrn('早于全站最新日 ' + navMax + ' 的有 ' + lag.length + ' 条（源站节奏，非漏抓）');

console.log('== B 净值 vs 历史末点 ==');
let histMissing = 0, tailMismatch = 0, valMismatch = 0, badSeries = 0, emptySeries = 0;
/* 2026-11-04：新增「稳定类基金异常日波动」扫描 —— BCT 源站曾在 2026-10-30 给出偏高标价，
   货币/保证/债券类基金单日跳 3~4% 后次日回吐，靠这个扫描才发现的。 */
const stableHits = [];
const cutoff = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 60); return d.toISOString().slice(0, 10); })();
const histDir = path.join(D, 'hist');
const histFiles = fs.existsSync(histDir) ? fs.readdirSync(histDir).filter((f) => f.endsWith('.json')) : [];
const histIds = new Set(histFiles.map((f) => f.replace(/\.json$/, '')));
funds.forEach((f) => {
  const id = String(f.id);
  if (f.navStatus === 'na') return;   /* 官方不提供净值，无历史属预期 */
  if (!histIds.has(id)) { histMissing++; return; }
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(histDir, id + '.json'), 'utf8')).series || []; } catch (e) { badSeries++; return; }
  if (!s.length) { emptySeries++; return; }
  if (/貨幣|货币|保證|保证|債券|债券/.test(String(f.type || '') + String(f.typeFull || ''))) {
    for (let i = 1; i < s.length; i++) {
      if (s[i][0] < cutoff) continue;
      const r = s[i][1] / s[i - 1][1] - 1;
      if (Math.abs(r) > 0.02) stableHits.push(f.id + ' ' + f.fund + ' ' + s[i][0] + ' ' + (r * 100).toFixed(2) + '%');
    }
  }
  const last = s[s.length - 1];
  if (last[0] !== f.navAsOf) tailMismatch++;
  /* 2026-11-05：原按 1e-6 绝对差判等，但 hist 统一存 4 位小数、funds.json 保留官网原始精度，
     41 只因此被判「不一致」，实际最大差 0.02%（纯舍入）。改为相对容差 0.05%，
     真错价（通常 >0.5%）依然会被抓到。 */
  else if (Math.abs(last[1] / f.nav - 1) > 0.0005) valMismatch++;
  for (let i = 1; i < s.length; i++) {
    if (!(s[i][0] > s[i - 1][0])) { badSeries++; return; }
    if (!(s[i][1] > 0)) { badSeries++; return; }
  }
});
if (histMissing) bad('缺少历史文件 ' + histMissing + ' 只');
else ok('450+ 只全部有历史文件');
if (emptySeries) bad('历史序列为空 ' + emptySeries + ' 只');
if (badSeries) bad('历史序列日期非单调/净值非正 ' + badSeries + ' 只');
if (tailMismatch) bad('历史末点日期 ≠ 基金净值日 ' + tailMismatch + ' 只');
else ok('历史末点日期与基金净值日全部一致');
if (valMismatch) bad('末点净值与基金表净值不一致 ' + valMismatch + ' 只');
else ok('末点净值与基金表净值一致');
if (stableHits.length) {
  wrn('稳定类基金近 60 日出现 >2% 单日波动 ' + stableHits.length + ' 处（先核对源站是否标价错误）：');
  stableHits.slice(0, 8).forEach((x) => console.log('       ' + x));
} else ok('稳定类基金近 60 日无异常单日波动');

console.log('== C 自算指标 nav-perf ==');
const perf = read('nav-perf.json', { funds: {} });
const pf = perf.funds || {};
const pkeys = Object.keys(pf);
console.log('  条数 ' + pkeys.length + ' · updatedAt ' + new Date(perf.updatedAt || 0).toISOString());
const fields = ['d1', 'w1', 'm1', 'ytd', 'y1', 'y3a', 'y5a', 'mdd'];
let missingField = 0, weird = 0, dateDiff = 0, mddPos = 0;
pkeys.forEach((id) => {
  const p = pf[id];
  fields.forEach((k) => { if (p[k] == null) missingField++; });
  ['d1', 'w1', 'm1', 'ytd', 'y1', 'y3a', 'y5a'].forEach((k) => {
    if (p[k] != null && (p[k] < -100 || p[k] > 2000)) weird++;
  });
  if (p.mdd != null && p.mdd > 0) mddPos++;
  const f = funds.find((x) => String(x.id) === String(id));
  if (f && p.asOf && p.asOf !== f.navAsOf) dateDiff++;
});
if (pkeys.length < funds.length - 5) bad('nav-perf 覆盖不足：' + pkeys.length + '/' + funds.length);
else ok('nav-perf 覆盖 ' + pkeys.length + ' 只');
if (weird) bad('自算指标数值异常（<-100 或 >2000）' + weird + ' 处');
if (mddPos) bad('最大回撤出现正值 ' + mddPos + ' 处');
if (dateDiff) wrn('nav-perf asOf 与基金净值日不一致 ' + dateDiff + ' 只');

console.log('== D 指数 ==');
const idx = read('index.json', { items: {} });
const want = ['MPFAVG', 'MPF_STOCK', 'MPF_MIX', 'MPF_BOND', 'HSI', 'SPX'];
const idxDates = {};
want.forEach((k) => {
  const it = (idx.items || {})[k];
  if (!it || !it.series || !it.series.length) { bad('指数缺失 ' + k); return; }
  const s = it.series;
  const base = s[0][1], last = s[s.length - 1][1];
  idxDates[it.asOf || s[s.length - 1][0]] = (idxDates[it.asOf || s[s.length - 1][0]] || 0) + 1;
  const chg = ((last / base - 1) * 100).toFixed(0);
  console.log('  ' + k.padEnd(10) + ' n=' + String(s.length).padStart(5) + '  ' + s[0][0] + ' → ' + s[s.length - 1][0] + '  末值 ' + last.toFixed(1) + '（基期至今 ' + chg + '%）');
  for (let i = 1; i < s.length; i++) if (!(s[i][0] > s[i - 1][0])) { bad(k + ' 日期非单调 @' + i); break; }
});
/* 四个自算 MPF 指数必须同一天；恒指/标普按各自市场交易日更新，允许不同步 */
const mpfDates = ['MPFAVG', 'MPF_STOCK', 'MPF_MIX', 'MPF_BOND'].map((k) => {
  const it = (idx.items || {})[k];
  return it ? (it.asOf || it.series[it.series.length - 1][0]) : '';
});
if (new Set(mpfDates).size > 1) bad('四个自算 MPF 指数末点日期不一致：' + mpfDates.join('/'));
else ok('四个自算 MPF 指数末点一致：' + mpfDates[0]);
/* 2026-11-11（用户反馈两站行情条差 5 天）：自算指数必须跟得上最新净值日。
   云端 Actions 从未跑 mpfindex.js，指数冻结在 11-04 而净值已 11-09，此前没有任何断言能发现。 */
const idxNavDates = funds.map((x) => x.navAsOf).filter(Boolean).sort();
const latestNav = idxNavDates.length ? idxNavDates[idxNavDates.length - 1] : '';
if (latestNav && mpfDates[0] && mpfDates[0] < latestNav) {
  bad('自算 MPF 指数未跟上最新净值日：指数 ' + mpfDates[0] + ' / 净值 ' + latestNav + '（需跑 mpfindex.js）');
} else if (latestNav) {
  ok('自算 MPF 指数跟得上最新净值日：' + mpfDates[0]);
}
console.log('  外部指数末点：恒指 ' + (idx.items.HSI.asOf || '') + ' · 标普 ' + (idx.items.SPX.asOf || '') + '（各自市场交易日）');

console.log('== E 持仓 ==');
const hold = read('holdings.json', { funds: {} });
const hf = hold.funds || {};
const hkeys = Object.keys(hf);
console.log('  条数 ' + hkeys.length + ' · updatedAt ' + new Date(hold.updatedAt || 0).toISOString());
const hMonth = {};
let badWeight = 0, badAlloc = 0, noTop = 0;
hkeys.forEach((id) => {
  const h = hf[id];
  const m = (h.asOf || '—').slice(0, 7);
  hMonth[m] = (hMonth[m] || 0) + 1;
  const t = h.top10 || [];
  if (!t.length) noTop++;
  t.forEach((x) => { if (!(x.weight >= 0 && x.weight <= 100)) badWeight++; });
  const a = (h.alloc || []).reduce((s, x) => s + (Number(x.weight) || 0), 0);
  if (h.alloc && h.alloc.length && (a < 90 || a > 110)) badAlloc++;
});
console.log('  报告期分布：' + Object.keys(hMonth).sort().map((m) => m + '×' + hMonth[m]).join(' · '));
if (badWeight) bad('持仓权重越界 ' + badWeight + ' 条');
/* 2026-11-04：不足 100% 属源便览只列主要类别，页面已用灰色「其他／未列明」补足（不推测拆分），故只作提示 */
if (badAlloc) wrn('投资分布合计 <100% 的有 ' + badAlloc + ' 只（源便览只列主要类别；页面已用「其他／未列明」补足，不推测拆分）');
if (noTop) wrn('无前十大持仓 ' + noTop + ' 只');
const hIds = new Set(hkeys);
const noHold = funds.filter((f) => !hIds.has(String(f.id)));
if (noHold.length) wrn('基金表中有 ' + noHold.length + ' 只没有持仓记录');

console.log('== F 其他数据文件 ==');
const news = read('news.json', { items: [] });
const newsN = (news.items || []).length;
console.log('  新闻 ' + newsN + ' 条，最新 ' + ((news.items || [])[0] || {}).date);
if (!newsN) bad('news.json 为空');
const monthly = read('mpfa-monthly.json', {});
console.log('  积金局月度：' + monthly.asOf + '（' + (monthly.rows || []).length + ' 类）');
if (!monthly.asOf) bad('mpfa-monthly.json 缺 asOf');
/* 2026-11-11：月度统计改为自动抓取（OCR）后，若连续失败会悄悄停在旧月份。
   官方每月 6 日前后发佈，超过 45 天未推进就说明自动化失效了。 */
if (/^\d{4}-\d{2}-\d{2}$/.test(monthly.asOf || '')) {
  const mAge = Math.floor((Date.now() - new Date(monthly.asOf + 'T00:00:00Z').getTime()) / 864e5);
  /* 45 天以上先提醒（官方偶爾晚發），60 天以上才視為自動化失效 */
  if (mAge > 60) bad('積金局月度統計已 ' + mAge + ' 天未推進（asOf ' + monthly.asOf + '，OCR 可能失敗）');
  else if (mAge > 45) wrn('積金局月度統計已 ' + mAge + ' 天未推進（asOf ' + monthly.asOf + '，等官方發佈）');
  else ok('積金局月度統計 ' + monthly.asOf + '（' + mAge + ' 天前）');
}
const allstats = read('allstats.json', {});
console.log('  allstats 键：' + Object.keys(allstats).slice(0, 8).join(','));
/* 2026-11-11：allstats 是走势图「未选基金」统计表的数据源，必须跟着净值日重算。 */
const asAt = Number(allstats.updatedAt) || 0;
const asDays = asAt ? Math.floor((Date.now() - asAt) / 864e5) : 999;
if (asDays > 2) bad('allstats 已 ' + asDays + ' 天未重算（走势图默认统计表会显示旧区间收益）');
else ok('allstats 更新于 ' + new Date(asAt).toISOString().slice(0, 16) + 'Z');
const gaps = read('hist-gaps.json', {});
console.log('  缺口文件：' + (Array.isArray(gaps.gaps) ? gaps.gaps.length : Object.keys(gaps).length) + ' 项');

console.log('== G 共用净值备案 ==');
/* 2026-11-13（复验报告 P1-3）：6 对序列逐点相同曾被反复标为「疑似串档」。
   已向发行人接口取证的 6 对记录在 data/nav-shared-verified.json，
   这里逐对复核「是否仍逐点相同」——出现差异说明其中一只被改过，要重新定性。 */
(function () {
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'nav-shared-check.js')], { encoding: 'utf8' });
    out.split('\n').filter((l) => /✔ |✘ /.test(l)).forEach((l) => console.log('  ' + l.trim()));
    ok('共用净值备案：6 对仍逐点相同（官方共用，非串档）');
  } catch (e) {
    const txt = (e.stdout || '') + (e.stderr || '');
    txt.split('\n').filter((l) => /✘/.test(l)).forEach((l) => console.log('  ' + l.trim()));
    bad('共用净值备案复核未通过：有一对已出现差异，需重新向发行人取证');
  }
})();

console.log('\n== 结果 ==');
console.log(fail ? ('FAIL ' + fail + ' 项 / warn ' + warn + ' 项') : ('全部通过（warn ' + warn + ' 项）'));
process.exit(fail ? 1 : 0);
