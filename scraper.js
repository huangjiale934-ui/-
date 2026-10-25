/**
 * 香港强制性公积金计划管理局（积金局 MPFA）强积金基金平台 数据抓取器
 * 唯一数据源：https://mfp.mpfa.org.hk/tch/mpp_list.jsp （积金局官网）
 * 版权与数据准确性：所有数值一律照搬官网「基金资讯表」，不做任何加工估算。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const pathmod = require('path');
const { URL } = require('url');

const NAV_FILE = pathmod.join(__dirname, 'data', 'nav.json');

// 注意：积金局官网现已强制 HTTPS（http 会返回 302 跳到 https），必须使用 https
const SOURCE_URL = 'https://mfp.mpfa.org.hk/tch/mpp_list.jsp';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 支持标准 http_proxy / HTTP_PROXY 环境变量（部分网络环境下直连不可达）
const PROXY =
  process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY || '';

/**
 * 抓取策略：先直连，失败后若配置了代理再走代理（直连在多数网络下可用且更稳定）
 */
function fetchText(url, redirects = 5, viaProxy) {
  const u = new URL(url);
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    Connection: 'close',
  };

  // 走代理：使用「绝对 URI」形式的正向代理请求
  if (viaProxy && PROXY) {
    const p = new URL(PROXY);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: p.hostname,
          port: p.port || 80,
          path: u.href,
          method: 'GET',
          headers: Object.assign({}, headers, { Host: u.host }),
          timeout: 45000,
        },
        (res) => handle(res, resolve, reject, url, redirects, true)
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers,
        timeout: 45000,
      },
      (res) => handle(res, resolve, reject, url, redirects, viaProxy)
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function handle(res, resolve, reject, url, redirects, viaProxy) {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
    res.resume();
    return resolve(fetchText(new URL(res.headers.location, url).href, redirects - 1, viaProxy));
  }
  if (res.statusCode !== 200) {
    res.resume();
    return reject(new Error('HTTP ' + res.statusCode));
  }
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
}

const stripTags = (s) =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

// "最高 0.68" / "0.14" / "不適用" / "n.a."
function num(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t || t === 'n.a.' || t === '不適用' || t === '-' || t === 'N/A') return null;
  const m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 费用解析（2026-10-10）。官网费用列有三种形式：
 *   「1.18 - 1.92」区间 ／ 「最高 0.68」上限式 ／ 单一值（含「每年資產淨值的0.75%」这类文字）。
 * 旧版 num() 会把区间截断成下限（丢上限）；现改为保留区间信息：
 *   { v: 区间取下限（与旧版一致，兼容既有字段）, min, max }
 *   { v: x, max: x, cap: true }（「最高 x」）
 *   { v: x }（单值） / { v: null }（不適用/空）
 * 注意：v 的取值与旧版完全一致，保证除新增 feeMore 外不引入任何数值变化。
 */
function fee(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t || t === 'n.a.' || t === '不適用' || t === '-' || t === 'N/A') return { v: null };
  const rng = t.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (rng) return { v: parseFloat(rng[1]), min: parseFloat(rng[1]), max: parseFloat(rng[2]) };
  const cap = t.match(/^最高\s*(\d+(?:\.\d+)?)/);
  if (cap) return { v: parseFloat(cap[1]), max: parseFloat(cap[1]), cap: true };
  const n = num(t);
  return n == null ? { v: null } : { v: n };
}

function cells(rowHtml) {
  const out = [];
  const re = /<td\b[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(rowHtml))) out.push(stripTags(m[1]));
  return out;
}

function rowMeta(rowHtml) {
  const cfid = /cfid=["']\s*([\d]+)\s*["']/.exec(rowHtml);
  const sch = /schId=([A-Z0-9]+)/i.exec(rowHtml);
  const chk = /name="sortlist_checkbox"[^>]*value="\s*([\d]+)\s*"/.exec(rowHtml);
  return {
    cfId: cfid ? cfid[1] : chk ? chk[1] : '',
    schId: sch ? sch[1] : '',
  };
}

/**
 * 抓取并解析积金局「基金资讯表」全部基金
 */
function fetchPost(url, data, redirects = 5) {
  const u = new URL(url);
  // 表单序列化：数组展开为重复键（JSP getParameterValues 需要）
  const parts = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) v.forEach((x) => parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(x)));
    else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  const body = parts.join('&');
  const headers = Object.assign(
    {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      Referer: 'http://mfp.mpfa.org.hk/tch/mpp_list.jsp',
    },
    { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
  );

  if (PROXY && u.protocol === 'http:') {
    const p = new URL(PROXY);
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: p.hostname, port: p.port || 80, path: u.href, method: 'POST', headers: Object.assign({}, headers, { Host: u.host }), timeout: 45000 },
        (res) => handle(res, resolve, reject, url, redirects)
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'POST', headers, timeout: 45000 },
      (res) => handle(res, resolve, reject, url, redirects)
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const ALL_FUND_TYPES = ['2', '4', '1', '3', '5', '6'];
const BASE_FORM = {
  showRisk: 'CLASS',
  tabControl: 'G',
  sort_field: '',
  sort_type: '',
  isLowFeeFundList: '',
  isDisFundLists: '',
  fundTypes: ALL_FUND_TYPES,
};

// 按官网筛选参数抓取（showType: 'All' | 'Selected' | ''），用于校验官网口径
async function scrapeShow(showType) {
  const form = { showType: showType || '', ...BASE_FORM };
  const html = await fetchPost(SOURCE_URL, form);
  const r = parse(html);
  const dm = /已選擇的成分基金總數:\s*(\d+)/.exec(html);
  r.declaredTotal = dm ? parseInt(dm[1], 10) : null; // 官网页面自己标注的数量
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 带重试的抓取（积金局官网偶有超时/限流）
async function scrape(opts) {
  const skipNav = opts && opts.skipNav;
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      // 第 1、2 次直连，第 3 次若仍失败且配置了代理则改走代理
      const viaProxy = i === 2 && !!PROXY;
      const html = await fetchText(SOURCE_URL, 5, viaProxy);
      const r = parse(html);
      if (r.funds.length) {
        const dm = /已選擇的成分基金總數:\s*(\d+)/.exec(html);
        r.declaredTotal = dm ? parseInt(dm[1], 10) : null;

        // 本站以积金局表格每一行（即每一个「单位类别」）为一条基金条目，共 451 条，
        // 完整覆盖官网表格内容、不做任何删减。
        // 另按「受托人 + 計劃 + 基金主名 + 基金類別」歸併出 382 個成分基金分組，
        // 用于说明官网顶部「已選擇的成分基金總數: 382」的由来。
        const groups = mergeUnits(r.funds);
        r.groups = groups.length;
        annotateUnitGroups(r.funds, groups);
        r.units = r.funds;

        // 单位资产净值：积金局表格不提供此列，须从各发行人官网取得最新公布值。
        // 未取到的条目一律保持「待核实」，绝不沿用旧数据或估算数值。
        r.navStat = attachNav(r.funds);
        return r;
      }
      err = new Error('解析结果为空');
    } catch (e) {
      err = e;
    }
    if (i < 2) await sleep(3000 * (i + 1)); // 3s / 6s 退避
  }
  throw err;
}

/* ------------------------------------------------------------------
 * 单位资产净值回填
 * data/nav.json 由 navbuild.js 逐家到计划保荐人官网读取后生成。
 * 只回填能精确匹配到官网基金名的条目，其余标记为「待核实」。
 * ------------------------------------------------------------------ */
/* 2026-10-21：受托人名称统一为繁体官方名（积金局原文为繁体，个别条目被抓成简体） */
const TRUSTEE_FIX = { '渣打信托': '渣打信託', '渣打信托有限公司': '渣打信託' };
function fixTrustee(t) { return TRUSTEE_FIX[String(t || '').trim()] || t; }

function navKey(s) {
  return String(s == null ? '' : s)
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    // 各类连字符统一消除，避免「信安 - 基金」与「信安 – 基金」被判为两个名字
    .replace(/[\u2010-\u2015\u2027\u2043\uFE58\uFE63\uFF0D\-－—–－]/g, '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .replace(/[*#＊·.．]/g, '')
    .toLowerCase();
}

function attachNav(funds) {
  const stat = { total: funds.length, verified: 0, unmatched: 0, pending: 0, sources: [], navUpdatedAt: 0 };
  let nj = null;
  try {
    if (fs.existsSync(NAV_FILE)) nj = JSON.parse(fs.readFileSync(NAV_FILE, 'utf8'));
  } catch (e) {
    nj = null;
  }
  if (!nj || !nj.items || !nj.items.length) {
    funds.forEach((f) => {
      f.nav = null; f.navAsOf = ''; f.navSource = ''; f.navSourceUrl = ''; f.navStatus = 'pending';
    });
    stat.pending = funds.length;
    return stat;
  }
  stat.sources = nj.sources || [];
  stat.navUpdatedAt = nj.updatedAt || 0;
  // 来源失效告警：由 navbuild 在每次核对时与上一次对比生成（条数归零/骤降）
  stat.alerts = nj.alerts || [];

  const idx = {};
  nj.items.forEach((it) => {
    (idx[it.scheme] = idx[it.scheme] || []).push(it);
  });
  const used = new Set();

  for (const f of funds) {
    const list = idx[f.scheme];
    if (!list) { f.navStatus = 'unmatched'; continue; }
    const nb = navKey(f.fundBase);
    const nu = navKey(f.unit);
    // 先按「基金主名」取候选，再按单位类别精确挑选；候选多于一个且无法判别单位时不猜值
    let cands = list.filter((x) => navKey(x.fund) === nb);
    if (!cands.length) {
      cands = list.filter((x) => {
        const nn = navKey(x.fund);
        return nn && (nn.indexOf(nb) >= 0 || nb.indexOf(nn) >= 0);
      });
    }
    let hit = null;
    if (cands.length === 1) {
      hit = cands[0];
    } else if (cands.length > 1) {
      if (f.unit) hit = cands.find((x) => navKey(x.unit || '') === nu) || null;
      else hit = cands.find((x) => !x.unit) || null;
    }
    if (hit) {
      f.nav = hit.nav == null ? null : hit.nav;
      f.navAsOf = hit.asOf || '';
      f.navSource = hit.src || '';
      /* 2026-10-23：BCT 的净值接口地址不能当"官方页面核对"链接（点开是 JSON），
         统一换成 BCT 官方「基金價格」页；其它受托人沿用各自的 srcUrl。 */
      let srcUrl = hit.srcUrl || '';
      if (/bcthk\.com\/bin\/servlet/i.test(srcUrl)) srcUrl = 'https://www.bcthk.com/tc/mpf/fund-price';
      f.navSourceUrl = srcUrl;
      f.navStatus = hit.na ? 'na' : 'verified';
      used.add(hit);
      if (hit.na) stat.na = (stat.na || 0) + 1; else stat.verified++;
    } else {
      f.nav = null;
      f.navAsOf = '';
      f.navSource = '';
      f.navSourceUrl = '';
      f.navStatus = 'unmatched';
    }
  }
  stat.na = stat.na || 0;
  stat.unmatched = funds.length - stat.verified - stat.na;
  return stat;
}

function parse(html) {
  if (!/mpp_list|基金資訊表|MCF_ANN_RETURN_1/.test(html)) {
    throw new Error('返回的页面不是积金局基金资讯表（可能被拦截或改版）');
  }

  // 表头：读取历年回报的年份标签，确保年份与数据列严格对齐
  let years = [];
  const theadM = /<thead[^>]*>([\s\S]*?)<\/thead>/.exec(html);
  if (theadM) {
    const cyRe = /<td[^>]*class="[^"]*cyrCol[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
    let ym;
    while ((ym = cyRe.exec(theadM[1]))) {
      const txt = stripTags(ym[1]);
      if (/^\d{4}$/.test(txt)) years.push(txt);
    }
  }

  // 数据行：直接匹配基金资讯表的数据行（<tr class="wr" ...>）
  const rowBlocks = [];
  const rre = /<tr\b[^>]*class="wr"[^>]*>([\s\S]*?)<\/tr>/g;
  let rm;
  while ((rm = rre.exec(html))) rowBlocks.push(rm[0]);
  if (!rowBlocks.length) throw new Error('未能解析出任何基金数据行');

  const funds = [];
  const seen = new Set();
  for (const raw of rowBlocks) {
    const c = cells(raw);
    if (c.length < 24) continue;
    const meta = rowMeta(raw);

    // 列序（严格对齐积金局「基金资讯表」HTML 列顺序）
    const scheme = c[1] || '';
    const fundName = c[3] || '';
    const trustee = c[4] || '';
    const typeFull = c[5] || '';
    const launch = c[6] || '';
    // ⚠️ 重要更正（2026-10-08 核实）：积金局「基金资讯表」並無「單位資產淨值」列，
    //    全文检索「單位資產淨值」出现 0 次。第 9 列的真实含义是「最近期基金開支比率 (%)」。
    //    证据：该列均值 1.2158%，与页面顶部标注「平均基金開支比率 = 1.34%」吻合；
    //          且第 8 列取值仅为 1–7 的整数（风险级别），两者互不冲突。
    //    单位资产净值必须另行从各发行人（基金管理人／受托人）官网取得。
    const size = num(c[7]);
    const risk = num(c[8]);
    const fer = num(c[9]); // 最近期基金開支比率 (%)  ← 曾被误当作净值，已更正

    const ann1 = num(c[10]);
    const ann5 = num(c[11]);
    const ann10 = num(c[12]);
    const annLaunch = num(c[13]);

    const cum1 = num(c[14]);
    const cum5 = num(c[15]);
    const cum10 = num(c[16]);
    const cumLaunch = num(c[17]);

    const cal = {};
    for (let i = 0; i < 5; i++) {
      const y = years[i] || String(2025 - i);
      /* 2026-10-24（核验报告 v3 #4）：此前对保守基金把真实的 0.00 也置为 null，
         导致 22 只「2021 年确实零回报」被显示成空值、连带 worstYear 偏高。
         官方 n.a. 由 num() 返回 null 处理，这里不要再按基金类型做特判。 */
      cal[y] = num(c[18 + i]);
    }

    // 费用列（含区间/上限形式，见 fee() 注释）——单值字段取值与旧版一致
    const F_MGMT = fee(c[23]);
    const F_TRUSTEE = fee(c[24]);
    const F_EMPF = fee(c[25]);
    const F_SPONSOR = fee(c[26]);
    const F_INVEST = fee(c[27]);
    const F_GUAR = fee(c[28]);
    const mgmtFee = F_MGMT.v;
    const trusteeFee = F_TRUSTEE.v;
    const empfFee = F_EMPF.v;
    const sponsorFee = F_SPONSOR.v;
    const investFee = F_INVEST.v;
    const guaranteeFee = F_GUAR.v;

    // 基金类别：'股票基金 - 美國股票基金'
    let type = typeFull;
    let subtype = '';
    const dash = typeFull.indexOf(' - ');
    if (dash > 0) {
      type = typeFull.slice(0, dash).trim();
      subtype = typeFull.slice(dash + 3).trim();
    }

    const key = (meta.cfId || fundName + '|' + scheme).toString();
    if (seen.has(key)) continue;
    seen.add(key);

    // 最大回撤口径：取积金局公布的历年回报（近5个完整历年）中最差的一年
    // —— 完全基于积金局官方数据，无任何外部来源或估算。
    const calVals = Object.values(cal).filter((v) => v != null);
    const worstYear = calVals.length ? Math.min(...calVals) : null;

    // 官网以「区间」或「最高 x」形式公布的费用项（前端按官网原文形式展示；单一值不写入）
    const feeMore = {};
    [['mgmtFee', F_MGMT], ['trusteeFee', F_TRUSTEE], ['empfFee', F_EMPF], ['sponsorFee', F_SPONSOR], ['investFee', F_INVEST], ['guaranteeFee', F_GUAR]]
      .forEach(([k, f]) => {
        if (f.cap) feeMore[k] = { max: f.max, cap: true };
        else if (f.min != null && f.max != null && f.max !== f.min) feeMore[k] = { min: f.min, max: f.max };
      });

    funds.push({
      id: meta.cfId,
      scheme,
      fund: fundName,
      fundBase: fundBaseName(fundName),
      unit: fundUnitLabel(fundName),
      trustee,
      type,
      subtype,
      typeFull,
      launch,
      launchTs: parseDate(launch),
      size,
      risk,
      fer, // 最近期基金開支比率（%），来自积金局
      // 单位资产净值：积金局表格不提供，须从发行人官网取得；抓取前一律为「待核实」
      nav: null,
      navAsOf: '',
      navSource: '',
      navStatus: 'pending', // pending | verified | unmatched
      navPriceUrl: '',
      ann1,
      ann5,
      ann10,
      annLaunch,
      cum1,
      cum5,
      cum10,
      cumLaunch,
      cal,
      worstYear,
      mgmtFee,
      trusteeFee,
      empfFee,
      sponsorFee,
      investFee,
      guaranteeFee,
      ...(Object.keys(feeMore).length ? { feeMore } : {}),
    });
  }

  // 积金局官网标注的资料截止日期（例如「最新資料截至2026年08月31日」）
  let dataAsOf = '';
  const m = /最新資料截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(html);
  if (m) dataAsOf = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');

  return { funds, years, source: SOURCE_URL, dataAsOf, declaredTotal: declaredTotal(html) };
}

/** 把每一單位類別行與其所屬的成分基金分組互相標記 */
function annotateUnitGroups(funds, groups) {
  const map = new Map();
  for (const g of groups) {
    for (const u of g.units) map.set(u.cfId, g);
  }
  for (const f of funds) {
    const g = map.get(f.id);
    if (!g) continue;
    f.groupSize = g.unitCount;
    f.groupUnits = g.unitList;
    f.fundBase = g.fund;
  }
}

function declaredTotal(html) {
  const dm = /已選擇的成分基金總數:\s*(\d+)/.exec(html || '');
  return dm ? parseInt(dm[1], 10) : null;
}

/**
 * 按「受托人 + 計劃 + 基金主名 + 基金類別」歸併同一基金的單位類別。
 * 主記錄取資產規模最大的單位類別為代表（客戶實際持有最多的單位），
 * 各單位的原始數據一字不改地保存在 units 中供詳情頁展示。
 */
function mergeUnits(list) {
  const map = new Map();
  for (const x of list) {
    const key = [x.trustee, x.scheme, x.fundBase, x.typeFull].join('||');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(x);
  }

  const out = [];
  for (const arr of map.values()) {
    // 以基金規模最大的單位類別作代表
    const sorted = arr.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
    const rep = sorted[0];
    const units = sorted.map((u) => ({
      cfId: u.id,
      unit: u.unit || '—',
      nav: u.nav,
      navStatus: u.navStatus,
      navAsOf: u.navAsOf,
      fer: u.fer,
      size: u.size,
      ann1: u.ann1,
      ann5: u.ann5,
      ann10: u.ann10,
      annLaunch: u.annLaunch,
      mgmtFee: u.mgmtFee,
    }));
    out.push(
      Object.assign({}, rep, {
        fund: rep.fundBase, // 主名稱（已去除單位類別後綴）
        unitCount: units.length,
        unitList: sorted.map((u) => u.unit || '—'),
        unitLabel: sorted.map((u) => (u.unit ? '單位' + u.unit : '—')).join(' / '),
        units,
      })
    );
  }
  return out;
}

/**
 * 單位類別（Unit Class）後綴識別
 * ---------------------------------------------------------------
 * 積金局「基金資訊表」對同一隻成分基金的每一個單位類別各列一行，例如：
 *   安聯亞洲基金 - 單位A / - 單位B / - 單位T
 *   景順均衡基金  - 單位類別A / - 單位類別H
 *   信安國際股票基金 - D類單位 / - I類單位
 *   海通亞太基金 - A類別 / - T類別
 *   永明強積金增長基金 - A類 / - B類
 * 而頁面頂部「已選擇的成分基金總數: 382」是按「一隻基金」計算的。
 * 已驗證：6 大類別、24 個計劃、11 個受托人三個維度的官方標註合計均為 382，
 * 表格行數合計均為 451，差額 69 全部來自單位類別分列 —— 合併後恰為 382。
 */
const UNIT_SUFFIX = /\s*[-－]\s*(?:單位類別|單位)?\s*([A-Z])\s*(?:類單位|類別|類|單位)?\s*$/;
const fundBaseName = (n) => (n || '').replace(UNIT_SUFFIX, '').trim();
const fundUnitLabel = (n) => {
  const m = UNIT_SUFFIX.exec(n || '');
  return m ? m[1] : '';
};

function parseDate(s) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec((s || '').trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
}

module.exports = { scrape, scrapeShow, parse, attachNav, SOURCE_URL };

// CLI 直接运行：node scraper.js
if (require.main === module) {
  scrape()
    .then((r) => {
      console.log('基金数量:', r.funds.length, '| 历年:', r.years.join(','));
      console.log(JSON.stringify(r.funds.slice(0, 3), null, 1));
    })
    .catch((e) => {
      console.error('抓取失败:', e.message);
      process.exit(1);
    });
}
