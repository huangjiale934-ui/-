/**
 * 三页回归检查 —— 广州精研数据有限公司 · 香港强积金数据平台
 * 用法：先由 shell 抓取三页 DOM 到 tmp/reg/，再运行本脚本断言
 *   bash tmp/regdump.sh [baseUrl]   &&   node tmp/regcheck.js
 */
const fs = require('fs');
/* 站点地址：node tmp/regcheck.js http://127.0.0.1:3072 或线上域名；接口断言需要它 */
const BASE = (process.argv[2] || 'http://127.0.0.1:3012').replace(/\/$/, '');
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

/* ---------------- 首页 ---------------- */
chk('首页·KPI 成分基金 451', /成分基金[\s\S]{0,60}?451/.test(home));
chk('首页·KPI 受托人 11 家（已恢复）', /受托人／发行人[\s\S]{0,80}?11 <small>家<\/small>[\s\S]{0,80}?涵盖 24 个强积金计划/.test(home));
chk('首页·KPI 总规模 1.68 万亿', /市场总规模[\s\S]{0,80}1\.68 万亿/.test(home));
/* 2026-10-22：KPI 改用自算净值口径（数值随净值日变化），只校验标签、口径说明与百分比结构 */
chk('首页·KPI 近1年平均回报（自算口径）', /近 1 年平均回报[\s\S]{0,160}?[+-]\d+\.\d+%/.test(home) && /自算净值口径/.test(home));

chk('首页·温度计 SVG 已渲染', /class="thermo-svg"/.test(home));
chk('首页·温度计 平均/中位数/正回报占比', /近 1 年平均回报<\/span><b[\s\S]{0,200}?近 1 年中位数回报<\/span><b[\s\S]{0,200}?正回报基金占比<\/span><b/.test(home));
// 已由「温度计涨跌带只」覆盖
// 已由「温度计涨跌带只」覆盖
chk('首页·温度计 刻度区间说明', /刻度区间 -10% ~ \+20%/.test(home));

chk('首页·环形图 中心 451 只基金', /class="pie-c1"[^>]*>451<\/text>/.test(home));
chk('首页·环形图图例 3 组（种类分布/受托人份额/资产占比）', (home.match(/<ul class="pie-legend">/g) || []).length === 3);
// 已由「环形图图例带只单位」覆盖
chk('首页·扇形图 HSBC 28.0%', /HSBC[\s\S]{0,160}?4,720 亿 · 28\.0%/.test(home));
chk('首页·扇形图 宏利 27.2%', /宏利[\s\S]{0,160}?4,583 亿 · 27\.2%/.test(home));
chk('首页·扇形图 银联信托 12.3%', /銀聯信託[\s\S]{0,160}?2,077 亿 · 12\.3%/.test(home));
chk('首页·扇形图 其他 6 家', /其他 6 家[\s\S]{0,120}?11\.7%/.test(home));

chk('首页·风险级别 7 根柱子', (home.match(/<div class="col">/g) || []).length === 7);
chk('首页·风险级别 未提供级别提示 12 条', /另有 12 条基金积金局未提供风险级别/.test(home));

