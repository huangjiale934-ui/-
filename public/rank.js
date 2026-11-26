/* 板块二：强积金排名 */
(function () {
  const BOARDS = [
    // —— 自算净值（发行人官网 · 每日，截至最新净值日；不依赖积金局月报，比月报快 2–6 周） ——
    { g: '自算净值（发行人官网）', id: 'selfD1', name: '日涨跌榜（自算）', metric: 'selfD1', dir: 'desc', self: true, desc: '按发行人官网最新一个净值日的涨跌幅由高至低（自算口径，未含分红再投资与费用调整）' },
    { g: '自算净值（发行人官网）', id: 'selfW1', name: '近 1 周回报榜（自算）', metric: 'selfW1', dir: 'desc', self: true, desc: '按发行人官网每日净值的近 1 周涨幅由高至低（自算口径，实际快于积金局月报）' },
    { g: '自算净值（发行人官网）', id: 'selfM1', name: '近 1 个月榜（自算）', metric: 'selfM1', dir: 'desc', self: true, desc: '按发行人官网每日净值的近 1 个月涨幅由高至低（自算口径）' },
    { g: '自算净值（发行人官网）', id: 'selfYtd', name: '年初至今榜（自算）', metric: 'selfYtd', dir: 'desc', self: true, desc: '按发行人官网每日净值的年初至今涨幅由高至低（自算口径）' },
    { g: '自算净值（发行人官网）', id: 'selfY1', name: '近 1 年回报榜（自算）', metric: 'selfY1', dir: 'desc', self: true, desc: '按发行人官网每日净值的近 1 年涨幅由高至低（自算口径）' },
    { g: '自算净值（发行人官网）', id: 'selfY3a', name: '近 3 年年化榜（自算）', metric: 'selfY3a', dir: 'desc', self: true, desc: '按发行人官网每日净值计算的近 3 年年化回报由高至低（自算口径）' },
    { g: '自算净值（发行人官网）', id: 'selfY5a', name: '近 5 年年化榜（自算）', metric: 'selfY5a', dir: 'desc', self: true, desc: '按发行人官网每日净值计算的近 5 年年化回报由高至低（自算口径）' },
    { g: '自算净值（发行人官网）', id: 'selfMdd', name: '近 1 年回撤榜（自算）', metric: 'selfMdd', dir: 'desc', self: true, desc: '近 1 年最大回撤由小至大：回撤越小越抗跌（自算口径，运行峰值法）' },
    { g: '自算净值（发行人官网）', id: 'selfMdd5', name: '近 5 年回撤榜（自算）', metric: 'selfMdd5', dir: 'desc', self: true, desc: '近 5 年最大回撤由小至大：回撤越小越抗跌（自算口径，运行峰值法）' },
    // —— 收益表现 ——
    { g: '收益表现', id: 'ann1', name: '近 1 年回报榜', metric: 'ann1', dir: 'desc', desc: '按积金局公布的最近 1 年年率化回报由高至低排名' },
    { g: '收益表现', id: 'ann5', name: '近 5 年年化榜', metric: 'ann5', dir: 'desc', desc: '最近 5 年年率化回报排名，反映中期表现' },
    { g: '收益表现', id: 'ann10', name: '近 10 年年化榜', metric: 'ann10', dir: 'desc', desc: '最近 10 年年率化回报排名，反映长期表现' },
    { g: '收益表现', id: 'annLaunch', name: '推出至今榜', metric: 'annLaunch', dir: 'desc', desc: '自基金推出以来的年率化回报排名' },
    { g: '收益表现', id: 'calYear', name: '历年回报榜', metric: 'calYear', dir: 'desc', desc: '按积金局「曆年回報」逐年排名，可切换年份' },
    // —— 累积回报（非年化） ——
    { g: '累积回报', id: 'cum1', name: '近 1 年累积', metric: 'cum1', dir: 'desc', desc: '最近 1 年累积回报（非年化）排名' },
    { g: '累积回报', id: 'cum5', name: '近 5 年累积', metric: 'cum5', dir: 'desc', desc: '最近 5 年累积总回报（非年化）排名，反映中期实际累计涨幅' },
    { g: '累积回报', id: 'cum10', name: '近 10 年累积', metric: 'cum10', dir: 'desc', desc: '最近 10 年累积总回报（非年化）排名，反映长期实际累计涨幅' },
    { g: '累积回报', id: 'cumLaunch', name: '推出至今累积', metric: 'cumLaunch', dir: 'desc', desc: '自基金推出以来的累积总回报（非年化）排名' },
    // —— 风险与成本 ——
    { g: '风险与成本', id: 'worstYear', name: '抗跌榜', metric: 'worstYear', dir: 'desc', desc: '近 5 个历年中最差年度回报由高至低，数值越高代表越抗跌' },
    { g: '风险与成本', id: 'risk', name: '稳健低风险榜', metric: 'risk', dir: 'asc', desc: '按积金局风险级别由低至高排名，级别越低代表波动越小' },
    { g: '风险与成本', id: 'mgmtFee', name: '低管理费榜', metric: 'mgmtFee', dir: 'asc', desc: '基金管理费（% p.a.）由低至高排名，费用越低越靠前' },
    { g: '风险与成本', id: 'fer', name: '最低总开支榜', metric: 'fer', dir: 'asc', desc: '按积金局公布的「最近期基金开支比率」（FER，%）由低至高，反映实际承担的整体开支水平' },
    // —— 规模与特色 ——
    { g: '规模与特色', id: 'size', name: '基金规模榜', metric: 'size', dir: 'desc', desc: '按基金资产规模（百万港元）由大至小排名' },
    { g: '规模与特色', id: 'launchTs', name: '新锐基金榜', metric: 'launchTs', dir: 'desc', desc: '按推出日期由新至旧排名，聚焦近年新设立的成分基金' },
    // —— 聚合视角 ——
    { g: '聚合视角', id: 'trusteeAgg', name: '发行人实力榜', agg: 'trustee', metric: 'ann1Avg', dir: 'desc', desc: '按受托人（发行人）聚合旗下全部成分基金，以平均近 1 年年率化回报由高至低，比较各家整体表现' },
    { g: '聚合视角', id: 'champion', name: '各细类冠军榜', agg: 'subtype', metric: 'ann1', dir: 'desc', desc: '在每一个基金细类中各取近 1 年回报最高的一只，一览各类别的领跑基金' },
  ].filter((b) => !b.self);   /* 2026-10-19：本页只放积金局已公布的数据，自算榜单移到「基金最新数据」 */

  // 支持 #榜单id 深链接直达（如 #trusteeAgg 直接打开发行人实力榜），便于分享特定榜单
  // 同时兼容合并页的 ?rk=<榜单id>（如 /index.html?rk=selfW1）
  const HASH0 = (location.hash || '').replace(/^#/, '');
  const QSB = (new URLSearchParams(location.search)).get('rk') || '';
  /* 2026-10-24（核验报告 v3 #12）：自算榜单 2026-10-19 已迁至「基金最新数据」的资料库，
     旧 ?rk=selfX 深链不再落默认 ann1 榜，直接把用户带到资料库（榜单所在页） */
  /* 2026-11-16（补体检）：原来多加了一个「当前不在 index.html」的条件，
     导致旧链接 /index.html?rk=selfW1 被静默忽略——页面停在榜单页、显示近 1 年榜，
     与 URL 表达的意思相反。改为无条件跳到资料库；目标 URL 不带 rk，不会循环。 */
  if (/^self/i.test(QSB)) {
    location.replace('index.html#db');
  }
  const S = {
    /* 2026-10-31 四版（用户要求）：打开排名页不预选任何榜单（标签无选中），
       但主表默认按「近 1 年年率化」由高至低（不高亮该列）；点标签进入对应榜。
       深链 ?rk= / #board 仍然有效。 */
    board: BOARDS.some((b) => b.id === HASH0) ? HASH0 : (BOARDS.some((b) => b.id === QSB) ? QSB : ''),
    type: [], sub: [], scheme: [], risk: '', trustee: [], kw: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '', top: 10, page: 1, sortKey: null, sortDir: null, calYear: '',
  };
  let FUND_HEAD = '';   // 基金榜表头（初始 DOM 快照，切换回来时还原）
  let HEAD_MODE = '';   // 当前表头模式，避免重复重绘
  let PERFD = null;     // 自算净值指标（/api/navperf，覆盖已接入历史净值的基金）
  /* 2026-10-26 修（致命 bug）：列定义 FUND 与隐藏集合 off 都定义在文件末尾的列设置闭包里，
     而 rkVisibleOrder 在本闭包中直接引用 → ReferenceError: FUND is not defined，
     整个排名榜 render() 中断（MPFA 榜 0 条、加载动画不消失）。改为「委派入口」： */
  let RK_ORDER_IMPL = null;
  window.__rkSetOrderImpl = function (f) { RK_ORDER_IMPL = f; };
  window.__rkRender = function () { render(); };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  /* 2026-11-12（核验发现）：本文件多处 toast 用了 _t()，但 _t 只在 trend.js 内部定义过，
     榜单页一调就是 ReferenceError（导出成功也没有提示、导出组件缺失时更是一片空白）。
     这里补一个同签名的小helper：有 TT 就翻译，没有就原样返回。 */
  const _t = (s) => (typeof TT === 'function' ? TT(s) : s);

  /* 2026-10-31 四版（用户要求）：未选榜单时默认按「近 1 年年率化」由高至低（列不高亮，仅默认序） */
  /* 2026-11-26（领导要求）：积金局表格默认按官方序号排列（与官网一致），不再默认按近1年排序 */
  const FALLBACK_BOARD = { id: '', name: '全部基金', desc: '按积金局官方序号排列（与官网表格一致）；点表头可按任一指标排序', metric: null, dir: 'desc' };
  function cur() { return BOARDS.find((b) => b.id === S.board) || FALLBACK_BOARD; }

  function init() {
    mountHeader('db');   /* 2026-10-15：合并页导航项为「强积金资料库」（key=db），此前传 rk 导致无高亮 */
    loadData(() => {
      S.calYear = (DATA.years && DATA.years[0]) || String(new Date().getFullYear() - 1);
      buildTabs();
      const sd = document.querySelector('#rkScopeDate');
      if (sd && DATA.dataAsOf) sd.textContent = DATA.dataAsOf;
      /* 2026-11-04：月报头部的「资料截至」与表格下方说明同一来源 */
      const ma = document.querySelector('#mpfaAsOf');
      if (ma && DATA.dataAsOf) ma.textContent = DATA.dataAsOf;
      applyRkUrl();          /* 2026-11-19：先读 URL，buildFilters 的细类过滤才会按已选种类收窄 */
      buildFilters();
      paintRkUrl();
      buildMobileSort();
      initDualScroll('#rkTscroll', '#rkTopScroll', '#rkScrollGhost');
      FUND_HEAD = $('#rkThead').innerHTML;
      // 排名页表头排序由本页状态管理（名次列始终按榜单指标）
      bindHeadSort();
      bind();
      /* 2026-11-04：注册到刷新钩子表（资料库/对比页共存），不再独占 __onRefresh */
      window.addRefreshHook(() => { buildFilters(); render(); });
      render();
      /* 自算净值榜数据（/api/navperf）：到达后若当前正是自算榜则重绘 */
      fetchJSON('/api/navperf', 'navperf').then((j) => {
        PERFD = j && j.funds ? j : { funds: {} };
        if (cur().self) render();
        buildTabs();
      }).catch(() => { PERFD = { funds: {} }; });
    });
  }
  const flip = (d) => (d === 'asc' ? 'desc' : 'asc');

  /** 绑定表头点击排序（表头可能整体替换，故需可重复绑定）
      2026-10-22（用户要求）：三态 —— 最大 → 最小 → 取消（回该榜单默认名次） */
  /* 2026-10-30：三态（首次=defdir → 再点=反向 → 三点=取消回默认顺序）。
     箭头与高亮统一由 render() 末尾的 syncHeader() 刷新，与「基金最新数据」页观感一致。 */
  function bindHeadSort() {
    $$('#rkThead th[data-k]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.k;
        const d0 = th.dataset.defdir === 'asc' ? 'asc' : 'desc';
        if (S.sortKey !== k) { S.sortKey = k; S.sortDir = d0; }
        else if (S.sortDir === d0) { S.sortDir = d0 === 'asc' ? 'desc' : 'asc'; }
        else { S.sortKey = null; S.sortDir = null; }   /* ③ 取消 */
        render(); syncRkUrl();
      });
    });
  }

  /** 发行人实力榜列结构不同，切换榜单时整体替换表头。
      文案全部经过 TT()，切换语言后由 mpf:lang 监听重建即可跟随。 */
  const aggHead = () =>
    '<th scope="col" class="c" style="width:56px">' + TT('序号') + '</th>' +
    '<th scope="col" data-k="fund" data-defdir="asc" class="sortable fz">' + TT('受托人') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-k="count" data-defdir="desc" class="sortable r">' + TT('成分') + '<br>' + TT('基金数') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-k="sizeSum" data-defdir="desc" class="sortable r">' + TT('总规模') + '<br><small>' + TT('百万港元') + '</small> <span class="arrow">↕</span></th>' +
    '<th scope="col" data-k="ann1Avg" data-defdir="desc" class="sortable r">' + TT('平均近1年') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-k="ann5Avg" data-defdir="desc" class="sortable r">' + TT('平均近5年') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-k="ann10Avg" data-defdir="desc" class="sortable r">' + TT('平均近10年') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-k="annLaunchAvg" data-defdir="desc" class="sortable r">' + TT('平均推出至今') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-k="mgmtFee" data-defdir="asc" class="sortable r">' + TT('平均管理费') + '<br><small>% p.a.</small> <span class="arrow">↕</span></th>' +
    '<th scope="col" class="r" title="' + TT('已从该受托人官网核对到最新单位资产净值的基金数 / 旗下基金总数') + '">' + TT('净值') + '<br>' + TT('核实率') + '</th>' +
    '<th scope="col" class="c" style="width:86px">' + TT('详情') + '</th>';

  function applyHeader(b, isCal) {
    const mode = b.self ? 'self' : (b.agg === 'trustee' ? 'agg' : 'fund');
    /* 先同步当前榜单口径，rkVisibleOrder（列设置闭包）依赖这两个标记 */
    window.__rkMode = mode;
    window.__rkIsCal = !!isCal;
    window.__rkMetric = (b && !b.agg) ? b.metric : '';
    let fundOrder = null;
    if (mode === 'fund') {
      /* 2026-10-26 重做：fund 表头按可见列顺序数组生成（与行渲染同源，不会错位） */
      fundOrder = rkVisibleOrder();
      $('#rkThead').innerHTML = fundOrder.map((k) => TH_FUND[k]).join('');
      /* 2026-11-04：表头模板用 data-i18n-parts，重建后必须再跑一次 applyI18n，
         否则切到英文后表头又变回中文（重建发生在 mpf:lang 之后）。 */
      if (window.applyI18n) window.applyI18n($('#rkThead'));
      window.__rkOrder = fundOrder;
    } else if (mode !== HEAD_MODE) {
      $('#rkThead').innerHTML = mode === 'agg' ? aggHead() : selfHead();
      if (window.applyI18n) window.applyI18n($('#rkThead'));
    }
    if (mode !== HEAD_MODE || mode === 'fund') { HEAD_MODE = mode; bindHeadSort(); }
    const thCal = $('#rkThCalYear');
    if (thCal) thCal.style.display = mode === 'fund' && isCal ? '' : 'none';
    window.__rkMode = mode;
    window.__rkIsCal = !!isCal;
    if (typeof window.__rkApplyCols === 'function') window.__rkApplyCols();
    return fundOrder;
  }

  /** 自算榜表头（列结构与基金榜一致，但指标列全部换成自算口径，不再依赖积金局） */
  const SELF_COLS = [
    /* 表头不再写「自算」——整页口径已在顶部说明；这里就是最新净值口径 */
    ['selfD1', '日涨跌', 'desc'],
    ['selfW1', '近1周', 'desc'],
    ['selfM1', '近1月', 'desc'],
    ['selfYtd', '年初至今', 'desc'],
    ['selfY1', '近1年', 'desc'],
    ['selfY3a', '近3年年化', 'desc'],
    ['selfY5a', '近5年年化', 'desc'],
    ['selfMdd', '近1年回撤', 'desc'],
    ['selfMdd5', '近5年回撤', 'desc'],
  ];
  const selfHead = () =>
    '<th scope="col" data-i18n-parts class="c" style="width:56px">' + TT('序号') + '</th>' +
    '<th scope="col" data-i18n-parts data-k="fund" data-defdir="asc" class="sortable fz">' + TT('基金名称') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-i18n-parts data-k="trustee" data-defdir="asc" class="sortable">' + TT('受托人') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-i18n-parts data-k="typeFull" data-defdir="asc" class="sortable">' + TT('基金种类') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-i18n-parts data-k="risk" data-defdir="asc" class="sortable c">' + TT('风险') + ' <span class="arrow">↕</span></th>' +
    '<th scope="col" data-i18n-parts data-k="size" data-defdir="desc" class="sortable r">' + TT('基金规模') + '<br><small>' + TT('百万港元') + '</small> <span class="arrow">↕</span></th>' +
    SELF_COLS.map(([k, n, d]) =>
      '<th scope="col" data-i18n-parts data-k="' + k + '" data-defdir="' + d + '" class="sortable r">' + TT(n) + ' <span class="arrow">↕</span></th>').join('') +
    '<th scope="col" data-i18n-parts class="c" style="width:56px">' + TT('对比') + '</th>' +
    '<th scope="col" data-i18n-parts class="c" style="width:86px">' + TT('详情') + '</th>';

  function buildTabs() {
    /* 2026-10-31（用户要求）：榜单标签行删除，改为工具栏「排名维度」下拉（默认无=全部基金）。
       深链 ?rk= / #board 仍然有效；选中榜后表头三态排序不受影响。 */
    const sel = document.getElementById('rkDimSel');
    if (sel) {
      const fill = () => {
        /* 2026-11-02（第二十一轮，用户要求）：未选具体榜单时，下拉要写出实际排名口径
           （默认按近 1 年年率化降序），不再显示「无」 */
        sel.innerHTML = '<option value="">' + esc(TT('近 1 年回报')) + '</option>' +
          BOARDS.map((b) => '<option value="' + b.id + '">' + esc(TT(b.name)) + '</option>').join('');
        sel.value = S.board || '';
      };
      fill();
      if (!sel.__langBound) {
        sel.__langBound = 1;
        document.addEventListener('mpf:lang', () => buildTabs());
      }
      if (!sel.__bound) {
        sel.__bound = 1;
        sel.addEventListener('change', () => {
          S.board = sel.value;
          S.sortKey = null; S.sortDir = null;
          if (history.replaceState) history.replaceState(null, '', S.board ? '#' + S.board : '#');
          renderYearSwitch();
          render(); syncRkUrl();
        });
      }
    }
    renderYearSwitch();
  }

  /* 下拉与状态同步（深链 / 表头交互后由 syncHeader 调用） */
  function paintTabs() {
    const sel = document.getElementById('rkDimSel');
    if (sel && document.activeElement !== sel) sel.value = S.board || '';
  }

  function renderYearSwitch() {
    const el = $('#rkYearSwitch');
    if (!el) return;
    const years = (DATA.years && DATA.years.length ? DATA.years : []).slice();
    if (S.board !== 'calYear' || !years.length) { el.style.display = 'none'; return; }
    if (!S.calYear || years.indexOf(S.calYear) < 0) S.calYear = years[0];
    el.style.display = '';
    el.innerHTML = '<span class="ylab">' + TT('选择年份') + '</span>' + years.map((y) =>
      '<button class="tab ytab' + (y === S.calYear ? ' on' : '') + '" data-y="' + y + '">' + TQ('{y} 年', { y: y }) + '</button>'
    ).join('');
    $$('#rkYearSwitch .ytab').forEach((t) => t.addEventListener('click', () => {
      S.calYear = t.dataset.y;
      S.sortKey = null; S.sortDir = null;
      $$('#rkYearSwitch .ytab').forEach((o) => o.classList.remove('on'));
      t.classList.add('on');
      render(); syncRkUrl();
    }));
  }

  /* 2026-11-19（用户建议）：榜单筛选写入 URL，链接可直接分享「已筛好」的榜单。
     参数用 r 前缀（rty/rsb/rtr/rrisk/rkw/rdim/rtop），与资料库的 ty/sb/tr 区分开，
     因为两者共用 index.html，避免互相覆盖。 */
  function syncRkUrl() {
    try {
      const q = new URLSearchParams(location.search);
      const put = (k, arr) => { if (arr && arr.length) q.set(k, arr.join(',')); else q.delete(k); };
      put('rty', S.type); put('rsb', S.sub); put('rsc', S.scheme); put('rtr', S.trustee);
      if (S.risk !== '') q.set('rrisk', S.risk); else q.delete('rrisk');
      if (S.kw) q.set('rkw', S.kw); else q.delete('rkw');
      if (S.retDim && S.retDim !== 'ann1') q.set('rdim', S.retDim); else q.delete('rdim');
      if (S.top && S.top !== 10) q.set('rtop', String(S.top)); else q.delete('rtop');
      /* 2026-11-19（用户建议）：排序字段一并写入，分享「按近5年排序」的链接也能还原 */
      if (S.sortKey) { q.set('rsk', S.sortKey); q.set('rsd', S.sortDir || 'desc'); }
      else { q.delete('rsk'); q.delete('rsd'); }
      const s2 = q.toString();
      history.replaceState(history.state, '', location.pathname + (s2 ? '?' + s2 : '') + location.hash);
    } catch (e) {}
  }

  function applyRkUrl() {
    try {
      const q = new URLSearchParams(location.search);
      const arr = (k) => (q.get(k) || '').split(',').map((v) => v.trim()).filter(Boolean);
      const ty = arr('rty'), tr = arr('rtr'), sb = arr('rsb'), sc = arr('rsc');
      if (!ty.length && !tr.length && !sb.length && !sc.length && !q.get('rrisk') && !q.get('rkw') && !q.get('rdim') && !q.get('rsk')) return false;
      S.type = ty; S.trustee = tr; S.sub = sb; S.scheme = sc;
      if (q.get('rrisk')) S.risk = q.get('rrisk');
      if (q.get('rkw')) S.kw = q.get('rkw');
      if (q.get('rdim')) S.retDim = q.get('rdim');
      if (q.get('rtop')) { const n = parseInt(q.get('rtop'), 10); if (n > 0) S.top = n; }
      if (q.get('rsk')) { S.sortKey = q.get('rsk'); S.sortDir = q.get('rsd') === 'asc' ? 'asc' : 'desc'; }
      return true;
    } catch (e) { return false; }
  }

  /* 把 S 回填到控件（必须在 buildFilters 之后调用，选项才存在） */
  function paintRkUrl() {
    if (MF_RTY) MF_RTY.setSelected(S.type, true);
    if (MF_RTR) MF_RTR.setSelected(S.trustee, true);
    if (MF_RS) MF_RS.setSelected(S.sub, true);
    if (MF_RSC) MF_RSC.setSelected(S.scheme, true);
    const rk = document.querySelector('#rkRRisk');
    if (rk && S.risk !== '') rk.value = S.risk;
    const kw = document.querySelector('#rkKw');
    if (kw && S.kw) kw.value = S.kw;
    const rd = document.querySelector('#rkRRetDim');
    if (rd && S.retDim) rd.value = S.retDim;
    const tp = document.querySelector('#rkRTop');
    if (tp) tp.value = String(S.top);
  }

  /* 2026-11-19：榜单页三个筛选改多选，与资料库共用 MPFMulti */
  let MF_RTY = null, MF_RS = null, MF_RTR = null, MF_RSC = null;
  function ensureMF() {
    if (MF_RTY) return;
    MF_RTY = window.MPFMulti('#rkRType', {
      allLabel: TT('全部'),
      onChange: (arr) => { S.type = arr; S.sub = []; buildSubRisk(); S.page = 1; render(); syncRkUrl(); },
    });
    /* 2026-11-26（领导要求）：细类筛选下线，容器不在时不再创建组件 */
    if (document.querySelector('#rkRSub')) {
      MF_RS = window.MPFMulti('#rkRSub', {
        allLabel: TT('全部'),
        onChange: (arr) => { S.sub = arr; S.page = 1; render(); syncRkUrl(); },
      });
    }
    MF_RSC = window.MPFMulti('#rkRScheme', {
      allLabel: TT('全部'),
      onChange: (arr) => { S.scheme = arr; S.page = 1; render(); syncRkUrl(); },
    });
    MF_RTR = window.MPFMulti('#rkRTrustee', {
      allLabel: TT('全部'),
      onChange: (arr) => { S.trustee = arr; S.page = 1; fillScheme(); render(); syncRkUrl(); },
    });
  }

  /* 2026-11-26：计划筛选随受托人联动（与「基金最新数据」同一规则）——
     避免「受托人=宏利 + 计划=宏利退休精選」这种互斥组合筛出 0 条。 */
  function fillScheme() {
    ensureMF();
    if (!MF_RSC) return;
    const all = DATA.funds || [];
    const pool0 = S.trustee.length ? all.filter((x) => S.trustee.indexOf(x.trustee) >= 0) : all;
    const trList = window.mpfSortTrustees ? window.mpfSortTrustees(uniq(all.map((x) => x.trustee))) : uniq(all.map((x) => x.trustee));
    const trank = {};
    trList.forEach((v, i) => { trank[v] = i; });
    const schemes = uniq(pool0.map((x) => x.scheme)).filter(Boolean).sort((a, b) => {
      const ta = trank[(all.find((y) => y.scheme === a) || {}).trustee] !== undefined ? trank[(all.find((y) => y.scheme === a) || {}).trustee] : 99;
      const tb = trank[(all.find((y) => y.scheme === b) || {}).trustee] !== undefined ? trank[(all.find((y) => y.scheme === b) || {}).trustee] : 99;
      return ta - tb || String(a).localeCompare(String(b), 'zh-Hant');
    });
    MF_RSC.setOptions(schemes.map((v) => ({ v, label: v })));
    MF_RSC.setAllLabel(TT('全部计划'));
    const valid = new Set(schemes);
    const kept = S.scheme.filter((v) => valid.has(v));
    if (kept.length !== S.scheme.length) { S.scheme = kept; MF_RSC.setSelected(kept, true); }
  }

  function buildFilters() {
    ensureMF();
    const f = DATA.funds;
    MF_RTY.setOptions(uniq(f.map((x) => x.type)).map((v) => ({ v, label: typeLabel(v) })));
    const trList = window.mpfSortTrustees ? window.mpfSortTrustees(uniq(f.map((x) => x.trustee))) : uniq(f.map((x) => x.trustee));
    MF_RTR.setOptions(trList.map((v) => ({
      v, label: (window.trusteeDisplay ? window.trusteeDisplay(v) : v),
      n: f.filter((y) => y.trustee === v).length,
    })));
    MF_RTY.setAllLabel(TT('全部种类'));
    MF_RTR.setAllLabel(TT('全部受托人'));
    fillScheme();
    buildSubRisk();
  }

  /* 细类 / 风险级别：选项也由数据生成，语言切换时必须重建（原来只建一次，会停留在旧语言） */
  function buildSubRisk() {
    ensureMF();
    const pool = DATA.funds.filter((x) => !S.type.length || S.type.indexOf(x.type) >= 0);
    const vals = [...new Set(pool.map((x) => x.subtype).filter(Boolean))].sort();
    if (MF_RS) {
      MF_RS.setOptions(vals.map((v) => ({ v, label: typeLabel(v) })));
      MF_RS.setAllLabel(TT('全部细类'));
    }
    const valid = new Set(vals);
    S.sub = S.sub.filter((v) => valid.has(v));
    if (MF_RS) MF_RS.setSelected(S.sub, true);
    const rk = document.querySelector('#rkRRisk');
    if (rk) {
      const cur = rk.value;
      rk.innerHTML = '<option value="">' + TT('全部级别') + '</option>';
      [...new Set(DATA.funds.map((x) => x.risk).filter((v) => v != null))].sort((a, b) => a - b).forEach((v) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v + ' ' + TT('级');
        rk.appendChild(o);
      });
      if (cur) rk.value = cur;
    }
  }

  /* 选项文案：类别走 typeLabel（繁/简/英三态），其余数据值简体模式下繁转简 */
  function optText(v, isType) {
    const raw = isType ? typeLabel(v) : v;
    return (document.documentElement.lang === 'zh-Hans' && window.t2s) ? window.t2s(raw) : raw;
  }

  function fill(sel, arr, fmt) {
    const el = $(sel);
    const cur = el.value;
    const first = el.options[0];
    const key = el.dataset.allKey || (first && first.getAttribute('data-i18n')) || (first ? first.textContent : '');
    el.dataset.allKey = key;
    el.innerHTML = '<option value="">' + TT(key) + '</option>';
    arr.sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
    arr.forEach((v) => {
      const o = document.createElement('option'); o.value = v;
      o.textContent = (typeof fmt === 'function') ? fmt(v) : optText(v, !!fmt);
      el.appendChild(o);
    });
    if (arr.indexOf(cur) >= 0) el.value = cur;
  }

  function buildMobileSort() {
    const keys = { ann1: '近1年年率化', ann5: '近5年年率化', ann10: '近10年年率化', annLaunch: '推出至今年率化', worstYear: '近5年最差年度', mgmtFee: '基金管理费', size: '基金规模', risk: '风险级别', nav: '单位资产净值', calYear: '历年回报' };
    const el = $('#rkMSortKey');
    /* 2026-11-26：默认「积金局官方序号」，与未排序时的官方顺序一致 */
    el.innerHTML = '<option value="">' + TT('积金局官方序号') + '</option>' +
      Object.keys(keys).map((k) => '<option value="' + k + '">' + TT(keys[k]) + '</option>').join('');
    el.addEventListener('change', () => {
      if (!el.value) { S.sortKey = null; S.sortDir = null; render(); syncRkUrl(); return; }
      S.sortKey = el.value; S.sortDir = 'desc'; render(); syncRkUrl();
    });
    $('#rkMSortDir').addEventListener('click', () => {
      S.sortDir = flip(S.sortDir || 'desc');
      $('#rkMSortDir').textContent = S.sortDir === 'asc' ? '升序 ↑' : '降序 ↓';
      render(); syncRkUrl();
    });
  }

  function bind() {
    $('#rkRTop').addEventListener('change', () => { S.top = parseInt($('#rkRTop').value, 10); S.page = 1; render(); syncRkUrl(); });
    var kwEl = document.querySelector('#rkKw');
    if (kwEl) kwEl.addEventListener('input', function () { S.kw = this.value.trim(); render(); syncRkUrl(); });

    /* 2026-10-19：排名页筛选卡与第一页对齐（细类 / 风险 / 涨跌幅 / 回撤 / 管理费） */
    (function bindRankFilters() {
      const setK = (id, key, isNum) => {
        const el = document.querySelector(id);
        if (!el) return;
        el.addEventListener('input', function () {
          S[key] = isNum ? (this.value === '' ? '' : this.value) : this.value;
          render();
        });
        el.addEventListener('change', function () {
          S[key] = isNum ? (this.value === '' ? '' : this.value) : this.value;
          render(); syncRkUrl();
        });
      };
      setK('#rkRRisk', 'risk');
      setK('#rkRRetDim', 'retDim'); setK('#rkRRetMin', 'retMin', 1); setK('#rkRRetMax', 'retMax', 1);
      setK('#rkRDdMin', 'ddMin', 1); setK('#rkRDdMax', 'ddMax', 1); setK('#rkRFeeMax', 'feeMax', 1);

      /* 细类选项由 buildSubRisk 的 MPFMulti 负责；风险级别仍是原生 select */
      const rk = document.querySelector('#rkRRisk');
      if (rk && rk.options.length <= 1) {
        [...new Set(DATA.funds.map((x) => x.risk).filter((v) => v != null))].sort((a, b) => a - b).forEach((v) => {
          const o = document.createElement('option'); o.value = v; o.textContent = v + ' ' + TT('级'); rk.appendChild(o);
        });
      }
      const rst = document.querySelector('#rkRReset');
      if (rst) rst.addEventListener('click', () => {
        Object.assign(S, { type: [], sub: [], risk: '', trustee: [], kw: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '' });
        if (MF_RTY) { MF_RTY.setSelected([], true); MF_RS.setSelected([], true); MF_RTR.setSelected([], true); }
        document.querySelectorAll('#rkKW,#rkKw,#rkRType,#rkRSub,#rkRTrustee,#rkRRisk,#rkRRetMin,#rkRRetMax,#rkRDdMin,#rkRDdMax,#rkRFeeMax').forEach((el) => {
          if (el.tagName === 'INPUT') el.value = ''; else if (el.options) el.selectedIndex = 0;
        });
        render(); syncRkUrl();
      });
    })();
    const re = $('#rkRExport');
    if (re) re.addEventListener('click', exportCurrent);
  }

  /* 2026-11-02（第二十二轮）：本页筛选后的基础集合（不含榜单指标过滤）。
     估值日分布卡片用它统计，点「宏利」后就不会再显示全市场的 364 条。 */
  function baseFiltered() {
    let arr = DATA.funds.filter((x) => {
      if (S.type.length && S.type.indexOf(x.type) < 0) return false;
      if (S.sub.length && S.sub.indexOf(x.subtype) < 0) return false;
      if (S.trustee.length && S.trustee.indexOf(x.trustee) < 0) return false;
      if (S.scheme.length && S.scheme.indexOf(x.scheme) < 0) return false;
      if (S.risk !== '' && String(x.risk) !== String(S.risk)) return false;
      if (S.retMin !== '' && !(x[S.retDim] != null && x[S.retDim] >= parseFloat(S.retMin))) return false;
      if (S.retMax !== '' && !(x[S.retDim] != null && x[S.retDim] <= parseFloat(S.retMax))) return false;
      if (S.ddMin !== '' && !(x.worstYear != null && x.worstYear >= parseFloat(S.ddMin))) return false;
      if (S.ddMax !== '' && !(x.worstYear != null && x.worstYear <= parseFloat(S.ddMax))) return false;
      if (S.feeMax !== '' && !(x.mgmtFee != null && x.mgmtFee <= parseFloat(S.feeMax))) return false;
      return true;
    });
    if (S.kw) {
      const k = S.kw.toLowerCase();
      const hit = (x) => [x.fund, x.fundBase, x.scheme, x.trustee].some((v) => v && String(v).toLowerCase().indexOf(k) >= 0);
      arr = arr.filter(hit);
    }
    return arr;
  }
  window.__rkScopeFunds = baseFiltered;

  /* 2026-11-26（领导要求）：积金局官网表格是「382 个成分基金」，本站数据按单位类别存了 451 条。
     这里按「受托人 + 计划 + 基金主名 + 基金类别」归并成 382 行，顺序沿用官网顺序（即数据原序），
     代表行取规模最大的单位类别；各单位的净值等仍保留在 units 中供导出/详情使用。 */
  function mergeOfficial(arr) {
    const seen = new Map();
    arr.forEach((x) => {
      const k = [x.trustee, x.scheme, x.fundBase, x.typeFull].join('||');
      if (!seen.has(k)) seen.set(k, { rep: x, size: x.size || 0, units: [] });
      const g = seen.get(k);
      g.units.push(x);
      if ((x.size || 0) > g.size) { g.rep = x; g.size = x.size || 0; }
    });
    const out = [];
    seen.forEach((g) => {
      const rep0 = g.rep;
      const units = g.units.slice();
      out.push(Object.assign({}, rep0, {
        fund: rep0.fundBase,
        unitN: units.length,
        unitList: units.map((u) => u.unit || '—'),
        unitLabel: units.map((u) => (u.unit ? '單位' + u.unit : '—')).join(' / '),
        groupSize: units.length,
        units: units,
      }));
    });
    return out;
  }

  function pool() {
    const b = cur();
    let arr = baseFiltered();
    if (b.id === 'calYear') {
      // 注入该年历年回报为顶层字段，便于排序与展示
      return arr
        .map((x) => Object.assign({}, x, { calYear: x.cal && x.cal[S.calYear] != null ? x.cal[S.calYear] : null }))
        .filter((x) => x.calYear != null);
    }
    if (b.agg === 'trustee') return aggByTrustee(arr);
    if (b.agg === 'subtype') return championBySubtype(arr);
    /* 自算榜：合并 /api/navperf 的全部自算指标（日/周/月/年初至今/1年/3年/5年/回撤），完全不依赖积金局 */
    if (b.self) {
      const pf = (PERFD && PERFD.funds) || {};
      return arr
        .filter((x) => {
          const p = pf[String(x.id)];
          return p && (p.d1 != null || p.w1 != null || p.y1 != null || p.ytd != null);
        })
        .map((x) => {
          const p = pf[String(x.id)];
          return Object.assign({}, x, {
            selfD1: p.d1 != null ? p.d1 : null,
            selfW1: p.w1 != null ? p.w1 : null,
            selfM1: p.m1 != null ? p.m1 : null,
            selfYtd: p.ytd != null ? p.ytd : null,
            selfY1: p.y1 != null ? p.y1 : null,
            selfY3a: p.y3a != null ? p.y3a : null,
            selfY5a: p.y5a != null ? p.y5a : null,
            selfMdd: p.mdd1 != null ? p.mdd1 : (p.mdd != null ? p.mdd : null),
            selfMdd5: p.mdd5 != null ? p.mdd5 : null,
            selfAsOf: p.asOf || '',
          });
        });
    }
    /* 2026-11-26：未选榜（积金局表格）＝按官网顺序归并为 382 个成分基金 */
    if (b.metric == null && !S.board) return mergeOfficial(arr);
    if (b.metric == null) return arr;
    return arr.filter((x) => x[b.metric] != null);
  }

  /** 发行人实力榜：按受托人聚合旗下成分基金，计算平均回报与总规模（仅用已有官方数值求算术平均，不做任何推算） */
  function aggByTrustee(arr) {
    const g = {};
    arr.forEach((x) => { (g[x.trustee] = g[x.trustee] || []).push(x); });
    const avg = (list, k) => {
      const v = list.map((x) => x[k]).filter((n) => n != null && !Number.isNaN(n));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return Object.keys(g).map((t) => {
      const list = g[t];
      return {
        id: 'AGG::' + t,
        aggTrustee: true,
        fund: t,
        trustee: t,
        type: '—',
        subtype: '',
        count: list.length,
        sizeSum: list.reduce((a, x) => a + (x.size || 0), 0),
        size: list.reduce((a, x) => a + (x.size || 0), 0),
        ann1Avg: avg(list, 'ann1'),
        ann5Avg: avg(list, 'ann5'),
        ann10Avg: avg(list, 'ann10'),
        annLaunchAvg: avg(list, 'annLaunch'),
        navOk: list.filter((x) => x.navStatus === 'verified').length,
        navTotal: list.length,
        risk: null,
        mgmtFee: avg(list, 'mgmtFee'),
      };
    });
  }

  /** 各细类冠军榜：每个基金细类各取其近 1 年回报最高的一只 */
  function championBySubtype(arr) {
    const g = {};
    arr.forEach((x) => {
      if (x.ann1 == null) return;
      const k = x.subtype || x.type;
      const best = g[k];
      if (!best || x.ann1 > best.ann1) g[k] = x;
    });
    return Object.keys(g).map((k) => g[k]);
  }

  /* 2026-10-20：榜单页补「已选条件 / 未设置筛选条件」说明行，与「基金最新数据」一致 */
  function renderRankChips() {
    const box = document.querySelector('#rkRChips');
    if (!box) return;
    const c = [];
    if (S.kw) c.push([TQ('关键词：{v}', { v: S.kw }), 'kw']);
    if (S.type.length) c.push([TQ('种类：{v}', { v: S.type.map((v) => typeLabel(v)).join('、') }), 'type']);
    if (S.sub.length) c.push([TQ('细类：{v}', { v: S.sub.map((v) => typeLabel(v)).join('、') }), 'sub']);
    if (S.trustee.length) c.push([TQ('受托人：{v}', { v: S.trustee.map((v) => (window.trusteeDisplay ? window.trusteeDisplay(v) : v)).join('、') }), 'trustee']);
    if (S.risk !== '' && S.risk != null) c.push([TQ('风险：{v}', { v: S.risk }), 'risk']);
    if (S.retMin !== '' || S.retMax !== '') {
      const dim = document.querySelector('#rkRRetDim');
      const dn = dim && dim.selectedIndex >= 0 ? dim.options[dim.selectedIndex].textContent : TT('涨跌幅');
      c.push([dn + '：' + (S.retMin || TT('不限')) + ' ~ ' + (S.retMax || TT('不限')), 'ret']);
    }
    if (S.ddMin !== '' || S.ddMax !== '') c.push([TQ('最大回撤(近5年)：{a} ~ {b}', { a: S.ddMin || TT('不限'), b: S.ddMax || TT('不限') }), 'dd']);
    if (S.feeMax !== '') c.push([TQ('管理费 ≤ {v}%', { v: S.feeMax }), 'fee']);
    box.innerHTML = c.length
      ? '<span class="muted" style="font-size:12px">' + TT('已选条件：') + '</span>' +
        c.map((x) => '<span class="chip">' + esc(x[0]) + '<span class="x" data-rc="' + x[1] + '">×</span></span>').join('')
      : '<span class="muted" style="font-size:12px">' + TT('未设置筛选条件，当前显示全市场基金') + '</span>';
    box.querySelectorAll('.x').forEach((el) => el.addEventListener('click', () => {
      const k = el.dataset.rc;
      if (k === 'kw') { S.kw = ''; const i = document.querySelector('#rkKw'); if (i) i.value = ''; }
      else if (k === 'type') { S.type = []; if (MF_RTY) MF_RTY.setSelected([], true); }
      else if (k === 'sub') { S.sub = []; if (MF_RS) MF_RS.setSelected([], true); }
      else if (k === 'trustee') { S.trustee = []; if (MF_RTR) MF_RTR.setSelected([], true); }
      else if (k === 'risk') { S.risk = ''; const i = document.querySelector('#rkRRisk'); if (i) i.selectedIndex = 0; }
      else if (k === 'ret') { S.retMin = S.retMax = ''; ['#rkRRetMin', '#rkRRetMax'].forEach((q) => { const i = document.querySelector(q); if (i) i.value = ''; }); }
      else if (k === 'dd') { S.ddMin = S.ddMax = ''; ['#rkRDdMin', '#rkRDdMax'].forEach((q) => { const i = document.querySelector(q); if (i) i.value = ''; }); }
      else if (k === 'fee') { S.feeMax = ''; const i = document.querySelector('#rkRFeeMax'); if (i) i.value = ''; }
      render();
    }));
  }

  /* ═══ 2026-10-26 重做：列顺序数组单源（修复表头/表体错位）═══
     thead 与 tbody 由同一个可见列顺序数组生成；维度联动=改数组而非移动 DOM。 */
  /* 2026-11-26（用户要求）：同一成分基金有多个单位类别时，鼠标悬浮名称即可看到
     各类别的最新净值，不必再进详情页逐只切换。 */
  function unitsTip(x) {
    if (!x || !x.units || x.units.length < 2) return '';
    return x.units.map((u) => (u.unit ? String(u.unit) : '—') + '：' +
      (u.nav == null ? TT('无净值') : nf(u.nav, 4)) + '（' + (u.navAsOf || '—') + '）').join(' · ');
  }

  const CELL_FUND = {
    rank: (x, medal, rk) => '<td data-c="rank" class="c" data-l="' + TT('序号') + '">' + medal + '</td>',
    fund: (x) => '<td data-c="fund" class="f-main fz" data-l="' + TT('基金名称') + '"><div class="fund-name"' +
      (unitsTip(x) ? ' data-tip="' + esc(unitsTip(x)) + '"' : '') + '>' + esc(fundFullName(x)) + '</div></td>',   /* 2026-10-31 四版：名称下的对比横线一并删除（用户不需要） */
    scheme: (x) => '<td data-c="scheme" data-l="' + TT('计划名称') + '" class="fz"><div>' + esc(x.scheme || '—') + '</div>' +
      (x.groupSize > 1 ? '<div class="cell-sub">' + TQ('{n} 个单位类别', { n: x.groupSize }) + '</div>' : '') + '</td>',
    unit: (x) => '<td data-c="unit" data-l="' + TT('单位类别') + '" class="c"' +
      (unitsTip(x) ? ' data-tip="' + esc(unitsTip(x)) + '"' : '') + '>' +
      esc(x.unitN > 1 ? x.unitList.join(' / ') : (x.unit || '—')) + '</td>',
    nav: (x) => '<td data-c="nav" data-l="' + TT('单位资产净值') + '" class="r num">' + (x.nav == null ? '—' : esc(String(x.nav))) + '</td>',
    trustee: (x) => '<td data-c="trustee" data-l="' + TT('受托人') + '"><span class="tag">' + esc(trusteeDisplay(x.trustee)) + '</span></td>',
    /* 2026-11-02：细类不再占第二行（会让整行高出一大截）——收进悬浮说明，行高与资料库一致 */
    type: (x) => '<td data-c="type" data-l="' + TT('基金种类') + '"><span class="tag g"' + (x.subtype ? ' data-tip="' + esc(TQ('细类：{s}', { s: typeLabel(x.subtype) })) + '"' : '') + '>' + esc(typeLabel(x.type)) + '</span></td>',
    /* 2026-11-19（用户反馈）：积金局表补「基金细类」列（此前只塞在种类列的浮层里） */
    sub: (x) => '<td data-c="sub" data-l="' + TT('基金细类') + '" class="fz">' + esc(x.subtype ? typeLabel(x.subtype) : '—') + '</td>',
    risk: (x) => '<td data-c="risk" data-l="' + TT('风险级别') + '" class="c">' + riskTag(x.risk) + '</td>',
    ann1: (x) => '<td data-c="ann1" data-l="' + TT('近1年年率化') + '" class="r num ' + cls(x.ann1) + '">' + pct(x.ann1) + '</td>',
    ann5: (x) => '<td data-c="ann5" data-l="' + TT('近5年年率化') + '" class="r num ' + cls(x.ann5) + '">' + pct(x.ann5) + '</td>',
    ann10: (x) => '<td data-c="ann10" data-l="' + TT('近10年年率化') + '" class="r num ' + cls(x.ann10) + '">' + pct(x.ann10) + '</td>',
    annLaunch: (x) => '<td data-c="annLaunch" data-l="' + TT('推出至今年率化') + '" class="r num ' + cls(x.annLaunch) + '">' + pct(x.annLaunch) + '</td>',
    size: (x) => '<td data-c="size" data-l="' + TQ('基金规模（{u}）', { u: TT('百万港元') }) + '" class="r num">' + nf(x.size, 2) + '</td>',
    worstYear: (x) => '<td data-c="worstYear" data-l="' + TT('近5年最差年度') + '" class="r num ' + cls(x.worstYear) + '">' + pct(x.worstYear) + '</td>',
    fer: (x) => '<td data-c="fer" data-l="' + TT('总开支比率') + '" class="r num">' + (x.fer == null ? '—' : x.fer.toFixed(2) + '%') + '</td>',
    launchTs: (x) => '<td data-c="launchTs" data-l="' + TT('推出日期') + '" class="num">' + esc(x.launch || '—') + '</td>',
    mgmtFee: (x) => '<td data-c="mgmtFee" data-l="' + TT('基金管理费 %') + '" class="r num">' + feeText(x.mgmtFee, x.feeMore && x.feeMore.mgmtFee) + '</td>',
    calYear: (x) => '<td data-c="calYear" data-l="' + TQ('{y} 年回报', { y: S.calYear }) + '" class="r num ' + cls(window.__rkIsCal ? x.calYear : null) + '">' + (window.__rkIsCal ? '<b>' + pct(x.calYear) + '</b>' : '') + '</td>',
    cum1: (x) => '<td data-c="cum1" data-l="' + TT('近1年累积') + '" class="r num o-cum ' + cls(x.cum1) + '">' + pct(x.cum1) + '</td>',
    cum5: (x) => '<td data-c="cum5" data-l="' + TT('近5年累积') + '" class="r num o-cum ' + cls(x.cum5) + '">' + pct(x.cum5) + '</td>',
    cum10: (x) => '<td data-c="cum10" data-l="' + TT('近10年累积') + '" class="r num o-cum ' + cls(x.cum10) + '">' + pct(x.cum10) + '</td>',
    cumLaunch: (x) => '<td data-c="cumLaunch" data-l="' + TT('推出至今累积') + '" class="r num o-cum ' + cls(x.cumLaunch) + '">' + pct(x.cumLaunch) + '</td>',
    cal2021: (x) => calCell(x, '2021'), cal2022: (x) => calCell(x, '2022'), cal2023: (x) => calCell(x, '2023'),
    cal2024: (x) => calCell(x, '2024'), cal2025: (x) => calCell(x, '2025'),
    /* 2026-11-22：无日度净值历史的基金不占对比名额（画不出线） */
    cmp: (x) => (x && x.navStatus === 'verified' && x.nav != null)
      ? '<td data-c="cmp" data-l="' + TT('对比') + '" class="c"><input type="checkbox" data-cmp="' + esc(x.id) + '"' + (CMPX.has(x.id) ? ' checked' : '') + '></td>'
      : '<td data-c="cmp" data-l="' + TT('对比') + '" class="c"><span class="risk-na" title="' + esc(TT('该基金暂无日度净值历史，无法加入对比')) + '">—</span></td>',
    ops: (x) => '<td data-c="ops" data-l="' + TT('详情') + '" class="c"><button class="btn-detail" onclick="openDetail(\'' + esc(x.id) + '\')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
      TT('详情') + '</button></td>',
  };
  function calCell(x, y) {
    const v = x.cal && x.cal[y] != null ? x.cal[y] : null;
    return '<td data-c="cal' + y + '" data-l="' + y + '" class="r num o-cal ' + cls(v) + '">' + pct(v) + '</td>';
  }
  const TH_FUND = {
    rank: '<th scope="col" data-c="rank" data-i18n-parts class="c" style="width:56px">序号</th>',
    fund: '<th scope="col" data-c="fund" data-i18n-parts class="f-main fz">基金名称</th>',
    scheme: '<th scope="col" data-c="scheme" data-i18n-parts>计划名称</th>',
    trustee: '<th scope="col" data-c="trustee" data-i18n-parts>受托人</th>',
    unit: '<th scope="col" data-c="unit" data-i18n-parts>单位类别</th>',
    nav: '<th scope="col" data-c="nav" data-i18n-parts>单位资产净值</th>',
    type: '<th scope="col" data-c="type" data-i18n-parts>基金种类</th>',
    sub: '<th scope="col" data-c="sub" data-i18n-parts>基金细类</th>',
    risk: '<th scope="col" data-c="risk" data-i18n-parts data-k="risk" data-defdir="asc" class="sortable c">风险<br>级别 <span class="arrow">↕</span></th>',
    ann1: '<th scope="col" data-c="ann1" data-i18n-parts data-k="ann1" data-defdir="desc" class="sortable r">近1年<br>年率化 <span class="arrow">↕</span></th>',
    ann5: '<th scope="col" data-c="ann5" data-i18n-parts data-k="ann5" data-defdir="desc" class="sortable r">近5年<br>年率化 <span class="arrow">↕</span></th>',
    ann10: '<th scope="col" data-c="ann10" data-i18n-parts data-k="ann10" data-defdir="desc" class="sortable r">近10年<br>年率化 <span class="arrow">↕</span></th>',
    annLaunch: '<th scope="col" data-c="annLaunch" data-i18n-parts data-k="annLaunch" data-defdir="desc" class="sortable r">推出至今<br>年率化 <span class="arrow">↕</span></th>',
    size: '<th scope="col" data-c="size" data-i18n-parts data-k="size" data-defdir="desc" class="sortable r">基金规模<br><small>百万港元</small> <span class="arrow">↕</span></th>',
    worstYear: '<th scope="col" data-c="worstYear" data-i18n-parts data-k="worstYear" data-defdir="desc" class="sortable r">近5年<br><small>最差年度</small> <span class="arrow">↕</span></th>',
    fer: '<th scope="col" data-c="fer" data-i18n-parts data-k="fer" data-defdir="asc" class="sortable r">总开支比率<br><small>% p.a.</small> <span class="arrow">↕</span></th>',
    launchTs: '<th scope="col" data-c="launchTs" data-i18n-parts data-k="launchTs" data-defdir="desc" class="sortable">推出日期 <span class="arrow">↕</span></th>',
    mgmtFee: '<th scope="col" data-c="mgmtFee" data-i18n-parts data-k="mgmtFee" data-defdir="asc" class="sortable r">管理费<br><small>% p.a.</small> <span class="arrow">↕</span></th>',
    calYear: '<th scope="col" data-c="calYear" data-i18n-parts id="rkThCalYear" data-k="calYear" data-defdir="desc" class="sortable r">历年<br>回报 <span class="arrow">↕</span></th>',
    cum1: '<th scope="col" data-c="cum1" data-i18n-parts data-k="cum1" data-defdir="desc" class="sortable r o-cum">近1年<br>累积 <span class="arrow">↕</span></th>',
    cum5: '<th scope="col" data-c="cum5" data-i18n-parts data-k="cum5" data-defdir="desc" class="sortable r o-cum">近5年<br>累积 <span class="arrow">↕</span></th>',
    cum10: '<th scope="col" data-c="cum10" data-i18n-parts data-k="cum10" data-defdir="desc" class="sortable r o-cum">近10年<br>累积 <span class="arrow">↕</span></th>',
    cumLaunch: '<th scope="col" data-c="cumLaunch" data-i18n-parts data-k="cumLaunch" data-defdir="desc" class="sortable r o-cum">推出至今<br>累积 <span class="arrow">↕</span></th>',
    cal2021: '<th scope="col" data-c="cal2021" data-i18n-parts data-k="cal2021" data-defdir="desc" class="sortable r o-cal">2021 <span class="arrow">↕</span></th>',
    cal2022: '<th scope="col" data-c="cal2022" data-i18n-parts data-k="cal2022" data-defdir="desc" class="sortable r o-cal">2022 <span class="arrow">↕</span></th>',
    cal2023: '<th scope="col" data-c="cal2023" data-i18n-parts data-k="cal2023" data-defdir="desc" class="sortable r o-cal">2023 <span class="arrow">↕</span></th>',
    cal2024: '<th scope="col" data-c="cal2024" data-i18n-parts data-k="cal2024" data-defdir="desc" class="sortable r o-cal">2024 <span class="arrow">↕</span></th>',
    cal2025: '<th scope="col" data-c="cal2025" data-i18n-parts data-k="cal2025" data-defdir="desc" class="sortable r o-cal">2025 <span class="arrow">↕</span></th>',
    cmp: '<th scope="col" data-c="cmp" data-i18n-parts class="c">对比</th>',
    ops: '<th scope="col" data-c="ops" data-i18n-parts class="c">详情</th>',
  };

  /* 可见列顺序：由列设置闭包实现（它掌握 FUND 定义与 off 隐藏集合），这里只做委派。
     兜底顺序用于列设置模块尚未初始化完成的极早期渲染。 */
  const FUND_FALLBACK = ['rank', 'fund', 'trustee', 'type', 'risk',
    'ann1', 'ann5', 'ann10', 'annLaunch', 'size', 'cmp', 'ops'];
  function rkVisibleOrder() {
    if (RK_ORDER_IMPL) return RK_ORDER_IMPL();
    return FUND_FALLBACK.filter((k) => k !== 'trustee' && k !== 'type');
  }

  function render() {
    /* 2026-11-02（第二十轮）：筛选条件或每页条数变化时自动回到第 1 页 */
    const _fsig = [S.board, S.type, S.sub, S.trustee, S.risk, S.kw, S.retDim, S.retMin, S.retMax,
      S.ddMin, S.ddMax, S.feeMax, S.calYear, S.top].join('|');
    if (render._sig !== _fsig) { render._sig = _fsig; S.page = 1; }
    const b = cur();
    const isCal = b.id === 'calYear';
    $('#rkLoading').style.display = 'none';
    $('#rkBoardTitle').textContent = isCal ? TQ('{y} 年回报榜', { y: S.calYear }) : TT(b.name);
    $('#rkBoardDesc').textContent =
      (isCal ? TQ('按积金局「曆年回報」列，{y} 年单年回报由高至低排名', { y: S.calYear }) : TT(b.desc)) + ' · ' +
      (b.self
        ? TQ('数据截至各发行人官网最新净值日（已接入 {n} 只）', { n: PERFD && PERFD.funds ? Object.keys(PERFD.funds).length : 0 })
        : TT('数据截至积金局最新公布'));
    const rkOrder = applyHeader(b, isCal);   /* fund 模式返回可见列顺序（表头已同步注入） */
    renderRankChips();
    const thCal = $('#rkThCalYear');
    if (isCal && thCal && thCal.firstChild) thCal.firstChild.textContent = TQ('{y} 年', { y: S.calYear });
    $('#rkYearSwitch').style.display = isCal ? '' : 'none';

    // 排名主榜
    const ranked = sortRows(pool(), b.metric || null, b.metric ? b.dir : null);   /* 名次/冠军口径 */
    window.__rkRanked = ranked;   /* 2026-10-26：行内对比条需要全榜最大值（CELL_FUND 在模块作用域） */
    // 分类冠军（当前筛选下，按当前榜单指标）；区块标题随榜单类型切换（发行人榜 ≠ 各类别冠军）
    const chT = $('#rkChampTitle'), chD = $('#rkChampDesc');
    const noBoard = !S.board;
    const champCard = $('#rkChampCard');
    if (champCard) champCard.style.display = noBoard ? 'none' : '';
    if (chT) chT.textContent = b.agg === 'trustee' ? TT('发行人综合表现') : TT('各类别冠军');
    if (chD) chD.textContent = b.agg === 'trustee'
      ? TT('按发行人聚合旗下成分基金，平均表现由高至低')
      : TT('按当前排名指标，各基金种类中表现最好的基金');
    if (b.agg === 'trustee') renderAggChampions(ranked);
    else renderChampions(ranked, b);

    // 表格：若用户手动点了其他列排序，则按用户排序；否则按榜单指标；
    // 2026-10-31 四版：无榜（全部基金）时默认按近 1 年年率化降序（S.sortKey 为 null → 无高亮）
    const key = S.sortKey || b.metric || null;
    const dir = key ? (S.sortDir || (b.metric ? b.dir : 'desc')) : null;
    let rows = key ? sortRows(pool(), key, dir) : pool();
    const total = rows.length;
    /* 2026-11-02（第二十轮，用户要求）：与「基金最新数据」同款分页（每页 N 条 + 页码） */
    const psize = Math.max(1, S.top);
    const pages = Math.max(1, Math.ceil(total / psize));
    if (S.page > pages) S.page = pages;
    if (S.page < 1) S.page = 1;
    const st = (S.page - 1) * psize;
    const shown = rows.slice(st, st + psize);
    $('#rkRcnt').textContent = total;
    $('#rkRcntUnit').textContent = b.agg === 'trustee' ? TT('家受托人') : TT('条');
    $('#rkRtip').textContent = shown.length < total
      ? (noBoard ? TQ('（显示前 {n} 条）', { n: shown.length }) : TQ('（显示前 {n} 名）', { n: shown.length }))
      : TT('（全部显示）');

    // 名次列始终按榜单指标计算
    const rankMap = {};
    ranked.forEach((x, i) => { rankMap[x.id] = i + 1; });

    $('#rkTbody').innerHTML = shown.length ? shown.map((x, i) => {
      const rk = rankMap[x.id];
      /* 2026-11-26：积金局表格第一列是「序号」——按官网顺序 1…382，不是榜单名次，也不加奖牌 */
      const medal = noBoard
        ? '<span class="rank-cell">' + (st + i + 1) + '</span>'
        : (rk <= 3 ? '<span class="medal g' + rk + '">' + rk + '</span>' : '<span class="rank-cell">' + rk + '</span>');
      if (x.aggTrustee) return aggRowHtml(x, b, medal, rankMap[x.id], shown);
      const mv = x[b.metric];
      const share = maxBar(shown, b.metric, x);
      return '<tr>' +
        (b.self
          ? /* 自算榜行：固定前段（与 selfHead 对齐） */
            '<td class="c" data-l="' + TT('序号') + '">' + medal + '</td>' +
            '<td class="f-main fz" data-l="' + TT('基金名称') + '"><div class="fund-name">' + esc(fundFullName(x)) + '</div>' +
              (x.groupSize > 1 ? '<div class="cell-sub">' + TQ('{n} 个单位类别', { n: x.groupSize }) + '</div>' : '') +
              barHTML(b, x, ranked) + '</td>' +
            '<td data-l="' + TT('受托人') + '"><span class="tag">' + esc(trusteeDisplay(x.trustee)) + '</span></td>' +
            '<td data-l="' + TT('基金种类') + '"><span class="tag g"' + (x.subtype ? ' data-tip="' + esc(TQ('细类：{s}', { s: typeLabel(x.subtype) })) + '"' : '') + '>' + esc(typeLabel(x.type)) + '</span></td>' +
            '<td data-l="' + TT('风险级别') + '" class="c">' + riskTag(x.risk) + '</td>' +
            '<td data-l="' + TQ('基金规模（{u}）', { u: TT('百万港元') }) + '" class="r num">' + nf(x.size, 2) + '</td>' +
            SELF_COLS.map(([k, n]) =>
              k === 'selfMdd' || k === 'selfMdd5'
                ? '<td data-l="' + TT(n) + '" class="r num down">' + pct(x[k]) + '</td>'
                : '<td data-l="' + TT(n) + '" class="r num ' + cls(x[k]) + '">' + pct(x[k]) + '</td>').join('') +
            ((x && x.navStatus === 'verified' && x.nav != null)
              ? '<td data-l="' + TT('对比') + '" class="c"><input type="checkbox" data-cmp="' + esc(x.id) + '"' + (CMPX.has(x.id) ? ' checked' : '') + '></td>'
              : '<td data-l="' + TT('对比') + '" class="c"><span class="risk-na" title="' + esc(TT('该基金暂无日度净值历史，无法加入对比')) + '">—</span></td>') +
            '<td data-l="' + TT('详情') + '" class="c"><button class="btn-detail" onclick="openDetail(\'' + esc(x.id) + '\')">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
              TT('详情') + '</button></td>'
          : /* 基金榜行：按可见列顺序数组渲染（表头/表体同源，物理上不会错位） */
            rkOrder.map((k) => CELL_FUND[k](x, medal, rk)).join('')
        ) + '</tr>';
    }).join('') : '<tr><td colspan="' + (b.self ? 17 : (rkOrder || []).length || 13) + '"><div class="empty">' + TT('当前条件下没有可排名的基金') + '</div></td></tr>';

    $$('#rkTbody input[data-cmp]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) { if (!CMPX.add(c.dataset.cmp)) c.checked = false; } else CMPX.remove(c.dataset.cmp);
      renderCmpBar();
    }));

    /* 维度列高亮（2026-10-26）：高亮当前榜单对应的列；切换榜单/取消后自动清除。
       列的位置由 rkVisibleOrder 的数组决定，这里只加 class，不移动 DOM。
       2026-10-31 四版（用户要求）：未选任何榜单（全部基金、默认近1年序）时不高亮任何列。 */
    const tblEl = document.querySelector('#rkTable');
    if (tblEl) {
      tblEl.querySelectorAll('.dim-hl').forEach((n) => n.classList.remove('dim-hl'));
      const mk = (!b.agg && b.metric && S.board) ? b.metric : '';
      if (mk) {   /* 含「稳健低风险榜 / 历年回报榜」——维度本身就是该列时也高亮 */
        tblEl.querySelectorAll('#rkThead [data-c="' + mk + '"], #rkTbody [data-c="' + mk + '"]')
          .forEach((n) => n.classList.add('dim-hl'));
      }
    }

    /* 2026-10-31 四版（用户要求）：无榜默认按近1年年率化排序，但该列【不高亮】——
       高亮只跟随用户手动点选的列（S.sortKey），默认序仅体现在行顺序上 */
    syncHeader(S.sortKey, S.sortKey ? S.sortDir : null);
    renderPager(pages, total);
    /* 2026-11-02：估值日分布跟随本页筛选条件 */
    if (window.renderNavDistCard) window.renderNavDistCard();
    if (window.__syncTableScroll) window.__syncTableScroll();
  }

  /* 与 app.js 的 pager 完全同一套样式与文案（照抄基金最新数据的表格分页） */
  function renderPager(pages, total) {
    const box = document.getElementById('rkPager');
    if (!box) return;
    if (pages <= 1) {
      box.innerHTML = total ? '<span class="info">' + TQ('共 {n} 条', { n: total }) + '</span>' : '';
      return;
    }
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
    box.innerHTML = h;
    box.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p2 = parseInt(b.dataset.p, 10);
      if (p2 >= 1 && p2 <= pages) { S.page = p2; render(); window.scrollTo({ top: 220, behavior: 'smooth' }); }
    }));
  }

  /** 发行人实力榜的聚合行（列结构与基金榜不同，单独渲染） */
  function aggRowHtml(x, b, medal, rk, shown) {
    const share = maxBar(shown, b.metric, x);
    const rate = x.navTotal ? Math.round((x.navOk / x.navTotal) * 100) : 0;
    return '<tr data-agg="1">' +
      '<td class="c" data-l="' + TT('序号') + '">' + medal + '</td>' +
      '<td class="f-main fz" data-l="' + TT('受托人') + '"><div class="fund-name">' + esc(x.trustee) + '</div>' +
        '<div class="sub-line">' + TT('受托人／保荐人') + ' · ' + TQ('旗下 {n} 条成分基金', { n: x.count }) + '</div>' +
        '<div class="bar"><i style="left:0;width:' + share + '%;background:#1a6fb5"></i></div></td>' +
      '<td data-l="' + TT('成分基金数') + '" class="r num">' + nf(x.count, 0) + '</td>' +
      '<td data-l="' + TQ('总规模（{u}）', { u: TT('百万港元') }) + '" class="r num">' + nf(x.sizeSum, 2) + '</td>' +
      '<td data-l="' + TT('平均近1年年率化') + '" class="r num ' + cls(x.ann1Avg) + '"><b>' + pct(x.ann1Avg) + '</b></td>' +
      '<td data-l="' + TT('平均近5年年率化') + '" class="r num ' + cls(x.ann5Avg) + '">' + pct(x.ann5Avg) + '</td>' +
      '<td data-l="' + TT('平均近10年年率化') + '" class="r num ' + cls(x.ann10Avg) + '">' + pct(x.ann10Avg) + '</td>' +
      '<td data-l="' + TT('平均推出至今年率化') + '" class="r num ' + cls(x.annLaunchAvg) + '">' + pct(x.annLaunchAvg) + '</td>' +
      '<td data-l="' + TT('平均管理费 %') + '" class="r num">' + nf(x.mgmtFee, 2) + '</td>' +
      '<td data-l="' + TT('净值核实率') + '" class="r num" title="' + TT('已从该受托人官网核对到最新单位资产净值的基金数 / 旗下基金总数') + '">' +
        x.navOk + ' / ' + x.navTotal + '<div class="sub-line">' + rate + '%</div></td>' +
      '<td data-l="' + TT('详情') + '" class="c"><span class="muted" style="font-size:12px">—</span></td>' +
      '</tr>';
  }

  /* 回报类指标与全站其它榜单统一为「自左向右单向条」：以全榜最大绝对值为满格基准
     （数值最大者占满 100%，即第一名满格），不再有 0 值线、不反向；
     颜色用涨红跌绿（中国市场惯例）：正值红、负值绿（负值按绝对值折算长度）；
     非零极小值保底最小可见宽度，保证 -0.01% 这类值也能看到。
     其他指标（规模/费用/风险等）保持原有配色与逻辑。 */
  const RET_METRICS = { ann1: 1, ann5: 1, ann10: 1, annLaunch: 1, cum1: 1, cum5: 1, cum10: 1, cumLaunch: 1, worstYear: 1, calYear: 1,
    /* 2026-10-19：自算收益类也按「涨红跌绿」着色（回撤类不计入，保持中性） */
    selfD1: 1, selfW1: 1, selfM1: 1, selfYtd: 1, selfY1: 1, selfY3a: 1, selfY5a: 1 };
  const BAR_MINW = 1.5; // 非零值最小可见宽度（%）
  function barHTML(b, x, rows) {
    let share = parseFloat(maxBar(rows, b.metric, x));
    let col;
    if (RET_METRICS[b.metric]) {
      const v = x[b.metric] == null ? 0 : x[b.metric];
      col = v >= 0 ? 'var(--up)' : 'var(--down)';
      if (v !== 0 && share < BAR_MINW) share = BAR_MINW;
    } else {
      col = b.dir === 'asc' ? '#1a7a55' : '#1a6fb5';
    }
    return '<div class="bar"><i style="left:0;width:' + share.toFixed(1) + '%;background:' + col + '"></i></div>';
  }

  /** 导出当前榜单（当前筛选与排序下的全部结果，CSV；Excel 直接打开） */
  async function exportCurrent() {
    const b = cur();
    const isMpfa = !S.board;
    const src = pool();
    const key0 = S.sortKey || b.metric || null;
    /* 2026-11-26：积金局表格默认按官方序号导出（不排序时保持官网顺序） */
    const list = key0 ? sortRows(src, key0, S.sortDir || b.dir || 'desc') : src;
    if (b.self) {
      /* 自算榜导出：只输出官网净值口径的指标，不含积金局字段 */
      const sHead = [TT('序号'), TT('基金名称'), TT('单位类别'), TT('基金种类'), TT('计划'), TT('受托人'), TT('净值估值日')]
        .concat(SELF_COLS.map(([, n]) => TT(n)))
        .concat([TQ('基金规模（{u}）', { u: TT('百万港元') })]);
      const sBody = list.map((x, i) => [
        i + 1, x.fundBase || x.fund, x.unit || '',
        typeLabel(x.type) + (x.subtype ? ' / ' + typeLabel(x.subtype) : ''),
        x.scheme, x.trustee, x.selfAsOf || '',
      ].concat(SELF_COLS.map(([k]) => (x[k] == null ? '' : x[k])))
        .concat([x.size == null ? '' : x.size]));
      const d = (list.find((x) => x.selfAsOf) || {}).selfAsOf || DATA.dataAsOf || '';
      csvDownload(csvSourceNote({ self: true }).concat([sHead], sBody),
        'MPF排名_' + TT(b.name) + '_' + TT('数据截至') + '_' + d + '.csv');
      return;
    }
    const head = [TT('序号'), TT('基金名称'), TT('单位类别'), TT('基金种类'), TT('强积金计划'), TT('受托人'), TT('风险级别'),
      TT('单位资产净值'), TT('净值估值日'), TT('近1年年率化回报'), TT('近5年年率化回报'), TT('近10年年率化回报'),
      TT('推出至今年率化回报'), TQ('基金规模（{u}）', { u: TT('百万港元') }), TT('基金管理费 % p.a.'), TT('最近期基金开支比率'), TT('推出日期')];
    const cv = (v) => (((window.getLang && window.getLang() === 'zh-Hans') && window.t2s) ? window.t2s(String(v)) : String(v));
    const body = list.map((x, i) => [
      i + 1,
      cv(x.fundBase || x.fund),
      cv(x.unitN ? x.unitList.join(' / ') : (x.unit || '')),
      cv(typeLabel(x.type) + (x.subtype ? ' / ' + typeLabel(x.subtype) : '')),
      cv(x.scheme),
      cv(window.trusteeDisplay ? window.trusteeDisplay(x.trustee) : x.trustee),
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
    if (b.self) return;   /* 自算榜已在函数开头单独导出 */
    /* 2026-10-30（用户要求）：榜单导出升级 xlsx——Sheet1 榜单数据、Sheet2「持仓与分布」嵌玫瑰图；
       与走势页共用 buildHoldAllocSheet 公共函数（全站同一份代码）。 */
    if (!window.MPFXLSX) { if (window.mpfToast) mpfToast(_t('导出组件未加载，请刷新页面')); return; }
    const r1 = [
      { h: 26, cells: [{ v: TT(b.name) + '（积金局口径，含费含息）· 数据截至 ' + (DATA.dataAsOf || '') + ' · 共 ' + list.length + ' 条', s: 1 }] },
      { h: 30, cells: head.map((v) => ({ v, s: 2 })) },
    ].concat(body.map((row) => ({ cells: row.map((v) => ({ v: v, s: 4 })) })));
    const sheet2 = await window.buildHoldAllocSheet(list.map((x) => ({ id: String(x.id), name: x.fundBase || x.fund })), { chartLimit: 10, imgScale: 0.6 });
    const sheetName = (isMpfa ? TT('积金局基金列表') : TT(b.name)).replace(/[\\/:*?[\]]/g, '').slice(0, 28) || '榜单';

    /* 2026-11-26（用户要求）：积金局表格导出补「数据说明」首页，与「基金最新数据」导出同一套版式 */
    const unitTotal = list.reduce((n, x) => n + (x.unitN || 1), 0);
    const filterBits = [];
    if (S.kw) filterBits.push(TQ('关键词「{v}」', { v: S.kw }));
    if (S.trustee.length) filterBits.push(TQ('受托人：{v}', { v: S.trustee.map((v) => (window.trusteeDisplay ? window.trusteeDisplay(v) : v)).join('、') }));
    if (S.scheme.length) filterBits.push(TQ('计划：{v}', { v: S.scheme.join('、') }));
    if (S.type.length) filterBits.push(TQ('基金种类：{v}', { v: S.type.map((v) => typeLabel(v)).join('、') }));
    const sortName = key0
      ? ({ ann1: '近1年年率化回报', ann5: '近5年年率化回报', ann10: '近10年年率化回报', annLaunch: '推出至今年率化回报',
        size: '基金规模', risk: '风险级别', mgmtFee: '基金管理费', fer: '基金开支比率', nav: '单位资产净值',
        fund: '基金名称', trustee: '受托人', launchTs: '推出日期', worstYear: '近5年最差年度' }[key0] || key0)
        + (S.sortDir === 'asc' ? '（由小到大）' : '（由大到小）')
      : TT('积金局官方序号');
    const cover = window.buildCoverSheet({
      page: TT('积金局月度数据'),
      title: TT('数据说明'),
      meta: [
        [TT('资料截至'), DATA.dataAsOf || '—'],
        [TT('本站同步时间'), new Date(DATA.updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })],
        [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
        [TT('收录范围'), TQ('{n} 个成分基金（与积金局官网一致；按单位类别共 {u} 条）', { n: list.length, u: unitTotal })],
        [TT('排序'), sortName],
        [TT('筛选条件'), filterBits.length ? filterBits.join('、') : TT('无（全市场）')],
      ],
      notes: [
        TT('本表照抄积金局「强积金基金平台」月报口径：回报为年率化、已扣费并计入分红再投资，与本站「基金最新数据」的每日自算口径不同，同名指标不可直接相减。'),
        TT('官网表格以「成分基金」为单位（共 382 个）；同一成分基金若有多个单位类别，本站合并为一行，单位类别列列出全部类别，指标取规模最大的类别。'),
        TT('单位资产净值取自各计划受托人／保荐人官网每日公布值，估值日见对应列；积金局表格本身不提供净值，因此该列为本站补充字段。'),
        TT('空白单元格＝积金局未公布该字段，或该基金当日无官方净值（周末／公众假期／非估值日）；本站不插值、不使用前值填充。'),
      ],
      columns: [
        [TT('序号'), TT('按积金局官网顺序编号，与官网表格一致')],
        [TT('基金名称'), TT('成分基金名称')],
        [TT('单位类别'), TT('同一基金的不同单位类别（A / T / B 等），多个类别以「/」分隔')],
        [TT('基金种类'), TT('积金局基金类别（含细类）')],
        [TT('强积金计划'), TT('所属强积金计划')],
        [TT('受托人'), TT('法定受托人')],
        [TT('风险级别'), TT('积金局按近三年波幅评定的 1–7 级（1 最低、7 最高）')],
        [TT('单位资产净值'), TT('发行人官网公布的单位资产净值（本站补充，非积金局字段）')],
        [TT('净值估值日'), TT('该净值的官方估值日')],
        [TT('近1年年率化回报'), TT('积金局公布，已扣费、含分红再投资')],
        [TT('近5年年率化回报'), TT('积金局公布，已扣费、含分红再投资')],
        [TT('近10年年率化回报'), TT('积金局公布，已扣费、含分红再投资')],
        [TT('推出至今年率化回报'), TT('自基金推出以来的年率化回报')],
        [TQ('基金规模（{u}）', { u: TT('百万港元') }), TT('积金局公布的最新基金规模，按月更新')],
        [TT('基金管理费 % p.a.'), TT('积金局披露的基金管理费；区间或「最高」按原文显示')],
        [TT('最近期基金开支比率'), TT('基金开支比率（FER），积金局披露')],
        [TT('推出日期'), TT('基金推出日期')],
      ],
    });
    const blob = window.MPFXLSX.build({
      sheets: [
        cover,
        { name: sheetName, rows: r1, merges: ['A1:Q1'], cols: head.map(() => 16) },
        { name: '持仓与分布', rows: sheet2.rows, merges: sheet2.merges, cols: sheet2.cols, images: sheet2.images },
      ],
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (isMpfa ? 'MPF积金局基金列表_' : ('MPF排名_' + TT(b.name) + '_')) + (DATA.dataAsOf || '') + '.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    if (window.mpfToast) mpfToast(_t('已导出（数据说明 + 基金列表 + 持仓分布，共三个工作表）'));
  }

  function maxBar(rows, k, x) {
    const vals = rows.map((r) => Math.abs(r[k] || 0));
    const m = Math.max.apply(null, vals.concat([0.0001]));
    return Math.min(100, (Math.abs(x[k] || 0) / m) * 100).toFixed(1);
  }

  function syncHeader(key, dir) {
    /* 2026-10-30：key 为空（未选榜/已取消）＝默认顺序，所有列 ↕、无高亮、方向显示 — */
    $$('#rkThead th[data-k]').forEach((th) => {
      const on = !!key && th.dataset.k === key;
      th.classList.toggle('sorted', on);
      const a = th.querySelector('.arrow');
      if (a) a.textContent = on ? (dir === 'asc' ? '↑' : '↓') : '↕';
    });
    const el = $('#rkMSortKey');
    if (el) el.value = key || '';
    const d = $('#rkMSortDir');
    if (d) d.textContent = !key ? '—' : (dir === 'asc' ? '升序 ↑' : '降序 ↓');
    if (typeof paintTabs === 'function') paintTabs();   /* 标签 ↓/↑ 与表头保持一致 */
  }

  /** 发行人实力榜的领跑卡片：改以「平均回报 + 旗下规模」呈现，不再按基金种类分组 */
  function renderAggChampions(ranked) {
    const top = ranked.slice(0, 6);
    $('#rkChampions').innerHTML = top.length ? top.map((x, i) => {
      return '<div class="pod p' + (i + 1) + '">' +
        '<div class="no">' + TQ('第 {n} 名', { n: i + 1 }) + '</div>' +
        '<div class="nm">' + esc(window.trusteeDisplay ? window.trusteeDisplay(x.trustee) : x.trustee) + '</div>' +
        '<div class="tr">' + TT('受托人／保荐人') + '</div>' +
        '<div class="val num ' + cls(x.ann1Avg) + '">' + pct(x.ann1Avg) + '</div>' +
        '<div class="meta"><span>' + TQ('旗下 {n} 条', { n: x.count }) + '</span><span>' + TQ('规模 {v} 百万', { v: nf(x.sizeSum, 0) }) + '</span><span>' + TT('近5年') + ' ' + pct(x.ann5Avg) + '</span></div>' +
        '</div>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">' + TT('暂无数据') + '</div>';
  }

  /* 冠军卡小字参考值：跟随当前榜单指标（此前固定「近1年」，切榜后不变化、易误解） */
  const POD_REF = {
    ann1: '近1年', ann5: '近5年', ann10: '近10年', annLaunch: '推出至今',
    cum1: '近1年累积', cum5: '近5年累积', cum10: '近10年累积', cumLaunch: '推出至今累积',
    worstYear: '近5年最差年度',
  };
  function podRefText(b, x) {
    if (b.metric === 'calYear') return TQ('{y} 年', { y: S.calYear }) + ' ' + pct(x.calYear);
    const nm = POD_REF[b.metric];
    if (nm) return TT(nm) + ' ' + pct(x[b.metric]);
    return TT('近1年') + ' ' + pct(x.ann1);
  }

  function renderChampions(ranked, b) {
    const seen = {};
    const picks = [];
    for (const x of ranked) {
      if (!seen[x.type]) { seen[x.type] = 1; picks.push(x); }
    }
    const top = picks.slice(0, 6);
    $('#rkChampions').innerHTML = top.length ? top.map((x, i) => {
      const v = x[b.metric];
      const label = b.metric === 'mgmtFee' ? nf(v, 2) + '%' : b.metric === 'size' ? nf(v, 0) : pct(v);
      const c = b.metric === 'mgmtFee' || b.metric === 'size' ? '' : cls(v);
      return '<div class="pod p' + (i + 1) + '">' +
        '<div class="no">' + TQ('{t} 冠军', { t: esc(typeLabel(x.type)) }) + '</div>' +
        '<div class="nm">' + esc(fundFullName(x)) + '</div>' +
        '<div class="tr">' + esc(window.trusteeDisplay ? window.trusteeDisplay(x.trustee) : x.trustee) + '</div>' +
        '<div class="val num ' + c + '">' + label + '</div>' +
        '<div class="meta"><span' + (x.risk == null ? '' : ' data-tip="' + esc(MPF_RISK.tip(x.risk)) + '"') + '>' + TT('风险') + ' ' + (x.risk == null ? 'n.a.' : x.risk + ' ' + TT('级')) + '</span><span>' + (x.size == null ? TT('规模 n.a.') : TQ('规模 {v} 百万', { v: nf(x.size, 0) })) + '</span><span>' + podRefText(b, x) + '</span></div>' +
        '</div>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">' + TT('暂无数据') + '</div>';
  }

  /* 对比功能已统一到 common.js（CMPX / renderCmpBar / openCmp），全站共用，
     本页只需在表格勾选与「详情」弹窗中触发即可。 */

  /* 语言切换后重绘本页全部动态文案（榜单名/描述/维度提示/表头/冠军卡）。
     注意：缓存命中时数据会在 DOMContentLoaded 之前就绪，因此 #rkBoardTitle / #rkRcntUnit /
     #rkTabsToggle 不能带 data-i18n 属性——否则 i18n 引擎会在稍后的 DOMContentLoaded 里
     把它们打回静态中文（深链接打开对应榜单时标题会显示错误的「排行榜」）。 */
  document.addEventListener('mpf:lang', () => {
    if (!DATA.count) return;
    HEAD_MODE = '';        // 强制重建表头；FUND 快照为中文，重建后再统一翻译
    buildFilters();        // 2026-11-01（6.0）：下拉选项按新语言重建
    buildTabs();
    buildMobileSort();
    render();
    if (typeof window.applyI18n === 'function') window.applyI18n(document);
  });

  init();
})();

  /* 2026-10-19：列设置升级为「逐列勾选」（对齐「基金最新数据」的列设置）
     三种榜单表头列数不同 → 按当前模式（fund / agg / self）动态映射列序；
     可见性以列 key 记忆在 localStorage（'mpf-rk-cols-v2'）。 */
  (function initRankCols() {
    const btn = document.querySelector('#rkColBtn');
    const pop = document.querySelector('#rkColPop');
    const tbl = document.querySelector('#rkTable');
    const box = document.querySelector('#rkColChecks');
    if (!btn || !pop || !tbl || !box) return;
    /* 2026-11-26（领导要求）：单位类别 / 单位资产净值 收进列设置（默认不显示），升版重置一次 */
    const KEY = 'mpf-rk-cols-v9';

    /* 列定义：k=列键、n=显示名、lock=必显 */
    const FUND = [
      /* 2026-10-26（用户要求）：基金规模列移到回报组之后（原管理费位置），管理费移出默认显示 */
      ['rank', '序号', 1], ['fund', '基金名称', 1],
      ['unit', '单位类别', 0], ['nav', '单位资产净值', 0],   /* 2026-11-21：与导出中心对齐 */
      ['scheme', '计划名称', 0], ['trustee', '受托人', 0],
      ['type', '基金种类', 0], ['sub', '基金细类', 0], ['risk', '风险级别', 0],
      ['ann1', '近1年年率化', 0], ['ann5', '近5年年率化', 0], ['ann10', '近10年年率化', 0],
      ['annLaunch', '推出至今年率化', 0], ['size', '基金规模', 0], ['mgmtFee', '管理费', 0],
      /* 2026-10-26：补齐「抗跌榜 / 总开支 / 新锐榜」对应列——此前这 3 个标签点了只排序、不出列，
         用户看到的就是「点了没反应」 */
      ['worstYear', '近5年最差年度', 0], ['fer', '总开支比率', 0], ['launchTs', '推出日期', 0],
      ['calYear', '历年回报（当年）', 1],   /* 仅历年榜显示，跟随榜单逻辑 */
      ['cum1', '近1年累积', 0], ['cum5', '近5年累积', 0], ['cum10', '近10年累积', 0],
      ['cumLaunch', '推出至今累积', 0],
      ['cal2021', '2021 年回报', 0], ['cal2022', '2022 年回报', 0], ['cal2023', '2023 年回报', 0],
      ['cal2024', '2024 年回报', 0], ['cal2025', '2025 年回报', 0],
      ['cmp', '对比', 1], ['ops', '详情', 1],
    ];
    const AGG = [
      ['rank', '序号', 1], ['trustee', '受托人', 1], ['count', '成分基金数', 0],
      ['sizeSum', '总规模', 0], ['ann1Avg', '平均近1年年率化', 0], ['ann5Avg', '平均近5年年率化', 0],
      ['ann10Avg', '平均近10年年率化', 0], ['annLaunchAvg', '平均推出至今年率化', 0],
      ['mgmtFee', '平均管理费', 0], ['navRate', '净值核实率', 0], ['ops', '详情', 1],
    ];
    const SELF = [
      ['rank', '序号', 1], ['fund', '基金名称', 1], ['trustee', '受托人', 0], ['type', '基金种类', 0],
      ['risk', '风险级别', 0], ['size', '基金规模', 0],
      ['selfD1', '日涨跌', 0], ['selfW1', '近1周', 0], ['selfM1', '近1月', 0], ['selfYtd', '年初至今', 0],
      ['selfY1', '近1年', 0], ['selfY3a', '近3年年化', 0], ['selfY5a', '近5年年化', 0],
      ['selfMdd', '近1年回撤', 0], ['selfMdd5', '近5年回撤', 0],
      ['cmp', '对比', 1], ['ops', '详情', 1],
    ];
    const MODES = { fund: FUND, agg: AGG, self: SELF };
    /* 2026-11-02（用户要求）：基金种类列默认显示（与「基金最新数据」一致）；受托人保持显示 */
    const DEFAULT_OFF = ['unit', 'nav', 'sub', 'cum1', 'cum5', 'cum10', 'cumLaunch', 'mgmtFee', 'worstYear', 'launchTs',
      'cal2021', 'cal2022', 'cal2023', 'cal2024', 'cal2025', 'scheme'];
    const SLIM_OFF = ['trustee', 'type', 'scheme', 'risk', 'size', 'ann5', 'ann10', 'annLaunch', 'mgmtFee',
      'worstYear', 'fer', 'launchTs',
      'cum1', 'cum5', 'cum10', 'cumLaunch', 'cal2021', 'cal2022', 'cal2023', 'cal2024', 'cal2025',
      'selfW1', 'selfY3a', 'selfY5a', 'selfMdd5', 'count', 'sizeSum', 'ann5Avg', 'ann10Avg',
      'annLaunchAvg', 'navRate'];

    /* 2026-11-02（第二十三轮，用户要求）：列设置给 3 个视角预设 + 全部列（按当前榜单类型各配一套） */
    const PRESET_SHOW = {
      fund: {
        '收益视角': ['rank', 'fund', 'type', 'ann1', 'ann5', 'ann10', 'annLaunch',
          'cum1', 'cum5', 'cum10', 'cumLaunch', 'size', 'cmp', 'ops'],
        '风险视角': ['rank', 'fund', 'type', 'risk', 'mgmtFee', 'fer', 'worstYear', 'size', 'cmp', 'ops'],
      },
      self: {
        '收益视角': ['rank', 'fund', 'type', 'selfD1', 'selfM1', 'selfYtd', 'selfY1',
          'selfY3a', 'selfY5a', 'size', 'cmp', 'ops'],
        '风险视角': ['rank', 'fund', 'type', 'risk', 'selfMdd', 'selfMdd5', 'selfW1', 'size', 'cmp', 'ops'],
      },
      agg: {
        '收益视角': ['rank', 'trustee', 'count', 'ann1Avg', 'ann5Avg', 'ann10Avg', 'annLaunchAvg', 'sizeSum', 'ops'],
        '风险视角': ['rank', 'trustee', 'count', 'sizeSum', 'mgmtFee', 'navRate', 'ops'],
      },
    };
    function presetOff(name) {
      const mode = curMode();
      const defs = MODES[mode];
      const cols = defs.map((c) => c[0]).filter((k) => k !== 'calYear');
      if (name === '全部列') return [];
      if (name === '默认') return DEFAULT_OFF.slice();
      const show = (PRESET_SHOW[mode] || {})[name];
      if (!show) return DEFAULT_OFF.slice();
      return cols.filter((k) => {
        if (show.indexOf(k) >= 0) return false;
        const d = defs.find((c) => c[0] === k);
        return !(d && d[2]);   /* lock 列不可隐藏 */
      });
    }

    let off = null;   /* 隐藏列集合 */
    try { const raw = localStorage.getItem(KEY); off = raw ? new Set(JSON.parse(raw)) : null; } catch (e) { off = null; }
    if (!off) off = new Set(DEFAULT_OFF);
    /* 2026-11-19：新增的「基金细类」列默认隐藏 —— 老用户的列设置里没有这一项，
       这里做一次性迁移（只隐藏一次，之后用户自己勾选就按他的选择记住）。 */
    try {
      if (off && !localStorage.getItem('mpf-rk-sub-v1')) {
        off.add('sub');
        localStorage.setItem('mpf-rk-sub-v1', '1');
        localStorage.setItem(KEY, JSON.stringify([...off]));
      }
    } catch (e) {}

    const curMode = () => (window.__rkMode && MODES[window.__rkMode]) ? window.__rkMode : 'fund';

    /* ---------- 可见列顺序（供主闭包的 render 调用，数组单源） ----------
       规则：FUND 定义顺序 ∩ 未隐藏；当前榜单的维度列强制显示、插到「风险」右一列。
       只有在「原本隐藏」时才登记到 __rkDimRevealed，取消/切榜时归还隐藏。 */
    function rkOrderImpl() {
      const isCal = !!window.__rkIsCal;
      /* extra：本次渲染临时放出的列（不进 off，不持久化） */
      const visible = (extra) => FUND.map(([k]) => k)
        .filter((k) => (k === 'calYear' ? isCal : (!off.has(k) || k === extra)));
      let order = visible();
      const mk = window.__rkMetric || '';
      if (mk && mk !== 'risk' && FUND.some(([k]) => k === mk)) {
        /* 2026-10-27 修（用户反馈：点标签后列永久留下、越点越多）：
           维度列只是「临时显示」——不修改 off、不写入 localStorage，切榜即回到用户自己的列设置 */
        if (off.has(mk)) order = visible(mk);
        if (order.indexOf(mk) >= 0) {
          order = order.filter((k) => k !== mk);
          const ri = order.indexOf('risk');
          /* 2026-11-02 修：风险级别被隐藏时 ri=-1，原来直接不插回 → 榜单维度列整列消失
             （「收益视角 / 风险视角」预设会隐藏风险级别，暴露出这个老 bug）；
             改成插到「基金名称」右侧。 */
          const at = ri >= 0 ? ri + 1 : (order.indexOf('fund') + 1 || 1);
          order.splice(at, 0, mk);
        }
      }
      return order;
    }
    window.__rkSetOrderImpl(rkOrderImpl);

    /* 取消维度联动：把「因维度联动而放出」的列归还隐藏（默认列不受影响） */
    function cancelDimRevealed() {
      /* 2026-10-27：维度列改为临时显示后无需归还；保留函数以兼容既有调用 */
      window.__rkDimRevealed = new Set();
    }
    window.__rkCancelDim = cancelDimRevealed;

    /* 列设置变更后立即重绘（fund 榜列是「不渲染」，必须重绘才生效） */
    function applyAndRender() {
      apply();
      if (curMode() === 'fund' && window.__rkRender) window.__rkRender();
    }

    function apply() {
      /* 2026-10-26：fund 榜已 order 化（隐藏列不渲染，无需 CSS）；self/agg 榜保留 nth-child 规则 */
      const mode = curMode();
      const defs = MODES[mode];
      const isCal = !!window.__rkIsCal;
      if (mode === 'fund') {
        /* 清掉 agg/self 榜遗留的 nth-child 隐藏规则：否则切回基金榜时它们会误隐藏新放出的列 */
        const st0 = document.getElementById('rkColStyle');
        if (st0) st0.textContent = '';
        try { localStorage.setItem(KEY, JSON.stringify([...off])); } catch (e) {}
        return;
      }
      let idx = 0;
      const rules = [];
      defs.forEach(([k, , lock]) => {
        idx++;
        const hide = !lock && off.has(k);
        if (hide) rules.push('#rkTable tr > *:nth-child(' + idx + ') { display: none !important; }');
        else rules.push('#rkTable tr > *:nth-child(' + idx + ') { display: table-cell !important; }');
      });
      let st = document.getElementById('rkColStyle');
      if (!st) { st = document.createElement('style'); st.id = 'rkColStyle'; document.head.appendChild(st); }
      st.textContent = rules.join('\n');
      try { localStorage.setItem(KEY, JSON.stringify([...off])); } catch (e) {}
    }
    window.__rkApplyCols = apply;

    /* ---------- 2026-10-26（用户要求）：排名维度 → 列联动 ----------
       点击维度标签时：对应列自动显示、物理移动到「风险」列右边、并高亮。
       列一旦放出保持显示（用户可在列设置收回）；高亮跟随当前维度。 */
    function stampCols() {
      const defs = MODES[curMode()];
      const thead = document.querySelector('#rkThead');
      if (thead) [...thead.children].forEach((th, i) => {
        if (defs[i]) th.dataset.c = th.dataset.k || defs[i][0];
      });
      const tb = document.querySelector('#rkTbody');
      if (tb) [...tb.children].forEach((tr) => {
        if (tr.children.length !== defs.length) return;   /* 空态行跳过 */
        [...tr.children].forEach((td, i) => { if (defs[i]) td.dataset.c = defs[i][0]; });
      });
    }
    window.__rkStampCols = stampCols;


    function buildList() {
      const defs = MODES[curMode()];
      box.innerHTML = defs.filter(([k]) => k !== 'calYear').map(([k, n, lock]) =>
        '<label' + (lock ? ' class="cp-lock"' : '') + '><input type="checkbox" value="' + k + '"' +
        (lock || !off.has(k) ? ' checked' : '') + (lock ? ' disabled' : '') + '>' + n + '</label>').join('');
      box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) off.delete(cb.value); else off.add(cb.value);
        applyAndRender(); syncPresetUI();
      }));
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pop.hidden) { buildList(); syncPresetUI(); }
      pop.hidden = !pop.hidden;
    });
    pop.querySelectorAll('.cp-b[data-preset]').forEach((b) => b.addEventListener('click', () => {
      off = new Set(presetOff(b.getAttribute('data-preset')));
      applyAndRender(); buildList(); syncPresetUI();
    }));
    function syncPresetUI() {
      const cur = [...off].sort().join(',');
      pop.querySelectorAll('.cp-b[data-preset]').forEach((b) => {
        b.classList.toggle('on', [...presetOff(b.getAttribute('data-preset'))].sort().join(',') === cur);
      });
    }
    document.addEventListener('click', (e) => {
      if (!pop.hidden && !(e.target.closest && e.target.closest('#rkColPop')) && e.target.id !== 'rkColBtn') pop.hidden = true;
    });
    apply();
    buildList();   /* 初始化即构建清单（弹层默认隐藏，不影响渲染） */
  })();
