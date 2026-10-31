/* 板块四：MPF基金分析（第四个页面 · 2026-10-13 v3 重做）
 * 结构参照合作方站「在线对比MPF股票基金与大盘指数」：
 *   · 默认视图 = 走势对比（图上方自由选择指数 / 基金，区间切换，归一化折线 + 回撤表）
 *   · 「查看具体基金分析」→ 基金分析视图（指标磁贴 + 自算指标 + 走势 + 历年回报）
 *   · 深链接 analysis.html?open=<基金id> 直接打开分析视图
 * 数据与全站一致（common.js loadData）；基金历史净值来自各发行人官网（TREND 模块）。
 */
(function () {
  window.__errs = [];
  window.addEventListener("error", function (e) { window.__errs.push(String(e.message).slice(0, 140)); });
  window.addEventListener("unhandledrejection", function (e) { window.__errs.push("rej:" + String((e.reason && e.reason.message) || e.reason).slice(0, 140)); });

  let CUR = '';           // 当前分析视图打开的基金 id
  let PERF = null;        // 自算指标（/api/navperf）
  let TPERF = null;       // 发行人官网业绩快照（/api/trustee-perf）
  let TIDX = null;        // 发行人平均指数（/api/trustee-idx）
  let TREND_MAIN = null;  // 主对比模块实例
  let bootPickId = null;  // 首次挂载时默认选中的基金（PERF 就绪后校正为「有历史净值」者）
  const S = { trustee: '' }; // 左侧栏选中的发行人（空 = 总体）

  const $ = (s) => document.querySelector(s);

  function init() {
    /* 2026-10-31（用户要求）：本页并入「强积金资料库」第三板块（index.html#cmp）。
       合并模式下导航高亮由页内板块切换脚本控制，这里只在独立页才自挂导航。 */
    const MERGED = !!document.getElementById('dbSec') && !!document.getElementById('anSec');
    if (!MERGED) mountHeader('an');
    else mountHeader((location.hash || '') === '#cmp' ? 'an' : 'db');
    document.addEventListener('mpf:dbtab', (e) => {
      if (!MERGED) return;
      const tab = e && e.detail;
      if (tab === 'cmp') { mountHeader('an'); if (typeof window.__anRemount === 'function') window.__anRemount(); }
      else mountHeader('db');
    });
    /* 板块切换脚本在首次进入对比板块时调用：重挂走势图（隐藏容器内首挂宽度为 0） */
    window.__anRemount = function () {
      try { if (DATA.count) { mountMain(); renderFundList(); } } catch (e) {}
    };
    /* 发行人平均指数：尽早拉取，供点选发行人时的默认对比使用 */
    fetchJSON('/api/trustee-idx', 'tidx').then((j) => { TIDX = j; }).catch(() => {});
    loadData(() => {
      buildSide(DATA.funds);
      mountMain();
      renderFundList();
      renderSrcNoteTop();
      /* 自算指标（基于发行人官网历史净值）：到货后刷新基金列表与详情视图 */
      if (window.TREND && TREND.ensurePerf) {
        TREND.ensurePerf().then((p) => {
          PERF = p;
          window.__PERF = p;   /* 与小窗共用同一份自算数据 */
          renderFundList();
          /* PERF 就绪后：若默认组合仍是初始自动选择（用户未改动），校正为「有历史净值的最大一只」 */
          if (!S.trustee && TREND_MAIN && TREND_MAIN.getItems) {
            const its = TREND_MAIN.getItems();
            const fs2 = its.filter((x) => x.type === 'fund');
            if (its.length === 2 && fs2.length === 1 && fs2[0].id === bootPickId) {
              const better = pickTop('');
              if (better && better.id !== bootPickId) { bootPickId = better.id; TREND_MAIN.setItems(baseChartItems()); }
            }
          }
          if (CUR && !$('#anDetail').hidden && window.fundDetailRefresh) window.fundDetailRefresh(findFund(CUR));
        });
      }
      /* 发行人官网业绩快照（BCT 系：近1/3/5年、历年回报、风险级别）——不等积金局 */
      fetchJSON('/api/trustee-perf', 'tperf').then((j) => {
        TPERF = j;
        if (CUR && !$('#anDetail').hidden && window.fundDetailRefresh) window.fundDetailRefresh(findFund(CUR));
      }).catch(() => {});
      /* 2026-10-20：十大持仓与资产分布改为「按基金 id 懒加载」（见 fillHolds），
         不再在页面初始化时拉全量 433KB，首屏更快。 */
      /* 深链接：analysis.html?open=<基金id> 直接打开该基金的分析视图（便于分享特定基金） */
      try {
        const want = new URLSearchParams(location.search).get('open');
        if (want && findFund(want)) openAnalysis(want, { replace: true });
      } catch (e) {}
      /* 2026-10-31：合并页上 app.js/rank.js 也注册了 __onRefresh——链式调用，别覆盖 */
      const __prevRefresh = window.__onRefresh;
      window.__onRefresh = () => { try { if (__prevRefresh) __prevRefresh(); } catch (e) {} mountMain(); };
    });
    /* 语言切换：侧栏、主对比模块、基金列表与详情视图全部重绘（含动态文案） */
    document.addEventListener('mpf:lang', () => {
      if (!DATA.count) return;
      buildSide(DATA.funds);
      mountMain();
      renderFundList();
      renderSrcNoteTop();
      if (CUR && !$('#anDetail').hidden) renderDetail(findFund(CUR));
    });
  }

  /* 分享链接参数 ?set=i:HSI,f:695,t:宏利 —— 还原对比组合（最多 8 条） */
  function itemsFromSet(v) {
    return String(v || '').split(',').map((k) => {
      const ty = k.slice(0, 2), val = k.slice(2);
      if (!val) return null;
      if (ty === 'i:') return { type: 'index', key: val };
      if (ty === 't:') return { type: 'tavg', key: val };
      if (ty === 'f:') return { type: 'fund', id: val };
      return null;
    }).filter(Boolean).slice(0, 8);
  }

  /* 主对比模块（默认：恒生指数 + 规模最大的一只基金；带 ?set= 时还原分享的组合） */
  function mountMain() {
    const box = $('#anTrendBox');
    if (!box || !window.TREND) return;
    let items0 = baseChartItems();
    try {
      const sp = new URLSearchParams(location.search).get('set');
      if (sp) { const arr = itemsFromSet(sp); if (arr.length) items0 = arr; }
    } catch (e) {}
    /* 2026-10-21：对比视图不再显示「查看具体基金分析」按钮（用户要求直接删掉） */
    TREND_MAIN = TREND.mount(box, items0, { filter: filterOf(), fundMeta: fundMetaMap(), trusteeOrder: PROV_ORDER || undefined, hideGoto: true, onSelChange: function () { renderFundList(); } });
    /* 2026-10-21：工具栏加「详细对比」——用同一套渲染打开对比弹窗（走势图 + 对比表） */
    (function addCmpBtn() {
      const t2 = box.querySelector('.tr-tools2');
      if (!t2 || t2.querySelector('.tr-cmpbtn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tr-tool tr-cmpbtn';
      btn.textContent = TT('详细对比');
      btn.title = TT('把当前走势图里的基金放进对比表（含走势图与全部指标）');
      btn.addEventListener('click', () => {
        const funds = (TREND_MAIN.getItems ? TREND_MAIN.getItems() : []).filter((it) => it.type === 'fund');
        if (funds.length < 2) { mpfToast(TT('请至少选择 2 只基金再打开详细对比')); return; }
        CMPX.clear();
        funds.slice(0, 6).forEach((it) => CMPX.add(it.id));
        renderCmpBar();
        window.openCmp();
      });
      t2.insertBefore(btn, t2.firstChild);   /* 放在「全部区间」左边 */
    })();
    bootPickId = (items0.find((x) => x.type === 'fund') || {}).id || null;
    renderBadge();
  }

  /* 基金元数据（发行人 / 类型）——供「选择基金」面板分级展示（发行人 → 类型 → 基金） */
  function fundMetaMap() {
    const m = {};
    (DATA.funds || []).forEach((x) => { m[x.id] = { trustee: x.trustee, type: x.type, name: x.fundBase || x.fund }; });
    return m;
  }

  /** 默认对比组合：恒生指数 + 规模最大的一只基金（总体=全市场 / 发行人=该发行人，有历史净值的优先）
      发行人平均指数仍可从「选择指数」面板添加（等权计算口径见面板内说明）。 */
  /* 数据不全提示（2026-10-17 v2）：每次点击都弹（刷新后仍会提示） */
  function maybeWarnIncomplete(t) {
    if (!t || !window.mpfNotice) return;
    const REASON = '该受托人官网<strong>只发布最新价格</strong>，不提供历史数据接口（已逐家核实），因此最多只能取得近 1 年的逐日净值（来自环富通数据商），<strong>5 年日度暂缺</strong>；系统每天保存快照，会逐日变长。';
    const MAP = {
      '渣打信托': ['新地：日度历史约 1 年', '本发行人下新地计划 <b>10 只</b>基金，因官网只发布最近约 1 年的价格，故日度净值仅有约 1 年的数据（2025-10-02 起）。'],
      '銀聯信託': ['AMTD 安聯：日度历史约 1 年', '本发行人下 AMTD 计划 <b>16 只</b>基金，因官网未完整披露，故日度净值仅有约 1 年的数据（2025-10-14 起）。'],
    };
    const hit = MAP[t];
    if (!hit) return;
    mpfNotice(hit[0], hit[1]);
  }

  /* 数据完整性徽章 + 数据不全提示（2026-10-17 v3，发行人口径） */
  function baseChartItems() {
    /* 2026-10-17：默认只放恒生指数——单线时走势图直接显示实际点位（非指数化），便于查看 */
    return [{ type: 'index', key: 'HSI' }];
  }
  /** 规模最大的一只（有历史净值的优先；trustee 为空 = 全市场） */
  function pickTop(trustee) {
    const list = (DATA.funds || []).filter((x) => (!trustee || x.trustee === trustee) && x.navStatus !== 'na');
    if (!list.length) return null;
    const bySize = list.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
    if (PERF && PERF.funds) return bySize.find((x) => PERF.funds[x.id]) || null;
    return bySize[0];
  }

  
  /* ---------- 左侧栏：总体 + 各发行人 —— **合作发行人（宏利/BCT/友邦）置顶**，其余按基金数降序 ---------- */
  const PARTNER = { '宏利': 0, '銀聯信託': 1, '友邦信託': 2 };   // 0/1/2 = 宏利 / BCT(银联信托) / 友邦；其余 9
  /* 2026-10-19：東亞（官網 GetMPFData 全量日度）與萬通已补满 5 年 → 回归常规顺序；
     仅剩新地（渣打信托，官网只有约 1 年滚动 PDF）排最后（宏利/銀聯/友邦 顺序不变） */
  const INCOMPLETE_TRUSTEE = { '渣打信托': 1 };
  function partnerRank(t) {
    if (PARTNER[t] != null) return PARTNER[t];
    if (INCOMPLETE_TRUSTEE[t]) return 90;
    return 9;
  }

  let PROV_ORDER = null;
  let QF = null;   /* 行首方框快筛：只看某一只基金（2026-10-17） */
  let LAST_FUNDS = null;
  let IDXDATA = null;   /* key → { name, series }（勾选指数的列表行用） */
  /* 2026-10-21：复用走势图模块的指数缓存，避免同一份 543KB 拉两次 */
  /* 2026-10-21：首屏只拉 lite（恒指），其余指数由走势图按需补 */
  (fetch('/api/indices?lite=1').then((r) => r.json()).catch(() => null))
    .then((j) => { IDXDATA = (j && j.items) || {}; renderFundList(); }).catch(() => {});
  function buildSide(funds) {
    const map = {};
    funds.forEach((x) => { map[x.trustee] = (map[x.trustee] || 0) + 1; });
    const list = Object.keys(map).sort((a, b) =>
      partnerRank(a) - partnerRank(b) || map[b] - map[a] || a.localeCompare(b, 'zh-Hans-CN'));
    PROV_ORDER = list.slice();
    const el = $('#anProv');
    if (!el) return;
    LAST_FUNDS = funds;
    el.innerHTML =
      '<button type="button" class="an-pitem' + (S.trustee === '' ? ' on' : '') + '" data-t="">' +
        '<span>' + TT('总体') + '</span><b>' + funds.length + '</b></button>' +
      list.map((t) =>
        '<button type="button" class="an-pitem' + (S.trustee === t ? ' on' : '') + '" data-t="' + esc(t) + '">' +
        '<span>' + esc(t) + '</span><b>' + map[t] + '</b></button>').join('');
    if (!el.__bound) {
      el.__bound = 1;
      el.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest('.an-pitem') : null;
        if (!btn) return;
        S.trustee = btn.getAttribute('data-t') || '';
        QF = null;
        Array.prototype.forEach.call(el.querySelectorAll('.an-pitem'), (b) => b.classList.toggle('on', b === btn));
        if (TREND_MAIN) {
          if (TREND_MAIN.setFilter) TREND_MAIN.setFilter(filterOf());
          /* 2026-10-21：切换发行人不再清空已选基金（用户要求保留），仅在一条基金都没选时补恒指 */
          const curItems = TREND_MAIN.getItems ? TREND_MAIN.getItems() : [];
          const hasFund = curItems.some((it) => it.type === 'fund');
          if (!hasFund && TREND_MAIN.setItems) TREND_MAIN.setItems([{ type: 'index', key: 'HSI' }]);
        }
        renderFundList();
        renderSrcNoteTop();
        maybeWarnIncomplete(S.trustee);
      });
    }
  }

  /* ---------- 基金列表（该发行人全部基金，与资料库同口径；表头可排序） ----------
     默认排序 'partner'：合作发行人（宏利→BCT/银联信托→友邦）优先，组内按规模降序。
     2026-10-22（用户要求）：表头改三态 —— 第一次按最大（降序）→ 第二次按最小（升序）→ 第三次取消，回到默认名次顺序。 */
  const LS_DEFAULT = { key: 'partner', dir: 1 };
  const LS = { key: 'partner', dir: 1 };
  const lsIsDefault = () => LS.key === LS_DEFAULT.key && LS.dir === LS_DEFAULT.dir;

  function listVal(x, k) {
    const pf = PERF && PERF.funds ? PERF.funds[x.id] : null;
    switch (k) {
      case 'fund': return String(x.fundBase || x.fund || '');
      case 'partner': return partnerRank(x.trustee);
      case 'nav': return x.nav == null ? null : x.nav;
      case 'd1': return pf && pf.d1 != null ? pf.d1 : null;
      case 'ytd': return pf && pf.ytd != null ? pf.ytd : null;
      case 'ann1': return x.ann1 == null ? null : x.ann1;
      case 'risk': return x.risk == null ? null : x.risk;
      case 'size': return x.size == null ? null : x.size;
      case 'navAsOf': return String(x.navAsOf || '');
      default: return 0;
    }
  }
  function sortList(arr) {
    const k = LS.key, dir = LS.dir;
    return arr.slice().sort((a, b) => {
      if (k === 'partner') {
        return (partnerRank(a.trustee) - partnerRank(b.trustee)) || ((b.size || 0) - (a.size || 0));
      }
      const va = listVal(a, k), vb = listVal(b, k);
      /* A3：空值（— / 不适用）无论升降序一律排最后 */
      const ea = va == null || va === '', eb = vb == null || vb === '';
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'zh-Hans-CN') * dir;
      return (va - vb) * dir;
    });
  }
  /* B2（2026-10-21）：列表表头挂口径提示（不改文字，悬停/点击可见） */
  const COL_TIPS = {
    '单位净值': '取自发行人官网当日公布的每单位资产净值（NAV），估值日见「更新日期」列；指数显示的是点位。',
    '日涨跌幅': '自算口径：最新净值 ÷ 上一交易日净值 − 1，基于发行人官网逐日净值，不含分红再投资与费用调整。',
    '年初至今': '自算口径：上一年最后一个净值点至最新净值日的累计涨幅（净价，不含分红再投资）。',
    '近1年年率化': '积金局口径：近 1 年年率化回报（含费用、含分红再投资），资料截至积金局公布日；与右侧自算口径不可直接比较。',
    '风险级别': '积金局按基金过去三年波幅与组合评定的 1–7 级，非第三方评级。',
    '基金规模（亿港元）': '积金局「基金规模」字段，按单位类别统计（百万港元换算为亿）。',
  };
  function syncListArrows() {
    const th = document.getElementById('anThead');
    if (!th) return;
    Array.prototype.forEach.call(th.querySelectorAll('th[data-lsk]'), (c) => {
      const on = c.getAttribute('data-lsk') === LS.key && !lsIsDefault();
      c.classList.toggle('sorted', on);
      const ar = c.querySelector('.arrow');
      if (ar) ar.textContent = on ? (LS.dir > 0 ? '↑' : '↓') : '↕';
      c.setAttribute('aria-sort', on ? (LS.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
  }
  (function bindListSort() {
    const th = document.getElementById('anThead');
    if (!th || th.__bound) return;
    th.__bound = 1;
    th.addEventListener('click', (e) => {
      const cell = e.target.closest ? e.target.closest('th[data-lsk]') : null;
      if (!cell) return;
      const k = cell.getAttribute('data-lsk');
      if (LS.key !== k) { LS.key = k; LS.dir = -1; }          // ① 按最大（降序）
      else if (LS.dir === -1) { LS.dir = 1; }                  // ② 按最小（升序）
      else { LS.key = LS_DEFAULT.key; LS.dir = LS_DEFAULT.dir; } // ③ 取消，回默认名次
      syncListArrows();
      renderFundList();
    });
  })();

  /* 口径说明顶部（#srcNoteTop）：净值估值日分布 **按当前选中发行人统计**（总体 = 全市场）+ 风险级别说明（全局）
     ——2026-10-14：此前该卡片始终按全市场统计，切换发行人后数字不跟随 */
  function renderSrcNoteTop() {
    const el = document.querySelector('#srcNoteTop');
    if (!el || !DATA.count) return;
    const funds = (DATA.funds || []).filter((x) =>
      (!S.trustee || x.trustee === S.trustee) && x.navStatus === 'verified' && x.nav != null);
    const map = {};
    funds.forEach((x) => { const k = x.navAsOf || 'none'; map[k] = (map[k] || 0) + 1; });
    const keys = Object.keys(map).filter((k) => k !== 'none').sort().reverse();
    if (map.none) keys.push('none');
    if (LV.navDate && keys.indexOf(LV.navDate) < 0) LV.navDate = '';   // 选中日期在新范围内不存在 → 清除
    const dist = '<div class="navdist">' + TT('净值估值日分布：') +
      keys.map((k) => '<b class="ndk' + (LV.navDate === k ? ' on' : '') + '" data-navdate="' + k + '">' +
        (k === 'none' ? TT('无估值日') : k.slice(5).replace('-', '/')) + ' ×' + map[k] + '</b>').join('') +
      '<i class="ndhint">' + TT('（点击任一标签只看对应条目）') + '</i>' +
      (S.trustee ? '<i class="ndhint">' + TQ('当前范围：{t}', { t: S.trustee }) + '</i>' : '') +
      '</div>';
    el.innerHTML = dist + MPF_RISK.legendHTML();
  }

  /* 2026-10-24：列表下方「净值估值日」卡片 → 点筛选（供 common.js 调用） */
  window.anSetNavDate = function (v) { LV.navDate = v; window.__MPF_NAVDATE = v; renderFundList(); };

  /* 口径说明·净值估值日分布（.ndk）：点击筛选下方基金列表（与资料库同语义，再点取消） */
  const LV = { navDate: '' };
  document.addEventListener('click', (e) => {
    const el = e.target.closest ? e.target.closest('.ndk') : null;
    if (!el) return;
    const v = el.getAttribute('data-navdate') || '';
    LV.navDate = LV.navDate === v ? '' : v;
    document.querySelectorAll('.ndk').forEach((x) => x.classList.toggle('on', x.getAttribute('data-navdate') === LV.navDate && !!LV.navDate));
    renderFundList();
    const t = $('#anListTitle');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  window.anClearFilters = function () {
    LV.navDate = '';
    document.querySelectorAll('.ndk').forEach((x) => x.classList.remove('on'));
    renderFundList();
  };

  function IN_CHART(id) {
    /* 勾选状态 = 该基金是否在走势图中 */
    return (TREND_MAIN && TREND_MAIN.getItems ? TREND_MAIN.getItems() : []).some((x) => x.type === 'fund' && String(x.id) === String(id));
  }
  document.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-qf]') : null;
    if (!b || !TREND_MAIN || !TREND_MAIN.setItems) return;
    const id = String(b.getAttribute('data-qf'));
    const cur = TREND_MAIN.getItems();
    const has = cur.some((x) => x.type === 'fund' && String(x.id) === id);
    let next;
    if (has) next = cur.filter((x) => !(x.type === 'fund' && String(x.id) === id));
    else next = cur.concat([{ type: 'fund', id: id }]).slice(0, 8);
    TREND_MAIN.setItems(next);   /* onSelChange → renderFundList（列表只显示已选，图表同步） */
  });

  function renderFundList() {
    const tb = $('#anTbody2');
    if (!tb || !DATA.count) return;
    /* 2026-10-15：走势图已勾选基金时，列表只显示所选（未选则维持按发行人筛选的全量） */
    const selFunds = (TREND_MAIN && TREND_MAIN.getItems ? TREND_MAIN.getItems() : []).filter((it) => it.type === 'fund');
    let base = (DATA.funds || []).filter((x) => !S.trustee || x.trustee === S.trustee);
    /* 估值日筛选（与资料库 app.js 同口径） */
    if (LV.navDate === 'none') base = base.filter((x) => x.navStatus === 'verified' && x.nav != null && !x.navAsOf);
    else if (LV.navDate) base = base.filter((x) => x.navStatus === 'verified' && x.nav != null && x.navAsOf === LV.navDate);
    const listAll = sortList(base);
    /* 2026-10-17：已选基金置顶（与其他基金用分隔线隔开），其余按原排序跟在后面 */
    const selSet = new Set(selFunds.map((it) => String(it.id)));
    /* 2026-10-21：已选基金不受当前发行人筛选影响（切发行人后仍要留在列表里） */
    const selRows = (DATA.funds || []).filter((x) => selSet.has(String(x.id)));
    const restRows = listAll.filter((x) => !selSet.has(String(x.id)));
    const list = restRows;
    const t = $('#anListTitle');
    if (t) {
      t.innerHTML = '<span class="an-lh-k">' + (S.trustee ? esc(S.trustee) : TT('总体')) + '</span> · ' +
        TQ('{n} 条基金', { n: '<b>' + listAll.length + '</b>' }) +
        (LV.navDate ? ' · <span class="an-lh-f">' + TQ('估值日：{v}', { v: LV.navDate === 'none' ? TT('无估值日') : LV.navDate }) + '</span>' : '');
    }
    /* 勾选的指数 → 列表行（最新点位 / 日涨跌 / YTD） */
    let IDXROWS = '';
    if (IDXDATA) {
      const idxItems = (TREND_MAIN && TREND_MAIN.getItems ? TREND_MAIN.getItems() : []).filter((it) => it.type === 'index');
      IDXROWS = idxItems.map((it) => {
        const m = IDXDATA[it.key];
        if (!m || !m.series || !m.series.length) return '';
        const s = m.series;
        const last = s[s.length - 1];
        const prev = s.length > 1 ? s[s.length - 2] : null;
        const chg = prev && prev[1] ? (last[1] / prev[1] - 1) * 100 : null;
        const jan1 = last[0].slice(0, 4) + '-01-01';
        let yi = -1;
        for (let q = 0; q < s.length; q++) { if (s[q][0] <= jan1) yi = q; else break; }
        const ytd = yi >= 0 ? (last[1] / s[yi][1] - 1) * 100 : null;
        /* 2026-10-19：指数也补「近1年年率化」（一年前最近一个点） */
        const cut1y = (function () {
          const d = new Date(last[0] + 'T00:00:00Z');
          d.setUTCFullYear(d.getUTCFullYear() - 1);
          return d.toISOString().slice(0, 10);
        })();
        let y1i = -1;
        for (let q = 0; q < s.length; q++) { if (s[q][0] <= cut1y) y1i = q; else break; }
        const y1 = y1i >= 0 ? (last[1] / s[y1i][1] - 1) * 100 : null;
        return '<tr class="idx-row">' +
          '<td class="fselcell"></td>' +
          '<td class="f-main fz" data-l="' + TT('基金名称') + '"><div class="fund-name">' + esc(m.name || it.key) + '<span class="tag unit">指数</span></div></td>' +
          '<td class="r num" data-l="' + TT('单位净值') + '"><span class="idx-pt" data-tip="' + esc(TT('指数显示的是点位（收市指数），不是单位净值')) + '">' + nf(last[1], 2) + '<em>' + TT('点位') + '</em></span></td>' +
          '<td class="r num" data-l="' + TT('日涨跌幅') + '">' + (chg == null ? '—' : '<span class="' + cls(chg) + '">' + pct(chg) + '</span>') + '</td>' +
          '<td class="r num" data-l="' + TT('年初至今') + '">' + (ytd == null ? '—' : '<span class="' + cls(ytd) + '">' + pct(ytd) + '</span>') + '</td>' +
          '<td class="r num" data-l="' + TT('近1年年率化') + '">' + (y1 == null ? '—' : '<span class="' + cls(y1) + '">' + pct(y1) + '</span>') + '</td>' +
          '<td class="c" data-l="' + TT('风险级别') + '">—</td>' +
          '<td class="r num" data-l="' + TT('基金规模（亿港元）') + '">—</td>' +
          '<td class="c num an-upd" data-l="' + TT('更新日期') + '">' + esc(last[0]) + '</td>' +
          '</tr>';
      }).join('');
    }
    const rowsHtml = [];
    if (IDXROWS) rowsHtml.push(IDXROWS);   /* 勾选的指数也显示（2026-10-17） */
    if (selRows.length) rowsHtml.push(selRows.map(rowHtml2).join(''));
    if ((selRows.length || IDXROWS) && restRows.length) rowsHtml.push('<tr class="qf-divider"><td colspan="9">' + (IDXROWS ? TT('以上是指数与已选基金') : TT('以上是已选基金')) + '</td></tr>');
    if (restRows.length) rowsHtml.push(restRows.map(rowHtml2).join(''));
    tb.innerHTML = rowsHtml.length
      ? rowsHtml.join('')
      : '<tr><td colspan="9"><div class="empty">' + TT('没有符合条件的基金') +
        (LV.navDate ? ' <button type="button" class="btn sm" style="margin-left:10px" onclick="window.anClearFilters && anClearFilters()">' + TT('一键清除筛选') + '</button>' : '') +
        '</div></td></tr>';
    /* B2：给表头挂口径提示（不改文字）；C2：aria-sort */
    const thead = document.getElementById('anThead');
    if (thead) {
      Array.prototype.forEach.call(thead.querySelectorAll('th'), (c) => {
        const txt = (c.textContent || '').replace(/[↕↑↓\s]/g, '');
        const tip = COL_TIPS[txt] || COL_TIPS[txt.replace(/（.*$/, '')];
        if (tip && !c.getAttribute('data-tip')) { c.setAttribute('data-tip', TT(tip)); c.style.cursor = 'help'; }
        if (c.hasAttribute('data-lsk')) {
          const on2 = c.getAttribute('data-lsk') === LS.key && !lsIsDefault();
          c.setAttribute('aria-sort', on2 ? (LS.dir > 0 ? 'ascending' : 'descending') : 'none');
          c.setAttribute('tabindex', '0');
        }
      });
    }
    syncListArrows();
  }

  /* C2：键盘操作（Enter / 空格 打开详情；表头 Enter 排序） */
  (function bindKeyboard() {
    const tb = document.getElementById('anTbody2');
    if (tb && !tb.__kb) {
      tb.__kb = 1;
      tb.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
        if (!tr) return;
        e.preventDefault();
        if (window.openDetail) window.openDetail(tr.getAttribute('data-id'));
      });
    }
    const th = document.getElementById('anThead');
    if (th && !th.__kb) {
      th.__kb = 1;
      th.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const c = e.target.closest ? e.target.closest('th[data-lsk]') : null;
        if (!c) return;
        e.preventDefault();
        c.click();
      });
    }
  })();

  function rowHtml2(x) {
    const selfTip = TT('自算口径：基于发行人官网每日净值（未含分红再投资与费用调整），与积金局「基金回报」期间与算法不同');
    const pendingTip = TT('历史净值回填后开放（其余受托人陆续接入）');
    const pf = PERF && PERF.funds ? PERF.funds[x.id] : null;
    const sizeYi = x.size == null ? null : x.size / 100; // 百万港元 → 亿港元
    const cell1 = pf && pf.d1 != null
      ? '<span class="' + cls(pf.d1) + '" data-tip="' + esc(selfTip + '　净值日 ' + (pf.asOf || '')) + '">' + pct(pf.d1) + '</span>'
      : '<span class="muted" data-tip="' + esc(pendingTip) + '">—</span>';
    const cellYtd = pf && pf.ytd != null
      ? '<span class="' + cls(pf.ytd) + '" data-tip="' + esc(selfTip + '　净值日 ' + (pf.asOf || '')) + '">' + pct(pf.ytd) + '</span>'
      : '<span class="muted" data-tip="' + esc(pendingTip) + '">—</span>';
    const canQ = !!(PERF && PERF.funds && PERF.funds[x.id]);   /* 无历史净值的基金不可勾（官方未发布） */
    /* B1（2026-10-21）：估值日超过 7 天 → 行淡化并标注「数据陈旧」 */
    /* G6（2026-10-22 核查报告）：陈旧判定不再用固定 7 天，改为与「全站最新净值日」比对，
       差 3 天及以上即标淡（源站有更新就能立刻反映，长假期也不会误报） */
    const maxAsOf = (DATA.funds || []).reduce((a, y) => (y.navAsOf && y.navAsOf > a ? y.navAsOf : a), '');
    const staleDays = (x.navAsOf && maxAsOf) ? Math.round((Date.parse(maxAsOf) - Date.parse(x.navAsOf)) / 86400000) : 0;
    const staleAttr = staleDays >= 3 ? ' class="an-stale" data-tip="' + esc(TQ('该基金净值截至 {d}，比全站最新（{m}）落后 {n} 天（源站未公布或抓取失败）', { d: x.navAsOf || '—', m: maxAsOf, n: staleDays })) + '"' : '';
    return '<tr data-id="' + esc(x.id) + '"' + staleAttr + ' tabindex="0" role="button" aria-label="' + esc(TT('查看') + (x.fundBase || x.fund) + TT('的详情')) + '">' +
      '<td class="fselcell" style="width:1%;padding:0 2px 0 12px">' + (canQ ? '<button type="button" class="fsel' + (IN_CHART(String(x.id)) ? ' on' : '') + '" data-qf="' + esc(x.id) + '" title="' + TT('加入对比（再点移出）') + '">' + (IN_CHART(String(x.id)) ? '×' : '') + '</button>' : '') + '</td>' +
      '<td class="f-main fz" data-l="' + TT('基金名称') + '">' +
        '<div class="fund-name">' + esc(x.fundBase || x.fund) + (x.unit ? '<span class="tag unit">' + TQ('{u} 类单位', { u: esc(x.unit) }) + '</span>' : '') + '</div>' +
      '</td>' +
      '<td class="r num" data-l="' + TT('单位净值') + '">' + navCell(x, true) + '</td>' +
      '<td class="r num" data-l="' + TT('日涨跌幅') + '">' + cell1 + '</td>' +
      '<td class="r num" data-l="' + TT('年初至今') + '">' + cellYtd + '</td>' +
      '<td class="r num" data-l="' + TT('近1年年率化') + '">' +
        (x.ann1 == null ? '<span class="muted">—</span>' : '<span class="' + cls(x.ann1) + '">' + pct(x.ann1) + '</span>') + '</td>' +
      '<td class="c" data-l="' + TT('风险级别') + '">' + riskTag(x.risk) + '</td>' +
      '<td class="r num" data-l="' + TT('基金规模（亿港元）') + '">' + (sizeYi == null ? '—' : nf(sizeYi, 2)) + '</td>' +
      '<td class="c num an-upd" data-l="' + TT('更新日期') + '">' + (x.navAsOf ? esc(x.navAsOf) : '—') + '</td>' +
      '</tr>';
  }

  /* 列表行点击 → 弹出基金详情（与资料库页面一致的「小窗」；带悬浮说明的单元格只弹说明） */
  document.addEventListener('click', (e) => {
    const tr = e.target.closest ? e.target.closest('#anTbody2 tr[data-id]') : null;
    if (!tr) return;
    if (e.target.closest('[data-tip], a, button, input, th')) return;
    const id = tr.getAttribute('data-id');
    if (window.openDetail) window.openDetail(id);
    else openAnalysis(id);
  });

  /** 当前筛选：受托人 → 基金 id 集合（总体 = 不筛选） */
  function filterOf() {
    if (!S.trustee) return { ids: null, label: '' };
    const ids = new Set((DATA.funds || []).filter((x) => x.trustee === S.trustee).map((x) => x.id));
    return { ids, label: S.trustee };
  }

  function findFund(id) { return DATA.funds.find((f) => f.id === id); }

  function renderBadge() {
    const el = $('#anBadge');
    if (!el) return;
    const arr = (DATA.funds || []).map((f) => f.navAsOf).filter(Boolean).sort();
    const latest = arr.length ? arr[arr.length - 1] : '—';
    const n = DATA.navStat || {};
    el.innerHTML = TQ('官方资料截至 {a} · 单位净值最新 {b} · 已核实 {v}/{t} 条', {
      a: '<b>' + esc(DATA.dataAsOf || '—') + '</b>',
      b: '<b>' + esc(latest) + '</b>',
      v: n.verified != null ? n.verified : '—',
      t: n.total || DATA.count || '—',
    });
  }

  /* ---------- 基金分析视图 ---------- */
  function openAnalysis(id, opts) {
    const x = findFund(id);
    if (!x) return;
    CUR = id;
    renderDetail(x);
    $('#anDetail').hidden = false;
    $('#anCompare').hidden = true;
    document.body.classList.add('an-detail');   /* 详情=纯放大：隐藏页脚（2026-10-15） */
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('open') !== id) {
        u.searchParams.set('open', id);
        /* 首次打开 = 新增历史记录（浏览器「返回」可直接关掉分析视图）；
           深链/前进后退恢复 = 替换当前记录，不污染历史 */
        if (opts && (opts.replace || opts.noPush)) history.replaceState({ mpfView: 'detail' }, '', u);
        else history.pushState({ mpfView: 'detail' }, '', u);
      }
    } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.anOpen = openAnalysis;

  /** 仅切换回对比视图（不动浏览器历史；供 popstate / 无历史时使用） */
  function showCompareView() {
    const d = $('#anDetail');
    const c = $('#anCompare');
    if (d) d.hidden = true;
    if (c) c.hidden = false;
    document.body.classList.remove('an-detail');
    CUR = '';
    if (TREND_MAIN) mountMain();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* A1（2026-10-21）：恢复「← 返回对比」—— 重构时丢失，点击会报 anBack is not a function。
     有本页历史（pushState 过）→ history.back()；深链/放大进入 → 清参数并切回对比视图。 */
  window.anBack = function () {
    try {
      const u = new URL(location.href);
      if (history.state && history.state.mpfView === 'detail') { history.back(); return; }
      if (u.searchParams.has('open')) { u.searchParams.delete('open'); history.replaceState(null, '', u); }
      showCompareView();
    } catch (e) { showCompareView(); }
  };

  /* 浏览器前进 / 后退：按地址栏状态恢复「对比视图 ↔ 分析视图」
     （2026-10-20 重构时此监听被误删，导致详情页按返回键无反应，此处恢复） */
  window.addEventListener('popstate', function () {
    if (!DATA.count) return;
    try {
      const want = new URLSearchParams(location.search).get('open');
      if (want && findFund(want)) openAnalysis(want, { replace: true });
      else if (CUR) showCompareView();
    } catch (e) {}
  });

  function renderDetail(x) {
    if (!x) return;
    const d = $('#anDetail');
    const pf = PERF && PERF.funds ? (PERF.funds[x.id] || null) : null;
    const tp = TPERF && TPERF.funds ? (TPERF.funds[x.id] || null) : null;
    /* 2026-10-20 v4：与小窗共用同一份渲染（顺序、模块完全一致）→「放大 = 纯粹放大」 */
    d.innerHTML =
      '<div class="an-dwrap">' +
        '<button type="button" class="an-back" onclick="window.anBack()">' + TT('← 返回对比') + '</button>' +
        window.fundDetailHTML(x, { withTitle: true, perf: pf, tperf: tp }) +
        '<div class="an-actions">' +
          '<button type="button" class="btn ghost sm" id="anDcaBtn" data-i18n-title="用这只基金做供款（定投）试算">' + TT('供款试算') + '</button>' +
          '<button type="button" class="btn ghost sm" id="anPlanBtn" data-i18n-title="与该基金同一基金类型、规模最大的另外几只一键对比">' + TT('同类型对比') + '</button>' +
          '<button type="button" class="btn ghost sm" id="anExpBtn">' + TT('导出') + '</button>' +
          '<button type="button" class="btn ghost sm" id="anShrBtn">' + TT('分享') + '</button>' +
          '<span class="sep"></span>' +
          (x.navSourceUrl ? '<a class="btn ghost sm" href="' + esc(x.navSourceUrl) + '" target="_blank" rel="noopener"' +
            (/fidelity\.com\.hk|manulife\.com\.hk/.test(x.navSourceUrl) ? ' title="' + TT('该官网有反爬，若打不开请在浏览器地址栏直接访问') + '"' : '') +
            '>' + TT('打开官方页面核对') + ' ↗</a>' : '') +
          /* 2026-10-23：来源长期未更新的基金，明确标出（如新地只有月度 PDF、宏利利息基金官网不更新） */
          (x.navStale ? '<span class="hl-src hl-stale" title="' + TT('该发行人官网尚未发布更新的净值') + '">' + TQ('来源已 {n} 天未更新', { n: Math.round((Date.now() - new Date(x.navAsOf + 'T00:00:00').getTime()) / 864e5) }) + '</span>' : '') +
          (x.id ? '<a class="btn ghost sm" href="https://mfp.mpfa.org.hk/mobile/tch/cf_detail.jsp?cf_id=' + esc(x.id) + '" target="_blank" rel="noopener">' + TT('积金局基金详情') + ' ↗</a>' : '') +
        '</div>' +
      '</div>';
    bindDetail(x);
    /* 走势图：只画本基金（bareHead → 不渲染「净值走势｜导出｜分享」行，保留上方小标题） */
    if (window.mountFD) window.mountFD(x);
    else {
      const tb = $('#fdTrend');
      if (tb && window.TREND && pf) TREND.mount(tb, [{ type: 'fund', id: x.id }], { bareHead: true, hideGoto: true });
    }
    if (window.fillFDHolds) window.fillFDHolds(x);
  }

  function bindDetail(x) {
    const dca = document.querySelector('#anDcaBtn');
    if (dca) dca.addEventListener('click', () => { if (window.mpfOpenDCA) window.mpfOpenDCA(x.id); });
    /* 2026-10-20：详情页不再提供「加入对比」（用户要求；对比从列表勾选进入） */
    const eb = document.querySelector('#anExpBtn');
    /* 2026-10-21：详情页导出同样走工作簿（含走势图） */
    if (eb) eb.addEventListener('click', () => { if (window.__trendExportBook) window.__trendExportBook(); else exportOneFund(x); });
    const sb = document.querySelector('#anShrBtn');
    if (sb) sb.addEventListener('click', () => shareFundLink(x.id));
    /* 同类型对比（2026-10-15 修复：此前 anBack+setItems 与 popstate 竞态会立即被默认组合覆盖）：
       改为写入 ?set= 深链后直接切换回对比视图，mountMain 会按 set 还原组合（可分享） */
    const pb = document.querySelector('#anPlanBtn');
    if (pb) pb.addEventListener('click', () => {
      const sib = (DATA.funds || [])
        .filter((y) => y.typeFull === x.typeFull && y.id !== x.id && y.navStatus !== 'na')
        .sort((a, b) => (b.size || 0) - (a.size || 0));
      const p = (TREND_MAIN && TREND_MAIN.getPerf && TREND_MAIN.getPerf()) || PERF;
      const withHist = sib.filter((y) => p && p.funds && p.funds[y.id]);
      const pick = (withHist.length ? withHist : sib).slice(0, 3);
      if (!pick.length) { if (window.mpfToast) mpfToast(TQ('「{t}」暂无其他可对比基金', { t: x.typeFull || TT('该类型') })); return; }
      const items = [{ type: 'fund', id: x.id }].concat(pick.map((y) => ({ type: 'fund', id: y.id }))).slice(0, 4);
      const setStr = items.map((it) => 'f:' + it.id).join(',');
      try {
        const u = new URL(location.href);
        u.searchParams.delete('open');
        u.searchParams.set('set', setStr);
        history.pushState({ mpfView: 'compare' }, '', u);
      } catch (e) { /* 忽略 */ }
      showCompareView();   /* 内部 mountMain() 会读取 URL 上的 set → 载入同类型组合 */
      if (window.mpfToast) mpfToast(TQ('已载入同类型对比：本基金 + {n} 只同类型基金', { n: pick.length }));
    });
  }

  window.__initCalled = 1;
  init();
})();
