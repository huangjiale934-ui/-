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
    fields: new Set(),      /* 列下标 */
    extra: new Set(),       /* 'hld' | 'hist' | 'trend' */
    histRange: '1y',        /* 逐日净值区间：1y/3y/5y/10y/all/custom */
    histFrom: '', histTo: '', dateMsg: '',
    mode: 'latest',         /* latest=本站最新数据 / mpfa=积金局月度口径 */
    panels: new Set(),      /* 附加表的二级筛选面板，点「筛选」才展开 */
    trendMode: 'merge',     /* 走势图：merge 合并对比 / one 每只单独 */
    kw: '',
    trustee: new Set(),
    cat: new Set(),
    scheme: new Set(),
    navOnly: false,
    busy: false,
    preset: null,           /* 打开时预置的 id 列表（来自当前筛选） */
  };

  /* 2026-11-19（用户建议）：记住上次的基金/字段/口径/区间，重复导出省一步 */
  const LSKEY = 'mpf-ec-v1';
  function persist() {
    try {
      const cur = window.mpfExportSchema ? window.mpfExportSchema().COLS.length : 28;
      const o = {
        mode: ST.mode, extra: Array.from(ST.extra), histRange: ST.histRange, histFrom: ST.histFrom, histTo: ST.histTo,
        trendMode: ST.trendMode, navOnly: ST.navOnly,
        fields: Array.from(ST.fields).filter((i) => i < (ST.mode === 'mpfa' ? mpfaCols().length : cur)),
        trustee: Array.from(ST.trustee), cat: Array.from(ST.cat), scheme: Array.from(ST.scheme),
      };
      localStorage.setItem(LSKEY, JSON.stringify(o));
    } catch (e) {}
  }
  function restore() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(LSKEY) || 'null'); } catch (e) { o = null; }
    if (!o) return false;
    ST.mode = o.mode === 'mpfa' ? 'mpfa' : 'latest';
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
    return rowsAll().filter((x) => {
      if (ST.trustee.size && !ST.trustee.has(x.trustee)) return false;
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
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n, label: label(v) }));
  }

  /* 2026-11-19（用户反馈）：改用与资料库表头同一套多选组件，并做三级联动——
     选受托人后，种类/计划只列该受托人下存在的值；选种类后再收窄计划。 */
  let MS_T = null, MS_C = null, MS_S = null;

  function ensureMS() {
    if (MS_T) return;
    MS_T = window.MPFMulti('#ecMSTrustee', {
      allLabel: TT('全部受托人'),
      onChange: (arr) => { ST.trustee = new Set(arr); rebuildLinked('trustee'); persist(); },
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
    MS_T.setOptions(tr.map((o) => ({ v: o.v, label: o.label, n: o.n })));
    MS_T.setAllLabel(TT('全部受托人'));
    MS_T.setSelected(Array.from(ST.trustee), true);
    rebuildLinked('trustee');
  }

  /* ---------- 列表 ---------- */
  function renderList() {
    const box = $('#ecList');
    if (!box) return;
    const list = filtered();
    const latest = latestNav();
    box.innerHTML = list.map((x) => {
      const id = String(x.id);
      const on = ST.sel.has(id);
      return '<label class="ec-row' + (on ? ' on' : '') + '">' +
        '<input type="checkbox" data-id="' + esc(id) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="ec-nm">' + esc(nameOf(x)) + (x.unit ? ' <i>' + esc(x.unit) + '</i>' : '') + '</span>' +
        '<span class="ec-mt"> · ' + esc(x.navAsOf === latest ? TT('最新') : (x.navAsOf || '—')) + '</span>' +
        '</label>';
    }).join('') || '<div class="ec-empty">' + esc(TT('没有符合条件的基金')) + '</div>';
    paintCounts(list.length);
  }

  function paintCounts(n) {
    const total = rowsAll().length;
    const sel = ST.sel.size;
    const fcnt = ST.fields.size;
    const sc = $('#ecSelCount');
    if (sc) sc.textContent = TQ('已选 {n} / {t}', { n: sel, t: total });
    const fc = $('#ecFieldCount');
    if (fc) fc.textContent = TQ('已选 {n} 项', { n: fcnt });
    const est = $('#ecEst');
    if (est) {
      const ex = ST.mode === 'mpfa' ? 0 : ((ST.extra.has('hld') ? 1 : 0) + (ST.extra.has('hist') ? 1 : 0) + (ST.extra.has('trend') ? 1 : 0));
      const sheets = 2 + ex;
      est.textContent = TQ('预计输出：{s} 个工作表 · {r} 行 × {c} 列', { s: sheets, r: sel + 2, c: fcnt });
    }
    const go = $('#ecGo');
    if (go) go.disabled = ST.busy || !sel || !fcnt;
  }

  /* 2026-11-19（用户反馈）：字段树改为双列排布，右栏不再留大片空白 */
  function renderTree() {
    const box = $('#ecTree');
    if (!box) return;
    const schema = window.mpfExportSchema ? window.mpfExportSchema() : null;
    if (!schema) { box.innerHTML = '<div class="ec-empty">' + esc(TT('导出组件未加载，请刷新页面')) + '</div>'; return; }
    const isMpfa = ST.mode === 'mpfa';
    const COLS = isMpfa ? mpfaCols() : schema.COLS;
    const groups = isMpfa ? [{ k: 'mpfa', n: '积金局月度口径字段', idx: COLS.map((c, i) => i) }] : GROUPS;
    const cells = (g) => g.idx.map((i) => '<label class="ec-f" title="' + esc(COLS[i][4] || '') + '">' +
      '<input type="checkbox" data-i="' + i + '"' + (ST.fields.has(i) ? ' checked' : '') + '>' +
      '<span>' + esc(COLS[i][0]) + '</span></label>').join('');

    /* 2026-11-19（用户反馈）：区间改成站内走势图同款的胶囊按钮；日期改文本框（年月日手输），
       避免日历控件翻年份；确定后给出明确的已选区间提示。 */
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

    box.innerHTML = groups.map((g) => {
      const on = g.idx.filter((i) => ST.fields.has(i)).length;
      return '<div class="ec-g ec-card">' +
        '<label class="ec-g-h"><input type="checkbox" data-g="' + g.k + '"' + (on === g.idx.length ? ' checked' : '') + '>' +
        '<b>' + esc(TT(g.n)) + '</b><span>' + on + '/' + g.idx.length + '</span></label>' +
        '<div class="ec-g-b">' + cells(g) + '</div></div>';
    }).join('') +
      (isMpfa ? '' : '<div class="ec-g ec-card"><div class="ec-g-h"><b>' + esc(TT('附加工作表')) + '</b>' +
      '<span>' + esc(TT('勾选后在右侧展开设置')) + '</span></div>' +
      '<div class="ec-mods">' +
      modRow('hld', '持仓与分布', '前十大 + 资产分布', '') +
      modRow('trend', '净值走势图', '', trendSel) +
      modRow('hist', '逐日净值', '', rangeSel) +
      '</div></div>');
  }

  /* 2026-11-19（用户要求 v2）：三个附加表上下排列；勾选即在右侧展开二级设置，取消勾选即收起 */
  function modRow(key, title, sub, panel) {
    const on = ST.extra.has(key);
    return '<div class="ec-mod' + (on ? ' on' : '') + (panel ? '' : ' no-p') + '">' +
      '<div class="ec-mod-l"><label><input type="checkbox" data-x="' + key + '"' + (on ? ' checked' : '') + '>' +
      '<span class="ec-mod-t">' + esc(TT(title)) + '</span>' +
      '<span class="ec-mod-s">' + esc(TT(sub)) + '</span></label></div>' +
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
      '<div class="ec-mode" role="group">' +
      '<button type="button" class="tr-r on" data-mode="latest">' + esc(TT('本站最新数据')) + ' · ' + esc(latestNav() || '—') + '</button>' +
      '<button type="button" class="tr-r" data-mode="mpfa">' + esc(TT('积金局月度数据')) + ' · ' + esc(TT('截至')) + ' ' + esc(DS().dataAsOf || '—') + '</button>' +
      '</div>' +
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
      '<label class="ec-only ec-only-foot"><input type="checkbox" id="ecNavOnly">' + esc(TT('仅最新净值日')) + '</label></section>' +
      '<section class="ec-right"><div class="ec-cap">② ' + esc(TT('选数据')) + ' <span id="ecFieldCount"></span></div>' +
      '<div class="ec-tree" id="ecTree"></div></section>' +
      '</div>' +
      '<div class="ec-foot"><span id="ecEst"></span>' +
      '<button type="button" class="btn ghost" id="ecCancel">' + esc(TT('取消')) + '</button>' +
      '<button type="button" class="btn" id="ecGo">' + esc(TT('导出 xlsx')) + '</button></div>' +
      '</div>';
    document.body.appendChild(el);
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
    const cols = ST.mode === 'mpfa' ? mpfaCols().length : (schema ? schema.COLS.length : 0);
    if (!had || !ST.fields.size || Array.from(ST.fields).some((i) => i >= cols)) {
      ST.fields = new Set();
      for (let i = 0; i < cols; i++) ST.fields.add(i);   /* 默认全选 = 与旧导出一致 */
    }
    document.querySelectorAll('.ec-mode [data-mode]').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-mode') === ST.mode);
    });
    renderMS(); renderTree(); renderList();
    $('#ecModal').classList.add('show');
  }

  function close() {
    ST.open = false;
    const m = $('#ecModal');
    if (m) m.classList.remove('show');
  }

  /* ---------- 导出 ---------- */
  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  /* 积金局月度口径列（与资料库同源的积金局字段，不含本站自算指标） */
  function mpfaCols() {
    const conv = (v) => (((window.getLang && window.getLang() === 'zh-Hans') && window.t2s) ? window.t2s(String(v)) : String(v));
    const cat = (x) => ((window.splitFundType ? (window.splitFundType(x) || {}).cat : '') || x.type || '');
    return [
      [TT('名次'), (x, i) => i + 1, 'rank', 6, TT('按当前排序的名次')],
      [TT('基金名称'), (x) => (window.fundDisplayName ? window.fundDisplayName(x) : (x.fundBase || x.fund)), 'txtL', 34, TT('成分基金名称')],
      [TT('受托人'), (x) => (window.trusteeDisplay ? window.trusteeDisplay(x.trustee) : x.trustee), 'txtL', 14, TT('受托人／保荐人')],
      [TT('基金种类'), (x) => (window.typeLabel ? window.typeLabel(cat(x)) : cat(x)), 'txtL', 16, TT('积金局基金类别')],
      [TT('风险级别'), (x) => x.risk, 'int', 8, TT('积金局按过往波幅评定的 1–7 级')],
      [TT('近1年年率化'), (x) => x.ann1, 'pct', 11, TT('积金局公布，已扣费并计入分红再投资')],
      [TT('近5年年率化'), (x) => x.ann5, 'pct', 11, TT('积金局公布，已扣费并计入分红再投资')],
      [TT('近10年年率化'), (x) => x.ann10, 'pct', 11, TT('积金局公布，已扣费并计入分红再投资')],
      [TT('推出至今年率化'), (x) => x.annLaunch, 'pct', 12, TT('积金局公布，已扣费并计入分红再投资')],
      [TT('基金规模') + '（' + TT('百万港元') + '）', (x) => x.size, 'num2', 12, TT('积金局月度披露的基金规模')],
      [TT('基金开支比率'), (x) => x.fer, 'num2', 11, TT('FER，含管理费、信托人费、保管费等经常性开支')],
      [TT('基金管理费 %'), (x) => (x.mgmtFee == null ? '' : (window.feeText ? feeText(x.mgmtFee, x.feeMore && x.feeMore.mgmtFee) : x.mgmtFee)), 'txt', 11, TT('积金局披露的基金管理费')],
      [TT('推出日期'), (x) => x.launch || '', 'txt', 11, TT('积金局披露的基金推出日期')],
    ];
  }

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

  async function exportNow() {
    if (ST.busy) return;
    if (!ST.sel.size) { mpfToast(TT('请至少选择一只基金')); return; }
    if (!ST.fields.size) { mpfToast(TT('请至少选择一个字段')); return; }
    /* 2026-11-19（用户要求）：逐日净值不再限制只数；体积由「区间」控制（默认近 1 年） */
    if (!window.MPFXLSX) { mpfToast(TT('导出组件未加载，请刷新页面')); return; }

    const schema = window.mpfExportSchema();
    const isMpfa = ST.mode === 'mpfa';
    const COLS = isMpfa ? mpfaCols() : schema.COLS;
    const picked = Array.from(ST.fields).filter((i) => i < COLS.length).sort((a, b) => a - b);
    const rowsSel = rowsAll().filter((x) => ST.sel.has(String(x.id)));
    const go = $('#ecGo');
    const est = $('#ecEst');
    ST.busy = true; ST.stage = 'start'; if (go) go.disabled = true;
    const tick = (t) => { if (est) est.textContent = t; };

    try {
      const navLatest = latestNav();
      const head = picked.map((i) => ({ v: COLS[i][0], s: 2 }));
      const rows = [{ h: 32, cells: [{ v: TT('基金最新数据') + ' · ' + TQ('净值截至 {d}', { d: navLatest || DS().dataAsOf || '—' }), s: 1 }] },
        { h: 34, cells: head }];
      rowsSel.forEach((x, ri) => {
        rows.push({ cells: picked.map((i) => schema.cellOf(x, ri, COLS[i])) });
      });
      const lastCol = colLetter(picked.length);
      const hide = picked.map((i, k) => (HIDDEN_IDX.indexOf(i) >= 0 ? k : -1)).filter((k) => k >= 0);
      const namePos = picked.indexOf(1);
      const fx = namePos >= 0 ? namePos + 1 : 0;

      ST.stage = 'cover'; tick(TT('正在生成数据说明…'));
      const summary = ST.trustee.size === 1 ? Array.from(ST.trustee)[0] : (ST.trustee.size ? TQ('{n} 家受托人', { n: ST.trustee.size }) : TT('全市场'));
      const cover = window.buildCoverSheet({
        page: isMpfa ? TT('积金局月度数据导出') : TT('数据导出'),
        title: TT('数据说明'),
        meta: [
          [TT('数据口径'), isMpfa ? TT('积金局月度公布（已扣费、计入分红再投资）') : TT('本站每日净值自算')],
          [isMpfa ? TT('资料截至') : TT('净值截至'), isMpfa ? (DS().dataAsOf || '—') : (navLatest || '—')],
          [TT('积金局字段截至'), DS().dataAsOf || '—'],
          [TT('本站同步时间'), new Date(DS().updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })],
          [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
          [TT('导出范围'), TQ('{n} 条成分基金（按单位类别逐条）', { n: rowsSel.length })],
          [TT('筛选条件'), summary + (ST.kw ? ' · ' + TQ('关键词「{v}」', { v: ST.kw }) : '')],
        ],
        notes: isMpfa ? [
          TT('本表为积金局「强积金基金平台」月度公布口径：回报已扣费并计入分红再投资，与本站「基金最新数据」的每日自算口径不同，两者不可直接相减。'),
          TT('风险级别、基金规模、历年回报、基金管理费、基金开支比率（FER）均照录积金局公布值，按月更新，通常滞后 1–2 个月。'),
          TT('空白单元格＝积金局未公布该字段（新基金或尚未披露），本站不插值、不以本站自算值替代。'),
        ] : [
          TT('净值来源：各计划受托人／保荐人官网每日公布的单位资产净值；风险级别、基金规模、历年回报、基金开支比率等字段取自积金局「强积金基金平台」（按月更新，通常滞后 1–2 个月）。'),
          TT('自算指标（日涨跌 / 近1周 / 近1个月 / 年初至今 / 近1年 / 近3年 / 近5年年化 / 最大回撤 / 波动率 / 夏普 / 超额收益）由本站按发行人官网净值直接计算，不含分红再投资与费用调整；与积金局公布的同名指标口径不同，不可直接相减。'),
          TT('夏普比率显示 n.a. 表示该基金近 1 年年化波动率低于 0.5%（多为保守／货币市场基金），比值会被极小的分母放大而失真，故不提供。'),
          TT('空白单元格＝该基金当日无官方净值（周末、香港公众假期、非估值日，或该基金尚未推出／已终止），或积金局未公布该字段；本站不插值、不使用前值填充。'),
        ],
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

      if (!isMpfa && ST.extra.has('hld')) {
        ST.stage = 'hld'; tick(TT('正在生成持仓与分布…'));
        if (window.buildHoldAllocSheet) {
          const ent = rowsSel.map((x) => ({ id: x.id, name: nameOf(x) }));
          const sh = await window.buildHoldAllocSheet(ent, { chartLimit: 30, imgScale: 0.8 });
          if (sh) sheets.push(Object.assign({ name: TT('持仓与分布') }, sh));
        }
      }

      /* 2026-11-19：逐日表与走势图共用一次抓取（6 路并发），避免重复请求 400+ 次 */
      const needSeries = !isMpfa && (ST.extra.has('hist') || ST.extra.has('trend'));
      let seriesMap = null;
      if (needSeries) {
        ST.stage = 'series';
        tick(TQ('正在读取逐日净值 {n}/{t}…', { n: 0, t: rowsSel.length }));
        seriesMap = await loadSeries(rowsSel, (n, t) => tick(TQ('正在读取逐日净值 {n}/{t}…', { n, t })));
      }
      const from = rangeStart(ST.histRange);
      const to = rangeEnd();

      if (!isMpfa && ST.extra.has('hist')) {
        ST.stage = 'hist';
        const out = [{ h: 30, cells: [{ v: TT('逐日净值（每行一个交易日）'), s: 1 }] },
          { h: 30, cells: [TT('基金名称'), TT('日期'), TT('单位资产净值'), TT('日涨跌')].map((v) => ({ v, s: 2 })) }];
        rowsSel.forEach((x) => {
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
        });
        sheets.push({ name: TT('逐日净值'), rows: out, cols: [30, 12, 14, 10], freeze: { x: 0, y: 2, top: 'A3' } });
      }

      if (!isMpfa && ST.extra.has('trend')) {
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
              name: TT('走势对比图'),
              rows: [{ h: 30, cells: [{ v: TT('净值走势对比（起点 = 100）'), s: 1 }] }, { h: 16, cells: [{ v: '', s: 4 }] }],
              cols: Array(16).fill(16),
              images: [{ data: png, col: 0, row: 1, fitW: 900, fitH: 400 + legendH, name: TT('走势对比图') }],
            });
          }
        } else {
          /* 每只一张：同一工作表纵向排列（用户要求「选择单独导出或合并对比」） */
          const rowsT = [{ h: 30, cells: [{ v: TT('各基金净值走势（起点 = 100）'), s: 1 }] }];
          const images = [];
          let r = 1;
          for (let i = 0; i < lines.length; i++) {
            tick(TQ('正在绘制走势图 {n}/{t}…', { n: i + 1, t: lines.length }));
            rowsT.push({ h: 22, cells: [{ v: lines[i].name, s: 3 }] }); r += 1;
            const png = await svgPng(trendSVG([lines[i]]), 900, 280, []);
            if (png) images.push({ data: png, col: 0, row: r, fitW: 860, fitH: 280, name: lines[i].name });
            for (let k = 0; k < 14; k++) { rowsT.push({ h: 16, cells: [{ v: '', s: 4 }] }); r += 1; }
          }
          sheets.push({ name: TT('走势图'), rows: rowsT, cols: Array(14).fill(16), images: images });
        }
      }

      ST.stage = 'pack'; tick(TT('正在打包 xlsx…'));
      const blob = window.MPFXLSX.build({ sheets: sheets });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (isMpfa ? 'MPF积金局口径_' : 'MPF数据导出_') + summary.replace(/[\\/:*?"<>|]/g, '') + '_' + (isMpfa ? (DS().dataAsOf || '') : (navLatest || DS().dataAsOf || '')) + '.xlsx';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      mpfToast(TQ('已导出 {n} 只基金、{c} 个字段', { n: rowsSel.length, c: picked.length }));
      ST.stage = 'done';
      close();
    } catch (e) {
      ST.stage = 'error:' + (e && e.message);
      console.error('[export-center]', e);
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
      /* 区间胶囊 */
      const mb = t.closest('[data-mode]');
      if (mb) {
        ST.mode = mb.getAttribute('data-mode');
        document.querySelectorAll('.ec-mode [data-mode]').forEach((b) => b.classList.toggle('on', b === mb));
        const schema2 = window.mpfExportSchema ? window.mpfExportSchema() : null;
        const n = ST.mode === 'mpfa' ? mpfaCols().length : (schema2 ? schema2.COLS.length : 0);
        ST.fields = new Set(); for (let i = 0; i < n; i++) ST.fields.add(i);
        if (ST.mode === 'mpfa') ST.extra.clear();
        renderTree(); paintCounts(); persist(); return;
      }
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
        if (t.checked) ST.fields.add(i); else ST.fields.delete(i);
        renderTree(); paintCounts(); return;
      }
      if (t.matches('#ecTree input[data-x]')) {
        const k = t.getAttribute('data-x');
        if (t.checked) { ST.extra.add(k); ST.panels.add(k); } else { ST.extra.delete(k); ST.panels.delete(k); }
        renderTree(); paintCounts(); persist(); return;
      }
      if (t.matches('#ecTree input[data-g]')) {
        const g = GROUPS.find((x) => x.k === t.getAttribute('data-g'));
        if (!g) return;
        g.idx.forEach((i) => { t.checked ? ST.fields.add(i) : ST.fields.delete(i); });
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
