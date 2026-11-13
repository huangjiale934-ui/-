#!/usr/bin/env node
/**
 * site-diff.js —— 两站交叉核验（不追求完全一致，而是「差得要合理」）
 *
 * 背景（2026-11-11 用户明确）：GitHub 站必须独立更新，不能依赖本机；
 * 两站保持同源的意义是**互相核验**，某一站出问题时能立刻发现。
 *
 * 判定原则：
 *   · 结构性指标（条数、字段、接口可用性）必须相同 —— 不同就是 bug；
 *   · 时效性指标（净值日、行情日）允许差 1 天 —— 两边抓取时点不同（本机 22:30 / 云端 22:40）；
 *   · 超过 1 天、或某站接口 4xx/5xx/字段缺失 —— 视为异常，醒目标出。
 *
 * 用法：node tools/site-diff.js [--json]
 */
const https = require('https');

/* 2026-11-12：WorkBuddy 站被平台切成「需要分享码」，不带 code 一律 403。
   分享码放 data/wb-share.txt（git 忽略），没有就按公开链接走。 */
let SHARE = process.env.MPF_SHARE || '';
if (!SHARE) { try { SHARE = require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'wb-share.txt'), 'utf8').trim(); } catch (e) {} }
function withShare(u) { return SHARE ? u + (u.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + SHARE : u; }
const A = process.env.MPF_SITE_A || 'https://mpf-data.app.workbuddy.host';
const B = process.env.MPF_SITE_B || 'https://huangjiale934-ui.github.io/-';

/* 2026-11-12：托管层给 A 站加了「分享码」门禁——不带 ?sharecode= 一律 403「链接不完整」。
   用环境变量传入，避免把分享码硬编码进脚本。 */
const CODE_A = process.env.MPF_SITE_A_CODE || '';
const CODE_B = process.env.MPF_SITE_B_CODE || '';
const withCode = (base, path) => {
  const code = base === A ? CODE_A : CODE_B;
  return base + path + (code ? (path.includes('?') ? '&' : '?') + 'sharecode=' + code : '');
};

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(withShare(url), { timeout: 25000, headers: { 'cache-control': 'no-store', 'user-agent': 'mpf-site-diff' } }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', err: 'timeout' }); });
  });
}

/* 静态站是 /api/x.json，动态站是 /api/x；两个都试 */
async function api(base, name) {
  const tries = base.includes('github.io') ? [withCode(base, `/api/${name}.json`)] : [withCode(base, `/api/${name}`)];
  for (const u of tries.concat([withCode(base, `/api/${name}.json`)])) {
    const r = await get(u);
    if (r.status === 200) {
      try { return { ok: true, data: JSON.parse(r.body) }; } catch (e) { return { ok: false, err: 'JSON 解析失败' }; }
    }
  }
  return { ok: false, err: '取不到' };
}

const dayDiff = (a, b) => {
  if (!a || !b) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
};

function dist(items, key) {
  const m = {};
  items.forEach((x) => { const v = x[key] || '-'; m[v] = (m[v] || 0) + 1; });
  return m;
}

function cmpDist(da, db, label, out) {
  const keys = [...new Set([...Object.keys(da), ...Object.keys(db)])].sort();
  keys.forEach((k) => {
    const na = da[k] || 0;
    const nb = db[k] || 0;
    if (na !== nb) out.push({ level: 'diff', field: `${label}[${k}]`, a: na, b: nb });
  });
}

/* 2026-11-13（第三方核验 P0 排查体验）：只报「某净值日 401/411」还得自己去 451 只里翻是哪几只。
   这里把差异基金列出来（最多 10 只，超出注明），排查时一眼能看到是哪家、哪只。 */
function fundDiffList(fa, fb, label, out) {
  if (!Array.isArray(fa) || !Array.isArray(fb)) return;
  const mb = new Map(fb.map((x) => [String(x.id), x]));
  const onlyA = [];
  const onlyB = [];
  const valDiff = [];
  fa.forEach((x) => {
    const y = mb.get(String(x.id));
    if (!y) { onlyA.push(x); return; }
    if (x.navAsOf !== y.navAsOf) valDiff.push([x, y]);
    else if (x.nav != null && y.nav != null && Math.abs(x.nav - y.nav) > 1e-6) valDiff.push([x, y]);
  });
  const ida = new Set(fa.map((x) => String(x.id)));
  fb.forEach((y) => { if (!ida.has(String(y.id))) onlyB.push(y); });
  const fmt = (x) => `${x.id} ${String(x.fund || '').slice(0, 16)}(${x.navAsOf || '—'})`;
  if (onlyA.length) out.push({ level: 'diff', field: `${label} 仅 A 站有`, a: onlyA.length, b: 0, detail: onlyA.slice(0, 10).map(fmt) });
  if (onlyB.length) out.push({ level: 'diff', field: `${label} 仅 B 站有`, a: 0, b: onlyB.length, detail: onlyB.slice(0, 10).map(fmt) });
  if (valDiff.length) {
    out.push({
      level: 'diff', field: `${label} 净值/日期不同`, a: valDiff.length, b: valDiff.length,
      detail: valDiff.slice(0, 10).map(([x, y]) => `${x.id} ${String(x.fund || '').slice(0, 14)}：A ${x.navAsOf || '—'}/${x.nav} ↔ B ${y.navAsOf || '—'}/${y.nav}`),
    });
  }
}

