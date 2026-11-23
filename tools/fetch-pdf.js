#!/usr/bin/env node
/* 官方 PDF 下载器（2026-11-23）
 * ============================================================
 * 背景：季度链路里有几个解析器只认本地 PDF，没人下载 → 云端永远「缺输入 PDF」。
 *       这里把「找到官方文件并落盘」这一步固化，失败就明确报错（不伪造空文件）。
 *
 * 用法：
 *   node tools/fetch-pdf.js <url> <out>        # 直链下载（校验 %PDF 文件头）
 *   node tools/fetch-pdf.js --ht <out>         # 海通「基金概覽」：从官网列表页自动发现（7 只共用一份）
 *   node tools/fetch-pdf.js --bocpt <out>      # 中銀保誠「我的強積金」基金便覽：按季度文件名探测
 *
 * 退出码：0 成功；2 未找到/不是 PDF；3 网络错误
 * 说明：gthtam / bocpt 用 curl 会被 TLS 指纹拦（000），必须走 Node 的 fetch。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchBuf(url, opt) {
  const r = await fetch(url, Object.assign({ headers: { 'user-agent': UA } }, opt || {}));
  const b = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf: b, type: r.headers.get('content-type') || '' };
}

function isPdf(buf) {
  return buf && buf.length > 20000 && buf.slice(0, 5).toString('latin1') === '%PDF-';
}

async function save(url, out) {
  const dir = path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  const { status, buf } = await fetchBuf(url);
  if (status !== 200) { console.error('HTTP ' + status + '：' + url); return 2; }
  if (!isPdf(buf)) { console.error('不是 PDF（' + buf.length + 'B，' + (buf.slice(0, 15).toString('latin1').replace(/\s+/g, ' ')) + '）：' + url); return 2; }
  fs.writeFileSync(out, buf);
  console.log('✔ ' + Math.round(buf.length / 1024) + 'KB → ' + out + '\n  ' + decodeURIComponent(url));
  return 0;
}

/* 海通：列表页 → 任取一只基金的「基金概覽」PDF（官方 7 个链接内容相同） */
async function ht(out) {
  const PAGE = 'https://gthtam.com.hk/mpf/zh-cht';
  const r = await fetch(PAGE, { headers: { 'user-agent': UA, cookie: 'mpf_disclaimer_popup=yes' } });
  const html = await r.text();
  const links = [...html.matchAll(/href="([^"]*基金概覽\.pdf[^"]*)"/g)].map((m) => m[1]);
  if (!links.length) { console.error('官网列表页未找到「基金概覽」PDF 链接（' + r.status + '）'); return 2; }
  /* 固定取韓國基金那份（历史默认文件名），找不到就取第一条 */
  const pick = links.find((u) => /Haitong_Korea_Fund/i.test(decodeURIComponent(u))) || links[0];
  const abs = new URL(encodeURI(pick), PAGE).href;
  return save(abs, out);
}

/* 中銀保誠：官方便覽按季度命名（my-choice-fund-factsheet-{q}q{yy}.pdf），
   从当前季度往前探测 3 期，第一个真是 PDF 的就是最新已发布版本。 */
async function bocpt(out) {
  const now = new Date(Date.now() + 8 * 3600e3);
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3) + 1;
  const cands = [];
  for (let i = 0; i < 4; i++) {
    cands.push('https://www.bocpt.com/media/2718/my-choice-fund-factsheet-' + q + 'q' + String(y).slice(2) + '.pdf');
    q -= 1; if (q < 1) { q = 4; y -= 1; }
  }
  for (const u of cands) {
    const { status, buf } = await fetchBuf(u);
    if (status === 200 && isPdf(buf)) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      console.log('✔ ' + Math.round(buf.length / 1024) + 'KB → ' + out + '\n  ' + u);
      return 0;
    }
  }
  console.error('四个季度候选都不是 PDF（源站可能改版）：' + cands[0]);
  return 2;
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('用法见文件头'); process.exit(2); }
  try {
    let rc;
    if (args[0] === '--ht') rc = await ht(args[1] || 'tmp/ht_pdf3/Haitong_Korea_Fund.pdf');
    else if (args[0] === '--bocpt') rc = await bocpt(args[1] || 'tmp/bocpt_fs.pdf');
    else if (args.length >= 2) rc = await save(args[0], args[1]);
    else { console.error('缺少输出路径'); rc = 2; }
    process.exit(rc);
  } catch (e) {
    console.error('网络错误：' + e.message);
    process.exit(3);
  }
})();
