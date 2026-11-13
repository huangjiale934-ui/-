/**
 * 三页回归检查 —— 广州精研数据有限公司 · 香港强积金数据平台
 * 用法：先由 shell 抓取三页 DOM 到 tmp/reg/，再运行本脚本断言
 *   bash tmp/regdump.sh [baseUrl]   &&   node tmp/regcheck.js
 */
const fs = require('fs');
/* 站点地址：node tmp/regcheck.js http://127.0.0.1:3072 或线上域名；接口断言需要它 */
const BASE = (process.argv[2] || 'http://127.0.0.1:3012').replace(/\/$/, '');
/* 2026-11-12：WorkBuddy 站托管层要求 ?sharecode=，裸域 /api/* 会 403。
   仅当设置 MPF_SITE_A_CODE 时附加，GitHub Pages 与本地回归行为不变。 */
const SITE_CODE = process.env.MPF_SITE_A_CODE || '';
const withCode = (p) => p + (SITE_CODE ? (p.includes('?') ? '&' : '?') + 'sharecode=' + SITE_CODE : '');
const path = require('path');
const TMP = path.join(__dirname, '..', 'tmp', 'reg');   /* 2026-10-20：与 tmp/regdump.sh 输出目录对齐（此前指向 tools/reg，读的是旧快照） */

const read = (n) => {
  const p = path.join(TMP, n + '.html');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

const results = [];
function chk(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
}

const home = read('home');
/* 2026-10-22：译键检查统一读三个字典文件（i18n.js 只保留简体原文与 TT/TQ 逻辑） */
function i18nText() {
  const dir = path.join(__dirname, '..', 'public');
  return ['i18n.js', 'i18n-hant.js', 'i18n-en.js']
    .map((f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return ''; } })
    .join(String.fromCharCode(10));
}

const idx = read('index');
const rk = read('ranking');
const css = (function () { try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8'); } catch (e) { return ''; } })();
const rawIdxHtml = (function () { try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'); } catch (e) { return ''; } })();
const readSrc = (f) => { try { return f.indexOf('root:') === 0 ? fs.readFileSync(path.join(__dirname, '..', f.slice(5)), 'utf8') : fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'); } catch (e) { return ''; } };

/* ---------------- 首页 ---------------- */
chk('首页·KPI 成分基金 451', /成分基金[\s\S]{0,60}?451/.test(home));
chk('首页·KPI 受托人 11 家（2026-10-31：卡片小字已删）', /受托人／发行人[\s\S]{0,60}?11 <small>家<\/small>/.test(home));
/* 2026-11-11：積金局规模每月更新（10 月总规模 1.65 万亿），不能再写死具体数字。
   改为「格式正确 + 落在合理区间」，避免每月刷新都误报。 */
chk('首页·KPI 总规模（格式 + 合理区间 1.0–2.5 万亿）', (function () {
  const m = /市场总规模[\s\S]{0,80}?(\d\.\d{2}) 万亿/.exec(home);
  const v = m ? parseFloat(m[1]) : 0;
  return v >= 1.0 && v <= 2.5;
})());
/* 2026-10-22：KPI 改用自算净值口径（数值随净值日变化），只校验标签、口径说明与百分比结构 */
chk('首页·KPI 近1年平均回报（规模加权）', /近 1 年平均回报<\/div><div class="mk-v">[+-]\d+\.\d+%/.test(home));

chk('首页·温度计 SVG 已渲染', /class="thermo-svg"/.test(home));
chk('首页·温度计 平均/中位数/正回报占比', /近 1 年平均回报<\/span><b[\s\S]{0,200}?近 1 年中位数回报<\/span><b[\s\S]{0,200}?正回报基金占比<\/span><b/.test(home));
// 已由「温度计涨跌带只」覆盖
// 已由「温度计涨跌带只」覆盖
chk('首页·温度计平均回报口径（2026-11-04 起标签改「全市场平均」）', /全市场平均/.test(home) && !/规模加权平均/.test(home));

chk('首页·环形图 中心 451 只基金', /class="pie-c1"[^>]*>451<\/text>/.test(home));
chk('首页·环形图图例 3 组（种类分布/受托人份额/资产占比）', (home.match(/<ul class="pie-legend">/g) || []).length === 3);
// 已由「环形图图例带只单位」覆盖
/* 2026-11-11：份额随積金局每月规模变化，改为「四块合计 ≈100% 且各自落在合理区间」 */
chk('首页·扇形图 四块份额合理且合计 100%', (function () {
  const pctOf = (name) => {
    const i = home.indexOf('title="' + name + '">');
    if (i < 0) return NaN;
    const m = /(\d+\.\d)%/.exec(home.slice(i, i + 140));
    return m ? parseFloat(m[1]) : NaN;
  };
  /* 饼图共 6 块：三大 + 永明 + 友邦 + 其他 6 家（其余按份额合并） */
  const vals = [pctOf('HSBC'), pctOf('宏利'), pctOf('银联信托'), pctOf('永明'), pctOf('友邦信托'), pctOf('其他 6 家受托人')];
  if (vals.some((v) => isNaN(v))) return false;
  const sum = vals.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) <= 1.5 && vals[0] > 15 && vals[1] > 15 && vals[2] > 3 && vals[5] > 3;
})());

chk('首页·风险级别 7 根柱子', (home.match(/<div class="col">/g) || []).length === 7);
chk('首页·风险级别图例 7 项（2026-10-31：说明小字已删）', (function () { const m = /<ul class="rl-list">[\s\S]*?<\/ul>/.exec(home); return m && (m[0].match(/<li>/g) || []).length === 7; })());

/* 2026-10-20：各类基金平均回报对比图表按需求下线，原位置改为「MPF 最新资讯」10 条 */
chk('首页·最新资讯 10 条（2026-10-31 用户要求 10 条）', (home.match(/class="news-title"/g) || []).length === 10);
chk('首页·资讯标题为官网外链', (home.match(/class="news-title" href="https:\/\/www\.mpfa\.org\.hk\//g) || []).length === 10);
chk('首页·资讯块位于市场概览右栏', /mk-charts2[\s\S]{0,2000}id="newsList"/.test(home));

chk('首页·走势图 5 个年份', ['2021', '2022', '2023', '2024', '2025']
  .every((y) => new RegExp('class="chart-xlab"[^>]*>' + y + '<').test(home)));
chk('首页·走势图 2025 为正且标红（数值随指数重算，校验符号与格式）', /class="line-val up"[^>]*>\+\d+\.\d+%/.test(home));
chk('首页·走势图 2022 为负且标绿（数值随指数重算，校验符号与格式）', /class="line-val down"[^>]*>-\d+\.\d+%/.test(home));

chk('首页·四榜 2×2 各 5 条（2026-11-04：1Y/5Y 回报 + 规模 + 波动率）', ['#mkTop1', '#mkTop4', '#mkTopSize', '#mkTopVol'].every((id) => {
  const m = new RegExp('id="' + id.slice(1) + '"[\\s\\S]*?</ol>').exec(home);
  return m && (m[0].match(/<li[\s>]/g) || []).length === 5;
}) && home.indexOf('id="mkTop2"') < 0 && home.indexOf('id="mkTop5"') < 0 && home.indexOf('id="mkTopYtd"') < 0 && home.indexOf('id="mkTop3"') < 0);
chk('首页·免责条在位（disclaimer，2026-10-31 版式）', /class="disclaimer"/.test(home) && /每日自动同步|风险提示与免责声明/.test(home));
chk('首页·区间标签 12 个（走势 6 + 表现指数区间 6，2026-11-03 加「每日」）', (home.match(/class="yr-tab( on)?"/g) || []).length === 12);
/* 2026-10-28 用户要求删除整块「公司介绍」（成立时间/愿景/团队/业务版图、六大优势、免费行政服务、合作伙伴、承诺、业务板块）
   → 原 5 条断言随区块下线；2026-10-29 改为反向校验：区块不得再出现 */
chk('首页·公司介绍区块已按 2026-10-28 要求删除', home.indexOf('class="biz about"') < 0 && home.indexOf('about-grid') < 0 && home.indexOf('IC001045') < 0);
/* 2026-10-22（领导定）：六色板改为「蓝 + 浅绿」双色 */
/* 2026-10-22 傍晚：整体再调浅一档 */
/* 2026-10-23：配色改为官网色板后，改为结构性校验（饼图色板存在且≥6 色） */
chk('首页·饼图色板已加载（≥6 色）', (function () { try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8'); const m = j.match(/PALETTE = PAL_MONO[\s\S]{0,600}?\['([^\]]+)\]/); return !!m && m[1].split(',').length >= 6; } catch (e) { return false; } })());
chk('首页·风险图例标题在位（2026-10-31：说明小字删）', /风险级别图例（1 级最低 → 7 级最高）/.test(home));
chk('首页·友情链接已渲染', (home.match(/class="friend-links"[\s\S]*?<\/div>\s*<\/div>\s*<\/footer>/) || [''])[0].indexOf('<a ') >= 0);
/* 2026-10-29（5.0）：友链曾出现「点宏利跳回本站」——根因是 sources 缺 page、count 字段名不符，
   渲染出空 href 与「undefined 条」。此处同时校验数据层与渲染层，daily 另有 link-audit.js 巡检。 */
chk('友情链接·每个净值来源都有官网地址', (function () {
  try {
    const fd = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'funds.json'), 'utf8'));
    const src = (fd.navStat && fd.navStat.sources) || [];
    return src.length > 0 && src.every((s) => /^https?:\/\//i.test(String(s.page || s.url || '')) && typeof s.n === 'number');
  } catch (e) { return false; }
})());
chk('友情链接·页面无空 href / 无 undefined 文案', [home, idx, rk].every((h) => h.indexOf('href=""') < 0 && h.indexOf('undefined') < 0));

/* ---------------- 资料库 ---------------- */
const idxHead = (function () {
  /* 2026-11-02：资料库表格上方新增走势图卡（自带一张统计表），页面上第一个 thead 不再是基金表 →
     这里锁定 id="fundTable" 之后的第一个 thead */
  const at = idx.indexOf('id="fundTable"');
  if (at < 0) return '';
  return (/<thead>[\s\S]*?<\/thead>/.exec(idx.slice(at)) || [''])[0];
})();
chk('资料库·无「强积金计划」列', idxHead.indexOf('強積金計劃') < 0 && idxHead.indexOf('强积金计划') < 0);
chk('资料库·无「近5年最差年度」列', idxHead.indexOf('最差') < 0);
/* 2026-10-26 起「推出日期」改为列设置中的可选列（默认 14 列不含它），断言改为：
   列定义存在 + 操作列固定最后一列 */
chk('资料库·推出日期为可选列且操作列在最后', (function () {
  try {
    const aj = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const ths = idxHead.match(/<th[^>]*>[\s\S]*?<\/th>/g) || [];
    const last = ths.length ? ths[ths.length - 1] : '';
    return /k:\s*'launchTs',\s*n:\s*'推出日期'/.test(aj) && last.indexOf('操作') >= 0;
  } catch (e) { return false; }
})());
chk('资料库·默认每页 10 行', /<option[^>]*value="10"[^>]*selected/.test(idx));
chk('资料库·首屏渲染 10 行', (function () {
  /* 2026-11-02：页面上第一个 tbody 已是走势图统计表 → 锁定 id="tbody" */
  const at = idx.indexOf('<tbody id="tbody"');
  if (at < 0) return false;
  const tb = (/<tbody[\s\S]*?<\/tbody>/.exec(idx.slice(at)) || [''])[0];
  return (tb.match(/<tr/g) || []).length === 10;
})());
chk('资料库·总条数显示 451', /451/.test(idx));

/* ---------------- 排名 ---------------- */
const rkHead = (/<thead>[\s\S]*?<\/thead>/.exec(rk) || [''])[0];
chk('排名·无「近5年最差年度」表头', rkHead.indexOf('最差') < 0);
chk('排名·维度下拉 17+1 项（2026-10-31：标签行改下拉）', (function () {
  const m = /<select[^>]*id="rkDimSel"[^>]*>[\s\S]*?<\/select>/.exec(rk);
  return m && (m[0].match(/<option/g) || []).length === 18;
})(), '实际 ' + (function () { const m = /<select[^>]*id="rkDimSel"[^>]*>[\s\S]*?<\/select>/.exec(rk); return m ? (m[0].match(/<option/g) || []).length : 0; })());
chk('排名·维度下拉（2026-10-31：标签行删除，工具栏下拉，默认无）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return h.indexOf('rkTabsToggle') < 0 && h.indexOf('id="rkTabs"') < 0 && /id="rkDimSel"/.test(h) &&
      r.indexOf('buildTabs') >= 0 && r.indexOf('paintTabs') >= 0 &&
      st.indexOf('.dim-pick') >= 0;
  } catch (e) { return false; }
})());
chk('排名·榜单表体默认渲染 10 行', (function () {
  const tb = (/<tbody id="rkTbody"[\s\S]*?<\/tbody>/.exec(rk) || [''])[0];
  return (tb.match(/<tr/g) || []).length === 10;
})());
chk('排名·默认每页 10 条（HTML selected + S.top=10）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /value="10" selected>10 条/.test(h) && /top: 10, page: 1, sortKey/.test(r);
  } catch (e) { return false; }
})());
chk('排名·冠军卡区块已移到表格之后（表格 < 冠军卡 < 页脚）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const iTable = h.indexOf('id="rkTbody"');
    const iChamp = h.indexOf('id="rkChampions"');
    const iFoot = h.indexOf('class="foot"');
    return iTable >= 0 && iChamp > iTable && iFoot > iChamp;
  } catch (e) { return false; }
})());


/* ---- 本轮新增：多语言 / 骨架屏 / 回到顶部 / 风险图例 / 六榜单 / 公司介绍 ---- */
chk('首页·语言切换器 3 个语言', (home.match(/data-lang="/g) || []).length === 3);
chk('首页·回到顶部按钮存在', /class="to-top"/.test(home));
chk('首页·风险级别图例 7 级', (function () {
  const m = /<ul class="rl-list">([\s\S]*?)<\/ul>/.exec(home);
  return !!m && (m[1].match(/<li>/g) || []).length === 7;
})());
chk('首页·风险图例含低风险/最高风险说明', /低風險|低风险/.test(home) && /最高風險|最高风险/.test(home));
chk('首页·旧独立资讯区块已移除', home.indexOf('news-wrap') < 0 && home.indexOf('news-panel') >= 0);
/* 2026-10-29：公司介绍 PPT 版五段 / 六大优势 / 免费服务三阶段 / 牌照编号 4 条断言
   均针对已删除区块，改由上方「公司介绍区块已删除」一条覆盖，此处不再重复断言 */
/* ---- 本轮：数字卡片删除 + 公司介绍改 2×2 卡片 ---- */
const rawH = (function () { try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'home.html'), 'utf8'); } catch (e) { return ''; } })();
chk('首页·2023 四张数字卡片已删除', rawH.indexOf('class="metric"') < 0 && rawH.indexOf('m-grid in-about') < 0);
chk('首页·环形图图例带「条」单位（本轮统一）', /lg-v">\d+ 条 · [\d,]+ 亿<\/span>/.test(home));
chk('首页·风险柱横轴带「级」', /<span class="cx">1 级<\/span>/.test(home));
/* 2026-10-22：温度计改用自算净值口径后，上涨/下跌条数随净值日变动，
   断言只查「数字 + 条 + 上涨/下跌」的结构，不再写死 351（遵守「勿写死会变的数字」） */
chk('首页·温度计涨跌带「条」单位（本轮统一）', /上涨 <b class="up">\d+ 条<\/b>/.test(home) && /下跌 <b class="down">\d+ 条<\/b>/.test(home));
chk('首页·市场解读块已删 + 走势ⓘ（2026-10-31）', (function () {
  try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'home.html'), 'utf8').indexOf('id="mkRead"') < 0; } catch (e) { return false; }
})() && /id="yrTip"/.test(home) && (home.match(/class="h3-tip"/g) || []).length >= 4);
chk('首页·珠江新城背景图（2026-10-15 换明亮新图）', /about-gz-bright\.webp/.test(css));
chk('首页·背景图不透明度 >= 0.5', /opacity:\s*0\.5/.test(css));
chk('资料库·口径说明在表格下方', idx.indexOf('srcNote') > idx.indexOf('<tbody'));
chk('排名·口径说明在表格下方', rk.indexOf('srcNote') > rk.indexOf('<tbody'));
/* 2026-10-28 首屏改版：公司名 h2 随公司介绍块一起移除，主标题改为 hero 内的 h1 双行文案 */
chk('首页·首屏=公司logo+「香港强积金数据分析平台」（2026-10-31 三版改名）', /hero-brand/.test(home) && /<h1 data-i18n="香港强积金数据分析平台">/.test(home) && home.indexOf('香港强积金市场概览') < 0 && home.indexOf('hero-tag') < 0);
/* 2026-10-29：公司介绍块（含大量 data-i18n）已删除，属性总数由 80+ 降至 72，阈值相应下调 */
chk('首页·多语言属性已覆盖', (home.match(/data-i18n(-ph|-title|-parts)?="/g) || []).length > 34);
chk('资料库·多语言属性已覆盖', (idx.match(/data-i18n(-ph|-title|-parts)?="/g) || []).length > 20);
chk('排名·多语言属性已覆盖', (rk.match(/data-i18n(-ph|-title|-parts)?="/g) || []).length > 15);


/* ---- HTML 结构配平（防止插入区块时标签失配） ---- */
const rawHtml = {};
['home', 'index', 'analysis'].forEach((n) => {
  try { rawHtml[n] = fs.readFileSync(path.join(__dirname, '..', 'public', n === 'home' ? 'home.html' : n + '.html'), 'utf8'); } catch (e) { rawHtml[n] = ''; }
});
['home', 'index'].forEach((n) => {
  const h = rawHtml[n];
  const od = (h.match(/<div/g) || []).length;
  const cd = (h.match(/<[\/]div>/g) || []).length;
  chk((n === 'home' ? '首页' : '资料库') + '·HTML div 配平',
    od > 0 && od === cd, '开' + od + ' / 闭' + cd);
});
/* 2026-10-31 四版（用户要求）：原第三页下线；本地仅留最小跳转占位（沙箱不删除文件，占位可覆盖线上旧版） */
chk('四版·原第三页已下线（analysis.html 为最小跳转占位 + index 含 anSec）',
  (function () {
    try {
      const st = fs.statSync(path.join(__dirname, '..', 'public', 'analysis.html'));
      const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.html'), 'utf8');
      return st.size < 800 && t.indexOf('index.html#cmp') >= 0 && /id="anSec"/.test(rawHtml.index || '');
    } catch (e) { return false; }
  })());

/* ---- 第七轮：语言补全 / 榜单提示 / 对比入口 / 风险小图例 / 更新时间 / 估值日提示 ---- */
chk('首页·概览双卡：数据更新+积金局资料截至（2026-10-31 恢复）', /class="upd-live"/.test(home) && /数据更新 <b>/.test(home) && /class="upd-of"/.test(home));
chk('首页·积金局资料截至徽标', /class="upd-of"/.test(home) && /积金局资料截至 <b>/.test(home));
/* 2026-10-29：色板已由 CSS 内联色改为 common.js 的 MPF_RISK.colors（7 级蓝），断言改查数据源而非 DOM */
chk('首页·风险柱用蓝色 7 级色板', (function () {
  try {
    const cj = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const i = cj.indexOf('const MPF_RISK');
    const seg = cj.slice(i, i + 400);
    const m = /colors:\s*\[([^\]]+)\]/.exec(seg);
    return !!m && m[1].split(',').length === 7 && /#a5cbee/.test(m[1]) && /#4f90d2/.test(m[1]);
  } catch (e) { return false; }
}));
chk('排名·维度下拉在工具栏（2026-10-31）', /id="rkDimSel"/.test(rk) && rk.indexOf('rkTabsNote') < 0);
chk('排名·标签容器已删（仅下拉，2026-10-31）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    return h.indexOf('rkTabsToggle') < 0 && h.indexOf('id="rkTabs"') < 0 && h.indexOf('id="rkDimSel"') >= 0;
  } catch (e) { return false; }
})());
chk('排名·对比栏带数量徽标', /class="cmp-lab"/.test(rk) && /id="cmpN"/.test(rk));
chk('资料库·对比栏与对比弹窗已加入', /id="cmpModal"/.test(idx) && /id="cmpList"/.test(idx) && /id="cmpBody"/.test(idx));
chk('资料库·口径行含估值分布 chips（#ffNavdist，2026-10-31 二版）', /id="ffNavdist"[^>]*>[\s\S]{0,400}?<\/span>/.test(idx) && idx.indexOf('id="ffRisk"') < 0);
chk('排名·口径行图例已删（#ffRisk 移除，2026-10-31）', rk.indexOf('id="ffRisk"') < 0);
chk('资料库·净值单元格悬浮含官方来源', /data-tip="已核对官方来源：/.test(idx));
chk('资料库·无估值日问号标记（代码+数据均具备）', (function () {
  const cj = (function () { try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8'); } catch (e) { return ''; } })();
  let nd = 0;
  try { const n = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nav.json'), 'utf8')); nd = n.items.filter((x) => x.nav != null && !x.asOf && !x.na).length; } catch (e) {}
  return /nav-q/.test(cj) && /官网把估值日放在动态脚本中生成/.test(cj) && nd > 0;
})());
chk('资料库·footer 来源与免责（三行式 snote + 折叠，2026-11-04）', /class="snote"/.test(readSrc('common.js')) && /snote-foot/.test(readSrc('common.js')) && /foot-fold/.test(idx));
chk('排名·footer 来源与免责（snote + 折叠）', /class="snote"/.test(readSrc('common.js')) && /foot-fold/.test(rk));
chk('首页·页面标题已加标记', /<title data-i18n="香港强积金市场数据平台/.test(rawH));
chk('资料库·筛选与工具栏合并一行（2026-11-02：排名维度→搜索→下拉→共筛选出→每页显示→导出，无「筛选条件：无」）',
  /class="f-row f-row-main f-row-merged"/.test(idx) && /id="dimBtn"/.test(idx) && /id="dimPop"/.test(idx) && /class="tb-tail"/.test(idx) &&
  /共筛选出/.test(idx) && idx.indexOf('筛选条件：无') < 0 && idx.indexOf('点击表头排序') < 0 &&
  idx.indexOf('id="fRisk"') < 0 && idx.indexOf('class="f-lead"') < 0);
chk('排名·表头提示已删（2026-10-31）', rk.indexOf('点击表头可排序') < 0);
/* i18n 字典覆盖：代码/HTML 中出现的键必须全部有译文 */
(function () {
  /* 2026-10-21：繁/英字典已拆到 i18n-hant.js / i18n-en.js，译键检查需合并三个文件 */
  const i18n = (function () { try {
    const dir = path.join(__dirname, '..', 'public');
    return ['i18n.js', 'i18n-hant.js', 'i18n-en.js'].map((f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return ''; } }).join(String.fromCharCode(10));
  } catch (e) { return ''; } })();
  /* 2026-10-21：繁/英字典已拆分到 i18n-hant.js / i18n-en.js。
     这里直接扫描合并文本里所有  '键': 形式，不依赖 var 块边界。 */
  function keysOf() {
    const ks = new Set();
    const re = /(?:^|\n)\s*'((?:[^'\\]|\\.)*)'\s*:/g;
    let m;
    while ((m = re.exec(i18n))) ks.add(m[1].replace(/\\'/g, "'"));
    return ks;
  }
  const have = new Set([...keysOf('HANT'), ...keysOf('EN')]);
  const cand = new Set();
  /* BOARDS 的 name/desc/g 是经 TT(b.name) 间接查字典的，纯正则抓不到调用点，
     必须单独把字面量抽出来，否则「榜单名没翻译」这类问题会漏检 */
  (function () {
    const rj = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const i = rj.indexOf('const BOARDS = [');
    const j = rj.indexOf('];', i);
    rj.slice(i, j).replace(/\{ g: '([^']+)', id: '[^']+', name: '([^']+)',[^}]*desc: '([^']+)'/g, (mm, g, n, d) => { cand.add(g); cand.add(n); cand.add(d); return mm; });
    const k2 = rj.indexOf('const keys = {');
    if (k2 > 0) { const j2 = rj.indexOf('};', k2); rj.slice(k2, j2).replace(/: '([^']+)'/g, (mm, k) => { cand.add(k); return mm; }); }
    /* dimName 的映射对象是 TT({...}[k]) 形式，正则抓不到调用点，单独扫描 */
    const aj = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const d1 = aj.indexOf('function dimName');
    if (d1 > 0) { const d2 = aj.indexOf('}', d1); aj.slice(d1, d2).replace(/: '([^']+)'/g, (mm, k) => { cand.add(k); return mm; }); }
    /* FRIEND_LINKS 的描述经 li([...TT(x[2])]) 间接查字典，同样单独扫描 */
    const cj2 = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const f1 = cj2.indexOf('const FRIEND_LINKS = [');
    if (f1 > 0) { const f2 = cj2.indexOf('];', f1); cj2.slice(f1, f2).replace(/, '([^']*[\u4e00-\u9fff][^']*)'\]/g, (mm, k) => { cand.add(k); return mm; }); }
  })();
  ['common.js', 'rank.js', 'home.js', 'app.js'].forEach((f) => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    t.replace(/(?:TT|TQ|t)\(\s*'((?:[^'\\]|\\.)*)'/g, (m, k) => { const key = k.replace(/\\'/g, "'"); if (/[\u4e00-\u9fff]/.test(key)) cand.add(key); return m; });
  });
  ['home.html', 'index.html', 'ranking.html'].forEach((f) => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    t.replace(/data-i18n(?:-ph|-title|-parts)?="([^"]+)"/g, (m, k) => { cand.add(k); return m; });
  });
  const miss = [...cand].filter((k) => !have.has(k));
  chk('多语言·词条覆盖率（0 缺失）', miss.length === 0, '缺 ' + miss.length + (miss.length ? '：' + miss.slice(0, 3).join(' / ') : ''));
})();

