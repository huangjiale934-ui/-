#!/usr/bin/env node
/**
 * AMTD（尚乘 / oOo Group）季度基金便览抓取
 * ============================================================
 * 现状（2026-10-24 核实）：
 *   发行人把 16 只成分基金的「基金概覽 / Fund Facts」全部托管在 Google Drive，
 *   官网 mpf-3 页只给一个中转链接 https://files.ooogroup.xyz/mpf/fund-facts/<slug>
 *   → 302 → https://drive.google.com/file/d/<id>/view
 *   本机（中国内地网络）drive.google.com 与 drive.usercontent.google.com 均不可达，
 *   因此无法直接取到 PDF；本工具负责「探测 + 尽力下载 + 如实报告」。
 *
 * 用法：
 *   node tools/amtd-factsheet.js --probe     只探测（判断本环境能否到达 Google）
 *   node tools/amtd-factsheet.js --fetch     真正下载到 tmp/amtd/<slug>.pdf
 *   node tools/amtd-factsheet.js --list      只列出 16 个 slug 与 Drive 文件 ID
 *
 * 退出码：0 = 全部成功（或 probe 成功）；2 = 通道不可达；3 = 部分失败
 * 拿到 PDF 后由 tools/parse-amtd-ffs.py 解析 → 写回 data/holdings.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTDIR = path.join(ROOT, 'tmp', 'amtd');
const PAGE = 'https://www.ooogroup.xyz/locales/hk/mpf-3';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const argv = process.argv.slice(2);
const MODE = argv.includes('--fetch') ? 'fetch' : (argv.includes('--list') ? 'list' : 'probe');
/* 2026-10-29（5.0）：本机若有可用代理（如 Clash 127.0.0.1:7877），可显式指定
   --proxy=http://127.0.0.1:7877 ，下载改走 curl；未指定则沿用原来的直连 fetch。 */
const PROXY = (argv.find((a) => a.indexOf('--proxy=') === 0) || '').slice(8) || process.env.AMTD_PROXY || '';
const { execFileSync } = require('child_process');

function curlCode(url) {
  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
    const tmp = path.join(OUTDIR, '.probe');
    /* Windows 下 /dev/null 不是合法路径，统一写临时文件再读状态码 */
    const out = execFileSync('curl', ['-s', '-o', tmp, '-w', '%{http_code}', '--max-time', '20', '-x', PROXY, '-A', UA, url], { encoding: 'utf8' });
    return Number(out.trim()) || 0;
  } catch (e) { return 0; }
}
function curlDownload(url, outPath) {
  try {
    execFileSync('curl', ['-s', '-L', '--max-time', '90', '-x', PROXY, '-A', UA, '-o', outPath, url], { stdio: 'ignore' });
    const st = fs.statSync(outPath);
    if (st.size > 20000) {
      const fd = fs.openSync(outPath, 'r'); const b = Buffer.alloc(5); fs.readSync(fd, b, 0, 5, 0); fs.closeSync(fd);
      if (b.toString('latin1') === '%PDF-') return true;
    }
    return false;
  } catch (e) { return false; }
}

async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout ' + ms + 'ms ' + label)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}

/** 从 mpf-3 页面解析 {slug, name, href} */
async function readFundFacts() {
  const res = await withTimeout(fetch(PAGE, { headers: { 'User-Agent': UA } }), 25000, 'mpf-3');
  if (!res.ok) throw new Error('mpf-3 HTTP ' + res.status);
  const html = await res.text();
  const out = [];
  const tables = html.split('<table');
  for (const tb of tables) {
    const hrefM = tb.match(/href="(https:\/\/files\.ooogroup\.xyz\/mpf\/fund-facts\/([^"]+))"/);
    if (!hrefM) continue;
    const nameM = tb.match(/<th[^>]*>([^<]{2,80})<\/th>/);
    out.push({
      slug: hrefM[2],
      name: nameM ? nameM[1].trim().replace(/\s+/g, ' ') : hrefM[2],
      href: hrefM[1],
    });
  }
  return out;
}

