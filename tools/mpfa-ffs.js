/**
 * 积金局托管的「基金便覽」PDF（回退源）
 *
 * 背景（2026-11-26）：积金局注册计划详情页对每个计划都挂了一份「基金便覽」，
 * 地址形如 https://www.mpfa.org.hk/assets/FF/MTxxxxx.pdf。
 * 它是受托人自己发出的季度便览，内容与受托人官网一致（当前 2026Q2，中銀保誠为 Q1），
 * 因此在受托人官网改版 / 下载被拦时，可作为季度持仓的回退下载源。
 *
 * 用法：
 *   node tools/mpfa-ffs.js --fetch                 刷新映射（24 个计划，约 30 秒）
 *   node tools/mpfa-ffs.js --get "<计划名>" <输出>  下载该计划的便覽 PDF
 *   node tools/mpfa-ffs.js --list                  打印当前映射
 *
 * 退出码：0 成功；2 找不到计划；3 下载失败；4 非 PDF
 */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const LIST = 'https://mfp.mpfa.org.hk/tch/mpp_list.jsp';
const OUT = path.join(__dirname, '..', 'data', 'mpfa-ffs.json');
const MAX_AGE = 7 * 864e5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
}

function strip(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function refresh() {
  const { buf } = await get(LIST);
  const html = buf.toString('utf8');
  const rows = html.split('<tr');
  const list = [];
  for (const seg of rows) {
    if (seg.indexOf('sortlist_checkbox') < 0) continue;
    const cells = [...seg.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    const link = (seg.match(/href="([^"]*fudetail[^"]*)"/) || [])[1];
    if (!link || cells.length < 5) continue;
    const name = cells[1];
    if (!name || list.some((x) => x.scheme === name)) continue;
    list.push({ scheme: name, detail: link });
  }
  if (!list.length) throw new Error('列表页未解析到计划（源站可能改版）');

  const schemes = {};
  for (const it of list) {
    try {
      const { buf: db } = await get(it.detail);
      const d = db.toString('utf8');
      const i = d.indexOf('基金便覽');
      let url = '';
      if (i >= 0) {
        const m = d.slice(i, i + 800).match(/href=['"]([^'"]*\/assets\/FF\/[^'"]+)['"]/i);
        if (m) url = m[1];
      }
      if (!url) {
        const m = d.match(/\/assets\/FF\/MT\d+\.pdf/i);
        if (m) url = m[0];
      }
      if (!url) { console.log('  · 无便覽：' + it.scheme); continue; }
      schemes[it.scheme] = {
        url: url.startsWith('http') ? url : new URL(url, 'https://www.mpfa.org.hk/').href,
        code: (url.match(/([A-Z]{2}\d+)\.pdf/i) || [])[1] || '',
      };
      console.log('  ✔ ' + it.scheme + ' → ' + schemes[it.scheme].code);
    } catch (e) {
      console.log('  ✘ ' + it.scheme + '：' + e.message);
    }
    await sleep(400);
  }
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), source: LIST, schemes }, null, 1));
  console.log('已写入 ' + OUT + '（' + Object.keys(schemes).length + ' 个计划）');
  return schemes;
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (j && j.schemes) return j;
  } catch (e) { /* 尚未生成 */ }
  return null;
}

async function ensure(force) {
  const j = load();
  if (!force && j && Date.now() - new Date(j.updatedAt).getTime() < MAX_AGE) return j;
  return { updatedAt: new Date().toISOString(), schemes: await refresh() };
}

(async () => {
  const args = process.argv.slice(2);
  const cmd = args[0] || '--list';

  if (cmd === '--fetch') { await ensure(true); process.exit(0); }

  if (cmd === '--list') {
    const j = await ensure(false);
    Object.keys(j.schemes).forEach((k) => console.log(j.schemes[k].code.padEnd(9), k));
    process.exit(0);
  }

  if (cmd === '--get') {
    const scheme = args[1];
    const out = args[2] || 'tmp/mpfa_ffs.pdf';
    if (!scheme) { console.error('用法：--get "<计划名>" <输出路径>'); process.exit(2); }
    let j = await ensure(false);
    if (!j.schemes[scheme]) j = await ensure(true);
    const hit = j.schemes[scheme];
    if (!hit) {
      console.error('积金局未收录该计划的便覽：' + scheme);
      Object.keys(j.schemes).forEach((k) => console.error('  - ' + k));
      process.exit(2);
    }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    const { status, buf } = await get(hit.url);
    if (status !== 200 || buf.length < 20000) { console.error('下载失败 HTTP ' + status + ' size=' + buf.length); process.exit(3); }
    if (buf.slice(0, 4).toString() !== '%PDF') { console.error('返回内容不是 PDF'); process.exit(4); }
    fs.writeFileSync(out, buf);
    console.log('已下载 ' + hit.code + ' → ' + out + '（' + Math.round(buf.length / 1024) + ' KB）');
    process.exit(0);
  }

  console.error('未知参数：' + cmd);
  process.exit(2);
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });
