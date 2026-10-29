/**
 * 广州精研数据有限公司 · 香港强积金（MPF）数据服务
 * 数据源：香港积金局官网 https://mfp.mpfa.org.hk/tch/mpp_list.jsp
 * 启动后自动抓取并缓存，默认每 6 小时自动刷新，保证数据实时更新。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { scrape, SOURCE_URL } = require('./scraper');

const PORT = process.env.PORT || 3000;
const REFRESH_MS = 24 * 60 * 60 * 1000; // 2026-10-23：积金局档案每月才更新，改为每天重抓一次（原 3 小时）；发行人净值由 22:30 的 navbuild 负责
const STALE_MS = 24 * 60 * 60 * 1000; // 2026-10-23：档案数据超过 24 小时视为过期（原 3 小时）
/* 2026-10-24：默认关闭服务端自抓（部署环境连不上积金局，详见 listen 回调注释） */
const SELF_FETCH = process.env.MPF_SELF_FETCH === '1';
const DATA_FILE = path.join(__dirname, 'data', 'funds.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
/* 2026-10-24 修 B04：口令已轮换（旧 （旧口令已作废） 作废），只存在于代码与本机，
   交接文档/提示词一律不再出现；支持环境变量覆盖 */
/* 2026-10-25：token 三级来源——环境变量 > data/upload-token.txt（git 忽略，不入公共仓库）> 空。
   空时仅允许本机回环推送（见 /api/upload 分支），保证 GitHub public repo 安全。 */
const UPLOAD_TOKEN = process.env.MPF_UPLOAD_TOKEN
  || (() => { try { return require('fs').readFileSync(require('path').join(__dirname, 'data', 'upload-token.txt'), 'utf8').trim() || ''; } catch (e) { return ''; } })();
const ANALYTICS_FILE = path.join(__dirname, 'data', 'analytics.json'); // 匿名访问统计（按日聚合，保留最近 90 天）

let cache = null; // { updatedAt, years, funds, source, count, origin }
let lastError = null;
let refreshing = false;
let refreshingSince = 0; // 本次刷新开始时间（用于「卡死自愈」）
let lastServerFetchOk = null; // 服务端自己直连积金局官网是否成功（true/false/null=未尝试）

/* ===================== 市场概览聚合（首页用） =====================
 * 全部由积金局官方数值直接汇总，只做求和与算术平均，不做任何推算或补全。
 */
const rnd = (n, d) => (n == null || Number.isNaN(n) ? null : Number(n.toFixed(d == null ? 2 : d)));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const median = (arr) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ---------- 积金局最新月度公布（按月更新） ----------
 * 数据存放于 data/mpfa-monthly.json（人工核对官方新闻稿表格后录入，随部署上线）；
 * 官方口径为「過去 12 個月」及长期年率化净回报——积金局不发布「本月/年初至今」公开数据。
 */
let MPFA_MONTHLY = undefined;
function loadMpfaMonthly() {
  if (MPFA_MONTHLY !== undefined) return MPFA_MONTHLY;
  try {
    const fp = path.join(__dirname, 'data', 'mpfa-monthly.json');
    MPFA_MONTHLY = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : null;
  } catch (e) {
    console.error('[MPF] 读取 mpfa-monthly.json 失败:', e.message);
    MPFA_MONTHLY = null;
  }
  return MPFA_MONTHLY;
}

/* ---------- 自算净值口径的全市场近 1 年统计（2026-10-22 新增） ----------
 * 目的：首页「市场涨跌温度计 / 近 1 年平均回报」原先只能用积金局季频数据（截至 2026-09-30），
 *       用户要求改用我们自己的日度净值（净值日 2026-10-20）来做，同时保留积金局口径做对照。
 * 口径：nav-perf.json 的 y1（近 1 年年率化，净价、不含分红再投资与费用调整），与积金局「含费含息」口径不同。
 */
let SELF_STAT_CACHE = { mtime: 0, data: null };
function loadSelfStat() {
  try {
    const fp = path.join(__dirname, 'data', 'nav-perf.json');
    const st = fs.statSync(fp);
    if (SELF_STAT_CACHE.data && SELF_STAT_CACHE.mtime === st.mtimeMs) return SELF_STAT_CACHE.data;
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const f = (j && j.funds) || {};
    const vals = [];
    let asOf = '';
    Object.keys(f).forEach((k) => {
      const x = f[k] || {};
      if (x.y1 != null && isFinite(x.y1)) vals.push(x.y1);
      if (x.asOf && x.asOf > asOf) asOf = x.asOf;
    });
    const out = {
      base: vals.length,
      avg: rnd(mean(vals)),
      median: rnd(median(vals)),
      up: vals.filter((x) => x > 0).length,
      flat: vals.filter((x) => x === 0).length,
      down: vals.filter((x) => x < 0).length,
      asOf,
      hsi: (j && j.meta && j.meta.hsi) || null,
    };
    SELF_STAT_CACHE = { mtime: st.mtimeMs, data: out };
    return out;
  } catch (e) {
    console.error('[MPF] 读取 nav-perf.json 失败:', e.message);
    return null;
  }
}

function buildMarketStat(c) {
  const funds = (c && c.funds) || [];
  const byType = {};
  const byTrustee = {};
  const byRisk = {};
  let sizeSum = 0;
  let a1All = [];

  for (const f of funds) {
    const size = f.size || 0;
    sizeSum += size;
    if (f.ann1 != null) a1All.push(f.ann1);

    const tk = f.type || '其他';
    byType[tk] = byType[tk] || { name: tk, count: 0, size: 0, a1: [], a5: [], a10: [] };
    byType[tk].count += 1;
    byType[tk].size += size;
    if (f.ann1 != null) byType[tk].a1.push(f.ann1);
    if (f.ann5 != null) byType[tk].a5.push(f.ann5);
    if (f.ann10 != null) byType[tk].a10.push(f.ann10);

    const uk = f.trustee || '其他';
    byTrustee[uk] = byTrustee[uk] || { name: uk, count: 0, size: 0, a1: [], a5: [], a10: [] };
    byTrustee[uk].count += 1;
    byTrustee[uk].size += size;
    if (f.ann1 != null) byTrustee[uk].a1.push(f.ann1);
    if (f.ann5 != null) byTrustee[uk].a5.push(f.ann5);
    if (f.ann10 != null) byTrustee[uk].a10.push(f.ann10);

    const rk = f.risk == null ? 0 : f.risk;
    byRisk[rk] = byRisk[rk] || { risk: rk, count: 0, size: 0 };
    byRisk[rk].count += 1;
    byRisk[rk].size += size;
  }

  const pack = (o) =>
    Object.keys(o)
      .map((k) => {
        const v = o[k];
        return {
          name: v.name != null ? v.name : v.risk,
          count: v.count,
          size: rnd(v.size, 0),
          avgAnn1: rnd(mean(v.a1)),
          avgAnn5: rnd(mean(v.a5)),
          avgAnn10: rnd(mean(v.a10)),
        };
      })
      .sort((a, b) => (b.size || 0) - (a.size || 0));

  // 历年市场整体回报（各年参与统计的基金算术平均 / 中位数 / 涨跌家数）
  const byYear = (c.years || [])
    .slice()
    .sort()
    .map((y) => {
      const vals = funds.map((f) => (f.cal ? f.cal[y] : null)).filter((v) => v != null);
      return {
        year: y,
        n: vals.length,
        avg: rnd(mean(vals)),
        median: rnd(median(vals)),
        up: vals.filter((v) => v > 0).length,
        down: vals.filter((v) => v < 0).length,
      };
    });

  /* 榜单卡片用的精简字段。
     注意：新增榜单时必须同时在这里补上对应字段，否则前端拿到 undefined 会显示「—」
     （上一版「近5年回报领先 / 推出至今累积回报 / 低风险优选」三个榜就是这么空掉的）。 */
  const brief = (f) => ({
    fund: f.fundBase || f.fund,
    scheme: f.scheme || '',
    trustee: f.trustee,
    type: f.type,
    subtype: f.subtype,
    ann1: f.ann1,
    ann5: f.ann5,
    cumLaunch: f.cumLaunch,
    risk: f.risk,
    size: f.size,
    fer: f.fer,
    feeMore: f.feeMore,   // 官网区间/「最高」式费用的原文信息（列表按官网形式展示）
  });

  // 同一只基金的 A/T 类等单位类别只保留一次，避免榜单被同一基金的各份额刷屏
  // 按「基金名 + 计划」去重：不同计划下的同名基金（如东亚集成信托 vs 东亚行业计划）仍分别保留
  const dedupeFund = (arr) => {
    const seen = {};
    const out = [];
    for (const f of arr) {
      const k = (f.fundBase || f.fund) + '|' + (f.scheme || '') + '|' + (f.trustee || '');
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(f);
    }
    return out;
  };

  const withAnn1 = funds.filter((f) => f.ann1 != null);
  const withFer = funds.filter((f) => f.fer != null);
  const withAnn5 = funds.filter((f) => f.ann5 != null);
  const withCumLaunch = funds.filter((f) => f.cumLaunch != null);
  const withRisk = funds.filter((f) => f.risk != null);

  return {
    updatedAt: c.updatedAt,
    dataAsOf: c.dataAsOf || '',
    years: c.years || [],
    count: c.count || funds.length,
    unitRows: c.unitRows || funds.length,
    declaredTotal: c.declaredTotal != null ? c.declaredTotal : null,
    trusteeCount: new Set(funds.map((f) => f.trustee)).size,
    schemeCount: new Set(funds.map((f) => f.scheme)).size,
    totalSize: rnd(sizeSum, 0),
    avgAnn1: rnd(mean(a1All)),
    medianAnn1: rnd(median(a1All)),
    minAnn1: a1All.length ? rnd(Math.min.apply(null, a1All)) : null,
    maxAnn1: a1All.length ? rnd(Math.max.apply(null, a1All)) : null,
    upCount: withAnn1.filter((f) => f.ann1 > 0).length,
    flatCount: withAnn1.filter((f) => f.ann1 === 0).length,
    downCount: withAnn1.filter((f) => f.ann1 < 0).length,
    upBase: withAnn1.length,
    byYear: byYear,
    byType: pack(byType),
    byTrustee: pack(byTrustee),
    byRisk: Object.keys(byRisk).map((k) => byRisk[k]).sort((a, b) => a.risk - b.risk),
    topReturn: dedupeFund(withAnn1.slice().sort((a, b) => b.ann1 - a.ann1)).slice(0, 5).map(brief),
    topSize: dedupeFund(funds.slice().sort((a, b) => (b.size || 0) - (a.size || 0))).slice(0, 5).map(brief),
    lowFee: dedupeFund(withFer.slice().sort((a, b) => a.fer - b.fer)).slice(0, 5).map(brief),
    topReturn5: dedupeFund(withAnn5.slice().sort((a, b) => b.ann5 - a.ann5)).slice(0, 5).map(brief),
    topCumLaunch: dedupeFund(withCumLaunch.slice().sort((a, b) => b.cumLaunch - a.cumLaunch)).slice(0, 5).map(brief),
    lowRisk: dedupeFund(withRisk.slice().sort((a, b) => (a.risk - b.risk) || ((b.size || 0) - (a.size || 0)))).slice(0, 5).map(brief),
    navStat: c.navStat || null,
    /* 2026-10-22：自算净值口径（日度，最新净值日）——供首页温度计与 KPI 使用，与积金局季频口径分开标注 */
    self: loadSelfStat(),
    // 积金局最新月度公布（截至 2026-09-30，2026-10-06 发布）
    mpfaMonthly: loadMpfaMonthly(),
  };
}

function loadSnapshot() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (j && Array.isArray(j.funds) && j.funds.length) {
        // 兼容旧快照：补齐新字段
        if (!j.count) j.count = j.funds.length;
        /* 2026-10-22 修：unitRows 曾因「上传的 funds.json 不带 units 数组」被写成 0，
           首页显示「成分基金 0 条」「447 / 0 条」。无 units 时按基金行数兜底。 */
        if (!j.unitRows) j.unitRows = (j.units || []).length || j.funds.length;
        if (j.declaredTotal == null) j.declaredTotal = null;
        return j;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

/* ---------- 单位类别分组派生（仅内存附加，绝不写数据文件） ----------
 * 同一只成分基金常有多个「单位类别」（A 类/T 类…），收费与净值不同。
 * 前端详情弹窗的「单位类别明细」表需要每个类别一行；此前该分组从未随接口下发，
 * 导致弹窗里的表格永远不会出现。这里在响应前按「基金主名＋计划＋受托人」派生一次，
 * 单条（无并列）的基金不附加，以控制载荷体积。
 */
function attachUnits(funds) {
  if (!funds || !funds.length) return funds;
  if (funds.__unitsDone) return funds;
  const map = {};
  funds.forEach((f) => {
    const k = (f.fundBase || f.fund) + '|' + (f.scheme || '') + '|' + (f.trustee || '');
    (map[k] = map[k] || []).push(f);
  });
  const unitFields = ['nav', 'navAsOf', 'navSource', 'navStatus', 'size', 'ann1', 'ann5', 'annLaunch', 'mgmtFee'];
  Object.keys(map).forEach((k) => {
    const arr = map[k];
    if (arr.length < 2) return;
    const units = arr.map((f) => {
      const u = { cfId: f.id, unit: f.unit || '' };
      unitFields.forEach((key) => { if (f[key] !== undefined) u[key] = f[key]; });
      return u;
    });
    arr.forEach((f) => { f.units = units; });
  });
  Object.defineProperty(funds, '__unitsDone', { value: true, enumerable: false });
  return funds;
}

/* 2026-10-20：逐日净值历史（供款计算器用），带进程内缓存 */
const HIST_DIR = path.join(__dirname, 'data', 'hist');
const histCache = Object.create(null);
/* 2026-10-21 A1：hist 文件是历史回填产物，最新 1–2 天只在 funds.json 里。
   把补点逻辑抽成公共函数，/api/hist 与 /api/dca 共用，避免两套结果。 */
function mergeLatestNav(obj, id) {
  if (!obj || !Array.isArray(obj.series)) return obj;
  const f = ((cache && cache.funds) || []).find((x) => String(x.id) === String(id));
  if (!f || !(f.nav > 0) || !f.navAsOf) return obj;
  const last = obj.series[obj.series.length - 1];
  if (!last || f.navAsOf > last[0]) {
    obj.series.push([f.navAsOf, f.nav]);
    obj.asOf = f.navAsOf; obj.last = f.nav; obj.points = obj.series.length;
  } else if (last && f.navAsOf === last[0] && Math.abs(f.nav - last[1]) > 1e-9) {
    obj.series[obj.series.length - 1] = [f.navAsOf, f.nav];
    obj.last = f.nav;
  }
  return obj;
}

function loadHist(id) {
  if (Object.prototype.hasOwnProperty.call(histCache, id)) return histCache[id];
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(HIST_DIR, id + '.json'), 'utf8'));
    histCache[id] = mergeLatestNav(obj, id);
  } catch (e) { histCache[id] = null; }
  return histCache[id];
}

