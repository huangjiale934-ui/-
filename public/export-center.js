/* 批量导出中心（8.0，2026-11-19）
   ------------------------------------------------------------------
   入口：资料库「数据说明」折叠区底部「批量导出数据 →」；资料库「导出」按钮也走这里
        （预置当前筛选结果，字段默认全选 = 与旧导出一致）。
   设计：先筛基金 → 再选字段 → 导出 xlsx。字段注册表复用 app.js 的 buildExportSchema()，
        保证列名、百分比口径（存百分数 + 0.00"%"）、隐藏列与旧导出完全一致。
   约束：纯前端生成（A/B 两站同代码）；逐日净值不限只数（按区间控制体积）；持仓图只画前 30 只。 */
(function () {
  if (window.__ecInit) return;
  window.__ecInit = 1;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 字段分组按 COLS 下标切分（与 app.js 的列顺序一一对应） */
  const GROUPS = [
    { k: 'info', n: '基本信息', idx: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { k: 'perf', n: '净值与回报', idx: [10, 11, 12, 13, 14, 15, 16] },
    { k: 'risk', n: '风险与自算指标', idx: [17, 18, 19, 20, 21, 22, 23] },
    { k: 'fee', n: '规模与费用', idx: [24, 25, 26, 27] },
  ];
  const HIDDEN_IDX = [2, 4, 5];   /* 单位类别 / 基金细类 / 强积金计划：默认隐藏，保留真实列宽 */

  const ST = {
    open: false,
    sel: new Set(),
    fields: new Set(),      /* 本站最新数据列下标 */
    idxFields: new Set(),   /* 指数口径字段下标（IDX_FIELDS） */
    extra: new Set(),       /* 'hld' | 'hist' | 'trend' */
    histRange: '1y',        /* 逐日净值区间：1y/3y/5y/10y/all/custom */
    histFrom: '', histTo: '', dateMsg: '',
    mode: 'latest',         /* latest=本站最新数据 / mpfa=积金局月度口径 / both=两种口径各一张表 */
    panels: new Set(),      /* 附加表的二级筛选面板，点「筛选」才展开 */
    trendMode: 'one',       /* 2026-11-22（用户要求）：默认每只单独一张 */
    kw: '',
    trustee: new Set(),
    cat: new Set(),
    scheme: new Set(),
    navOnly: false,
    busy: false,
    preset: null,           /* 打开时预置的 id 列表（来自当前筛选） */
  };

  /* ===== 2026-11-22（用户要求）：导出「其他市场指数」 =====
     受托人下拉最底部多一项；选中后左侧列出站内全部指数，右侧字段切换成指数口径。 */
  const IDXK = '__IDX__';
  const IDX_GROUPS = [
    { k: 'ibase', n: '基本信息', idx: [0, 1, 2, 3, 4, 16, 17] },
    { k: 'iperf', n: '点位与回报', idx: [5, 6, 7, 8, 9, 10, 11] },
    { k: 'irisk', n: '风险与波动', idx: [12, 13, 14, 15] },
  ];
  const IDX_FIELDS = [
    { n: '指数名称', d: '指数中文名称', w: 24, get: (r) => r.it.name || r.key },
    { n: '代码', d: '数据源代码（自算指数无官方代码，显示站点键名）', w: 14, get: (r) => r.it.code || r.key },
    { n: '类别', d: '港股 / 美股 / 日股 / A 股 / 自算 MPF 指数', w: 16, get: (r) => (window.idxMetaOf && (window.idxMetaOf(r.key) || {}).cat) || '指数' },
    { n: '最新点位', d: '区间最后一个交易日的收盘点位', w: 12, num: true, get: (r) => (r.st ? r.st.lastV : null) },
    { n: '最新日期', d: '最新点位对应的交易日', w: 12, get: (r) => (r.st ? r.st.asOf : '') },
    { n: '近 1 月', d: '最近 30 个自然日的涨跌幅', w: 10, pct: true, get: (r) => (r.st ? r.st.r1m : null) },
    { n: '近 3 月', d: '最近 91 个自然日的涨跌幅', w: 10, pct: true, get: (r) => (r.st ? r.st.r3m : null) },
    { n: '近 6 月', d: '最近 182 个自然日的涨跌幅', w: 10, pct: true, get: (r) => (r.st ? r.st.r6m : null) },
    { n: '年初至今', d: '以上一年最后一个交易日为基准的涨跌幅', w: 10, pct: true, get: (r) => (r.st ? r.st.ytd : null) },
    { n: '近 1 年', d: '最近 365 个自然日的涨跌幅', w: 10, pct: true, get: (r) => (r.st ? r.st.r1y : null) },
    { n: '近 3 年', d: '最近 3 年的累计涨跌幅（未年化）', w: 10, pct: true, get: (r) => (r.st ? r.st.r3y : null) },
    { n: '近 5 年', d: '最近 5 年的累计涨跌幅（未年化）', w: 10, pct: true, get: (r) => (r.st ? r.st.r5y : null) },
    { n: '年化波动率', d: '近一年日收益率标准差按平均间隔年化', w: 11, pct: true, get: (r) => (r.st ? r.st.vol : null) },
    { n: '最大回撤（1 年）', d: '近一年内从峰值到谷底的最大跌幅', w: 13, pct: true, get: (r) => (r.st ? r.st.mdd : null) },
    { n: '52 周最高', d: '近一年内的最高点位', w: 11, num: true, get: (r) => (r.st ? r.st.hi : null) },
    { n: '52 周最低', d: '近一年内的最低点位', w: 11, num: true, get: (r) => (r.st ? r.st.lo : null) },
    { n: '数据起点', d: '该指数序列的第一个交易日', w: 12, get: (r) => (r.st ? r.st.first : '') },
    { n: '数据点数', d: '该指数序列的观测点数', w: 10, num: true, get: (r) => (r.st ? r.st.points : null) },
  ];

  /* 2026-11-19（用户建议）：记住上次的基金/字段/口径/区间，重复导出省一步 */
  const LSKEY = 'mpf-ec-v1';
  function persist() {
    try {
      const cur = window.mpfExportSchema ? window.mpfExportSchema().COLS.length : 28;
      const o = {
        mode: ST.mode, extra: Array.from(ST.extra), histRange: ST.histRange, histFrom: ST.histFrom, histTo: ST.histTo,
        trendMode: ST.trendMode, navOnly: ST.navOnly,
        fields: Array.from(ST.fields).filter((i) => i < cur),
        trustee: Array.from(ST.trustee), cat: Array.from(ST.cat), scheme: Array.from(ST.scheme),
      };
      localStorage.setItem(LSKEY, JSON.stringify(o));
    } catch (e) {}
  }
  function restore() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(LSKEY) || 'null'); } catch (e) { o = null; }
    if (!o) return false;
    ST.mode = 'latest';
    ST.extra = new Set(Array.isArray(o.extra) ? o.extra.filter((k) => ['hld', 'hist', 'trend'].indexOf(k) >= 0) : []);
    ST.histRange = ['1y', '3y', '5y', '10y', 'all', 'custom'].indexOf(o.histRange) >= 0 ? o.histRange : '1y';
    ST.histFrom = o.histFrom || ''; ST.histTo = o.histTo || '';
    ST.trendMode = o.trendMode === 'one' ? 'one' : 'merge';
    ST.navOnly = !!o.navOnly;
    ST.trustee = new Set(Array.isArray(o.trustee) ? o.trustee : []);
    ST.cat = new Set(Array.isArray(o.cat) ? o.cat : []);
    ST.scheme = new Set(Array.isArray(o.scheme) ? o.scheme : []);
    if (Array.isArray(o.fields) && o.fields.length) ST.fields = new Set(o.fields);
    return true;
  }

  /* common.js 用顶层 let 声明 DATA —— 它不会挂到 window 上，必须按全局词法绑定读取 */
  const DS = () => (typeof DATA !== 'undefined' && DATA ? DATA : {});
  /* 是否处于「其他市场指数」模式 */
  const isIdx = () => ST.trustee.has(IDXK);
  let IDXC = null;          /* /api/indices 缓存 */
  function idxRows() {
    const items = (IDXC && IDXC.items) || {};
    const ORDER = ['HSI', 'HSCEI', 'HSTECH', 'SPX', 'NDX', 'DJIA', 'N225', 'CSI300', 'SSE', 'SZSE',
      'CHINEXT', 'CSI500', 'SSE50', 'STAR50', 'MPFAVG', 'MPF_STOCK', 'MPF_MIX', 'MPF_BOND', 'MPF_MONEY', 'MPF_GUAR'];
    const rank = (k) => { const i = ORDER.indexOf(k); return i < 0 ? 99 : i; };
    return Object.keys(items).map((k) => {
      const it = items[k];
      return { key: k, it: it, st: window.idxStatsOf ? window.idxStatsOf(it) : null };
    }).sort((a, b) => rank(a.key) - rank(b.key) || (a.it.name || '').localeCompare(b.it.name || '', 'zh-Hans-CN'));
  }
  function ensureIdx() {
    if (IDXC) return Promise.resolve(IDXC);
    if (!window.loadIndices) return Promise.resolve(null);
    return window.loadIndices().then((j) => { IDXC = j; return j; });
  }
  const rowsAll = () => ((DS().funds) || []).slice();
  const catOf = (x) => ((window.splitFundType ? (window.splitFundType(x) || {}).cat : '') || x.type || '').trim();
  const nameOf = (x) => (window.fundDisplayName ? window.fundDisplayName(x) : (x.fundBase || x.fund || ''));
  const latestNav = () => {
    let d = '';
    rowsAll().forEach((f) => { if (f.navAsOf && f.navAsOf > d) d = f.navAsOf; });
    return d;
  };

  /* ---------- 筛选 ---------- */
  function filtered() {
    const kw = ST.kw.trim().toLowerCase();
    const latest = latestNav();
    /* 只选了「其他市场指数」时没有真实受托人 → 基金列表为空（不再返回全部 451 只） */
    const real = Array.from(ST.trustee).filter((v) => v !== IDXK);
    if (isIdx() && !real.length) return [];
    return rowsAll().filter((x) => {
      if (real.length && real.indexOf(x.trustee) < 0) return false;
      if (ST.cat.size && !ST.cat.has(catOf(x))) return false;
      if (ST.scheme.size && !ST.scheme.has(x.scheme)) return false;
      if (ST.navOnly && x.navAsOf !== latest) return false;
      if (kw) {
        const hay = (nameOf(x) + ' ' + (x.scheme || '') + ' ' + (x.trustee || '')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  /* ---------- 多选下拉 ---------- */
  function msValues(key, rows) {
    const m = new Map();
    (rows || rowsAll()).forEach((x) => {
      const v = key === 'trustee' ? x.trustee : key === 'cat' ? catOf(x) : x.scheme;
      if (!v) return;
      m.set(v, (m.get(v) || 0) + 1);
    });
    const label = (v) => (key === 'trustee' && window.trusteeDisplay ? window.trusteeDisplay(v) : (key === 'cat' && window.typeLabel ? window.typeLabel(v) : v));
    /* 2026-11-21（用户要求）：受托人按合作深度排序（宏利/银联/友邦优先），计划按宏利/银联优先；
       其余类型仍按条数降序。 */
    const vals = Array.from(m.keys());
    const ordered = key === 'trustee'
      ? (window.mpfSortTrustees ? window.mpfSortTrustees(vals) : vals)
      : key === 'scheme'
        ? (window.mpfSortSchemes ? window.mpfSortSchemes(vals) : vals)
        : vals.sort((a, b) => m.get(b) - m.get(a));
    return ordered.map((v) => ({ v, n: m.get(v), label: label(v) }));
  }

  /* 2026-11-19（用户反馈）：改用与资料库表头同一套多选组件，并做三级联动——
     选受托人后，种类/计划只列该受托人下存在的值；选种类后再收窄计划。 */
  let MS_T = null, MS_C = null, MS_S = null;

  function ensureMS() {
    if (MS_T) return;
    MS_T = window.MPFMulti('#ecMSTrustee', {
      allLabel: TT('全部受托人'),
      onChange: (arr) => { ST.trustee = new Set(arr); rebuildLinked('trustee'); renderTree(); renderList(); persist(); },
    });
    MS_C = window.MPFMulti('#ecMSCat', {
      allLabel: TT('全部种类'),
      onChange: (arr) => { ST.cat = new Set(arr); rebuildLinked('cat'); persist(); },
    });
    MS_S = window.MPFMulti('#ecMSScheme', {
      allLabel: TT('全部计划'),
      onChange: (arr) => { ST.scheme = new Set(arr); renderList(); persist(); },
    });
  }

  /* 依当前更上层的选择，重算下面两级可选项并剔除失效选择 */
  function linkedRows(level) {
    return rowsAll().filter((x) => {
      if (level !== 'trustee' && ST.trustee.size && !ST.trustee.has(x.trustee)) return false;
      if (level === 'scheme' && ST.cat.size && !ST.cat.has(catOf(x))) return false;
      return true;
    });
  }

  function rebuildLinked(from) {
    ensureMS();
    if (isIdx()) {
      /* 2026-11-22（用户要求）：指数模式保留这两个筛选框，点开显示「无」，
         保持与基金模式一致的版式，不隐藏、不跳位。 */
      MS_C.setOptions([]); MS_C.setAllLabel(TT('无'));
      MS_S.setOptions([]); MS_S.setAllLabel(TT('无'));
      renderList();
      return;
    }
    const cats = msValues('cat', linkedRows('cat'));
    MS_C.setOptions(cats.map((o) => ({ v: o.v, label: o.label, n: o.n })));
    MS_C.setAllLabel(TT('全部种类'));
    const validCat = new Set(cats.map((o) => o.v));
    ST.cat = new Set(Array.from(ST.cat).filter((v) => validCat.has(v)));
    MS_C.setSelected(Array.from(ST.cat), true);

    const sch = msValues('scheme', linkedRows('scheme'));
    MS_S.setOptions(sch.map((o) => ({ v: o.v, label: o.label, n: o.n })));
    MS_S.setAllLabel(TT('全部计划'));
    const validSch = new Set(sch.map((o) => o.v));
    ST.scheme = new Set(Array.from(ST.scheme).filter((v) => validSch.has(v)));
    MS_S.setSelected(Array.from(ST.scheme), true);
    renderList();
  }

  function renderMS() {
    ensureMS();
    const tr = msValues('trustee');
    /* 2026-11-22（用户要求）：最底部追加「其他市场指数」 */
    const opts = tr.map((o) => ({ v: o.v, label: o.label, n: o.n }));
    opts.push({ v: IDXK, label: TT('其他市场指数'), n: (IDXC && Object.keys(IDXC.items || {}).length) || 20, idx: true });
    MS_T.setOptions(opts);
    MS_T.setAllLabel(TT('全部受托人'));
    MS_T.setSelected(Array.from(ST.trustee), true);
    rebuildLinked('trustee');
  }

  /* ---------- 列表 ---------- */
  function renderList() {
    const box = $('#ecList');
    if (!box) return;
    if (isIdx() && !ST.idxFields.size) IDX_FIELDS.forEach((f, i) => ST.idxFields.add(i));
    /* 2026-11-22（用户要求）：指数与受托人可同时选 —— 基金行 + 指数行一起列出；
       只选「其他市场指数」时没有真实受托人，基金列表自然为空。 */
    const list = filtered();
    const latest = latestNav();
    const kw = ST.kw.trim().toLowerCase();
    const idxLatest = idxRows().reduce((m, r) => (r.st && r.st.asOf > m ? r.st.asOf : m), '');
    const idxPick = isIdx()
      ? idxRows().filter((r) => {
        if (ST.navOnly && !(r.st && r.st.asOf === idxLatest)) return false;
        if (!kw) return true;
        const cat = (window.idxMetaOf && (window.idxMetaOf(r.key) || {}).cat) || '';
        return ((r.it.name || '') + ' ' + r.key + ' ' + cat).toLowerCase().indexOf(kw) >= 0;
      })
      : [];
    const fundHtml = list.map((x) => {
      const id = String(x.id);
      const on = ST.sel.has(id);
      return '<label class="ec-row' + (on ? ' on' : '') + '">' +
        '<input type="checkbox" data-id="' + esc(id) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="ec-nm">' + esc(nameOf(x)) + (x.unit ? ' <i>' + esc(x.unit) + '</i>' : '') + '</span>' +
        '<span class="ec-mt"> · ' + esc(x.navAsOf === latest ? TT('最新') : (x.navAsOf || '—')) + '</span>' +
        '</label>';
    }).join('');
    const idxHtml = idxPick.map((r) => {
      const id = 'IDX:' + r.key;
      const on = ST.sel.has(id);
      return '<label class="ec-row ec-row-idx' + (on ? ' on' : '') + '">' +
        '<input type="checkbox" data-id="' + esc(id) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="ec-nm">' + esc(r.it.name || r.key) + (r.it.code ? ' <i>' + esc(r.it.code) + '</i>' : '') + '</span>' +
        '<span class="ec-mt"> · ' + esc(r.st ? r.st.asOf : (r.it.asOf || '—')) + '</span>' +
        '</label>';
    }).join('');
    const allHtml = fundHtml + idxHtml;
    box.innerHTML = allHtml ||
      '<div class="ec-empty">' + esc(isIdx() && !list.length ? TT('没有符合条件的指数') : TT('没有符合条件的基金')) + '</div>';
    paintNavOnly();
    paintCounts(list.length + idxPick.length);
  }

  function paintCounts(n) {
    const total = isIdx() ? idxRows().length : rowsAll().length;
    const sel = ST.sel.size;
    /* 2026-11-20（用户要求）：已选 = 本站（字段 + 附加工作表）+ 积金局，分别显示 */
    const localN = isIdx() ? ST.idxFields.size : (ST.fields.size + ST.extra.size);
    const fcnt = isIdx() ? ST.idxFields.size : ST.fields.size;
    const sc = $('#ecSelCount');
    if (sc) sc.textContent = TQ('已选 {n} / {t}', { n: sel, t: total });
    const fc = $('#ecFieldCount');
    if (fc) fc.textContent = TQ('已选 {n} 项', { n: localN });
    const est = $('#ecEst');
    if (est) {
      const sheets = isIdx() ? 2 : (2 + ST.extra.size);
      est.textContent = isIdx()
        ? TQ('预计输出：{s} 个工作表 · {r} 行 × {c} 列', { s: sheets, r: sel + 1, c: fcnt })
        : TQ('预计输出：{s} 个工作表 · {r} 行 × {c} 列', { s: sheets, r: sel + 2, c: fcnt });
    }
    const go = $('#ecGo');
    if (go) go.disabled = ST.busy || !sel || (isIdx() ? !ST.idxFields.size : !ST.fields.size);
  }

  /* 2026-11-21（用户要求）：只保留本站最新数据一种口径，组与集合固定 */
  function curGroups() { return isIdx() ? IDX_GROUPS : GROUPS; }
  function curFieldSet() { return isIdx() ? ST.idxFields : ST.fields; }

  /* 2026-11-19（用户反馈）：字段树改为双列排布，右栏不再留大片空白 */
  function renderTree() {
    const box = $('#ecTree');
    if (!box) return;
    const RANGES = [['1y', '1年'], ['3y', '3年'], ['5y', '5年'], ['10y', '10年'], ['all', '全部'], ['custom', '选择日期']];
    const rangeSel = '<div class="ec-subcard">' +
      '<div class="ec-sub-h">' + esc(TT('时间区间')) + '</div>' +
      '<div class="ec-range"><div class="tr-ranges" role="group" aria-label="' + esc(TT('区间')) + '">' +
      RANGES.map((o) => '<button type="button" class="tr-r' + (ST.histRange === o[0] ? ' on' : '') + '" data-range="' + o[0] + '">' + esc(TT(o[1])) + '</button>').join('') +
      '</div></div>' +
      '<div class="ec-daterow"' + (ST.histRange === 'custom' ? '' : ' hidden') + '>' +
      '<input type="text" id="ecDateFrom" placeholder="2026-01-19" inputmode="numeric" maxlength="10" aria-label="' + esc(TT('起始日期')) + '" value="' + esc(ST.histFrom || '') + '">' +
      '<span>~</span><input type="text" id="ecDateTo" placeholder="' + esc(DS().dataAsOf || '2026-11-17') + '" inputmode="numeric" maxlength="10" aria-label="' + esc(TT('结束日期')) + '" value="' + esc(ST.histTo || '') + '">' +
      '<button type="button" class="btn sm" id="ecDateGo">' + esc(TT('确定')) + '</button>' +
      '<span class="ec-dmsg" id="ecDateMsg">' + esc(ST.dateMsg || '') + '</span></div></div>';
    /* 2026-11-19（用户要求）：去掉「方式」小标签，只保留两个按钮，与左侧标题水平对齐 */
    const trendSel = '<div class="ec-range ec-range-mode">' +
      '<div class="tr-ranges" role="group" aria-label="' + esc(TT('净值走势图')) + '">' +
      [['merge', '合并走势对比图'], ['one', '每只基金单独一张']].map((o) =>
        '<button type="button" class="tr-r' + (ST.trendMode === o[0] ? ' on' : '') + '" data-tmode="' + o[0] + '">' + esc(TT(o[1])) + '</button>').join('') +
      '</div></div>';

    if (isIdx()) {
      /* 指数口径：字段固定（指数没有单位类别/受托人/费用等基金字段） */
      const SET = ST.idxFields;
      box.innerHTML = IDX_GROUPS.map((g) => {
        const on = g.idx.filter((i) => SET.has(i)).length;
        const cells = g.idx.map((i) => '<label class="ec-f" title="' + esc(IDX_FIELDS[i].n) + '">' +
          '<input type="checkbox" data-i="' + i + '"' + (SET.has(i) ? ' checked' : '') + '>' +
          '<span>' + esc(TT(IDX_FIELDS[i].n)) + '</span></label>').join('');
        return '<div class="ec-g ec-card">' +
          '<label class="ec-g-h"><input type="checkbox" data-g="' + g.k + '"' + (on === g.idx.length ? ' checked' : '') + '>' +
          '<b>' + esc(TT(g.n)) + '</b><span>' + on + '/' + g.idx.length + '</span></label>' +
          '<div class="ec-g-b">' + cells + '</div></div>';
      }).join('') +
        '<div class="ec-g ec-card"><div class="ec-g-h"><b>' + esc(TT('附加工作表')) + '</b>' +
        '<span>' + esc(TT('勾选后在右侧展开设置')) + '</span></div>' +
        '<div class="ec-mods">' +
        /* 2026-11-22（用户要求）：指数没有持仓/分布数据，直接不提供这一项，避免每次都要写说明 */
        modRow('trend', '净值走势图', '', trendSel) +
        modRow('hist', '逐日净值', '', rangeSel) +
        '</div></div>' +
        '<div class="ec-idxtip">' + esc(TT('指数数据与走势图同源（东方财富日线 + 本站自算 MPF 指数），每晚随数据更新重算；区间回报为价格涨幅，不含分红。')) + '</div>';
      return;
    }
    const schema = window.mpfExportSchema ? window.mpfExportSchema() : null;
    if (!schema) { box.innerHTML = '<div class="ec-empty">' + esc(TT('导出组件未加载，请刷新页面')) + '</div>'; return; }
    const COLS = schema.COLS;
    const groups = curGroups();
    const SET = curFieldSet();
    const cells = (g) => g.idx.map((i) => '<label class="ec-f" title="' + esc(COLS[i][4] || '') + '">' +
      '<input type="checkbox" data-i="' + i + '"' + (SET.has(i) ? ' checked' : '') + '>' +
      '<span>' + esc(COLS[i][0]) + '</span></label>').join('');

    /* 2026-11-19（用户反馈）：区间改成站内走势图同款的胶囊按钮；日期改文本框（年月日手输），
       避免日历控件翻年份；确定后给出明确的已选区间提示。 */
    box.innerHTML = groups.map((g) => {
      const on = g.idx.filter((i) => SET.has(i)).length;
      return '<div class="ec-g ec-card">' +
        '<label class="ec-g-h"><input type="checkbox" data-g="' + g.k + '"' + (on === g.idx.length ? ' checked' : '') + '>' +
        '<b>' + esc(TT(g.n)) + '</b><span>' + on + '/' + g.idx.length + '</span></label>' +
        '<div class="ec-g-b">' + cells(g) + '</div></div>';
    }).join('') +
      '<div class="ec-g ec-card"><div class="ec-g-h"><b>' + esc(TT('附加工作表')) + '</b>' +
      '<span>' + esc(TT('勾选后在右侧展开设置')) + '</span></div>' +
      '<div class="ec-mods">' +
      modRow('hld', '前十大持仓 + 投资组合分布', '', '') +
      modRow('trend', '净值走势图', '', trendSel) +
      modRow('hist', '逐日净值', '', rangeSel) +
      '</div></div>';
  }

  /* 2026-11-19（用户要求 v2）：三个附加表上下排列；勾选即在右侧展开二级设置，取消勾选即收起 */
  function modRow(key, title, sub, panel) {
    const on = ST.extra.has(key);
    return '<div class="ec-mod' + (on ? ' on' : '') + (panel ? '' : ' no-p') + '">' +
      '<div class="ec-mod-l"><div class="ec-mod-lab"><input type="checkbox" data-x="' + key + '"' + (on ? ' checked' : '') + '>' +
      '<span class="ec-mod-t">' + esc(TT(title)) + '</span>' +
      '<span class="ec-mod-s">' + esc(TT(sub)) + '</span></div></div>' +
      (panel ? '<div class="ec-mod-p"' + (on ? '' : ' hidden') + '>' + panel + '</div>' : '') +
      '</div>';
  }

  /* ---------- 弹窗 ---------- */
  function build() {
    if ($('#ecModal')) return;
    const el = document.createElement('div');
    el.className = 'ec-modal';
    el.id = 'ecModal';
    el.innerHTML =
      '<div class="ec-box" role="dialog" aria-modal="true" aria-labelledby="ecTitle">' +
      '<div class="ec-head"><b id="ecTitle">' + esc(TT('基金数据导出中心')) + '</b>' +

      '<button type="button" class="ec-x" aria-label="' + esc(TT('关闭')) + '">×</button></div>' +
      '<div class="ec-cols">' +
      '<section class="ec-left"><div class="ec-cap">① ' + esc(TT('选基金')) + ' <span id="ecSelCount"></span></div>' +
      '<input id="ecKw" class="ec-kw" type="search" placeholder="' + esc(TT('搜索基金名称 / 计划 / 受托人')) + '" autocomplete="off">' +
      '<span class="mf" id="ecMSTrustee"></span><span class="mf" id="ecMSCat"></span><span class="mf" id="ecMSScheme"></span>' +
      '<div class="ec-btns"><button type="button" data-a="all">' + esc(TT('全选')) + '</button>' +
      '<button type="button" data-a="inv">' + esc(TT('反选')) + '</button>' +
      '<button type="button" data-a="none">' + esc(TT('清空')) + '</button></div>' +
      '<div class="ec-list" id="ecList"></div>' +
      /* 2026-11-19（用户要求）：仅最新净值挪到列表下方，腾一行多显示一只基金 */
      '<label class="ec-only ec-only-foot"><input type="checkbox" id="ecNavOnly"><span id="ecNavOnlyLab">' + esc(TT('仅选择最新净值日的基金')) + '</span></label></section>' +
      '<section class="ec-right"><div class="ec-cap">② ' + esc(TT('选数据')) + ' <span id="ecFieldCount"></span></div>' +
      '<div class="ec-tree" id="ecTree"></div></section>' +
      '</div>' +
      '<div class="ec-foot"><span id="ecEst"></span>' +
      '<button type="button" class="btn ghost" id="ecCancel">' + esc(TT('取消')) + '</button>' +
      '<button type="button" class="btn" id="ecGo">' + esc(TT('导出 xlsx')) + '</button></div>' +
      '</div>';
    document.body.appendChild(el);
  }

  /* 2026-11-21（用户要求）：先说清「有多少只已更新到最新日」，再说「只选这些」 */
  function paintNavOnly() {
    const lab = $('#ecNavOnlyLab');
    if (!lab) return;
    if (isIdx()) {
      const rows = idxRows();
      const latest = rows.reduce((m, r) => (r.st && r.st.asOf > m ? r.st.asOf : m), '');
      const n = rows.filter((r) => r.st && r.st.asOf === latest).length;
      lab.textContent = n
        ? TQ('仅选择已更新至 {d} 的 {n} 只指数', { d: latest, n })
        : TT('仅选择最新日期的指数');
      const cb = $('#ecNavOnly');
      if (cb) cb.disabled = false;
      return;
    }
    const all = rowsAll();
    const latest = latestNav() || '';
    const n = all.filter((x) => x.navAsOf === latest).length;
    const rest = all.length - n;
    lab.textContent = n
      ? TQ('仅选择已更新至 {d} 的 {n} 只基金', { d: latest, n })
      : TT('仅选择最新净值日的基金');
  }

  function syncSel() {
    document.querySelectorAll('#ecList .ec-row').forEach((r) => {
      const cb = r.querySelector('input[data-id]');
      if (cb) r.classList.toggle('on', ST.sel.has(cb.getAttribute('data-id')));
    });
  }

  function open(preset) {
    build();
    ST.open = true;
    ST.preset = Array.isArray(preset) ? preset.map(String) : null;
    if (ST.preset) {
      /* 预置 = 当前筛选结果；若用户此前没有手动选过，直接用预置覆盖 */
      ST.sel = new Set(ST.preset);
    }
    const schema = window.mpfExportSchema ? window.mpfExportSchema() : null;
    const had = restore();
    /* 2026-11-20：本站字段默认全选；积金局字段默认不选（只按上次记忆恢复） */
    const cols = schema ? schema.COLS.length : 0;
    if (!had || !ST.fields.size || Array.from(ST.fields).some((i) => i >= cols)) {
      ST.fields = new Set();
      for (let i = 0; i < cols; i++) ST.fields.add(i);   /* 默认全选 = 与旧导出一致 */
    }
    ensureIdx().then(() => { if (ST.open) { renderMS(); renderList(); } }).catch(() => {});
    renderMS(); renderTree(); renderList(); paintNavOnly();
    $('#ecModal').classList.add('show');
  }

  function close() {
    ST.open = false;
    const m = $('#ecModal');
    if (m) m.classList.remove('show');
    /* 2026-11-22（用户反馈）：关掉导出中心后走势图十字线失效 —— 让图表按当前尺寸重绘一次 */
    setTimeout(function () { if (window.__trendWake) window.__trendWake(); }, 60);
  }

  /* ---------- 导出 ---------- */
  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  /* ---------- 净值序列（逐日表与走势图共用） ---------- */
  const PALETTE = ['#0a6cbf', '#d9534f', '#2e9e5b', '#e08b1a', '#7a5cc6', '#0f9b9b', '#c2477d', '#5b6b7f', '#8a6d3b', '#1f7ae0'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

  /* 区间以「最新净值日」为锚，保证同一天导出的截止日一致 */
  function rangeStart(range) {
    if (range === 'all') return '';
    if (range === 'custom') return ST.histFrom || '';
    const days = range === '3y' ? 1095 : range === '5y' ? 1825 : range === '10y' ? 3653 : 365;
    const base = latestNav() ? new Date(latestNav() + 'T00:00:00') : new Date();
    base.setDate(base.getDate() - days);
    return isoDay(base);
  }
  function rangeEnd() { return ST.histRange === 'custom' ? (ST.histTo || '') : ''; }

  async function loadSeries(list, onProgress) {
    const out = new Map();
    const queue = list.slice();
    let done = 0;
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length) {
        const x = queue.shift();
        try {
          const r = await fetch('/api/hist/' + encodeURIComponent(String(x.id)), { cache: 'default' });
          if (r.ok) {
            const h = await r.json();
            const ser = Array.isArray(h.series) ? h.series : [];
            out.set(String(x.id), ser.filter((p) => Array.isArray(p) && p.length >= 2));
          }
        } catch (e) { /* 单只失败不阻断 */ }
        done += 1;
        if (onProgress) onProgress(done, list.length);
      }
    });
    await Promise.all(workers);
    return out;
  }

  /* 走势对比图（起点 = 100）。纯 SVG 字符串，便于直接光栅化成 PNG 塞进 xlsx。 */
  function trendSVG(lines) {
    const W = 980, H = 400, L = 64, R = 16, T = 14, B = 34;
    const dates = Array.from(new Set(lines.flatMap((l) => l.pts.map((p) => p[0])))).sort();
    const xi = new Map(dates.map((d, i) => [d, i]));
    const series = lines.map((l, i) => {
      const base = l.pts[0] && l.pts[0][1];
      return {
        name: l.name, color: l.color || PALETTE[i % PALETTE.length],
        data: l.pts.map((p) => [xi.get(p[0]), base ? (p[1] / base) * 100 : 100]).filter((d) => d[1] != null && isFinite(d[1])),
      };
    });
    let min = Infinity, max = -Infinity;
    series.forEach((s) => s.data.forEach((d) => { if (d[1] < min) min = d[1]; if (d[1] > max) max = d[1]; }));
    if (!isFinite(min) || !isFinite(max)) { min = 90; max = 110; }
    const pad = (max - min) * 0.08 || 1;
    min -= pad; max += pad;
    const X = (i) => L + (W - L - R) * (dates.length > 1 ? i / (dates.length - 1) : 0);
    const Y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = min + ((max - min) * k) / 4;
      const y = Y(v);
      g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '" stroke="#e6eef7" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="#8195a9" font-size="11">' + v.toFixed(0) + '</text>';
    }
    const step = Math.max(1, Math.ceil(dates.length / 6));
    for (let i = 0; i < dates.length; i += step) {
      g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" fill="#8195a9" font-size="11">' + dates[i].slice(0, 7) + '</text>';
    }
    series.forEach((s) => {
      const pts = s.data.map((d) => X(d[0]).toFixed(1) + ',' + Y(d[1]).toFixed(1)).join(' ');
      g += '<polyline fill="none" stroke="' + s.color + '" stroke-width="1.8" stroke-linejoin="round" points="' + pts + '"/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="#fff"/>' +
      '<style>text{font-family:"Microsoft YaHei",sans-serif}</style>' + g + '</svg>';
  }

  /* SVG 字符串 → PNG dataURL（2 倍分辨率；图例画在底部，避免压住曲线） */
  function svgPng(svg, w, h, legend) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        img.onload = () => {
          const items = legend || [];
          const perRow = 3;
          const rows = items.length ? Math.ceil(items.length / perRow) : 0;
          const legendH = rows ? rows * 26 + 8 : 0;
          const cv = document.createElement('canvas');
          cv.width = w * 2; cv.height = (h + legendH) * 2;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, w * 2, h * 2);
          /* 画布是 2 倍分辨率，图例也按 2 倍行距绘制，否则下半部会留大片空白 */
          ctx.font = '600 30px "Microsoft YaHei", sans-serif';
          ctx.textBaseline = 'middle';
          items.forEach((it, i) => {
            const col = i % perRow, row = Math.floor(i / perRow);
            const x = 22 + col * ((w * 2 - 40) / perRow);
            const y = h * 2 + 42 + row * 52;
            ctx.strokeStyle = it.color; ctx.lineWidth = 8; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 56, y); ctx.stroke();
            ctx.fillStyle = '#142846';
            ctx.fillText(String(it.name).slice(0, 26), x + 66, y + 2);
          });
          URL.revokeObjectURL(url);
          resolve(cv.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
        img.src = url;
      } catch (e) { resolve(''); }
    });
  }

  /* 2026-11-22（用户要求）：指数导出 —— 一张表，字段随勾选变化 */
  async function exportIdx() {
    if (ST.busy) return;
    if (!ST.sel.size) { mpfToast(TT('请至少选择一个指数')); return; }
    if (!ST.idxFields.size) { mpfToast(TT('请至少选择一个字段')); return; }
    if (!window.MPFXLSX) { mpfToast(TT('导出组件未加载，请刷新页面')); return; }
    const go = $('#ecGo'), est = $('#ecEst');
    ST.busy = true; if (go) go.disabled = true;
    let pct = 6;
    const tick = (t) => { if (est) est.textContent = t; if (t) prog(pct, t); };
    await progShow(TT('正在准备指数数据…'));
    try {
      await ensureIdx();
      const rows = idxRows().filter((r) => ST.sel.has('IDX:' + r.key));
      /* 只勾了基金（指数一个没选）：直接走基金导出，别生成空的指数表 */
      if (!rows.length) { ST.busy = false; ST.fundFallback = true; try { return await exportNow(); } finally { ST.fundFallback = false; } }
      const picked = Array.from(ST.idxFields).sort((a, b) => a - b);
      const head = picked.map((i) => ({ v: TT(IDX_FIELDS[i].n), s: 2 }));
      const body = rows.map((r) => ({
        cells: picked.map((i) => {
          const f = IDX_FIELDS[i], v = f.get(r);
          if (f.pct) return (v == null || !isFinite(v)) ? { v: '', s: 4 } : { v: Math.round(v * 1e4) / 1e6, s: 5 };
          if (f.num) return (v == null || !isFinite(v)) ? { v: '', s: 4 } : { v: Math.round(v * 1e4) / 1e4, s: 7 };
          return { v: v == null ? '' : String(v), s: 4 };
        }),
      }));
      const idxLatest = rows.reduce((m, r) => (r.st && r.st.asOf > m ? r.st.asOf : m), '');
      const lastCol = colLetter(picked.length);
      const sheet = {
        name: TT('指数数据'),
        rows: [{ h: 32, cells: [{ v: TT('市场指数数据') + ' · ' + TQ('截至 {d}', { d: idxLatest || '—' }), s: 1 }] },
          { h: 34, cells: head }].concat(body),
        merges: ['A1:' + lastCol + '1'],
        cols: picked.map((i) => [IDX_FIELDS[i].w]),
        freeze: { x: 0, y: 2, top: 'A3' },
        autoFilter: 'A2:' + lastCol + (body.length + 2),
      };
      const sheets = [sheet];
      /* 2026-11-22（用户反馈「同时选指数和受托人」）：基金也一起导 —— 用默认全列出一张基金表 */
      const fundIds = Array.from(ST.sel).filter((id) => String(id).indexOf('IDX:') !== 0);
      if (fundIds.length && window.mpfExportSchema) {
        const sc = window.mpfExportSchema();
        const COLS = sc.COLS;
        const fr = rowsAll().filter((x) => fundIds.indexOf(String(x.id)) >= 0);
        const all = COLS.map((c, i) => i);
        sheets.push({
          name: TT('基金数据'),
          rows: [{ h: 32, cells: [{ v: TT('基金最新数据') + ' · ' + TQ('净值截至 {d}', { d: latestNav() || DS().dataAsOf || '—' }), s: 1 }] },
            { h: 34, cells: all.map((i) => ({ v: COLS[i][0], s: 2 })) }]
            .concat(fr.map((x, ri) => ({ cells: all.map((i) => sc.cellOf(x, ri, COLS[i])) }))),
          merges: ['A1:' + colLetter(all.length) + '1'],
          cols: all.map((i) => COLS[i][3]),
          freeze: { x: 1, y: 2, top: 'B3' },
          autoFilter: 'A2:' + colLetter(all.length) + (fr.length + 2),
        });
      }
      /* 附加工作表：逐日净值 / 走势图 / 持仓说明 */
      const from = rangeStart(ST.histRange), to = rangeEnd();
      if (ST.extra.has('hist')) {
        const out = [{ h: 30, cells: [{ v: TT('逐日点位（每行一个交易日）'), s: 1 }] },
          { h: 30, cells: [TT('指数名称'), TT('日期'), TT('点位'), TT('日涨跌')].map((v) => ({ v, s: 2 })) }];
        rows.forEach((r) => {
          const ser = (r.it.series || []).filter((q) => (!from || q[0] >= from) && (!to || q[0] <= to));
          let prev = null;
          ser.forEach((q) => {
            const v = Number(q[1]);
            const chg = prev ? Math.round((v / prev - 1) * 1e4) / 100 : '';
            out.push({ cells: [
              { v: r.it.name || r.key, s: 4 }, { v: q[0], s: 4 },
              { v: isFinite(v) ? Math.round(v * 1e4) / 1e4 : '', s: 7 },
              chg === '' ? { v: '', s: 4 } : { v: chg, s: 21 },
            ] });
            prev = v;
          });
        });
        sheets.push({ name: TT('逐日净值'), rows: out, merges: ['A1:D1'], cols: [26, 12, 14, 10], freeze: { x: 0, y: 2, top: 'A3' } });
      }
      if (ST.extra.has('trend')) {
        pct = 72; tick(TT('正在绘制指数走势…')); await nextPaint();
        const lines = rows.map((r, i) => ({
          name: r.it.name || r.key, color: PALETTE[i % PALETTE.length],
          pts: (r.it.series || []).filter((q) => (!from || q[0] >= from) && (!to || q[0] <= to)),
        })).filter((l) => l.pts.length > 1);
        if (!lines.length) mpfToast(TT('所选区间内没有可画图的点位'));
        else if (ST.trendMode === 'merge' || lines.length === 1) {
          const legendH = Math.ceil(lines.length / 3) * 26 + 8;
          const png = await svgPng(trendSVG(lines), 980, 400, lines.map((l) => ({ name: l.name, color: l.color })));
          if (png) sheets.push({
            name: TT('净值走势图'),
            rows: [{ h: 30, cells: [{ v: TT('指数走势（起点 = 100）'), s: 1 }] }, { h: 16, cells: [{ v: '', s: 4 }] }],
            merges: ['A1:H1'],
            cols: Array(8).fill(16),
            images: [{ data: png, col: 0, row: 1, fitW: 860, fitH: 400 + legendH, name: TT('净值走势图') }],
          });
        } else {
          const rowsT = [{ h: 30, cells: [{ v: TT('各指数走势（起点 = 100）'), s: 1 }] }];
          const mergesT = ['A1:H1'];
          const images = [];
          let rr = 1;
          for (let i = 0; i < lines.length; i++) {
            rowsT.push({ h: 24, cells: [{ v: lines[i].name, s: 3 }] });
            rr += 1; mergesT.push('A' + rowsT.length + ':H' + rowsT.length);
            const png = await svgPng(trendSVG([lines[i]]), 900, 280, []);
            if (png) images.push({ data: png, col: 0, row: rr, fitW: 860, fitH: 280, name: lines[i].name });
            for (let k = 0; k < 14; k++) { rowsT.push({ h: 16, cells: [{ v: '', s: 4 }] }); rr += 1; }
          }
          sheets.push({ name: TT('净值走势图'), rows: rowsT, merges: mergesT, cols: Array(8).fill(16), images: images });
        }
      }
      if (window.buildCoverSheet) {
        pct = 88; tick(TT('正在生成数据说明…')); await nextPaint();
        sheets.unshift(window.buildCoverSheet({
          page: TT('数据导出'),
          title: TT('数据说明'),
          meta: [
            [TT('数据口径'), TT('市场指数（与走势图同源）')],
            [TT('数据截至'), idxLatest || '—'],
            [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
            [TT('导出范围'), TQ('{n} 个指数', { n: rows.length })],
          ],
          notes: [
            TT('指数日线来自东方财富；自算 MPF 指数为本站按成分基金官方净值等权链式累计（基期 = 1000，不含费用），非官方指数。'),
            TT('区间回报为价格涨幅，不含分红与费用；年化波动率按近一年日收益率年化，最大回撤取近一年峰值到谷底的最大跌幅。'),
            TT('空白单元格＝该指数无此项数据（例如自算指数没有官方代码），本站不推测。'),
          ],
          columns: picked.map((i) => [TT(IDX_FIELDS[i].n), TT(IDX_FIELDS[i].d || '')]),
        }));
      }
      if (est) est.textContent = TT('正在打包 xlsx…');
      pct = 94; prog(94, TT('正在打包 xlsx…')); await nextPaint();
      const blob = window.MPFXLSX.build({ sheets: sheets });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MPF市场指数_' + (idxLatest || '') + '.xlsx';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      mpfToast(TQ('已导出 {n} 个指数、{c} 个字段', { n: rows.length, c: picked.length }));
      progDone(true);
      /* 2026-11-22（用户要求）：导出完成后留在导出中心 */
    } catch (e) {
      console.error('[export-center:idx]', e);
      progDone(false);
      mpfToast(TT('导出失败，请稍后重试'));
    } finally { ST.busy = false; if (go) go.disabled = false; paintCounts(); }
  }


  /* 2026-11-22（用户反馈「进度条根本看不到」）：
     ① 原来 show 之后立刻同步跑重活，浏览器没有机会绘制 → 现在每次更新都让出两帧；
     ② 大数据分块 await，进度是实时的，不是最后一下从 0 跳到 100；
     ③ 成功后不再关闭导出中心（用户要求留在原地），浮层显示「导出成功」后自动淡出。 */
  let PROG_EL = null, PROG_HIDE = 0;
  const nextPaint = () => new Promise(function (r) {
    /* 后台标签页里 rAF 会被暂停，必须留一个定时兜底，否则导出会一直卡住 */
    let done = false;
    const fin = function () { if (!done) { done = true; r(); } };
    try { requestAnimationFrame(function () { requestAnimationFrame(fin); }); } catch (e) {}
    setTimeout(fin, 120);
  });
  function progEl() {
    if (PROG_EL) return PROG_EL;
    PROG_EL = document.createElement('div');
    PROG_EL.className = 'ec-prog';
    PROG_EL.innerHTML = '<div class="ec-prog-box"><div class="ec-prog-t">正在导出…</div>' +
      '<div class="ec-prog-bar"><i></i></div><div class="ec-prog-n">0%</div></div>';
    document.body.appendChild(PROG_EL);
    return PROG_EL;
  }
  function prog(pct, text) {
    const el = progEl();
    clearTimeout(PROG_HIDE);
    el.classList.add('show');
    const n = Math.max(2, Math.min(100, Math.round(pct)));
    el.querySelector('.ec-prog-bar i').style.width = n + '%';
    el.querySelector('.ec-prog-n').textContent = n + '%';
    if (text) el.querySelector('.ec-prog-t').textContent = text;
  }
  /* 先画出来再干活：连等两帧，确保用户点完导出立刻看到进度条 */
  async function progShow(text) {
    prog(2, text || TT('正在导出…'));
    await nextPaint();
    await nextPaint();
  }
  function progDone(ok) {
    if (!PROG_EL) return;
    PROG_EL.querySelector('.ec-prog-bar i').style.width = '100%';
    PROG_EL.querySelector('.ec-prog-n').textContent = '100%';
    PROG_EL.querySelector('.ec-prog-t').textContent = ok ? TT('导出成功') : TT('导出失败');
    PROG_HIDE = setTimeout(function () { if (PROG_EL) PROG_EL.classList.remove('show'); }, ok ? 1100 : 2400);
  }

  /* 2026-11-22（用户要求）：对外统一入口 —— 单只基金（详情页）/多只基金（对比页）导出，
     工作表顺序与「全量导出」完全一致：数据说明 / 基金数据 / 持仓与分布 / 逐日净值 / 净值走势图。
     opts.compareSheet 存在时插到第 2 位（基金对比页专用）。 */
  const _fundBook = async function (list, opts) {
    opts = opts || {};
    const rowsSel = (list || []).slice();
    if (!rowsSel.length || !window.MPFXLSX) return false;
    const sc = window.mpfExportSchema ? window.mpfExportSchema() : null;
    if (!sc) return false;
    const COLS = sc.COLS;
    const all = COLS.map((c, i) => i);
    const navLatest = (function () { let m = ''; (DS().funds || []).forEach((f) => { if (f.navAsOf && f.navAsOf > m) m = f.navAsOf; }); return m; })();
    const lastCol = colLetter(all.length);
    const fundSheet = {
      name: TT('基金数据'),
      rows: [{ h: 32, cells: [{ v: TT('基金最新数据') + ' · ' + TQ('净值截至 {d}', { d: navLatest || DS().dataAsOf || '—' }), s: 1 }] },
        { h: 34, cells: all.map((i) => ({ v: COLS[i][0], s: 2 })) }]
        .concat(rowsSel.map((x, ri) => ({ cells: all.map((i) => sc.cellOf(x, ri, COLS[i])) }))),
      merges: ['A1:' + lastCol + '1'],
      cols: all.map((i) => COLS[i][3]),
      freeze: { x: 1, y: 2, top: 'B3' },
      autoFilter: 'A2:' + lastCol + (rowsSel.length + 2),
    };
    ST.extra.add('hld'); ST.extra.add('hist'); ST.extra.add('trend');
    const sheets = [];
    if (window.buildCoverSheet) {
      sheets.push(window.buildCoverSheet({
        page: TT('数据导出'),
        title: TT('数据说明'),
        meta: [
          [TT('数据口径'), TT('本站每日净值自算')],
          [TT('净值截至'), navLatest || '—'],
          [TT('积金局字段截至'), DS().dataAsOf || '—'],
          [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
          [TT('导出范围'), TQ('{n} 条成分基金（按单位类别逐条）', { n: rowsSel.length })],
        ],
        notes: [
          TT('净值来源：各计划受托人／保荐人官网每日公布的单位资产净值；风险级别、基金规模、历年回报、基金开支比率等字段取自积金局「强积金基金平台」（按月更新，通常滞后 1–2 个月）。'),
          TT('自算指标（日涨跌 / 近1周 / 近1个月 / 年初至今 / 近1年 / 近3年 / 近5年年化 / 最大回撤 / 波动率 / 夏普 / 超额收益）由本站按发行人官网净值直接计算，不含分红再投资与费用调整；与积金局公布的同名指标口径不同，不可直接相减。'),
          TT('夏普比率显示 n.a. 表示该基金近 1 年年化波动率低于 0.5%，比值会被极小的分母放大而失真，故不提供。'),
          TT('空白单元格＝该基金当日无官方净值，或积金局未公布该字段；本站不插值、不使用前值填充。'),
        ],
        columns: all.map((i) => [COLS[i][0], COLS[i][4] || '']),
      }));
    }
    if (opts.compareSheet) sheets.push(Object.assign({ name: TT('基金对比') }, opts.compareSheet));
    sheets.push(fundSheet);
    if (window.buildHoldAllocSheet) {
      try {
        const ent = rowsSel.map((x) => ({ id: x.id, name: nameOf(x) }));
        const sh = await window.buildHoldAllocSheet(ent, { chartLimit: 30, imgScale: 0.8 });
        if (sh) sheets.push(Object.assign({ name: TT('持仓与分布') }, sh));
      } catch (e) {}
    }
    const from = '', to = '';
    prog(60, TT('正在读取逐日净值…')); await nextPaint();
    const seriesMap = await loadSeries(rowsSel, null);
    const histRows = [{ h: 30, cells: [{ v: TT('逐日净值（每行一个交易日）'), s: 1 }] },
      { h: 30, cells: [TT('基金名称'), TT('日期'), TT('单位资产净值'), TT('日涨跌')].map((v) => ({ v, s: 2 })) }];
    rowsSel.forEach((x) => {
      const nm = nameOf(x);
      const ser = (seriesMap.get(String(x.id)) || []);
      let prev = null;
      ser.forEach((p) => {
        const v = Number(p[1]);
        const chg = prev ? Math.round((v / prev - 1) * 1e4) / 100 : '';
        histRows.push({ cells: [{ v: nm, s: 4 }, { v: p[0], s: 4 },
          { v: isFinite(v) ? Math.round(v * 1e4) / 1e4 : '', s: 6 },
          chg === '' ? { v: '', s: 4 } : { v: chg, s: 21 }] });
        prev = v;
      });
    });
    sheets.push({ name: TT('逐日净值'), rows: histRows, merges: ['A1:D1'], cols: [30, 12, 14, 10], freeze: { x: 0, y: 2, top: 'A3' } });
    /* 净值走势图：默认每只一张；对比导出（opts.mergeTrend）用一张合并对比图 */
    const lines = rowsSel.map((x, i) => ({
      name: nameOf(x), color: PALETTE[i % PALETTE.length],
      pts: (seriesMap.get(String(x.id)) || []),
    })).filter((l) => l.pts.length > 1);
    if (lines.length && opts.mergeTrend) {
      const legendH = Math.ceil(lines.length / 3) * 26 + 8;
      const png = await svgPng(trendSVG(lines), 980, 400, lines.map((l) => ({ name: l.name, color: l.color })));
      if (png) sheets.push({
        name: TT('净值走势图'),
        rows: [{ h: 30, cells: [{ v: TT('净值走势对比（起点 = 100）'), s: 1 }] }, { h: 16, cells: [{ v: '', s: 4 }] }],
        merges: ['A1:H1'],
        cols: Array(8).fill(16),
        images: [{ data: png, col: 0, row: 1, fitW: 860, fitH: 400 + legendH, name: TT('净值走势图') }],
      });
    } else if (lines.length) {
      /* 2026-11-22（用户要求）：表头 + 每只基金名，合并单元格并居中 */
      const rowsT = [{ h: 30, cells: [{ v: TT('各基金净值走势（起点 = 100）'), s: 1 }] }];
      const mergesT = ['A1:H1'];
      const images = [];
      let r = 1;
      for (let i = 0; i < lines.length; i++) {
        rowsT.push({ h: 24, cells: [{ v: lines[i].name, s: 3 }] });
        r += 1; mergesT.push('A' + rowsT.length + ':H' + rowsT.length);
        const png = await svgPng(trendSVG([lines[i]]), 900, 280, []);
        if (png) images.push({ data: png, col: 0, row: r, fitW: 860, fitH: 280, name: lines[i].name });
        for (let k = 0; k < 14; k++) { rowsT.push({ h: 16, cells: [{ v: '', s: 4 }] }); r += 1; }
      }
      sheets.push({ name: TT('净值走势图'), rows: rowsT, merges: mergesT, cols: Array(8).fill(16), images: images });
    }
    prog(92, TT('正在打包 xlsx…')); await nextPaint();
    const blob = window.MPFXLSX.build({ sheets: sheets });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'MPF基金数据_' + (navLatest || '') + '.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    return true;
  };

  /* 对外入口：先亮进度条再干活（详情页 / 对比页导出都可能几秒），完成后显示「导出成功」 */
  window.mpfFundBook = async function (list, opts) {
    await progShow(TT('正在准备数据…'));
    try {
      const ok = await _fundBook(list, opts);
      progDone(!!ok);
      return ok;
    } catch (e) {
      progDone(false);
      throw e;
    }
  };

  /* 2026-11-22（用户反馈「在恒生指数详情页导出，结果是一只基金的表格」）：
     原因是指数详情复用了基金详情的弹窗与 #mExport 按钮，按钮上还挂着上一只基金的导出闭包。
     这里提供指数专用工作簿，指数详情打开时会重新绑定按钮。 */
  window.mpfIndexBook = async function (keys) {
    const list = (keys || []).map(String).filter(Boolean);
    if (!list.length || !window.MPFXLSX) return false;
    let pct = 8;
    const tick = (t) => { if (t) prog(pct, t); };
    await progShow(TT('正在准备指数数据…'));
    try {
      await ensureIdx();
      const rows = idxRows().filter((r) => list.indexOf(String(r.key)) >= 0);
      if (!rows.length) { progDone(false); return false; }
      const all = IDX_FIELDS.map((f, i) => i);
      const lastCol = colLetter(all.length);
      const idxLatest = rows.reduce((m, r) => (r.st && r.st.asOf > m ? r.st.asOf : m), '');
      const sheets = [];
      if (window.buildCoverSheet) {
        pct = 20;
        sheets.push(window.buildCoverSheet({
          page: TT('数据导出'),
          title: TT('数据说明'),
          meta: [
            [TT('数据口径'), TT('市场指数（与走势图同源）')],
            [TT('数据截至'), idxLatest || '—'],
            [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
            [TT('导出范围'), TQ('{n} 个指数', { n: rows.length })],
          ],
          notes: [
            TT('指数日线来自东方财富；自算 MPF 指数为本站按成分基金官方净值等权链式累计（基期 = 1000，不含费用），非官方指数。'),
            TT('区间回报为价格涨幅，不含分红与费用；年化波动率按近一年日收益率年化，最大回撤取近一年峰值到谷底的最大跌幅。'),
            TT('指数为价格指数，编制机构不公布成分持仓明细，本站亦不提供前十大持仓或资产分布。'),
            TT('空白单元格＝该指数无此项数据（例如自算指数没有官方代码），本站不推测。'),
          ],
          columns: all.map((i) => [TT(IDX_FIELDS[i].n), TT(IDX_FIELDS[i].d || '')]),
        }));
      }
      const body = rows.map((r) => ({
        cells: all.map((i) => {
          const f = IDX_FIELDS[i], v = f.get(r);
          if (f.pct) return (v == null || !isFinite(v)) ? { v: '', s: 4 } : { v: Math.round(v * 1e4) / 1e6, s: 5 };
          if (f.num) return (v == null || !isFinite(v)) ? { v: '', s: 4 } : { v: Math.round(v * 1e4) / 1e4, s: 7 };
          return { v: v == null ? '' : String(v), s: 4 };
        }),
      }));
      sheets.push({
        name: TT('指数数据'),
        rows: [{ h: 32, cells: [{ v: TT('市场指数数据') + ' · ' + TQ('截至 {d}', { d: idxLatest || '—' }), s: 1 }] },
          { h: 34, cells: all.map((i) => ({ v: TT(IDX_FIELDS[i].n), s: 2 })) }].concat(body),
        merges: ['A1:' + lastCol + '1'],
        cols: all.map((i) => [IDX_FIELDS[i].w]),
        freeze: { x: 1, y: 2, top: 'B3' },
        autoFilter: 'A2:' + lastCol + (body.length + 2),
      });
      /* 逐日点位：全区间（与走势图同源） */
      pct = 55; tick(TT('正在写入逐日点位…')); await nextPaint();
      const pt = [{ h: 30, cells: [{ v: TT('逐日点位（每行一个交易日）'), s: 1 }] },
        { h: 30, cells: [TT('指数名称'), TT('日期'), TT('点位'), TT('日涨跌')].map((v) => ({ v, s: 2 })) }];
      rows.forEach((r) => {
        let prev = null;
        (r.it.series || []).forEach((q) => {
          const v = Number(q[1]);
          const chg = prev ? Math.round((v / prev - 1) * 1e4) / 100 : '';
          pt.push({ cells: [{ v: r.it.name || r.key, s: 4 }, { v: q[0], s: 4 },
            { v: isFinite(v) ? Math.round(v * 1e4) / 1e4 : '', s: 7 },
            chg === '' ? { v: '', s: 4 } : { v: chg, s: 21 }] });
          prev = v;
        });
      });
      sheets.push({ name: TT('逐日点位'), rows: pt, merges: ['A1:D1'], cols: [26, 12, 14, 10], freeze: { x: 0, y: 2, top: 'A3' } });
      /* 走势图：每只一张，标题与名称合并居中 */
      pct = 74; tick(TT('正在绘制指数走势…')); await nextPaint();
      const lines = rows.map((r, i) => ({
        name: r.it.name || r.key, color: PALETTE[i % PALETTE.length],
        pts: (r.it.series || []),
      })).filter((l) => l.pts.length > 1);
      if (lines.length) {
        const rowsT = [{ h: 30, cells: [{ v: TT('指数走势（起点 = 100）'), s: 1 }] }];
        const mergesT = ['A1:H1'];
        const images = [];
        let r = 1;
        for (let i = 0; i < lines.length; i++) {
          rowsT.push({ h: 24, cells: [{ v: lines[i].name, s: 3 }] });
          r += 1; mergesT.push('A' + rowsT.length + ':H' + rowsT.length);
          const png = await svgPng(trendSVG([lines[i]]), 900, 280, []);
          if (png) images.push({ data: png, col: 0, row: r, fitW: 860, fitH: 280, name: lines[i].name });
          for (let k = 0; k < 14; k++) { rowsT.push({ h: 16, cells: [{ v: '', s: 4 }] }); r += 1; }
        }
        sheets.push({ name: TT('净值走势图'), rows: rowsT, merges: mergesT, cols: Array(8).fill(16), images: images });
      }
      pct = 94; tick(TT('正在打包 xlsx…')); await nextPaint();
      const blob = window.MPFXLSX.build({ sheets: sheets });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MPF指数_' + (rows[0].it.name || rows[0].key) + '_' + (idxLatest || '') + '.xlsx';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      progDone(true);
      return true;
    } catch (e) {
      console.error('[index-book]', e);
      progDone(false);
      return false;
    }
  };

  async function exportNow() {
    if (isIdx() && !ST.fundFallback) return exportIdx();
    if (ST.busy) return;
    if (!ST.sel.size) { mpfToast(TT('请至少选择一只基金')); return; }
    /* 2026-11-20（用户要求）：两组字段各自独立——本站默认全选，积金局默认不选。
       积金局勾了就多导一张表；只勾积金局也能单独导出（主表即积金局表）。 */
    if (!ST.fields.size) { mpfToast(TT('请至少选择一个字段')); return; }
    if (!window.MPFXLSX) { mpfToast(TT('导出组件未加载，请刷新页面')); return; }

    const schema = window.mpfExportSchema();
    const COLS = schema.COLS;
    const picked = Array.from(ST.fields).filter((i) => i < COLS.length).sort((a, b) => a - b);
    const rowsSel = rowsAll().filter((x) => ST.sel.has(String(x.id)));
    const go = $('#ecGo');
    const est = $('#ecEst');
    ST.busy = true; ST.stage = 'start'; if (go) go.disabled = true;
    let pct = 6;
    const tick = (t) => { if (est) est.textContent = t; if (t) prog(pct, t); };
    await progShow(TT('正在准备数据…'));

    try {
      const navLatest = latestNav();
      const head = picked.map((i) => ({ v: COLS[i][0], s: 2 }));
      const rows = [{ h: 32, cells: [{ v: TT('基金最新数据') + ' · ' + TQ('净值截至 {d}', { d: navLatest || DS().dataAsOf || '—' }), s: 1 }] },
        { h: 34, cells: head }];
      for (let ri = 0; ri < rowsSel.length; ri++) {
        rows.push({ cells: picked.map((i) => schema.cellOf(rowsSel[ri], ri, COLS[i])) });
        if (ri % 60 === 59) {
          pct = 8 + (ri / Math.max(1, rowsSel.length)) * 10;
          tick(TT('正在整理基金数据…'));
          await nextPaint();
        }
      }
      const lastCol = colLetter(picked.length);
      const hide = picked.map((i, k) => (HIDDEN_IDX.indexOf(i) >= 0 ? k : -1)).filter((k) => k >= 0);
      const namePos = picked.indexOf(1);
      const fx = namePos >= 0 ? namePos + 1 : 0;

      pct = 20; ST.stage = 'cover'; tick(TT('正在生成数据说明…')); await nextPaint();
      const summary = ST.trustee.size === 1 ? Array.from(ST.trustee)[0] : (ST.trustee.size ? TQ('{n} 家受托人', { n: ST.trustee.size }) : TT('全市场'));
      const MPFA_NOTES = [
        TT('本表为积金局「强积金基金平台」月度公布口径：回报已扣费并计入分红再投资，与本站「基金最新数据」的每日自算口径不同，两者不可直接相减。'),
        TT('风险级别、基金规模、历年回报、基金管理费、基金开支比率（FER）均照录积金局公布值，按月更新，通常滞后 1–2 个月。'),
        TT('空白单元格＝积金局未公布该字段（新基金或尚未披露），本站不插值、不以本站自算值替代。'),
      ];
      const LATEST_NOTES = [
        TT('净值来源：各计划受托人／保荐人官网每日公布的单位资产净值；风险级别、基金规模、历年回报、基金开支比率等字段取自积金局「强积金基金平台」（按月更新，通常滞后 1–2 个月）。'),
        TT('自算指标（日涨跌 / 近1周 / 近1个月 / 年初至今 / 近1年 / 近3年 / 近5年年化 / 最大回撤 / 波动率 / 夏普 / 超额收益）由本站按发行人官网净值直接计算，不含分红再投资与费用调整；与积金局公布的同名指标口径不同，不可直接相减。'),
        TT('夏普比率显示 n.a. 表示该基金近 1 年年化波动率低于 0.5%（多为保守／货币市场基金），比值会被极小的分母放大而失真，故不提供。'),
        TT('空白单元格＝该基金当日无官方净值（周末、香港公众假期、非估值日，或该基金尚未推出／已终止），或积金局未公布该字段；本站不插值、不使用前值填充。'),
      ];
      const BOTH_NOTE = TT('本工作簿含两张口径的数据表：「本站最新数据」为本站按发行人官网净值每日自算；「积金局月度数据」为积金局月度公布（已扣费、计入分红再投资）。两表口径不同，同名指标不可直接相减。');
      const cover = window.buildCoverSheet({
        page: TT('数据导出'),
        title: TT('数据说明'),
        meta: [
          [TT('数据口径'), TT('本站每日净值自算')],
          [TT('净值截至'), navLatest || '—'],
          [TT('积金局字段截至'), DS().dataAsOf || '—'],
          [TT('本站同步时间'), new Date(DS().updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })],
          [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
          [TT('导出范围'), TQ('{n} 条成分基金（按单位类别逐条）', { n: rowsSel.length })],
          [TT('筛选条件'), summary + (ST.kw ? ' · ' + TQ('关键词「{v}」', { v: ST.kw }) : '')],
        ],
        notes: LATEST_NOTES,
        columns: picked.map((i) => [COLS[i][0], COLS[i][4]]),
      });

      const sheets = [cover, {
        name: TT('基金数据'), rows: rows, merges: ['A1:' + lastCol + '1'],
        cols: picked.map((i) => COLS[i][3]),
        hiddenCols: hide,
        /* freeze.x = 冻结的列数；top 必须是「冻结区右下角」的下一格（冻结 2 列 → C3） */
        freeze: { x: fx, y: 2, top: colLetter(fx + 1) + '3' },
        autoFilter: 'A2:' + lastCol + rows.length,
      }];

      if (ST.extra.has('hld')) {
        pct = 32; ST.stage = 'hld'; tick(TT('正在生成持仓与分布…')); await nextPaint();
        if (window.buildHoldAllocSheet) {
          const ent = rowsSel.map((x) => ({ id: x.id, name: nameOf(x) }));
          const sh = await window.buildHoldAllocSheet(ent, { chartLimit: 30, imgScale: 0.8 });
          if (sh) sheets.push(Object.assign({ name: TT('持仓与分布') }, sh));
        }
      }

      /* 2026-11-19：逐日表与走势图共用一次抓取（6 路并发），避免重复请求 400+ 次 */
      const needSeries = (ST.extra.has('hist') || ST.extra.has('trend'));
      let seriesMap = null;
      if (needSeries) {
        ST.stage = 'series';
        pct = 42; tick(TQ('正在读取逐日净值 {n}/{t}…', { n: 0, t: rowsSel.length }));
        await nextPaint();
        seriesMap = await loadSeries(rowsSel, (n, t) => { pct = 42 + (n / Math.max(1, t)) * 34; tick(TQ('正在读取逐日净值 {n}/{t}…', { n, t })); });
      }
      const from = rangeStart(ST.histRange);
      const to = rangeEnd();

      if (ST.extra.has('hist')) {
        ST.stage = 'hist';
        const out = [{ h: 30, cells: [{ v: TT('逐日净值（每行一个交易日）'), s: 1 }] },
          { h: 30, cells: [TT('基金名称'), TT('日期'), TT('单位资产净值'), TT('日涨跌')].map((v) => ({ v, s: 2 })) }];
        for (let xi = 0; xi < rowsSel.length; xi++) {
          const x = rowsSel[xi];
          /* 名称含繁转简：必须在行循环外只算一次，否则每行一次转换会把主线程卡死 */
          const nm = nameOf(x);
          const ser = (seriesMap.get(String(x.id)) || []).filter((p) => (!from || p[0] >= from) && (!to || p[0] <= to));
          let prev = null;
          ser.forEach((p) => {
            const d = p[0], v = Number(p[1]);
            const chg = prev ? Math.round((v / prev - 1) * 1e4) / 100 : '';
            out.push({ cells: [
              { v: nm, s: 4 }, { v: d, s: 4 },
              { v: isFinite(v) ? Math.round(v * 1e4) / 1e4 : '', s: 6 },
              chg === '' ? { v: '', s: 4 } : { v: chg, s: 21 },
            ] });
            prev = v;
          });
          if (xi % 12 === 11) { pct = 78 + (xi / Math.max(1, rowsSel.length)) * 6; tick(TQ('正在写入逐日净值 {n}/{t}…', { n: xi + 1, t: rowsSel.length })); await nextPaint(); }
        }
        sheets.push({ name: TT('逐日净值'), rows: out, merges: ['A1:D1'], cols: [30, 12, 14, 10], freeze: { x: 0, y: 2, top: 'A3' } });
      }

      if (ST.extra.has('trend')) {
        ST.stage = 'trend';
        const lines = rowsSel.map((x, i) => ({
          name: nameOf(x), color: PALETTE[i % PALETTE.length],
          pts: (seriesMap.get(String(x.id)) || []).filter((p) => (!from || p[0] >= from) && (!to || p[0] <= to)),
        })).filter((l) => l.pts.length > 1);
        if (!lines.length) {
          mpfToast(TT('所选区间内没有可画图的净值'));
        } else if (ST.trendMode === 'merge' || lines.length === 1) {
          tick(TT('正在绘制走势对比图…'));
          const legendH = Math.ceil(lines.length / 3) * 26 + 8;
          const png = await svgPng(trendSVG(lines), 980, 400, lines.map((l) => ({ name: l.name, color: l.color })));
          if (png) {
            sheets.push({
              name: TT('净值走势图'),
              rows: [{ h: 30, cells: [{ v: TT('净值走势对比（起点 = 100）'), s: 1 }] }, { h: 16, cells: [{ v: '', s: 4 }] }],
              merges: ['A1:H1'],
              cols: Array(8).fill(16),
              images: [{ data: png, col: 0, row: 1, fitW: 860, fitH: 400 + legendH, name: TT('净值走势图') }],
            });
          }
        } else {
          /* 每只一张：同一工作表纵向排列（用户要求「选择单独导出或合并对比」） */
          /* 2026-11-22（用户要求）：表头与每只基金名都要合并单元格并居中 */
          const rowsT = [{ h: 30, cells: [{ v: TT('各基金净值走势（起点 = 100）'), s: 1 }] }];
          const mergesT = ['A1:H1'];
          const images = [];
          let r = 1;
          for (let i = 0; i < lines.length; i++) {
            pct = 84 + (i / Math.max(1, lines.length)) * 8;
            tick(TQ('正在绘制走势图 {n}/{t}…', { n: i + 1, t: lines.length }));
            rowsT.push({ h: 24, cells: [{ v: lines[i].name, s: 3 }] });
            r += 1; mergesT.push('A' + rowsT.length + ':H' + rowsT.length);
            const png = await svgPng(trendSVG([lines[i]]), 900, 280, []);
            if (png) images.push({ data: png, col: 0, row: r, fitW: 860, fitH: 280, name: lines[i].name });
            for (let k = 0; k < 14; k++) { rowsT.push({ h: 16, cells: [{ v: '', s: 4 }] }); r += 1; }
          }
          sheets.push({ name: TT('净值走势图'), rows: rowsT, merges: mergesT, cols: Array(8).fill(16), images: images });
        }
      }

      pct = 92; ST.stage = 'pack'; tick(TT('正在打包 xlsx…')); await nextPaint();
      const blob = window.MPFXLSX.build({ sheets: sheets });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MPF数据导出_' + summary.replace(/[\\/:*?"<>|]/g, '') + '_' + (navLatest || DS().dataAsOf || '') + '.xlsx';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      mpfToast(TQ('已导出 {n} 只基金、{c} 个字段', { n: rowsSel.length, c: picked.length }));
      progDone(true);
      ST.stage = 'done';
      /* 2026-11-22（用户要求）：导出完成后留在导出中心，不再自动关闭 */
    } catch (e) {
      ST.stage = 'error:' + (e && e.message);
      console.error('[export-center]', e);
      progDone(false);
      mpfToast(TT('导出失败，请稍后重试'));
    } finally {
      ST.busy = false; if (go) go.disabled = false; paintCounts();
    }
  }

  /* ---------- 事件（一次性委托，避免重复绑定） ---------- */
  function bind() {
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      const modal = t.closest('#ecModal');
      if (!modal) return;
      const rb = t.closest('[data-range]');
      if (rb) {
        ST.histRange = rb.getAttribute('data-range');
        /* 选「自定义」但还没填日期时，预置「最近 1 年」，避免静默按全部历史导出 */
        if (ST.histRange === 'custom' && (!ST.histFrom || !ST.histTo)) {
          const end = latestNav() || isoDay(new Date());
          const d0 = new Date(end + 'T00:00:00'); d0.setFullYear(d0.getFullYear() - 1);
          ST.histFrom = ST.histFrom || isoDay(d0);
          ST.histTo = ST.histTo || end;
        }
        renderTree(); paintCounts(); persist(); return;
      }
      const tb = t.closest('[data-tmode]');
      if (tb) { ST.trendMode = tb.getAttribute('data-tmode'); renderTree(); paintCounts(); persist(); return; }
      if (t.id === 'ecDateGo') {
        const norm = (v) => (window.mpfNormDate ? window.mpfNormDate(v) : String(v || '').trim());
        const f = $('#ecDateFrom'), e2 = $('#ecDateTo');
        let a = norm(f && f.value), b = norm(e2 && e2.value);
        if (f) f.value = a; if (e2) e2.value = b;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
          ST.dateMsg = TT('请按 YYYY-MM-DD 填写起止日期');
          if (window.mpfToast) mpfToast(ST.dateMsg);
          renderTree(); return;
        }
        if (a > b) { const t2 = a; a = b; b = t2; }
        ST.histFrom = a; ST.histTo = b;
        ST.dateMsg = a + ' ~ ' + b;
        if (window.mpfToast) mpfToast(TQ('已选区间 {d}', { d: ST.dateMsg }));
        renderTree(); paintCounts(); persist(); return;
      }
      /* 2026-11-21（用户反馈：附加工作表偶发失效）：label 包 input 时点文字会转发两次 click，
         change 被触发两次 → checked 取反两次净效果为 0。改为整行点击自行切换，并阻止默认转发。 */
      const xlab = t.closest('.ec-mod-lab');
      if (xlab) {
        const cb = xlab.querySelector('input[data-x]');
        if (cb) {
          ev.preventDefault();
          const k = cb.getAttribute('data-x');
          /* 以集合状态为准：浏览器可能在事件派发时已把 checked 翻过一次，
             用 cb.checked 判断会反向操作（点了就取消）。 */
          if (ST.extra.has(k)) { cb.checked = false; ST.extra.delete(k); ST.panels.delete(k); }
          else { cb.checked = true; ST.extra.add(k); ST.panels.add(k); }
          renderTree(); paintCounts(); persist();
          return;
        }
      }
      if (t.closest('.ec-x') || t.closest('#ecCancel') || t === modal) { close(); return; }
      if (t.closest('#ecGo')) { exportNow(); return; }
      const b = t.closest('.ec-btns button');
      if (b) {
        const a = b.getAttribute('data-a');
        const list = filtered().map((x) => String(x.id));
        if (a === 'all') list.forEach((id) => ST.sel.add(id));
        else if (a === 'none') list.forEach((id) => ST.sel.delete(id));
        else if (a === 'inv') list.forEach((id) => { ST.sel.has(id) ? ST.sel.delete(id) : ST.sel.add(id); });
        renderList(); syncSel(); return;
      }
    });

    document.addEventListener('change', (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.matches('#ecList input[data-id]')) {
        const id = t.getAttribute('data-id');
        if (t.checked) ST.sel.add(id); else ST.sel.delete(id);
        t.closest('.ec-row').classList.toggle('on', t.checked);
        paintCounts(); return;
      }
      if (t.matches('#ecNavOnly')) { ST.navOnly = t.checked; renderList(); syncSel(); persist(); return; }
      if (t.matches('#ecTree input[data-i]')) {
        const i = +t.getAttribute('data-i');
        const SET = curFieldSet();
        if (t.checked) SET.add(i); else SET.delete(i);
        renderTree(); paintCounts(); persist(); return;
      }
      if (t.matches('#ecTree input[data-x]')) {
        const k = t.getAttribute('data-x');
        if (t.checked) { ST.extra.add(k); ST.panels.add(k); } else { ST.extra.delete(k); ST.panels.delete(k); }
        renderTree(); paintCounts(); persist(); return;
      }
      if (t.matches('#ecTree input[data-g]')) {
        const g = curGroups().find((x) => x.k === t.getAttribute('data-g'));
        if (!g) return;
        const SET = curFieldSet();
        g.idx.forEach((i) => { t.checked ? SET.add(i) : SET.delete(i); });
        renderTree(); paintCounts(); persist(); return;
      }
    });

    let kwTimer = 0;
    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t && t.id === 'ecKw') {
        clearTimeout(kwTimer);
        kwTimer = setTimeout(() => { ST.kw = t.value || ''; renderList(); syncSel(); }, 120);
      }
    });

    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ST.open) close(); });
  }

  window.openExportCenter = open;
  window.__ecState = ST;
  window.__ecExport = exportNow;   /* 供无头回归直接调用（等价于点「导出 xlsx」） */
  bind();

  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('ecOpen');
    if (b) b.addEventListener('click', () => open());
  });
})();