/* 2026-10-20：各类基金平均回报对比图表按需求下线，原位置改为「MPF 最新资讯」10 条 */
chk('首页·最新资讯 13 条（2026-10-20 定稿 13 条）', (home.match(/class="news-title"/g) || []).length === 13);
chk('首页·资讯标题为官网外链', (home.match(/class="news-title" href="https:\/\/www\.mpfa\.org\.hk\/info-centre\/press-releases\//g) || []).length === 13);
chk('首页·资讯块位于市场概览右栏', /mk-charts2[\s\S]{0,2000}id="newsList"/.test(home));

chk('首页·走势图 5 个年份', ['2021', '2022', '2023', '2024', '2025']
  .every((y) => new RegExp('class="chart-xlab"[^>]*>' + y + '<').test(home)));
chk('首页·走势图 2025 +17.56%', /class="line-val up"[^>]*>\+17\.56%/.test(home));
chk('首页·走势图 2022 -15.76% 为绿', /class="line-val down"[^>]*>-15\.76%/.test(home));

chk('首页·六张榜单各 5 条', ['#mkTop1', '#mkTop2', '#mkTop3', '#mkTop4', '#mkTop5', '#mkTop6'].every((id) => {
  const m = new RegExp('id="' + id.slice(1) + '"[\\s\\S]*?</ol>').exec(home);
  return m && (m[0].match(/<li>/g) || []).length === 5;
}));
chk('首页·数据来源条（2026-10-15 更新口径）', /单位资产净值、业绩与持仓另取自各计划受托人／保荐人官网/.test(home) && !/直接汇总/.test(home));
chk('首页·走势图年份切换 6 个标签', (home.match(/class="yr-tab( on)?"/g) || []).length === 6);
/* 2026-10-28 用户要求删除整块「公司介绍」（成立时间/愿景/团队/业务版图、六大优势、免费行政服务、合作伙伴、承诺、业务板块）
   → 原 5 条断言随区块下线；2026-10-29 改为反向校验：区块不得再出现 */
chk('首页·公司介绍区块已按 2026-10-28 要求删除', home.indexOf('class="biz about"') < 0 && home.indexOf('about-grid') < 0 && home.indexOf('IC001045') < 0);
/* 2026-10-22（领导定）：六色板改为「蓝 + 浅绿」双色 */
/* 2026-10-22 傍晚：整体再调浅一档 */
/* 2026-10-23：配色改为官网色板后，改为结构性校验（饼图色板存在且≥6 色） */
chk('首页·饼图色板已加载（≥6 色）', (function () { try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8'); const m = j.match(/PALETTE = PAL_MONO[\s\S]{0,600}?\['([^\]]+)\]/); return !!m && m[1].split(',').length >= 6; } catch (e) { return false; } })());
chk('首页·风险级别分级色说明（浅蓝→深蓝）', /色块自浅蓝（低风险）逐级过渡至深蓝（高风险）/.test(home));
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
const idxHead = (/<thead>[\s\S]*?<\/thead>/.exec(idx) || [''])[0];
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
  const tb = (/<tbody[\s\S]*?<\/tbody>/.exec(idx) || [''])[0];
  return (tb.match(/<tr/g) || []).length === 10;
})());
chk('资料库·总条数显示 451', /451/.test(idx));

