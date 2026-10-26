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

/* 2026-10-26 新增：腾讯港股日线（备用源）。
   背景：东财 push2his 对 100.HSI 会整体返回空（本机 IP 限流），导致恒指长期停在 10-22，
   而 HSCEI/HSTECH 偶发能通 → 三只港股指数尾部不一致，进而污染「交易日历」巡检窗口。
   腾讯接口不受此限，返回 [日期, 开, 收, 高, 低, …]，收盘价取下标 2，单次最多 2000 点。 */
function fetchTxTail(code, n) {
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=' + code + ',day,,,' + n + ',qfq';
  return get(url).then((raw) => {
    const j = JSON.parse(raw);
    const d = j && j.data && j.data[code];
    const arr = (d && (d.day || d.qfqday)) || [];
    const out = [];
    arr.forEach((x) => {
      const dt = x[0], c = parseFloat(x[2]);
      if (dt && isFinite(c) && c > 0) out.push([dt, c]);
    });
    return out;
  });
}

(async () => {
  const items = {};
  for (const it of INDICES) {
    try {
      let r = await fetchIndex(it);
      /* 2026-10-26 修 4-08：空数据/首尾异常时重试一次（东财接口偶发尾部缺当日） */
      if (!r.series.length) r = await fetchIndex(it);
      /* 2026-10-26：东财限流（socket hang up）是随机的——失败后隔 2.5s 再试一次，命中率显著提高 */
      if (!r.series.length) { await new Promise((x) => setTimeout(x, 2500)); try { r = await fetchIndex(it); } catch (e2) {} }
      if (!r.series.length) { console.log('  [!] ' + it.key + ' 空数据，跳过'); continue; }
      items[it.key] = {
        code: it.code, name: it.name, nameEn: it.nameEn,
        first: r.series[0][0], asOf: r.series[r.series.length - 1][0],
        points: r.series.length, series: r.series,
      };
      console.log('  ✔ ' + it.key.padEnd(7) + it.name.padEnd(10) + ' ' +
        r.series[0][0] + ' → ' + r.series[r.series.length - 1][0] + '  (' + r.series.length + ' 点)');
    } catch (e) {
      /* 限流重试：等 2.5s 再抓一次（2026-10-26 实测东财限流是按请求随机） */
      await new Promise((x) => setTimeout(x, 2500));
      try {
        const r2 = await fetchIndex(it);
        if (r2.series.length) {
          items[it.key] = {
            code: it.code, name: it.name, nameEn: it.nameEn,
            first: r2.series[0][0], asOf: r2.series[r2.series.length - 1][0],
            points: r2.series.length, series: r2.series,
          };
          console.log('  ✔ ' + it.key + '（重试成功）' + r2.series[r2.series.length - 1][0] + '  (' + r2.series.length + ' 点)');
        } else console.log('  [!] ' + it.key + ' 失败: ' + e.message);
      } catch (e2) {
        console.log('  [!] ' + it.key + ' 失败: ' + e.message);
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  /* 2026-10-26 修（恒指停在 10-22 的根因）：东财对港股三指数经常整体返回空/尾点缺失，
     用腾讯港股日线补尾——① 缺的日期追加 ② 与末点同日则以腾讯收盘价覆盖（东财尾点可能是收盘前快照）。 */
  for (const [k, txCode] of Object.entries({ HSI: 'hkHSI', HSCEI: 'hkHSCEI', HSTECH: 'hkHSTECH' })) {
    try {
      const tail = await fetchTxTail(txCode, 60);
      if (!tail.length) { console.log('  [!] ' + k + ' 腾讯补点为空'); continue; }
      const def = INDICES.find((x) => x.key === k);
      if (!items[k]) {
        items[k] = {
          code: def.code, name: def.name, nameEn: def.nameEn,
          first: tail[0][0], asOf: tail[tail.length - 1][0], points: tail.length, series: tail,
        };
        console.log('  ✔ ' + k + ' 腾讯建序列 ' + tail[0][0] + ' → ' + tail[tail.length - 1][0]);
        continue;
      }
      const s = items[k].series;
      const lastD = s.length ? s[s.length - 1][0] : '';
      const map = new Map(s.map(([d, v]) => [d, v]));
      let add = 0, fix = 0;
      tail.forEach(([d, v]) => {
        if (!map.has(d)) { map.set(d, v); add++; }
        else if (d >= lastD) { if (map.get(d) !== v) fix++; map.set(d, v); }
      });
      const merged = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      items[k].series = merged;
      items[k].points = merged.length;
      items[k].asOf = merged[merged.length - 1][0];
      if (add || fix) console.log('  ✔ ' + k + ' 腾讯补点：新增 ' + add + ' 日 / 校正 ' + fix + ' 日 → ' + items[k].asOf);
    } catch (e) { console.log('  [!] ' + k + ' 腾讯补点失败: ' + e.message); }
    await new Promise((r) => setTimeout(r, 300));
  }
  /* 2026-10-19：抓取失败的指数不能丢——先并入磁盘上已有的序列
     2026-10-26 修正：不能只在「本次完全没抓到」时并入。东财整体挂掉时，腾讯补点会先生成一个
     仅 60 点的短序列，旧逻辑只保留这 60 点 → 20 年历史被截断。改为「按序列合并」：
     旧序列全部保留，新序列覆盖同一天的值，再按日期排序。 */
  try {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    Object.keys(old.items || {}).forEach((k) => {
      const o = old.items[k];
      if (!items[k]) { items[k] = o; return; }
      const cur = items[k];
      if (!o.series || !o.series.length) return;
      if (cur.series.length >= o.series.length) return;   /* 新序列更全，无需合并 */
      const map = new Map(o.series.map(([d, v]) => [d, v]));
      cur.series.forEach(([d, v]) => map.set(d, v));
      const merged = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      cur.series = merged;
      cur.points = merged.length;
      cur.first = merged[0][0];
      cur.asOf = merged[merged.length - 1][0];
      console.log('  · ' + k + ' 历史合并：' + o.series.length + ' + 补点 → ' + merged.length + ' 点（至 ' + cur.asOf + '）');
    });
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
