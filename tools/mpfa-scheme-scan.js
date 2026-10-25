#!/usr/bin/env node
/**
 * MPFA 注册计划扫描：列出每个计划的名称与「基金便览」PDF 链接
 * ============================================================
 * 背景：MPFA 把各计划的基金便览汇总为 https://www.mpfa.org.hk/assets/FF/<计划编号>.pdf
 *      比逐家官网找便览可靠得多。计划详情页 fudetail.do?schId=SCH0000000000NN 只能由
 *      浏览器取（curl 只返回 230B 空壳），所以用 CDP 枚举 schId。
 *
 * 用法：node tools/mpfa-scheme-scan.js [起始] [结束]
 * 输出：tmp/mpfa-schemes.json  +  控制台表格
 */
'use strict';
const { execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'tmp', 'cdp-mpfa');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9228);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let s = ''; r.on('data', (d) => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

const FROM = Number(process.argv[2] || 1);
const TO = Number(process.argv[3] || 60);
const pad = (n) => String(n).padStart(12, '0');

(async () => {
  const child = execFile(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1280,900',
    'about:blank'], () => {});
  let ver = null;
  for (let i = 0; i < 40; i++) { await sleep(500); try { ver = await getJSON('/json/version'); break; } catch (e) {} }
  if (!ver) { console.error('Chrome 未启动'); process.exit(1); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  const pending = new Map(); let seq = 0;
  const send = (m, p, sid) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: sid })); });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
  await send('Page.enable', {}, sid);

  const out = [];
  for (let n = FROM; n <= TO; n++) {
    const sch = 'SCH' + pad(n);
    const url = 'https://www.mpfa.org.hk/sch/public_registers/registered_schemes_cf/fudetail.do?schId=' + sch;
    await send('Page.navigate', { url }, sid);
    await sleep(1600);
    const r = await send('Runtime.evaluate', {
      returnByValue: true, expression: `(() => {
        const txt = document.body ? document.body.innerText : '';
        const ff = Array.from(document.querySelectorAll('a[href*="/assets/FF/"]')).map(a => a.getAttribute('href'));
        // 计划名：页面里第一段像「XX強積金計劃」的文字
        const m = txt.match(/([^\\n]{4,40}(?:強積金計劃|退休計劃|退休金計劃|集成信託計劃))/);
        return JSON.stringify({ sch: location.search, name: m ? m[1].trim() : '', ff: ff[0] || '', len: txt.length });
      })()`
    }, sid);
    const v = JSON.parse((r.result && r.result.result && r.result.result.value) || '{}');
    if (v.name || v.ff) {
      out.push({ n, sch, name: v.name, ff: v.ff ? 'https://www.mpfa.org.hk' + v.ff : '' });
      console.log('%3d  %-16s %-42s %s', n, sch, v.name.slice(0, 40), v.ff);
    }
    if (v.len < 200) { /* 空壳，跳过 */ }
  }
  fs.writeFileSync(path.join(ROOT, 'tmp', 'mpfa-schemes.json'), JSON.stringify(out, null, 1));
  console.log('\n共 %d 个计划', out.length);
  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
