#!/usr/bin/env node
/**
 * AMTD 季度基金便览下载器（走 Chrome / CDP）
 * ============================================================
 * 背景（2026-10-24 实测）：
 *   本机 curl / node fetch 直连与公共 CORS 代理**都到不了 Google**（代理 CONNECT 返回 502、
 *   公共代理 520/522），但 **Chrome 可以正常打开 drive.google.com**（Chrome 自己的网络通道可达）。
 *   所以下载必须交给 Chrome 做，用 CDP 的 Browser.setDownloadBehavior 指定落盘目录。
 *
 * 用法：
 *   node tools/amtd-fetch-chrome.js            # 下载全部 16 只到 tmp/amtd/
 *   node tools/amtd-fetch-chrome.js --only conservative,global-bond
 *
 * 输出：tmp/amtd/<slug>.pdf（文件名统一改成 slug，避免 Drive 的中文/长文件名）
 * 退出码：0 全部成功；3 有失败（逐个列出）
 */
'use strict';
const { execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTDIR = path.join(ROOT, 'tmp', 'amtd');
const PROFILE = path.join(ROOT, 'tmp', 'chrome-dl-prof');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9224);
const PAGE = 'https://www.ooogroup.xyz/locales/hk/mpf-3';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let s = ''; r.on('data', (d) => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

/** 从官网页面拿 16 个 fund-facts 链接（含 slug / 中文名 / Drive ID） */
async function readFundFacts() {
  const res = await fetch(PAGE, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const out = [];
  for (const tb of html.split('<table')) {
    const h = tb.match(/href="(https:\/\/files\.ooogroup\.xyz\/mpf\/fund-facts\/([^"]+))"/);
    if (!h) continue;
    const nm = tb.match(/<th[^>]*>([^<]{2,80})<\/th>/);
    out.push({ slug: h[2], name: nm ? nm[1].trim().replace(/\s+/g, ' ') : h[2], href: h[1] });
  }
  return out;
}

/** 跟随 302 拿 Drive 文件 ID */
async function driveIdOf(href) {
  const r = await fetch(href, { redirect: 'manual', headers: { 'User-Agent': UA } });
  const loc = r.headers.get('location') || '';
  const m = loc.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : '';
}

(async () => {
  const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null;

  fs.mkdirSync(OUTDIR, { recursive: true });
  const list = (await readFundFacts()).filter((f) => !only || only.has(f.slug));
  console.log('待下载：' + list.length + ' 只');
  for (const f of list) f.id = await driveIdOf(f.href);

  const child = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1280,900', 'about:blank',
  ], () => {});
  let ver = null;
  for (let i = 0; i < 40; i++) { await sleep(500); try { ver = await getJSON('/json/version'); break; } catch (e) {} }
  if (!ver) { console.error('Chrome 未启动'); child.kill(); process.exit(3); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  const pending = new Map(); let seq = 0;
  const send = (method, params, sessionId) => new Promise((res) => {
    const i = ++seq; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });

  /* 页面级会话 */
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const targetId = t.result.targetId;
  const at = await send('Target.attachToTarget', { targetId, flatten: true });
  const sid = at.result.sessionId;

  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUTDIR, eventsEnabled: true });
  await send('Page.enable', {}, sid);

  let ok = 0; const failed = [];

  for (const f of list) {
    if (!f.id) { console.log('✗ ' + f.slug + ' 无 Drive ID'); failed.push(f.slug); continue; }
    const url = 'https://drive.google.com/uc?export=download&id=' + f.id;
    /* 每只单独一个下载目录：否则上一只的下载稍晚落地，会被误当成这一只（曾整批错位一只） */
    const box = path.join(OUTDIR, '_dl', f.slug);
    fs.rmSync(box, { recursive: true, force: true });
    fs.mkdirSync(box, { recursive: true });
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: box, eventsEnabled: true });
    process.stdout.write('→ ' + f.slug + ' … ');
    await send('Page.navigate', { url }, sid);

    let got = null;
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      const cand = fs.readdirSync(box)
        .filter((n) => !n.endsWith('.crdownload'))
        .map((n) => path.join(box, n))
        .filter((p) => { try { return fs.statSync(p).size > 5000; } catch (e) { return false; } });
      if (cand.length) {
        const sz1 = fs.statSync(cand[0]).size;
        await sleep(800);
        const sz2 = fs.statSync(cand[0]).size;
        if (sz1 === sz2) { got = cand[0]; break; }
      }
    }
    if (!got) { console.log('失败（超时）'); failed.push(f.slug); continue; }

    const buf = fs.readFileSync(got);
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') {
      console.log('失败（不是 PDF，' + buf.length + 'B）'); failed.push(f.slug); continue;
    }
    const dst = path.join(OUTDIR, f.slug + '.pdf');
    fs.writeFileSync(dst, buf);
    fs.rmSync(box, { recursive: true, force: true });
    console.log('✓ ' + Math.round(buf.length / 1024) + 'KB  ' + f.name);
    ok++;
  }
  try { fs.rmSync(path.join(OUTDIR, '_dl'), { recursive: true, force: true }); } catch (e) {}

  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  console.log('\n完成：成功 ' + ok + '，失败 ' + failed.length + (failed.length ? '（' + failed.join(', ') + '）' : ''));
  process.exit(failed.length ? 3 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(3); });