function saveSnapshot(obj) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj));
  } catch (e) {
    console.error('写入数据快照失败:', e.message);
  }
}

/* ===================== 匿名访问统计（PV/UV、导出、分享） =====================
 * 仅记录匿名计数（随机访客 ID + 事件名），不保存 IP、UA 或任何可识别信息。
 * 数据按日聚合存于 data/analytics.json。 */
let analytics = (function () {
  try { return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8')) || {}; } catch (e) { return {}; }
})();

function analyticsSave() {
  try { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 1)); } catch (e) {}
}

function analyticsBump(pvKey, eKey, vid) {
  const d = new Date();
  const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const a = analytics[day] || (analytics[day] = { pv: {}, vids: [], export: 0, share: 0 });
  if (pvKey) a.pv[pvKey] = (a.pv[pvKey] || 0) + 1;
  if (eKey) a[eKey] = (a[eKey] || 0) + 1;
  if (vid && typeof vid === 'string' && vid.length <= 64 && a.vids.indexOf(vid) < 0 && a.vids.length < 10000) a.vids.push(vid);
  const keys = Object.keys(analytics).sort();
  while (keys.length > 90) delete analytics[keys.shift()];
  analyticsSave();
}

function readBody(req, cb) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { chunks.push(c); size += c.length; if (size > 64 * 1024) req.destroy(); });
  req.on('end', () => cb(Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => cb(''));
}

