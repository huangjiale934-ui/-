/* 板块一：强积金资料库 */
(function () {
  /* 2026-11-02（第二十四轮）：侧边栏发行人列表由本页统一接管（对比页共用同一筛选），
     先置标记，避免 analysis.js 抢先绑一份重复的点击处理。 */
  window.__provHandledByApp = true;
  const S = { key: 'size', dir: 'desc', page: 1, size: 10 };
  /* 2026-11-01（6.0）：三态排序的「取消」必须永远回页面默认（规模降序）。
     不能把 makeSorter 绑定时的 state 当默认——表头每次重绘都会重绑，
     D0 会跟着当前列漂移，第三下点击等于什么也没复位。 */
  const DEF_SORT = { key: 'size', dir: 'desc' };
  const F = { kw: '', type: '', sub: '', trustee: '', risk: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '', navDate: '' };
  let ROWS = [];
  let YEARS = [];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const SORT_LABEL = {
    fund: '基金名称', trustee: '受托人', typeFull: '基金种类',
    size: '基金规模', risk: '风险级别', nav: '单位资产净值',
    ann1: '近1年年率化回报', ann5: '近5年年率化回报', ann10: '近10年年率化回报',
    annLaunch: '推出至今年率化回报', mgmtFee: '基金管理费', launchTs: '推出日期',  /* 渲染时 TT() */
  };

  /* 2026-10-31（用户要求）：排名维度标签行改为工具栏下拉（默认「无」）。
     选中维度 = 该维度默认方向排序（波动/波幅类为升序）；选「无」= 回名次顺序；
     表头点击仍可再改方向（互斥逻辑在 common.makeSorter 内同步复位下拉）。 */
  const DIMS = [
    ['selfY1', '近1年', 'desc'], ['selfD1', '日涨跌', 'desc'], ['selfW1', '近1周', 'desc'],
    ['selfM1', '近1月', 'desc'], ['selfYtd', '年初至今', 'desc'], ['selfY3a', '近3年年化', 'desc'],
    ['selfY5a', '近5年年化', 'desc'], ['selfMdd', '近1年回撤', 'desc'], ['selfMdd5', '近5年回撤', 'desc'],
    ['sharpe1', '夏普比率', 'desc'], ['vol1', '年化波动率', 'asc'], ['vol3', '3年波幅', 'asc'],
    ['posM12', '正收益月份', 'desc'], ['excess1', '超额收益（恒指）', 'desc'],
  ];

  /* ===== 排名维度（2026-11-02 第十八轮，用户要求）：支持多维度叠加排序 =====
     先点的维度优先级最高；按钮显示主维度 +N，面板里用 1/2/3 标注优先级。 */
  const DIM_ALL = [{ k: 'size', n: '基金规模', d: 'desc' }]
    .concat(DIMS.map((d) => ({ k: d[0], n: d[1], d: d[2] })));
  window.__DIMSEL = [{ k: 'size', d: 'desc' }];
  const dimLabel = (k) => { const x = DIM_ALL.find((d) => d.k === k); return x ? TT(x.n) : k; };
  const dimDefDir = (k) => { const x = DIM_ALL.find((d) => d.k === k); return x ? x.d : 'desc'; };
  const dimsActive = () => window.__DIMSEL.length > 1 || (window.__DIMSEL[0] && window.__DIMSEL[0].k !== 'size');

  function syncDimUI() {
    const a = window.__DIMSEL;
    const txt = document.getElementById('dimTxt');
    if (txt) txt.textContent = dimLabel(a[0].k);
    const cnt = document.getElementById('dimCnt');
    if (cnt) { cnt.hidden = a.length < 2; cnt.textContent = '+' + (a.length - 1); }
    const grid = document.getElementById('dimGrid');
    if (!grid) return;
    grid.innerHTML = DIM_ALL.map((d) => {
      const i = a.findIndex((x) => x.k === d.k);
      return '<button type="button" class="dim-opt' + (i >= 0 ? ' on' : '') + '" data-k="' + d.k + '" role="option" aria-selected="' + (i >= 0) + '">' +
        '<span class="dim-on">' + (i >= 0 ? i + 1 : '') + '</span><span class="dim-nm">' + esc(TT(d.n)) + '</span></button>';
    }).join('');
  }

  function applyDims() {
    const a = window.__DIMSEL;
    const first = a[0] || { k: 'size', d: 'desc' };
    S.key = first.k; S.dir = first.d;
    /* 联动放出：非默认列临时显示（不写 colSet，刷新后回到用户自己的列设置） */
    DIM_EXTRA = a.map((x) => x.k).filter((k) => COL_DEFS.some((c) => c.k === k) && COL_DEFAULT.indexOf(k) < 0);
    window.__dimActive = dimsActive();
    S.page = 1;
    const th = document.getElementById('thead');
    if (th) th.querySelectorAll('th.sorted').forEach((n) => {
      n.classList.remove('sorted');
      const ar = n.querySelector('.arrow');
      if (ar) ar.textContent = '↕';
    });
    const ms = document.getElementById('mSortKey');
    if (ms) ms.value = S.key;
    syncDimUI();
    render();
  }

  function bindSelfTabs() {
    const btn = document.getElementById('dimBtn');
    const pop = document.getElementById('dimPop');
    if (!btn || !pop) return;
    if (!window.__dimLangBound) {
      window.__dimLangBound = 1;
      document.addEventListener('mpf:lang', () => { syncDimUI(); });
    }
    syncDimUI();
    const closePop = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!pop.hidden) { closePop(); return; }
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const r = pop.getBoundingClientRect();
      pop.classList.toggle('align-r', r.right > window.innerWidth - 8);
    });
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest && e.target.closest('.dim-opt');
      if (!b) return;
      const k = b.dataset.k;
      const a = window.__DIMSEL;
      const i = a.findIndex((x) => x.k === k);
      if (i >= 0) a.splice(i, 1);
      else {
        /* 首次点非默认维度时替换默认的「基金规模」，让用户点的维度成为第一优先级 */
        if (a.length === 1 && a[0].k === 'size' && k !== 'size') a.length = 0;
        a.push({ k: k, d: dimDefDir(k) });
      }
      if (!a.length) a.push({ k: 'size', d: 'desc' });
      applyDims();
    });
    const clr = document.getElementById('dimClear');
    if (clr) clr.addEventListener('click', (e) => {
      e.stopPropagation();
      window.__DIMSEL = [{ k: 'size', d: 'desc' }];
      applyDims();
    });
    document.addEventListener('click', (e) => {
      if (pop.hidden) return;
      if (e.target.closest && e.target.closest('#dimMulti')) return;
      closePop();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
    /* 兼容旧调用（表头排序 / 移动端） */
    window.__dimApply = (k, dir) => { window.__DIMSEL = [{ k: k, d: dir || dimDefDir(k) }]; applyDims(); };
    window.__dimCancel = () => { window.__DIMSEL = [{ k: 'size', d: 'desc' }]; applyDims(); };
    /* 表头点击排序：维度复位为「单列」，并同步按钮文案（由 common.makeSorter 调用） */
    window.__dimFromHeader = (k, dir) => {
      window.__DIMSEL = [{ k: k, d: dir }];
      S.key = k; S.dir = dir;
      window.__dimActive = dimsActive();
      syncDimUI();
    };
  }

  /* 多维度比较：依次按优先级比较，空值恒排最后 */
  function cmpDim(x, y, dir) {
    const xn = x == null || x === '' || (typeof x === 'number' && isNaN(x));
    const yn = y == null || y === '' || (typeof y === 'number' && isNaN(y));
    if (xn && yn) return 0;
    if (xn) return 1;
    if (yn) return -1;
    const sgn = dir === 'asc' ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sgn;
    return String(x).localeCompare(String(y), 'zh-Hans-CN') * sgn;
  }
  function sortByDims(rows, dims) {
    return rows.slice().sort((a, b) => {
      for (let i = 0; i < dims.length; i++) {
        const r = cmpDim(a[dims[i].k], b[dims[i].k], dims[i].d);
        if (r) return r;
      }
      return 0;
    });
  }

  /* ===== 2026-11-02（第二十二轮）：表格上方的走势图（可视化对比的核心功能搬到本页） =====
     交互：勾选表格「对比」→ 该基金叠加到图中；默认恒生指数打底。
     与对比页的区别：这里不切发行人、不做详细对比表，只做「看一眼走势」。 */
  let DBTREND = null;
  let DBSYNC = false;
  const DBFOLD_KEY = 'mpf-db-trend-fold';
  function dbTrendItems() {
    const ids = CMPX.ids().slice(0, 5);
    return [{ type: 'index', key: 'HSI' }].concat(ids.map((id) => ({ type: 'fund', id: id })));
  }
  function initDbTrend() {
    const box = document.getElementById('dbTrendBox');
    const card = document.getElementById('dbTrendCard');
    if (!box || !card || !window.TREND) return;
    const meta = {};
    (DATA.funds || []).forEach((x) => { meta[x.id] = { trustee: x.trustee, type: x.type, name: x.fundBase || x.fund }; });
    if (!DBTREND) {
      DBTREND = window.TREND.mount(box, dbTrendItems(), {
        /* 2026-11-02（第二十三轮）：标题与工具条由走势图自己渲染（基金走势对比图 + 添加指数/添加基金 + 区间） */
        hideGoto: true,
        /* 2026-11-02（第二十四轮）：收起改由标题右侧箭头负责（走势图模块内实现），状态记在本页 */
        foldKey: DBFOLD_KEY,
        fundMeta: meta,
        onSelChange: function () {
          if (DBSYNC) return;
          /* 从图里增减基金 → 反向同步表格勾选（保持两处一致） */
          const ids = (DBTREND.getItems() || []).filter((x) => x.type === 'fund').map((x) => x.id);
          CMPX.save(ids);
          renderCmpBar();
          render();
        },
      });
    } else if (DBTREND.setItems) {
      DBSYNC = true;
      try { DBTREND.setItems(dbTrendItems()); } finally { DBSYNC = false; }
    }
    /* 2026-11-02（第二十四轮）：收起按钮取消，改由标题右侧箭头控制（走势图模块内置） */
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }
  window.__dbTrendMount = initDbTrend;
  function syncDbTrend() {
    if (!DBTREND || !DBTREND.setItems) return;
    DBSYNC = true;
    try { DBTREND.setItems(dbTrendItems()); } finally { DBSYNC = false; }
  }

  function init() {
    mountHeader('db');
    loadData((d) => {
      YEARS = d.years || [];
      buildFilters();
      buildMobileSort();
      makeSorter($$('#thead th'), S, render, DEF_SORT);
      bindAll();
      initDualScroll('#tscroll', '#topScroll', '#scrollGhost');
      window.__onRefresh = () => { buildFilters(); render(); };
      bindSelfTabs();
      render();
      initDbTrend();
      /* 2026-10-19：本页改为「最新净值口径」列表——补入自算指标（日涨跌/年初至今/近1年/近3年/回撤） */
      if (window.ensurePerf) {
        window.ensurePerf().then((j) => {
          /* 2026-11-01（6.0）：缓存 perf 并走公共装饰（loadData 里也会补挂，
             避免 rank/analysis 随后的一次 loadData 把装饰覆盖掉） */
          window.__PERF_JSON = j;
          window.decorateSelfPerf(DATA.funds, j);
          render();
        }).catch(() => {});
      }
      bindNavDateDist();
      bindTrusteeMenu();
      /* 2026-11-01（6.0）：空闲时预取持仓（约 0.5MB），详情弹窗打开即用，不再等 3 秒 */
      setTimeout(() => { if (window.ensureHoldings) window.ensureHoldings(null).catch(() => {}); }, 2500);
    });
    // 语言切换后重绘整表（表头 data-l 标签、详情按钮、净值悬浮说明等）
    /* 2026-11-01（6.0）：下拉 option 是 JS 生成的，必须在语言切换时一并重建，
       否则繁/英模式下仍停留上一语言的文案（曾出现繁体页下拉全是简体）。 */
    document.addEventListener('mpf:lang', () => {
      if (DATA.count) { buildFilters(); render(); }
      /* 2026-11-02：走势图顶部与统计表的文案是挂载时生成的，语言切换后整体重挂一次 */
      try { DBTREND = null; initDbTrend(); } catch (e) {}
    });
  }

  /* 2026-10-24（领导要求）：列表下方的「净值估值日」卡片 → 点击筛选（供 common.js 的卡片调用） */
  window.mpfSetNavDate = function (v) {
    F.navDate = v;
    window.__MPF_NAVDATE = v;
    S.page = 1;
    document.querySelectorAll('.ndk').forEach((el) => el.classList.toggle('on', el.getAttribute('data-navdate') === F.navDate && !!F.navDate));
    render();
  };

  /** 口径说明里的「净值估值日分布」标签 → 点击筛选（再点取消） */
  function bindNavDateDist() {
    if (document.__navDistBound) return;
    document.__navDistBound = 1;
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('.ndk[data-navdate]') : null;
      if (!b) return;
      const v = b.getAttribute('data-navdate');
      F.navDate = F.navDate === v ? '' : v;
      document.querySelectorAll('.ndk').forEach((el) => el.classList.toggle('on', el.getAttribute('data-navdate') === F.navDate && !!F.navDate));
      S.page = 1;
      render();
    });
  }

  function buildFilters() {
    const f = DATA.funds;
    fill('#fType', uniq(f.map((x) => x.type)), (v) => typeLabel(v));
    fill('#fTrustee', uniq(f.map((x) => x.trustee)));
    fillSub();
  }

  function fillSub() {
    const f = DATA.funds.filter((x) => !F.type || x.type === F.type);
    fill('#fSub', uniq(f.map((x) => x.subtype)), (v) => typeLabel(v));
    $('#fSub').value = F.sub;
  }

  /* 2026-11-01（6.0）：option 文案统一出口——类别走 typeLabel（繁/简/英三态），
     其余数据值仅在简体模式繁转简；繁/英保留原值。 */
  function optText(v, fmt) {
    const raw = fmt ? fmt(v) : v;
    return (document.documentElement.lang === 'zh-Hans' && window.t2s) ? window.t2s(raw) : raw;
  }

  function fill(sel, arr, fmt) {
    const el = $(sel);
    const cur = el.value;
    const first = el.options[0];
    /* 首项「全部…」原来直接取 options[0].text，重建一次后 data-i18n 就丢了 →
       记在 data-all-key 上，每次用 TT() 现翻，切语言不会停留在旧文案。 */
    const key = el.dataset.allKey || (first && first.getAttribute('data-i18n')) || (first ? first.textContent : '');
    el.dataset.allKey = key;
    el.innerHTML = '<option value="">' + TT(key) + '</option>';
    arr.sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
    arr.forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = optText(v, fmt);
      el.appendChild(o);
    });
    if (arr.indexOf(cur) >= 0 || arr.map(String).indexOf(String(cur)) >= 0) el.value = cur;
  }

  function buildMobileSort() {
    const el = $('#mSortKey');
    el.innerHTML = Object.keys(SORT_LABEL).map((k) => '<option value="' + k + '">' + TT(SORT_LABEL[k]) + '</option>').join('');
    el.value = S.key;
    el.addEventListener('change', () => { window.__dimApply(el.value); });
    $('#mSortDir').addEventListener('click', () => {
      S.dir = S.dir === 'asc' ? 'desc' : 'asc';
      if (window.__DIMSEL && window.__DIMSEL[0]) window.__DIMSEL[0].d = S.dir;
      $('#mSortDir').textContent = S.dir === 'asc' ? TT('升序 ↑') : TT('降序 ↓');
      render();
    });
  }

  /* ===== 2026-11-02（第二十三轮）：侧边栏「发行人」二级菜单 = 受托人筛选 =====
     菜单节点由 analysis.js 的 buildSide() 渲染（沿用其计数与分组顺序），
     这里只负责把点击接到本页筛选上，并在筛选变化时回写高亮。 */
  function bindTrusteeMenu() {
    const nav = document.getElementById('anProv');
    if (!nav || nav.__appBound) return;
    nav.__appBound = 1;
    /* 2026-11-02（第二十四轮）：列表由本页统一接管（对比页也共用这一个筛选），
       analysis.js 里的旧绑定看到这个标记就不再重复处理。 */
    window.__provHandledByApp = true;
    nav.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('.an-pitem') : null;
      if (!b) return;
      pickTrustee(b.getAttribute('data-t') || '');
    });
  }
  function pickTrustee(t) {
    const sel = document.getElementById('fTrustee');
    if (sel) sel.value = t;
    F.trustee = t;
    S.page = 1;
    render();
    /* 两个板块共用一个发行人筛选：切到可视化对比时数字要一致 */
    if (typeof window.__anSetTrustee === 'function') { try { window.__anSetTrustee(t); } catch (e) {} }
  }
  function syncTrusteeMenu() {
    const nav = document.getElementById('anProv');
    if (!nav) return;
    Array.prototype.forEach.call(nav.querySelectorAll('.an-pitem'), (b) => {
      b.classList.toggle('on', (b.getAttribute('data-t') || '') === (F.trustee || ''));
    });
  }
  window.syncTrusteeMenu = syncTrusteeMenu;
  window.__getDbTrustee = function () { return F.trustee || ''; };

  /** 导出当前筛选结果（全部行，非仅当前页，CSV；Excel 直接打开） */
  function exportIdx() {
    const head = [TT('基金名称'), TT('单位类别'), TT('基金种类'), TT('强积金计划'), TT('受托人'), TT('风险级别'),
      TT('单位资产净值'), TT('净值估值日'), TT('近1年年率化回报'), TT('近5年年率化回报'), TT('近10年年率化回报'),
      TT('推出至今年率化回报'), TQ('基金规模（{u}）', { u: TT('百万港元') }), TT('基金管理费 %'), TT('最近期基金开支比率'), TT('推出日期')];
    const body = ROWS.map((x) => [
      x.fundBase || x.fund,
      x.unit || '',
      typeLabel(x.type) + (x.subtype ? ' / ' + typeLabel(x.subtype) : ''),
      x.scheme,
      x.trustee,
      x.risk == null ? '' : x.risk,
      x.nav == null ? '' : x.nav,
      x.navAsOf || '',
      x.ann1 == null ? '' : x.ann1,
      x.ann5 == null ? '' : x.ann5,
      x.ann10 == null ? '' : x.ann10,
      x.annLaunch == null ? '' : x.annLaunch,
      x.size == null ? '' : x.size,
      x.mgmtFee == null ? '' : feeText(x.mgmtFee, x.feeMore && x.feeMore.mgmtFee),
      x.fer == null ? '' : x.fer,
      x.launch || '',
    ]);
    csvDownload(csvSourceNote().concat([head], body), 'MPF资料库_' + TT('数据截至') + '_' + (DATA.dataAsOf || '') + '.csv');
  }

  /** 重置全部筛选（含估值日标签，2026-10-14） */
  function resetAll() {
    Object.assign(F, { kw: '', type: '', sub: '', trustee: '', risk: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '', navDate: '' });
    ['#kw', '#fType', '#fTrustee', '#fRetMin', '#fRetMax', '#fDdMin', '#fDdMax', '#fFeeMax'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
    /* 2026-10-31（用户要求）：涨跌幅/回撤/费率第二行筛选已下线 */
    document.querySelectorAll('.ndk').forEach((el) => el.classList.remove('on'));
    fillSub(); S.page = 1; render();
  }
  window.clearAllFilters = resetAll;   // 空态「一键清除」入口（2026-10-14；筛选行/重置按钮 2026-10-31 应用户要求删除）

  /* ---------- 列设置（2026-10-14）：勾选显示列 + 精简模式 ---------- */
  /* 2026-10-19：列序对齐「基金最新数据」表格（名次 + 自算指标） */
  const COL_DEFS = [
    { i: 1, k: 'rank', n: '名次', lock: true },
    { i: 3, k: 'fund', n: '基金名称' },
    { i: 4, k: 'trustee', n: '受托人' },   /* 2026-10-31（用户要求）：列名由「发行人（受托人）」简写 */
    { i: 5, k: 'type', n: '基金种类' },
    { i: 6, k: 'risk', n: '风险级别' },
    { i: 7, k: 'nav', n: '单位资产净值' },
    { i: 8, k: 'selfD1', n: '日涨跌' },
    { i: 9, k: 'selfW1', n: '近1周' },
    { i: 10, k: 'selfM1', n: '近1个月' },
    { i: 11, k: 'selfYtd', n: '年初至今' },
    { i: 12, k: 'selfY1', n: '近1年' },
    { i: 13, k: 'selfY3a', n: '近3年年化' },
    { i: 14, k: 'selfY5a', n: '近5年年化' },
    { i: 15, k: 'selfMdd', n: '近1年最大回撤' },
    { i: 16, k: 'selfMdd5', n: '近5年最大回撤' },
    { i: 17, k: 'vol1', n: '年化波动率（近1年）' },
    { i: 18, k: 'vol3', n: '3年波幅' },
    { i: 19, k: 'sharpe1', n: '夏普比率（近1年）' },
    { i: 20, k: 'excess1', n: '超额收益（对恒指）' },
    { i: 21, k: 'posM12', n: '正收益月份占比' },
    { i: 22, k: 'size', n: '基金规模' },
    { i: 23, k: 'mgmtFee', n: '基金管理费' },
    { i: 24, k: 'launchTs', n: '推出日期' },
    { i: 24, k: 'cmp', n: '对比', lock: true },
    { i: 25, k: 'ops', n: '操作' },
  ];
  /* 2026-10-19：默认显示列（按领导最新指定截图）：
     名次/对比/成分基金/发行人/风险级别/单位资产净值/日涨跌/近1个月/年初至今/近3年年化/
     近1年最大回撤/基金规模/操作 —— 其余列（种类、近1年、波动率、夏普、超额、正收益月份、管理费、推出日期）放列设置 */
  /* 2026-10-22（用户要求）：「近1年」改为默认列，其余列不变 */
  /* 2026-10-31（用户要求）：对比列移到操作（详情）左侧 */
  /* 2026-11-01（6.0，用户要求）：近3年年化移出默认列（仍可在列设置勾选），表格更宽松 */
  /* 2026-11-02（第十七轮，用户要求）：近1年最大回撤也移出默认列（仍在列设置），表格再松一档 */
  const COL_DEFAULT = ['rank', 'fund', 'trustee', 'risk', 'nav',
    'selfD1', 'selfM1', 'selfYtd', 'selfY1', 'size', 'cmp', 'ops'];
  /* 2026-10-27（用户要求）：「精简模式」下线，改为「默认模式」——一键回到用户指定的 14 列 */
  let colSet = null;
  let DIM_EXTRA = [];   /* 2026-11-02：维度联动临时放出的列（可多选，不持久化） */
  try { const raw = localStorage.getItem('mpf-cols-v9'); colSet = raw ? new Set(JSON.parse(raw)) : null; } catch (e) { colSet = null; }
  if (!colSet || !colSet.size) colSet = new Set(COL_DEFAULT);
  /* 2026-11-02（第二十三轮，用户要求）：列设置给 3 个视角预设 + 全部列
     —— 默认（领导指定 12 列）/ 收益视角（回报与超额为主）/ 风险视角（风险与回撤为主） */
  const COL_PRESETS = {
    '默认': COL_DEFAULT,
    '收益视角': ['rank', 'fund', 'trustee', 'nav', 'selfD1', 'selfM1', 'selfYtd', 'selfY1',
      'selfY3a', 'selfY5a', 'excess1', 'size', 'cmp', 'ops'],
    '风险视角': ['rank', 'fund', 'trustee', 'risk', 'nav', 'selfMdd', 'selfMdd5', 'vol1', 'vol3',
      'sharpe1', 'posM12', 'size', 'cmp', 'ops'],
    '全部列': COL_DEFS.map((c) => c.k),
  };
  function applyCols(save) {
    if (save !== false) { try { localStorage.setItem('mpf-cols-v9', JSON.stringify([...colSet])); } catch (e) {} }
    /* 2026-10-26 重做：列显隐改为「不渲染」（visibleOrder 过滤），不再用 CSS 隐藏——
       与维度列插队机制统一，从机制上杜绝表头/表体错位 */
    try { localStorage.removeItem('mpf-cols-v5'); localStorage.removeItem('mpf-cols-v6'); } catch (e) {}
    if (typeof DATA !== 'undefined' && DATA && DATA.funds) render();   /* 列设置变更立即生效 */
    const same = (a) => a.length === colSet.size && a.every((k) => colSet.has(k));
    Object.keys(COL_PRESETS).forEach((name) => {
      const b = document.querySelector('#colPop .cp-b[data-preset="' + name + '"]');
      if (b) b.classList.toggle('on', same(COL_PRESETS[name]));
    });
    const box = document.getElementById('colChecks');
    if (box) box.querySelectorAll('input').forEach((cb) => { cb.checked = colSet.has(cb.value); });
  }
  function initColUI() {
    const host = document.querySelector('#idxExport') && document.querySelector('#idxExport').parentNode;
    if (!host || document.getElementById('colBtn')) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn ghost sm'; btn.id = 'colBtn';
    btn.textContent = TT('列设置');
    btn.setAttribute('data-i18n', '列设置');
    host.insertBefore(btn, document.querySelector('#idxExport'));
    const pop = document.createElement('div');
    pop.id = 'colPop'; pop.hidden = true;
    pop.innerHTML = '<div class="cp-t">' + TT('显示列') + '<span class="cp-x" id="colClose">×</span></div>' +
      '<div class="cp-btns cp-presets">' +
        ['默认', '收益视角', '风险视角', '全部列'].map((n) =>
          '<button type="button" class="cp-b" data-preset="' + n + '" data-i18n="' + n + '">' + TT(n) + '</button>').join('') +
      '</div>' +
      '<div class="cp-list" id="colChecks">' + COL_DEFS.map((c) =>
        '<label' + (c.lock ? ' class="cp-lock"' : '') + '><input type="checkbox" value="' + c.k + '"' + (c.lock ? ' disabled checked' : '') + '>' + TT(c.n) + '</label>').join('') + '</div>';
    /* 2026-11-02：工具栏已并入筛选行，弹层挂在工具栏内部，才能贴着「列设置」按钮弹出 */
    host.appendChild(pop);
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; applyCols(false); });
    document.getElementById('colClose').addEventListener('click', () => { pop.hidden = true; });
    document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('#colPop') && e.target.id !== 'colBtn') pop.hidden = true; });
    pop.querySelectorAll('.cp-b[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const name = b.getAttribute('data-preset');
      colSet = new Set(COL_PRESETS[name] || COL_DEFAULT);
      applyCols();
    }));
    pop.querySelectorAll('#colChecks input').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) colSet.add(cb.value); else colSet.delete(cb.value);
      applyCols();
    }));
    applyCols(false);
  }

  function bindAll() {
    bind();
    initColUI();
  }

  function bind() {
    $('#kw').addEventListener('input', debounce(() => {
      F.kw = $('#kw').value.trim(); S.page = 1; render();
      /* 首次输入时懒加载英文名，到货后自动重绘（简繁英互通） */
      ensureNamesEn().then(() => render());
    }, 200));
    $('#fType').addEventListener('change', () => { F.type = $('#fType').value; F.sub = ''; fillSub(); S.page = 1; render(); });
    $('#fSub').addEventListener('change', () => { F.sub = $('#fSub').value; S.page = 1; render(); });
    $('#fTrustee').addEventListener('change', () => {
      F.trustee = $('#fTrustee').value; S.page = 1; render();
      /* 2026-11-02：下拉与左侧发行人列表保持同步（两个板块共用） */
      if (typeof window.__anSetTrustee === 'function') { try { window.__anSetTrustee(F.trustee); } catch (e) {} }
    });
    /* 2026-10-31（用户要求）：第二行筛选（涨跌幅/回撤/管理费）与「重置条件」按钮已删除；重置走空态「一键清除」 */
    const bReset = $('#btnReset');
    if (bReset) bReset.addEventListener('click', resetAll);
    $('#perPage').addEventListener('change', () => {
      S.size = parseInt($('#perPage').value, 10) || 10;
      S.page = 1;
      render();
    });
    $('#idxExport').addEventListener('click', exportIdx);
  }

  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function filtered() {
    const kw = toSimp(F.kw).toLowerCase();
    return DATA.funds.filter((x) => {
      if (F.type && x.type !== F.type) return false;
      if (F.sub && x.subtype !== F.sub) return false;
      if (F.trustee && x.trustee !== F.trustee) return false;
      if (F.retMin !== '' && !(x[F.retDim] != null && x[F.retDim] >= parseFloat(F.retMin))) return false;
      if (F.retMax !== '' && !(x[F.retDim] != null && x[F.retDim] <= parseFloat(F.retMax))) return false;
      /* 2026-10-19：与参考版式一致——「最大回撤区间」按近5年最差年度（worstYear）筛 */
      if (F.ddMin !== '' && !(x.worstYear != null && x.worstYear >= parseFloat(F.ddMin))) return false;
      if (F.ddMax !== '' && !(x.worstYear != null && x.worstYear <= parseFloat(F.ddMax))) return false;
      if (F.feeMax !== '' && !(x.mgmtFee != null && x.mgmtFee <= parseFloat(F.feeMax))) return false;
      // 净值估值日筛选：'none' = 有净值但官网未静态公布估值日；具体日期 = navAsOf 精确匹配
      if (F.navDate === 'none') {
        if (!(x.navStatus === 'verified' && x.nav != null && !x.navAsOf)) return false;
      } else if (F.navDate) {
        // 与分布标签同口径：仅统计「已核实且有净值」的条目（na 条目的 navAsOf 可能是残留值）
        if (!(x.navStatus === 'verified' && x.nav != null && x.navAsOf === F.navDate)) return false;
      }
      // 关键词：简繁互通 + 英文名（common.js fundMatch）
      if (!fundMatch(x, kw)) return false;
      return true;
    });
  }

  /* 2026-11-02（第二十二轮）：估值日分布要跟随本页筛选（发行人/种类/细类/关键词），
     但必须忽略「估值日」筛选本身——否则点一个日期后其余标签全变 0。 */
  window.__dbScopeFunds = function () {
    const saved = F.navDate;
    F.navDate = '';
    let r = [];
    try { r = filtered(); } finally { F.navDate = saved; }
    return r;
  };

  function render() {
    if (!DATA || !DATA.funds) return;   /* applyCols 可能在数据加载前触发 */
    /* 2026-11-01（6.0）：兜底补挂自算指标——rank/analysis 板块后加载会整体替换 DATA，
       不补挂就会出现「筛选后所有自算列变 —」。幂等、451 条开销可忽略。 */
    if (window.__PERF_JSON) window.decorateSelfPerf(DATA.funds, window.__PERF_JSON);
    ROWS = sortByDims(filtered(), window.__DIMSEL);
    const total = ROWS.length;
    $('#cnt').textContent = total;
    $('#loading').style.display = 'none';
    renderStats(ROWS);

    /* 2026-10-26 重做：可见列顺序单源——表头与表体由同一数组生成，物理上不可能错位 */
    const order = visibleOrder();
    renderThead(order);

    const pages = Math.max(1, Math.ceil(total / S.size));
    if (S.page > pages) S.page = pages;
    const st = (S.page - 1) * S.size;
    const page = ROWS.slice(st, st + S.size);

    $('#tbody').innerHTML = page.length
      ? page.map((x, i) => rowHtml(x, st + i + 1, order)).join('')
      : '<tr><td colspan="' + order.length + '"><div class="empty">' + TT('没有符合条件的基金，请放宽筛选条件') +
        ' <button type="button" class="btn sm" style="margin-left:10px" onclick="window.clearAllFilters && clearAllFilters()">' + TT('一键清除全部筛选') + '</button></div></td></tr>';

    /* 表头由本函数重建 → 三态排序监听需随之重绑（元素是新的，无旧监听残留） */
    makeSorter($$('#thead th'), S, render, DEF_SORT);
    /* 维度高亮：维度激活时给对应列的 th/td 加标记 */
    if (window.__dimActive) {
      window.__DIMSEL.forEach((d) => {
        if (d.k === 'size') return;
        $$('#fundTable [data-c="' + d.k + '"]').forEach((n) => n.classList.add('dim-hl'));
      });
    }
    // 表格内勾选 → 加入/移出对比（与排名页共用 CMPX；页底对比栏随之出现）
    $$('#tbody input[data-cmp]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) { if (!CMPX.add(c.dataset.cmp)) c.checked = false; } else CMPX.remove(c.dataset.cmp);
      renderCmpBar();
      syncDbTrend();   /* 2026-11-02：勾选即叠加到上方走势图 */
    }));

    /* 2026-10-23（核验报告）：筛选后明确写「已筛选」，避免把「全市场 451」误读成计数没刷新 */
    /* 2026-10-31（用户要求）：不再显示（全市场） */
    $('#cntTip').textContent = '';
    renderPager(pages, total);
    /* 2026-11-02：估值日分布跟随筛选（发行人/种类/细类/关键词） */
    if (window.renderNavDistCard) window.renderNavDistCard();
    syncTrusteeMenu();
    if (window.__syncTableScroll) window.__syncTableScroll();
  }

  /* ═══ 2026-10-26 重做：列顺序数组单源 ═══
     此前「移动 thead 的 DOM」方案在 tbody 重渲染后表头/表体错位（数据装反）——已废弃。
     现在 thead 与 tbody 都由同一个可见列顺序数组生成，物理上不可能错位。 */
  /* 2026-11-01（6.0，用户要求）：所有「—」都要有悬浮原因（此前只给 3 年/5 年列加了）。
     短周期用专门文案，长周期沿用 naWhy（成立不足 N 年 / 官方未披露）。 */
  function naTip(x, key) {
    const L = { selfW1: '近1周', selfM1: '近1个月', selfY1: '近1年', selfMdd: '近1年最大回撤', vol1: '年化波动率', sharpe1: '夏普比率', excess1: '超额收益', posM12: '正收益月份占比' };
    if (key === 'selfD1') return TT('该基金净值不足两个交易日，暂无法计算日涨跌（新基金或源站刚更新）。');
    if (key === 'selfW1') return TT('该基金净值历史不足 1 周，暂无法计算近1周回报。');
    if (key === 'selfM1') return TT('该基金净值历史不足 1 个月，暂无法计算近1个月回报。');
    if (key === 'selfYtd') return TT('该基金在年初（1 月 1 日）尚无净值，暂无法计算年初至今回报。');
    return naWhy(x, 1, TT(L[key] || '该指标'));
  }
  function selfCell(x, key, label, fmt, extraCls) {
    const v = x[key];
    const tip = v == null ? naTip(x, key) : '';
    return '<td data-c="' + key + '" data-l="' + TT(label) + '" class="r num ' + (extraCls || '') + '"' +
      (tip ? ' data-tip="' + esc(tip) + '"' : '') + '>' + fmt(v) + '</td>';
  }

  const CELL_FNS = {
    rank: (x, rk) => '<td data-c="rank" class="c" data-l="' + TT('名次') + '">' +
      (rk != null && rk <= 3 ? '<span class="medal g' + rk + '">' + rk + '</span>' : '<span class="rank-cell">' + (rk || '') + '</span>') + '</td>',
    cmp: (x) => '<td data-c="cmp" class="c" data-l="' + TT('对比') + '"><input type="checkbox" data-cmp="' + esc(x.id) + '"' + (CMPX.has(x.id) ? ' checked' : '') + '></td>',
    fund: (x) => {
      /* 2026-11-01（6.0，用户要求）：单位类别不再占一行，改悬浮在「A 类」标签上；标签简称「A 类」 */
      const utip = (x.groupSize > 1)
        ? TQ('该基金共有 {n} 个单位类别；此处显示 {u} 类的净值与回报。', { n: x.groupSize, u: x.unit || '' })
        : TQ('该基金仅 1 个单位类别（{u} 类）。', { u: x.unit || '' });
      return '<td data-c="fund" class="f-main fz" data-l="' + TT('基金名称') + '"><div class="fund-name" style="cursor:pointer" onclick="openDetail(\'' + esc(x.id) + '\')">' + esc(fundDisplayName(x)) +
        (x.unit ? '<span class="tag unit" data-tip="' + esc(utip) + '" aria-label="' + esc(utip) + '">' + TQ('{u} 类', { u: esc(x.unit) }) + '</span>' : '') +
        '</div></td>';
    },
    trustee: (x) => '<td data-c="trustee" data-l="' + TT('受托人') + '"><span class="tag">' + esc(trusteeDisplay(x.trustee)) + '</span></td>',
    type: (x) => '<td data-c="type" data-l="' + TT('基金种类') + '"><span class="tag g">' + esc(typeLabel(x.type)) + '</span>' +
      '<div class="cell-sub">' + esc(typeLabel(x.subtype || x.type)) + '</div></td>',
    risk: (x) => '<td data-c="risk" data-l="' + TT('风险级别') + '" class="c">' + riskTag(x.risk) + '</td>',
    nav: (x) => '<td data-c="nav" data-l="' + TT('单位资产净值') + '" class="r num">' + navCell(x) + '</td>',
    selfD1: (x) => selfCell(x, 'selfD1', '日涨跌', (v) => pct(v), cls(x.selfD1)),
    selfW1: (x) => selfCell(x, 'selfW1', '近1周', (v) => pct(v), cls(x.selfW1)),
    selfM1: (x) => selfCell(x, 'selfM1', '近1个月', (v) => pct(v), cls(x.selfM1)),
    selfYtd: (x) => selfCell(x, 'selfYtd', '年初至今', (v) => pct(v), cls(x.selfYtd)),
    selfY1: (x) => selfCell(x, 'selfY1', '近1年', (v) => pct(v), cls(x.selfY1)),
    selfY3a: (x) => { const t = x.selfY3a == null ? naWhy(x, 3, TT('近3年年化')) : ''; return '<td data-c="selfY3a" data-l="' + TT('近3年年化') + '" class="r num ' + cls(x.selfY3a) + '"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.selfY3a) + '</td>'; },
    selfY5a: (x) => { const t = x.selfY5a == null ? naWhy(x, 5, TT('近5年年化')) : ''; return '<td data-c="selfY5a" data-l="' + TT('近5年年化') + '" class="r num ' + cls(x.selfY5a) + '"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.selfY5a) + '</td>'; },
    selfMdd: (x) => selfCell(x, 'selfMdd', '近1年最大回撤', (v) => pct(v), 'down'),
    selfMdd5: (x) => { const t = x.selfMdd5 == null ? naWhy(x, 5, TT('近5年最大回撤')) : ''; return '<td data-c="selfMdd5" data-l="' + TT('近5年最大回撤') + '" class="r num down"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.selfMdd5) + '</td>'; },
    vol1: (x) => selfCell(x, 'vol1', '年化波动率（近1年）', (v) => pct(v)),
    vol3: (x) => { const t = x.vol3 == null ? naWhy(x, 3, TT('3年波幅')) : ''; return '<td data-c="vol3" data-l="' + TT('3年波幅') + '" class="r num"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.vol3) + '</td>'; },
    sharpe1: (x) => selfCell(x, 'sharpe1', '夏普比率（近1年）', (v) => (v == null ? '—' : v.toFixed(2))),
    excess1: (x) => selfCell(x, 'excess1', '超额收益（对恒指·近1年）', (v) => pct(v), cls(x.excess1)),
    posM12: (x) => selfCell(x, 'posM12', '正收益月份占比', (v) => (v == null ? '—' : v.toFixed(0) + '%')),
    size: (x) => {
      /* 2026-10-30（5.0）：规模与风险级别统一——积金局未公布时显示 n.a. 并给悬浮说明 */
      const tip = x.size == null ? TT('积金局未公布该基金规模（新基金或官方未披露），故显示 n.a.，并非本站缺少数据。') : '';
      return '<td data-c="size" data-l="' + TQ('基金规模（{u}）', { u: TT('百万港元') }) + '" class="r num"' + (tip ? ' data-tip="' + esc(tip) + '"' : '') + '>' +
        (x.size == null ? '<span class="risk-na">n.a.</span>' : nf(x.size, 2)) + '</td>';
    },
    mgmtFee: (x) => (function () {
      const more = x.feeMore && x.feeMore.mgmtFee;
      const tip = more ? feeTip(TT('基金管理费'), more) : '';
      return '<td data-c="mgmtFee" data-l="' + TT('基金管理费 %') + '" class="r num"' + (tip ? ' data-tip="' + esc(tip) + '"' : '') + '>' + feeText(x.mgmtFee, more) + '</td>';
    })(),
    launchTs: (x) => '<td data-c="launchTs" data-l="' + TT('推出日期') + '" class="num">' + esc(x.launch || '—') + '</td>',
    ops: (x) => '<td data-c="ops" data-l="' + TT('操作') + '" class="c"><button class="btn-detail" onclick="openDetail(\'' + esc(x.id) + '\')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
      TT('详情') + '</button></td>',
  };
  /* 表头模板（与 CELL_FNS 同 key；搬自原静态 thead） */
  const TH_HTML = {
    rank: '<th data-c="rank" data-i18n-parts class="c" style="width:56px">名次</th>',
    cmp: '<th data-c="cmp" data-i18n-parts class="c" style="width:52px">对比</th>',
    fund: '<th data-c="fund" data-i18n-parts data-k="fund" data-defdir="asc" class="sortable fz">基金名称 <span class="arrow">↕</span></th>',
    trustee: '<th data-c="trustee" data-i18n-parts data-k="trustee" data-defdir="asc" class="sortable">受托人 <span class="arrow">↕</span></th>',
    type: '<th data-c="type" data-i18n-parts data-k="typeFull" data-defdir="asc" class="sortable">基金种类 <span class="arrow">↕</span></th>',
    risk: '<th data-c="risk" data-i18n-parts data-k="risk" data-defdir="asc" class="sortable c">风险<br>级别 <span class="arrow">↕</span></th>',
    nav: '<th data-c="nav" data-i18n-parts data-k="nav" data-defdir="desc" class="sortable r" title="取自各受托人官网公布的单位资产净值；悬浮每个数值可看来源与估值日">单位资产净值 <span class="arrow">↕</span></th>',
    selfD1: '<th data-c="selfD1" data-i18n-parts data-k="selfD1" data-defdir="desc" class="sortable r">日涨跌 <span class="arrow">↕</span></th>',
    selfW1: '<th data-c="selfW1" data-i18n-parts data-k="selfW1" data-defdir="desc" class="sortable r">近1周 <span class="arrow">↕</span></th>',
    selfM1: '<th data-c="selfM1" data-i18n-parts data-k="selfM1" data-defdir="desc" class="sortable r">近1个月 <span class="arrow">↕</span></th>',
    selfYtd: '<th data-c="selfYtd" data-i18n-parts data-k="selfYtd" data-defdir="desc" class="sortable r">年初至今 <span class="arrow">↕</span></th>',
    selfY1: '<th data-c="selfY1" data-i18n-parts data-k="selfY1" data-defdir="desc" class="sortable r">近1年 <span class="arrow">↕</span></th>',
    selfY3a: '<th data-c="selfY3a" data-i18n-parts data-k="selfY3a" data-defdir="desc" class="sortable r">近3年<br><small>年化</small> <span class="arrow">↕</span></th>',
    selfY5a: '<th data-c="selfY5a" data-i18n-parts data-k="selfY5a" data-defdir="desc" class="sortable r">近5年<br><small>年化</small> <span class="arrow">↕</span></th>',
    selfMdd: '<th data-c="selfMdd" data-i18n-parts data-k="selfMdd" data-defdir="asc" class="sortable r">近1年<br><small>最大回撤</small> <span class="arrow">↕</span></th>',
    selfMdd5: '<th data-c="selfMdd5" data-i18n-parts data-k="selfMdd5" data-defdir="asc" class="sortable r">近5年<br><small>最大回撤</small> <span class="arrow">↕</span></th>',
    vol1: '<th data-c="vol1" data-i18n-parts data-k="vol1" data-defdir="asc" class="sortable r">年化波动率<br><small>近1年</small> <span class="arrow">↕</span></th>',
    vol3: '<th data-c="vol3" data-i18n-parts data-k="vol3" data-defdir="asc" class="sortable r">3年波幅 <span class="arrow">↕</span></th>',
    sharpe1: '<th data-c="sharpe1" data-i18n-parts data-k="sharpe1" data-defdir="desc" class="sortable r">夏普比率<br><small>近1年</small> <span class="arrow">↕</span></th>',
    excess1: '<th data-c="excess1" data-i18n-parts data-k="excess1" data-defdir="desc" class="sortable r">超额收益<br><small>对恒指·近1年</small> <span class="arrow">↕</span></th>',
    posM12: '<th data-c="posM12" data-i18n-parts data-k="posM12" data-defdir="desc" class="sortable r">正收益<br><small>月份占比</small> <span class="arrow">↕</span></th>',
    size: '<th data-c="size" data-i18n-parts data-k="size" data-defdir="desc" class="sortable r">基金规模<br><small>百万港元</small> <span class="arrow">↕</span></th>',
    mgmtFee: '<th data-c="mgmtFee" data-i18n-parts data-i18n-title="部分基金的费用在官网以区间或「最高」形式公布，表内按原文显示；排序按区间下限" data-k="mgmtFee" data-defdir="asc" class="sortable r">基金管理费<br><small>% p.a.</small> <span class="arrow">↕</span></th>',
    launchTs: '<th data-c="launchTs" data-i18n-parts data-k="launchTs" data-defdir="desc" class="sortable">推出日期 <span class="arrow">↕</span></th>',
    ops: '<th data-c="ops" data-i18n-parts class="c">操作</th>',
  };
  /* 可见列顺序 = COL_DEFS 顺序 ∩ colSet；维度激活时把维度列插到「风险」列右侧 */
  function visibleOrder() {
    let order = COL_DEFS.map((c) => c.k).filter((k) => {
      const d = COL_DEFS.find((c) => c.k === k);
      return d.lock || colSet.has(k) || DIM_EXTRA.indexOf(k) >= 0;
    });
    /* 2026-11-02：参与排名的列若本来不在可见列里，才临时插到「风险级别」右侧；
       已经是默认列的（近1年/日涨跌等）保持原位，避免一选维度整张表列顺序乱跳 */
    const dk = window.__dimActive ? window.__DIMSEL.map((x) => x.k).filter((k) => k !== 'size' && k !== 'risk') : [];
    const missing = dk.filter((k) => order.indexOf(k) < 0 && COL_DEFS.some((c) => c.k === k));
    if (missing.length) {
      const ri = order.indexOf('risk');
      order.splice.apply(order, [ri >= 0 ? ri + 1 : 1, 0].concat(missing));
    }
    return order;
  }
  function renderThead(order) {
    const th = document.getElementById('thead');
    if (!th) return;
    th.innerHTML = order.map((k) => TH_HTML[k] || '').join('');
    /* 2026-11-01（6.0）：表头是重建的，data-i18n 文案需要立即翻译（否则英文模式仍是中文表头） */
    if (typeof window.applyI18n === 'function') window.applyI18n(th);
  }

  function rowHtml(x, rk, order) {
    return '<tr data-id="' + esc(x.id) + '">' + order.map((k) => (CELL_FNS[k] || function () { return ''; })(x, rk)).join('') + '</tr>';
  }


  function renderStats(rows) {
    const f = DATA.funds;
    const avg = (k) => {
      const a = rows.map((x) => x[k]).filter((v) => v != null);
      return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    };
    const pos = rows.filter((x) => x.ann1 != null && x.ann1 > 0).length;
    const tot = rows.filter((x) => x.ann1 != null).length;
    const big = rows.reduce((m, x) => (x.size != null && x.size > (m ? m.size : 0) ? x : m), null);
    $('#stats').innerHTML = [
      card(TT('基金数量'), rows.length, TT('条'), TQ('全市场共 {n} 条', { n: f.length })),
      card(TT('受托人数量'), uniq(rows.map((x) => x.trustee)).length, TT('家'), TT('受托人／保荐人')),
      card(TT('基金种类'), uniq(rows.map((x) => x.type)).length, TT('类'), TQ('{n} 个细类', { n: uniq(rows.map((x) => x.subtype)).length })),
      card(TT('近1年平均回报'), pct(avg('ann1')), '', TT('已剔除无数据基金')),
      card(TT('近1年上涨占比'), tot ? Math.round((pos / tot) * 100) : 0, '%', TQ('{n} / {m} 条录得正回报', { n: pos, m: tot })),
      card(TT('规模最大基金'), big ? big.fund : '—', '', big ? nf(big.size, 0) + ' ' + TT('百万港元') + ' · ' + big.trustee : ''),
    ].join('');
  }

  function card(k, v, unit, s) {
    /* 2026-10-31：v（基金名等数据值）也走 esc——简体模式下繁转简 */
    return '<div class="stat"><div class="k">' + k + '</div><div class="v num">' + esc(v) + '<small>' + unit + '</small></div><div class="s">' + esc(s) + '</div></div>';
  }

  /* 2026-10-31（用户要求）：「筛选条件：无」chips 行与「重置条件」按钮删除——
     renderChips 连同容器一并下线；激活中的筛选仍由各下拉与搜索框本身呈现。 */

  function dimName(k) {
    return TT({ ann1: '近1年回报', ann5: '近5年年化', ann10: '近10年年化', annLaunch: '推出至今年化', cum1: '近1年累积' }[k] || k);
  }

  function renderPager(pages, total) {
    if (pages <= 1) { $('#pager').innerHTML = total ? '<span class="info">' + TQ('共 {n} 条', { n: total }) + '</span>' : ''; return; }
    let h = '<button data-p="' + (S.page - 1) + '"' + (S.page === 1 ? ' disabled' : '') + '>' + TT('上一页') + '</button>';
    const win = 2;
    const list = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - S.page) <= win) list.push(i);
      else if (list[list.length - 1] !== '…') list.push('…');
    }
    list.forEach((i) => {
      if (i === '…') h += '<button disabled>…</button>';
      else h += '<button data-p="' + i + '" class="' + (i === S.page ? 'on' : '') + '">' + i + '</button>';
    });
    h += '<button data-p="' + (S.page + 1) + '"' + (S.page === pages ? ' disabled' : '') + '>' + TT('下一页') + '</button>';
    h += '<span class="info">' + TQ('第 {p} / {n} 页 · 共 {t} 条', { p: S.page, n: pages, t: total }) + '</span>';
    $('#pager').innerHTML = h;
    $$('#pager button[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = parseInt(b.dataset.p, 10);
      if (p >= 1 && p <= pages) { S.page = p; render(); window.scrollTo({ top: 220, behavior: 'smooth' }); }
    }));
  }

  init();
})();
