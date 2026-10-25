/**
 * 本机抓取积金局官网 → 推送到已部署的线上站点
 *
 * 用途：部署服务器所在机房无法直连 mfp.mpfa.org.hk 时，
 *       由能联网的本机完成抓取，再 POST 给线上 /api/upload 更新缓存。
 *
 * 用法：
 *   node push.js                         # 推送到默认线上地址
 *   node push.js https://xxx /api token  # 自定义
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scrape } = require('./scraper');

/* 2026-10-19：线上域名每次重新部署都会变，统一读 site-url.txt（部署后自动/手动更新）；
   仍可用 MPF_SITE 环境变量临时覆盖。 */
const SITE = process.env.MPF_SITE || (function () {
  try { return fs.readFileSync(path.join(__dirname, 'site-url.txt'), 'utf8').trim(); }
  catch (e) { return 'https://81bbe1a1d5b04dfc8261618f1198c149.sg2.agentos-app.run'; }
})();
const TOKEN = process.argv[3] || process.env.MPF_UPLOAD_TOKEN
  || (() => { try { return fs.readFileSync(path.join(__dirname, 'data', 'upload-token.txt'), 'utf8').trim(); } catch (e) { return ''; } })();  /* 2026-10-25：token 移入 git 忽略的本地文件 */
const DATA_FILE = path.join(__dirname, 'data', 'funds.json');

function postJSON(url, obj) {
  return new Promise((resolve, reject) => {
    const { URL } = require('url');
    const http = require('http');
    const https = require('https');
    const U = new URL(url);
    /* 传输层防护：服务端用 `raw += chunk` 逐块解码 UTF-8，若多字节字符正好被 TCP 分块
     * 切断，会被替换成 U+FFFD（实测把「銀聯信託」变成「銀聯\uFFFD\uFFFD託」，导致受托人
     * 数从 11 家虚增为 12 家、计划数从 24 个虚增为 25 个）。
     * 这里把请求体统一转义为纯 ASCII（\uXXXX），JSON.parse 可无损还原，从根本上杜绝分块解码问题。 */
    const json = JSON.stringify(obj).replace(
      /[\u007f-\uffff]/g,
      (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    );
    const body = Buffer.from(json, 'utf8');
    const mod = U.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: U.hostname,
        port: U.port || (U.protocol === 'https:' ? 443 : 80),
        path: U.pathname + U.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
        },
        timeout: 120000,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('推送超时'));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * 刷新单位资产净值：
 * navbuild.js --render 会用本机 Chrome 重新打开各受托人／保荐人官网的基金价格页，
 * 重新解析出 data/nav.json。若本机无 Chrome 或任一站点超时，则沿用上一次的 nav.json，
 * 保证净值只会「更新或保持不变」，绝不会退化为一堆空值。
 */
function refreshNav() {
  if (process.argv.includes('--no-nav')) {
    /* 关键：--no-nav 只跳过「重新打开官网抓页面」（navfetch 已完成），但必须解析已抓取的
       源文件重建 nav.json —— 否则 navfetch 抓了新页面而净值仍是旧解析结果（历史缺陷）。 */
    console.log('[push] 已指定 --no-nav：跳过官网重抓，改为解析已抓取的源文件重建 nav.json…');
    try {
      const navbuild = require(path.join(__dirname, 'navbuild.js'));
      navbuild.build();
      console.log('[push] 净值已按已抓源文件重建 data/nav.json');
    } catch (e) {
      console.error('[push] nav.json 重建失败（沿用上一次核对结果）：' + e.message);
    }
    return false;
  }
  console.log('[push] 正在到各受托人／保荐人官网核对最新单位资产净值…');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'navbuild.js'), '--render'], {
      stdio: 'inherit',
      timeout: 25 * 60 * 1000,
    });
    console.log('[push] 净值核对完成');
    return true;
  } catch (e) {
    console.error('[push] 净值刷新未完成，沿用上一次核对结果：' + e.message);
    return false;
  }
}

