/**
 * 指数序列构建 —— 广州精研数据有限公司 · 香港强积金数据平台
 * =========================================================
 * 数据源：东方财富行情接口（push2his），全量日线（2020 年起，含 5 年+）
 * 输出：data/index.json
 *   { updatedAt, source, items: { "<key>": { code, name, nameEn, series: [[date, close], ...] } } }
 * 用法：node indexbuild.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, 'data', 'index.json');

/* 与领导截图中「基金×指数对比」对应的常用基准（secid 为东财市场代码） */
const INDICES = [
  { key: 'HSI',    code: '100.HSI',    name: '恒生指数',       nameEn: 'Hang Seng Index' },
  { key: 'HSCEI',  code: '100.HSCEI',  name: '恒生中国企业指数', nameEn: 'Hang Seng China Enterprises Index' },
  { key: 'HSTECH', code: '124.HSTECH', name: '恒生科技指数',   nameEn: 'Hang Seng TECH Index' },
  { key: 'SPX',    code: '100.SPX',    name: '标普 500',       nameEn: 'S&P 500' },
  { key: 'NDX',    code: '100.NDX',    name: '纳斯达克 100',   nameEn: 'Nasdaq 100' },
  { key: 'DJIA',   code: '100.DJIA',   name: '道琼斯工业平均', nameEn: 'Dow Jones Industrial Average' },
  { key: 'N225',   code: '100.N225',   name: '日经 225',       nameEn: 'Nikkei 225' },
  { key: 'CSI300', code: '1.000300',   name: '沪深 300',       nameEn: 'CSI 300' },
  /* 2026-10-13 扩容：A 股主要指数 */
  { key: 'SSE',    code: '1.000001',   name: '上证指数',       nameEn: 'SSE Composite Index' },
  { key: 'SZSE',   code: '0.399001',   name: '深证成指',       nameEn: 'SZSE Component Index' },
  { key: 'CHINEXT', code: '0.399006',  name: '创业板指',       nameEn: 'ChiNext Index' },
  { key: 'CSI500', code: '1.000905',   name: '中证 500',       nameEn: 'CSI 500' },
  { key: 'SSE50',  code: '1.000016',   name: '上证 50',        nameEn: 'SSE 50' },
  { key: 'STAR50', code: '1.000688',   name: '科创 50',        nameEn: 'STAR 50' },
];

/* 2026-10-22：指数区间由 2020 起扩到 2005 起（约 20 年），满足「尽量长」的要求。
   2022 年前降采样为周度，避免 index.json 体积翻倍。 */
const BEG = '20050101';
const THIN_BEFORE = '2022-01-01';
function thinSeries(series) {
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

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function fetchIndex(it) {
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + it.code +
    '&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=0&beg=' + BEG + '&end=20500101';
  const raw = await get(url);
  const j = JSON.parse(raw);
  const kl = (j && j.data && j.data.klines) || [];
  const series = [];
  for (const line of kl) {
    const parts = String(line).split(',');
    const d = parts[0];
    const c = parseFloat(parts[1]);
    if (d && isFinite(c) && c > 0) series.push([d, c]);
  }
  return { ...it, series: thinSeries(series) };
}

(async () => {
  const items = {};
  for (const it of INDICES) {
    try {
      const r = await fetchIndex(it);
      if (!r.series.length) { console.log('  [!] ' + it.key + ' 空数据，跳过'); continue; }
      items[it.key] = {
        code: it.code, name: it.name, nameEn: it.nameEn,
        first: r.series[0][0], asOf: r.series[r.series.length - 1][0],
        points: r.series.length, series: r.series,
      };
      console.log('  ✔ ' + it.key.padEnd(7) + it.name.padEnd(10) + ' ' +
        r.series[0][0] + ' → ' + r.series[r.series.length - 1][0] + '  (' + r.series.length + ' 点)');
    } catch (e) {
      console.log('  [!] ' + it.key + ' 失败: ' + e.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  /* 2026-10-19：抓取失败的指数不能丢——先并入磁盘上已有的序列 */
  try {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    Object.keys(old.items || {}).forEach((k) => { if (!items[k]) items[k] = old.items[k]; });
  } catch (e) { /* 首次运行无旧文件 */ }
  const obj = {
    updatedAt: Date.now(),
    source: '东方财富行情（push2his.eastmoney.com）',
    count: Object.keys(items).length,
    items,
  };
  fs.writeFileSync(OUT, JSON.stringify(obj));
  console.log('已写入 ' + OUT + '（' + obj.count + ' 个指数，' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB）');
})();
