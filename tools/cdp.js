/**
 * 极简 CDP 驱动（Node 22 内置 WebSocket）—— 用于无头浏览器交互测试与截图
 * 用法：node tools/cdp.js <url> <outPng> [--js "expr"] [--wait ms] [--w 1440] [--h 2000]
 *   --js 可多次；按顺序执行，表达式结果打印到 stdout
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
const jsList = [];
let waitMs = 4000, W = 1440, H = 2000, VP = false;
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--js') jsList.push(args[++i]);
  else if (args[i] === '--wait') waitMs = parseInt(args[++i], 10);
  else if (args[i] === '--w') W = parseInt(args[++i], 10);
  else if (args[i] === '--h') H = parseInt(args[++i], 10);
  else if (args[i] === '--vp') VP = true;
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), 'cdp-' + Date.now());
const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--window-size=' + W + ',' + H,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const pg = list.find((t) => t.type === 'page');
      if (pg && pg.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl;
    } catch (e) { /* not ready */ }
    await sleep(200);
  }
  throw new Error('chrome not ready');
}

(async () => {
  const wsUrl = await getWs();
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXC ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      errors.push(m.params.type.toUpperCase() + ' ' + m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('LOG ' + m.params.entry.text.slice(0, 200));
    }
  });
  await send('Page.enable');
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(waitMs);

  for (const expr of jsList) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const v = r.result && r.result.result;
    console.log('JS>', v && (v.value !== undefined ? JSON.stringify(v.value) : v.description));
  }
  await sleep(600);

  if (out) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !VP });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('saved', out);
  }
  if (errors.length) { console.log('--- console errors ---'); errors.slice(0, 20).forEach((e) => console.log(' ', e)); }
  else console.log('--- no console errors ---');
  ws.close();
  proc.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); proc.kill(); process.exit(1); });
