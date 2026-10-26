#!/usr/bin/env node
/* 歷史連續性掃描（2026-10-25，供 176 只補抓後復驗）
   口徑：以 data/index.json 的 HSI 序列為交易日曆；
   對每只基金「成立之後」的日期集合比對——
     ghost  = 序列中出現非交易日日期（周末/休市日；友邦早期/東亞官方即如此發布，屬官方口徑，不算錯）
     missing= 交易日缺失（exempt 名單見下）
   用法：node tools/check-continuity.js [--json out.json]
*/
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');

const idx = JSON.parse(fs.readFileSync(path.join(D, 'index.json'), 'utf8'));
const hsi = (idx.items.HSI.series || []).map((x) => x[0]);
/* 4-08 复盘：曾试过并入 HSCEI 并集，但 10-23 是指数当日值而基金 NAV 渠道 T+1/T+2 才发布，
   会制造大面积「缺日」误报 → 巡检日历必须用纯 HSI（与基金 NAV 发布节奏一致）。
   HSI 自身尾部缺日由 indexbuild 的重试补齐修数据，而不是改日历。 */
const cal = new Set(hsi);
const funds = JSON.parse(fs.readFileSync(path.join(D, 'funds.json'), 'utf8')).funds;

/* 官方口徑/渠道豁免（與 gap-check WAIVE_DAYS、報告 2-27 一致） */
const SCHEME_EXEMPT = [
  { re: /新地/, why: '月度 PDF' },
  { re: /渣打|新地/, why: '季頻批量發布（SHKP ESS Fund Price PDF，2026-10-26 1-11 口徑）' },
  { re: /AMTD/, why: 'etnet 渠道固有缺口' },
];
/* 官網序列固有缺失（全量重抓後仍缺，官網即如此）：2026-10-25 核定 */
const ISSUER_DATE_EXEMPT = {
  '宏利': ['2025-12-29'],   /* 宏利官網 PerformanceChart 全量序列無 12-29（39 只同） */
  '海通': ['2026-09-08'],   /* 海通官網 PerformanceChart 全量序列無 9-08（14 只同） */
};
const ID_EXEMPT = { '365': '宏利利息基金無日度' };

const results = [];
funds.forEach((f) => {
  const fp = path.join(D, 'hist', String(f.id) + '.json');
  if (!fs.existsSync(fp)) return;
  let o;
  try { o = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return; }
  const ser = o.series || [];
  if (ser.length < 2) return;
  const exempt = SCHEME_EXEMPT.find((e) => e.re.test(f.scheme || ''));
  if (ID_EXEMPT[String(f.id)]) return;
  const have = new Set(ser.map((x) => x[0]));
  let ghost = 0;
  const first = ser[0][0];
  const calFrom = hsi[0];   /* HSI 日歷起點（2005-01-07）——此前無日曆，不判 ghost */
  const ghostSample = [];
  ser.forEach((x) => {
    if (x[0] >= calFrom && !cal.has(x[0])) { ghost++; if (ghostSample.length < 3) ghostSample.push(x[0]); }
  });
  /* 交易日缺失分兩段（2026-10-25 口徑修正）：
     - recentMissing：近 200 個交易日（fetch-bct-hist 等策略應逐日覆蓋）→ 缺了算真問題
     - farMissing：更早年份 → 各發行人回填策略為「每周/每月低頻採樣」，缺口屬策略固有，
       記錄但不計入問題清單（歷史走勢圖低頻採樣展示，與官方網站表現圖口徑一致） */
  const last200 = hsi.slice(-201, -1);   /* 跳过最新交易日（T+1 宽限，与 gap-check 口径一致） */
  const issuerWaive = Object.entries(ISSUER_DATE_EXEMPT)
    .filter(([k]) => (f.navSource || '').includes(k) || (f.scheme || '').includes(k))
    .flatMap(([, days]) => days);
  const recentMissing = last200.filter((d) => d >= first && !have.has(d) && !issuerWaive.includes(d));
  const far = hsi.filter((d) => d >= (first > '2022-01-01' ? first : '2022-01-01') && !last200.includes(d));
  const farMissing = far.filter((d) => !have.has(d));
  results.push({
    id: String(f.id), name: f.fund, src: (o.src || '').slice(0, 40),
    points: ser.length, first, last: ser[ser.length - 1][0],
    ghost, ghostSample, missing: recentMissing.length, missingSample: recentMissing.slice(0, 5),
    farMissing: farMissing.length, farSample: farMissing.slice(0, 3),
    exempt: exempt ? exempt.why : null,
  });
});

const bad = results.filter((x) => !x.exempt && x.missing > 0);
const ghostFunds = results.filter((x) => x.ghost > 0);
const farTotal = results.reduce((a, x) => a + (x.farMissing || 0), 0);
console.log('=== 歷史連續性掃描（' + results.length + ' 只）===');
console.log('近 200 交易日缺失（真問題）：', bad.length, '只，共', bad.reduce((a, x) => a + x.missing, 0), '天');
bad.sort((a, b) => b.missing - a.missing).slice(0, 15).forEach((x) =>
  console.log('  #' + x.id, x.name.slice(0, 20), '缺', x.missing, '天', '样例:', (x.missingSample || []).join(',')));
console.log('遠端低頻採樣固有缺口（2022+ 非近 200 交易日）：', farTotal, '點 —— 回填策略（每周/每月採樣）固有，非錯誤');
console.log('官方口徑幽靈日（周末/休市日，官網即如此發布）：', ghostFunds.length, '只', ghostFunds.reduce((a, x) => a + x.ghost, 0), '點 —— 按主人決策以官網為準，不過濾');
const out = process.argv.indexOf('--json');
if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify({ ts: new Date().toISOString(), results }, null, 1));