(async () => {
  refreshNav();

  /* 2026-10-17：etnet 环富通当日净值（覆盖富达/海通/东亚/万通/AMTD 108 只）*/
  try {
    const pyCands = [process.env.MPF_PY, 'C:/Users/11718/.workbuddy/binaries/python/envs/default/Scripts/python.exe', 'C:/Users/11718/AppData/Local/Programs/Python/Python314/python.exe', 'python'];
    let ran = false;
    for (const py of pyCands) {
      if (!py) continue;
      try {
        require('child_process').execFileSync(py, [path.join(__dirname, 'nav-etnet.py')], { stdio: 'inherit', timeout: 10 * 60 * 1000 });
        ran = true; break;
      } catch (e) { if (py === pyCands[pyCands.length - 1]) throw e; }
    }
    if (!ran) console.log('[push] etnet 源跳过（未找到 python）');
  } catch (e) {
    console.error('[push] etnet 净值刷新失败（沿用上次）：' + e.message);
  }

  /* 2026-10-19：BCT 基金便覽自动发现（按官方命名规律枚举季度/月度 PDF，无需人工给链接）
     —— 每季度更新后自动补入持仓，失败不阻断主流程 */
  try {
    const pyCands2 = [process.env.MPF_PY, 'C:/Users/11718/.workbuddy/binaries/python/envs/default/Scripts/python.exe', 'python'];
    for (const py of pyCands2) {
      if (!py) continue;
      try {
        require('child_process').execFileSync(py, [path.join(__dirname, 'bct_ffs_auto.py')], { stdio: 'inherit', timeout: 25 * 60 * 1000 });
        break;
      } catch (e) { if (py === pyCands2[pyCands2.length - 1]) throw e; }
    }
  } catch (e) {
    console.error('[push] BCT 自动发现失败（沿用上次）：' + e.message);
  }

  /* 2026-10-19：東亞（BEA）全量日度 —— 官网 GetMPFData 一次返回三个计划的全历史单位价格
     （40 只、2000-12 起），每跑一次即把最新一天补进 data/hist，失败不阻断主流程 */
  try {
    const pyCands3 = [process.env.MPF_PY, 'C:/Users/11718/.workbuddy/binaries/python/envs/default/Scripts/python.exe', 'python'];
    for (const py of pyCands3) {
      if (!py) continue;
      try {
        require('child_process').execFileSync(py, [path.join(__dirname, 'fetch-bea-hist.py')], { stdio: 'inherit', timeout: 10 * 60 * 1000 });
        break;
      } catch (e) { if (py === pyCands3[pyCands3.length - 1]) throw e; }
    }
  } catch (e) {
    console.error('[push] 東亞全量日度刷新失败（沿用上次）：' + e.message);
  }

  /* 历史净值更新后重算自算指标（d1/ytd/y1/y3a/y5a/回撤 + 发行人平均指数） */
  try {
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'navperf.js')], { stdio: 'inherit', timeout: 5 * 60 * 1000 });
  } catch (e) {
    console.error('[push] navperf 重算失败（沿用上次）：' + e.message);
  }

  console.log('[push] 正在从积金局官网抓取最新数据…');
  const r = await scrape();
  if (!r.funds || !r.funds.length) throw new Error('抓取结果为空，终止推送');
  console.log('[push] 抓到 ' + r.funds.length + ' 只基金，资料截至 ' + (r.dataAsOf || '未知'));

  // 1) 更新本地快照（重新部署时的兜底数据）
  try {
    const snap = {
      updatedAt: Date.now(),
      source: r.source || 'https://mfp.mpfa.org.hk/tch/mpp_list.jsp',
      dataAsOf: r.dataAsOf || '',
      years: r.years,
      count: r.funds.length,
      unitRows: (r.units || []).length,
      declaredTotal: r.declaredTotal || null,
      navStat: r.navStat || null,
      funds: r.funds,
    };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(snap));
    console.log('[push] 本地快照已更新: data/funds.json');
  } catch (e) {
    console.error('[push] 写本地快照失败:', e.message);
  }

  // 2) 推送到线上
  const url = SITE.replace(/\/$/, '') + '/api/upload' + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '');
  console.log('[push] 推送到 ' + SITE + ' …');
  /* 2026-10-23：同时推送「近 10 天历史增量 + 自算指标」，让线上的 funds/hist/navperf
     三处保持同步（否则只推 funds 会出现三处日期不一致，正是核验方反复提的问题）。 */
  const histPatch = {};
  try {
    const HIST = path.join(__dirname, 'data', 'hist');
    fs.readdirSync(HIST).forEach((f) => {
      if (!f.endsWith('.json')) return;
      try {
        const o = JSON.parse(fs.readFileSync(path.join(HIST, f), 'utf8'));
        const tail = (o.series || []).slice(-10);
        if (tail.length) histPatch[f.replace('.json', '')] = tail;
      } catch (e) {}
    });
  } catch (e) {}
  let navperf = null;
  try { navperf = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'nav-perf.json'), 'utf8')); } catch (e) {}

  const res = await postJSON(url, {
    dataAsOf: r.dataAsOf || '',
    years: r.years || [],
    units: r.units || [],
    declaredTotal: r.declaredTotal || null,
    navStat: r.navStat || null,
    funds: r.funds,
    histPatch,
    navperf,
  });
  console.log('[push] 线上响应 ' + res.status + ': ' + res.body.slice(0, 300));
  if (res.status !== 200) process.exitCode = 1;

  // 每日摘要（时间序列数据基础）：每次同步后记录一条当日摘要，日后可用于回看/对比历史
  try {
    const LOG = path.join(__dirname, 'data', 'daily-log.json');
    let log = [];
    try { log = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch (e) { log = []; }
    if (!Array.isArray(log)) log = [];
    const day = new Date().toISOString().slice(0, 10);
    const a1 = r.funds.map((f) => f.ann1).filter((v) => v != null);
    const avg1 = a1.length ? a1.reduce((a, b) => a + b, 0) / a1.length : null;
    const entry = {
      date: day,
      syncAt: new Date().toISOString(),
      count: r.funds.length,
      dataAsOf: r.dataAsOf || '',
      navVerified: (r.navStat && r.navStat.verified) || 0,
      navNa: (r.navStat && r.navStat.na) || 0,
      avgAnn1: avg1 == null ? null : Math.round(avg1 * 100) / 100,
    };
    const i = log.findIndex((x) => x && x.date === day);
    if (i >= 0) log[i] = entry; else log.push(entry);
    fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
    console.log('[push] 每日摘要已记录：' + day + '（累计 ' + log.length + ' 天）');
  } catch (e) { console.error('[push] 每日摘要写入失败: ' + e.message); }

  // 每日净值快照：把全部基金当日净值逐日留存（data/nav-history/YYYY-MM-DD.json）。
  // 用途：积累全市场（451 条）的逐日净值序列 —— 「日涨跌幅 / 各区间涨幅 / 排名自算」
  // 目前先接入宏利系 67 只历史（fetch-manulife-hist.py），其余来源靠本快照逐日补齐。
  try {
    const DIR = path.join(__dirname, 'data', 'nav-history');
    fs.mkdirSync(DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const map = {};
    r.funds.forEach((f) => { if (f.nav != null) map[f.id] = [f.nav, f.navAsOf || '']; });
    fs.writeFileSync(path.join(DIR, day + '.json'),
      JSON.stringify({ date: day, syncAt: new Date().toISOString(), count: Object.keys(map).length, items: map }));
    console.log('[push] 净值快照已记录：data/nav-history/' + day + '.json（' + Object.keys(map).length + ' 条）');
  } catch (e) { console.error('[push] 净值快照写入失败: ' + e.message); }
})().catch((e) => {
  console.error('[push] 失败:', e.message);
  process.exitCode = 1;
});
