#!/usr/bin/env node
/**
 * 宏利「当日补抓」守卫 —— 广州精研数据有限公司 · 香港强积金数据平台
 * ==================================================================
 * 背景（2026-11-11 用户要求）：
 *   宏利的发布时点不固定（实测有下午、晚间、跨夜三种），等 22:30 全量会慢一天；
 *   而全天每小时都抓又浪费。这里做成「按需补抓」：
 *     · 只在交易日 11:00–18:00 由外部定时器调用；
 *     · 每次先比较「宏利環球精選最新净值日」与「全市场最新净值日」；
 *     · 已经追上就立即退出（几秒），不抓、不写盘、不部署；
 *     · 落后才只抓宏利（67 只，约 90 秒），再重算受影响指标。
 *
 * 用法：
 *   node tools/manulife-watch.js --check     # 判定 + 需要时补抓（默认）
 *   node tools/manulife-watch.js --dry       # 只判定，不抓
 *   node tools/manulife-watch.js --force     # 忽略判定，强制抓一次（调试用）
 *
 * 输出约定（给自动化读）：
 *   STATUS manu=... market=... → SKIP / FETCH
 *   UPDATED  （数据已推进，调用方应发布站点）
 *   STALE    （抓完仍然落后，源站未发布）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FUNDS = path.join(DATA, 'funds.json');
const LOG = path.join(ROOT, 'tmp', 'manulife-watch.log');   /* 不进版本库 */
/* 本机 PATH 里的 python 没有 curl_cffi，daily 链路用的是 envs/default；
   云端 runner 的 python 自带依赖。这里按顺序探测，避免抓到一半报 ImportError。 */
function resolvePython() {
  const cands = [process.env.MPF_PY, 'python',
    'C:/Users/11718/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe'];
  for (const c of cands) {
    if (!c) continue;
    try { execFileSync(c, ['-c', 'import curl_cffi'], { stdio: 'ignore', timeout: 15000 }); return c; } catch (e) {}
  }
  return process.env.MPF_PY || 'python';
}
const PY = resolvePython();

const dry = process.argv.includes('--dry');
const force = process.argv.includes('--force');

function log(msg) {
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); } catch (e) {}
  const line = '[watch ' + new Date().toLocaleString('zh-CN', { hour12: false }) + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
}

function latestBy(funds, pred) {
  let m = '';
  funds.forEach((f) => { if (pred(f) && f.navAsOf && f.navAsOf > m) m = f.navAsOf; });
  return m;
}

function run(cmd, args, timeout) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe', timeout: timeout || 240000, encoding: 'utf8' });
}

/* 线上站点当前的数据版本：用于兜底「上一次抓到但部署失败」的情况。
   本地比线上新 → 即使本轮没有新数据，也要让调用方发布一次。 */
function liveUpdatedAt() {
  return new Promise((resolve) => {
    const req = https.get('https://mpf-data.app.workbuddy.host/api/status',
      { timeout: 8000, headers: { 'cache-control': 'no-store' } },
      (res) => {
        let s = '';
        res.on('data', (d) => { s += d; });
        res.on('end', () => { try { resolve(Number(JSON.parse(s).updatedAt) || 0); } catch (e) { resolve(0); } });
      });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

async function main() {
  /* 与早间/晚间链路共用同一把锁：另一条链路在跑时直接跳过，避免并发写 funds.json */
  const LOCK = path.join(ROOT, 'tmp', '.mpf-job.lock');
  if (fs.existsSync(LOCK)) { log('SKIP 另一条更新链路正在运行（.mpf-job.lock）'); console.log('SKIP'); return 0; }
  if (!fs.existsSync(FUNDS)) { log('ERROR 找不到 funds.json'); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const funds = j.funds || [];
  const isManu = (f) => f.trustee === '宏利' && String(f.scheme || '').indexOf('環球精選') >= 0;
  const manu = latestBy(funds, isManu);
  const market = latestBy(funds, (f) => f.trustee !== '宏利');   /* 只看其他发行人 */
  log('STATUS manu=' + (manu || '-') + ' market=' + (market || '-') + ' → ' + (manu && market && manu >= market ? 'SKIP' : 'FETCH'));

  if (!force && manu && market && manu >= market) {
    const live = await liveUpdatedAt();
    if (live && Number(j.updatedAt) > live + 5000) {
      log('线上版本 ' + new Date(live).toLocaleString('zh-CN') + ' 落后于本地，需要重新发布');
      console.log('UPDATED');
      return 0;
    }
    console.log('SKIP');
    return 0;
  }
  if (dry) { console.log('DRY'); return 0; }

  const t0 = Date.now();
  try {
    run(PY, ['fetch-manulife-hist.py'], 300000);
  } catch (e) {
    log('ERROR 宏利抓取失败：' + String(e.message || e).slice(0, 200));
    process.exit(1);
  }

  /* 把 hist 的最新点回写到 funds.json 的 nav/navAsOf，并把 updatedAt 刷新
     （服务端/前端都靠 updatedAt 判断版本；不写这个字段，自动刷新不会触发） */
  let advanced = 0;
  funds.forEach((f) => {
    if (!isManu(f)) return;
    try {
      const h = JSON.parse(fs.readFileSync(path.join(DATA, 'hist', String(f.id) + '.json'), 'utf8'));
      const s = h.series || [];
      if (!s.length) return;
      const [d, v] = s[s.length - 1];
      if (d && v > 0 && d > (f.navAsOf || '')) { f.nav = v; f.navAsOf = d; advanced++; }
    } catch (e) { /* 单只失败忽略 */ }
  });
  if (!advanced) {
    log('STALE 官网仍未发布新数据（宏利 ' + (manu || '-') + '，全市场 ' + (market || '-') + '），不写盘、不重算');
    const live2 = await liveUpdatedAt();
    console.log(live2 && Number(j.updatedAt) > live2 + 5000 ? 'UPDATED' : 'STALE');
    return 0;
  }
  j.updatedAt = Date.now();
  fs.writeFileSync(FUNDS, JSON.stringify(j));

  /* 只重算受影响的派生文件（不跑 navbuild/持仓/新闻） */
  const steps = [
    ['navperf.js', 120000],
    ['mpfindex.js', 60000],
    ['allstats.js', 60000],
    ['tools/hist-index-sync.js', 60000],
  ];
  for (const [s, to] of steps) {
    try { run(process.execPath, [s], to); } catch (e) { log('WARN ' + s + ' 失败：' + String(e.message || e).slice(0, 120)); }
  }

  const after = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const manu2 = latestBy(after.funds, isManu);
  const market2 = latestBy(after.funds, (f) => f.trustee !== '宏利');
  log('DONE 用时 ' + Math.round((Date.now() - t0) / 1000) + 's，宏利 ' + (manu || '-') + ' → ' + (manu2 || '-')
    + '，全市场 ' + (market2 || '-') + '，推进 ' + advanced + ' 只');
  console.log(manu2 && market2 && manu2 >= market2 ? 'UPDATED' : 'STALE');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