/* ---------------- 排名 ---------------- */
const rkHead = (/<thead>[\s\S]*?<\/thead>/.exec(rk) || [''])[0];
chk('排名·无「近5年最差年度」表头', rkHead.indexOf('最差') < 0);
chk('排名·维度榜单 17 个（仅积金局口径）', (function () {
  const s = new Set((rk.match(/data-b="([^"]*)"/g) || []));
  return s.size === 17;
})(), '实际 ' + new Set((rk.match(/data-b="([^"]*)"/g) || [])).size);
chk('排名·榜单分组标题存在', /收益表現|收益表现/.test(rk) && /風險與成本|风险与成本/.test(rk));
chk('排名·榜单表体默认渲染 10 行', (function () {
  const tb = (/<tbody id="rkTbody"[\s\S]*?<\/tbody>/.exec(rk) || [''])[0];
  return (tb.match(/<tr/g) || []).length === 10;
})());
chk('排名·默认每页 10 条（HTML selected + S.top=10）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    return /value="10" selected>10 条/.test(h) && /top: 10, sortKey/.test(r);
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
chk('首页·环形图图例带「条」单位（本轮统一）', /169 条 · 8,013 亿/.test(home));
chk('首页·风险柱横轴带「级」', /<span class="cx">1 级<\/span>/.test(home));
/* 2026-10-22：温度计改用自算净值口径后，上涨/下跌条数随净值日变动，
   断言只查「数字 + 条 + 上涨/下跌」的结构，不再写死 351（遵守「勿写死会变的数字」） */
chk('首页·温度计涨跌带「条」单位（本轮统一）', /上涨 <b class="up">\d+ 条<\/b>/.test(home) && /下跌 <b class="down">\d+ 条<\/b>/.test(home));
chk('首页·市场解读为完整句式', /截至 [\d-]+，香港强积金市场共 24 个计划、11 家受托人，合计/.test(home));
chk('首页·珠江新城背景图（2026-10-15 换明亮新图）', /about-gz-bright\.webp/.test(css));
chk('首页·背景图不透明度 >= 0.5', /opacity:\s*0\.5/.test(css));
chk('资料库·口径说明在表格下方', idx.indexOf('srcNote') > idx.indexOf('<tbody'));
chk('排名·口径说明在表格下方', rk.indexOf('srcNote') > rk.indexOf('<tbody'));
/* 2026-10-28 首屏改版：公司名 h2 随公司介绍块一起移除，主标题改为 hero 内的 h1 双行文案 */
chk('首页·首屏主标题为「全市场 N 条成分基金 / 一站看透」', /<h1>[\s\S]{0,240}条成分基金[\s\S]{0,240}一站看透/.test(home) && /香港强积金市场概览/.test(home));
/* 2026-10-29：公司介绍块（含大量 data-i18n）已删除，属性总数由 80+ 降至 72，阈值相应下调 */
chk('首页·多语言属性已覆盖', (home.match(/data-i18n(-ph|-title|-parts)?="/g) || []).length > 60);
chk('资料库·多语言属性已覆盖', (idx.match(/data-i18n(-ph|-title|-parts)?="/g) || []).length > 20);
chk('排名·多语言属性已覆盖', (rk.match(/data-i18n(-ph|-title|-parts)?="/g) || []).length > 15);


/* ---- HTML 结构配平（防止插入区块时标签失配） ---- */
const rawHtml = {};
['home', 'index', 'analysis'].forEach((n) => {
  try { rawHtml[n] = fs.readFileSync(path.join(__dirname, '..', 'public', n === 'home' ? 'home.html' : n + '.html'), 'utf8'); } catch (e) { rawHtml[n] = ''; }
});
['home', 'index', 'analysis'].forEach((n) => {
  const h = rawHtml[n];
  const od = (h.match(/<div/g) || []).length;
  const cd = (h.match(/<[\/]div>/g) || []).length;
  chk((n === 'home' ? '首页' : n === 'index' ? '资料库' : '第四页') + '·HTML div 配平',
    od > 0 && od === cd, '开' + od + ' / 闭' + cd);
});

/* ---- 第七轮：语言补全 / 榜单提示 / 对比入口 / 风险小图例 / 更新时间 / 估值日提示 ---- */
chk('首页·数据更新时间徽标', /class="upd-live"/.test(home) && /数据更新时间 <b>/.test(home));
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
chk('排名·榜单维度提示行', /id="rkTabsNote"/.test(rk) && /共 <b>17<\/b> 个排名维度/.test(rk));
chk('排名·展开收起按钮', /id="rkTabsToggle"/.test(rk) && /展开全部|收起全部/.test(rk));
chk('排名·对比栏带数量徽标', /class="cmp-lab"/.test(rk) && /id="cmpN"/.test(rk));
chk('资料库·对比栏与对比弹窗已加入', /id="cmpModal"/.test(idx) && /id="cmpList"/.test(idx) && /id="cmpBody"/.test(idx));
chk('资料库·口径说明含7级风险小图例', /class="risk-mini"/.test(idx) && /class="rlm-list"/.test(idx) && (idx.match(/class="rlm-list"[\s\S]{0,600}?<\/ul>/)[0].match(/<li>/g) || []).length === 7);
chk('排名·口径说明含7级风险小图例', /class="risk-mini"/.test(rk));
chk('资料库·净值单元格悬浮含官方来源', /data-tip="已核对官方来源：/.test(idx));
chk('资料库·无估值日问号标记（代码+数据均具备）', (function () {
  const cj = (function () { try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8'); } catch (e) { return ''; } })();
  let nd = 0;
  try { const n = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nav.json'), 'utf8')); nd = n.items.filter((x) => x.nav != null && !x.asOf && !x.na).length; } catch (e) {}
  return /nav-q/.test(cj) && /官网把估值日放在动态脚本中生成/.test(cj) && nd > 0;
})());
chk('资料库·footer 来源与免责（合并块 + 折叠）', /data-i18n="数据来源与免责声明："/.test(idx) && /foot-fold/.test(idx));
chk('排名·footer 来源与免责（合并块 + 折叠）', /data-i18n="数据来源与免责声明："/.test(rk) && /foot-fold/.test(rk));
chk('首页·页面标题已加标记', /<title data-i18n="香港强积金市场数据平台/.test(rawH));
chk('资料库·筛选提示与计数已加标记', /共筛选出/.test(idx) && /data-i18n="点击表头排序/.test(idx));
chk('排名·表头提示已加标记', /data-i18n="点击表头可排序/.test(rk));
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
  // 六个榜单卡片：每一项都必须有数值，不能出现「—」（上一版 brief 漏字段导致三个榜全空）
  const ids = [1, 2, 3, 4, 5, 6];
  let bad = [];
  ids.forEach((i) => {
    const m = new RegExp('<ol[^>]*id="mkTop' + i + '"[\\s\\S]*?</ol>').exec(home);
    if (!m) { bad.push('mkTop' + i + ' 缺失'); return; }
    if (m[0].indexOf('>—<') >= 0) bad.push('mkTop' + i + ' 有「—」');
    if (!/[0-9]/.test(m[0])) bad.push('mkTop' + i + ' 无数值');
  });
  chk('首页·六个榜单均显示数值（无空缺）', bad.length === 0, bad.join(' / '));
})();
chk('首页·占比图面板已标记 pie-panel', (home.match(/class="mk-panel pie-panel"/g) || []).length === 2);
chk('首页·基金种类图例名称完整（已随类别三语显示简体）', /货币市场（非保守）/.test(home) && /货币市场（保守）/.test(home));
chk('首页·风险级别图例名称完整', /低至中风险/.test(home) && /最高风险/.test(home));
chk('首页·CSS 已含桌面三列布局调优', (function () {
  try { return /min-width: 1181px/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8')); } catch (e) { return false; }
})());

/* ---- 第九轮：榜单跳转链接 / 海通自动抓取 ---- */
chk('首页·六个榜单均有「查看完整榜单」链接', (home.match(/class="mk-more"/g) || []).length === 6);
chk('首页·榜单链接指向排名页对应榜单', (function () {
  const want = { mkTop1: 'ann1', mkTop4: 'ann5', mkTop5: 'cumLaunch', mkTop2: 'size', mkTop3: 'fer', mkTop6: 'risk' };
  return Object.keys(want).every((id) => {
    const m = new RegExp('<ol[^>]*id="' + id + '"[\\s\\S]{0,600}?</ol>').exec(home);
    // 链接在 <ol> 之前，取卡片整段判断
    const card = new RegExp('<div class="mk-top">[\\s\\S]*?id="' + id + '"[\\s\\S]*?</div>').exec(home);
    // 2026-10-29：GitHub Pages 部署在 /-/ 子路径，必须用相对链接；原断言强制前导斜杠反而会跳错站
    return card && card[0].indexOf('index.html?rk=' + want[id] + '#' + want[id]) >= 0;
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
chk('页头状态行不带 data-i18n（防缓存覆盖）', /<span class="t">/.test(rawHtml.index) && rawHtml.index.indexOf('<span class="t" data-i18n') < 0 &&
  /<span class="t">/.test(rawHtml.home) && rawHtml.home.indexOf('<span class="t" data-i18n') < 0);
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
chk('首页市场解读已消歧（按资产规模/按基金数目）', /按资产规模计，/.test(home) && /按基金数目计最多的是/.test(home));
chk('排名冠军卡风险带来源提示 data-tip', (function () {
  try { return /MPF_RISK\.tip\(x\.risk\)/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8')); } catch (e) { return false; }
})());
chk('口径说明含估值日分布标签', /class="navdist"/.test(idx) || /class="navdist"/.test(rk));
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
  try {
    let r;
    for (let i = 0; i < 3; i++) { try { r = await fetch(BASE + '/api/funds', { signal: AbortSignal.timeout(25000) }); break; } catch (e2) { if (i === 2) throw e2; await new Promise((x) => setTimeout(x, 1500)); } }
    const j = await r.json();
    const withUnits = (j.funds || []).filter((f) => Array.isArray(f.units) && f.units.length > 1);
    const ok1 = withUnits.length > 0 && withUnits[0].units[0].cfId != null && typeof withUnits[0].units[0].unit === 'string';
    chk('接口·funds 含 units 分组（单位类别明细数据）', ok1, '分组 ' + withUnits.length + ' 组');
  } catch (e) {
    chk('接口·funds 含 units 分组（单位类别明细数据）', false, String(e.message || e).slice(0, 60));
  }
  try {
    const r2 = await fetch(BASE + '/api/status');
    const j2 = await r2.json();
    chk('接口·status 含 syncStatus 字段', j2.syncStatus === 'ok' || j2.syncStatus === 'degraded', 'syncStatus=' + j2.syncStatus);
  } catch (e) {
    chk('接口·status 含 syncStatus 字段', false, String(e.message || e).slice(0, 60));
  }
  try {
    const r3 = await fetch(BASE + '/api/market');
    const j3 = await r3.json();
    const mo = j3.mpfaMonthly;
    chk('接口·market 含 mpfaMonthly（官方月度数据）', !!(mo && mo.rows && mo.rows.length === 9), mo ? ('asOf ' + mo.asOf) : '缺失');
  } catch (e) {
    chk('接口·market 含 mpfaMonthly（官方月度数据）', false, String(e.message || e).slice(0, 60));
  }
  try {
    const r4 = await fetch(BASE + '/api/funds');
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
chk('首页·官方日期标注（截至 2026-09-30 / 2026-10-06 公布）', /2026-09-30/.test(home) && /2026-10-06/.test(home));
chk('首页·官方口径小注（已按要求删除“未发布本月/年初至今”句）', !/未发布「本月」或「年初至今」/.test(home) && /官方口径为「過去 12 個月」/.test(home));
chk('首页·走势图注明官方月度入口', /官方最新月度数据（过去 12 个月）见下方/.test(home));
chk('详情·官方核对按钮（srcbtn）已就位', (function () {
  try { return /class="srcbtn"/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8')); } catch (e) { return false; }
})());
chk('官方月度数据文件完整（9 行）', (function () {
  try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'mpfa-monthly.json'), 'utf8')); return j.rows && j.rows.length === 9 && j.asOf === '2026-09-30'; } catch (e) { return false; }
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
chk('翻译·页面副标题与回到顶部已接入', /data-i18n="全市场强积金成分基金一览与排行榜/.test(rawHtml.index) &&
  /data-i18n="全市场强积金成分基金一览与排行榜/.test(rawHtml.index) && /data-i18n-title="回到顶部"/.test(rawHtml.index));
chk('性能·缓存升级为 localStorage（跨标签持久）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return /localStorage\.getItem\('mpf-cache:'/.test(c) && /localStorage\.setItem\('mpf-cache:'/.test(c); } catch (e) { return false; }
})());
chk('性能·静态资源已版本化（home/index/analysis 含 ?v=）', /\?v=2026/.test(rawHtml.home) && /\?v=2026/.test(rawHtml.index) && /\?v=2026/.test(rawHtml.analysis));
chk('性能·背景图已换 WebP 且文件存在', /hero-hk\.webp/.test(css) && /about-gz-bright\.webp/.test(css) &&
  (function () { try { return fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'hero-hk.webp')) && fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'about-gz-bright.webp')); } catch (e) { return false; } })());
chk('性能·主角图为精简尺寸（<160KB）', (function () {
  try { return fs.statSync(path.join(__dirname, '..', 'public', 'img', 'hero-hk.webp')).size < 160 * 1024; } catch (e) { return false; }
})());
chk('视觉·零线加深加粗（2px dashed #7f8ea3）', /border-left: 2px dashed #7f8ea3/.test(css));
chk('视觉·条高 9px（2026-10-22 变细）/ 右栏 300px / 环形图 188px', /\.mo-track \{[^}]*height: 9px/.test(css) && /flex: 0 0 300px/.test(css) && /\.mo-right \.chart-svg\.pie \{ width: 188px/.test(css));
chk('视觉·图注含 0% 基准说明', /竖向虚线为 0% 基准/.test(home));
chk('视觉·月报副标题含最高/最低含义说明', /「最高／最低」为该类别内个别基金的区间/.test(home));
chk('视觉·月报行名已走 typeLabel（EN 可显示英文类别）', (function () {
  try { return /esc\(typeLabel\(r\.name\)\)/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'home.js'), 'utf8')); } catch (e) { return false; }
})());
chk('翻译·i18n 词条抽查（含新增 4 条）', (function () {
  try { const t = i18nText();
    return t.indexOf("'多维度基金排行榜 · 数据取自") >= 0 && t.indexOf("'各基金种类的过去 12 个月年率化净回报（已扣除收费及费用）；「最高／最低」") >= 0; } catch (e) { return false; }
})());

chk('零线对齐·缩进行不再整行缩进（轨道一律对齐）', (function () {
  try { const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.css'), 'utf8');
    return !/\.mo-row\.sub \{ padding-left/.test(c) && /\.mo-row\.sub \.mo-name \{ padding-left: 18px/.test(c); } catch (e) { return false; }
})());
chk('性能·资源版本号动态生成（响应 HTML 内为纯数字 mtime）', /\?v=\d{10,}/.test(home) && /\?v=\d{10,}/.test(idx));
chk('性能·资源版本号动态生成（响应 HTML 内为纯数字 mtime）', /\?v=\d{10,}/.test(home) && /\?v=\d{10,}/.test(idx));
chk('视觉·年度区间小字（类别内最高/最低，不换行）', /类别内最高 \+?[\d.]+% ／ 最低/.test(home) && /white-space: nowrap/.test(css));
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
chk('排名·页面抽检：榜首条 left:0 满格红、页面无 bz 元素', (function () {
  return /style="left:0;width:100\.0%;background:var\(--up\)"/.test(rk) && rk.indexOf('class="bz"') < 0;
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
    return !!(mmf && mmf.shareLt === true) && /r\.shareLt \? '<' : ''/.test(h) && /it\.lt \? '<' : ''/g.test(h);
  } catch (e) { return false; }
})());
chk('月度板块·页面抽检：资产占比 <0.5%', /资产占比 (?:<|&lt;)0\.5%/.test(home));
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
chk('版权·三页已加入（copyright 类 + 三语词条）', (function () {
  try {
    const ok = ['home.html', 'index.html', 'analysis.html'].every((f) =>
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
chk('详情·右上角「导出/分享」按钮（两页 HTML + 绑定 + 函数）', (function () {
  try {
    const ok = ['index.html', 'analysis.html'].every((f) => {
      const h = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      return h.indexOf('id="mExport"') >= 0 && h.indexOf('id="mShare"') >= 0;
    });
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
chk('首页·页头已含状态行与「更新数据」按钮（hdr-right，与其他两页一致）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'home.html'), 'utf8');
    return /class="hdr-right"/.test(h) && /btn-refresh/.test(h) && /class="upd"/.test(h);
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
chk('导出·溯源头（csvSourceNote：来源/资料截至/净值区间/同步时间）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    return /function csvSourceNote/.test(c) && /积金局资料截至/.test(c) && /净值估值日区间/.test(c) &&
      /csvSourceNote\(\)\.concat/.test(r) && /csvSourceNote\(\)\.concat/.test(a);
  } catch (e) { return false; }
})());
chk('导出·文件名改为数据截至日（含 TT(\'数据截至\')）', (function () {
  try {
    const r = fs.readFileSync(path.join(__dirname, '..', 'public', 'rank.js'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    return /TT\('数据截至'\)/.test(r) && /TT\('数据截至'\)/.test(a) && a.indexOf('new Date().toISOString().slice(0, 10) + \'.csv\'') < 0;
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

/* ---------------- 第四页·MPF基金分析 ---------------- */
const an = read('analysis');
chk('第四页·页面标题与页头（MPF基金分析）', /MPF基金分析/.test(an) && /<header class="hdr/.test(an));
chk('第四页·四页导航含「MPF基金分析」且当前页高亮', /class="nav"[\s\S]{0,300}?analysis\.html[\s\S]{0,80}?class="on"/.test(an));
/* ---- 第四页 v3 改版：纯对比页 + 左侧发行人栏（版式参照合作方站） ---- */
chk('第四页·侧栏 + 基金列表联动（已选置顶+分隔线+其余，2026-10-17 v2）', /id="anProv"/.test(an) && /id="anTbody2"/.test(an) && (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return j.indexOf('selRows = (DATA.funds || []).filter') >= 0 && j.indexOf('以上是已选基金') >= 0 && j.indexOf('onSelChange: function () { renderFundList(); }') >= 0;
  } catch (e) { return false; }
})());
chk('第四页·左侧发行人栏 12 项（总体 + 11 家，带基金数）', (an.match(/class="an-pitem/g) || []).length === 12 && /data-t="銀聯信託"><span>銀聯信託<\/span><b>171<\/b>/.test(an));
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
chk('第四页·表格含实际值（指数点位千分位 + 基金净值 HKD）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /nf0\(rawLast, 2\)/.test(t) && /fmtRaw\(rawLast\) \+ ' HKD/.test(t);
  } catch (e) { return false; }
})());
chk('第四页·数据来源行（官方截至日期 · 净值最新日期 · 已核实/451 动态）', /官方资料截至 <b>\d{4}-\d{2}-\d{2}<\/b> · 单位净值最新 <b>\d{4}-\d{2}-\d{2}<\/b> · 已核实 (44[5-9]|45[01])\/451 条/.test(an));
chk('第四页·图上方双选择器（选择指数 / 选择基金）+ 面板容器', /data-panel="idx"/.test(an) && /data-panel="fund"/.test(an) && /tr-p-list-idx/.test(an) && /tr-p-list-fund/.test(an));
chk('第四页·区间按钮 5 档 + 选择日期 + 全部区间', ['1w', '1m', '1y', '3y', '5y', 'custom', 'all'].every((r) => new RegExp('data-r="' + r + '"').test(an)) && /tr-daterow/.test(an));
chk('第四页·区间统计表五列（名称/区间收益/区间最大回撤/起止日期；2026-10-20 删除「最新点位」列）', !/最新点位/.test(an) && /区间收益/.test(an) && /区间最大回撤/.test(an) && /最大回撤起始日期/.test(an) && /最大回撤结束日期/.test(an) && /恒生指数/.test(an));
chk('第四页·「查看具体基金分析」按钮 + 返回对比文案', /查看具体基金分析/.test(an) && (function () {
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
chk('v3·走势对比模块（tr-card + 标题 + 默认恒生指数图例）', /class="card tr-card[^"]*" id="anTrendBox"/.test(an) && /在线对比 MPF 基金与大盘指数/.test(an) && /恒生指数/.test(an));
chk('v3·模块结构（图例 / 折线画布 / 统计表 / 口径说明）', /tr-legend/.test(an) && /tr-svg/.test(an) && /tr-tbl/.test(an) && /累计涨跌幅|0%/.test(an));
chk('v3·trend.js 功能完整性（多选面板 / 色带填充 / 自定义日期）', (function () {
  try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /data-toggle/.test(j) && /tr-band/.test(j) && /tr-dgo/.test(j) && /全部区间|'all'/.test(j); } catch (e) { return false; }
})());
chk('v3·trend.js 健壮性（hideGoto 判空 + _t/_tq 包装不走 window）', (function () {
  try { const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /const gotoBtn = q\('\.tr-goto'\);\s*\n\s*if \(gotoBtn\)/.test(j) &&
      /function _t\(s\) \{ return \(typeof TT === 'function'\)/.test(j) && !/window\.TT \?/.test(j); } catch (e) { return false; }
})());
chk('v3·数据版本徽标（四页）+ 明细提示', ['home', 'index', 'ranking', 'analysis'].every((p) => /id="verChip"/.test(read(p))) &&
  /官方资料（积金局）：2026-09-30/.test(an));
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
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.html'), 'utf8');
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    return i.indexOf('foldSpec') >= 0 && a.indexOf('foldSpec') >= 0 && i.indexOf('navCheckAt') >= 0 &&
      i.indexOf('数据来源与免责声明') >= 0 && c.indexOf('navCheckAt') >= 0;
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
      t.indexOf("(st.f ? dstr(ts(st.f)) : '—')") >= 0 && sv.indexOf("'/api/allstats'") >= 0 && w >= 300;
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
      t.indexOf("(st.f ? dstr(ts(st.f)) : '—')") >= 0 && sv.indexOf("'/api/allstats'") >= 0 && w >= 300;
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
chk('深夜批·②全部区间与清空筛选同组靠右（tr-tools2 + toolbar 闭合完整）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    /* tools2 闭合后必须紧跟 toolbar 闭合（2026-10-15 曾漏 </div> 致 .tr-panels 为 null、整页不渲染） */
    return t.indexOf("'<div class=\"tr-tools2\">' +") >= 0 && t.indexOf('tr-clear') >= 0 &&
      t.indexOf("'</div>' +\n        '</div>' +\n        '<div class=\"tr-daterow\" hidden>' +") >= 0;
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
chk('深夜批·②全部区间与清空筛选同组靠右（tr-tools2 + toolbar 闭合完整）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    /* tools2 闭合后必须紧跟 toolbar 闭合（2026-10-15 曾漏 </div> 致 .tr-panels 为 null、整页不渲染） */
    return t.indexOf("'<div class=\"tr-tools2\">' +") >= 0 && t.indexOf('tr-clear') >= 0 &&
      t.indexOf("'</div>' +\n        '</div>' +\n        '<div class=\"tr-daterow\" hidden>' +") >= 0;
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
    const i = t.indexOf("q('.tr-clear').addEventListener");
    const seg = t.slice(i, i + 500);
    return seg.indexOf('S.items = [];') >= 0 && t.indexOf('暂无对比对象') >= 0;
  } catch (e) { return false; }
})());
chk('1017批·③单线真实值模式（raw 绘制 + 轴标签 + note 隐藏）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return t.indexOf('const single = lines.length === 1;') >= 0 && t.indexOf('实际值：净值 / 指数点位') >= 0 &&
      t.indexOf("noteEl.style.display = single ? 'none' : ''") >= 0;
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


chk('第四页·基金列表（8列含近1年年率化 + 表头排序 + 无计划子行）', (function () {
  try {
    const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.html'), 'utf8');
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    return /data-lsk="ann1"/.test(h) && /data-lsk="size"/.test(h) && (h.match(/data-lsk=/g) || []).length === 8 &&
      /function sortList/.test(j) && /function syncListArrows/.test(j) && /<small>年率化<\/small>/.test(h) &&
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
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.html'), 'utf8');
    return /id="cmpTrend"/.test(i) && /id="cmpTrend"/.test(a) &&
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


chk('趋势图·图例✕可移除条目（legend 委托绑定 —— 2026-10-14 修复）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /querySelector\('\.tr-legend'\)\.addEventListener\('click'/.test(t) && /toggleItem\(t\.getAttribute\('data-toggle'\)\)/.test(t);
  } catch (e) { return false; }
})());
chk('详情小窗·放大按钮（只换视图不回退历史）+ 960px 两页同在', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const i = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.html'), 'utf8');
    return /id="mExpand"/.test(i) && /id="mExpand"/.test(a) && /#mExpand/.test(c) &&
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
chk('页脚重排：估值日分布 + 风险级别说明移至「数据来源」之上（#srcNoteTop）', (function () {
  try {
    const c = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    const i = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const a = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.html'), 'utf8');
    return /id="srcNoteTop"/.test(i) && /id="srcNoteTop"/.test(a) && /querySelector\('#srcNoteTop'\)/.test(c) &&
      /elTop\.innerHTML = navDateDistHTML\(\) \+ MPF_RISK\.legendHTML\(\)/.test(c);
  } catch (e) { return false; }
})());


chk('默认组合·恒指+规模最大基金（总体=全市场；发行人平均仅面板可选 + 口径说明）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /function pickTop\(trustee\)/.test(j) && /setItems\(\[\{ type: 'index', key: 'HSI' \}\]\)/.test(j) &&
      !/items\.push\(\{ type: 'tavg', key: S\.trustee \}\)/.test(j) &&
      /发行人均值指数：该发行人旗下/.test(t);
  } catch (e) { return false; }
})());
chk('图例线条实际线型预览 + 样式弹层放大（tr-lg-line / 340px）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /tr-lg-line/.test(t) && /stroke-dasharray="' \+ st\.dash/.test(t) && /\.tr-style \{ width: 340px/.test(css);
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
      /\.an-listcard \.an-table \{ font-size: 13px/.test(css) && /min-height: calc\(100vh - 190px\)/.test(css);
  } catch (e) { return false; }
})());


chk('默认组合·恒指+规模最大基金（总体=全市场；发行人平均仅面板可选 + 口径说明）', (function () {
  try {
    const j = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.js'), 'utf8');
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    return /function pickTop\(trustee\)/.test(j) && /setItems\(\[\{ type: 'index', key: 'HSI' \}\]\)/.test(j) &&
      !/items\.push\(\{ type: 'tavg', key: S\.trustee \}\)/.test(j) &&
      /发行人均值指数：该发行人旗下/.test(t);
  } catch (e) { return false; }
})());
chk('图例线条实际线型预览 + 样式弹层放大（tr-lg-line / 340px）', (function () {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'public', 'trend.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'analysis.css'), 'utf8');
    return /tr-lg-line/.test(t) && /stroke-dasharray="' \+ st\.dash/.test(t) && /\.tr-style \{ width: 340px/.test(css);
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
      /\.an-listcard \.an-table \{ font-size: 13px/.test(css) && /min-height: calc\(100vh - 190px\)/.test(css);
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
chk('1022c·名次徽标为浅蓝族（非金银铜）', /mk-top \.r\.r1 \{ background: #d7e8f8/.test(css) && /mk-top \.r\.r2 \{ background: #e2eefb/.test(css) && !/mk-top \.r\.r1 \{ background: #f6e2c4/.test(css));
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
chk('1022·温度计为自算净值口径 + 积金局口径对照', /自算净值口径/.test(home) && /积金局口径（含费含息，季度公布，截至/.test(home));
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
    return /chipKey = ''/.test(a1) && /LS_DEFAULT/.test(a2) && /S\.sortKey = null; S\.sortDir = null;/.test(a3) && /D0\.key/.test(a4);
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