(async () => {
  const issues = [];
  const rows = [];

  /* 6 个接口 × 2 站一次性并发：串行下载 3MB 要 100 秒，并发约 25 秒 */
  const NAMES = ['status', 'ticker', 'funds', 'holdings', 'market', 'navperf', 'breadth'];
  const pack = {};
  await Promise.all(NAMES.map(async (n) => {
    const [x, y] = await Promise.all([api(A, n), api(B, n)]);
    pack[n] = [x, y];
  }));
  const sa = pack.status[0];
  const sb = pack.status[1];
  if (!sa.ok || !sb.ok) {
    issues.push({ level: 'critical', field: 'status 接口', a: sa.ok ? 'ok' : sa.err, b: sb.ok ? 'ok' : sb.err });
  } else {
    const a = sa.data;
    const b = sb.data;
    ['count', 'dataAsOf'].forEach((k) => {
      if (a[k] !== b[k]) issues.push({ level: 'critical', field: k, a: a[k], b: b[k] });
    });
    const d = dayDiff(a.navLatest, b.navLatest);
    if (d !== 0) {
      issues.push({ level: Math.abs(d) >= 2 ? 'critical' : 'timing', field: 'navLatest', a: a.navLatest, b: b.navLatest, delta: d });
    }
    rows.push(['净值日', a.navLatest, b.navLatest]);
    rows.push(['资料截止', a.dataAsOf, b.dataAsOf]);
    rows.push(['条数', a.count, b.count]);
  }

  const ta = pack.ticker[0];
  const tb = pack.ticker[1];
  if (ta.ok && tb.ok) {
    Object.keys(ta.data.items || {}).forEach((k) => {
      const x = ta.data.items[k];
      const y = (tb.data.items || {})[k] || {};
      /* 2026-11-13：自算指数两站各自用当时抓到的 hist/size 计算，末值可能差 0.01 点
         （相对 5e-6），属派生指标的时点差而非数据错误。相对差 < 0.01% 归 timing。 */
      if (x.last !== y.last) {
        const rel = (x.last && y.last) ? Math.abs(x.last - y.last) / Math.max(Math.abs(x.last), Math.abs(y.last)) : 1;
        issues.push({ level: rel < 1e-4 ? 'timing' : 'critical', field: 'ticker.' + k, a: `${x.last}@${x.asOf}`, b: `${y.last}@${y.asOf}`, rel });
      }
      if (x.asOf !== y.asOf) issues.push({ level: 'timing', field: 'ticker.' + k + '.asOf', a: x.asOf, b: y.asOf });
    });
  } else {
    issues.push({ level: 'critical', field: 'ticker 接口', a: ta.ok ? 'ok' : ta.err, b: tb.ok ? 'ok' : tb.err });
  }

  /* 2026-11-13（用户反馈两站 50% vs 49%、较上周 +1 vs -3）：
     首屏涨跌占比必须两站一致。它的输入是 hist + nav-perf，只要两边数据同步就应逐字段相同；
     不同即说明生成链路（breadth.js 有没有在发布前跑过）或数据时点不一致，必须暴露出来。 */
  const ba = pack.breadth[0];
  const bb = pack.breadth[1];
  if (ba.ok && bb.ok) {
    ['asOf', 'total', 'pct', 'pctPrev', 'up', 'upPrev'].forEach((k) => {
      const x = ba.data[k];
      const y = bb.data[k];
      if (x !== y) {
        issues.push({ level: k === 'asOf' ? 'timing' : 'critical', field: 'breadth.' + k, a: x, b: y });
      }
    });
    if (ba.data.delta !== bb.data.delta) {
      issues.push({ level: 'critical', field: 'breadth.较上周(pp)', a: ba.data.delta, b: bb.data.delta });
    }
  } else {
    issues.push({ level: 'critical', field: 'breadth 接口', a: ba.ok ? 'ok' : ba.err, b: bb.ok ? 'ok' : bb.err });
  }

  const fa = pack.funds[0];
  const fb = pack.funds[1];
  if (fa.ok && fb.ok) {
    const la = fa.data.funds || [];
    const lb = fb.data.funds || [];
    if (la.length !== lb.length) issues.push({ level: 'critical', field: 'funds 条数', a: la.length, b: lb.length });
    cmpDist(dist(la, 'navAsOf'), dist(lb, 'navAsOf'), '净值日分布', issues);
    /* 净值日/数值不同时，直接列出是哪几只（最多 10 只） */
    fundDiffList(la, lb, '基金', issues);
    /* 同 id 的净值应完全相同（同源），差异说明某站用了不同批次/坏数据 */
    const mapB = new Map(lb.map((x) => [String(x.id), x]));
    let valueDiff = 0;
    let precDiff = 0;
    const sample = [];
    la.forEach((x) => {
      const y = mapB.get(String(x.id));
      if (!y) return;
      /* 只有「同一天但数值不同」才算异常；日期不同是抓取时点差，已在净值日分布里体现。
         2026-11-13：容差从 1e-6 放宽到 1e-5 —— 抓取原值保留 6-7 位、hist 存 4 位时，
         同一净值会差到 5e-5（4 位小数 vs 7 位小数，如 12.6304 vs 12.6303689），
         这属精度展示差异而非数据错误。真错价至少差 0.01，用 1e-4 可完全区分。 */
      if (x.navAsOf && x.navAsOf === y.navAsOf && x.nav != null && y.nav != null) {
        const d = Math.abs(x.nav - y.nav);
        if (d > 1e-4) {
          valueDiff++;
          if (sample.length < 5) sample.push(`${x.id}:${x.nav}≠${y.nav}`);
        } else if (d > 1e-9) {
          precDiff++;
        }
      }
    });
    if (valueDiff) issues.push({ level: 'critical', field: '同一天但净值不同', a: valueDiff + ' 只', b: sample.join(' ') });
    if (precDiff) issues.push({ level: 'timing', field: '净值精度差（<0.0001%，非错误）', a: precDiff + ' 只', b: '两站取整位数不同' });
  } else {
    issues.push({ level: 'critical', field: 'funds 接口', a: fa.ok ? 'ok' : fa.err, b: fb.ok ? 'ok' : fb.err });
  }

  const ha = pack.holdings[0];
  const hb = pack.holdings[1];
  if (ha.ok && hb.ok) {
    const ya = Object.values(ha.data.funds || {});
    const yb = Object.values(hb.data.funds || {});
    if (ya.length !== yb.length) issues.push({ level: 'critical', field: 'holdings 条数', a: ya.length, b: yb.length });
    const ma = {};
    const mb = {};
    ya.forEach((x) => { const k = (x.asOf || '-').slice(0, 7); ma[k] = (ma[k] || 0) + 1; });
    yb.forEach((x) => { const k = (x.asOf || '-').slice(0, 7); mb[k] = (mb[k] || 0) + 1; });
    cmpDist(ma, mb, '持仓报告期', issues);
  } else {
    issues.push({ level: 'critical', field: 'holdings 接口', a: ha.ok ? 'ok' : ha.err, b: hb.ok ? 'ok' : hb.err });
  }

  const ma = pack.market[0];
  const mb = pack.market[1];
  if (ma.ok && mb.ok) {
    const x = ma.data.mpfaMonthly || {};
    const y = mb.data.mpfaMonthly || {};
    if (x.asOf !== y.asOf) issues.push({ level: 'critical', field: '积金局月度 asOf', a: x.asOf, b: y.asOf });
    if ((x.rows || []).length !== (y.rows || []).length) issues.push({ level: 'critical', field: '积金局月度行数', a: (x.rows || []).length, b: (y.rows || []).length });
  }

  const na = pack.navperf[0];
  const nb = pack.navperf[1];
  if (na.ok && nb.ok) {
    const ca = Object.keys(na.data.funds || {}).length;
    const cb = Object.keys(nb.data.funds || {}).length;
    if (ca !== cb) issues.push({ level: 'diff', field: 'navperf 覆盖', a: ca, b: cb });
    const asOfA = (na.data.funds && Object.values(na.data.funds)[0] || {}).asOf;
    const asOfB = (nb.data.funds && Object.values(nb.data.funds)[0] || {}).asOf;
    if (asOfA && asOfB && asOfA !== asOfB) issues.push({ level: 'timing', field: 'navperf asOf', a: asOfA, b: asOfB });
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ issues, rows }, null, 1));
  } else {
    console.log('== 两站交叉核验 ==');
    console.log('  ' + rows.map((r) => r[0] + ' ' + r[1] + ' / ' + r[2]).join(' · '));
    if (!issues.length) {
      console.log('  ✔ 没有发现差异');
    } else {
      const crit = issues.filter((x) => x.level === 'critical');
      const timing = issues.filter((x) => x.level === 'timing');
      const diff = issues.filter((x) => x.level === 'diff');
      const detail = (x) => {
        if (!x.detail || !x.detail.length) return;
        console.log('      明细：' + x.detail.join('｜'));
      };
      timing.forEach((x) => { console.log(`  · 时点差（正常）${x.field}: ${x.a} / ${x.b}`); detail(x); });
      diff.forEach((x) => { console.log(`  · 数量差 ${x.field}: ${x.a} / ${x.b}`); detail(x); });
      crit.forEach((x) => { console.log(`  ✘ 异常 ${x.field}: ${x.a} / ${x.b}`); detail(x); });
      console.log(`  合计 ${issues.length} 项（异常 ${crit.length}、时点差 ${timing.length}、数量差 ${diff.length}）`);
    }
  }
  process.exit(issues.some((x) => x.level === 'critical') ? 1 : 0);
})();
