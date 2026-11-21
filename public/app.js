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
  /* 2026-11-19（8.0）：种类/细类/受托人改为多选（数组），支持同时筛多个 */
  const F = { kw: '', type: [], sub: [], trustee: [], risk: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '', navDate: '' };
  let ROWS = [];
  let YEARS = [];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const SORT_LABEL = {
    fund: '基金名称', trustee: '受托人', typeFull: '基金种类',
    size: '基金规模', risk: '风险级别', nav: '单位资产净值',
    ann1: '近1年年率化回报', ann5: '近5年年率化回报', ann10: '近10年年率化回报',
    annLaunch: '推出至今年率化回报', mgmtFee: '基金管理费', fer: '基金开支比率', launchTs: '推出日期',  /* 渲染时 TT() */
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
    /* 2026-11-14：用户改用「排名维度」下拉时，清掉表头的「已取消」标记 */
    S.cancelled = false;
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
      /* 2026-11-04：注册到刷新钩子表（多模块共存），不再独占 __onRefresh */
      window.addRefreshHook(() => { buildFilters(); buildMobileSort(); syncSortDir(); render(); });
      bindSelfTabs();
      applyUrlFilters();
      render();
      syncUrlFilters();
      /* 2026-11-03（第二十九轮，用户反馈）：首页「查看完整榜单」原指向积金局榜单（口径不同、数字对不上），
         改为跳到资料库并按同一自算维度排序 —— 这里解析 ?dim=selfY1 / selfY5a / size 等深链。 */
      /* 2026-11-03（第三十二轮）：数据说明里的计划名深链 ?kw=<计划名> */
      (function applyUrlKw() {
        try {
          /* 2026-11-17（用户要求）：按 F5 刷新时要回到「全部基金」，不保留上次的筛选。
             共享链接（navigate 进来）仍保留参数；自动同步触发的 reload 也不清（见 mpf-auto-reload）。 */
          try {
            const navT = (performance.getEntriesByType('navigation')[0] || {}).type;
            const auto = sessionStorage.getItem('mpf-auto-reload');
            if (navT === 'reload' && !auto && location.search) {
              history.replaceState(null, '', location.pathname + location.hash);
            }
            if (auto) sessionStorage.removeItem('mpf-auto-reload');
          } catch (e) {}
          const q = (new URLSearchParams(location.search)).get('kw') || '';
          if (!q) return;
          window.mpfSetKw(q);
          /* 2026-11-16（用户反馈：刷新后仍停在搜索筛选）：深链只在打开时生效一次，
             随后把 kw 从地址栏移除。刷新即回到全量；链接本身仍可正常分享（对方打开时带 kw）。
             保留 sharecode 等其它参数与 hash。 */
          try {
            const u = new URL(location.href);
            u.searchParams.delete('kw');
            history.replaceState(history.state, '', u.pathname + u.search + u.hash);
          } catch (e) {}
        } catch (e) {}
      })();
      (function applyUrlDim() {
        try {
          const dk = (new URLSearchParams(location.search)).get('dim') || '';
          if (!dk) return;
          const hit = DIM_ALL.find((d) => d.k === dk);
          if (!hit) return;
          window.__DIMSEL = [{ k: dk, d: hit.d || 'desc' }];
          applyDims();
        } catch (e) {}
      })();
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
      /* 2026-11-17（用户要求懒加载）：原来加载后 2.5 秒就预取全部持仓（76KB gzip / 546KB 原文），
         首屏白等。改为「用户真的要看持仓时再取」——详情弹窗自己会按 id 拉取（更小），
         列表页不再预取。 */
      document.addEventListener('mouseover', function prefetchHld(e) {
        if (!e.target || !e.target.closest) return;
        if (!e.target.closest('.btn-detail, .m-detail, [data-detail]')) return;
        document.removeEventListener('mouseover', prefetchHld);
        if (window.ensureHoldings) window.ensureHoldings(null).catch(() => {});
      }, { passive: true });
    });
    // 语言切换后重绘整表（表头 data-l 标签、详情按钮、净值悬浮说明等）
    /* 2026-11-01（6.0）：下拉 option 是 JS 生成的，必须在语言切换时一并重建，
       否则繁/英模式下仍停留上一语言的文案（曾出现繁体页下拉全是简体）。 */
    document.addEventListener('mpf:lang', () => {
      if (DATA.count) { buildFilters(); buildMobileSort(); render(); }
      /* 2026-11-02：走势图顶部与统计表的文案是挂载时生成的，语言切换后整体重挂一次 */
      try { DBTREND = null; initDbTrend(); } catch (e) {}
    });
  }

  /* 2026-11-03（第三十二轮）：外部（数据说明里的计划名）点进来 → 直接按计划名筛选 */
  window.mpfSetKw = function (v) {
    F.kw = String(v || '');
    S.page = 1;
    const i = document.getElementById('kw');
    if (i) i.value = F.kw;
    render();
  };

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

  /* 2026-11-19（用户建议）：筛选条件写入 URL，链接可直接分享「已筛好」的结果。
     刷新仍按既有策略清空（见 applyUrlKw 的 reload 分支），不会粘住。 */
  function syncUrlFilters() {
    try {
      const q = new URLSearchParams(location.search);
      const put = (k, arr) => { if (arr && arr.length) q.set(k, arr.join(',')); else q.delete(k); };
      put('tr', F.trustee); put('ty', F.type); put('sb', F.sub);
      if (F.kw) q.set('kw', F.kw); else q.delete('kw');
      if (F.navDate) q.set('nav', F.navDate); else q.delete('nav');
      const s2 = q.toString();
      history.replaceState(history.state, '', location.pathname + (s2 ? '?' + s2 : '') + location.hash);
    } catch (e) {}
  }

  function applyUrlFilters() {
    try {
      const q = new URLSearchParams(location.search);
      const arr = (k) => (q.get(k) || '').split(',').map((v) => v.trim()).filter(Boolean);
      const ty = arr('ty'), tr = arr('tr'), sb = arr('sb');
      if (!ty.length && !tr.length && !sb.length && !q.get('nav')) return false;
      F.type = ty; F.trustee = tr;
      if (q.get('nav')) F.navDate = q.get('nav');
      if (MF_TY) {
        MF_TY.setSelected(F.type, true);
        MF_T.setSelected(F.trustee, true);
        fillSub();
        MF_S.setSelected(F.sub, true);
      }
      S.page = 1;
      return true;
    } catch (e) { return false; }
  }

  /* 2026-11-19：三个筛选统一换成共用多选组件（与导出中心同一套） */
  let MF_TY = null, MF_S = null, MF_T = null;
  function ensureMF() {
    if (MF_TY) return;
    if (typeof window.MPFMulti !== 'function') return;   /* 脚本尚未就绪时不抛错 */
    MF_TY = window.MPFMulti('#fType', {
      allLabel: TT('全部种类'),
      onChange: (arr) => { F.type = arr; F.sub = []; S.page = 1; fillSub(); render(); syncUrlFilters(); },
    });
    MF_S = window.MPFMulti('#fSub', {
      allLabel: TT('全部细类'),
      onChange: (arr) => { F.sub = arr; S.page = 1; render(); syncUrlFilters(); },
    });
    MF_T = window.MPFMulti('#fTrustee', {
      allLabel: TT('全部受托人'),
      onChange: (arr) => {
        F.trustee = arr; S.page = 1; render(); syncUrlFilters();
        if (typeof window.__anSetTrustee === 'function') { try { window.__anSetTrustee(arr[0] || ''); } catch (e) {} }
      },
    });
  }

  function buildFilters() {
    ensureMF();
    const f = DATA.funds;
    MF_TY.setOptions(uniq(f.map((x) => x.type)).map((v) => ({ v, label: typeLabel(v) })));
    const tlist = window.mpfSortTrustees ? window.mpfSortTrustees(uniq(f.map((x) => x.trustee))) : uniq(f.map((x) => x.trustee));
    MF_T.setOptions(tlist.map((v) => ({
      v, label: (window.trusteeDisplay ? window.trusteeDisplay(v) : v),
      n: f.filter((y) => y.trustee === v).length,
    })));
    MF_TY.setAllLabel(TT('全部种类'));
    MF_T.setAllLabel(TT('全部受托人'));
    fillSub();
  }

  function fillSub() {
    ensureMF();
    const f = DATA.funds.filter((x) => !F.type.length || F.type.indexOf(x.type) >= 0);
    const vals = uniq(f.map((x) => x.subtype));
    MF_S.setOptions(vals.map((v) => ({ v, label: typeLabel(v) })));
    MF_S.setAllLabel(TT('全部细类'));
    const valid = new Set(vals);
    F.sub = F.sub.filter((v) => valid.has(v));
    MF_S.setSelected(F.sub, true);
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

  /* 2026-11-04（第三十六轮）：下拉每次重建（语言切换也要重建，否则选项停在上一语言），
     方向按钮只读当前状态重写文案 —— 监听只绑一次，反复调用不会叠加。 */
  function syncSortDir() {
    const b = $('#mSortDir');
    if (b) b.textContent = S.dir === 'asc' ? TT('升序 ↑') : TT('降序 ↓');
  }
  function buildMobileSort() {
    const el = $('#mSortKey');
    if (!el) return;
    const cur = el.value || S.key;
    el.innerHTML = Object.keys(SORT_LABEL).map((k) => '<option value="' + k + '">' + TT(SORT_LABEL[k]) + '</option>').join('');
    el.value = cur;
    syncSortDir();
    if (el.__sortBound) return;
    el.__sortBound = 1;
    el.addEventListener('change', () => { window.__dimApply(el.value); });
    $('#mSortDir').addEventListener('click', () => {
      S.dir = S.dir === 'asc' ? 'desc' : 'asc';
      if (window.__DIMSEL && window.__DIMSEL[0]) window.__DIMSEL[0].d = S.dir;
      syncSortDir();
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
    F.trustee = t ? [t] : [];
    if (MF_T) MF_T.setSelected(F.trustee, true);
    S.page = 1;
    render();
    /* 两个板块共用一个发行人筛选：切到可视化对比时数字要一致 */
    if (typeof window.__anSetTrustee === 'function') { try { window.__anSetTrustee(t); } catch (e) {} }
  }
  function syncTrusteeMenu() {
    const nav = document.getElementById('anProv');
    if (!nav) return;
    Array.prototype.forEach.call(nav.querySelectorAll('.an-pitem'), (b) => {
      b.classList.toggle('on', F.trustee.indexOf(b.getAttribute('data-t') || '') >= 0);
    });
  }
  window.syncTrusteeMenu = syncTrusteeMenu;
  window.__getDbTrustee = function () { return F.trustee.length === 1 ? F.trustee[0] : ''; };

  /** 导出当前筛选结果（全部行，非仅当前页）→ xlsx 工作簿
      2026-11-04（第三十六轮，用户要求）：
      ① 最左侧加「名次」列；② 写明排名维度与筛选条件；③ 冻结首列（含表头）；
      ④ 说明文字独立成「数据说明」工作表（含公司名、网址、LOGO），第二个表才是数据。 */
  /* 2026-11-19（8.0）：列定义与取值器抽成可复用 schema —— 资料库「导出」与批量导出中心共用，
     避免两处维护同一套列与百分比口径（百分比一律存百分数 + 0.00"%"）。 */
  function buildExportSchema() {
    const dimTxt = (window.__DIMSEL || []).map((d, i) => (i ? '+ ' : '') + dimLabel(d.k) + (d.d === 'asc' ? ' ↑' : ' ↓')).join(' ');
    const dirTxt = (d) => (d === 'asc' ? TT('由小到大') : TT('由大到小'));
    const filterBits = [];
    if (F.kw) filterBits.push(TQ('关键词「{v}」', { v: F.kw }));
    if (F.type.length) filterBits.push(TQ('种类：{v}', { v: F.type.map((v) => typeLabel(v)).join('、') }));
    if (F.sub.length) filterBits.push(TQ('细类：{v}', { v: F.sub.map((v) => typeLabel(v)).join('、') }));
    if (F.trustee.length) filterBits.push(TQ('受托人：{v}', { v: F.trustee.map((v) => (window.trusteeDisplay ? window.trusteeDisplay(v) : v)).join('、') }));
    if (F.navDate) filterBits.push(TQ('净值估值日：{v}', { v: F.navDate }));

    const pct = (v) => (v == null || !isFinite(v) ? { v: '', s: 4 } : { v: Math.round(v * 1e4) / 1e6, s: 5 });
    const num = (v, s0) => (v == null || !isFinite(v) ? { v: '', s: 4 } : { v: Math.round(v * 1e4) / 1e4, s: s0 || 7 });
    /* 2026-11-04：导出同样要跟随语言——简体模式下基金名/计划名要繁转简，
       否则 Excel 里全是繁体（页面是简体的）。 */
    const conv = (v) => (((window.getLang && window.getLang() === 'zh-Hans') && window.t2s) ? window.t2s(String(v)) : String(v));
    const txt = (v, s0) => ({ v: v == null || v === '' ? '' : conv(v), s: s0 || 4 });
    /* 表格标题用「净值最新日」而不是积金局月报日，避免被误读成净值滞后一个月 */
    let navLatest = '';
    (DATA.funds || []).forEach((f) => { if (f.navAsOf && f.navAsOf > navLatest) navLatest = f.navAsOf; });

    /* [表头, 取值, 类型, 列宽, 列说明] */
    const COLS = [
      [TT('名次'), (x, i) => i + 1, 'rank', 6, TT('按当前排名维度排出的名次（1 = 排在最前）')],
      [TT('基金名称'), (x) => (window.fundDisplayName ? window.fundDisplayName(x) : (x.fundBase || x.fund)), 'txtL', 34, TT('成分基金名称；单位类别在下一列单列')],
      [TT('单位类别'), (x) => x.unit || '', 'txt', 12, TT('同一基金的不同单位类别（A / T / B 等），净值与回报各自独立')],
      /* 2026-11-17（用户要求）：积金局是两级分类，拆成两列，不再用「/」挤在一格里 */
      [TT('基金种类'), (x) => typeLabel((window.splitFundType(x) || {}).cat || x.type), 'txtL', 16, TT('积金局基金类别（第一级）')],
      [TT('基金细类'), (x) => typeLabel((window.splitFundType(x) || {}).sub || ''), 'txtL', 34, TT('积金局基金细类（第二级，属于上一列类别）')],
      [TT('强积金计划'), (x) => x.scheme || '', 'txtL', 46, TT('所属强积金计划（受托人／保荐人）')],
      [TT('受托人'), (x) => (window.trusteeDisplay ? window.trusteeDisplay(x.trustee) : x.trustee), 'txtL', 14, TT('受托人／保荐人')],
      [TT('风险级别'), (x) => x.risk, 'int', 8, TT('积金局按近三年波幅评定的 1–7 级（1 最低、7 最高）')],
      [TT('单位资产净值'), (x) => x.nav, 'nav', 12, TT('发行人官网公布的单位资产净值（NAV），估值日见下一列')],
      [TT('净值估值日'), (x) => x.navAsOf || '', 'txt', 11, TT('该净值的官方估值日；与全站最新日相差 3 天以上属源站未更新')],
      [TT('日涨跌'), (x) => x.selfD1, 'pct', 9, TT('本站自算：最新净值 ÷ 前一交易日净值 − 1')],
      [TT('近1周'), (x) => x.selfW1, 'pct', 9, TT('本站自算：近 5 个交易日累计涨跌')],
      [TT('近1个月'), (x) => x.selfM1, 'pct', 9, TT('本站自算：近 1 个月累计涨跌')],
      [TT('年初至今'), (x) => x.selfYtd, 'pct', 9, TT('本站自算：年初至最新净值日累计涨跌')],
      [TT('近1年'), (x) => x.selfY1, 'pct', 9, TT('本站自算：近 1 年累计涨跌')],
      [TT('近3年年化'), (x) => x.selfY3a, 'pct', 10, TT('本站自算：近 3 年几何年化回报')],
      [TT('近5年年化'), (x) => x.selfY5a, 'pct', 10, TT('本站自算：近 5 年几何年化回报')],
      [TT('近1年最大回撤'), (x) => x.selfMdd, 'pct', 11, TT('本站自算：近 1 年区间内自高点回落的最大幅度')],
      [TT('近5年最大回撤'), (x) => x.selfMdd5, 'pct', 11, TT('本站自算：近 5 年区间内自高点回落的最大幅度')],
      [TT('年化波动率（近1年）'), (x) => x.vol1, 'pct', 11, TT('本站自算：日收益标准差 × √252')],
      [TT('3年波幅'), (x) => x.vol3, 'pct', 9, TT('本站自算：近 3 年年化波动率')],
      [TT('夏普比率（近1年）'), (x) => x.sharpe1, 'sharpe', 10, TT('本站自算：（年化回报 − 无风险利率）÷ 年化波动率；年化波动率低于 0.5% 的基金（多为保守／货币市场）比值失真，显示 n.a.')],
      [TT('超额收益（对恒指·近1年）'), (x) => x.excess1, 'pct', 13, TT('本站自算：近 1 年回报 − 恒生指数同期回报')],
      [TT('正收益月份占比'), (x) => x.posM12, 'pct0', 11, TT('近 12 个月中录得正回报的月份占比')],
      [TQ('基金规模（{u}）', { u: TT('百万港元') }), (x) => x.size, 'num2', 12, TT('积金局公布的最新基金规模，按月更新')],
      [TT('基金管理费 %'), (x) => (x.mgmtFee == null ? '' : feeText(x.mgmtFee, x.feeMore && x.feeMore.mgmtFee)), 'txt', 11, TT('积金局披露的基金管理费；区间或「最高」按原文显示')],
      [TT('最近期基金开支比率'), (x) => x.fer, 'num2', 11, TT('基金开支比率（FER），积金局披露')],
      [TT('推出日期'), (x) => x.launch || '', 'txt', 11, TT('基金推出日期')],
    ];

    const cellOf = (x, i, def) => {
      const v = def[1](x, i);
      switch (def[2]) {
        case 'rank': return { v: i + 1, s: 3 };
        case 'txtL': return txt(v, 4);
        case 'txt': return txt(v);
        case 'int': return v == null || !isFinite(v) ? { v: '', s: 4 } : { v: Number(v), s: 19 };
        case 'nav': return v == null || !isFinite(v) ? { v: '', s: 4 } : { v: Math.round(v * 1e4) / 1e4, s: 6 };
        /* 2026-11-17：百分比存百分数（19.47）+ 自定义格式，复制到别处不会差 100 倍 */
        case 'pct': return v == null || !isFinite(v) ? { v: '', s: 4 } : { v: Math.round(v * 100) / 100, s: 21 };
        case 'pct0': return v == null || !isFinite(v) ? { v: '', s: 4 } : { v: Math.round(v * 100) / 1e4, s: 5 };
        case 'num2': return num(v, 7);
        /* 2026-11-17（用户反馈「夏普有缺失」）：null 不能留空，写 n.a. 才看得出是「不适用」而不是漏算 */
        case 'sharpe': return v == null || !isFinite(v) ? { v: 'n.a.', s: 4 } : { v: Math.round(v * 100) / 100, s: 7 };
        default: return txt(v);
      }
    };
    return { dimTxt, dirTxt, filterBits, conv, navLatest, COLS, cellOf };
  }
  window.mpfExportSchema = buildExportSchema;

  function exportIdx() {
    if (!window.MPFXLSX) { if (window.mpfToast) mpfToast(TT('导出组件未加载，请刷新页面')); return; }
    const { dimTxt, dirTxt, filterBits, conv, navLatest, COLS, cellOf } = buildExportSchema();

    const head = COLS.map((c) => ({ v: c[0], s: 2 }));
    const body = ROWS.map((x, i) => COLS.map((c) => cellOf(x, i, c)));
    const lastCol = (() => { let n = COLS.length; let out = ''; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; })();

    /* 2026-11-04（第三十七轮，用户要求）：表头上方不再重复「排名维度 / 筛选」说明
       （这些已写在「数据说明」工作表），只保留一行居中的标题。 */
    const rows = [];
    rows.push({ h: 32, cells: [{ v: TT('基金最新数据') + ' · ' + TQ('净值截至 {d}', { d: navLatest || DATA.dataAsOf || '—' }), s: 1 }] });
    rows.push({ h: 34, cells: head });
    /* 行高按「名称/计划/种类」三列的实际字数估算，长名字自动加高，短名字不空一大截 */
    const cjkLen = (v) => String(v == null ? '' : v).replace(/[一-龥　-〿＀-￯]/g, 'xx').length;
    body.forEach((r) => {
      const lines = Math.max(
        Math.ceil(cjkLen(r[1] && r[1].v) / 44),
        Math.ceil(cjkLen(r[5] && r[5].v) / 40),
        Math.ceil(cjkLen(r[3] && r[3].v) / 16), 1);
      rows.push({ h: 20 + Math.max(0, lines - 1) * 15, cells: r });
    });

    const merges = ['A1:' + lastCol + '1'];
    /* 默认隐藏的列（用户指定：低频列不占版面） */
    const HIDDEN_COLS = [TT('单位类别'), TT('基金细类'), TT('强积金计划')];

    setTimeout(() => {
      Promise.resolve(null).then((logo) => {
        const cover = window.buildCoverSheet({
          page: TT('基金最新数据'),
          title: TT('数据说明'),
          meta: [
            [TT('净值截至'), navLatest || '—'],
            [TT('积金局字段截至'), DATA.dataAsOf || '—'],
            [TT('本站同步时间'), new Date(DATA.updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })],
            [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
            [TT('收录范围'), TQ('{n} 条成分基金（按单位类别逐条，全市场 {u} 家受托人）', { n: ROWS.length, u: DATA.trusteeCount || '—' })],
            [TT('排名维度'), (window.__DIMSEL || []).map((d) => dimLabel(d.k) + '（' + dirTxt(d.d) + '）').join(' + ') || '—'],
            [TT('筛选条件'), filterBits.length ? filterBits.join('、') : TT('无（全市场）')],
          ],
          notes: [
            TT('净值来源：各计划受托人／保荐人官网每日公布的单位资产净值；风险级别、基金规模、历年回报、基金开支比率等字段取自积金局「强积金基金平台」（按月更新，通常滞后 1–2 个月）。'),
            TT('自算指标（日涨跌 / 近1周 / 近1个月 / 年初至今 / 近1年 / 近3年 / 近5年年化 / 最大回撤 / 波动率 / 夏普 / 超额收益）由本站按发行人官网净值直接计算，不含分红再投资与费用调整；与积金局公布的同名指标口径不同，不可直接相减。'),
            TT('夏普比率显示 n.a. 表示该基金近 1 年年化波动率低于 0.5%（多为保守／货币市场基金），比值会被极小的分母放大而失真，故不提供。'),
            TT('空白单元格＝该基金当日无官方净值（周末、香港公众假期、非估值日，或该基金尚未推出／已终止），或积金局未公布该字段；本站不插值、不使用前值填充。'),
          ],
          columns: COLS.map((c) => [c[0], c[4]]),
        });
        const blob = window.MPFXLSX.build({
          sheets: [
            cover,
            {
              name: TT('基金数据'), rows: rows, merges: merges,
              /* 2026-11-17（用户要求）：单位类别 / 基金细类 / 强积金计划默认隐藏（列宽 0 + hidden），
                 需要时在 Excel 里取消隐藏即可，不影响筛选与排序 */
              /* 2026-11-17（用户反馈取消隐藏后仍截断）：隐藏列**不能把宽度设成 0**，
                 Excel 取消隐藏时会保持 0 宽 → 永远显示不全。保留真实列宽，只打 hidden 标记。 */
              cols: COLS.map((c) => c[3]),
              hiddenCols: COLS.map((c, i) => (HIDDEN_COLS.indexOf(c[0]) >= 0 ? i : -1)).filter((i) => i >= 0),
              /* 2026-11-17（用户要求）：第一列是名次，冻结到「基金名称」之后才有意义 */
              freeze: { x: 2, y: 2, top: 'C3' },
              autoFilter: 'A2:' + lastCol + rows.length,
            },
          ],
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'MPF基金最新数据_' + (navLatest || DATA.dataAsOf || '') + '.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
        if (window.mpfToast) mpfToast(TT('已导出（含数据说明与基金数据两个工作表）'));
      });
    }, 30);
  }

  /** 重置全部筛选（含估值日标签，2026-10-14） */
  function resetAll() {
    Object.assign(F, { kw: '', type: [], sub: [], trustee: [], risk: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '', navDate: '' });
    if (MF_TY) { MF_TY.setSelected([], true); MF_S.setSelected([], true); MF_T.setSelected([], true); }
    ['#kw', '#fRetMin', '#fRetMax', '#fDdMin', '#fDdMax', '#fFeeMax'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
    /* 2026-10-31（用户要求）：涨跌幅/回撤/费率第二行筛选已下线 */
    document.querySelectorAll('.ndk').forEach((el) => el.classList.remove('on'));
    fillSub(); S.page = 1; render(); syncUrlFilters();
  }
  window.clearAllFilters = resetAll;   // 空态「一键清除」入口（2026-10-14；筛选行/重置按钮 2026-10-31 应用户要求删除）

  /* ---------- 列设置（2026-10-14）：勾选显示列 + 精简模式 ---------- */
  /* 2026-10-19：列序对齐「基金最新数据」表格（名次 + 自算指标） */
  const COL_DEFS = [
    { i: 1, k: 'rank', n: '名次', lock: true },
    { i: 3, k: 'fund', n: '基金名称' },
    /* 2026-11-20（用户要求）：导出中心有、表格列设置缺的三列补上（默认不勾） */
    { i: 3.1, k: 'unit', n: '单位类别' },
    { i: 3.2, k: 'scheme', n: '强积金计划' },
    { i: 4, k: 'trustee', n: '受托人' },   /* 2026-10-31（用户要求）：列名由「发行人（受托人）」简写 */
    { i: 5, k: 'type', n: '基金种类' },
    { i: 5.1, k: 'sub', n: '基金细类' },
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
    { i: 27, k: 'fer', n: '基金开支比率' },
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
    'selfD1', 'selfM1', 'selfYtd', 'selfY1', 'size', 'fer', 'cmp', 'ops'];
  /* 2026-10-27（用户要求）：「精简模式」下线，改为「默认模式」——一键回到用户指定的 14 列 */
  /* 2026-11-11（用户反馈）：列设置不再写 localStorage —— 刷新页面必须回到默认 12 列。
     之前改过列的用户会一直停在自定义列，看起来像「列设置坏了 / 恢复不了默认」。 */
  let colSet = new Set(COL_DEFAULT);
  let DIM_EXTRA = [];   /* 2026-11-02：维度联动临时放出的列（可多选，不持久化） */
  try { localStorage.removeItem('mpf-cols-v9'); } catch (e) {}
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
  function applyCols() {
    /* 2026-11-11：只作用于当前页面（内存），刷新即回默认列 */
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
      F.kw = $('#kw').value.trim(); S.page = 1; render(); syncUrlFilters();
      /* 首次输入时懒加载英文名，到货后自动重绘（简繁英互通） */
      ensureNamesEn().then(() => render());
    }, 200));
    /* 2026-10-31（用户要求）：第二行筛选（涨跌幅/回撤/管理费）与「重置条件」按钮已删除；重置走空态「一键清除」 */
    const bReset = $('#btnReset');
    if (bReset) bReset.addEventListener('click', resetAll);
    $('#perPage').addEventListener('change', () => {
      S.size = parseInt($('#perPage').value, 10) || 10;
      S.page = 1;
      render();
    });
    /* 2026-11-19（8.0）：导出按钮统一走「导出中心」，预置当前筛选结果；
       export-center.js 未加载时回退旧的直接导出，保证任何环境下按钮都可用。 */
    $('#idxExport').addEventListener('click', () => {
      if (window.openExportCenter) window.openExportCenter(ROWS.map((x) => String(x.id)));
      else exportIdx();
    });
  }

  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function filtered() {
    const kw = toSimp(F.kw).toLowerCase();
    return DATA.funds.filter((x) => {
      if (F.type.length && F.type.indexOf(x.type) < 0) return false;
      if (F.sub.length && F.sub.indexOf(x.subtype) < 0) return false;
      if (F.trustee.length && F.trustee.indexOf(x.trustee) < 0) return false;
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
    renderScopeNote();

    /* 2026-10-26 重做：可见列顺序单源——表头与表体由同一数组生成，物理上不可能错位 */
    const order = visibleOrder();
    renderThead(order);

    /* 2026-11-02（第二十五轮，用户要求）：勾选「对比」或从上方走势图添加的基金，
       在表格里置顶显示，并用「以上是已选基金」与其余基金分开（照搬可视化对比页的交互）。
       置顶行不是另起一套数据，而是按当前排序结果原样抽出，名次仍保留真实排名。 */
    const selIds = (window.CMPX && window.CMPX.ids) ? window.CMPX.ids().map(String) : [];
    const selSet = {};
    selIds.forEach((id) => { selSet[id] = 1; });
    const ranked = ROWS.map((x, i) => ({ x, rk: i + 1 }));
    const pinned = selIds.length ? ranked.filter((o) => selSet[String(o.x.id)]) : [];
    const rest = pinned.length ? ranked.filter((o) => !selSet[String(o.x.id)]) : ranked;

    const pages = Math.max(1, Math.ceil(rest.length / S.size));
    if (S.page > pages) S.page = pages;
    const st = (S.page - 1) * S.size;
    const page = rest.slice(st, st + S.size);

    const pinnedHtml = pinned.map((o) => rowHtml(o.x, o.rk, order, true)).join('');
    const pageHtml = page.map((o) => rowHtml(o.x, o.rk, order)).join('');
    const divider = (pinned.length && page.length)
      ? '<tr class="qf-divider"><td colspan="' + order.length + '">' + TT('以上是已选基金') + '</td></tr>' : '';

    $('#tbody').innerHTML = (pinned.length || page.length)
      ? pinnedHtml + divider + pageHtml
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
      render();        /* 2026-11-02（第二十五轮）：勾选后立即把这个基金置顶到表格最前面 */
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
    /* 2026-11-14（第三轮独立核验 D-06）：行内对比勾选框原先没有任何可读名称，
       屏幕阅读器只会念「复选框」。补 aria-label（含基金名）与 title。 */
    cmp: (x) => '<td data-c="cmp" class="c" data-l="' + TT('对比') + '"><input type="checkbox" aria-label="' + esc(TT('加入对比') + '：' + (window.fundDisplayName ? window.fundDisplayName(x) : (x.fundBase || x.fund))) + '" data-cmp="' + esc(x.id) +
      '" aria-label="' + esc(TT('加入对比') + '：' + (x.fundBase || x.fund || '')) +
      '" title="' + esc(TT('加入对比')) + '"' + (CMPX.has(x.id) ? ' checked' : '') + '></td>',
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
    unit: (x) => '<td data-c="unit" data-l="' + TT('单位类别') + '" class="c">' + esc(x.unit || '—') + '</td>',
    sub: (x) => '<td data-c="sub" data-l="' + TT('基金细类') + '" class="fz">' + esc((window.splitFundType ? (window.splitFundType(x) || {}).sub : '') ? typeLabel((window.splitFundType(x) || {}).sub) : '—') + '</td>',
    scheme: (x) => '<td data-c="scheme" data-l="' + TT('强积金计划') + '" class="fz">' + esc(x.scheme || '—') + '</td>',
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
    /* 2026-11-19（用户反馈）：表格补「基金开支比率 FER」——数据一直有，只是没上表 */
    fer: (x) => '<td data-c="fer" data-l="' + TT('基金开支比率') + '" class="r num">' +
      (x.fer == null || !isFinite(x.fer) ? '<span class="risk-na">n.a.</span>' : x.fer.toFixed(2) + '%') + '</td>',
    launchTs: (x) => '<td data-c="launchTs" data-l="' + TT('推出日期') + '" class="num">' + esc(x.launch || '—') + '</td>',
    ops: (x) => '<td data-c="ops" data-l="' + TT('操作') + '" class="c"><button class="btn-detail" onclick="openDetail(\'' + esc(x.id) + '\')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
      TT('详情') + '</button></td>',
  };
  /* 表头模板（与 CELL_FNS 同 key；搬自原静态 thead） */
  const TH_HTML = {
    rank: '<th scope="col" data-c="rank" data-i18n-parts class="c" style="width:56px">名次</th>',
    cmp: '<th scope="col" data-c="cmp" data-i18n-parts class="c" style="width:52px">对比</th>',
    fund: '<th scope="col" data-c="fund" data-i18n-parts data-k="fund" data-defdir="asc" class="sortable fz">基金名称 <span class="arrow">↕</span></th>',
    trustee: '<th scope="col" data-c="trustee" data-i18n-parts data-k="trustee" data-defdir="asc" class="sortable">受托人 <span class="arrow">↕</span></th>',
    /* 2026-11-20：导出中心有、表格缺的三列补上表头（默认不显示，可在列设置勾选） */
    unit: '<th scope="col" data-c="unit" data-i18n-parts data-k="unit" data-defdir="asc" class="sortable c">单位<br>类别 <span class="arrow">↕</span></th>',
    sub: '<th scope="col" data-c="sub" data-i18n-parts data-k="subtype" data-defdir="asc" class="sortable fz">基金细类 <span class="arrow">↕</span></th>',
    scheme: '<th scope="col" data-c="scheme" data-i18n-parts data-k="scheme" data-defdir="asc" class="sortable fz">强积金计划 <span class="arrow">↕</span></th>',
    type: '<th scope="col" data-c="type" data-i18n-parts data-k="typeFull" data-defdir="asc" class="sortable">基金种类 <span class="arrow">↕</span></th>',
    risk: '<th scope="col" data-c="risk" data-i18n-parts data-k="risk" data-defdir="asc" class="sortable c">风险<br>级别 <span class="arrow">↕</span></th>',
    nav: '<th scope="col" data-c="nav" data-i18n-parts data-k="nav" data-defdir="desc" class="sortable r" title="取自各受托人官网公布的单位资产净值；悬浮每个数值可看来源与估值日">单位资产净值 <span class="arrow">↕</span></th>',
    selfD1: '<th scope="col" data-c="selfD1" data-i18n-parts data-k="selfD1" data-defdir="desc" class="sortable r">日涨跌 <span class="arrow">↕</span></th>',
    selfW1: '<th scope="col" data-c="selfW1" data-i18n-parts data-k="selfW1" data-defdir="desc" class="sortable r">近1周 <span class="arrow">↕</span></th>',
    selfM1: '<th scope="col" data-c="selfM1" data-i18n-parts data-k="selfM1" data-defdir="desc" class="sortable r">近1个月 <span class="arrow">↕</span></th>',
    selfYtd: '<th scope="col" data-c="selfYtd" data-i18n-parts data-k="selfYtd" data-defdir="desc" class="sortable r">年初至今 <span class="arrow">↕</span></th>',
    selfY1: '<th scope="col" data-c="selfY1" data-i18n-parts data-k="selfY1" data-defdir="desc" class="sortable r">近1年 <span class="arrow">↕</span></th>',
    selfY3a: '<th scope="col" data-c="selfY3a" data-i18n-parts data-k="selfY3a" data-defdir="desc" class="sortable r">近3年<br><small>年化</small> <span class="arrow">↕</span></th>',
    selfY5a: '<th scope="col" data-c="selfY5a" data-i18n-parts data-k="selfY5a" data-defdir="desc" class="sortable r">近5年<br><small>年化</small> <span class="arrow">↕</span></th>',
    selfMdd: '<th scope="col" data-c="selfMdd" data-i18n-parts data-k="selfMdd" data-defdir="asc" class="sortable r">近1年<br><small>最大回撤</small> <span class="arrow">↕</span></th>',
    selfMdd5: '<th scope="col" data-c="selfMdd5" data-i18n-parts data-k="selfMdd5" data-defdir="asc" class="sortable r">近5年<br><small>最大回撤</small> <span class="arrow">↕</span></th>',
    vol1: '<th scope="col" data-c="vol1" data-i18n-parts data-k="vol1" data-defdir="asc" class="sortable r">年化波动率<br><small>近1年</small> <span class="arrow">↕</span></th>',
    vol3: '<th scope="col" data-c="vol3" data-i18n-parts data-k="vol3" data-defdir="asc" class="sortable r">3年波幅 <span class="arrow">↕</span></th>',
    sharpe1: '<th scope="col" data-c="sharpe1" data-i18n-parts data-k="sharpe1" data-defdir="desc" class="sortable r">夏普比率<br><small>近1年</small> <span class="arrow">↕</span></th>',
    excess1: '<th scope="col" data-c="excess1" data-i18n-parts data-k="excess1" data-defdir="desc" class="sortable r">超额收益<br><small>对恒指·近1年</small> <span class="arrow">↕</span></th>',
    posM12: '<th scope="col" data-c="posM12" data-i18n-parts data-k="posM12" data-defdir="desc" class="sortable r">正收益<br><small>月份占比</small> <span class="arrow">↕</span></th>',
    size: '<th scope="col" data-c="size" data-i18n-parts data-k="size" data-defdir="desc" class="sortable r">基金规模<br><small>百万港元</small> <span class="arrow">↕</span></th>',
    mgmtFee: '<th scope="col" data-c="mgmtFee" data-i18n-parts data-k="mgmtFee" data-defdir="asc" class="sortable r">基金管理费<br><small>% p.a.</small> <span class="arrow">↕</span></th>',
    fer: '<th scope="col" data-c="fer" data-i18n-parts data-k="fer" data-defdir="asc" class="sortable r">基金开支比率<br><small>% p.a.</small> <span class="arrow">↕</span></th>',
    launchTs: '<th scope="col" data-c="launchTs" data-i18n-parts data-k="launchTs" data-defdir="desc" class="sortable">推出日期 <span class="arrow">↕</span></th>',
    ops: '<th scope="col" data-c="ops" data-i18n-parts class="c">操作</th>',
  };
  /* 2026-11-04（第三十五轮，用户要求）：来源于积金局月度披露的列，表头加悬浮说明。
     不加 ⓘ 图标，只在鼠标移到表头时由全局 [data-tip] 浮层显示（触屏点一下也能看到）。 */
  const TH_TIPS = {
    risk: '积金局公布的基金风险级别（1–7 级，按过往波幅评定），随积金局披露更新，非本站自算。',
    size: '积金局公布的基金资产规模（百万港元），随积金局月报更新，通常每月一次；未公布时显示 n.a.。',
    mgmtFee: '积金局披露的基金管理费（% p.a.）。部分基金以区间或「最高」形式公布，表内按原文显示，排序按区间下限。',
    fer: '基金开支比率（FER，% p.a.）：含管理费、信托人费、保管费等经常性开支，积金局按年披露；与「基金管理费」不是同一口径。',
    launchTs: '积金局披露的基金推出日期，不随净值变动。',
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
    /* 2026-11-04：积金局口径列的悬浮说明（用 TT 现取，语言切换重绘后即同步） */
    Object.keys(TH_TIPS).forEach((k) => {
      const cell = th.querySelector('th[data-c="' + k + '"]');
      if (cell) cell.setAttribute('data-tip', TT(TH_TIPS[k]));
    });
  }

  function rowHtml(x, rk, order, pinned) {
    return '<tr data-id="' + esc(x.id) + '"' + (pinned ? ' class="is-pinned"' : '') + '>' +
      order.map((k) => (CELL_FNS[k] || function () { return ''; })(x, rk)).join('') + '</tr>';
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
      /* 2026-11-04：基金名/受托人也走显示函数，英文模式下不再残留中文 */
      card(TT('规模最大基金'), big ? fundDisplayName(big) : '—', '', big ? nf(big.size, 0) + ' ' + TT('百万港元') + ' · ' + (window.trusteeDisplay ? window.trusteeDisplay(big.trustee) : big.trustee) : ''),
    ].join('');
  }

  function card(k, v, unit, s) {
    /* 2026-10-31：v（基金名等数据值）也走 esc——简体模式下繁转简 */
    return '<div class="stat"><div class="k">' + k + '</div><div class="v num">' + esc(v) + '<small>' + unit + '</small></div><div class="s">' + esc(s) + '</div></div>';
  }

  /* 2026-11-04（第三十六轮）：表格下方那条口径提示改为 JS 渲染 —— 静态 HTML 没有词条，
     英文模式下一直显示中文（用户截图中的「有些东西切不过去」之一）。 */
  function renderScopeNote() {
    const el = document.getElementById('dbScopeNote');
    if (!el) return;
    const n = DATA.trusteeCount || 11;
    el.textContent = TQ('数据取自 {n} 家受托人官网（每交易日更新），指标由本平台自行计算；个别基金公布较慢，可能滞后 1–2 天。', { n: n });
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

  /* 2026-11-05（第三十九轮）：手机上筛选卡片默认收起 —— 五个筛选项 + 工具条要占 370px，
     一屏就被吃掉了。收起后只留一行「筛选与排序 · 共 N 条」，点开才展开。
     桌面端这个按钮直接 display:none，行为与原来完全一致。 */
  (function initMobileFilter() {
    const box = document.querySelector('.card.filters');
    if (!box || box.dataset.mToggle) return;
    box.dataset.mToggle = '1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'm-filter-toggle';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="mft-ic">☰</span><span class="mft-t" data-i18n="筛选与排序">' + TT('筛选与排序') + '</span>' +
      '<span class="mft-s" id="mftCount"></span><i class="mft-c">▾</i>';
    box.parentNode.insertBefore(btn, box);
    const sync = () => {
      const c = document.getElementById('cnt');
      const el = document.getElementById('mftCount');
      if (!el) return;
      const n = c ? String(c.textContent || '').replace(/\s+/g, '').trim() : '';
      el.textContent = n ? TQ('共 {n} 条', { n: n }) : '';
    };
    btn.addEventListener('click', () => {
      const open = box.classList.toggle('m-open');
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      sync();
    });
    if (window.addRefreshHook) window.addRefreshHook(sync);
    /* 筛选条件一变，#cnt 就会被重写 → 用它驱动折叠条上的条数 */
    const cntEl = document.getElementById('cnt');
    if (cntEl && window.MutationObserver) new MutationObserver(sync).observe(cntEl, { childList: true, characterData: true, subtree: true });
    document.addEventListener('mpf:lang', () => {
      const t = btn.querySelector('.mft-t');
      if (t) t.textContent = TT('筛选与排序');
      sync();
    });
    sync();
  })();

  init();
})();
