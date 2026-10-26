#!/usr/bin/env node
/* 线上健康巡检（2026-10-23）
   检查线上站点的「数据是否更新、三处是否一致、持仓/分布是否完整、页面是否可打开」。
   用法：node tools/health-check.js
   输出：控制台摘要 + data/health/<日期>.json；有严重问题时退出码 1
*/
const fs = require('fs');
const path = require('path');
const SITE = (process.env.MPF_SITE || 'https://mpf-data.app.workbuddy.host').replace(/\/$/, '');
/* 2026-10-26 修 4-05：--local 模式（GitHub Actions 用）——数据全部本地读档，
   跳过「站点可达 / 净值日滞后 / 计算器线上抽样」三项依赖线上 API 的检查，
   保留三处一致 / top10 五规则 / allocSum / 缺日巡检 / 渠道一致性四类数据哨兵 */
const LOCAL = process.argv.includes('--local');
const OUT_DIR = path.join(__dirname, '..', 'data', 'health');

/* 2026-10-24：加超时与重试。此前一次连接被掐断（terminated）就让整次体检 exit 2。 */
const LOCAL_FILES = {
  '/api/funds': '../data/funds.json',
  '/api/holdings': '../data/holdings.json',
  '/api/navperf': '../data/nav-perf.json',
};
const get = async (p, tries = 3) => {
  if (LOCAL) {
    const rel = LOCAL_FILES[p.split('?')[0]];
    if (!rel) return { status: 0, json: null };
    try {
      return { status: 200, json: JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8')) };
    } catch (e) {
      return { status: 0, json: null };
    }
  }
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    try {
      /* 2026-10-24：加时间戳绕过 CDN/边缘缓存，否则会读到旧快照误报 */
      const bust = (p.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
      const r = await fetch(SITE + p + bust, {
        headers: { 'user-agent': 'mpf-health/1.0' },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });
      const txt = await r.text();
      let json = null;
      try { json = JSON.parse(txt); } catch (e) {}
      return { status: r.status, json, txt };
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  return { status: 0, json: null, txt: '', err: lastErr };
};

const hkToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

(async () => {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });

  const st = await get('/api/status');
  if (!LOCAL && (st.status !== 200 || !st.json)) add('critical', '状态接口不可用 HTTP ' + st.status);
  const s = st.json || {};
  if (s.error) add('warn', '抓取错误：' + s.error);
  if (!LOCAL && s.navLatest && days(s.navLatest, hkToday()) > 3) add('critical', '净值日滞后：' + s.navLatest + '（今天 ' + hkToday() + '）');
  if (LOCAL) add('ok', '--local 模式：已跳过站点可达/净值日滞后/计算器线上抽样');

  const funds = await get('/api/funds');
  const fl = (funds.json && funds.json.funds) || [];
  if (!fl.length) add('critical', '基金接口为空');
  else {
    if (fl.length !== 451) add('warn', '基金条数 ' + fl.length + '（预期 451）');
    const noNav = fl.filter((f) => f.nav == null && f.navStatus !== 'na').length;
    if (noNav) add('warn', noNav + ' 只无净值（非 na）');
  }

  /* 三處一致：全量 451 隻比對 funds.nav ↔ hist 末點 ↔ navperf.asOf
     2026-10-24 改全量（抽樣 40 曾漏報 30 隻錯位）；hist 改本地讀檔（451 次 <2s，不走線上 API） */
  const perfRes = await get('/api/navperf');
  if (!perfRes.json) add('warn', '自算指标接口取数失败：' + (perfRes.err || ''));
  const perf = perfRes.json || { funds: {} };
  const sample = fl.filter((f) => f.nav && f.navAsOf);
  let valBad = 0, dateBad = 0, checked = 0;
  for (const f of sample) {
    let last = null;
    try {
      const hj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hist', f.id + '.json'), 'utf8'));
      const ser = hj.series || hj;
      last = ser && ser.length ? ser[ser.length - 1] : null;
    } catch (e) { continue; }
    if (!last) continue;
    checked++;
    if (Math.abs(last[1] / f.nav - 1) > 0.002) valBad++;
    const p = (perf.funds || {})[String(f.id)];
    if (last[0] !== f.navAsOf || (p && p.asOf && p.asOf !== f.navAsOf)) dateBad++;
  }
  if (valBad) add('critical', '净值三处数值不一致：' + valBad + '/' + checked);
  if (dateBad) add('warn', '净值三处日期不一致：' + dateBad + '/' + checked);

  const hdRes = await get('/api/holdings');
  if (!hdRes.json) add('warn', '持仓接口取数失败：' + (hdRes.err || ''));
  const hd = hdRes.json || { funds: {} };
  const hv = Object.values(hd.funds || {});
  const noAlloc = hv.filter((x) => x.alloc && x.alloc.length && !x.allocTitle).length;
  const noAllocData = hv.filter((x) => !x.alloc || !x.alloc.length).length;
  const shortTop = hv.filter((x) => x.top10 && x.top10.length && x.top10.length < 10).length;
  const unsorted = hv.filter((x) => x.top10 && x.top10.some((v, i, a) => i && a[i - 1].weight < v.weight)).length;
  const noDate = hv.filter((x) => x.top10 && x.top10.length && !x.asOf).length;
  /* 2026-10-24：top10 補名稱/污染/合計檢查（與 holdings-guard.js 規則一致；抽樣/漏項曾漏報 18 隻 P0） */
  const STAT = /Fund Risk Indicator|Yield to Maturity|Expense Ratio|Modified Duration|Credit Rating/i;
  const BUCKET = /^(AAA|AA\/Aa|A|BBB\/Baa|BBB|B|CCC|Others\*)$/i;
  const emptyName = hv.filter((x) => (x.top10 || []).some((y) => !String(y.name || '').trim())).length;
  const statRow = hv.filter((x) => (x.top10 || []).some((y) => STAT.test(String(y.name || '')) || BUCKET.test(String(y.name || '').trim()))).length;
  const overSum = hv.filter((x) => (x.top10 || []).reduce((a, y) => a + (+y.weight || 0), 0) > 100.5).length;
  const ctrlChar = hv.filter((x) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test((x.top10 || []).map((y) => y.name || '').join(''))).length;
  if (emptyName) add('critical', '十大持仓名称为空 ' + emptyName + ' 只');
  if (statRow) add('critical', '十大持仓混入统计行/评级桶 ' + statRow + ' 只');
  if (overSum) add('critical', '十大持仓合计超 100.5 ' + overSum + ' 只');
  if (ctrlChar) add('critical', '十大持仓含控制字符 ' + ctrlChar + ' 只');

  /* ============ 2026-10-25 采纳第三轮核验「每日自检补充方案」五项 ============ */
  const HISTD = path.join(__dirname, '..', 'data', 'hist');
  /* ① allocSum 字段完整性：缺失/null、声明值与逐项合计差 >0.02 */
  let allocSumMissing = 0, allocSumNull = 0, allocSumDiff = 0;
  hv.forEach((x) => {
    const a = x.alloc || [];
    if (x.allocSum === undefined) allocSumMissing++;
    else if (x.allocSum === null) allocSumNull++;
    const s = a.reduce((p, c) => p + (+c.weight || 0), 0);
    if (x.allocSum != null && Math.abs(x.allocSum - s) > 0.02) allocSumDiff++;
  });
  if (allocSumMissing) add('warn', 'allocSum 字段缺失 ' + allocSumMissing + ' 只（跑 holdings-guard --fix）');
  if (allocSumNull) add('warn', 'allocSum 为 null ' + allocSumNull + ' 只');
  if (allocSumDiff) add('critical', 'allocSum 与逐项合计不符 ' + allocSumDiff + ' 只');

  /* ② 全源缺日巡检（本地 hist × HSI 日历近 7 交易日；SKIP 只留月频新地；AMTD 渠道固有缺口豁免） */
  let gapFunds = 0, gapDays = new Set();
  try {
    const idxL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'index.json'), 'utf8'));
    const hsi = (idxL.items.HSI.series || []).map((x) => x[0]);
    const recent7 = hsi.slice(-7, -1);
    const WAIVE = { 'AMTD強積金計劃': ['2026-10-15', '2026-10-16', '2026-10-22'] };
    fl.forEach((f) => {
      if (/新地/.test(f.scheme || '')) return;   // 月频豁免
      const fp = path.join(HISTD, String(f.id) + '.json');
      if (!fs.existsSync(fp)) return;
      try {
        const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const have = new Set((o.series || []).map((x) => x[0]));
        const waived = WAIVE[f.scheme] || [];
        const miss = recent7.filter((d) => !have.has(d) && !waived.includes(d));
        if (miss.length) { gapFunds++; miss.forEach((d) => gapDays.add(d)); }
      } catch (e) {}
    });
  } catch (e) { add('warn', '缺日巡检读取失败：' + e.message); }
  if (gapFunds) add('warn', '近端缺日 ' + gapFunds + ' 只（' + [...gapDays].join(',') + '）');

  /* ③ NAV 渠道一致性：navSource 与 hist 实际来源不一致 = 官网渠道被 etnet 回写或官网抓取失败回退 */
  let srcMismatch = 0, srcMissId = '';
  try {
    const fj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'funds.json'), 'utf8'));
    (fj.funds || []).forEach((f) => {
      const fp = path.join(HISTD, String(f.id) + '.json');
      if (!fs.existsSync(fp)) return;
      try {
        const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (o.src && f.navSource && f.navSource !== o.src) { srcMismatch++; if (!srcMissId) srcMissId = f.id; }
      } catch (e) {}
    });
  } catch (e) {}
  if (srcMismatch) add('warn', 'navSource 与 hist 来源不一致 ' + srcMismatch + ' 只（首个 ' + srcMissId + '；官网渠道应优先）');

  if (LOCAL) {
    add('ok', '计算器抽样回归：--local 模式跳过（依赖线上 API 对照，Actions 内不可用；全量验证由独立核验承担）');
  } else
  /* ⑤ 计算器抽样回归：20 只 × 5 组本地独立重算（月最后交易日买入 → 份额累计 → 期末按最新净值估值），
        抽 3 组打线上 /api/dca 端到端比对 */
  try {
    const dcaFunds = [];
    const byTr = {};
    fl.filter((f) => f.nav && f.navStatus !== 'na').forEach((f) => {
      (byTr[f.trustee] = byTr[f.trustee] || []).push(f);
    });
    Object.values(byTr).forEach((arr) => { if (arr.length) dcaFunds.push(arr[0]); });
    const pick = dcaFunds.slice(0, 20);
    const ym = (d) => String(d).slice(0, 7);
    const calcDca = (ser, start, end, amt) => {
      const me = {};
      ser.forEach(([d, v]) => { const m = ym(d); if (m >= start && m <= end) me[m] = v; });
      const months = Object.keys(me).sort();
      if (!months.length) return null;
      let units = 0;
      months.forEach((m) => { units += amt / me[m]; });
      const lastV = ser[ser.length - 1][1];   /* 口径：期末按最新净值（hist 全序列末点），非结束月当月 */
      const principal = amt * months.length;
      const value = units * lastV;
      return { months: months.length, principal: Math.round(principal), value: Math.round(value), rate: +(((value / principal) - 1) * 100).toFixed(2) };
    };
    const end = ym(new Date(Date.now() + 8 * 3600e3).toISOString());
    const startN = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return ym(d.toISOString()); };
    const params = [[2000, startN(6), end], [2000, startN(12), end], [3000, startN(36), end]];
    let dcaBad = 0, dcaChecked = 0;
    for (const f of pick) {
      let ser = [];
      try { ser = JSON.parse(fs.readFileSync(path.join(HISTD, String(f.id) + '.json'), 'utf8')).series || []; } catch (e) { continue; }
      if (!ser.length) continue;
      for (const [amt, st, en] of params) {
        const mine = calcDca(ser, st, en, amt);
        const apiRes = await get('/api/dca?funds=' + f.id + ':100&amount=' + amt + '&start=' + st + '&end=' + en, 1);
        const j = apiRes.json;
        const theirs = j && j.ok !== false && j.funds && j.funds[0] ? j.funds[0] : null;
        dcaChecked++;
        if (!mine || !theirs || Math.abs(mine.principal - (theirs.principal || 0)) > 1 ||
            Math.abs(mine.value - (theirs.value || 0)) > 1) { dcaBad++; }
      }
    }
    if (dcaBad) add('critical', '定投计算器抽样回归不一致 ' + dcaBad + '/' + dcaChecked + ' 组');
    else add('ok', '计算器抽样回归 ' + dcaChecked + ' 组一致');
  } catch (e) { add('warn', '计算器抽样回归执行失败：' + e.message); }
  if (noAlloc) add('warn', '分布缺口径标题 ' + noAlloc + ' 只');
  if (noAllocData) add('warn', '无资产分布 ' + noAllocData + ' 只');
  if (shortTop) add('warn', '十大持仓不足 10 条 ' + shortTop + ' 只');
  if (unsorted) add('critical', '十大持仓未降序 ' + unsorted + ' 只');
  if (noDate) add('warn', '无报告期 ' + noDate + ' 只');

  if (LOCAL) {
    add('ok', '--local：跳过页面可达检查（Actions 构建期站点尚未发布）');
  } else for (const p of ['/', '/index.html', '/analysis.html']) {
    const r = await get(p);
    if (r.status !== 200) add('critical', '页面打不开 ' + p + ' HTTP ' + r.status);
    else if (r.txt.length < 3000) add('warn', '页面内容异常短 ' + p);
  }

  const report = {
    at: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '),
    site: SITE, navLatest: s.navLatest, dataAsOf: s.dataAsOf, count: fl.length,
    checks: { valBad, dateBad, checked, noAlloc, noAllocData, shortTop, unsorted, noDate, emptyName, statRow, overSum, ctrlChar },
    issues,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, hkToday() + '.json'), JSON.stringify(report, null, 1));

  const critical = issues.filter((i) => i.level === 'critical');
  console.log('=== 健康巡检 ' + report.at + ' ===');
  console.log('净值日 ' + (s.navLatest || '-') + '｜档案 ' + (s.dataAsOf || '-') + '｜基金 ' + fl.length);
  console.log('三处一致：数值 ' + valBad + '/' + checked + '，日期 ' + dateBad + '/' + checked);
  console.log('持仓：无分布 ' + noAllocData + '，不足10条 ' + shortTop + '，未排序 ' + unsorted + '，无日期 ' + noDate + '，空名 ' + emptyName + '，统计行 ' + statRow + '，超合计 ' + overSum + '，控制字符 ' + ctrlChar);
  if (!issues.length) console.log('✔ 未发现问题');
  else issues.forEach((i) => console.log('  [' + i.level + '] ' + i.msg));
  process.exit(critical.length ? 1 : 0);
})().catch((e) => { console.error('巡检失败：' + e.message); process.exit(2); });