async function refresh(force) {
  if (refreshing) {
    /* 卡死自愈：单次刷新不应超过 3 分钟。若底层网络黑洞（DNS/连接挂起）导致 scrape
       永不返回，refreshing 会一直为 true、令「更新数据」按钮永久失效（2026-10-11 实况）。
       这里强制复位后继续本次刷新，内层再加 race 总超时，双重保险。 */
    if (Date.now() - refreshingSince < 3 * 60 * 1000) return cache;
    console.warn('[MPF] 上一次刷新超过 3 分钟未完成，已强制复位并重新尝试');
    refreshing = false;
  }
  const age = cache ? Date.now() - cache.updatedAt : Infinity;
  if (!force && cache && age < STALE_MS) return cache;
  refreshing = true;
  refreshingSince = Date.now();
  try {
    const r = await Promise.race([
      scrape(),
      /* 2026-10-23：积金局站点偶发慢，150 秒不够用（核验时记录到一次总超时），放宽到 240 秒 */
      new Promise((_, rej) => setTimeout(() => rej(new Error('抓取总超时（240 秒）')), 240000)),
    ]);
    if (!r.funds.length) throw new Error('抓取结果为空');
    cache = {
      updatedAt: Date.now(),
      source: SOURCE_URL,
      dataAsOf: r.dataAsOf || (cache && cache.dataAsOf) || '',
      years: r.years,
      count: r.funds.length,
      unitRows: (r.units || []).length,
      declaredTotal: r.declaredTotal || null,
      navStat: r.navStat || null,
      funds: r.funds,
      origin: 'server',
    };
    lastError = null;
    lastServerFetchOk = true;
    saveSnapshot(cache);
    console.log('[MPF] 服务端自抓成功：' + r.funds.length + ' 只基金 @ ' + new Date().toLocaleString('zh-CN'));
  } catch (e) {
    lastError = e.message;
    lastServerFetchOk = false;
    console.error('[MPF] 服务端自抓失败（部署环境可能无法直连积金局官网）:', e.message);
    if (!cache) cache = loadSnapshot(); // 兜底用上一次快照
  } finally {
    refreshing = false;
    refreshingSince = 0;
  }
  return cache;
}

/* 静态资源版本号（2026-10-11 起自动生成）：
 * 取 public 下主要 js/css 的最新修改时间——部署更新文件后 mtime 变化、版本号随之变化。
 * 页面里的 ?v=xxx 在响应 HTML 时统一替换为该版本号：浏览器可长期缓存代码，
 * 而每次部署后普通刷新即能拿到新版（不再依赖人工修改版本号，杜绝「改了但用户看到旧版」）。 */
const ASSET_V = (function () {
  try {
    let mx = 0;
    /* 扫描 public 下全部 js/css（不写死文件名清单）——新增页面资源（如 analysis.js/css）
       自动纳入版本号，避免「清单漏项 → 部署后 ?v= 不变 → 用户仍看旧缓存」 */
    fs.readdirSync(PUBLIC_DIR).forEach((f) => {
      if (!/\.(js|css)$/.test(f)) return;
      try { const st = fs.statSync(path.join(PUBLIC_DIR, f)); if (st.mtimeMs > mx) mx = st.mtimeMs; } catch (e) {}
    });
    return String(Math.round(mx));
  } catch (e) { return '0'; }
})();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest)|image\/svg)/;

/** 统一出口：大于 1KB 的可压缩内容自动 gzip（移动端首屏体积可降 ~80%）
 *  2026-10-20：加 ETag + 协商缓存 —— 二次访问命中 304，避免重复下载 1.6MB JSON。 */
function sendRaw(req, res, code, body, type, opt) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const t = type || 'application/json; charset=utf-8';
  const headers = Object.assign(
    { 'Content-Type': t, 'Cache-Control': (opt && opt.cache) || 'no-store', 'Access-Control-Allow-Origin': '*' },
    (opt && opt.headers) || {}
  );
  /* ETag：正文 md5 前 16 位 + 长度（1–2MB 计算约 3–5ms，可忽略） */
  let etag = (opt && opt.etag) || null;
  if (!etag && code === 200 && buf.length > 1024) {
    etag = '"' + buf.length.toString(16) + '-' + crypto.createHash('md5').update(buf).digest('hex').slice(0, 16) + '"';
  }
  if (etag) {
    headers['ETag'] = etag;
    if (!headers['Cache-Control'] || headers['Cache-Control'] === 'no-store') {
      headers['Cache-Control'] = 'no-cache';
    }
    const inm = String((req && req.headers && req.headers['if-none-match']) || '');
    if (inm && inm.split(',').map((x) => x.trim()).indexOf(etag) >= 0) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'], Vary: 'Accept-Encoding' });
      return res.end();
    }
  }
  const ae = String((req && req.headers && req.headers['accept-encoding']) || '');
  if (buf.length > 1024 && /\bgzip\b/.test(ae) && COMPRESSIBLE.test(t)) {
    zlib.gzip(buf, { level: 6 }, (err, gz) => {
      if (err || !gz) {
        headers['Content-Length'] = buf.length;
        res.writeHead(code, headers);
        return res.end(buf);
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      headers['Content-Length'] = gz.length;
      res.writeHead(code, headers);
      res.end(gz);
    });
    return;
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(code, headers);
  res.end(buf);
}

function send(res, code, body, type) {
  sendRaw(res && res.req, res, code, body, type);
}

/* ================= 数据文件「原子读写 + 上一份可用副本」 =================
 * 2026-10-29（5.0）：用户反馈早间更新时页面有模块显示不出来。根因是数据链路一边写
 * data/*.json、线上/本地服务一边按请求直接读文件：正好读到写了一半的文件时
 * JSON.parse 失败，接口返回空/500，前端就把整块清空。
 * 处理：
 *   1) 写：先写同目录临时文件再 rename（同卷 rename 是原子操作），读者永远看到完整文件；
 *   2) 读：解析失败短暂重试（等写盘完成），仍失败则回上一份成功解析的内容，
 *      并带 X-Data-Fallback 头，让前端知道这是上一版数据而不是空白。
 */
const LAST_GOOD_JSON = new Map();

function writeJsonAtomic(fp, obj) {
  const tmp = fp + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, typeof obj === 'string' ? obj : JSON.stringify(obj));
  fs.renameSync(tmp, fp);
}

function serveJsonFile(req, res, file, opt) {
  const opts = opt || {};
  const attempt = (n) => {
    fs.readFile(file, (err, buf) => {
      if (!err) {
        try {
          JSON.parse(buf.toString('utf8'));
          LAST_GOOD_JSON.set(file, buf);
          return sendRaw(req, res, 200, buf, MIME['.json'], { cache: opts.cache || 'no-store' });
        } catch (e) {
          if (n < 3) return setTimeout(() => attempt(n + 1), 120);
        }
      } else if (n < 2) {
        return setTimeout(() => attempt(n + 1), 120);
      }
      const last = LAST_GOOD_JSON.get(file);
      if (last) {
        return sendRaw(req, res, 200, last, MIME['.json'], {
          cache: 'no-store',
          headers: { 'X-Data-Fallback': '1', 'X-Data-Fallback-Of': path.basename(file) },
        });
      }
      return sendRaw(req, res, 503, JSON.stringify({ error: '数据正在更新，请稍后重试' }), MIME['.json'], {
        cache: 'no-store',
        headers: { 'Retry-After': '5' },
      });
    });
  };
  attempt(0);
}

