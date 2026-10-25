#!/usr/bin/env node
/**
 * 前端渲染校验（CDP）
 * ============================================================
 * 用途：改过 public/ 的详情页逻辑后，验证「真实渲染出来的文字」对不对，
 *       而不是只看源码。走 Chrome DevTools Protocol，不依赖 puppeteer。
 *
 * 用法：
 *   node tools/render-check.js 769                       # 默认校验本地 http://127.0.0.1:3000
 *   CDP_URL=https://mpf-data.app.workbuddy.host/index.html node tools/render-check.js 769
 *
 * 输出（JSON）：badge / driveNote / oldClaim / head —— 分别对应
 *   是否出现「报告期提示」、是否出现「Google Drive 通道不可达」说明、
 *   是否残留旧的不实文案「发行人官网尚未更新本季报告」。
 *
 * 前置：本机已安装 Chrome；被测站点可访问。
 */
'use strict';
const { execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9223);
const URL_ = process.env.CDP_URL || 'http://127.0.0.1:3000/index.html';
const FID = Number(process.argv[2] || 769);
const PROFILE = path.join(__dirname, '..', 'tmp', 'cdp-prof');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let s = ''; r.on('data', (d) => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  if (!fs.existsSync(CHROME)) { console.error('找不到 Chrome：' + CHROME); process.exit(1); }
  const child = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1280,900', URL_,
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
  await send('Runtime.enable', {});
  await sleep(7000);   // 等页面数据载入（线上沙箱较慢）

  const AUTO = process.argv.indexOf('--auto') > 0;   // 不手动开详情，只观察页面自身（用于测 ?f= 深链）
  const expr = AUTO
    ? `(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(4000);
    const m = document.querySelector('#modal');
    const t = document.querySelector('#mTitle');
    return JSON.stringify({
      path: location.pathname + location.search,
      modalShown: !!(m && m.classList.contains('show')),
      title: t ? t.textContent.slice(0, 40) : ''
    });
  })()`
    : `(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    if (typeof window.openDetail !== 'function') return JSON.stringify({ error: 'NO openDetail' });
    let opened = false;
    for (const t of [${FID}, String(${FID})]) {
      window.openDetail(t);
      await wait(800);
      const m = document.querySelector('#modal');
      if (m && m.classList.contains('show')) { opened = true; break; }
    }
    await wait(3500);
    const h = document.querySelector('#fdHolds');
    const txt = h ? h.innerText : '';
    return JSON.stringify({
      opened,
      holdsLen: txt.length,
      badge: txt.indexOf('报告期') >= 0 || txt.indexOf('数据源最后更新') >= 0 || txt.indexOf('取数通道暂不可达') >= 0,
      driveNote: txt.indexOf('Google Drive') >= 0,
      oldClaim: txt.indexOf('尚未更新本季报告') >= 0,
      head: txt.replace(/\\s+/g, ' ').slice(0, 160)
    });
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const val = (r.result && r.result.result && r.result.result.value) || JSON.stringify({ error: 'no value', raw: r.result });
  console.log(val);
  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