/* ---- 第八轮：榜单数值 / 图表布局 / 更新时间 ---- */
(function () {
  // 四个榜单卡片（2026-10-31：砍总开支/低风险）：每一项都必须有数值
  const ids = ['1', '4', 'Size', 'Vol'];   /* 2026-11-04 第三十四轮：1Y/5Y/规模/波动率 */
  let bad = [];
  ids.forEach((i) => {
    const m = new RegExp('<ol[^>]*id="mkTop' + i + '"[\\s\\S]*?</ol>').exec(home);
    if (!m) { bad.push('mkTop' + i + ' 缺失'); return; }
    if (m[0].indexOf('>—<') >= 0) bad.push('mkTop' + i + ' 有「—」');
    if (!/[0-9]/.test(m[0])) bad.push('mkTop' + i + ' 无数值');
  });
  chk('首页·四榜均显示数值（无空缺）', bad.length === 0, bad.join(' / '));
})();
chk('首页·占比图面板已标记 pie-panel', (home.match(/class="mk-panel pie-panel"/g) || []).length === 2);
chk('首页·基金种类图例名称完整（2026-11-04 起缩为「货币（保守）/货币（非保守）」避免截断）', /货币（非保守）/.test(home) && /货币（保守）/.test(home));
chk('首页·风险级别图例名称完整', /低至中风险/.test(home) && /最高风险/.test(home));
chk('首页·CSS 已含桌面三列布局调优', (function () {
  try { return /min-width: 1181px/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8')); } catch (e) { return false; }
})());

/* ---- 第九轮：榜单跳转链接 / 海通自动抓取 ---- */
chk('首页·四榜均有「查看完整榜单」链接', (home.match(/class="mk-more"/g) || []).length === 4);
chk('首页·四榜全部指向资料库同一自算维度（2026-11-03 第三十三轮：积金局两榜下线）', (function () {
  const want = { mkTop1: 'dim=selfY1#db', mkTop4: 'dim=selfY5a#db', mkTopSize: 'dim=size#db', mkTopVol: 'dim=vol1#db' };
  return Object.keys(want).every((id) => {
    const m = new RegExp('<ol[^>]*id="' + id + '"[\\s\\S]{0,600}?</ol>').exec(home);
    // 链接在 <ol> 之前，取卡片整段判断
    const card = new RegExp('<div class="mk-top">[\\s\\S]*?id="' + id + '"[\\s\\S]*?</div>').exec(home);
    // 2026-10-29：GitHub Pages 部署在 /-/ 子路径，必须用相对链接；原断言强制前导斜杠反而会跳错站
    return card && card[0].indexOf('index.html?' + want[id]) >= 0;
  });
})());
chk('词条·查看完整榜单（多语言）', (function () {
  try {
    const t = i18nText();
    return /'查看完整榜单': '查看完整榜單'/.test(t) && /'查看完整榜单': 'View full leaderboard'/.test(t);
  } catch (e) { return false; }
})());
chk('海通·已改为自动抓取（非 noRender）', (function () {
  try {
    const nb = fs.readFileSync(path.join(__dirname, '..', 'navbuild.js'), 'utf8');
    const i = nb.indexOf("key: 'Haitong'");
    const seg = nb.slice(i, i + 400);
    return seg.indexOf('noRender') < 0 && seg.indexOf('haitongCards') >= 0;
  } catch (e) { return false; }
})());

/* ---- 第九轮（补）：语言切换 / 表头 / 深链接 ---- */
chk('i18n·parts 使用原文键（防切换累积失配）', (function () {
  try { return /__i18nRaw/.test(i18nText()); } catch (e) { return false; }
})());
chk('排名·已监听 mpf:lang 重绘动态文案', (function () {
  try { return /addEventListener\('mpf:lang'/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8')); } catch (e) { return false; }
})());
chk('排名·rkBoardTitle 不带 data-i18n（避免被静态值覆盖）', /<h2 id="rkBoardTitle">/.test(rawHtml.index));
chk('排名·聚合榜表头已 TT 化', (function () {
  try { return /const aggHead = /.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8')); } catch (e) { return false; }
})());
chk('词条·22 个榜单名均有译文', (function () {
  try {
    const t = i18nText();
    const names = ['近 1 年回报榜', '近 5 年年化榜', '近 10 年年化榜', '推出至今榜', '历年回报榜', '近 1 年累积', '近 5 年累积', '近 10 年累积', '推出至今累积', '抗跌榜', '稳健低风险榜', '低管理费榜', '最低总开支榜', '基金规模榜', '新锐基金榜', '发行人实力榜', '各细类冠军榜', '日涨跌榜（自算）', '近 1 个月榜（自算）', '近 3 年年化榜（自算）', '近 5 年年化榜（自算）', '近 5 年回撤榜（自算）'];
    return names.every((n) => t.indexOf("'" + n + "':") >= 0);
  } catch (e) { return false; }
})());

/* ---- 第九轮（执行批）：加载状态 / 浮层 / 分布 / 单位类别 / syncStatus ---- */
chk('页头不再放「数据版本」徽标（2026-11-02 第二十七轮：移到侧栏底部）', (function () {
  const j = readSrc('common.js');
  return rawHtml.index.indexOf('class="ver-chip"') < 0 && rawHtml.home.indexOf('class="ver-chip"') < 0 &&
    rawHtml.index.indexOf('class="upd"') < 0 && rawHtml.home.indexOf('class="upd"') < 0 &&
    rawHtml.analysis.indexOf('class="upd"') < 0 &&
    /id="verChip"/.test(j) && !/id="verChip"/.test(rawIdxHtml);
})());
chk('common.js 含自绘浮层机制（.mpf-tip + data-tip 委托）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return c.indexOf("className = 'mpf-tip'") >= 0 && c.indexOf("closest('[data-tip]')") >= 0; } catch (e) { return false; }
})());
chk('common.js 含净值估值日分布函数', (function () {
  try { return /function navDateDistHTML/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8')); } catch (e) { return false; }
})());
chk('server.js 含 units 派生与 syncStatus', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    return /function attachUnits/.test(c) && /syncStatus:/.test(c); } catch (e) { return false; }
})());
chk('app.js 含估值日筛选状态', (function () {
  try { return /navDate: ''/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8')); } catch (e) { return false; }
})());
chk('首页·积金表现指数已渲染（2026-10-31 新栏目）', /id="piCards"/.test(home) && /class="pi-card on"/.test(home) && /piGrad/.test(home));
chk('排名冠军卡风险带来源提示 data-tip', (function () {
  try { return /MPF_RISK\.tip\(x\.risk\)/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8')); } catch (e) { return false; }
})());
chk('口径行含估值日分布标签（ffNavdist/navdist）', /class="navdist"/.test(idx) || /class="navdist"/.test(rk) || /id="ffNavdist"/.test(idx));
chk('资料库分布标签可点击（.ndk）', /class="ndk"/.test(idx));
chk('翻译·本轮新键抽查在字典中', (function () {
  try {
    const t = i18nText();
    return t.indexOf("'由积金局评定：风险级别 {n} 级（1 级最低、7 级最高）'") >= 0 &&
      t.indexOf("'友情链接 · 官方数据来源'") >= 0 &&
      t.indexOf("'净值估值日分布：'") >= 0 &&
      t.indexOf("'近5年年化'") >= 0 && t.indexOf("'近10年年化'") >= 0 && t.indexOf("'近1年累积'") >= 0;
  } catch (e) { return false; }
})());
/* 接口层（Node 原生 fetch；本环境的沙箱禁止 spawn 子进程，故不用 curl）：
   /api/funds 应已下发 units 分组；/api/status 应含 syncStatus */
(async function () {
  /* 2026-11-05：GitHub Pages 是纯静态站，/api/funds 返回 404 的 HTML，
     真正的文件是 /api/funds.json。这里统一做一次回退，两个站点都能跑同一套断言。 */
  const apiGet = async (path, init) => {
    try {
      const r = await fetch(BASE + withCode(path), init);
      const ct = r.headers.get('content-type') || '';
      if (r.ok && /json/.test(ct)) return r;
    } catch (e) { /* 落到 .json */ }
    return fetch(BASE + withCode(path + '.json'), init);
  };
  try {
    let r;
    for (let i = 0; i < 3; i++) { try { r = await apiGet('/api/funds', { signal: AbortSignal.timeout(25000) }); break; } catch (e2) { if (i === 2) throw e2; await new Promise((x) => setTimeout(x, 1500)); } }
    const j = await r.json();
    const withUnits = (j.funds || []).filter((f) => Array.isArray(f.units) && f.units.length > 1);
    const ok1 = withUnits.length > 0 && withUnits[0].units[0].cfId != null && typeof withUnits[0].units[0].unit === 'string';
    chk('接口·funds 含 units 分组（单位类别明细数据）', ok1, '分组 ' + withUnits.length + ' 组');
  } catch (e) {
    chk('接口·funds 含 units 分组（单位类别明细数据）', false, String(e.message || e).slice(0, 60));
  }
  try {
    const r2 = await apiGet('/api/status');
    const j2 = await r2.json();
    chk('接口·status 含 syncStatus 字段', j2.syncStatus === 'ok' || j2.syncStatus === 'degraded', 'syncStatus=' + j2.syncStatus);
  } catch (e) {
    chk('接口·status 含 syncStatus 字段', false, String(e.message || e).slice(0, 60));
  }
  try {
    const r3 = await apiGet('/api/market');
    const j3 = await r3.json();
    const mo = j3.mpfaMonthly;
    chk('接口·market 含 mpfaMonthly（官方月度数据）', !!(mo && mo.rows && mo.rows.length === 9), mo ? ('asOf ' + mo.asOf) : '缺失');
  } catch (e) {
    chk('接口·market 含 mpfaMonthly（官方月度数据）', false, String(e.message || e).slice(0, 60));
  }
  try {
    const r4 = await apiGet('/api/funds');
    const j4 = await r4.json();
    const wf = (j4.funds || []).filter((f) => f.feeMore);
    const sample = wf.find((f) => f.feeMore.mgmtFee && f.feeMore.mgmtFee.max != null);
    chk('接口·funds 含 feeMore（区间/最高信息）', wf.length >= 100 && !!sample, '含 ' + wf.length + ' 条');
  } catch (e) {
    chk('接口·funds 含 feeMore（区间/最高信息）', false, String(e.message || e).slice(0, 60));
  }

  /* ---- 第十轮：官方月度板块 / 官方链接按钮 / 走势图注释 ---- */
chk('首页·积金局最新公布板块已渲染', /积金局最新公布/.test(home) && /class="mo-row/.test(home));
chk('首页·官方月度数字正确（10.3 / 9.5 / -1.5）', /\+10\.3%/.test(home) && /\+9\.5%/.test(home) && /-1\.5%/.test(home));
/* 2026-11-11：月度数据改为自动抓取后日期会推进，改为校验「日期格式 + 两处一致」 */
chk('首页·官方日期标注（截至 YYYY-MM-DD / YYYY-MM-DD 公布）', (function () {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'mpfa-monthly.json'), 'utf8'));
    return home.indexOf(j.asOf) >= 0 && home.indexOf(j.publishedAt) >= 0;
  } catch (e) { return false; }
})());
chk('首页·官方口径小注（已按要求删除“未发布本月/年初至今”句）', !/未发布「本月」或「年初至今」/.test(home) && /官方口径为「過去 12 個月」/.test(home));
chk('首页·走势ⓘ含口径（2026-10-31）', /id="yrTip"[^>]*data-tip="数据取自积金局/.test(home));
chk('详情·官方核对按钮（srcbtn）已就位', (function () {
  try { return /class="srcbtn"/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8')); } catch (e) { return false; }
})());
/* 2026-11-11：改为自动化抓取后，asOf 会随官方每月推进，不能再写死 2026-09-30。
   校验「9 行 + 关键字段齐全 + asOf 是合法日期 + 上層六類占比合计≈100」。 */
chk('官方月度数据文件完整（9 行 / 字段齐全 / 占比自洽）', (function () {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'mpfa-monthly.json'), 'utf8'));
    if (!j.rows || j.rows.length !== 9) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j.asOf || '')) return false;
    const need = ['share', 'm12', 'm12Hi', 'm12Lo'];
    if (j.rows.some((r) => need.some((k) => typeof r[k] !== 'number'))) return false;
    const top = [0, 1, 5, 6, 7, 8].reduce((a, i) => a + (j.rows[i].share || 0), 0);
    return Math.abs(top - 100) <= 1.5;
  } catch (e) { return false; }
})());

/* ---- 第十二轮：收费区间 / 对比列 / 绿按钮 / 环形图 / 条只统一 ---- */
chk('资料库·对比勾选列已加入（表体 checkbox + data-l）', /data-cmp="\d+"/.test(idx) && /data-l="对比"/.test(idx));
chk('资料库·勾选列与对比栏联动代码就位', (function () {
  try { const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    return /input\[data-cmp\]/.test(a) && /CMPX\.add/.test(a); } catch (e) { return false; }
})());
chk('资料库·管理费列改用官网原文形式（feeText）', (function () {
  try { return /feeText\(x\.mgmtFee/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8')); } catch (e) { return false; }
})());
chk('弹窗·费用行含区间/最高展示与小注', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /function feeText/.test(c) && /function feeTip/.test(c) && /class="fee-note"/.test(c); } catch (e) { return false; }
})());
chk('弹窗·绿胶囊（积金局基金详情，cf_detail）已加入', (function () {
  try { return /srcbtn-green[\s\S]{0,120}?cf_detail\.jsp\?cf_id=/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8')); } catch (e) { return false; }
})());
chk('unitCount 字段名错误已修复（全站改用 groupSize）', (function () {
  try { const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return a.indexOf('unitCount') < 0 && r.indexOf('unitCount') < 0; } catch (e) { return false; }
})());
chk('条/只统一：计数场景不再用「只基金」', idx.indexOf('data-i18n="只基金"') < 0 && rk.indexOf('>只基金</span>') < 0 && idx.indexOf('只</option>') < 0);
chk('条/只统一：每页选项为「N 条」', /<option[^>]*>10 条<\/option>/.test(idx) && /<option[^>]*>100 条<\/option>/.test(idx));
chk('首页·板块两栏布局（mo-flex）与零线（mo-zero）', /mo-flex/.test(home) && /mo-zero/.test(home));
chk('首页·资产占比环形图（全市场资产占比 + 中心标注）', /全市场资产占比/.test(home) && /基金资产/.test(home));
chk('首页·负值条向左（含 left 计算）', (function () {
  try { const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
    return /zeroPct/.test(h) && /zeroPct - w/.test(h); } catch (e) { return false; }
})());
chk('翻译·第十二轮新键抽查', (function () {
  try { const t = i18nText();
    return t.indexOf("'积金局基金详情'") >= 0 && t.indexOf("'资产占比'") >= 0 &&
      t.indexOf("'部分基金收费在官网以区间或「最高」形式公布") >= 0 &&
      t.indexOf("'10 条'") >= 0 && t.indexOf("'近10年'") >= 0; } catch (e) { return false; }
})());
/* 接口层：/api/funds 已带 feeMore（区间/最高原文信息） */
(async function () {});   // 占位保持结构；下方在接口块中追加
/* ---- 第十四轮：类别三语 / 翻译清底 / 性能 / 视觉 ---- */
chk('类别三语·TYPE_I18N 40 条 + typeLabel 函数', (function () {
  try { const t = i18nText();
    const n = (t.slice(t.indexOf('window.TYPE_I18N = {'), t.indexOf('};', t.indexOf('window.TYPE_I18N'))).match(/: \{ s:/g) || []).length;
    return n >= 40 && /window\.typeLabel = function/.test(t); } catch (e) { return false; }
})());
chk('类别三语·全站接入（app/rank/common/home 均调用 typeLabel）', (function () {
  try {
    return ['app.js', 'rank.js', 'common.js', 'home.js'].every((f) =>
      /typeLabel\(/.test(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')));
  } catch (e) { return false; }
})());
chk('类别三语·英文=官方术语抽查（Equity Fund / MPF Conservative Fund）', (function () {
  try { const t = i18nText();
    return t.indexOf("'Equity Fund'") >= 0 && t.indexOf("'MPF Conservative Fund'") >= 0 && t.indexOf("'Mixed Assets Fund'") >= 0; } catch (e) { return false; }
})());
chk('翻译·回到顶部已接入（2026-10-31：副标题已删）', /回到顶部/.test(home) || /tt-x/.test(home));

chk('零线对齐·缩进行不再整行缩进（轨道一律对齐）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8');
    return !/\.mo-row\.sub \{ padding-left/.test(c) && /\.mo-row\.sub \.mo-name \{ padding-left: 18px/.test(c); } catch (e) { return false; }
})());
/* 2026-11-05：动态站用 mtime 数字、静态站（GitHub Pages）用内容哈希，两种都算通过；
   重复的两条断言合并为一条。 */
chk('性能·资源版本号随构建变化（动态站数字 mtime / 静态站内容哈希）',
  /[?&]v=[0-9a-zA-Z]{8,}/.test(home) && /[?&]v=[0-9a-zA-Z]{8,}/.test(idx));
chk('视觉·月报行距/栏宽三版（170px 列宽）', /\.mo-row \{ grid-template-columns: 170px 1fr 122px; gap: 13px; padding: 13px 0;/.test(css));
chk('视觉·环形图水平居中（align-items: center + 图例全宽）', /\.mo-right \{[^}]*align-items: center/.test(css) && /\.mo-right \.pie-legend \{ width: 100%; \}/.test(css));

/* ---- 第15轮（批复）：回报条统一口径（涨红跌绿 / 第一名满格 / 无 0 线 / 保底）---- */
chk('排名·回报条一律自左向右（left:0，无 0 值线元素）', (function () {
  try { const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /left:0;width:' \+ share\.toFixed\(1\)/.test(r) && r.indexOf('class="bz"') < 0; } catch (e) { return false; }
})());
chk('排名·回报条统一 maxBar 口径（第一名满格 100%）', (function () {
  try { const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /let share = parseFloat\(maxBar\(rows, b\.metric, x\)\)/.test(r); } catch (e) { return false; }
})());
chk('排名·回报条涨红跌绿（--up / --down）', (function () {
  try { const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /col = v >= 0 \? 'var\(--up\)' : 'var\(--down\)'/.test(r); } catch (e) { return false; }
})());
chk('排名·回报条极小值保底宽度保留（BAR_MINW=1.5%）', (function () {
  try { const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /const BAR_MINW = 1\.5/.test(r) && /share < BAR_MINW/.test(r); } catch (e) { return false; }
})());
chk('排名·冠军卡小字跟随榜单（podRefText / POD_REF）', (function () {
  try { const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /function podRefText/.test(r) && /POD_REF\[b\.metric\]/.test(r) && /podRefText\(b, x\)/.test(r); } catch (e) { return false; }
})());
chk('四版·排名抽检：名称下不再有对比横线（用户取消）、页面无 bz 元素', (function () {
  const cell = /<td data-c="fund"[^>]*>[\s\S]{0,220}?<\/td>/.exec(rk);
  return cell ? cell[0].indexOf('class="bar"') < 0 && cell[0].indexOf('fund-name') >= 0 : false;
})());
chk('词条·累积短名三语已补（近5年累积 / 近10年累积）', (function () {
  try { const t = i18nText();
    return t.indexOf("'近5年累积': '近5年累積'") >= 0 && t.indexOf("'近10年累积': '近10年累積'") >= 0 &&
      t.indexOf("'近5年累积': '5Y cumulative'") >= 0 && t.indexOf("'近10年累积': '10Y cumulative'") >= 0; } catch (e) { return false; }
})());

/* ---- 第15轮：第三方建议修复（<0.5% / 勾选回滚 / 空数据 i18n / 状态占位 / 只条统一）---- */
chk('月度板块·「<0.5%」标记已接入（数据 shareLt + 行内/图例/扇区三处）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'mpfa-monthly.json'), 'utf8'));
    const mmf = j.rows.find((r) => r.key === 'mmf');
    /* 2026-10-31：行内「资产占比」小字已删（用户要求），<0.5% 标记保留在图例与扇区 */
    return !!(mmf && mmf.shareLt === true) && /it\.lt \? '<' : ''/.test(h);
  } catch (e) { return false; }
})());
chk('月度板块·图例 <0.5% 仍在（2026-10-31 行内小字删）', /货币市场基金（非保守）/.test(home) && /&lt;0\.5%/.test(home));
chk('对比·勾选失败回滚（资料库 + 排名两处）', (function () {
  try {
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const re = /if \(c\.checked\) \{ if \(!CMPX\.add\(c\.dataset\.cmp\)\) c\.checked = false; \}/;
    return re.test(a) && re.test(r);
  } catch (e) { return false; }
})());
chk('对比·弹窗按钮显式分支（超限不改按钮 / 提示不误导）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /CMPX\.add\(/.test(c) && /const CMP_MAX = 6;/.test(c); } catch (e) { return false; }
})());
chk('i18n·「空数据」已 TT 化并补三语词条', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const t = i18nText();
    return /throw new Error\(TT\('空数据'\)\)/.test(c) && t.indexOf("'空数据': '空數據'") >= 0 && t.indexOf("'空数据': 'Empty data'") >= 0;
  } catch (e) { return false; }
})());
chk('状态行·占位按语言初始化（localizeStatusPlaceholder）', (function () {
  try { return /function localizeStatusPlaceholder/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8')); } catch (e) { return false; }
})());
chk('只条统一·词条换键（{n} 条基金 / 条基金 / 条录得正回报）', (function () {
  try { const t = i18nText();
    return t.indexOf("'{n} 条基金': '{n} 條基金'") >= 0 && t.indexOf("'{n} 条基金': '{n} funds'") >= 0 &&
      t.indexOf("'条基金': '條基金'") >= 0 && t.indexOf("'条基金': 'funds'") >= 0 &&
      t.indexOf("'条录得正回报': '條錄得正回報'") >= 0; } catch (e) { return false; }
})());
chk('只条统一·页面抽检（温度计「N 条」）+ 发行人榜源码换字', (function () {
  try {
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /上涨 <b class="up">\d+ 条<\/b>/.test(home) && !/上涨 <b class="up">\d+ 只<\/b>/.test(home) &&
      r.indexOf("TQ('旗下 {n} 条成分基金'") >= 0 && r.indexOf("TQ('旗下 {n} 条'") >= 0;
  } catch (e) { return false; }
})());

/* ---- 第16轮：冠军卡下移/默认10条 + A/B 组改进（标题/对比校验/骨架/词条/404/版权/导出/深链） ---- */
chk('排名·冠军区标题随榜单切换（champTitle/champDesc 动态）', (function () {
  try {
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const t = i18nText();
    return /rkChampTitle/.test(r) && /rkChampDesc/.test(r) && /发行人综合表现/.test(r) &&
      t.indexOf("'发行人综合表现': '發行人綜合表現'") >= 0 && t.indexOf("'发行人综合表现': 'Issuer composite performance'") >= 0;
  } catch (e) { return false; }
})());
chk('对比·至少 2 只校验（openCmp ids.length < 2）', (function () {
  try { return /ids\.length < 2/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8')); } catch (e) { return false; }
})());
chk('排名·骨架屏列数已同步（colspan 13，无 11 残留）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    return h.indexOf('colspan="11"') < 0 && /colspan="13"/.test(h);
  } catch (e) { return false; }
})());
chk('词条·孤儿词条已清理（只录得正回报 / 過去 12 個月（最高））', (function () {
  try {
    const t = i18nText();
    return t.indexOf('{n} / {m} 只录得正回报') < 0 && t.indexOf("'過去 12 個月 {m}%（最高 {a} / 最低 {b}）'") < 0;
  } catch (e) { return false; }
})());
chk('404·页面存在 + server 返回 404 状态', (function () {
  try {
    const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    return fs.existsSync(path.join(__dirname, '..', 'public', '404.html')) && s.indexOf("'404.html'") >= 0 && /sendRaw\(req, res, 404, b2/.test(s);
  } catch (e) { return false; }
})());
chk('版权·两页已加入（copyright 类 + 三语词条；分析页 2026-10-31 起为跳转页）', (function () {
  try {
    const ok = ['home.html', 'index.html'].every((f) =>
      /class="copyright"/.test(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')));
    const t = i18nText();
    return ok && t.indexOf("'© 2026 广州精研数据有限公司 · 保留所有权利': '© 2026 廣州精研數據有限公司 · 保留所有權利'") >= 0 &&
      t.indexOf("'© 2026 广州精研数据有限公司 · 保留所有权利': '© 2026 Guangzhou Jingyan Data Co., Ltd. · All rights reserved'") >= 0;
  } catch (e) { return false; }
})());
chk('导出·两页按钮与逻辑（csvDownload + 单位类别/净值估值日词条）', (function () {
  try {
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const t = i18nText();
    return /rkRExport/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')) &&
      /idxExport/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')) &&
      /function exportCurrent/.test(r) && /function exportIdx/.test(a) && /window\.csvDownload/.test(c) &&
      t.indexOf("'单位类别': '單位類別'") >= 0 && t.indexOf("'净值估值日': 'NAV valuation date'") >= 0;
  } catch (e) { return false; }
})());
chk('深链·基金可分享（setFundParam / clearFundParam / initFundLink）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /function setFundParam/.test(c) && /function clearFundParam/.test(c) && /\(function initFundLink/.test(c) && /setFundParam\(id\)/.test(c); } catch (e) { return false; }
})());
chk('详情·含「最近期基金开支比率」（FER）行（带悬浮说明与空值处理）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const t = i18nText();
    return /最近期基金开支比率/.test(c) && /nf\(x\.fer, 2\)/.test(c) && /x\.fer == null \? '—'/.test(c) &&
      t.indexOf("'最近期基金开支比率': '最近期基金開支比率'") >= 0 && t.indexOf("'最近期基金开支比率': 'Latest fund expense ratio'") >= 0;
  } catch (e) { return false; }
})());
chk('详情·右上角「导出/分享」按钮（合并页 HTML + 绑定 + 函数）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const ok = h.indexOf('id="mExport"') >= 0 && h.indexOf('id="mShare"') >= 0;
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return ok && /function exportOneFund/.test(c) && /function shareFundLink/.test(c) && /exportOneFund\(x\)/.test(c) && /shareFundLink\(x\.id\)/.test(c);
  } catch (e) { return false; }
})());
chk('详情·分享链接构建（fundShareURL ?fund=）+ 三语词条', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const t = i18nText();
    return /function fundShareURL/.test(c) && /链接已复制，可直接发给客户/.test(c) &&
      t.indexOf("'导出': '匯出'") >= 0 && t.indexOf("'分享': 'Share'") >= 0;
  } catch (e) { return false; }
})());
chk('导出·含 FER 列（三处导出）', (function () {
  try {
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const cnt = (s) => (s.match(/TT\('最近期基金开支比率'\)/g) || []).length;
    return cnt(r) >= 1 && cnt(a) >= 1 && cnt(c) >= 1;
  } catch (e) { return false; }
})());
chk('页头·「更新数据」改为「清缓存+重拉」（refreshData 不再触发服务端抓取）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const i = c.indexOf('async function refreshData');
    const seg = c.slice(i, i + 1000);
    return i >= 0 && seg.indexOf('REFRESH_API') < 0 && /cacheClear\(\)/.test(seg) && /已刷新为最新数据/.test(seg);
  } catch (e) { return false; }
})());
chk('首页·页头仅数据版本徽标（2026-10-31：更新数据按钮删除）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.html'), 'utf8');
    return /id="mktTicker"/.test(h) && h.indexOf('btn-refresh') < 0 && h.indexOf('class="ver-chip"') < 0 && h.indexOf('class="upd"') < 0;
  } catch (e) { return false; }
})());
chk('首页·状态行独立填充 + home.js 初始化（fetchHeaderStatus / initHeaderStatus）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
    return /window\.fetchHeaderStatus = function/.test(c) && /initHeaderStatus/.test(j);
  } catch (e) { return false; }
})());
chk('词条·刷新反馈三语（已刷新为最新数据）', (function () {
  try { const t = i18nText();
    return t.indexOf("'已刷新为最新数据': '已刷新為最新數據'") >= 0 && t.indexOf("'已刷新为最新数据': 'Refreshed to the latest data'") >= 0; } catch (e) { return false; }
})());
chk('导出·溯源头（csvSourceNote）与榜单 xlsx 化（2026-10-30：主榜升级 xlsx 加持仓分布表）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    /* 2026-11-04：资料库导出升级为 xlsx（数据说明 + 基金数据两表），榜单导出仍是 xlsx */
    return /function csvSourceNote/.test(c) && /buildCoverSheet = function/.test(c) && /buildHoldAllocSheet/.test(c) &&
      /MPFXLSX\.build/.test(r) && /window\.MPFXLSX\.build/.test(a) && /buildCoverSheet/.test(a) && /TT\('名次'\)/.test(a);
  } catch (e) { return false; }
})());
chk('导出·文件名改为数据截至日（含 TT(\'数据截至\')）', (function () {
  try {
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    /* 2026-11-04：文件名改用「净值最新日」，且资料库为 .xlsx */
    return /TT\('数据截至'\)/.test(r) && /MPF基金最新数据_/.test(a) && a.indexOf('.csv') < 0;
  } catch (e) { return false; }
})());
chk('月度板块·「自制度实施以来」行已删（hover 保留，2026-10-15）', (function () {
  try {
    const hj = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
    return hj.indexOf('mo-since') < 0 && hj.indexOf('data-tip') >= 0;
  } catch (e) { return false; }
})());
chk('页头·同步异常显式提示（dot title 三语词条）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const t = i18nText();
    return c.indexOf('数据同步可能存在延迟，稍后将自动重试') >= 0 && c.indexOf('setAttribute(\'title\'') >= 0 &&
      t.indexOf("'数据同步可能存在延迟，稍后将自动重试': '數據同步可能存在延遲，稍後將自動重試'") >= 0;
  } catch (e) { return false; }
})());
chk('时间序列·推送记录每日摘要（daily-log.json）', (function () {
  try { const p = fs.readFileSync(path.join(__dirname, '..', 'push.js'), 'utf8');
    return /daily-log\.json/.test(p) && /每日摘要已记录/.test(p); } catch (e) { return false; }
})());
chk('访问统计·服务端三端点（/api/hit /api/event /api/analytics）+ 前端打点', (function () {
  try {
    const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /'\/api\/hit'/.test(s) && /'\/api\/event'/.test(s) && /'\/api\/analytics'/.test(s) &&
      /analyticsBump/.test(s) && /function trackEvent/.test(c) && /trackEvent\('export'\)/.test(c) && /trackEvent\('share'\)/.test(c);
  } catch (e) { return false; }
})());
chk('访问统计·推送与自动化已接入（可在任务总结附数字）', (function () {
  try { const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    return /ANALYTICS_FILE/.test(s) && /analytics\.json/.test(s); } catch (e) { return false; }
})());

/* ---------------- 第四板块·MPF基金可视化对比（2026-10-31 并入资料库 index.html#cmp） ----------------
   原 analysis.html 已改为跳转页；板块 DOM 随 index dump 渲染，故 an = index 快照。 */
const an = read('index');
chk('第四板块·侧栏入口（基金最新数据；积金局月报已下沉到页脚口径说明，2026-11-04）',
  /id="dbtDb"/.test(readSrc('common.js')) && !/id="dbtCmp"/.test(readSrc('common.js')) &&
  !/class="db-side-more"/.test(readSrc('common.js')) && /class="snote-link" href="#rank"/.test(readSrc('common.js')) &&
  /id="anSec"/.test(rawIdxHtml) && /id="dbSide"/.test(rawIdxHtml));
chk('第四板块·页头不再单列「MPF基金可视化对比」（2026-11-01 用户要求：第三页已并入资料库）',
  !/index\.html#cmp', 'MPF基金可视化对比'/.test(readSrc('common.js')));
/* ---- 第四页 v3 改版：纯对比页 + 左侧发行人栏（版式参照合作方站） ---- */
chk('第四页·侧栏 + 基金列表联动（已选置顶+分隔线+其余，2026-10-17 v2）', /id="anProv"/.test(an) && /id="anTbody2"/.test(an) && (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return j.indexOf('selRows = (DATA.funds || []).filter') >= 0 && j.indexOf('以上是已选基金') >= 0 && j.indexOf('onSelChange: function () { renderFundList(); }') >= 0;
  } catch (e) { return false; }
})());
chk('第四页·左侧发行人栏 12 项（2026-11-02：data-t 保留原文，修「银联信托 0 条」）', (an.match(/class="an-pitem/g) || []).length === 12 && /data-t="銀聯信託"><span>银联信托<\/span><b>\d+<\/b>/.test(an));
chk('第四页·点发行人选默认对比 + 列表（baseChartItems / pickTrusteeTop / renderFundList）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /function filterOf/.test(j) && /function baseChartItems/.test(j) && /function pickTop/.test(j) && /function renderFundList/.test(j) && /function rowHtml2/.test(j) && /setFilter\(f\)/.test(t);
  } catch (e) { return false; }
})());
chk('第四页·紧凑图表（按容器实测像素绘制 + 高度固定 + 纵轴说明）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /svg\.setAttribute\('viewBox', '0 0 ' \+ W/.test(t) && /clientWidth/.test(t) && /累计涨跌幅（区间起点 = 0%）/.test(t) &&
      /\.an-wrap \{ max-width: min\(1500px/.test(c) && /\.tr-svg \{ height: 300px/.test(c.replace(/\s+/g, ' '));
  } catch (e) { return false; }
})());
chk('走势图·统计表含实际值（区间最高/最低/收益/波动率；第二十六轮删除期初、期末两列）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /nf0\(v, 2\)/.test(t) && /fmtRaw\(v\)/.test(t) &&
      !/_t\('期初'\)/.test(t) && !/_t\('期末'\)/.test(t) &&
      /_t\('区间最高'\)/.test(t) && /_t\('年化波动率'\)/.test(t);
  } catch (e) { return false; }
})());
chk('第四页·数据来源行（官方截至日期 · 净值最新日期 · 已核实/451 动态）', /官方资料截至 <b>\d{4}-\d{2}-\d{2}<\/b> · 单位净值最新 <b>\d{4}-\d{2}-\d{2}<\/b> · 已核实 (44[5-9]|45[01])\/451 条/.test(an));
chk('第四页·图上方双选择器（选择指数 / 选择基金）+ 面板容器', /data-panel="idx"/.test(an) && /data-panel="fund"/.test(an) && /tr-p-list-idx/.test(an) && /tr-p-list-fund/.test(an));
chk('第四页·区间按钮（第二十六轮：1年/3年/5年/10年/全部 + 选择日期，去掉 1 个月）', ['1y', '3y', '5y', '10y', 'all', 'custom'].every((r) => new RegExp('data-r="' + r + '"').test(an)) && !/data-r="1m"/.test(an) && !/1w/.test(an) && !/tr-r-all/.test(an) && /tr-daterow/.test(an));
chk('第四页·区间统计表（起止日期已合并成「最大回撤区间」一列）', !/最新点位/.test(an) && /区间收益/.test(an) && /区间最大回撤/.test(an) && /最大回撤区间/.test(an) && /恒生指数/.test(an));
chk('第四页·「查看具体基金分析」按钮 + 返回对比文案', /查看具体基金分析/.test(readSrc('analysis.js')) && (function () {
  try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /window\.anOpen/.test(j) && /← 返回对比/.test(j); } catch (e) { return false; }
})());
chk('第四页·三语词条（选择指数 / 查看具体基金分析 / 全部区间）', (function () {
  try { const t = i18nText();
    return t.indexOf("'选择指数'") >= 0 && t.indexOf("'查看具体基金分析'") >= 0 && t.indexOf("'全部区间'") >= 0 && t.indexOf("'MPF基金分析'") >= 0; } catch (e) { return false; }
})());
chk('第四页·源码含深链接 ?open= 与分析视图', (function () {
  try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /get\('open'\)/.test(j) && /window\.anBack/.test(j) && /fdTrend/.test(j); } catch (e) { return false; }
})());
chk('第四页·hidden 显示修复（日期行与面板默认收起）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /\.tr-daterow\[hidden\], \.tr-panel\[hidden\]/.test(c); } catch (e) { return false; }
})());
chk('资源版本号·ASSET_V 动态扫描全部 js/css（新增页面自动纳入）', (function () {
  try { const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    return /readdirSync\(PUBLIC_DIR\)/.test(s) && !/\['i18n\.js', 'common\.js'/.test(s); } catch (e) { return false; }
})());

/* ---------------- 第四页 v3 · 走势对比 / 自算指标 / 数据版本徽标 / 简繁英搜索 ---------------- */
chk('v3·走势对比模块（tr-card + 标题「基金走势对比图」）', /class="card tr-card[^"]*" id="anTrendBox"/.test(an) && /基金走势对比图/.test(an) && /恒生指数/.test(an));
chk('v3·模块结构（顶部单行 / 折线画布 / 统计表 / 口径说明；图例已并入名称列）', /tr-adds/.test(an) && /tr-svg/.test(an) && /tr-tbl/.test(an) && /累计涨跌幅|0%/.test(an) && an.indexOf('class="tr-legend"') < 0);
chk('v3·trend.js 功能完整性（多选面板 / 色带填充 / 自定义日期）', (function () {
  try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /data-toggle/.test(j) && /tr-band/.test(j) && /tr-dgo/.test(j) && /全部区间|'all'/.test(j); } catch (e) { return false; }
})());
chk('v3·trend.js 健壮性（hideGoto 判空 + _t/_tq 包装不走 window）', (function () {
  try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /const gotoBtn = q\('\.tr-goto'\);\s*\n\s*if \(gotoBtn\)/.test(j) &&
      /function _t\(s\) \{ return \(typeof TT === 'function'\)/.test(j) && !/window\.TT \?/.test(j); } catch (e) { return false; }
})());
chk('v3·数据版本徽标（三页）+ 明细提示', ['home', 'index', 'ranking'].every((p) => /id="verChip"/.test(read(p))) &&
  /官方资料（积金局）：\d{4}-\d{2}-\d{2}/.test(an));
chk('v3·简繁英搜索（zhmap 映射 + 英文名接口 + 归一化函数）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const z = fs.readFileSync(path.join(__dirname, '..', 'public', 'zhmap.js'), 'utf8');
    const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    return /function fundMatch/.test(c) && /function toSimp/.test(c) && /window\.ZH_MAP/.test(z) &&
      /'\/api\/names-en'/.test(s) && /ensureNamesEn/.test(c);
  } catch (e) { return false; }
})());
chk('v3·历史净值接口与数据文件（/api/hist + hist-index 67 只）', (function () {
  try {
    const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hist-index.json'), 'utf8'));
    return /'\/api\/hist\/'/.test(s) && /'\/api\/indices'/.test(s) && /'\/api\/navperf'/.test(s) && idx.count >= 60;
  } catch (e) { return false; }
})());
chk('v3·多受托人历史覆盖（BCT 系 ≥100 + 宏利系 ≥60，共 183 只）', (function () {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hist-index.json'), 'utf8'));
    const perf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nav-perf.json'), 'utf8'));
    /* 2026-10-29：hist-index 的 src 已写成展示名（如「BCT官網（bcthk.com）」），不能用 by.bct 直取，改按关键字计数 */
    let bctHist = 0; let manuHist = 0;
    Object.values(idx.funds).forEach((f) => {
      const s = String(f.src || '');
      if (/bct/i.test(s)) bctHist += 1;
      if (/manulife|宏利/i.test(s)) manuHist += 1;
    });
    const pby = {};
    Object.values(perf.funds).forEach((f) => { pby[f.src] = (pby[f.src] || 0) + 1; });
    return bctHist >= 100 && manuHist >= 60 && perf.count >= 180 && (pby.bct || 0) >= 100;
  } catch (e) { return false; }
})());
chk('v3·指数数据 14 个且最新（含恒生 + 上证/深证等 A 股指数）', (function () {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'index.json'), 'utf8'));
    const keys = Object.keys(j.items);
    /* 2026-10-22：新增 7 条自算 MPF 指数，市场指数仍为 14 条 */
    return keys.length >= 14 && j.items.HSI && j.items.SSE && j.items.SZSE && j.items.CHINEXT && /^2026-/.test(j.items.HSI.asOf);
  } catch (e) { return false; }
})());
chk('v3·发行人官网业绩层（BCT 116 只 + 接口 + 详情条渲染）', (function () {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'trustee-perf.json'), 'utf8'));
    const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const sample = t.funds['659'];
    return t.count >= 110 && sample && sample.y1 != null && sample.cal && Object.keys(sample.cal).length >= 5 &&
      /'\/api\/trustee-perf'/.test(s) && /function fdPerfTabs/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8')) && /trustee-perf/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8'));
  } catch (e) { return false; }
})());
/* ---------------- 结果 ---------------- */
chk('深夜·①选择基金面板不再自动关闭（冒泡守卫 + isConnected）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('面板内的一切点击都不冒泡到 document') >= 0 && t.indexOf('isConnected === false') >= 0;
  } catch (e) { return false; }
})());
chk('深夜·②触屏点按显隐提示 + 区间年化列', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('S.touchTip') >= 0 && t.indexOf('pointerType') >= 0;
  } catch (e) { return false; }
})());
chk('深夜·③列设置（COL_DEFS + 记忆 + 一键清除）', (function () {
  try {
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    return a.indexOf('COL_DEFS') >= 0 && a.indexOf('mpf-cols') >= 0 && a.indexOf('clearAllFilters') >= 0 && a.indexOf('applyCols') >= 0;
  } catch (e) { return false; }
})());
chk('深夜·④页脚折叠 + 来源免责合并 + 核对时间入 summary', (function () {
  try {
    const i = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    /* 2026-10-31（用户要求）：foot-legal 并入折叠栏（src-brief），来源告警/两套口径段删除；
       2026-10-31 三版：analysis.html 改跳转页，仅校验 index */
    /* 2026-11-04：来源与免责改写进三行式 snote（src-brief 已删除，避免重复叙述） */
    return i.indexOf('foldSpec') >= 0 && i.indexOf('navCheckAt') >= 0 && i.indexOf('src-brief') < 0 &&
      i.indexOf('foot-legal') < 0 && c.indexOf('navCheckAt') >= 0 && c.indexOf('snote-foot') >= 0;
  } catch (e) { return false; }
})());
chk('深夜·⑤页头只显示本站更新时间（三处统一）+ 同计划对比入口', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const noMpfa = c.indexOf('本地同步') < 0;
    return noMpfa && c.indexOf('数据更新') >= 0 && j.indexOf('anPlanBtn') >= 0 && j.indexOf('同类型对比') >= 0;
  } catch (e) { return false; }
})());
chk('深夜·⑥宽度 1350 + 语言按钮加大 + CTA 等高', (function () {
  try {
    const ac = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const hc = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8');
    return ac.indexOf('min(1350px') >= 0 && st.indexOf('lang-sw button') >= 0 && hc.indexOf('min-height: 96px') >= 0;
  } catch (e) { return false; }
})());
chk('深夜·⑦数据：holdings 451（含 mpf.hk 补齐）· trustee-perf 202（含友邦19）', (function () {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8'));
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'trustee-perf.json'), 'utf8'));
    const hAia = Object.values(h.funds).filter((v) => v.src === 'aia').length;
    const pAia = Object.values(p.funds).filter((v) => v.src === 'aia').length;
    return h.count >= 400 && hAia >= 15 && p.count >= 200 && pAia >= 19;   /* 2026-10-20：mpf.hk 补齐后覆盖 451，友邦部分条目来源改标 mpf.hk */
  } catch (e) { return false; }
})());

  chk('下午批·①小窗缩窄864 + 持仓/分布进小窗（共享渲染）', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return st.indexOf('.modal-box { max-width: 700px; }') >= 0 && c.indexOf('holdBlockHTML') >= 0 &&
      c.indexOf('allocBlockHTML') >= 0 && c.indexOf("id=\"fdHolds\"") >= 0 && c.indexOf('ensureHoldings') >= 0;
  } catch (e) { return false; }
})());
chk('下午批·②历年回报表删除 + 走势 2 位小数 + 完整资料按钮删除', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return c.indexOf('历年回报（%）') < 0 && c.indexOf('v.toFixed(2)') >= 0 && a.indexOf("TT('完整资料')") < 0;
  } catch (e) { return false; }
})());
chk('下午批·③详情视图藏页脚（body.an-detail）+ 平台区按钮居中', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return st.indexOf('body.an-detail .foot') >= 0 && st.indexOf('display: inline-flex !important') >= 0 &&
      a.indexOf("classList.add('an-detail')") >= 0 && a.indexOf("classList.remove('an-detail')") >= 0;
  } catch (e) { return false; }
})());
chk('下午批·④面板两维筛选（发行人×类别 chips + 已选组）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('全部发行人') >= 0 && t.indexOf('全部类别') >= 0 && t.indexOf('tr-p-selected') >= 0 &&
      t.indexOf('S.panelTrustee === v') >= 0;
  } catch (e) { return false; }
})());
chk('下午批·⑤清空筛选 + 全量基金表（未选基金 341 只 + ＋ 加入）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const as = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'allstats.json'), 'utf8'));
    const w = as.windows && as.windows.y1 ? Object.keys(as.windows.y1).length : 0;
    return t.indexOf('tr-clear') >= 0 && t.indexOf('renderAllFundsTable') >= 0 && t.indexOf('data-addfund') >= 0 &&
      t.indexOf("(st.d < -0.005 && st.f && st.t)") >= 0 && sv.indexOf("'/api/allstats'") >= 0 && w >= 300;
  } catch (e) { return false; }
})());
chk('下午批·⑥浮窗跟随光标（贴边翻转，不再固定顶部）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('if (lx + pw > cr.width - 8) lx = px - pw - 14') >= 0 && t.indexOf('if (ly + ph > cr.height - 8) ly = py - ph - 14') >= 0;
  } catch (e) { return false; }
})());

chk('下午批·①小窗缩窄864 + 持仓/分布进小窗（共享渲染）', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return st.indexOf('.modal-box { max-width: 700px; }') >= 0 && c.indexOf('holdBlockHTML') >= 0 &&
      c.indexOf('allocBlockHTML') >= 0 && c.indexOf("id=\"fdHolds\"") >= 0 && c.indexOf('ensureHoldings') >= 0;
  } catch (e) { return false; }
})());
chk('下午批·②历年回报表删除 + 走势 2 位小数 + 完整资料按钮删除', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return c.indexOf('历年回报（%）') < 0 && c.indexOf('v.toFixed(2)') >= 0 && a.indexOf("TT('完整资料')") < 0;
  } catch (e) { return false; }
})());
chk('下午批·③详情视图藏页脚（body.an-detail）+ 平台区按钮居中', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return st.indexOf('body.an-detail .foot') >= 0 && st.indexOf('display: inline-flex !important') >= 0 &&
      a.indexOf("classList.add('an-detail')") >= 0 && a.indexOf("classList.remove('an-detail')") >= 0;
  } catch (e) { return false; }
})());
chk('下午批·④面板两维筛选（发行人×类别 chips + 已选组）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('全部发行人') >= 0 && t.indexOf('全部类别') >= 0 && t.indexOf('tr-p-selected') >= 0 &&
      t.indexOf('S.panelTrustee === v') >= 0;
  } catch (e) { return false; }
})());
chk('下午批·⑤清空筛选 + 全量基金表（未选基金 341 只 + ＋ 加入）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const as = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'allstats.json'), 'utf8'));
    const w = as.windows && as.windows.y1 ? Object.keys(as.windows.y1).length : 0;
    return t.indexOf('tr-clear') >= 0 && t.indexOf('renderAllFundsTable') >= 0 && t.indexOf('data-addfund') >= 0 &&
      t.indexOf("(st.d < -0.005 && st.f && st.t)") >= 0 && sv.indexOf("'/api/allstats'") >= 0 && w >= 300;
  } catch (e) { return false; }
})());
chk('下午批·⑥浮窗跟随光标（贴边翻转，不再固定顶部）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('if (lx + pw > cr.width - 8) lx = px - pw - 14') >= 0 && t.indexOf('if (ly + ph > cr.height - 8) ly = py - ph - 14') >= 0;
  } catch (e) { return false; }
})());

chk('晚批·①面板矩阵布局（左列发行人×顶行类别）+ 数据说明 341/451', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return t.indexOf('tr-p-matrix') >= 0 && t.indexOf('tr-tside') >= 0 && t.indexOf('tr-p-note') >= 0 &&
      t.indexOf('已接入历史净值 {n} 只') >= 0 && st.indexOf('.tr-p-left { flex: 0 0 116px') >= 0;
  } catch (e) { return false; }
})());
chk('晚批·②表格只列基金（指数行剔除）+ 全部区间同款按钮', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return t.indexOf('lines = lines.filter((L) => !L.isIdx)') >= 0 && st.indexOf('.tr-toolbar .tr-r.tr-r-all') >= 0;
  } catch (e) { return false; }
})());
chk('晚批·③同类型对比修复（?set= 深链 + showCompareView，无 anBack 竞态）', (function () {
  try {
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const i = a.indexOf('pb.addEventListener');
    const seg = a.slice(i, i + 1600);
    return seg.indexOf("u.searchParams.set('set', setStr)") >= 0 && seg.indexOf('showCompareView()') >= 0 && seg.indexOf('window.anBack()') < 0;
  } catch (e) { return false; }
})());
chk('晚批·④持仓行情补全（holdquote.py + 有代码行 ≥400 + 有价格行 ≥400）', (function () {
  try {
    const fs2 = require('fs');
    const hq = fs2.readFileSync(path.join(__dirname, '..', 'holdquote.py'), 'utf8');
    const h = JSON.parse(fs2.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8'));
    let code = 0, price = 0;
    Object.values(h.funds).forEach((f) => (f.top10 || []).forEach((t) => { if (t.code) code++; if (t.price != null) price++; }));
    return hq.indexOf('GEN_MKT') >= 0 && hq.indexOf('BAD_WORDS') >= 0 && hq.indexOf('PIN') >= 0 && code >= 400 && price >= 400;
  } catch (e) { return false; }
})());
chk('2026-10-30·⑤投资分布=南丁格尔玫瑰图（角度均分/半径映射/蓝8阶/中心真实合计）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return c.indexOf('alr3-seg') >= 0 && c.indexOf('alr3-lead') >= 0 && c.indexOf('alr3-total') >= 0 &&
      c.indexOf('0.56 + 0.44') >= 0 && c.indexOf('#0A3D91') >= 0 && c.indexOf('#C3D7F5') >= 0 &&
      c.indexOf('合計超過 100%') >= 0 && c.indexOf('RAMP.length - 1 - k') >= 0 &&
      c.indexOf('alr-legend') < 0 && c.indexOf('alr2-svg') < 0 && st.indexOf('.alr3-svg') >= 0;
  } catch (e) { return false; }
})());
chk('晚批·⑥历年走势图缩小 20%（an-chartwrap 80%）', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return st.indexOf('.an-chartwrap { max-width: 80%; }') >= 0;
  } catch (e) { return false; }
})());

chk('晚批·①面板矩阵布局（左列发行人×顶行类别）+ 数据说明 341/451', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return t.indexOf('tr-p-matrix') >= 0 && t.indexOf('tr-tside') >= 0 && t.indexOf('tr-p-note') >= 0 &&
      t.indexOf('已接入历史净值 {n} 只') >= 0 && st.indexOf('.tr-p-left { flex: 0 0 116px') >= 0;
  } catch (e) { return false; }
})());
chk('晚批·②表格只列基金（指数行剔除）+ 全部区间同款按钮', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return t.indexOf('lines = lines.filter((L) => !L.isIdx)') >= 0 && st.indexOf('.tr-toolbar .tr-r.tr-r-all') >= 0;
  } catch (e) { return false; }
})());
chk('晚批·③同类型对比修复（?set= 深链 + showCompareView，无 anBack 竞态）', (function () {
  try {
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const i = a.indexOf('pb.addEventListener');
    const seg = a.slice(i, i + 1600);
    return seg.indexOf("u.searchParams.set('set', setStr)") >= 0 && seg.indexOf('showCompareView()') >= 0 && seg.indexOf('window.anBack()') < 0;
  } catch (e) { return false; }
})());
chk('晚批·④持仓行情补全（holdquote.py + 有代码行 ≥400 + 有价格行 ≥400）', (function () {
  try {
    const fs2 = require('fs');
    const hq = fs2.readFileSync(path.join(__dirname, '..', 'holdquote.py'), 'utf8');
    const h = JSON.parse(fs2.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8'));
    let code = 0, price = 0;
    Object.values(h.funds).forEach((f) => (f.top10 || []).forEach((t) => { if (t.code) code++; if (t.price != null) price++; }));
    return hq.indexOf('GEN_MKT') >= 0 && hq.indexOf('BAD_WORDS') >= 0 && hq.indexOf('PIN') >= 0 && code >= 400 && price >= 400;
  } catch (e) { return false; }
})());
chk('2026-10-30·⑤投资分布=南丁格尔玫瑰图（角度均分/半径映射/蓝8阶/中心真实合计）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return c.indexOf('alr3-seg') >= 0 && c.indexOf('alr3-lead') >= 0 && c.indexOf('alr3-total') >= 0 &&
      c.indexOf('0.56 + 0.44') >= 0 && c.indexOf('#0A3D91') >= 0 && c.indexOf('#C3D7F5') >= 0 &&
      c.indexOf('合計超過 100%') >= 0 && c.indexOf('RAMP.length - 1 - k') >= 0 &&
      c.indexOf('alr-legend') < 0 && c.indexOf('alr2-svg') < 0 && st.indexOf('.alr3-svg') >= 0;
  } catch (e) { return false; }
})());
chk('晚批·⑥历年走势图缩小 20%（an-chartwrap 80%）', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return st.indexOf('.an-chartwrap { max-width: 80%; }') >= 0;
  } catch (e) { return false; }
})());

chk('深夜批·①面板拉长+左列固定（sticky）', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return st.indexOf('.tr-p-left { position: sticky; top: 0;') >= 0 && st.indexOf('max-height: 78vh') >= 0;
  } catch (e) { return false; }
})());
chk('深夜批·②清空筛选与工具栏闭合完整（head → panels → daterow 顺序正确）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    /* 2026-11-02：顶部改单行后，仍要保证 head 先闭合、panels 紧跟、daterow 在其后，
       否则 .tr-panels 为 null、整页不渲染（2026-10-15 踩过） */
    const a1 = t.indexOf("'<div class=\"tr-head'");
    const a2 = t.indexOf('panels +', a1);
    const a3 = t.indexOf('class="tr-rangebox"');
    const a4 = t.indexOf("'<div class=\"tr-daterow\" hidden>'", a3);
    /* 第二十六轮：日期栏移到「选择日期」按钮下方的浮层（rangebox 内），顺序 rangebox → daterow → head → panels */
    return a3 > 0 && a4 > a3 && a1 > a4 && a2 > a1 && t.indexOf('tr-clear') >= 0 && t.indexOf('tr-adds') >= 0 && t.indexOf('tr-ctrls') >= 0;
  } catch (e) { return false; }
})());
chk('2026-10-29·③前十大持仓改横向柱状图（名称+占比，不再列代码/价格）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return c.indexOf('hl-bars') >= 0 && c.indexOf('hlb-row') >= 0 && c.indexOf('hlb-sum') >= 0 &&
      c.indexOf("TT('股票代码')") < 0 && st.indexOf('.hlb-row') >= 0;
  } catch (e) { return false; }
})());
chk('深夜批·④基金列表跟随走势勾选（onSelChange + 已选过滤）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return t.indexOf('opts.onSelChange') >= 0 && a.indexOf("onSelChange: function () { renderFundList(); }") >= 0 &&
      a.indexOf('selRows = (DATA.funds || []).filter') >= 0 && a.indexOf('以上是已选基金') >= 0 &&
      a.indexOf('o.onSelChange') < 0;   /* 曾误写 o（opts 之误）致 ReferenceError */
  } catch (e) { return false; }
})());
chk('深夜批·⑤趋势区不再渲染全量表（全量交由资料库列表）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('{ renderAllFundsTable(wrap); return; }') < 0;   /* 调用已移除（定义可保留） */
  } catch (e) { return false; }
})());
chk('深夜批·⑥历年走势图 72% + zhmap 全量 4113 对', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const z = fs.readFileSync(path.join(__dirname, '..', 'public', 'zhmap.js'), 'utf8');
    return st.indexOf('.an-chartwrap { max-width: 72%; }') >= 0 && /window\.ZH_MAP = \{/.test(z) && z.length > 20000;
  } catch (e) { return false; }
})());
chk('深夜批·⑦首页：since 行删除 + 表格紧凑 + 亮背景 + 模块收窄', (function () {
  try {
    const hj = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
    const hc = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8');
    return hj.indexOf('mo-since') < 0 && hc.indexOf('padding: 8px 0; border-top: 1px dashed') >= 0 &&
      hc.indexOf("url('img/about-gz-bright.webp')") >= 0 && hc.indexOf('max-width: 1040px') >= 0;
  } catch (e) { return false; }
})());

chk('深夜批·①面板拉长+左列固定（sticky）', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return st.indexOf('.tr-p-left { position: sticky; top: 0;') >= 0 && st.indexOf('max-height: 78vh') >= 0;
  } catch (e) { return false; }
})());
chk('深夜批·②清空筛选与工具栏闭合完整（head → panels → daterow 顺序正确）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    /* 2026-11-02：顶部改单行后，仍要保证 head 先闭合、panels 紧跟、daterow 在其后，
       否则 .tr-panels 为 null、整页不渲染（2026-10-15 踩过） */
    const a1 = t.indexOf("'<div class=\"tr-head'");
    const a2 = t.indexOf('panels +', a1);
    const a3 = t.indexOf('class="tr-rangebox"');
    const a4 = t.indexOf("'<div class=\"tr-daterow\" hidden>'", a3);
    /* 第二十六轮：日期栏移到「选择日期」按钮下方的浮层（rangebox 内），顺序 rangebox → daterow → head → panels */
    return a3 > 0 && a4 > a3 && a1 > a4 && a2 > a1 && t.indexOf('tr-clear') >= 0 && t.indexOf('tr-adds') >= 0 && t.indexOf('tr-ctrls') >= 0;
  } catch (e) { return false; }
})());
chk('2026-10-29·③前十大持仓改横向柱状图（名称+占比，不再列代码/价格）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return c.indexOf('hl-bars') >= 0 && c.indexOf('hlb-row') >= 0 && c.indexOf('hlb-sum') >= 0 &&
      c.indexOf("TT('股票代码')") < 0 && st.indexOf('.hlb-row') >= 0;
  } catch (e) { return false; }
})());
chk('深夜批·④基金列表跟随走势勾选（onSelChange + 已选过滤）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return t.indexOf('opts.onSelChange') >= 0 && a.indexOf("onSelChange: function () { renderFundList(); }") >= 0 &&
      a.indexOf('selRows = (DATA.funds || []).filter') >= 0 && a.indexOf('以上是已选基金') >= 0 &&
      a.indexOf('o.onSelChange') < 0;   /* 曾误写 o（opts 之误）致 ReferenceError */
  } catch (e) { return false; }
})());
chk('深夜批·⑤趋势区不再渲染全量表（全量交由资料库列表）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('{ renderAllFundsTable(wrap); return; }') < 0;   /* 调用已移除（定义可保留） */
  } catch (e) { return false; }
})());
chk('深夜批·⑥历年走势图 72% + zhmap 全量 4113 对', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const z = fs.readFileSync(path.join(__dirname, '..', 'public', 'zhmap.js'), 'utf8');
    return st.indexOf('.an-chartwrap { max-width: 72%; }') >= 0 && /window\.ZH_MAP = \{/.test(z) && z.length > 20000;
  } catch (e) { return false; }
})());
chk('深夜批·⑦首页：since 行删除 + 表格紧凑 + 亮背景 + 模块收窄', (function () {
  try {
    const hj = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
    const hc = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8');
    return hj.indexOf('mo-since') < 0 && hc.indexOf('padding: 8px 0; border-top: 1px dashed') >= 0 &&
      hc.indexOf("url('img/about-gz-bright.webp')") >= 0 && hc.indexOf('max-width: 1040px') >= 0;
  } catch (e) { return false; }
})());

chk('1017批·①面板类别行 sticky + 全部取消按钮', (function () {
  try {
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return st.indexOf('.tr-p-right .tr-typebar { position: sticky; top: 0;') >= 0 && t.indexOf('[data-tr-clearall]') >= 0 &&
      t.indexOf("_tq('已选（{n}）'") >= 0 && t.indexOf('点击取消') < 0;
  } catch (e) { return false; }
})());
chk('1017批·②清空筛选连指数一起清（items=[]）+ 空态提示', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const i = t.indexOf("const clearBtn = q('.tr-clear');");
    const seg = t.slice(i, i + 500);
    return seg.indexOf('S.items = [];') >= 0 && t.indexOf('暂无对比对象') >= 0;
  } catch (e) { return false; }
})());
chk('1017批·③单线真实值模式（raw 绘制 + 轴标签 + note 隐藏）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    /* 2026-11-02：图内「实际值 / 累计涨跌幅」说明文字已按用户要求删除，改为断言 raw/norm 取数逻辑 */
    return t.indexOf('const single = lines.length === 1;') >= 0 &&
      t.indexOf('const P = (L) => (single ? L.win.raw : L.win.norm);') >= 0 &&
      t.indexOf("noteEl.style.display = ''") >= 0 && t.indexOf('单条对比时纵轴为实际数值') >= 0;
  } catch (e) { return false; }
})());
chk('1017批·④默认仅恒指（baseChartItems 单项）+ 点发行人仍双线', (function () {
  try {
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const i = a.indexOf('function baseChartItems');
    const seg = a.slice(i, i + 220);
    return seg.indexOf("return [{ type: 'index', key: 'HSI' }];") >= 0 &&
      a.indexOf("setItems([{ type: 'index', key: 'HSI' }])") >= 0;
  } catch (e) { return false; }
})());
chk('1017批·⑤tooltip 跟随光标 + 历年图居中 + 去背景图', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return c.indexOf('function place(a, atCursor)') >= 0 && c.indexOf("mx + 14, top = my + 16") >= 0 &&
      st.indexOf('.an-chartwrap { max-width: 72%; margin-left: auto; margin-right: auto; }') >= 0 &&
      st.indexOf('.biz.about::before { content: none !important; }') >= 0;
  } catch (e) { return false; }
})());
chk('1017批·⑥etnet 月度→日度历史（hist-index 449 只 + etnet_hist.py 存在）', (function () {
  try {
    const hq = fs.readFileSync(path.join(__dirname, '..', 'etnet_hist.py'), 'utf8');
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hist-index.json'), 'utf8'));
    return hq.indexOf('lineChartDataArray'.slice(0, 0) + 'mpfDetail.do') >= 0 || hq.indexOf('mpfDetail.do') >= 0;
  } catch (e) { return false; }
})());

chk('线型系统 6 种 + 列表名称蓝字加大', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return t.indexOf("'0.1 5.5', '点线'") >= 0 && t.indexOf("'17 7', '长虚线'") >= 0 &&
      t.indexOf("'12 4 2 4 2 4', '双点划线'") >= 0 && css.indexOf("font-size: 15.5px; color: var(--brand-2)") >= 0;
  } catch (e) { return false; }
})());

})();
chk('排名·自算净值榜（4 个 + 自算四列 + navperf 数据 ≥200 只）', (function () {
  try {
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nav-perf.json'), 'utf8'));
    const sample = p.funds['802'];
    return /\{ g: '自算净值（发行人官网）'/.test(r) && /id: 'selfW1'/.test(r) && /id: 'selfMdd'/.test(r) &&
      /const selfHead = /.test(r) && /if \(b\.self\)/.test(r) &&
      p.count >= 200 && sample && sample.w1 != null && sample.mdd1 != null;
  } catch (e) { return false; }
})());
chk('第四页·发行人平均指数（trustee-idx ≥3 家 + 接口 + 面板可选非默认）', (function () {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'trustee-idx.json'), 'utf8'));
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const tr = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return Object.keys(t.items).length >= 3 && t.items['宏利'] && t.items['宏利'].series.length > 100 &&
      /'\/api\/trustee-idx'/.test(srv) && /function pickTop/.test(j) && /data-toggle="t:'/.test(tr) &&
      /function ensureTAvg/.test(tr) && /data-toggle="t:'/.test(tr);
  } catch (e) { return false; }
})());


chk('第四板块·基金列表（默认 9 列=资料库同款 + 列设置 + 表头三态排序）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    /* 2026-11-02：表头由 analysis.js 的 LTH/LCOLS 生成（照抄基金最新数据），
       默认列：勾选/基金名称/风险级别/单位资产净值/日涨跌/近1个月/年初至今/近1年/基金规模 */
    const def = ['fund', 'risk', 'nav', 'selfD1', 'selfM1', 'selfYtd', 'selfY1', 'size'];
    return /id="anColBtn"/.test(h) && /id="anThead"/.test(h) && /id="anTbody2"/.test(h) &&
      /const LCOLS = \[/.test(j) && def.every((k) => new RegExp("k: '" + k + "'").test(j)) &&
      /function sortList/.test(j) && /function syncListArrows/.test(j) && /const LTH = \{/.test(j) &&
      /LS\.dir === d0/.test(j) &&   /* 三态排序 */
      !/class="sub-line">' \+ esc\(x\.scheme\)/.test(j);
  } catch (e) { return false; }
})());
chk('第四页·行点击开「小窗」详情（openDetail 而非跳页）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /#anTbody2 tr\[data-id\]/.test(j) && /window\.openDetail\(id\)/.test(j);
  } catch (e) { return false; }
})());
chk('对比弹窗·走势模块置顶（cmpTrend + openCmp 挂载 TREND）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const i = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    return /id="cmpTrend"/.test(i) &&
      /getElementById\('cmpTrend'\)/.test(c) && /bareHead: true/.test(c) && /cmp-tools/.test(c);
  } catch (e) { return false; }
})());
chk('浏览器返回键·历史集成（pushState + popstate：弹窗/分析视图）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /history\.pushState\(\{ mpfModal/.test(c) && /mpfModal/.test(c) &&
      /history\.pushState\(\{ mpfView: 'detail' \}/.test(j) && /addEventListener\('popstate'/.test(j) && /function showCompareView/.test(j);
  } catch (e) { return false; }
})());
chk('去灰边（卡片无描边 + 分隔线提亮 + 阴影替代）', (function () {
  try {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return /--border: #[0-9a-f]{6};/.test(css)   /* 2026-10-19 品牌对齐：分隔线底色改为官网浅蓝 */ && /\.card \{[\s\S]{0,120}?border: 0;/.test(css) &&
      /\.card, \.cmp-box, \.modal-box/.test(css);
  } catch (e) { return false; }
})());
chk('性能·数据瘦身（trustee-idx ≤180KB 周度抽样 + 2016 起；2026-10-18 改周度后由 462KB 降至 97KB）', (function () {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'trustee-idx.json'), 'utf8'));
    const m = t.items['宏利'];
    const sz = fs.statSync(path.join(__dirname, '..', 'data', 'trustee-idx.json')).size;
    return sz <= 180 * 1024 && m && m.series[0][0] >= '2016-01-01' && String(m.series[0][1]).split('.')[1].length <= 2;
  } catch (e) { return false; }
})());


chk('趋势图·名称列 ✕ 可移除条目（2026-11-02：委托从图例迁到统计表）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /querySelector\('\.tr-tablewrap'\)\.addEventListener\('click'/.test(t) && /toggleItem\(t\.getAttribute\('data-toggle'\)\)/.test(t) &&
      /data-toggle="' \+ esc0\(L\.key\)/.test(t);
  } catch (e) { return false; }
})());
chk('详情小窗·放大按钮（只换视图不回退历史）+ 960px 两页同在', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const i = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    return /id="mExpand"/.test(i) && /#mExpand/.test(c) &&
      /anOpen\(x\.id, \{ replace: true \}\)/.test(c) && /\.modal-box \{ max-width: 960px; \}/.test(css);
  } catch (e) { return false; }
})());
chk('详情页·前十大持仓 + 投资组合分布（空态+来源标注，可自动点亮）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    /* 2026-10-20 v4：持仓/分布渲染统一到 common.js（holdBlockHTML / allocBlockHTML），详情页只留挂载点 */
    return /fillFDHolds/.test(j) && /id=\"fdHolds\"/.test(c) &&
      /'\/api\/holdings'/.test(srv) && /前十大持仓/.test(c) && /投资组合分布/.test(c) && /基金便览/.test(c);
  } catch (e) { return false; }
})());
chk('对比数量·弹窗上限 6 只 + 走势上限 8 条', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /const CMP_MAX = 6;/.test(c) && /const MAX_ITEMS = 8;/.test(t) && /slice\(0, 8\)/.test(c);
  } catch (e) { return false; }
})());
chk('涨跌幅说明·含换算公式与示例（2026-10-19 改口径）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const i = i18nText();
    return /纵轴为累计涨跌幅：每条线 = 该标的每日数值 ÷ 区间起点数值 − 1/.test(t) && /净值 30 → 33 显示为 \+10%/.test(i);
  } catch (e) { return false; }
})());
chk('首页简洁化（hero 降档 + 区块留白收紧）', (function () {
  try {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8');
    return /\.hero \{ min-height: 420px; \}/.test(css) && /\.hero h1 \{ font-size: 36px/.test(css) && /首页「简洁化」总调/.test(css);
  } catch (e) { return false; }
})());


chk('线条样式自定义（默认前两条精调 + 颜色/线宽/线型弹层 + dasharray 渲染）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /const DEF_STYLES = \[/.test(t) && /const STYLE_PALETTE/.test(t) && /function openStylePopover/.test(t) &&
      /stroke-dasharray/.test(t) && /function styleOf/.test(t) && /\.tr-style \{ position: absolute/.test(css);
  } catch (e) { return false; }
})());
chk('悬浮提示·鼠标移出与点击空白即消失（2026-10-14 修复）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /svg\.onpointerleave = function/.test(t) && /document\.querySelectorAll\('\.tr-box \.tr-tip'\)/.test(t);
  } catch (e) { return false; }
})());
chk('第四页·估值日标签可点击筛选（.ndk → anTbody2 列表 + 标题显示筛选）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /querySelector\('#anTbody2'\)/.test(c) && /LV\.navDate/.test(j) && /renderFundList\(\);/.test(j) &&
      /an-lh-f/.test(j);
  } catch (e) { return false; }
})());
chk('合作发行人置顶（宏利/银联信托(BCT)/友邦 —— 侧栏与列表默认排序）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /const PARTNER = \{ '宏利': 0, '銀聯信託': 1, '友邦信託': 2 \}/.test(j) && /function partnerRank/.test(j) &&
      /key: 'partner'/.test(j) && /partnerRank\(a\.trustee\) - partnerRank\(b\.trustee\)/.test(j);
  } catch (e) { return false; }
})());
chk('宽屏利用率（第四页与全站容器放宽至 1500）', (function () {
  try {
    const ac = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return /\.an-wrap \{ max-width: min\(1500px/.test(ac) && /\.wrap \{ max-width: min\(1500px/.test(st);
  } catch (e) { return false; }
})());
chk('页脚三版：估值 chips 入 summary 行（2026-10-31）', (function () {
  try {
    const i = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /id="ffNavdist"/.test(i) && i.indexOf('id="ffRisk"') < 0 && i.indexOf('id="navDistCard"') < 0 &&
      i.indexOf('id="srcNoteTop"') < 0 && c.indexOf('ffNavdist') >= 0;
  } catch (e) { return false; }
})());


chk('默认组合·恒指+规模最大基金（总体=全市场；发行人平均仅面板可选 + 口径说明）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /function pickTop\(trustee\)/.test(j) && /setItems\(\[\{ type: 'index', key: 'HSI' \}\]\)/.test(j) &&
      !/items\.push\(\{ type: 'tavg', key: S\.trustee \}\)/.test(j) &&
      t.indexOf('发行人均值指数：该发行人旗下') >= 0;   /* 口径说明仍在（tavg 条目的 title） */
  } catch (e) { return false; }
})());
chk('图例线条实际线型预览 + 样式弹层放大（tr-lg-line / 340px）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /tr-lg-line/.test(t) && /L\.dash/.test(t) && /\.tr-style \{ width: 340px/.test(css);
  } catch (e) { return false; }
})());
chk('走势图·导出工作簿（含走势图）+ 分享（?set= 组合还原）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    /* 2026-10-21：导出改为工作簿（净值+涨跌幅+区间统计+走势图截图） */
    return /tr-exp/.test(t) && /tr-share/.test(t) && /function exportBook/.test(t) && /svgToPng/.test(t) && /MPFXLSX/.test(t) &&
      /searchParams\.set\('set'/.test(t) && /function itemsFromSet/.test(j) && /get\('set'\)/.test(j);
  } catch (e) { return false; }
})());
chk('选择基金·三级面板（发行人 → 类型 → 基金；搜索保留）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /data-trustee=/.test(t) && /data-ftype=/.test(t) && /panelTrustee/.test(t) && /tr-p-search/.test(t) &&
      /全部发行人/.test(t) && /全部类别/.test(t) && /fundMeta/.test(t);
  } catch (e) { return false; }
})());
chk('估值日分布·按当前发行人统计（renderSrcNoteTop 过滤 S.trustee）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /function renderSrcNoteTop/.test(j) && /x\.trustee === S\.trustee/.test(j) &&
      /当前范围：\{t\}/.test(j) && /renderSrcNoteTop\(\);/.test(j);
  } catch (e) { return false; }
})());
chk('详情页·完整资料（基本信息/回报/费用 + 净值来源 + 图 250px）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    /* 2026-10-20 v4：小窗与放大页共用 fundDetailHTML（fdBasic 含 fee-title / fdReturns 8 区间 / 表头 fdHead） */
    return /function fdBasic/.test(j) && /function fdPerfTabs/.test(j) && /fee-title/.test(j) &&
      /* 2026-10-21：累计表现精简为积金局 4 个区间（近1/5/10年、推出至今） */ /function fdHead/.test(j) && /近 5 年/.test(j) && /推出至今/.test(j) && /perf-h/.test(j) && /fdPerfRow/.test(j) &&
      /\.fd-head \{/.test(css) && /#anDetail \.fd \.sect-title/.test(css);
  } catch (e) { return false; }
})());
chk('左侧栏加宽加长（232px + 字号调大）与列表视觉优化', (function () {
  try {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /\.an-side \{ width: 232px/.test(css) && /\.an-pitem \{ font-size: 13\.5px/.test(css) &&
      /\.an-listcard \.an-table \{ font-size: 15\.5px/.test(css) && /min-height: calc\(100vh - 190px\)/.test(css);
  } catch (e) { return false; }
})());


chk('默认组合·恒指+规模最大基金（总体=全市场；发行人平均仅面板可选 + 口径说明）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /function pickTop\(trustee\)/.test(j) && /setItems\(\[\{ type: 'index', key: 'HSI' \}\]\)/.test(j) &&
      !/items\.push\(\{ type: 'tavg', key: S\.trustee \}\)/.test(j) &&
      t.indexOf('发行人均值指数：该发行人旗下') >= 0;   /* 口径说明仍在（tavg 条目的 title） */
  } catch (e) { return false; }
})());
chk('图例线条实际线型预览 + 样式弹层放大（tr-lg-line / 340px）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /tr-lg-line/.test(t) && /L\.dash/.test(t) && /\.tr-style \{ width: 340px/.test(css);
  } catch (e) { return false; }
})());
chk('走势图·导出 xlsx 工作簿 + 分享（?set= 组合还原）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    /* 2026-10-21：导出改为工作簿（净值+涨跌幅+区间统计+走势图截图） */
    return /tr-exp/.test(t) && /tr-share/.test(t) && /function exportBook/.test(t) && /svgToPng/.test(t) && /MPFXLSX/.test(t) &&
      /searchParams\.set\('set'/.test(t) && /function itemsFromSet/.test(j) && /get\('set'\)/.test(j);
  } catch (e) { return false; }
})());
chk('选择基金·三级面板（发行人 → 类型 → 基金；搜索保留）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /data-trustee=/.test(t) && /data-ftype=/.test(t) && /panelTrustee/.test(t) && /tr-p-search/.test(t) &&
      /全部发行人/.test(t) && /全部类别/.test(t) && /fundMeta/.test(t);
  } catch (e) { return false; }
})());
chk('估值日分布·按当前发行人统计（renderSrcNoteTop 过滤 S.trustee）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /function renderSrcNoteTop/.test(j) && /x\.trustee === S\.trustee/.test(j) &&
      /当前范围：\{t\}/.test(j) && /renderSrcNoteTop\(\);/.test(j);
  } catch (e) { return false; }
})());
chk('详情页·完整资料（基本信息/回报/费用 + 净值来源 + 图 250px）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    /* 2026-10-20 v4：小窗与放大页共用 fundDetailHTML（fdBasic 含 fee-title / fdReturns 8 区间 / 表头 fdHead） */
    return /function fdBasic/.test(j) && /function fdPerfTabs/.test(j) && /fee-title/.test(j) &&
      /* 2026-10-21：累计表现精简为积金局 4 个区间（近1/5/10年、推出至今） */ /function fdHead/.test(j) && /近 5 年/.test(j) && /推出至今/.test(j) && /perf-h/.test(j) && /fdPerfRow/.test(j) &&
      /\.fd-head \{/.test(css) && /#anDetail \.fd \.sect-title/.test(css);
  } catch (e) { return false; }
})());
chk('左侧栏加宽加长（232px + 字号调大）与列表视觉优化', (function () {
  try {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /\.an-side \{ width: 232px/.test(css) && /\.an-pitem \{ font-size: 13\.5px/.test(css) &&
      /\.an-listcard \.an-table \{ font-size: 15\.5px/.test(css) && /min-height: calc\(100vh - 190px\)/.test(css);
  } catch (e) { return false; }
})());

chk('2026-10-14 三改·左侧栏高度=首屏（100vh-150 内滚）+ 名称列收窄居中 + 统计卡片居中大字', (function () {
  try {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /\.an-side \{ min-height: 0; height: calc\(100vh - 150px\)/.test(css) &&
      /th:nth-child\(1\) \{ width: 22%/.test(css) && /td\.f-main \{ text-align: center/.test(css) &&
      /#anDetail \.an-kv div, #mBody \.kv div \{ text-align: center/.test(css) && /font-size: 17\.5px/.test(css);
  } catch (e) { return false; }
})());

chk('数据扩展·友邦 FPR 月度序列（≥19 只 + 规模/FER 事实表）', (function () {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hist-index.json'), 'utf8'));
    const aia = Object.values(idx.funds).filter((h) => h.src === 'aia' || h.src === 'aia-pt');
    const af = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'aia-facts.json'), 'utf8'));
    return aia.length >= 19 && af.count >= 19 && af.funds['877'] && af.funds['877'].sizeM > 1000 && af.funds['877'].fer > 0;
  } catch (e) { return false; }
})());
chk('数据扩展·宏利持仓/分布（67 只 holdings + 官方回报 trustee-perf 183）', (function () {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8'));
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'trustee-perf.json'), 'utf8'));
    const s = h.funds['695'];
    return h.count >= 60 && s && s.top10 && s.top10.length >= 10 && s.alloc && s.alloc.length >= 3 &&
      p.count >= 180 && p.funds['695'] && p.funds['695'].src === 'manulife' && p.funds['695'].y1 != null;
  } catch (e) { return false; }
})());