/** 启动时预热：把关键文件读进 LAST_GOOD_JSON，避免首次请求恰逢写盘时无兜底 */
function warmJsonCache() {
  ['nav-perf.json', 'hist-index.json', 'holdings.json', 'index.json', 'funds.json'].forEach((f) => {
    const fp = path.join(__dirname, 'data', f);
    try { LAST_GOOD_JSON.set(fp, fs.readFileSync(fp)); } catch (e) {}
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;

  if (p === '/api/funds') {
    /* 2026-10-22 性能：已有缓存就先返回（stale-while-revalidate），把抓取放到后台，
       不再让首屏等一次可能长达 150 秒的 scrape。 */
    /* 2026-10-24：自抓关闭时不再触发后退刷新，只读快照 */
    if (SELF_FETCH) { if (cache) { refresh(false).catch(() => {}); } else { await refresh(false); } }
    if (!cache) return send(res, 503, JSON.stringify({ error: '数据暂不可用', detail: lastError }));
    return send(
      res,
      200,
      JSON.stringify({
        updatedAt: cache.updatedAt,
        updatedAtText: new Date(cache.updatedAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Hong_Kong' }),
        source: cache.source,
        dataAsOf: cache.dataAsOf || '',
        years: cache.years,
        count: cache.count,
        unitRows: cache.unitRows || 0,
        declaredTotal: cache.declaredTotal || null,
        navStat: cache.navStat || null,
        trusteeCount: new Set(cache.funds.map((f) => f.trustee)).size,
        schemeCount: new Set(cache.funds.map((f) => f.scheme)).size,
        stale: Date.now() - cache.updatedAt > STALE_MS,
        error: lastError,
        /* 2026-10-23：navStale 在响应时计算，任何写入路径都不会丢（核验报告 v2） */
        funds: attachUnits(cache.funds).map((f) => Object.assign({}, f, {
          navStale: !!(f.navAsOf && Math.round((Date.now() - new Date(f.navAsOf + 'T00:00:00').getTime()) / 864e5) > 7),
        })),
      })
    );
  }

  // 首页市场概览：服务端聚合好，避免首页下载全量 451 条明细
  if (p === '/api/market') {
    /* 2026-10-24：自抓关闭时不再触发后退刷新，只读快照 */
    if (SELF_FETCH) { if (cache) { refresh(false).catch(() => {}); } else { await refresh(false); } }
    if (!cache) return send(res, 503, JSON.stringify({ error: '数据暂不可用', detail: lastError }));
    return send(res, 200, JSON.stringify(buildMarketStat(cache)));
  }

  /* ---------------- 走势数据（指数 / 基金历史 / 自算指标） ---------------- */
  // 指数序列（东方财富日线，2020 年起）
  /* 2026-10-21：历史缺口清单（105 只早期为月度数据），供详情页悬浮提示与 DCA 校验 */
  if (p === '/api/hist-gaps') {
    return fs.readFile(path.join(__dirname, 'data', 'hist-gaps.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '未生成', funds: {} }));
      sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=3600' });
    });
  }

  if (p === '/api/indices') {
    /* 2026-10-21 性能：?lite=1 只回恒生指数（首屏画默认线用，543KB → ~2KB）；
       用户点「选择指数」时再拉全量。 */
    const lite = u.searchParams.get('lite') === '1';
    return fs.readFile(path.join(__dirname, 'data', 'index.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '指数数据未生成' }));
      if (!lite) return sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=900' });
      try {
        const j = JSON.parse(buf.toString('utf8'));
        const one = (j.items && (j.items.HSI || j.items.HSI2)) || null;
        const body = JSON.stringify({ updatedAt: j.updatedAt, items: one ? { HSI: one } : {} });
        return sendRaw(req, res, 200, body, MIME['.json'], { cache: 'public, max-age=900' });
      } catch (e2) {
        return sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=900' });
      }
    });
  }
  // 单只基金历史净值（data/hist/<id>.json）
  // 2026-10-21 修复「走势图不更新」：hist 文件是历史回填产物，最新一两天要由发行人价格页补上。
  if (p.startsWith('/api/hist/')) {
    const hid = p.slice('/api/hist/'.length).replace(/[^0-9A-Za-z_-]/g, '');
    if (!hid) return send(res, 400, JSON.stringify({ error: 'bad id' }));
    return fs.readFile(path.join(__dirname, 'data', 'hist', hid + '.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '该基金暂无历史净值', id: hid }));
      let out = buf.toString('utf8');
      try {
        const obj = mergeLatestNav(JSON.parse(out), hid);
        out = JSON.stringify(obj);
      } catch (e) { /* 解析失败则原样返回 */ }
      sendRaw(req, res, 200, out, MIME['.json'], { cache: 'public, max-age=3600' });
    });
  }

  // 自算指标（由历史净值计算：日涨跌 / 各区间涨幅 / 最大回撤）
  if (p === '/api/navperf') {
    return serveJsonFile(req, res, path.join(__dirname, 'data', 'nav-perf.json'), { cache: 'public, max-age=900' });
  }
  // 历史净值索引（用于发行人数据完整性标识，2026-10-17）
  if (p === '/api/hist-index') {
    return serveJsonFile(req, res, path.join(__dirname, 'data', 'hist-index.json'), { cache: 'public, max-age=900' });
  }
  // 基金英文名（积金局英文版，供简繁英搜索）
  if (p === '/api/names-en') {
    return fs.readFile(path.join(__dirname, 'data', 'names-en.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '英文名未生成' }));
      sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=3600' });
    });
  }
  // 发行人官网业绩快照（不等积金局：近1/3/5年、历年回报、风险级别）
  if (p === '/api/trustee-perf') {
    return fs.readFile(path.join(__dirname, 'data', 'trustee-perf.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '发行人业绩数据未生成' }));
      sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=1800' });
    });
  }
  // 发行人平均指数（等权链式，供第四页「发行人平均 vs 恒指」对比）
  if (p === '/api/trustee-idx') {
    return fs.readFile(path.join(__dirname, 'data', 'trustee-idx.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '发行人平均指数未生成' }));
      sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=1800' });
    });
  }
  // 十大持仓与资产分布（各发行人官网「基金便览」，月度；未接入时 404，前端显示接入说明）
  if (p === '/api/allstats') {
    return fs.readFile(path.join(__dirname, 'data', 'allstats.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: 'allstats 未生成' }));
      sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=1800' });
    });
  }

  /* 2026-10-20 供款（定投）计算器：按月末净值累加份额
     /api/dca?amount=2000&start=2020-01&funds=317:60,318:40 */
  if (p === '/api/dca') {
    try {
      const amount = parseFloat(u.searchParams.get('amount')) || 0;
      const start = (u.searchParams.get('start') || '').slice(0, 7);
      /* 2026-10-21：新增结束月份（默认上一个月，避免「本月到底算不算」的歧义） */
      const nowD = new Date(Date.now() + 8 * 3600e3);
      const prevYM = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
      const defEnd = prevYM.getFullYear() + '-' + String(prevYM.getMonth() + 1).padStart(2, '0');
      /* 2026-10-23 修 G5：缺省结束月取「上一个月」，但若开始月已是本月，则结束月跟随开始月，
         否则用户只改开始月就会撞上「结束早于开始」的 400。 */
      const endQ = (u.searchParams.get('end') || '').slice(0, 7);
      let end = endQ || defEnd;
      if (!endQ && start && /^\d{4}-(0[1-9]|1[0-2])$/.test(start) && end < start) end = start;
      /* 2026-10-23（核验报告 #8）：未写权重时默认 100%（原来是 0，等于白算）；同一基金重复出现只取一次 */
      /* 2026-10-23（核验报告 v2）：同一基金重复出现时权重相加（原来只取第一条，导致本金少算） */
      const agg = new Map();
      (u.searchParams.get('funds') || '').split(',').map((x) => x.split(':')).filter((a) => a[0]).forEach((a) => {
        const w = (a[1] === undefined || a[1] === '') ? 100 : (parseFloat(a[1]) || 0);
        agg.set(a[0], (agg.get(a[0]) || 0) + w);
      });
      const raw = Array.from(agg.entries()).map(([id, w]) => [id, String(w)]);
      const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
      if (!(amount >= 100) || !YM.test(start) || !YM.test(end) || !raw.length) {
        return send(res, 400, JSON.stringify({ error: amount < 100 ? '每月供款至少 100 港元' : '参数不完整或月份格式错误（应为 YYYY-MM）' }));
      }
      if (end < start) return send(res, 400, JSON.stringify({ error: '结束月份早于开始月份' }));
      /* P2-2（2026-10-21 复核报告）：负权重直接拒绝，不再静默归零 */
      if (raw.some((x) => (parseFloat(x[1]) || 0) < 0)) {
        return send(res, 400, JSON.stringify({ error: '权重不能为负数' }));
      }
      /* B1：权重合计不等于 100% 时给出提示（仍按实际权重计算） */
      const wRawSum = raw.reduce((a, x) => a + Math.max(0, parseFloat(x[1]) || 0), 0);
      const wsum = raw.reduce((a, x) => a + (Math.max(0, Math.min(100, parseFloat(x[1]) || 0))), 0);
      const overCap = raw.some((x) => (parseFloat(x[1]) || 0) > 100);
      let warning = null;
      if (raw.length > 10) {
        /* 2026-10-24 修 C13/B08：超 10 只此前被静默丢弃，现明确告知仅取前 10 只 */
        warning = '单次最多计算 10 只基金，已仅取前 10 只（提交 ' + raw.length + ' 只）';
      }
      if (overCap) {
        warning = (warning ? warning + '；' : '') + '单只基金权重超过 100%，已按 100% 计算（原始合计 ' + (Math.round(wRawSum * 10) / 10) + '%）';
      } else if (Math.abs(wsum - 100) > 1) {
        warning = (warning ? warning + '；' : '') + '权重合计 ' + (Math.round(wsum * 10) / 10) + '%，每月实际投入约 ' + Math.round(amount * wsum / 100) + ' 港元（不是 ' + amount + '）';
      }
      const out = [];
      let totalPrincipal = 0, totalValue = 0, maxMonths = 0, asOf = '';
      for (const [id, wRaw] of raw.slice(0, 10)) {
        const w = Math.max(0, Math.min(100, parseFloat(wRaw) || 0)) / 100;
        const h = loadHist(id);
        if (!h || !Array.isArray(h.series) || !h.series.length) { out.push({ id, error: '无历史净值' }); continue; }
        const me = {};
        for (const [d, v] of h.series) { const ym = d.slice(0, 7); if (ym >= start && ym <= end) me[ym] = v; }
        const months = Object.keys(me).sort();
        if (!months.length) {
          /* 2026-10-23 修 G6：原实现把「区间整体早于基金首月」也说成「晚于最新净值」，方向说反了 */
          const first = h.series[0] ? h.series[0][0].slice(0, 7) : '';
          const last = h.series[h.series.length - 1] ? h.series[h.series.length - 1][0].slice(0, 7) : '';
          let msg = '所选区间内无该基金净值';
          if (last && end < first) msg = '所选区间早于该基金最早净值（' + first + '）';
          else if (first && start > last) msg = '起始月份晚于最新净值月（' + last + '）';
          out.push({ id, error: msg }); continue;
        }
        let units = 0, principal = 0;
        for (const m of months) { const nav = me[m]; if (!nav) continue; const cash = amount * w; units += cash / nav; principal += cash; }
        const lastMonth = months[months.length - 1];
        /* 最新净值（不受 end 限制）：hist 末点即最新可得净值 */
        const latestRow = h.series[h.series.length - 1];
        const lastNav = latestRow ? latestRow[1] : me[lastMonth];
        const latestDate = latestRow ? latestRow[0] : '';
        const value = units * lastNav;
        totalPrincipal += principal; totalValue += value;
        maxMonths = Math.max(maxMonths, months.length);
        /* A2：不再取序列最新日，改为区间末那一期的日期（汇总时统一取最早） */
        /* 2026-10-20：数据缺口检测——所选起始月份早于该基金最早净值月份时，明确告知缺了几个月 */
        const mdiff = (a, b) => {
          const [ay, am] = a.split('-').map(Number);
          const [by, bm] = b.split('-').map(Number);
          return (by - ay) * 12 + (bm - am);
        };
        const missing = Math.max(0, mdiff(start, months[0]));
        const expectMonths = mdiff(start, end) + 1;
        const gapMonths = Math.max(0, expectMonths - months.length);
        out.push({ id, name: h.name, scheme: h.scheme, weight: Math.round(w * 1000) / 10, months: months.length,
          expectMonths, gapMonths,
          firstMonth: months[0], lastMonth,
          lastDate: latestDate || h.asOf || lastMonth,     /* 估值用的最新净值日 */
          payToMonth: lastMonth,                            /* 供款到哪个月（= end 或更早） */
          lastAsOf: h.asOf || lastMonth, firstDate: (h.series && h.series[0] && h.series[0][0]) || months[0], lastNav: Math.round(lastNav * 10000) / 10000,
          firstAvailable: (h.series && h.series[0] && h.series[0][0]) || months[0],
          missing,
          principal: Math.round(principal), value: Math.round(value), gain: Math.round(value - principal),
          rate: principal ? Math.round((value / principal - 1) * 10000) / 100 : null });
      }
      const ok = out.filter((x) => !x.error);
      const gain = totalValue - totalPrincipal;
      /* 计算截止：取各基金最后可得月份的**最早**一个；并找出造成该截断的基金名 */
      let limitMonth = '';
      let limiter = '';
      let limitDate = '';
      /* 只有「最后可得月份早于所选结束月」的基金才构成截断（否则说明是被 end 正常截断，不必提示） */
      ok.forEach((x) => {
        if (x.lastMonth < end && (!limitMonth || x.lastMonth < limitMonth)) {
          limitMonth = x.lastMonth; limiter = x.name; limitDate = x.lastAsOf || x.lastMonth;
        }
      });
      /* 估值日 = 各基金最新净值日里最早的那个（页面显示为区间） */
      /* 断档原因：晚发行 vs 官网只给近期 —— 用 funds.json 的 launch 判断 */
      const launchOf = (id) => {
        const f = ((cache && cache.funds) || []).find((y) => String(y.id) === String(id));
        return (f && f.launch) ? f.launch : '';
      };
      const toISO = (d) => {
        const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(d || '').trim());
        return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : '';
      };
      const gaps = ok.filter((x) => x.gapMonths > 0).map((x) => {
        const launch = toISO(launchOf(x.id));
        const late = launch && launch.slice(0, 7) > start;
        return {
          id: x.id, name: x.name, gapMonths: x.gapMonths,
          firstMonth: x.firstMonth, firstDate: x.firstDate,
          launch: launch || '',
          reason: late ? 'late-launch' : 'source-short',
          /* 只有「不是晚发行」且「首月就等于所选开始月」时，缺的才是末尾月份 */
          tail: !late && x.lastMonth < end,
        };
      });
      /* A2：区间末净值日 = 各基金「末期净值日」里最早的那个 */
      ok.forEach((x) => { const d = x.lastDate || x.lastMonth; if (!asOf || d < asOf) asOf = d; });
      /* B2：实际首期月份（不是所选开始月） */
      let firstMonth = '';
      ok.forEach((x) => { if (!firstMonth || x.firstMonth < firstMonth) firstMonth = x.firstMonth; });
      return send(res, 200, JSON.stringify({
        ok: ok.length > 0, months: maxMonths, asOf, warning,
        start, end, limitMonth, limiter, limitDate, gaps, firstMonth,
        errors: out.filter((x) => x.error).map((x) => ({ id: x.id, error: x.error })),
        principal: Math.round(totalPrincipal), value: Math.round(totalValue), gain: Math.round(gain),
        rate: totalPrincipal ? Math.round((totalValue / totalPrincipal - 1) * 10000) / 100 : null,
        funds: out,
      }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }

  /* 2026-10-20：首页「自算榜前 5」专用轻量接口（避免为取 5 条下载 508KB 全量基金表） */
  if (p === '/api/top') {
    try {
      const key = u.searchParams.get('k') === 'y5a' ? 'y5a' : 'y1';
      const n = Math.max(1, Math.min(20, parseInt(u.searchParams.get('n') || '5', 10) || 5));
      const now = Date.now();
      if (!global.__topCache || now - global.__topCache.at > 60000) {
        const funds = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'funds.json'), 'utf8')).funds || [];
        const perf = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'nav-perf.json'), 'utf8')).funds || {};
        const byId = {};
        funds.forEach((f) => { byId[String(f.id)] = f; });
        const rows = [];
        Object.keys(perf).forEach((id) => {
          const p2 = perf[id];
          if (p2[key] == null) return;
          const f = byId[id];
          if (!f) return;
          rows.push({ id, fund: f.fund, fundBase: f.fundBase, unit: f.unit || '', scheme: f.scheme, trustee: f.trustee, y1: p2.y1, y5a: p2.y5a, asOf: p2.asOf });
        });
        global.__topCache = { at: now, rows };
      }
      const rows = global.__topCache.rows.slice().sort((a, b) => b[key] - a[key]).slice(0, n);
      return send(res, 200, JSON.stringify({ key, count: global.__topCache.rows.length, items: rows }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
  }

  if (p === '/api/news') {
    return fs.readFile(path.join(__dirname, 'data', 'news.json'), (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '资讯数据未生成' }));
      sendRaw(req, res, 200, buf.toString('utf8'), MIME['.json'], { cache: 'public, max-age=1800' });
    });
  }

  if (p === '/api/holdings') {
    /* 2026-10-20：支持 ?id= 单只查询（详情页只需 1 条，全量 433KB → 约 2KB） */
    const oneId = u.searchParams.get('id');
    const fp = path.join(__dirname, 'data', 'holdings.json');
    if (!oneId) return serveJsonFile(req, res, fp, { cache: 'public, max-age=3600' });
    return fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, JSON.stringify({ error: '持仓数据未生成' }));
      try {
        const all = JSON.parse(buf.toString('utf8'));
        LAST_GOOD_JSON.set(fp, buf);
        const one = (all.funds || {})[String(oneId)];
        return send(res, one ? 200 : 404, JSON.stringify({ funds: one ? { [String(oneId)]: one } : {}, updatedAt: all.updatedAt }));
      } catch (e) {
        /* 写入窗口内读到半截文件：回上一份完整数据，不把 500 抛给页面 */
        const last = LAST_GOOD_JSON.get(fp);
        if (last) {
          try {
            const all = JSON.parse(last.toString('utf8'));
            const one = (all.funds || {})[String(oneId)];
            return sendRaw(req, res, one ? 200 : 404, JSON.stringify({ funds: one ? { [String(oneId)]: one } : {}, updatedAt: all.updatedAt }), MIME['.json'], {
              cache: 'no-store', headers: { 'X-Data-Fallback': '1' },
            });
          } catch (e2) {}
        }
        return send(res, 503, JSON.stringify({ error: '数据正在更新，请稍后重试' }));
      }
    });
  }

  if (p === '/api/refresh') {
    /* 2026-10-24：自抓已关闭时不要再去连积金局（必超时 240s 且会部分写库），
       直接告诉调用方数据由本机推送 */
    if (!SELF_FETCH) {
      return send(res, 200, JSON.stringify({
        ok: true,
        skipped: true,
        origin: cache ? cache.origin : null,
        updatedAt: cache ? cache.updatedAt : null,
        count: cache ? cache.count : 0,
        message: '服务端自抓已关闭（部署环境无法直连积金局），数据由本机定时任务推送更新',
      }));
    }
    const force = u.searchParams.get('force') === '1';
    await refresh(force || true);
    if (!cache) return send(res, 503, JSON.stringify({ error: '刷新失败', detail: lastError }));
    return send(
      res,
      200,
      JSON.stringify({
        ok: true,
        updatedAt: cache.updatedAt,
        updatedAtText: new Date(cache.updatedAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Hong_Kong' }),
        count: cache.count,
        error: lastError,
      })
    );
  }

  if (p === '/api/hit' && req.method === 'POST') {
    /* 页面浏览打点：body {v: 匿名访客ID, p: home|idx|rank} */
    readBody(req, (b) => {
      try {
        const j = JSON.parse(b || '{}');
        analyticsBump(j.p === 'idx' || j.p === 'rank' ? j.p : 'home', null, j.v);
      } catch (e) {}
      send(res, 200, '{"ok":true}');
    });
    return;
  }

  if (p === '/api/event' && req.method === 'POST') {
    /* 事件打点：body {v: 匿名访客ID, e: export|share} */
    readBody(req, (b) => {
      try {
        const j = JSON.parse(b || '{}');
        if (j.e === 'export' || j.e === 'share') analyticsBump(null, j.e, j.v);
      } catch (e) {}
      send(res, 200, '{"ok":true}');
    });
    return;
  }

  if (p === '/api/analytics') {
    const days = Object.keys(analytics).sort().slice(-30).map((k) => {
      const a = analytics[k] || {};
      return {
        date: k,
        pv: Object.keys(a.pv || {}).reduce((x, y) => x + (a.pv[y] || 0), 0),
        uv: (a.vids || []).length,
        export: a.export || 0,
        share: a.share || 0,
      };
    });
    return send(res, 200, JSON.stringify({ today: days[days.length - 1] || null, days: days }));
  }

  /* 2026-10-21 性能：把公共 JS/CSS 合并成一个请求。
     线上沙箱每个请求 250–900ms，6 个资源串起来要 4s+；合并后 3 个请求。
     不落盘、按文件 mtime 拼装，改源码即时生效。 */
  if (p === '/b.js' || p === '/b.css') {
    const isJs = p === '/b.js';
    const page = u.searchParams.get('p') || 'analysis';
    const list = isJs
      ? ['i18n.js', 'zhmap.js', 'common.js', 'trend.js', 'xlsx.js']
      : (page === 'home' ? ['style.css', 'analysis.css', 'home.css'] : ['style.css', 'analysis.css']);
    try {
      const dir = path.join(__dirname, 'public');
      const body = list.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join(isJs ? '\n;\n' : '\n');
      return sendRaw(req, res, 200, body, isJs ? MIME['.js'] : MIME['.css'], { cache: 'public, max-age=600' });
    } catch (e) {
      return send(res, 500, 'bundle error: ' + e.message);
    }
  }

  if (p === '/api/status') {
    return send(
      res,
      200,
      JSON.stringify({
        build: '2026-10-13-an', // 部署版本标识（供验证「新代码是否已生效」）
        refreshing: refreshing,        // 诊断：是否有刷新在途
        /* 2026-10-26（用户要求）：更新进行中提示栏数据源（daily.sh 写盘） */
        updateStatus: (() => { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'update-status.json'), 'utf8')); } catch (e) { return null; } })(),
        refreshingSince: refreshingSince, // 诊断：本次刷新开始时刻
        hasData: !!cache,
        updatedAt: cache ? cache.updatedAt : null,
        updatedAtText: cache ? new Date(cache.updatedAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Hong_Kong' }) : '',
        dataAsOf: cache ? cache.dataAsOf || '' : '',
        count: cache ? cache.count : 0,
        unitRows: cache ? cache.unitRows || cache.count : 0,
        declaredTotal: cache ? cache.declaredTotal || 0 : 0,
        /* 数据版本徽标用：净值最新日（各发行人官网）+ 指数行情最新日（东方财富） */
        navLatest: (function () {
          let m = '';
          ((cache && cache.funds) || []).forEach((f) => { if (f.navAsOf && f.navAsOf > m) m = f.navAsOf; });
          return m;
        })(),
        histBackfilled: (function () {
          try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hist-index.json'), 'utf8')).count || 0; } catch (e) { return 0; }
        })(),
        indexAsOf: (function () {
          try {
            const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'index.json'), 'utf8'));
            let m = '';
            Object.keys(j.items || {}).forEach((k) => { const it = j.items[k]; if (it.asOf && it.asOf > m) m = it.asOf; });
            return m;
          } catch (e) { return ''; }
        })(),
        // 单位资产净值核对概况（供首页等轻量页面展示官方来源）
        navStat: cache
          ? cache.navStat || null
          : null,
        // 数据来自「服务端自抓」还是「本机推送」
        origin: cache ? cache.origin || 'server' : null,
        lastServerFetchOk: lastServerFetchOk,
        // 同步健康度（供外部核查者快速判断）：ok = 无来源告警且数据新鲜；degraded = 存在告警或数据偏旧
        syncStatus: (function () {
          if (!cache || !cache.count) return 'degraded';
          const alerts = (cache.navStat && cache.navStat.alerts) || [];
          const navAt = (cache.navStat && cache.navStat.navUpdatedAt) || cache.updatedAt || 0;
          const stale = Date.now() - navAt > 36 * 3600 * 1000;
          return (!alerts.length && !stale) ? 'ok' : 'degraded';
        })(),
        error: lastError,
      })
    );
  }

  // 本机推送接口：部署环境无法直连积金局官网时，由可联网的本机抓取后推送上来
  if (p === '/api/upload' && req.method === 'POST') {
    /* 2026-10-24 修 B04：设了 MPF_UPLOAD_TOKEN → 必须带对 token；
       未设 → 仅允许本机回环地址推送（公网调用一律 401），避免「未设变量=不设防」 */
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
    if (UPLOAD_TOKEN) {
      if (u.searchParams.get('token') !== UPLOAD_TOKEN) {
        return send(res, 401, JSON.stringify({ error: 'token 无效' }));
      }
    } else if (!isLoopback) {
      return send(res, 401, JSON.stringify({ error: '服务端未配置 MPF_UPLOAD_TOKEN，且非本机推送被拒绝' }));
    }
    /* 必须先把所有分块拼成 Buffer 再一次性解码：早期 `raw += c` 会对每个 TCP 分块
     * 单独做 UTF-8 解码，多字节汉字被分块切断时会被替换成 U+FFFD，污染基金/受托人名称。 */
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size > 40 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const j = JSON.parse(raw);
        /* 2026-10-23：支持「近端增量」上传（本机每日任务只推最后 N 天的净值 + 自算指标），
           服务端合并进 data/hist/<id>.json 与 data/nav-perf.json，避免整包 30MB 上传，
           也避免只推 funds 导致 funds/hist/navperf 三处不一致。 */
        if (j && j.histPatch && typeof j.histPatch === 'object') {
          let n = 0;
          Object.keys(j.histPatch).forEach((fid) => {
            if (!/^[0-9]+$/.test(fid)) return;
            const fp = path.join(__dirname, 'data', 'hist', fid + '.json');
            if (!fs.existsSync(fp)) return;
            try {
              const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
              const map = new Map((obj.series || []).map((x) => [x[0], x[1]]));
              (j.histPatch[fid] || []).forEach(([d, v]) => { if (d && isFinite(v)) map.set(d, v); });
              const arr = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
              obj.series = arr;
              obj.first = arr[0] ? arr[0][0] : obj.first;
              obj.asOf = arr.length ? arr[arr.length - 1][0] : obj.asOf;
              obj.last = arr.length ? arr[arr.length - 1][1] : obj.last;
              obj.points = arr.length;
              /* 2026-10-29（5.0）：临时文件 + rename，读者不会读到半截 JSON */
              writeJsonAtomic(fp, obj);
              n++;
            } catch (e) { /* 单只失败不影响其它 */ }
          });
          if (j.navperf && j.navperf.funds) {
            try { writeJsonAtomic(path.join(__dirname, 'data', 'nav-perf.json'), j.navperf); } catch (e) {}
          }
          console.log('[MPF] 已接收历史增量：' + n + ' 只');
        }
        if (!j || !Array.isArray(j.funds) || !j.funds.length) throw new Error('数据为空');
        cache = {
          updatedAt: Date.now(),
          source: SOURCE_URL,
          dataAsOf: j.dataAsOf || '',
          years: j.years || [],
          count: j.funds.length,
          /* 2026-10-22 修：上传体通常不带 units（本机只推 funds 缓存），
             直接取 (j.units||[]).length 会把 unitRows 写成 0 → 首页「成分基金 0 条」。
             优先用载荷自带值，其次沿用上一份缓存，最后按基金行数兜底。 */
          unitRows: j.unitRows || (j.units || []).length || (cache && cache.unitRows) || j.funds.length,
          declaredTotal: j.declaredTotal || null,
          navStat: j.navStat || null,
          funds: j.funds,
          origin: 'push',
        };
        lastError = null;
        saveSnapshot(cache);
        console.log('[MPF] 已接收本机推送：' + cache.count + ' 只基金 @ ' + new Date().toLocaleString('zh-CN'));
        return send(res, 200, JSON.stringify({ ok: true, count: cache.count, updatedAt: cache.updatedAt }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (p === '/api/probe') {
    // 口径核查接口：按官网 showType 参数抓取一次，返回行数与官网自标注总数
    const { scrapeShow } = require('./scraper');
    const st = u.searchParams.get('st') || 'Selected';
    try {
      const r = await scrapeShow(st);
      return send(res, 200, JSON.stringify({ showType: st, parsed: r.funds.length, declaredTotal: r.declaredTotal, dataAsOf: r.dataAsOf }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ showType: st, error: e.message }));
    }
  }

  // 静态文件（首页为公司介绍页）
  let file = p === '/' ? '/home.html' : p;
  file = path.normalize(file).replace(/^([/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return sendRaw(req, res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  // 以「_」开头的文件一律不外发（调试/临时页面专用），避免把内部页面暴露给客户
  if (path.basename(file).charAt(0) === '_') {
    return sendRaw(req, res, 404, 'Not Found', 'text/plain; charset=utf-8');
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      // 带扩展名却找不到的一律 404；无扩展名的未知路径返回 404 页面（此前为 200 首页，SEO 语义不规范）
      const looksLikeFile = /\.[a-z0-9]{2,5}$/i.test(file);
      if (looksLikeFile) return sendRaw(req, res, 404, 'Not Found', 'text/plain; charset=utf-8');
      fs.readFile(path.join(PUBLIC_DIR, '404.html'), (e2, b2) => {
        if (e2) return sendRaw(req, res, 404, 'Not Found', 'text/plain; charset=utf-8');
        sendRaw(req, res, 404, b2.toString('utf8').replace(/\?v=[0-9a-zA-Z.]+/g, '?v=' + ASSET_V), MIME['.html'], { cache: 'no-cache' });
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    // 静态资源缓存：HTML 每次校验；图片/字体 30 天；样式脚本 7 天。
    // 样式脚本已由页面引用加 ?v=版本号（部署更新时同步变更），因此可放心长缓存、更新仍即时生效。
    // （7 天而非 1 年，作为「万一忘记更新版本号」的兜底）
    const cache = ext === '.html' ? 'no-cache'
      : (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.svg' || ext === '.ico' || ext === '.woff2')
        ? 'public, max-age=2592000'
        : 'public, max-age=604800';
    if (ext === '.html') {
      // HTML 内的 ?v= 版本号动态替换（见 ASSET_V 注释）——每次部署后自动失效旧缓存
      const html = buf.toString('utf8').replace(/\?v=[0-9a-zA-Z.]+/g, '?v=' + ASSET_V);
      return sendRaw(req, res, 200, html, MIME['.html'], { cache: 'no-cache' });
    }
    sendRaw(req, res, 200, buf, MIME[ext] || 'application/octet-stream', { cache: cache });
  });
});

server.listen(PORT, async () => {
  console.log('[MPF] 服务启动于端口 ' + PORT);
  /* 2026-10-29（5.0）：预热关键数据文件的「上一份可用副本」，
     让首次请求撞上写盘窗口时也有兜底，不会返回 500/空模块 */
  warmJsonCache();
  // 先用上一次从积金局官网抓取的快照兜底，保证页面打开即有数据，再后台拉取最新
  if (!cache) cache = loadSnapshot();
  if (cache) console.log('[MPF] 已载入本地快照：' + cache.count + ' 只基金');
  /* 2026-10-24（核验报告 v3 #2，领导确认）：关闭服务端自抓。
     根因：部署环境连不上积金局 mfp.mpfa.org.hk，refresh() 必超时（240s），
     且超时前会把抓到的部分结果写盘 → funds / hist / nav-perf 三处版本不同步，
     还会覆盖掉本机已修好的数据（10-24 凌晨回退 146 / 603 即此因）。
     现在数据一律由本机 push.js 推送；服务端只读本地快照。
     临时需要自抓时：设环境变量 MPF_SELF_FETCH=1。 */
  if (SELF_FETCH) {
    setTimeout(() => { refresh(true); }, 8000);
    setInterval(() => refresh(true), REFRESH_MS);
    // 每 10 分钟检查一次，若过期则补抓（防止定时刷新失败后长时间不更新）
    setInterval(() => refresh(false), 10 * 60 * 1000);
    scheduleNavUpdate();
    scheduleHoldingsCheck();
    console.log('[MPF] 服务端自抓已开启（MPF_SELF_FETCH=1）');
  } else {
    console.log('[MPF] 服务端自抓已关闭：数据由本机 push 推送，服务端只读快照');
  }
});

/* ---------- 近端缺日自动补抓 ---------- */
function runGapFix(write) {
  const { spawn, execFile } = require('child_process');
  const nodeBin = process.execPath;
  return new Promise((resolve) => {
    execFile(nodeBin, ['tools/gap-check.js', '--json'], { cwd: __dirname, timeout: 60000 }, (err, stdout) => {
      if (err || !stdout) { write('缺日巡检失败：' + (err && err.message)); return resolve(); }
      let j;
      try { j = JSON.parse(stdout); } catch (e) { return resolve(); }
      const list = (j.gaps || []).filter((g) => g.cmd && g.cmd.length);
      write('缺日：' + list.length + ' 个计划待补（' + (j.recent || []).slice(-1)[0] + '）');
      if (!list.length) return resolve();
      /* 逐个补抓：python 不可用时记录并跳过（沙箱可能没有 python，此时靠本机 daily 任务） */
      const py = process.env.MPF_PY || 'python';
      let i = 0;
      const next = () => {
        if (i >= list.length) return resolve();
        const g = list[i++];
        const p = spawn(py, g.cmd, { cwd: __dirname });
        p.on('close', (code) => { write('  补抓 ' + g.scheme + ' 退出码 ' + code); next(); });
        p.on('error', () => { write('  补抓 ' + g.scheme + ' 失败（python 不可用）'); next(); });
      };
      next();
    });
  });
}

/* ---------- 季度持仓刷新（服务内定时，每 6 小时检查一次） ---------- */
function scheduleHoldingsCheck() {
  const { spawn } = require('child_process');
  const fs2 = require('fs');
  const log = path.join(__dirname, 'data', 'holdings-update.log');
  const MARK = path.join(__dirname, 'data', '.holdings-lastrun');
  const stamp = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  let lastRun = '';
  try { lastRun = fs2.readFileSync(MARK, 'utf8').trim(); } catch (e) {}

  /* 完整性判断：≥90% 的基金，报告期已到「上一个季度末」附近（允许晚 100 天，照顾年更计划） */
  function holdingsComplete() {
    try {
      const h = JSON.parse(fs2.readFileSync(path.join(__dirname, 'data', 'holdings.json'), 'utf8'));
      const list = Object.values(h.funds || {}).filter((x) => x && x.asOf);
      if (!list.length) return false;
      const hk = new Date(Date.now() + 8 * 3600e3);
      const t = new Date(Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), 0));  // 上月末（=上季度末）
      const cut = new Date(t.getTime() - 100 * 864e5).toISOString().slice(0, 10);
      const ok = list.filter((x) => x.asOf >= cut).length;
      return ok / list.length >= 0.9;
    } catch (e) { return false; }
  }

  function check() {
    try {
      const hk = new Date(Date.now() + 8 * 3600e3);
      const y = hk.getUTCFullYear(), m = hk.getUTCMonth(), d = hk.getUTCDate();
      const monthInQ = m % 3;                 // 0=季度后第 1 个月，1=第 2 个月，2=季末月
      if (monthInQ === 2) return;             // 季末月不跑
      /* 2026-10-23（领导）：每季度多次尝试——次月 5/10/15/20/25/30 日；
         若仍未更新完，次次月同样节奏继续，直到数据补齐为止 */
      const DAYS = [5, 10, 15, 20, 25];
      const okDay = DAYS.indexOf(d) >= 0 || d >= 28;
      if (!okDay) return;
      if (holdingsComplete()) return;         // 已补齐就不再打扰
      const key = y + '-' + (m + 1) + '-' + d;
      if (lastRun === key) return;            // 同一天只跑一次
      if (!fs2.existsSync(path.join(__dirname, 'tools', 'quarterly.sh'))) return;
      lastRun = key;
      try { fs2.writeFileSync(MARK, key); } catch (e) {}
      fs2.appendFileSync(log, '[' + stamp() + '] 触发季度持仓刷新（第 ' + (monthInQ + 1) + ' 个月，' + d + ' 日）\n');
      const p = spawn('bash', ['tools/quarterly.sh'], { cwd: __dirname, detached: false });
      p.on('close', (code) => {
        fs2.appendFileSync(log, '[' + stamp() + '] 季度刷新结束，退出码 ' + code + '\n');
      });
      p.on('error', () => {});
    } catch (e) {}
  }
  check();
  setInterval(check, 6 * 3600 * 1000);
}

/* ---------- 每日净值更新（服务内定时） ---------- */
let navTimer = null;
/* 距下一个香港时间 hh:mm 的毫秒数（2026-10-23 修：原实现把 +8h 后的时间再 setUTCHours，
   算出来的等待时间完全不对 —— 曾出现「距 22:30 还有 90 分钟」） */
function msToNextHK(hh, mm) {
  const now = Date.now();
  const hk = new Date(now + 8 * 3600e3);
  const t = Date.UTC(hk.getUTCFullYear(), hk.getUTCMonth(), hk.getUTCDate(), hh, mm, 0, 0) - 8 * 3600e3;
  return (t > now ? t : t + 24 * 3600e3) - now;
}
function scheduleNavUpdate() {
  if (navTimer) clearTimeout(navTimer);
  const wait = msToNextHK(22, 30);
  navTimer = setTimeout(async () => {
    await runNavUpdate('定时');
    scheduleNavUpdate();
  }, wait);
  console.log('[MPF] 每日净值更新已排程：' + Math.round(wait / 60000) + ' 分钟后（香港时间 22:30）');
}

function runNavUpdate(why) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const nodeBin = process.execPath;
    const fs2 = require('fs');
    const log = path.join(__dirname, 'data', 'nav-update.log');
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
    const write = (t) => { try { fs2.appendFileSync(log, '[' + stamp + '] ' + t + '\n'); } catch (e) {} };
    /* 2026-10-23：沙箱里没有 Chrome（navbuild 依赖本机 Chrome 渲染发行人页面），
       这种情况下不启动，避免每晚留下误导性的失败日志；数据改由本机定时任务 push 上来。 */
    const CHROME_PATHS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
    if (!CHROME_PATHS.some((x) => { try { return fs2.existsSync(x); } catch (e) { return false; } })) {
      write('跳过：本环境无 Chrome，改为由本机定时任务推送数据');
      return resolve();
    }
    write('开始（' + why + '）');
    const p1 = spawn(nodeBin, ['navbuild.js', '--render'], { cwd: __dirname });
    p1.on('close', (code) => {
      write('navbuild 退出码 ' + code);
      const p2 = spawn(nodeBin, ['tools/merge-nav.js'], { cwd: __dirname });
      p2.on('close', (code2) => {
        write('merge-nav 退出码 ' + code2);
        /* 2026-10-23：抓完净值后重算自算指标，避免 vol3/d1 等在刷新窗口内不一致（核验报告 #9） */
        const p3 = spawn(nodeBin, ['navperf.js'], { cwd: __dirname });
        p3.on('close', (code3) => {
          write('navperf 退出码 ' + code3);
          const p4 = spawn(nodeBin, ['tools/merge-nav.js'], { cwd: __dirname });
          p4.on('close', (code4) => {
            write('二次 merge-nav 退出码 ' + code4);
            /* 2026-10-23：抓完立刻做「近端缺日」巡检，缺哪家就补哪家（杜绝富达/海通漏 3 天那类问题） */
            runGapFix(write).then(() => { write('缺日巡检与补抓完成'); resolve(); });
          });
          p4.on('error', () => resolve());
        });
        p3.on('error', () => resolve());
      });
      p2.on('error', () => resolve());
    });
    p1.on('error', () => resolve());
  });
}

module.exports = server;
