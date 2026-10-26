/* 表格交互验证（2026-10-26）：维度→列联动 + 列显隐 + 高亮
   用法：CDP_URL=http://127.0.0.1:3999/index.html?rk=cumLaunch node tools/verify-tables.js */
const { execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9224);
const URL_ = process.env.CDP_URL || 'http://127.0.0.1:3999/index.html?rk=cumLaunch';
const PROFILE = path.join(__dirname, '..', 'tmp', 'cdp-prof2');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let s = ''; r.on('data', (d) => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  if (!fs.existsSync(CHROME)) { console.error('找不到 Chrome'); process.exit(1); }
  const child = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1400,950', URL_,
  ], () => {});
  let list = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { list = await getJSON('/json/list'); if (list && list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break; } catch (e) {}
  }
  const page = (list || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) { console.error('找不到调试页'); child.kill(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  const send = (method, params) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  
  await sleep(9000);

  const out = {};
  /* MPFA 榜（rkTable）：cumLaunch 深链应联动 */
  out.rk = await evalJS(`(function () {
    const tbl = document.getElementById('rkTable');
    if (!tbl) return { exist: false };
    const vis = (k) => { const el = tbl.querySelector('[data-c="' + k + '"]'); return el ? getComputedStyle(el).display !== 'none' : null; };
    const ths = [...document.getElementById('rkThead').children];
    const idx = (k) => ths.findIndex((t) => t.dataset.c === k);
    return {
      exist: true,
      cumLaunchVis: vis('cumLaunch'),
      cumLaunchHL: !!tbl.querySelector('[data-c="cumLaunch"].dim-hl'),
      cumLaunchAfterRisk: idx('cumLaunch') === idx('risk') + 1,
      mgmtFeeVis: vis('mgmtFee'),
      mgmtFeeDefaultHidden: getComputedStyle(tbl.querySelector('[data-c="mgmtFee"]')).display === 'none',
      firstDataRow: (tbl.querySelector('#rkTbody tr') || {}).children ? [...tbl.querySelector('#rkTbody tr').children].map((c) => c.dataset.c).join(',') : ''
    };
  })()`);
  /* MPFA 榜切换到 size 维度 */
  out.rkSize = await evalJS(`(function () {
    const tab = document.querySelector('#rkTabs .tab[data-b="size"]');
    if (!tab) return { tab: false };
    tab.click();
    return new Promise((res) => setTimeout(() => {
      const tbl = document.getElementById('rkTable');
      const ths = [...document.getElementById('rkThead').children];
      const idx = (k) => ths.findIndex((t) => t.dataset.c === k);
      res({
        tab: true,
        sizeHL: !!tbl.querySelector('[data-c="size"].dim-hl'),
        sizeAfterRisk: idx('size') === idx('risk') + 1,
        sizeVis: getComputedStyle(tbl.querySelector('#rkThead [data-c="size"]')).display !== 'none'
      });
    }, 400));
  })()`);
  /* fundTable：点维度卡 sharpe1（默认隐藏列） */
  out.fund = await evalJS(`(function () {
    const tbl = document.getElementById('fundTable');
    if (!tbl) return { exist: false };
    const st = document.querySelector('#selfTabs .st[data-k="sharpe1"]');
    if (!st) return { card: false };
    st.click();
    return new Promise((res) => setTimeout(() => {
      const ths = [...document.getElementById('thead').children];
      const idx = (k) => ths.findIndex((t) => t.dataset.c === k);
      res({
        card: true,
        sharpeVis: getComputedStyle(tbl.querySelector('#thead [data-c="sharpe1"]')).display !== 'none',
        sharpeHL: !!tbl.querySelector('#thead [data-c="sharpe1"].dim-hl'),
        sharpeAfterRisk: idx('sharpe1') === idx('risk') + 1
      });
    }, 400));
  })()`);
  console.log(JSON.stringify(out, null, 1));
  const ok = out.rk && out.rk.cumLaunchVis && out.rk.cumLaunchHL && out.rk.cumLaunchAfterRisk && out.rk.mgmtFeeDefaultHidden &&
             out.rkSize && out.rkSize.sizeHL && out.rkSize.sizeAfterRisk &&
             out.fund && out.fund.sharpeVis && out.fund.sharpeHL && out.fund.sharpeAfterRisk;
  child.kill();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('fail:', String(e).slice(0, 200)); process.exit(1); });
