/**
 * 恒生指数 / 上证指数 全历史补齐（2026-11-02，第十八轮）
 * ---------------------------------------------------------------
 * 背景：东财 push2his 本机整体不可用（返回空），indexbuild.js 只能拿到 2005 年起；
 *       用户要求「发行至今」。改用腾讯日线接口分段拉取：
 *         · 上证指数 sh000001：1990-12-19 起
 *         · 恒生指数 hkHSI  ：1991-12-19 起（腾讯港股行情最早）
 *       每段最多 2000 点，按 6 年窗口循环，合并后写回 data/index.json。
 * 用法：node tools/hist-index-full.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data', 'index.json');
const THIN_BEFORE = '2022-01-01';   // 与 indexbuild.js 一致：2022 年前降采样为周度

const TARGETS = [
  { key: 'HSI', kind: 'hk', code: 'hkHSI', name: '恒生指数', nameEn: 'Hang Seng Index', from: 1990 },
  { key: 'SSE', kind: 'cn', code: 'sh000001', name: '上证指数', nameEn: 'SSE Composite Index', from: 1990 },
];

function get(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' }, timeout: timeout || 25000 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function thin(series) {
  const out = [];
  let wk = '';
  series.forEach(([d, v]) => {
    if (d >= THIN_BEFORE) { out.push([d, v]); return; }
    const t = new Date(d + 'T00:00:00Z');
    const k = t.getUTCFullYear() + '-' + Math.floor((t.getTime() / 864e5 + 4) / 7);
    if (k !== wk) { wk = k; out.push([d, v]); } else { out[out.length - 1] = [d, v]; }
  });
  return out;
}

async function fetchWindow(t, start, end) {
  const q = t.kind === 'hk'
    ? 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=' + t.code + ',day,' + start + ',' + end + ',2000,qfq'
    : 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=' + t.code + ',day,' + start + ',' + end + ',2000';
  const raw = await get(q);
  let j;
  try { j = JSON.parse(raw); } catch (e) { return []; }
  const d = j && j.data && j.data[t.code];
  const arr = (d && (d.day || d.qfqday)) || [];
  const out = [];
  arr.forEach((x) => {
    const dt = x[0], c = parseFloat(x[2]);
    if (dt && isFinite(c) && c > 0) out.push([dt, c]);
  });
  return out;
}

async function fetchAll(t) {
  const map = new Map();
  const endY = new Date().getFullYear();
  for (let y = t.from; y <= endY; y += 6) {
    const s = y + '-01-01';
    const e = Math.min(y + 6, endY + 1) + '-12-31';
    let got = [];
    for (let attempt = 0; attempt < 3 && !got.length; attempt++) {
      try { got = await fetchWindow(t, s, e); } catch (err) { got = []; }
      if (!got.length) await new Promise((r) => setTimeout(r, 800));
    }
    got.forEach(([d, v]) => map.set(d, v));
    console.log('  ' + t.key + ' ' + s + '→' + e + '  ' + got.length + ' 点' + (got.length ? '' : '（空）'));
    await new Promise((r) => setTimeout(r, 350));
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

(async () => {
  const dry = process.argv.indexOf('--dry') >= 0;
  const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  for (const t of TARGETS) {
    console.log('▶ ' + t.key + ' (' + t.name + ')');
    const full = await fetchAll(t);
    if (full.length < 100) { console.log('  [!] ' + t.key + ' 抓取失败，保留原数据'); continue; }
    const old = (j.items[t.key] && j.items[t.key].series) || [];
    const map = new Map(old.map(([d, v]) => [d, v]));
    let add = 0;
    full.forEach(([d, v]) => { if (!map.has(d)) add++; map.set(d, v); });
    const merged = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const series = thin(merged);
    j.items[t.key] = Object.assign({}, j.items[t.key], {
      code: t.key === 'HSI' ? '100.HSI' : '1.000001',
      name: t.name, nameEn: t.nameEn,
      first: series[0][0], asOf: series[series.length - 1][0],
      points: series.length, series,
      source: '腾讯行情日线（web.ifzq.gtimg.cn）· 全历史',
    });
    console.log('  ✔ ' + t.key + ' 原始 ' + full.length + ' 点（新增 ' + add + '）→ 落盘 ' + series.length + ' 点：' + series[0][0] + ' → ' + series[series.length - 1][0]);
  }
  j.updatedAt = Date.now();
  if (dry) { console.log('（--dry 不写入）'); return; }
  const bak = OUT.replace(/\.json$/, '.bak-' + Date.now() + '.json');
  fs.copyFileSync(OUT, bak);
  fs.writeFileSync(OUT, JSON.stringify(j));
  console.log('已写入 ' + OUT + '（' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB），备份：' + path.basename(bak));
})();