/** 跟随第一跳，拿到最终落地 URL（通常是 Drive） */
async function resolveTarget(href) {
  try {
    const r = await withTimeout(fetch(href, { redirect: 'manual', headers: { 'User-Agent': UA } }), 15000, href);
    return { status: r.status, location: r.headers.get('location') || '' };
  } catch (e) {
    return { status: 0, location: '', error: String(e.message || e) };
  }
}

function driveId(u) {
  const m = String(u).match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || String(u).match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : '';
}

/** 试用几个已知的 Drive 直下端点，返回 Buffer 或 null */
async function tryDriveDownload(id) {
  const urls = [
    'https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t',
    'https://drive.google.com/uc?export=download&id=' + id,
  ];
  for (const u of urls) {
    try {
      const r = await withTimeout(fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' }), 45000, u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 20000 && buf.slice(0, 5).toString('latin1') === '%PDF-') return buf;
    } catch (e) { /* 端点不可达，继续试下一个 */ }
  }
  return null;
}

(async () => {
  const list = await readFundFacts();
  console.log('mpf-3 找到基金便览链接：' + list.length + ' 个');
  if (!list.length) { console.error('解析页面失败，请检查页面结构是否改版'); process.exit(3); }

  const rows = [];
  for (const f of list) {
    const t = await resolveTarget(f.href);
    const id = driveId(t.location);
    rows.push({ ...f, http: t.status, location: t.location, id });
  }

  if (MODE === 'list') {
    rows.forEach((r) => console.log([r.slug.padEnd(24), r.id || '(无 drive id)', r.name].join('  ')));
    return;
  }

  const googleReachable = PROXY
    ? curlCode('https://drive.google.com/generate_204') > 0
    : await (async () => {
      try {
        const r = await withTimeout(fetch('https://drive.google.com/generate_204', { redirect: 'manual', headers: { 'User-Agent': UA } }), 10000, 'g204');
        return r.status > 0;
      } catch (e) { return false; }
    })();

  if (MODE === 'probe') {
    console.log('Google Drive 可达：' + (googleReachable ? '是' : '否'));
    rows.forEach((r) => console.log([r.slug.padEnd(24), r.id || '-', r.http, r.name].join('  ')));
    if (!googleReachable) {
      console.log('\n结论：本环境无法访问 drive.google.com，无法下载 16 只 AMTD 季度便览。');
      console.log('请在有 Google 访问权的机器/网络执行 --fetch，或人工下载 PDF 放入 tmp/amtd/ 后运行解析器。');
      process.exit(2);
    }
    return;
  }

  // fetch 模式
  fs.mkdirSync(OUTDIR, { recursive: true });
  let ok = 0, fail = 0;
  for (const r of rows) {
    if (!r.id) { console.log('✗ ' + r.slug + ' 未解析到 Drive ID（HTTP ' + r.http + '）'); fail++; continue; }
    let buf = PROXY ? null : await tryDriveDownload(r.id);
    if (PROXY) {
      const p0 = path.join(OUTDIR, r.slug + '.pdf');
      const okDl = curlDownload('https://drive.google.com/uc?export=download&confirm=t&id=' + r.id, p0);
      if (okDl) { console.log('✓ ' + r.slug + ' → ' + p0 + ' (' + Math.round(fs.statSync(p0).size / 1024) + 'KB, via proxy)'); ok++; continue; }
    }
    if (!buf) { console.log('✗ ' + r.slug + ' 下载失败（Drive 不可达或需授权）'); fail++; continue; }
    const p = path.join(OUTDIR, r.slug + '.pdf');
    fs.writeFileSync(p, buf);
    console.log('✓ ' + r.slug + ' → ' + p + ' (' + Math.round(buf.length / 1024) + 'KB)');
    ok++;
  }
  console.log('\n完成：成功 ' + ok + '，失败 ' + fail);
  if (fail === 0) {
    console.log('下一步：python tools/parse-amtd-ffs.py');
  } else {
    console.log('未全部成功。AMTD 16 只保持 srcStatus=blocked 标注，勿改写为其他结论。');
  }
  process.exit(fail === 0 ? 0 : 3);
})().catch((e) => { console.error('ERROR', e.message || e); process.exit(3); });