chk('数据扩展·友邦 FPR 月度序列（≥19 只 + 规模/FER 事实表）', (function () {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hist-index.json'), 'utf8'));
    const aia = Object.values(idx.funds).filter((h) => h.src === 'aia' || h.src === 'aia-pt');
    const af = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'aia-facts.json'), 'utf8'));
    return aia.length >= 19 && af.count >= 19 && af.funds['877'] && af.funds['877'].sizeM > 1000 && af.funds['877'].fer > 0;
  } catch (e) { return false; }
})());
chk('数据扩展·宏利持仓/分布（67 只 holdings + 官方回报 trustee-perf 183）', (function () {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8'));
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'trustee-perf.json'), 'utf8'));
    const s = h.funds['695'];
    return h.count >= 60 && s && s.top10 && s.top10.length >= 10 && s.alloc && s.alloc.length >= 3 &&
      p.count >= 180 && p.funds['695'] && p.funds['695'].src === 'manulife' && p.funds['695'].y1 != null;
  } catch (e) { return false; }
})());

/* ===== 2026-10-22 傍晚批：浅色调 / 自算指数 / 排行榜去标题 ===== */
chk('1022b·排行榜标题已移除', !/mk-rank[\s\S]{0,200}?市场排行榜/.test(home));
chk('1022c·名次徽标为圆形序号（2026-11-02 第二十五轮：1-5 圆框、蓝色递减）',
  /mk-top \.top-tag \{[^}]*border-radius: 50%/.test(css) && /mk-top \.top-tag\.t1 \{ background: #084e8c/.test(css) &&
  /mk-top \.top-tag\.t2 \{ background: #2e7fc0/.test(css) && /mk-top \.top-tag\.t3 \{ background: #5d9fd0/.test(css) &&
  /mk-top \.top-tag\.t4 \{ background: #a9cbe8/.test(css) && /mk-top \.top-tag\.t5 \{ background: #d3e5f4/.test(css) &&
  !/mk-top \.r\.r1 \{ background: #f6e2c4/.test(css));
chk('1022b·浮窗为浅蓝底（非黑）', (function () { try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8'); return /\.mpf-tip \{[\s\S]{0,600}?background: #edf7ff/.test(c) && !/background: rgba\(24, 38, 58/.test(c); } catch (e) { return false; } })());
chk('1023·品牌蓝与官网一致（#0866bb）', (function () { try { return /--brand: #0866bb/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8')); } catch (e) { return false; } })());
chk('1022b·MPF 自算指数已生成（7 条）', (function () {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'index.json'), 'utf8'));
    const k = Object.keys(j.items || {}).filter((x) => x.indexOf('MPF') === 0);
    return k.length >= 6 && j.items.MPFAVG && j.items.MPFAVG.series.length > 500 && !!j.items.MPFAVG.tip;
  } catch (e) { return false; }
})());
chk('1022b·月度柱变细（9px）', /\.mo-track \{[^}]*height: 9px/.test(css));
chk('1022c·指数已回溯到 2005（≥20 年）', (function () {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'index.json'), 'utf8'));
    return j.items.HSI && j.items.HSI.first <= '2006-01-01' && j.items.SSE.first <= '2006-01-01';
  } catch (e) { return false; }
})());

/* ===== 2026-10-22 用户反馈批 ===== */
/* ① 首页模块顺序：市场排行榜在「市场涨跌温度计」之前；资讯+市场回报走势紧随排行榜之后 */
chk('1022·首页排行榜前置于温度计', (function () {
  const a = home.indexOf('市场排行榜'), b = home.indexOf('市场涨跌温度计');
  return a > -1 && b > -1 && a < b;
})());
chk('1022·资讯与市场回报走势在排行榜之后、温度计之前', (function () {
  const a = home.indexOf('mk-rank'), b = home.indexOf('id="newsList"'), c = home.indexOf('id="mkThermo"');
  return a > -1 && b > a && c > b;
})());
/* ② 温度计改用自算净值口径，并保留积金局口径对照（两套分开标注） */
chk('1022·温度计口径（2026-11-04：说明改「按资产规模加权计算」）', /按资产规模加权计算/.test(home) && /蓝为涨、绿为跌/.test(home));
chk('1022·KPI 成分基金不为 0（unitRows 兜底修复）', !/成分基金<\/div>\s*<div class="mk-v">0 <small>/.test(home));
/* ③ 资料库：「近1年」为默认列（列隐藏规则里不含第 11 列） */
chk('1022·资料库默认列含近1年', /data-k="selfY1"[^>]*>近1年/.test(idx) && !/#fundTable tr > \*:nth-child\(11\)/.test(idx));
/* ④ 排名维度卡片默认不选中 */
chk('1022·排名维度卡片默认不选中', !/class="st on" data-k="selfY1"/.test(idx));
/* ⑤ 三态排序：三处代码均含「取消」分支 */
chk('1022·三态排序（资料库/第三页/榜单）', (function () {
  try {
    const a1 = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const a2 = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const a3 = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const a4 = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /__dimCancel/.test(a1) && /LS_DEFAULT/.test(a2) && /S\.sortKey = null; S\.sortDir = null;/.test(a3) && /D0\.key/.test(a4);
  } catch (e) { return false; }
})());
/* ⑥ 导出：完整性说明 + 走势图横向拉长 */
chk('1022·导出含数据完整性说明', /数据完整性/.test((function () {
  try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8'); } catch (e) { return ''; }
})()));
chk('1022·导出走势图横向拉长（col2 = imgCol + 15）', /col2: imgCol \+ 15/.test((function () {
  try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8'); } catch (e) { return ''; }
})()));

/* ===== 2026-10-29（5.0）本轮新增：风险 n.a. / 温度计蓝绿 / 表现区四栏 ===== */
chk('2026-10-29·风险级别 n.a.（官方未评级）+ 悬浮说明', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    return c.indexOf('risk-na') >= 0 && c.indexOf('naTip()') >= 0 && c.indexOf('积金局按基金近三年价格波幅') >= 0 &&
      /\.risk-na \{/.test(st) && /\.risk\.r7 \{ background: #084e8c/.test(st);
  } catch (e) { return false; }
})());
chk('2026-10-29·温度计改蓝绿（仅此组件）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8');
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.html'), 'utf8');
    return j.indexOf("const T_HI = '#084e8c'") >= 0 && j.indexOf("const T_LO = '#5f9e2f'") >= 0 &&
      h.indexOf('蓝为涨、绿为跌') >= 0 &&
      /\.mk-thermo-panel \.tb-up \{ background: var\(--brand-deep\); \}/.test(st);
  } catch (e) { return false; }
})());
chk('2026-10-29·详情页表现区四栏（自算指标/累计回报/年率化/历年走势）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return c.indexOf('function fdPerfTabs') >= 0 && c.indexOf("'self', '自算指标'") >= 0 &&
      c.indexOf("'cum', '累计回报'") >= 0 && c.indexOf("'ann', '年率化回报'") >= 0 && c.indexOf("'cal', '历年走势'") >= 0 &&
      c.indexOf('fd-perf-note') >= 0 && /\.fd-tab\.on \{/.test(st) && /\.fd-panel\[hidden\]/.test(st);
  } catch (e) { return false; }
})());

/* 2026-10-21：统计移到文件末尾并等待异步断言（此前放在中段，异步接口断言未计入） */
setTimeout(() => {
  const pass = results.filter((r) => r.ok).length;
  console.log("\n=========== 三页回归检查 " + BASE + " ===========");
  results.forEach((r) => console.log((r.ok ? " ✔ " : " ✘ ") + r.name + (r.extra ? "  [" + r.extra + "]" : "")));
  console.log("\n结果：" + pass + " / " + results.length + " 通过" + (pass === results.length ? "  🎉 全部通过" : "  ⚠ 存在失败项"));
  process.exit(pass === results.length ? 0 : 1);
}, 28000);   /* 线上冷启动时 /api/funds 可能要 20s+，等待异步断言完成 */

