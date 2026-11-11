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

const A = process.env.MPF_SITE_A || 'https://mpf-data.app.workbuddy.host';
const B = process.env.MPF_SITE_B || 'https://huangjiale934-ui.github.io/-';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 25000, headers: { 'cache-control': 'no-store', 'user-agent': 'mpf-site-diff' } }, (res) => {
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
  const tries = base.includes('github.io') ? [`${base}/api/${name}.json`] : [`${base}/api/${name}`];
  for (const u of tries.concat([`${base}/api/${name}.json`])) {
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

(async () => {
  const issues = [];
  const rows = [];

  /* 6 个接口 × 2 站一次性并发：串行下载 3MB 要 100 秒，并发约 25 秒 */
  const NAMES = ['status', 'ticker', 'funds', 'holdings', 'market', 'navperf'];
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
      if (x.last !== y.last) issues.push({ level: 'critical', field: 'ticker.' + k, a: `${x.last}@${x.asOf}`, b: `${y.last}@${y.asOf}` });
      if (x.asOf !== y.asOf) issues.push({ level: 'timing', field: 'ticker.' + k + '.asOf', a: x.asOf, b: y.asOf });
    });
  } else {
    issues.push({ level: 'critical', field: 'ticker 接口', a: ta.ok ? 'ok' : ta.err, b: tb.ok ? 'ok' : tb.err });
  }

  const fa = pack.funds[0];
  const fb = pack.funds[1];
  if (fa.ok && fb.ok) {
    const la = fa.data.funds || [];
    const lb = fb.data.funds || [];
    if (la.length !== lb.length) issues.push({ level: 'critical', field: 'funds 条数', a: la.length, b: lb.length });
    cmpDist(dist(la, 'navAsOf'), dist(lb, 'navAsOf'), '净值日分布', issues);
    /* 同 id 的净值应完全相同（同源），差异说明某站用了不同批次/坏数据 */
    const mapB = new Map(lb.map((x) => [String(x.id), x]));
    let valueDiff = 0;
    const sample = [];
    la.forEach((x) => {
      const y = mapB.get(String(x.id));
      if (!y) return;
      if (x.nav != null && y.nav != null && Math.abs(x.nav - y.nav) > 1e-6) {
        valueDiff++;
        if (sample.length < 5) sample.push(`${x.id}:${x.nav}≠${y.nav}`);
      }
    });
    if (valueDiff) issues.push({ level: 'critical', field: '同一基金净值不一致', a: valueDiff + ' 只', b: sample.join(' ') });
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
      timing.forEach((x) => console.log(`  · 时点差（正常）${x.field}: ${x.a} / ${x.b}`));
      diff.forEach((x) => console.log(`  · 数量差 ${x.field}: ${x.a} / ${x.b}`));
      crit.forEach((x) => console.log(`  ✘ 异常 ${x.field}: ${x.a} / ${x.b}`));
      console.log(`  合计 ${issues.length} 项（异常 ${crit.length}、时点差 ${timing.length}、数量差 ${diff.length}）`);
    }
  }
  process.exit(issues.some((x) => x.level === 'critical') ? 1 : 0);
})();
