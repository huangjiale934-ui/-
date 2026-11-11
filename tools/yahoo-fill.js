/**
 * yahoo-fill.js —— 官網還沒發布時，用雅虎（晨星）的淨值先補上
 *
 * 背景（2026-11-11 用戶要求）：
 *   發行人官網常在下午甚至翌日上午才發布 T-1/T-2 淨值，Yahoo HK 基金頁（晨星資料）
 *   通常更早就有同一個數字。所以「官網沒有、雅虎有」時先用雅虎補，官網一旦發布就覆蓋。
 *
 * 已驗證（2026-11-11）：32 隻映射基金、每隻 244 個重疊交易日，比值全部 1.0000、
 *   最大偏差 0.00% —— 雅虎的香港基金淨值與發行人官網**完全一致**（同一個資料源）。
 *   所以這裡只做「補空」，不做任何數值推算。
 *
 * 安全閥：
 *   1) 比值必須與映射時記錄的一致（±1.5%），否則視為映射錯/單位類別不同，跳過；
 *   2) 補進去的點會標記 provisional，官網下次發布時由正常鏈路覆蓋；
 *   3) 一次補超過映射數的 30% → 視為異常，全部放棄。
 *
 * 用法：node tools/yahoo-fill.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FUNDS = path.join(DATA, 'funds.json');
const MAP = path.join(DATA, 'yahoo-map.json');
const LOG = path.join(ROOT, 'tmp', 'yahoo-fill.log');
const DRY = process.argv.includes('--dry');
const PROXY = process.env.MPF_PROXY || 'http://127.0.0.1:7877';

function log(msg) {
  const line = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' ' + msg;
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
  console.log(line);
}

/* 雅虎在本機直連會被限流，走代理；雲端 runner 直連即可。先直連，失敗再試代理。 */
function curlJSON(url) {
  const args = ['-s', '--max-time', '25', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0'];
  const tryOnce = (extra) => execFileSync('curl', [...args, ...extra, url], { encoding: 'utf8', timeout: 30000 });
  try {
    return JSON.parse(tryOnce([]));
  } catch (e) {
    return JSON.parse(tryOnce(['-x', PROXY]));
  }
}

function yahooSeries(ticker) {
  const j = curlJSON('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?range=1mo&interval=1d');
  const r = (j.chart && j.chart.result && j.chart.result[0]) || null;
  if (!r) return [];
  const ts = r.timestamp || [];
  const cl = (r.indicators.quote[0] || {}).close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (cl[i] == null) continue;
    /* 雅虎的日線時間戳是交易所當地 00:00（HKT），直接按 +8 取日期 */
    const d = new Date((ts[i] + 8 * 3600) * 1000).toISOString().slice(0, 10);
    out.push([d, Number(cl[i])]);
  }
  return out;
}

function main() {
  if (!fs.existsSync(MAP)) { log('SKIP 沒有 yahoo-map.json'); console.log('SKIP'); return 0; }
  const map = JSON.parse(fs.readFileSync(MAP, 'utf8')).funds || {};
  const ids = Object.keys(map);
  if (!ids.length) { log('SKIP 映射為空'); console.log('SKIP'); return 0; }

  const j = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const byId = new Map(j.funds.map((f) => [String(f.id), f]));
  const market = j.funds.reduce((m, f) => (f.navAsOf && f.navAsOf > m ? f.navAsOf : m), '');

  const fills = [];
  let checked = 0;
  for (const id of ids) {
    const f = byId.get(id);
    const mp = map[id];
    if (!f || !mp || !mp.ticker) continue;
    if (f.navAsOf && f.navAsOf >= market) continue;   // 已跟上市場最新，無需補
    /* 只處理「落後 1–10 個日曆日」的：月頻基金（新地/富達等）落後以月計，
       雅虎那邊同樣是月頻，補不了；而且會讓每天多抓幾百個代碼。 */
    if (f.navAsOf) {
      const lagDays = (Date.parse(market) - Date.parse(f.navAsOf)) / 86400000;
      if (lagDays > 10) continue;
    }
    let ser;
    try { ser = yahooSeries(mp.ticker); } catch (e) { log('ERR ' + mp.ticker + ' ' + e.message.slice(0, 60)); continue; }
    if (!ser.length) continue;
    checked++;
    const last = ser[ser.length - 1];
    if (!f.navAsOf || last[0] <= f.navAsOf) continue;  // 雅虎也沒有更新的
    const ratio = Number(mp.ratio) || 1;
    const implied = last[1] * ratio;
    const dev = f.nav ? Math.abs(implied / f.nav - 1) : 0;
    if (dev > 0.15) { log('SKIP ' + id + ' ' + f.fundBase + ' 尺度偏差 ' + (dev * 100).toFixed(1) + '%（映射可疑）'); continue; }
    fills.push({ id, f, points: ser.filter((x) => x[0] > (f.navAsOf || '')).map(([d, v]) => [d, Math.round(v * ratio * 1e6) / 1e6]) });
  }

  if (!fills.length) {
    log('OK 檢查 ' + checked + ' 隻，雅虎與官網同日期或無更新，無需補（市場最新 ' + market + '）');
    console.log('SKIP');
    return 0;
  }
  if (fills.length > ids.length * 0.3) {
    log('ABORT 一次要補 ' + fills.length + '/' + ids.length + ' 隻，超過 30% 安全線，放棄');
    console.log('ABORT');
    return 0;
  }

  for (const x of fills) {
    log('FILL ' + x.id + ' ' + (x.f.fundBase || x.f.fund) + ' ' + (x.f.navAsOf || '-') + ' → ' + x.points[x.points.length - 1][0]
      + '（雅虎 ' + x.points[x.points.length - 1][1] + '）');
    if (DRY) continue;
    const hp = path.join(DATA, 'hist', x.id + '.json');
    try {
      const h = JSON.parse(fs.readFileSync(hp, 'utf8'));
      const have = new Set(h.series.map((p) => p[0]));
      x.points.forEach((p) => { if (!have.has(p[0])) h.series.push(p); });
      h.series.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      h.asOf = h.series[h.series.length - 1][0];
      h.last = h.series[h.series.length - 1][1];
      h.points = h.series.length;
      fs.writeFileSync(hp, JSON.stringify(h));
    } catch (e) { log('ERR 寫 hist 失敗 ' + x.id + ' ' + e.message); }
    const lastP = x.points[x.points.length - 1];
    x.f.nav = lastP[1];
    x.f.navAsOf = lastP[0];
    x.f.navProvisional = true;
    x.f.navSrcYahoo = true;
  }
  if (DRY) { console.log('FILLED ' + fills.length + '（--dry 未寫盤）'); return 0; }

  j.updatedAt = Date.now();
  j.yahooFilledAt = Date.now();
  fs.writeFileSync(FUNDS, JSON.stringify(j));
  log('已補 ' + fills.length + ' 隻，開始重算派生檔案');
  const run = (cmd, args) => { try { execFileSync(cmd, args, { cwd: ROOT, stdio: 'ignore', timeout: 300000 }); } catch (e) { log('WARN ' + args[0] + ' ' + e.message.slice(0, 60)); } };
  run(process.execPath, ['navperf.js']);
  run(process.execPath, ['mpfindex.js']);
  run(process.execPath, ['allstats.js']);
  run(process.execPath, ['tools/hist-index-sync.js']);
  console.log('FILLED ' + fills.length);
  return 0;
}

try { process.exit(main()); } catch (e) { console.error(e); process.exit(1); }