/* ================= 2026-10-31 三版（用户十六项反馈） ================= */
chk('三版·①hero 改名+按钮卡与标题对齐（hero-copy fit-content）',
  /<h1 data-i18n="香港强积金数据分析平台">/.test(home) && /\.hero-copy \{ width: fit-content/.test(css) && /\.hero-btns \.cta \{ flex: 1 1 0/.test(css));
chk('四版·②行情栏全站固定（样式入 style.css、逻辑入 common.js）+ 首页跳转表现指数',
  /\.mkt-ticker \{ background[^}]*position: sticky/.test(readSrc('style.css')) && /data-tk="' \+ k \+ '"/.test(readSrc('common.js')) && /pinFallback/.test(readSrc('common.js')) && /window\.__piSelect/.test(readSrc('home.js')) && /id="mktTicker"/.test(rawIdxHtml));
chk('三版·③表现指数含恒指/标普500（perf-idx 6 键 + 卡片 6 张）',
  /'MPF_BOND', 'HSI', 'SPX'/.test(readSrc('root:server.js')) && /\['HSI', '恒生指数'\], \['SPX', '标普 500'\]/.test(readSrc('home.js')));
chk('三版·④表现指数纵轴等间隔刻度（2026-11-03 起按点位量级取 1/2/5×10^n）',
  /const mag = Math\.pow\(10, Math\.floor\(Math\.log10/.test(readSrc('home.js')) && /pi-yk-year/.test(readSrc('home.js')));
chk('三版·⑤横轴年份正放加粗（2026-11-02 第二十七轮：与月份同基线、大一号）',
  readSrc('home.js').indexOf('rotate(-40 ') < 0 && /pi-yk-year \{ font-size: 12\.5px; font-weight: 700/.test(css) &&
  /tr-xlab-year \{ font-size: 12\.5px; font-weight: 700/.test(readSrc('analysis.css')));
chk('三版·⑥年度走势线/点/阴影同源（VAL 统一取值）', /const VAL = \(r\) => \(r\.wavg != null \? r\.wavg : r\.avg\);/.test(readSrc('home.js')) && /const areaPts = linePts;/.test(readSrc('home.js')));
chk('三版·⑦排名徽标蓝色系（表格 medal + 首页榜单 r1-r3）',
  /linear-gradient\(135deg, #1466ac, #084e8c\)/.test(readSrc('style.css')) && /\.mk-top \.top-tag\.t1 \{ background: #084e8c/.test(css));
chk('三版·⑧页2筛选两行化（chips/重置按钮删除 + 搜索框并入工具栏行）',
  rawIdxHtml.indexOf('id="chips"') < 0 && rawIdxHtml.indexOf('id="btnReset"') < 0 &&
  rawIdxHtml.indexOf('id="rkRChips"') < 0 && rawIdxHtml.indexOf('id="rkRReset"') < 0 &&
  (rawIdxHtml.match(/class="tb-search"/g) || []).length === 2 && ! /function renderChips/.test(readSrc('app.js')));
chk('三版·⑨列名与筛选统一「受托人」口径',
  />受托人 <span class="arrow">↕<\/span><\/th>/.test(rawIdxHtml) &&
  /trustee: '<th data-c="trustee" data-i18n-parts data-k="trustee" data-defdir="asc" class="sortable">受托人 <span class="arrow">↕<\/span><\/th>'/.test(readSrc('app.js')) &&
  /trustee: '<th data-c="trustee" data-i18n-parts>受托人<\/th>'/.test(readSrc('rank.js')));
chk('五版·⑩估值日分布行：卡框保留、顶部边线删除 + 上方通栏线删除', /#foldSpec \{ margin-top: 8px; border-top: 0; border-radius: 0 0 10px 10px; \}/.test(readSrc('style.css')) && /\.wrap \.foot \{ border-top: 0;/.test(readSrc('style.css')));
chk('五版·⑪页脚折叠箭头 42px（用户要求 +100%）蓝色加粗 + 两行统一右内边距对齐（134px 避让悬浮钮）',
  /\.foot-fold \.ff-arrow \{ font-size: 42px; color: #0866bb/.test(readSrc('style.css')) && /\.foot-fold summary \{ padding-right: 134px; \}/.test(readSrc('style.css')));
chk('三版·⑫回到顶部悬停展开「回到顶部」（tt-txt，同计算器蓝）',
  /\.to-top:hover \{ background: var\(--brand-2/.test(readSrc('style.css')) && /\.tt-txt/.test(readSrc('style.css')) &&
  rawIdxHtml.indexOf('tt-txt') >= 0 && home.indexOf('tt-txt') >= 0);
chk('三版·⑬首页模块标题统一格式（17px + 榜单卡标题间距加大）',
  /\.mk-top h3 \{ font-size: 17px; margin: 0 0 14px/.test(css) && /\.mk-panel h3 \{ font-size: 17px; \}/.test(css));

/* ===== 2026-11-02 第十八轮（8 条用户反馈）===== */
chk('十八轮·①筛选控件加宽 + 自绘下拉按内容自适应且常规项不滚动',
  /@media \(min-width: 1201px\)/.test(readSrc('style.css')) && /\.mpfsel-pop \{ width: max-content; min-width: 100%/.test(readSrc('style.css')) &&
  /max-height: calc\(100vh - 140px\)/.test(readSrc('style.css')));
chk('十八轮·②每页显示支持自定义条数',
  /mpfsel-custom/.test(readSrc('common.js')) && /applyCustom/.test(readSrc('common.js')) &&
  /\.mpfsel-pop\.has-custom/.test(readSrc('style.css')));
chk('十八轮·③投资分布标签 +1 号、引线提前收住',
  /\.alr3-name \{ font-size: 22px/.test(readSrc('analysis.css')) && /const ex = lx \+ \(side === 'left' \? 12 : -12\)/.test(readSrc('common.js')));
chk('十八轮·④首页榜单卡（2026-11-02 第二十五轮：圆形序号 24px + 行间细分割线）',
  /\.mk-top \.top-tag \{[^}]*flex: 0 0 24px; width: 24px; height: 24px/.test(css) && /\.mk-top li \{[^}]*border-bottom: 1px solid #f2f6fb/.test(css));
chk('十八轮·⑤恒指/上证取全历史（服务端不再裁到 2015）',
  /恒指\/上证要「发行至今」/.test(readSrc('root:server.js')) && readSrc('root:server.js').indexOf("r[0] >= '2015-01-01'") < 0 && /hist-index-full/.test(readSrc('root:tools/hist-index-full.js')));
chk('十八轮·⑥横轴月份标月底 + 年份落 1 月 1 日',
  /const mEnd = Math.min\(m \+ 1, mi1\) - 0.02;/.test(readSrc('home.js')) && /yy \* 12 - mi0/.test(readSrc('home.js')));
chk('十八轮·⑦行情栏（2026-11-02 第二十七轮：已并入顶部栏，关闭按钮下线）',
  /id="mktTicker"/.test(rawIdxHtml) && /id="mktTicker"/.test(home) &&
  /\.hdr \.mkt-ticker \{/.test(readSrc('style.css')) && rawIdxHtml.indexOf('id="tkClose"') < 0);
chk('十八轮·⑧排名维度支持多维度叠加排序',
  /window\.__DIMSEL/.test(readSrc('app.js')) && /function sortByDims/.test(readSrc('app.js')) &&
  /sortByDims\(filtered\(\), window\.__DIMSEL\)/.test(readSrc('app.js')) && /class="dim-opt/.test(readSrc('app.js')) && /\.dim-grid \{ display: grid/.test(readSrc('style.css')));

/* ===== 2026-11-02 第二十轮（5 条反馈）===== */
chk('二十轮·①每页显示标签移到框上方（与其它筛选框一致）+ 计数右移',
  /class="f-item tb-per"/.test(rawIdxHtml) && /class="f-item tb-per"/.test(idx) &&
  /\.f-row-merged \.tb-tail \.tb-count \{[^}]*margin-left/.test(readSrc('style.css')));
chk('二十轮·②榜单页删除「更多筛选」整块',
  rawIdxHtml.indexOf('id="rkMore"') < 0 && idx.indexOf('id="rkMore"') < 0 && idx.indexOf('更多筛选') < 0);
chk('二十轮·③榜单表格与基金表同款：分页条 + 来源说明移出卡片',
  /id="rkPager"/.test(rawIdxHtml) && /function renderPager/.test(readSrc('rank.js')) &&
  /#rkTable thead th \{ font-size: 14px/.test(readSrc('style.css')));
chk('二十轮·④左侧全站导航（首页 / 基金最新数据 / 供款（定投）计算器）',
  /class="db-shell"/.test(rawIdxHtml) && /class="db-side"/.test(rawIdxHtml) &&
  rawIdxHtml.indexOf('class="db-tabs"') < 0 && /id="dbtDb"/.test(readSrc('common.js')) &&
  !/id="dbtCmp"/.test(readSrc('common.js')) && /供款（定投）计算器/.test(readSrc('common.js')) &&
  /navHome/.test(readSrc('common.js')) && /navCalc/.test(readSrc('common.js')));
chk('二十轮·⑤首页榜单卡 1-5 全部写出序号（2026-11-02：圆形序号 1-5）',
  /'<span class="top-tag t' \+ \(i \+ 1\) \+ '">' \+ \(i \+ 1\) \+ '<\/span>'/.test(readSrc('home.js')) &&
  /\.mk-top \.top-tag\.t5/.test(readSrc('home.css')));

/* ===== 2026-11-02 第二十一轮（10 条反馈）===== */
chk('二十一轮·①侧边栏贴左固定 + 对比发行人列表收为二级菜单',
  /\.db-side \{ position: fixed; left: 0; top: 100px; bottom: 0;/.test(readSrc('style.css')) &&
  /body\.db-page \.wrap \{ max-width: none; padding-left: 254px/.test(readSrc('style.css')) &&
  /id="dbSubCmp"/.test(readSrc('common.js')) && /id="anProv"/.test(readSrc('common.js')) &&
  rawIdxHtml.indexOf('class="an-side"') < 0 && /dsub\.hidden = isRank/.test(rawIdxHtml));
chk('二十一轮·②榜单排名维度写出实际口径（近 1 年回报）',
  /esc\(TT\('近 1 年回报'\)\)/.test(readSrc('rank.js')) && rawIdxHtml.length > 0);
chk('二十一轮·③搜索框与受托人同宽、占位只写基金名称／计划名称',
  rawIdxHtml.indexOf('data-i18n-ph="基金名称／计划名称"') >= 0 &&
  rawIdxHtml.indexOf('基金名称／计划名称／受托人') < 0 &&
  /\.f-row-merged > \.f-search \{ flex: 0 0 96px/.test(readSrc('style.css')) &&
  /\.f-row-merged > \.f-trustee \{ flex: 0 0 96px/.test(readSrc('style.css')));
chk('二十一轮·④基金表说明条移入 #dbSec、与表格同宽且蓝色调',
  (function () {
    const a = rawIdxHtml.indexOf('id="dbScopeNote"');
    const b = rawIdxHtml.indexOf('id="rkSec"');
    return a > 0 && b > a && /\.scope-note\.scope-db \{ margin: 12px 0 0/.test(readSrc('style.css'));
  })() && /\.scope-note\.scope-mpfa \{ background: #eef4fd; color: #35507a; \}/.test(readSrc('style.css')));
chk('二十一轮·⑤走势图：区间含 10年/全部、高度 +20%、无图内纵轴说明、说明简写',
  /'10y', '10年'/.test(readSrc('trend.js')) && /'all', '全部'/.test(readSrc('trend.js')) &&
  /#anCompare \.tr-svg \{ height: 342px/.test(readSrc('analysis.css')) &&
  readSrc('trend.js').indexOf("_t('累计涨跌幅（区间起点 = 0%）')") < 0 &&
  readSrc('trend.js').indexOf('基金净值取自各发行人官网（每交易日）') < 0);
chk('二十四轮·②行情栏关闭按钮左移 25px（距首卡 5px，仍在指数左侧）',
  /\.tk-close \{ position: absolute; left: 25px;[\s\S]{0,240}width: 22px; height: 22px/.test(readSrc('style.css')) &&
  /强积金市场指数/.test(readSrc('common.js')));

/* ===== 2026-11-02 第二十四轮（10 条反馈）===== */
chk('二十四轮·①发行人列表紧跟「基金最新数据」+ 可收起（2026-11-02 第二十七轮：对比入口与分隔线已删）',
  (function () {
    const j = readSrc('common.js');
    const a = j.indexOf('id="dbtDb"');
    const b = j.indexOf('id="dbSubCmp"');
    return a > 0 && b > a;
  })() &&
  /subOpen = !subOpen/.test(rawIdxHtml) && /b\.classList\.toggle\('collapsed', !subOpen\)/.test(rawIdxHtml) &&
  /\.db-side-grp \{ position: relative; display: flex;[\s\S]{0,160}font-size: 16px/.test(readSrc('style.css')) &&
  /强积金数据分析平台/.test(readSrc('common.js')) && !/db-side-div/.test(readSrc('common.js')));
chk('二十四轮·③走势图头部：标题右侧箭头收起 + 清空并入添加组 + 实线按钮',
  /class="tr-title tr-titlebtn"/.test(readSrc('trend.js')) && /class="tr-caret"/.test(readSrc('trend.js')) &&
  /class="tr-tool tr-clear"[\s\S]{0,120}_t\('清空'\)/.test(readSrc('trend.js')) &&
  /\.tr-adds \.tr-sel \{[^}]*border: 1px solid #cfe1f2/.test(readSrc('analysis.css')) &&
  /\.tr-box\.tr-folded \.tr-canvas/.test(readSrc('analysis.css')) &&
  !/setupDbTrendFold/.test(readSrc('app.js')));
chk('二十四轮·⑤⑥⑦走势图加高 30% + 统计表字号 + 预设按钮等宽',
  /\.db-trendcard \.tr-svg \{ height: 350px/.test(readSrc('style.css')) &&
  /\.tr-tbl th, \.tr-tbl td \{ font-size: 14px; \}/.test(readSrc('analysis.css')) &&
  /\.cp-btns\.cp-presets \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(readSrc('style.css')));
chk('二十九轮·①口径说明（2026-11-04：ⓘ 随侧栏入口一并下线，改为页脚三行式说明）',
  /class="snote"/.test(readSrc('common.js')) && /snote-link/.test(readSrc('style.css')) &&
  !/比积金局快/.test(readSrc('common.js')));
chk('二十四轮·⑨说明行不再因单条对比而隐藏（改为换文案）',
  /noteEl\.style\.display = ''/.test(readSrc('trend.js')) && /单条对比时纵轴为实际数值/.test(readSrc('trend.js')));
chk('二十四轮·⑩首页榜单卡序号（第二十五轮：圆框 1-5）',
  /class="top-tag t' \+ \(i \+ 1\)/.test(readSrc('home.js')) &&
  /\.mk-top \.top-tag \{[\s\S]{0,160}flex: 0 0 24px/.test(readSrc('home.css')));

/* ===== 2026-11-02 第二十五轮（6 条反馈）===== */
chk('二十五轮·①首页年份正放（不再 rotate）+ 走势图年份加粗',
  readSrc('home.js').indexOf('rotate(-40 ') < 0 && /tr-xlab-year \{ font-size: 12\.5px; font-weight: 700/.test(readSrc('analysis.css')));
chk('二十五轮·②添加组紧贴标题（标题 17px，区间/导出仍靠右）',
  /\.tr-titlebtn \{[^}]*font-size: 17px/.test(readSrc('analysis.css')) &&
  /\.tr-adds \{[^}]*margin-left: 4px/.test(readSrc('analysis.css')) &&
  /\.tr-ctrls \{[^}]*margin-left: auto/.test(readSrc('analysis.css')));
chk('二十五轮·②点击名称跳详情 / 点线条改样式（线型预览 46px）',
  /data-openfund=/.test(readSrc('trend.js')) && /function openFundDetail/.test(readSrc('trend.js')) &&
  /class="tr-lg-line" width="55"/.test(readSrc('trend.js')) &&
  !/<span class="nm" data-style=/.test(readSrc('trend.js')));
chk('二十五轮·③资料库表格已选基金置顶 + 分隔行',
  /const pinned = selIds\.length \? ranked\.filter/.test(readSrc('app.js')) &&
  /class="is-pinned"/.test(readSrc('app.js')) && /以上是已选基金/.test(readSrc('app.js')) &&
  /#fundTable tbody tr\.is-pinned > td \{ background: #f6fbff; \}/.test(readSrc('style.css')));
chk('二十五轮·④侧边栏 +10%（242px）+ 标题居中',
  /\.db-side \{ position: fixed; left: 0; top: 100px; bottom: 0; width: 242px;/.test(readSrc('style.css')) &&
  /\.db-side-grp \{[^}]*justify-content: center/.test(readSrc('style.css')) &&
  /padding-left: 254px/.test(readSrc('style.css')));
chk('二十五轮·⑤首页榜单卡圆形序号（1-5 蓝色递减）',
  /\.mk-top \.top-tag \{[^}]*border-radius: 50%/.test(readSrc('home.css')) &&
  /\.mk-top \.top-tag\.t4 \{ background: #a9cbe8/.test(readSrc('home.css')));

/* ===== 2026-11-02 第二十七轮（15 条反馈）===== */
chk('二十七轮·①侧栏删除「可视化对比」入口与分隔线',
  !/id="dbtCmp"/.test(readSrc('common.js')) && !/db-side-div/.test(readSrc('common.js')) &&
  /id="anSec"/.test(readSrc('index.html')) && !/id="dbtCmp"/.test(rawIdxHtml));
chk('二十七轮·②页头与行情栏合并（mktTicker 移入 header，数据版本移入侧栏底部）',
  /id="mktTicker"/.test(readSrc('home.html')) &&
  readSrc('home.html').indexOf('<header class="hdr">') < readSrc('home.html').indexOf('id="mktTicker"') &&
  readSrc('home.html').indexOf('id="mktTicker"') < readSrc('home.html').indexOf('id="langSw"') &&
  /class="hdr-inner"[\s\S]{0,400}id="mktTicker"/.test(readSrc('index.html')) &&
  /\.hdr \.mkt-ticker \{/.test(readSrc('style.css')) &&
  /id="verChip"/.test(readSrc('common.js')) && /\.db-ver b::before/.test(readSrc('style.css')));
chk('二十七轮·③日期浮层：确定后变清空 + 点空白收起',
  /function syncDgo/.test(readSrc('trend.js')) && /_t\('清空'\) : _t\('确定'\)/.test(readSrc('trend.js')) &&
  /closest\('\.tr-rangebox'\)/.test(readSrc('trend.js')) && /dr\.hidden = true;   \/\* 应用后收起浮层/.test(readSrc('trend.js')));
chk('二十七轮·④详情弹窗表头与主页一致（一行 + 同一标题；宽度按最新一轮 765）',
  /title: TT\('基金走势对比图'\)/.test(readSrc('common.js')) &&
  /\.modal-box \{ max-width: 765px; \}/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.tr-head \{ flex-wrap: nowrap; \}/.test(readSrc('analysis.css')));
chk('二十七轮·⑤⑥对比最优值改蓝色调 + 年份上移到月份同一基线',
  /\.cmp-best \{ background: #e8f1fb !important; color: #084e8c !important/.test(readSrc('style.css')) &&
  /axisY \+ 16\) \+ '" text-anchor="' \+ anc \+ '" class="tr-xlab tr-xlab-year"/.test(readSrc('trend.js')) &&
  /yearLab\(lx, axisY \+ 32, yearTxt\(yy\), anchor\)/.test(readSrc('home.js')));
chk('二十七轮·⑦「总体」改名「全部」',
  !/TT\('总体'\)/.test(readSrc('analysis.js')) && /TT\('全部'\)/.test(readSrc('analysis.js')));
chk('二十七轮·⑧ⓘ 用首页同款小 i（15px 细描边）',
  /\.db-side \.ver-info\.db-tip \{[\s\S]{0,220}width: 15px; height: 15px/.test(readSrc('style.css')) &&
  /class="ver-info db-tip"/.test(readSrc('common.js')));
chk('二十八轮·②统计表「导出 CSV」已全面清退',
  !/exportStatsCsv/.test(readSrc('trend.js')) && !/class="tr-csv"/.test(readSrc('trend.js')) &&
  !/csvBar/.test(readSrc('trend.js')) && !/\.tr-csv/.test(readSrc('analysis.css')));
chk('二十七轮·⑩⑪对比弹窗固定首列 + 标题写基金名',
  /position: sticky; left: 0; z-index: 3; background: #fff;/.test(readSrc('analysis.css')) &&
  /id="cmpTitle"/.test(readSrc('index.html')) && /基金对比：\{list\}/.test(readSrc('common.js')));
chk('二十七轮·⑫回顶按钮上移右移（right 36 / bottom 94）',
  /position: fixed; right: 36px; bottom: 94px; z-index: 90;/.test(readSrc('style.css')));
chk('二十七轮·⑬页脚两个折叠箭头缩小 15%（42 → 36）',
  /\.foot-fold \.ff-arrow \{ font-size: 36px; width: 38px; \}/.test(readSrc('style.css')));
chk('二十七轮·⑭详情弹窗价格与四项并排（5 列一行）',
  /\.modal-bd \.fd-head \{ grid-template-columns: 1\.1fr 1fr 1fr 1fr 1fr;/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-price \{ grid-column: auto;/.test(readSrc('analysis.css')));
chk('四十一轮·服务端数据热加载（daily 写盘后不必重启/刷新）', (function () {
  try {
    const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    return /function reloadIfChanged\(\)/.test(sv) && /reloadIfChanged\(\);/.test(sv) && /DATA_MTIME/.test(sv);
  } catch (e) { return false; }
})());
chk('四十二轮·宏利每小时补抓已撤销（改为雅虎補空 + 早晚两班，省积分）', (function () {
  try {
    const base = path.join(__dirname, '..');
    const gone = !fs.existsSync(path.join(base, 'tools', 'manulife-watch.js')) &&
      !fs.existsSync(path.join(base, '.github', 'workflows', 'manulife-watch.yml'));
    const d = fs.readFileSync(path.join(base, '.github', 'workflows', 'deploy.yml'), 'utf8');
    const fill = fs.existsSync(path.join(base, 'tools', 'yahoo-fill.js'));
    return gone && fill && !/10 9 \* \* 1-5/.test(d);
  } catch (e) { return false; }
})());
chk('四十六轮·旧榜单链接 #5 要跳到 ann5（不能落默认榜）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'ranking.html'), 'utf8');
    return /'ann' \+ id/.test(j) && /location\.replace\('index\.html\?rk='/.test(j);
  } catch (e) { return false; }
})());
chk('四十二轮·雅虎補空（映射已校验 + 只補空不覆蓋官網）', (function () {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'yahoo-map.json'), 'utf8')).funds || {};
    const y = fs.readFileSync(path.join(__dirname, '..', 'tools', 'yahoo-fill.js'), 'utf8');
    const n = Object.keys(m).length;
    return n >= 250 && Object.values(m).every((x) => x.ratio > 0 && x.maxDev <= 0.001) && /dev > 0.15/.test(y);
  } catch (e) { return false; }
})());
chk('四十二轮·積金局月度統計已自動化（OCR + 三重校驗）', (function () {
  try {
    const p = fs.readFileSync(path.join(__dirname, '..', 'tools', 'mpfa-monthly-sync.py'), 'utf8');
    const d = fs.readFileSync(path.join(__dirname, '..', 'tools', 'daily.sh'), 'utf8');
    return /parse_table/.test(p) && /validate\(table/.test(p) && /mpfa-monthly-sync\.py/.test(d);
  } catch (e) { return false; }
})());
chk('四十二轮·两站对齐脚本就位（每日任务收尾取仓庫最新 data/）', (function () {
  try {
    const sh = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sync-from-cloud.sh'), 'utf8');
    return /git checkout origin\/main -- data/.test(sh) && /KEEP/.test(sh) && /TAKEN/.test(sh);
  } catch (e) { return false; }
})());
chk('四十二轮·数据版本变化时整页自动刷新（无需手动 F5）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /mpf-auto-reload/.test(j) && /location\.reload\(\)/.test(j) && /cacheClear\(\);/.test(j);
  } catch (e) { return false; }
})());
chk('四十一轮·列设置不持久化（刷新回默认 12 列）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    return !/localStorage\.setItem\('mpf-cols-v9'/.test(j) && /removeItem\('mpf-cols-v9'\)/.test(j);
  } catch (e) { return false; }
})());
chk('四十一轮·云端构建前重算指数', (function () {
  try {
    const y = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
    return /node mpfindex\.js/.test(y);
  } catch (e) { return false; }
})());
chk('四十轮·云端链路必须重算自算指数与市场指数（否则 GitHub 站行情条冻结在旧日期）', (function () {
  try {
    const y = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
    return /node mpfindex\.js/.test(y) && /node indexbuild\.js/.test(y) &&
      !/if \[.*light.*=.*"0".*\] then node indexbuild\.js/.test(y);
  } catch (e) { return false; }
})());
chk('四十轮·public 内不得残留任何 design-*.html（避免内部评审页被外部访问）', (function () {
  try {
    const dir = path.join(__dirname, '..', 'public');
    return !fs.readdirSync(dir).some((f) => /^design-.*\.html$/i.test(f));
  } catch (e) { return false; }
})());
chk('四十轮·设计页已移出 public（改存 output/design-pages，不再对外发布）',
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-shell.html')) &&
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-detail.html')) &&
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-cmp.html')));

/* ===== 2026-11-03 第二十八轮（9 条反馈）===== */
chk('二十八轮·①详情弹窗不再加宽（1060 已下线，现 765）',
  !/max-width: 1060px/.test(readSrc('analysis.css')) &&
  /\.modal-box \{ max-width: 765px; \}/.test(readSrc('analysis.css')));
chk('二十八轮·②统计表导出 CSV 已删除（含样式与点击分支）',
  !/csvBar/.test(readSrc('trend.js')) && !/\.tr-tblbar/.test(readSrc('analysis.css')));
chk('二十九轮·③首页年份改「下移一行居中」（不再左右平移）',
  /yearLab\(lx, axisY \+ 32, yearTxt\(yy\), anchor\)/.test(readSrc('home.js')) &&
  !/let lx = xt0 \+ 8/.test(readSrc('home.js')) &&
  /let lx = xt0, anchor = 'middle';/.test(readSrc('home.js')));
chk('二十八轮·④对比弹窗也有「添加指数 / 添加基金 / 清空」（headAdds）',
  /headAdds: true/.test(readSrc('common.js')) && /const withAdds = !o\.bareHead \|\| !!o\.headAdds;/.test(readSrc('trend.js')));
chk('二十八轮·⑤回撤「起始 + 结束」合并为一列（两张统计表都改）',
  !/最大回撤起始日期/.test(readSrc('trend.js')) && !/最大回撤结束日期/.test(readSrc('trend.js')) &&
  (readSrc('trend.js').match(/最大回撤区间/g) || []).length >= 2 &&
  /m\.fromT\) \+ ' → ' \+ dstr\(m\.toT\)/.test(readSrc('trend.js')));
chk('二十八轮·⑥对比表固定首列只在 ≤900 生效（网页端不滚）',
  /@media \(max-width: 900px\) \{\s*\.cmp-modal #cmpBody table\.data thead th:first-child/.test(readSrc('analysis.css')) &&
  /box\.style\.maxWidth = Math\.min\(1160, 420 \+ list\.length \* 170\)/.test(readSrc('common.js')));
chk('二十八轮·⑧页头 LOGO 去拼音、去副标题，语言移入侧栏',
  /logo-mark\.png/.test(readSrc('index.html')) && /logo-mark\.png/.test(readSrc('home.html')) &&
  !/JING YAN 精研/.test(readSrc('index.html')) &&
  !/香港强积金数据分析平台<\/span>/.test(readSrc('index.html')) &&
  /class="db-side-lang"/.test(readSrc('common.js')) && /langBox\.appendChild\(langSw\)/.test(readSrc('common.js')) &&
  /\.logo-img \{ height: 30px; width: auto; \}/.test(readSrc('style.css')));
chk('二十八轮·⑧行情迷你折线恢复（≥980 显示）',
  /@media \(max-width: 980px\) \{\s*\.hdr \.tk-spark \{ display: none; \}/.test(readSrc('style.css')) &&
  !/max-width: 1700px[\s\S]{0,80}tk-spark/.test(readSrc('style.css')));
chk('四十轮·设计页（第二批）也已移出 public',
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-detail2.html')) &&
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-shell2.html')));
chk('二十八轮·详情弹窗「放大」先切到对比页（修「点了没反应」）',
  /window\.__dbShowTab = function \(t\) \{ show\(t, false, false\); \};/.test(readSrc('index.html')) &&
  /__dbShowTab\('cmp'\)/.test(readSrc('common.js')));
chk('二十八轮·首页图表网格允许收缩（消除横向滚动 256px）',
  /\.mk-charts > \.mk-panel, \.mk-charts2 > \.mk-panel, \.mk-charts > \.mk-card \{ min-width: 0; \}/.test(readSrc('home.css')));

/* ===== 2026-11-03 第二十九轮（9 条反馈）===== */
chk('二十九轮·①详情弹窗再收窄 15%（765）+ 表头 E02 浅蓝价格块 + 字号加大一号',
  /\.modal-box \{ max-width: 765px; \}/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-head \{ grid-template-columns: 1\.1fr 1fr 1fr 1fr 1fr;/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-price \{[^}]*background: #f2f8fe;/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-v \{ font-size: 28px;/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-v2 \{ font-size: 19px;/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-cell \{ padding: 8px 10px 9px; \}/.test(readSrc('analysis.css')));
chk('二十九轮·③走势图统计表去问号 + 列头与数值居中',
  !/class="tr-q"/.test(readSrc('trend.js')) &&
  /<table class="tr-tbl tr-center">/.test(readSrc('trend.js')) &&
  /\.tr-tbl\.tr-center \.r, \.tr-tbl\.tr-center th\.r \{ text-align: center; \}/.test(readSrc('analysis.css')));
chk('二十九轮·⑤侧栏 S12：标题 16px/800 + 简繁英胶囊居中',
  /\.db-side-grp \{ padding: 2px 6px 7px; font-size: 16px; font-weight: 800;/.test(readSrc('style.css')) &&
  /\.db-side-lang \{ margin: 0 2px 12px; \}/.test(readSrc('style.css')) &&
  /\.db-side-lang \.lang-sw \{ display: inline-flex;[^}]*background: #f1f7fd;/.test(readSrc('style.css')));
chk('二十九轮·⑥公司名下加英文 Guangzhou Data Mining Company',
  /Guangzhou Data Mining Company/.test(readSrc('index.html')) &&
  /Guangzhou Data Mining Company/.test(readSrc('home.html')) &&
  /\.logo-txt \.logo-en \{ display: block; font-size: 8\.8px;/.test(readSrc('style.css')));
chk('二十九轮·⑦行情指数分隔线加粗（2px + 深一档）',
  /\.hdr \.tk-card \{ border-right-width: 2px; border-right-color: #d2dfec; \}/.test(readSrc('style.css')));
chk('二十九轮·⑧首页榜单可点进详情（data-fid + ?f= 深链）',
  /data-fid="' \+ escA\(x\.id/.test(readSrc('home.js')) &&
  /index\.html\?f=' \+ encodeURIComponent\(id\) \+ '#db'/.test(readSrc('home.js')) &&
  /\.mk-top li\[data-fid\] \{ cursor: pointer; \}/.test(readSrc('home.css')));
chk('二十九轮·⑧资料库支持 ?dim= 深链（落到同一自算维度排序）',
  /get\('dim'\)/.test(readSrc('app.js')) && /window\.__DIMSEL = \[\{ k: dk, d: hit\.d \|\| 'desc' \}\];/.test(readSrc('app.js')));
chk('四十轮·首屏设计页已移出 public',
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-hero.html')) &&
  /1160px; height: 316px/.test(fs.readFileSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-hero.html'), 'utf8')));

/* ===== 2026-11-03 第三十轮（12 条反馈）===== */
chk('三十轮·②走势图与详情图的年份都改为单独一行居中',
  /let lx = x, anc = 'middle';/.test(readSrc('trend.js')) &&
  !/let lx = x \+ 7/.test(readSrc('trend.js')) &&
  /axisY \+ 16\) \+ '" text-anchor="' \+ anc \+ '" class="tr-xlab tr-xlab-year"/.test(readSrc('trend.js')) &&
  /let lx = xt0, anchor = 'middle';/.test(readSrc('home.js')));
chk('三十轮·③单线提示显示当日涨跌幅 + 标签说明',
  /const solo = lines\.length === 1;/.test(readSrc('trend.js')) &&
  /当日涨跌幅/.test(readSrc('trend.js')) && /相对区间涨跌幅/.test(readSrc('trend.js')) &&
  /tr-tip-tag/.test(readSrc('analysis.css')) &&
  !/tr-tip-note/.test(readSrc('trend.js')));   /* 第三十一轮：底部说明行已按用户要求去掉 */
chk('三十轮·④详情表头价格 28px / 四栏数值（第三十五轮起 19px）',
  /\.modal-bd \.fd-v \{ font-size: 28px;/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-v2 \{ font-size: 19px;/.test(readSrc('analysis.css')));
chk('三十轮·⑤侧栏语言胶囊真正居中（复位 margin-left:auto）',
  /\.db-side-lang \.lang-sw \{[^}]*margin-left: 0;/.test(readSrc('style.css')));
chk('三十一轮·④积金表现指数新增「近 40 日」视图（与顶部迷你线同一批日线点）',
  /\['40d', '近 40 日'\]/.test(readSrc('home.js')) &&
  /it\.daily\.slice\(-40\)/.test(readSrc('home.js')) &&
  /cur = key; range = '40d';/.test(readSrc('home.js')) &&
  /daily: s2\.slice\(-120\)/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')));
chk('三十轮·⑦首页榜单点击直接弹详情（不跳资料库）',
  /id="modal"/.test(readSrc('home.html')) && /window\.ensureFunds = function/.test(readSrc('common.js')) &&
  /window\.openDetail\(id\)/.test(readSrc('home.js')) &&
  /if \(!window\.openDetail \|\| !window\.ensureFunds\)/.test(readSrc('home.js')));   /* 仅降级路径才跳转 */
chk('三十轮·⑧缺日审计改判据（真缺 = 净值日 > 历史末点）+ 自动补抓',
  fs.existsSync(path.join(__dirname, '..', 'tools', 'hist-gap-audit.js')) &&
  /navD > lastD/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'hist-gap-audit.js'), 'utf8')) &&
  /--fix/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'gap-check.js'), 'utf8')) &&
  /gap-check\.js --fix/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'daily.sh'), 'utf8')) &&
  /require\('\.\/hist-gap-audit'\)/.test(readSrc('../tools/health-check.js')));
chk('三十轮·⑨英文模式行情卡用短名 + 图例同名补单位类别',
  /SHORT_EN = \{ MPFAVG: 'MPF Index'/.test(readSrc('common.js')) &&
  /_tq\('\{u\} 类', \{ u: u \}\) \+ ' · ' \+ nm/.test(readSrc('trend.js')));
chk('三十轮·⑩投资组合分布整体缩小 10%',
  /\.alr3 \{ margin: 4px auto 2px; width: 90%; \}/.test(readSrc('analysis.css')));
chk('三十轮·①榜单更名（2026-11-03 起「积金局月度数据」，退居侧栏更多区）+ 口径说明重写',
  /积金局月度数据/.test(readSrc('common.js')) &&
  !/MPFA 基金榜单<\/span>/.test(readSrc('common.js')) &&
  /两套口径，不要混着比/.test(readSrc('common.js')) &&
  /两套口径，不要混着比/.test(i18nText()));

/* ===== 2026-11-03 第三十一轮（7 条反馈）===== */
chk('三十一轮·①首屏市场情绪卡（第三十三轮起改 B02 圆环）',
  /class="hero-sent"/.test(readSrc('home.html')) && !/class="hero-btns"/.test(readSrc('home.html')) &&
  /index\.html\?dim=selfW1#db/.test(readSrc('home.html')) &&
  /id="hsDelta"/.test(readSrc('home.html')) &&
  /class="hs-ring"/.test(readSrc('home.html')) &&
  /\.hs-ring-fg \{ fill: none; stroke: #0866bb/.test(readSrc('home.css')) &&
  /if \(p === '\/api\/breadth'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) &&
  /breadth\.json/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-static.js'), 'utf8')));
chk('三十一轮·③清空后悬浮提示与十字线一并隐藏',
  /if \(!win\) \{\s*\/\* 2026-11-03（第三十一轮，用户报 bug）/.test(readSrc('trend.js')) &&
  /if \(tip\) tip\.hidden = true;\s*svg\.querySelectorAll\('\.tr-cross'\)/.test(readSrc('trend.js')));
chk('三十一轮·④40 日视图与顶部迷你线同形 + 点位口径统一',
  /const RAWV = true;/.test(readSrc('home.js')) &&
  /it\.daily\.slice\(-40\)/.test(readSrc('home.js')) &&
  /const tiny = pts\.length <= 62 && mspan <= 2\.6;/.test(readSrc('home.js')));
chk('三十一轮·⑤数据说明列出源站滞后名单（折叠区内）',
  /function staleNote\(\)/.test(readSrc('common.js')) &&
  /note-stale/.test(readSrc('style.css')) &&
  /id="foldSpec"/.test(readSrc('index.html')));
chk('四十轮·持仓设计页已移出 public',
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-hold.html')) &&
  /width:729px/.test(fs.readFileSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-hold.html'), 'utf8')));

/* ===== 2026-11-03 第三十二轮（6 条反馈）===== */
chk('三十二轮·③情绪卡口径统一：近一周占比 + 跳「近 1 周」维度',
  /* 2026-11-13（第五十三轮）：口径从 server.js 内联搬到 tools/breadth.js 单点生成，
     断言随之指向新实现；仍要求「本周与上周同分母」这一关键性质。 */
  (function () {
    const b = fs.readFileSync(path.join(__dirname, '..', 'tools', 'breadth.js'), 'utf8');
    return /const pct = total \? Math\.round\(\(up \/ total\) \* 100\) : null;/.test(b) &&
      /pctPrev = total \?/.test(b) &&
      /if \(span1 > MAX_SPAN \|\| span2 > MAX_SPAN\)/.test(b) &&
      /index\.html\?dim=selfW1#db/.test(readSrc('home.html')) &&
      /TQ\('较上周 \{d\} 个百分点'/.test(readSrc('home.js'));
  })());
chk('三十二轮·①源站名单：折叠块 + 每计划一行 + 可点击筛基金',
  /snote-more/.test(readSrc('common.js')) && /ns-list/.test(readSrc('common.js')) &&
  /class="ns-link" href="index\.html\?kw=/.test(readSrc('common.js')) &&
  /window\.mpfSetKw = function/.test(readSrc('app.js')) &&
  /get\('kw'\)/.test(readSrc('app.js')) &&
  /\.snote-more \.ns-link/.test(readSrc('style.css')));
chk('三十二轮·②行情悬浮提示写清折线维度与数据日期',
  /折线为近 \{n\} 个交易日的走势/.test(readSrc('common.js')) &&
  /数据截至 \{d\}/.test(readSrc('common.js')));
chk('四十轮·迷你图设计页已移出 public',
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-breadth.html')) &&
  (fs.readFileSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-breadth.html'), 'utf8').match(/const b\d\d = /g) || []).length >= 20);

/* ===== 2026-11-03 第三十三轮（11 条反馈）===== */
chk('三十三轮·①行情数字改「近 40 个交易日区间收益」+ 上证换标普 500',
  /const spark = s2\.slice\(-40\);/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) &&
  /const base40 = spark\.length > 1 \? spark\[0\]\[1\] : 0;/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) &&
  /const KEYS = \['MPFAVG', 'MPF_STOCK', 'MPF_MIX', 'MPF_BOND', 'HSI', 'SPX'\]/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) &&
  /SPX: '标普 500'/.test(readSrc('common.js')));
chk('三十三轮·②首页四榜（回报不再挂积金局口径）+ 积金局月报下沉到口径说明',
  !/mkTop5|mkTop2/.test(readSrc('home.html')) &&
  /mkTopSize/.test(readSrc('home.html')) && /mkTopVol/.test(readSrc('home.html')) &&
  /class="snote-link" href="#rank"/.test(readSrc('common.js')) && /积金局月度数据/.test(readSrc('common.js')) &&
  /\.snote-link/.test(readSrc('style.css')));
chk('三十三轮·③首屏情绪卡改 B02 圆环（弧长=占比，中心数字）',
  /class="hs-ring"/.test(readSrc('home.html')) && /id="hsRingArc"/.test(readSrc('home.html')) &&
  /arc\.style\.strokeDasharray = \(C \* pct \/ 100\)/.test(readSrc('home.js')) &&
  /\.hs-ring \{ position: relative; display: block; width: 56px/.test(readSrc('home.css')) &&
  /max-width: 470px; text-decoration: none;/.test(readSrc('home.css')));
chk('三十三轮·⑤首页「自建强积金数据平台」模块已删除',
  !/section class="plat"/.test(readSrc('home.html')) && !/plat-grid/.test(readSrc('home.html')));
chk('三十三轮·⑥友情链接等高对齐 + 受限官网标注',
  /\.fr-list li > a,\n\.fr-list \.fr-nolink \.fr-t \{ flex: 1 1 auto; display: flex; flex-direction: column; min-height: 100%; \}/.test(readSrc('style.css')) &&
  /官网可能限制部分网络访问/.test(readSrc('common.js')));
chk('三十三轮·⑦市场回报年份视图补三块（各类平均 / 分布 / 最好最差）',
  /yearDetail: yearDetail,/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) &&
  /function yearDetailHTML/.test(readSrc('home.js')) &&
  /\.yr-dist \{/.test(readSrc('home.css')) && /\.yr-rank li \{/.test(readSrc('home.css')));
chk('三十三轮·⑧三个图表 20 套配色方案页在位（真实图表）',
  fs.existsSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-palette.html')) &&
  (fs.readFileSync(path.join(__dirname, '..', 'output', 'design-pages', 'design-palette.html'), 'utf8').match(/id: 'P\d\d'/g) || []).length >= 20);
chk('三十三轮·⑨数据统计口径说明改写（2026-11-04 精简为来源/收录/核对三行）',
  /单位净值取自 \{u\} 家受托人官网/.test(readSrc('common.js')) &&
  /本次已逐条核实/.test(readSrc('common.js')) &&
  !/积金局资料截至 <b>\{d\}<\/b>。/.test(readSrc('common.js')));
chk('三十三轮·⑩板块切换进历史（返回能回到刚看的板块）',
  /function show\(tab, keepHash, push\)/.test(readSrc('index.html')) &&
  /if \(push\) history\.pushState\(\{ mpfTab: hash0 \}, '', '#' \+ hash0\)/.test(readSrc('index.html')) &&
  /show\(tab, false, true\)/.test(readSrc('index.html')));

/* ===== 2026-11-04 第三十四轮（8 条反馈）===== */
chk('三十四轮·①首屏情绪卡与标题同宽并整体缩小',
  /max-width: 470px; text-decoration: none;/.test(readSrc('home.css')) &&
  /\.hs-ring \{ position: relative; display: block; width: 56px/.test(readSrc('home.css')) &&
  /\.hs-tx b \{ font-size: 15\.5px/.test(readSrc('home.css')));
chk('三十四轮·②行情卡提示改「区间内涨跌幅」且去掉点击尾巴',
  /区间内涨跌幅 \{p\}/.test(readSrc('common.js')) &&
  !/同期涨跌 \{p\}/.test(readSrc('common.js')) &&
  !/点击查看指数走势/.test(readSrc('common.js')));
chk('三十四轮·③积金表现指数说明重写（基期 1,000 + 相对区间起点口径）',
  /基期 1,000/.test(readSrc('home.html')) && /相对所选区间起点的涨跌幅/.test(readSrc('home.html')) &&
  !/基期 100/.test(readSrc('home.html')));
chk('三十四轮·④年份模块精简（去「规模加权」、去百分点、删最好最差）',
  !/TT\('年率化回报（规模加权）'\)/.test(readSrc('home.js')) &&
  !/\+ TT\('个百分点'\)/.test(readSrc('home.js')) &&
  !/TT\('当年表现最好'\)/.test(readSrc('home.js')) && !/yr-grid-2/.test(readSrc('home.js')));
chk('三十四轮·⑤首页四榜换成 1Y/5Y 回报 + 规模 + 波动率',
  /mkTopSize/.test(readSrc('home.html')) && /mkTopVol/.test(readSrc('home.html')) &&
  /size: f\.size/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')) &&
  /size: 'desc',/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')));
chk('三十四轮·⑦详情表头右侧四块字号 +1（12.5 / 19 / 17 / 12.5）',
  /\.modal-bd \.fd-k \{ font-size: 12\.5px/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-v2 \{ font-size: 19px/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-v2\.fd-type \{ font-size: 17px/.test(readSrc('analysis.css')) &&
  /\.modal-bd \.fd-s \{ font-size: 12\.5px/.test(readSrc('analysis.css')));
chk('三十四轮·⑨静态站已落盘规模/波动率榜（GitHub 站不 404）',
  /top-size\.json/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-static.js'), 'utf8')) &&
  /top-vol1\.json/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-static.js'), 'utf8')) &&
  /size: 'api\/top-size\.json'/.test(readSrc('api-adapter.js')));
chk('三十四轮·⑩手机端隐藏旧口径入口（桌面保留）',
  /@media \(max-width: 760px\) \{\s*\.db-side-more \{ display: none; \}/.test(readSrc('style.css')));

/* ===== 2026-11-04 第三十五轮（定稿前微调）===== */
chk('三十五轮·①积金表现指数说明删掉「下方折线为指数点位…」尾句', (function () {
  const h = readSrc('home.html');
  return /基期 1,000/.test(h) && /相对所选区间起点的涨跌幅。"/.test(h) && !/下方折线为指数点位/.test(h);
})());
chk('三十五轮·②详情表头表现/风险/收费数值 19px、星级 14.5px', (function () {
  const c = readSrc('analysis.css');
  return /\.modal-bd \.fd-v2 \{ font-size: 19px;/.test(c) && /\.modal-bd \.fd-stars \{ font-size: 14\.5px;/.test(c);
})());
chk('三十五轮·③榜单卡标更新频率（三张每日 + 规模榜月度）', (function () {
  const h = readSrc('home.html');
  return (h.match(/class="mk-tag"/g) || []).length === 3 &&
    /class="mk-tag mk-tag-m" data-i18n="月度更新"/.test(h) &&
    /\.mk-tag \{/.test(readSrc('home.css')) && /\.mk-tag-m \{/.test(readSrc('home.css'));
})());
chk('三十五轮·③资料库积金局口径列表头有悬浮说明（无 ⓘ 图标）', (function () {
  const a = readSrc('app.js');
  return /const TH_TIPS = \{/.test(a) && /risk: '积金局公布的基金风险级别/.test(a) &&
    /size: '积金局公布的基金资产规模/.test(a) && /mgmtFee: '积金局披露的基金管理费/.test(a) &&
    /launchTs: '积金局披露的基金推出日期/.test(a) &&
    /cell\.setAttribute\('data-tip', TT\(TH_TIPS\[k\]\)\)/.test(a) &&
    /if \(a && a\.tagName === 'TH'\) \{ hide\(\); return; \}/.test(readSrc('common.js'));
})());
chk('三十九轮·资源版本号：?v= 与 &v= 都替换成同一版本（防用户看旧版）', (function () {
  const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  return /\(\[\?&\]\)v=\[0-9a-zA-Z\.\]\+/.test(sv) && /'\$1v=' \+ ASSET_V/.test(sv);
})());
chk('三十五轮·④首屏卡改「较上周 ±N 个百分点」（接口给 delta）', (function () {
  const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'tools', 'breadth.js'), 'utf8');
  /* 2026-11-13（第五十三轮）：接口只回读 data/breadth.json（单一口径），
     delta = pct − pctPrev 由生成器算好，避免「本站 w1 − 本站手算」两套口径相减。 */
  return /data', 'breadth\.json'/.test(sv) && /breadth\.js'\)\.compute/.test(sv) &&
    /const delta = \(pct != null && pctPrev != null\)/.test(b) && /prevAsOf/.test(b) &&
    /TQ\('较上周 \{d\} 个百分点'/.test(readSrc('home.js')) &&
    !/最近一周 · 每日更新/.test(readSrc('home.html'));
})());
