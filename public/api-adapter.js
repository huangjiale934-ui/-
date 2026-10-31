/* api-adapter.js —— GitHub Pages 静态托管适配层（2026-10-25）
 * 原理：拦截 window.fetch，把 /api/* 请求改写为构建期生成的 api/*.json；
 *       /api/dca 改为前端本地计算（算法与 server.js 逐行对齐，hist 从 api/hist/<id>.json 取）；
 *       打点类（hit/event/analytics）在静态托管下降级为无操作。
 * 引入位置：各 HTML <head> 最前（先于 b.js 合并包执行）。
 */
(function () {
  if (window.__apiAdapter) return;
  window.__apiAdapter = true;

  const MEM = {};                 // 进程内缓存（holdings 全量等）
  const jsonResp = (obj) => new Response(JSON.stringify(obj), {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

  /* ---------- /api/dca 前端本地计算（与 server.js 2026-10-25 版逐行对齐） ---------- */
  let FUNDS_CACHE = null;
  async function getFunds() {
    if (FUNDS_CACHE) return FUNDS_CACHE;
    const r = await origFetch('api/funds.json');
    const j = await r.json();
    FUNDS_CACHE = j.funds || [];
    return FUNDS_CACHE;
  }
  const histCache = {};
  async function getHist(id) {
    if (histCache[id]) return histCache[id];
    const r = await origFetch('api/hist/' + encodeURIComponent(String(id).replace(/[^0-9A-Za-z_-]/g, '')) + '.json');
    if (!r.ok) return null;
    const j = await r.json();
    histCache[id] = j;
    return j;
  }
  async function calcDca(q) {
    /* 2026-10-26 修 4-02：与 server.js 参数处理逐行对齐——
       ①end 缺省=上一月（G5：开始月为本月则跟随开始月）②缺省权重=100 ③同一基金重复出现权重相加 */
    const amount = parseFloat(q.amount) || 0;
    const start = (q.start || '').slice(0, 7);
    const nowD = new Date(Date.now() + 8 * 3600e3);
    const prevYM = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
    const defEnd = prevYM.getFullYear() + '-' + String(prevYM.getMonth() + 1).padStart(2, '0');
    const endQ = (q.end || '').slice(0, 7);
    let end = endQ || defEnd;
    if (!endQ && start && /^\d{4}-(0[1-9]|1[0-2])$/.test(start) && end < start) end = start;
    const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
    const agg = new Map();
    (q.funds || '').split(',').map((x) => x.split(':')).filter((a) => a[0]).forEach((a) => {
      const w = (a[1] === undefined || a[1] === '') ? 100 : (parseFloat(a[1]) || 0);
      agg.set(a[0], (agg.get(a[0]) || 0) + w);
    });
    const raw = Array.from(agg.entries()).map(([id, w]) => [id, String(w)]);
    if (!(amount >= 100) || !YM.test(start) || !YM.test(end) || !raw.length) {
      return { ok: false, error: amount < 100 ? '每月供款至少 100 港元' : '参数不完整或月份格式错误（应为 YYYY-MM）' };
    }
    if (end < start) return { ok: false, error: '结束月份早于开始月份' };
    if (raw.some((x) => (parseFloat(x[1]) || 0) < 0)) return { ok: false, error: '权重不能为负数' };

    const wRawSum = raw.reduce((a, x) => a + Math.max(0, parseFloat(x[1]) || 0), 0);
    const wsum = raw.reduce((a, x) => a + (Math.max(0, Math.min(100, parseFloat(x[1]) || 0))), 0);
    const overCap = raw.some((x) => (parseFloat(x[1]) || 0) > 100);
    let warning = null;
    if (raw.length > 10) warning = '单次最多计算 10 只基金，已仅取前 10 只（提交 ' + raw.length + ' 只）';
    if (overCap) warning = (warning ? warning + '；' : '') + '单只基金权重超过 100%，已按 100% 计算（原始合计 ' + (Math.round(wRawSum * 10) / 10) + '%）';
    else if (Math.abs(wsum - 100) > 1) warning = (warning ? warning + '；' : '') + '权重合计 ' + (Math.round(wsum * 10) / 10) + '%，每月实际投入约 ' + Math.round(amount * wsum / 100) + ' 港元（不是 ' + amount + '）';

    const funds = await getFunds();
    const out = [];
    let totalPrincipal = 0, totalValue = 0, maxMonths = 0, asOf = '';
    for (const [id, wRaw] of raw.slice(0, 10)) {
      const w = Math.max(0, Math.min(100, parseFloat(wRaw) || 0)) / 100;
      const h = await getHist(id);
      if (!h || !Array.isArray(h.series) || !h.series.length) { out.push({ id, error: '无历史净值' }); continue; }
      const me = {};
      for (const [d, v] of h.series) { const ym = d.slice(0, 7); if (ym >= start && ym <= end) me[ym] = v; }
      const months = Object.keys(me).sort();
      if (!months.length) {
        const first = h.series[0] ? h.series[0][0].slice(0, 7) : '';
        const last = h.series[h.series.length - 1] ? h.series[h.series.length - 1][0].slice(0, 7) : '';
        let msg = '所选区间内无该基金净值';
        if (last && end < first) msg = '所选区间早于该基金最早净值（' + first + '）';
        else if (first && start > last) msg = '起始月份晚于最新净值月（' + last + '）';
        out.push({ id, error: msg }); continue;
      }
      let units = 0, principal = 0;
      for (const m of months) { const nav = me[m]; if (!nav) continue; const cash = amount * w; units += cash / nav; principal += cash; }
      const lastMonth = months[months.length - 1];
      const latestRow = h.series[h.series.length - 1];
      const lastNav = latestRow ? latestRow[1] : me[lastMonth];
      const latestDate = latestRow ? latestRow[0] : '';
      const value = units * lastNav;
      totalPrincipal += principal; totalValue += value;
      maxMonths = Math.max(maxMonths, months.length);
      const mdiff = (a, b) => { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
      const missing = Math.max(0, mdiff(start, months[0]));
      const expectMonths = mdiff(start, end) + 1;
      const gapMonths = Math.max(0, expectMonths - months.length);
      out.push({ id, name: h.name, scheme: h.scheme, weight: Math.round(w * 1000) / 10, months: months.length,
        expectMonths, gapMonths, firstMonth: months[0], lastMonth,
        lastDate: latestDate || h.asOf || lastMonth, payToMonth: lastMonth,
        lastAsOf: h.asOf || lastMonth, firstDate: (h.series && h.series[0] && h.series[0][0]) || months[0],
        lastNav: Math.round(lastNav * 10000) / 10000, firstAvailable: (h.series && h.series[0] && h.series[0][0]) || months[0],
        missing, principal: Math.round(principal), value: Math.round(value), gain: Math.round(value - principal),
        rate: principal ? Math.round((value / principal - 1) * 10000) / 100 : null });
    }
    const ok = out.filter((x) => !x.error);
    const gain = totalValue - totalPrincipal;
    let limitMonth = '', limiter = '', limitDate = '';
    ok.forEach((x) => { if (x.lastMonth < end && (!limitMonth || x.lastMonth < limitMonth)) { limitMonth = x.lastMonth; limiter = x.name; limitDate = x.lastAsOf || x.lastMonth; } });
    const launchOf = (id) => { const f = funds.find((y) => String(y.id) === String(id)); return (f && f.launch) ? f.launch : ''; };
    const toISO = (d) => { const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(d || '').trim()); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
    const gaps = ok.filter((x) => x.gapMonths > 0).map((x) => {
      const launch = toISO(launchOf(x.id));
      const late = launch && launch.slice(0, 7) > start;
      return { id: x.id, name: x.name, gapMonths: x.gapMonths, firstMonth: x.firstMonth, firstDate: x.firstDate,
        launch: launch || '', reason: late ? 'late-launch' : 'source-short', tail: !late && x.lastMonth < end };
    });
    ok.forEach((x) => { const d = x.lastDate || x.lastMonth; if (!asOf || d < asOf) asOf = d; });
    let firstMonth = '';
    ok.forEach((x) => { if (!firstMonth || x.firstMonth < firstMonth) firstMonth = x.firstMonth; });
    return {
      ok: ok.length > 0, months: maxMonths, asOf, warning, start, end,
      limitMonth, limiter, limitDate, gaps, firstMonth,
      errors: out.filter((x) => x.error).map((x) => ({ id: x.id, error: x.error })),
      principal: Math.round(totalPrincipal), value: Math.round(totalValue), gain: Math.round(gain),
      rate: totalPrincipal ? Math.round((totalValue / totalPrincipal - 1) * 10000) / 100 : null,
      funds: out,
    };
  }

  /* ---------- fetch 拦截 ---------- */
  const origFetch = window.fetch.bind(window);

  /* 2026-10-25 双模式探测：本文件同时存在于 WorkBuddy 部署（真实后端）与 GitHub Pages
   * （纯静态）两个站点。探测 /api/status 一次——返回 JSON 即真实后端存在 → 全部放行不拦截；
   * 404/非 JSON（Pages 上 /api/* 会 404）→ 进入静态改写模式。保证 WorkBuddy 站零影响。 */
  let MODE = null, probeP = null;
  function detectMode() {
    if (MODE) return Promise.resolve(MODE);
    if (!probeP) {
      probeP = (async () => {
        try {
          /* 相对探测：WorkBuddy 根路径 → /api/status(200 JSON=live)；Pages /-/ → /-/api/status(404=static)。消除绝对路径在 Pages 上的 404 噪音（4-09） */
          const r = await origFetch('api/status?_probe=' + Date.now(), { cache: 'no-store' });
          const ct = (r.headers.get('content-type') || '');
          if (r.ok && ct.indexOf('json') >= 0) { MODE = 'live'; return MODE; }
        } catch (e) { /* Pages 上 /api/status 404 → 走静态 */ }
        MODE = 'static';
        return MODE;
      })();
    }
    return probeP;
  }

  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    let method = (init && init.method) || (input && input.method) || 'GET';
    if (!/\/api\//.test(url)) return origFetch(input, init);
    if ((await detectMode()) === 'live') return origFetch(input, init);   // 真实后端：原样透传

    const pathAndQuery = url.slice(url.indexOf('/api/') + 5);   // e.g. "funds"、"hist/268"、"top?k=y1&n=5"
    const qIdx = pathAndQuery.indexOf('?');
    const p = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery;
    const qs = new URLSearchParams(qIdx >= 0 ? pathAndQuery.slice(qIdx + 1) : '');

    /* 打点/管理类：静态托管下降级为无操作 */
    if (method === 'POST' || p === 'hit' || p === 'event' || p === 'refresh' || p === 'upload') {
      return jsonResp({ ok: true });
    }
    if (p === 'analytics') return jsonResp({ today: null, days: [] });

    /* 计算器：本地计算（URLSearchParams → 普通对象，calcDca 用属性访问取值） */
    if (p === 'dca') return jsonResp(await calcDca(Object.fromEntries(qs)));

    /* 带 query 的端点 */
    if (p === 'indices') {
      const rel = qs.get('lite') === '1' ? 'api/indices-lite.json' : 'api/indices.json';
      return origFetch(rel);
    }
    if (p === 'top') {
      const j = await (await origFetch(qs.get('k') === 'y5a' ? 'api/top-y5a.json' : 'api/top-y1.json')).json();
      const n = Math.max(1, Math.min(20, parseInt(qs.get('n') || '5', 10) || 5));
      return jsonResp({ key: j.key, count: j.count, items: (j.items || []).slice(0, n) });
    }
    if (p === 'holdings') {
      const oneId = qs.get('id');
      if (!oneId) return origFetch('api/holdings.json');
      if (!MEM.holdings) MEM.holdings = await (await origFetch('api/holdings.json')).json();
      const one = (MEM.holdings.funds || {})[String(oneId)] || null;
      return jsonResp({ updatedAt: MEM.holdings.updatedAt, funds: { [String(oneId)]: one } });
    }
    /* 净值序列：两种调用形式都支持——/api/hist/<id>（路径参数式）与 /api/hist?id=<id> */
    if (p === 'hist' || /^hist\/[0-9A-Za-z_-]+$/.test(p)) {
      const hid = /^hist\//.test(p) ? p.slice(5) : (qs.get('id') || '');
      const safe = String(hid || '').replace(/[^0-9A-Za-z_-]/g, '');
      if (!safe) return jsonResp({ error: '缺少基金 id' });
      return origFetch('api/hist/' + safe + '.json');
    }
    if (p === 'status') {
      const r = await origFetch('api/status.json');
      const j = await r.json();
      j.refreshing = false; j.refreshingSince = 0;   // 静态托管下恒为「无刷新在途」
      return jsonResp(j);
    }

    /* 直读端点 → 同名 JSON 文件 */
    const KNOWN = ['funds', 'market', 'holdings', 'navperf', 'hist-index', 'names-en', 'trustee-perf',
                   'trustee-idx', 'allstats', 'news', 'hist-gaps', 'ticker', 'perf-idx', 'source-pages'];
    if (KNOWN.indexOf(p) >= 0) return origFetch('api/' + p + '.json');

    /* 未知端点：原样放行（让调用方拿到 404 便于发现问题） */
    return origFetch(input, init);
  };
})();
