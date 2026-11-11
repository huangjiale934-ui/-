#!/usr/bin/env node
/**
 * ms-scan.js —— 全量扫描晨星基金库，捞出香港强积金基金（SecId + Name + ISIN）
 *
 * 背景（2026-11-11）：要拿「基金 → 雅虎(晨星 0P…)」映射，但晨星香港站已改版、
 * 搜索接口 302 到 global、Yahoo 名称搜索返回空。唯一还能用的公开接口是
 * lt.morningstar.com 的 screener（token klr5zyak8x），它不支持过滤器，
 * 只能按 universe=FOALL$$ALL（35.3 万只）分页扫，再在本地筛出 MPF。
 *
 * 用法：node tools/ms-scan.js [--pages 400] [--concurrency 4]
 * 输出：tmp/ms-mpf.json  [{secId,name,isin}]
 *       tmp/ms-scan-progress.json（断点，可中断续跑）
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tmp', 'ms-mpf.json');
const FROM = Number((process.argv.find((a) => a.startsWith('--from')) || '').split('=')[1]) || 1;
const TO = Number((process.argv.find((a) => a.startsWith('--to')) || '').split('=')[1]) || 999;
const TAG = (process.argv.find((a) => a.startsWith('--tag')) || '').split('=')[1] || 'main';
const PROG = path.join(ROOT, 'tmp', 'ms-scan-progress-' + TAG + '.json');
const OUT_TAG = path.join(ROOT, 'tmp', 'ms-mpf-' + TAG + '.json');
const PROXY = process.env.MPF_PROXY || 'http://127.0.0.1:7877';
const DIRECT_ONLY = process.argv.includes('--direct');
const PAGE_SIZE = 20000;   /* 实测 20000 行/页（59s/页），18 页扫完 35 万只；1000 行要 353 页太慢 */
const MAX_PAGES = Number((process.argv.find((a) => a.startsWith('--pages')) || '').split('=')[1]) || 20;
const CONC = Number((process.argv.find((a) => a.startsWith('--concurrency')) || '').split('=')[1]) || 2;

const BASE = 'https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener'
  + '?outputType=json&version=1&languageId=zh-HK&currencyId=HKD&universeIds=FOALL%24%24ALL'
  + '&securityDataPoints=SecId%2CName%2CIsin%2CPerformanceId&pageSize=' + PAGE_SIZE + '&page=';

function get(url) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '--max-time', '120', '-A', 'Mozilla/5.0'];
    const run = (extra, cb) => execFile('curl', [...args, ...extra, url], { maxBuffer: 256 * 1024 * 1024, timeout: 130000 }, cb);
    run([], (err, stdout) => {
      if (!err && stdout && stdout.trim().startsWith('{')) return resolve(JSON.parse(stdout));
      if (DIRECT_ONLY) return reject(err || new Error('direct failed'));
      run(['-x', PROXY], (err2, out2) => {
        if (err2) return reject(err2);
        try { resolve(JSON.parse(out2)); } catch (e) { reject(e); }
      });
    });
  });
}

function isMPF(name, isin) {
  const n = String(name || '');
  if (/MPF|強積金|强积金|積金|积金/i.test(n)) return true;
  /* 香港注册的基金里也有非 MPF，但先留著，后面用净值比对再筛一次 */
  return false;
}

(async () => {
  let prog = { done: [], total: 0, hits: [] };
  try { prog = JSON.parse(fs.readFileSync(PROG, 'utf8')); } catch (e) {}
  const done = new Set(prog.done);
  const hits = new Map((prog.hits || []).map((x) => [x.secId, x]));
  let total = prog.total || 0;

  const first = await get(BASE + 1);
  total = first.total || total;
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
  console.log('总行数 ' + total + '，页数 ' + pages + '，已完成 ' + done.size);

  const queue = [];
  for (let p = FROM; p <= Math.min(pages, TO); p++) if (!done.has(p)) queue.push(p);

  let idx = 0;
  let processed = 0;
  async function worker() {
    while (idx < queue.length) {
      const p = queue[idx++];
      let j = null;
      for (let attempt = 0; attempt < 3 && !j; attempt++) {
        try { j = await get(BASE + p); } catch (e) { await new Promise((r) => setTimeout(r, 800)); }
      }
      if (!j) { console.log('!! 第 ' + p + ' 页失败'); continue; }
      (j.rows || []).forEach((r) => {
        if (r.SecId && isMPF(r.Name, r.Isin)) hits.set(r.SecId, { secId: r.SecId, name: r.Name, isin: r.Isin || '', perfId: r.PerformanceId || '' });
      });
      done.add(p);
      processed++;
      if (true) {   /* 每页都落盘：代理慢，随时可能被打断 */
        fs.writeFileSync(PROG, JSON.stringify({ done: [...done], total, hits: [...hits.values()] }));
        console.log('进度 ' + processed + '/' + queue.length + '，命中 ' + hits.size);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  fs.writeFileSync(OUT_TAG, JSON.stringify([...hits.values()], null, 0));
  if (TAG === 'main') fs.writeFileSync(OUT, JSON.stringify([...hits.values()], null, 0));
  fs.writeFileSync(PROG, JSON.stringify({ done: [...done], total, hits: [...hits.values()] }));
  console.log('完成：扫 ' + done.size + ' 页，命中 ' + hits.size + ' 只 → ' + OUT);
})();
