/* 板块一：强积金资料库 */
(function () {
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
    fund: '成分基金名称', trustee: '受托人', typeFull: '基金种类',
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

  function bindSelfTabs() {
    const sel = document.getElementById('dimSel');
    if (!sel) return;
    const fill = () => {
      sel.innerHTML = '<option value="">' + TT('无') + '</option>' +
        DIMS.map((d) => '<option value="' + d[0] + '">' + esc(TT(d[1])) + '</option>').join('');
      sel.value = (window.__dimActive && S.key) ? S.key : '';
    };
    fill();
    if (!window.__dimSelLangBound) {
      window.__dimSelLangBound = 1;
      document.addEventListener('mpf:lang', () => {
        const s2 = document.getElementById('dimSel');
        if (s2) { s2.innerHTML = '<option value="">' + TT('无') + '</option>' +
          DIMS.map((d) => '<option value="' + d[0] + '">' + esc(TT(d[1])) + '</option>').join('');
          s2.value = (window.__dimActive && S.key) ? S.key : ''; }
      });
    }
    if (sel.__bound) return;
    sel.__bound = 1;
    sel.addEventListener('change', () => {
      const k = sel.value;
      if (!k) { window.__dimCancel(); return; }
      const d = DIMS.find((x) => x[0] === k);
      window.__dimApply(k, d ? d[2] : 'desc');
    });
    /* 供下拉与表头共同使用的状态机 */
    window.__dimApply = (k, first) => {
      S.key = k; S.dir = first;
      /* 联动放出：非默认列临时显示（不写 colSet，刷新后回到用户自己的列设置） */
      DIM_EXTRA = (COL_DEFS.find((c) => c.k === k) && COL_DEFAULT.indexOf(k) < 0) ? k : '';
      S.page = 1;
      const th = document.getElementById('thead');
      if (th) th.querySelectorAll('th.sorted').forEach((n) => {
        n.classList.remove('sorted');
        const a = n.querySelector('.arrow');
        if (a) a.textContent = '↕';
      });
      window.__dimActive = true;
      render();
    };
    window.__dimCancel = () => {
      S.key = 'size'; S.dir = 'desc'; DIM_EXTRA = ''; S.page = 1;
      window.__dimActive = false;
      render();
    };
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
    });
    // 语言切换后重绘整表（表头 data-l 标签、详情按钮、净值悬浮说明等）
    /* 2026-11-01（6.0）：下拉 option 是 JS 生成的，必须在语言切换时一并重建，
       否则繁/英模式下仍停留上一语言的文案（曾出现繁体页下拉全是简体）。 */
    document.addEventListener('mpf:lang', () => { if (DATA.count) { buildFilters(); render(); } });
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
    fill('#fRisk', uniq(f.map((x) => x.risk)).sort((a, b) => a - b), (v) => TQ('风险级别 {n}', { n: v }));
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
    el.addEventListener('change', () => { S.key = el.value; S.page = 1; render(); });
    $('#mSortDir').addEventListener('click', () => {
      S.dir = S.dir === 'asc' ? 'desc' : 'asc';
      $('#mSortDir').textContent = S.dir === 'asc' ? TT('升序 ↑') : TT('降序 ↓');
      render();
    });
  }

  /** 导出当前筛选结果（全部行，非仅当前页，CSV；Excel 直接打开） */
  function exportIdx() {
    const head = [TT('成分基金'), TT('单位类别'), TT('基金种类'), TT('强积金计划'), TT('受托人'), TT('风险级别'),
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
    ['#kw', '#fType', '#fTrustee', '#fRisk', '#fRetMin', '#fRetMax', '#fDdMin', '#fDdMax', '#fFeeMax'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
    /* 2026-10-31（用户要求）：涨跌幅/回撤/费率第二行筛选已下线 */
    document.querySelectorAll('.ndk').forEach((el) => el.classList.remove('on'));
    fillSub(); S.page = 1; render();
  }
  window.clearAllFilters = resetAll;   // 空态「一键清除」入口（2026-10-14；筛选行/重置按钮 2026-10-31 应用户要求删除）

  /* ---------- 列设置（2026-10-14）：勾选显示列 + 精简模式 ---------- */
  /* 2026-10-19：列序对齐「基金最新数据」表格（名次 + 自算指标） */
  const COL_DEFS = [
    { i: 1, k: 'rank', n: '名次', lock: true },
    { i: 3, k: 'fund', n: '成分基金' },
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
  const COL_DEFAULT = ['rank', 'fund', 'trustee', 'risk', 'nav',
    'selfD1', 'selfM1', 'selfYtd', 'selfY1', 'selfY3a', 'selfMdd', 'size', 'cmp', 'ops'];
  /* 2026-10-27（用户要求）：「精简模式」下线，改为「默认模式」——一键回到用户指定的 14 列 */
  let colSet = null;
  let DIM_EXTRA = '';   /* 2026-10-27：维度联动临时放出的列（不持久化） */
  try { const raw = localStorage.getItem('mpf-cols-v7'); colSet = raw ? new Set(JSON.parse(raw)) : null; } catch (e) { colSet = null; }
  if (!colSet || !colSet.size) colSet = new Set(COL_DEFAULT);
  function applyCols(save) {
    if (save !== false) { try { localStorage.setItem('mpf-cols-v7', JSON.stringify([...colSet])); } catch (e) {} }
    /* 2026-10-26 重做：列显隐改为「不渲染」（visibleOrder 过滤），不再用 CSS 隐藏——
       与维度列插队机制统一，从机制上杜绝表头/表体错位 */
    try { localStorage.removeItem('mpf-cols-v5'); localStorage.removeItem('mpf-cols-v6'); } catch (e) {}
    if (typeof DATA !== 'undefined' && DATA && DATA.funds) render();   /* 列设置变更立即生效 */
    const same = (a) => a.length === colSet.size && a.every((k) => colSet.has(k));
    const defOn = same(COL_DEFAULT);
    const bS = document.getElementById('colSlim');
    if (bS) bS.classList.toggle('on', defOn);
    const bA = document.getElementById('colAll');
    if (bA) bA.classList.toggle('on', !defOn && colSet.size === COL_DEFS.length);
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
      '<div class="cp-btns"><button type="button" class="cp-b" id="colSlim">' + TT('默认模式') + '</button>' +
      '<button type="button" class="cp-b" id="colAll">' + TT('全部列') + '</button></div>' +
      '<div class="cp-list" id="colChecks">' + COL_DEFS.map((c) =>
        '<label' + (c.lock ? ' class="cp-lock"' : '') + '><input type="checkbox" value="' + c.k + '"' + (c.lock ? ' disabled checked' : '') + '>' + TT(c.n) + '</label>').join('') + '</div>';
    host.parentNode.insertBefore(pop, host.nextSibling);
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; applyCols(false); });
    document.getElementById('colClose').addEventListener('click', () => { pop.hidden = true; });
    document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('#colPop') && e.target.id !== 'colBtn') pop.hidden = true; });
    document.getElementById('colSlim').addEventListener('click', () => { colSet = new Set(COL_DEFAULT); applyCols(); });
    document.getElementById('colAll').addEventListener('click', () => { colSet = new Set(COL_DEFS.map((c) => c.k)); applyCols(); });
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
    $('#fTrustee').addEventListener('change', () => { F.trustee = $('#fTrustee').value; S.page = 1; render(); });
    $('#fRisk').addEventListener('change', () => { F.risk = $('#fRisk').value; S.page = 1; render(); });
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
      if (F.risk !== '' && String(x.risk) !== String(F.risk)) return false;
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

  function render() {
    if (!DATA || !DATA.funds) return;   /* applyCols 可能在数据加载前触发 */
    /* 2026-11-01（6.0）：兜底补挂自算指标——rank/analysis 板块后加载会整体替换 DATA，
       不补挂就会出现「筛选后所有自算列变 —」。幂等、451 条开销可忽略。 */
    if (window.__PERF_JSON) window.decorateSelfPerf(DATA.funds, window.__PERF_JSON);
    ROWS = sortRows(filtered(), S.key, S.dir);
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
    if (window.__dimActive && S.key && S.key !== 'size') {
      $$('#fundTable [data-c="' + S.key + '"]').forEach((n) => n.classList.add('dim-hl'));
    }
    // 表格内勾选 → 加入/移出对比（与排名页共用 CMPX；页底对比栏随之出现）
    $$('#tbody input[data-cmp]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) { if (!CMPX.add(c.dataset.cmp)) c.checked = false; } else CMPX.remove(c.dataset.cmp);
      renderCmpBar();
    }));

    /* 2026-10-23（核验报告）：筛选后明确写「已筛选」，避免把「全市场 451」误读成计数没刷新 */
    /* 2026-10-31（用户要求）：不再显示（全市场） */
    $('#cntTip').textContent = '';
    renderPager(pages, total);
    if (window.__syncTableScroll) window.__syncTableScroll();
  }

  /* ═══ 2026-10-26 重做：列顺序数组单源 ═══
     此前「移动 thead 的 DOM」方案在 tbody 重渲染后表头/表体错位（数据装反）——已废弃。
     现在 thead 与 tbody 都由同一个可见列顺序数组生成，物理上不可能错位。 */
  const CELL_FNS = {
    rank: (x, rk) => '<td data-c="rank" class="c" data-l="' + TT('名次') + '">' +
      (rk != null && rk <= 3 ? '<span class="medal g' + rk + '">' + rk + '</span>' : '<span class="rank-cell">' + (rk || '') + '</span>') + '</td>',
    cmp: (x) => '<td data-c="cmp" class="c" data-l="' + TT('对比') + '"><input type="checkbox" data-cmp="' + esc(x.id) + '"' + (CMPX.has(x.id) ? ' checked' : '') + '></td>',
    fund: (x) => '<td data-c="fund" class="f-main fz" data-l="' + TT('成分基金') + '"><div class="fund-name" style="cursor:pointer" onclick="openDetail(\'' + esc(x.id) + '\')">' + esc(x.fundBase || x.fund) + (x.unit ? '<span class="tag unit">' + TQ('{u} 类单位', { u: esc(x.unit) }) + '</span>' : '') + '</div>' +
      (x.groupSize > 1 ? '<div class="cell-sub">' + TQ('{n} 个单位类别', { n: x.groupSize }) + '</div>' : '') + '</td>',
    trustee: (x) => '<td data-c="trustee" data-l="' + TT('受托人') + '"><span class="tag">' + esc(x.trustee) + '</span></td>',
    type: (x) => '<td data-c="type" data-l="' + TT('基金种类') + '"><span class="tag g">' + esc(typeLabel(x.type)) + '</span>' +
      '<div class="cell-sub">' + esc(typeLabel(x.subtype || x.type)) + '</div></td>',
    risk: (x) => '<td data-c="risk" data-l="' + TT('风险级别') + '" class="c">' + riskTag(x.risk) + '</td>',
    nav: (x) => '<td data-c="nav" data-l="' + TT('单位资产净值') + '" class="r num">' + navCell(x) + '</td>',
    selfD1: (x) => '<td data-c="selfD1" data-l="' + TT('日涨跌') + '" class="r num ' + cls(x.selfD1) + '">' + pct(x.selfD1) + '</td>',
    selfW1: (x) => '<td data-c="selfW1" data-l="' + TT('近1周') + '" class="r num ' + cls(x.selfW1) + '">' + pct(x.selfW1) + '</td>',
    selfM1: (x) => '<td data-c="selfM1" data-l="' + TT('近1个月') + '" class="r num ' + cls(x.selfM1) + '">' + pct(x.selfM1) + '</td>',
    selfYtd: (x) => '<td data-c="selfYtd" data-l="' + TT('年初至今') + '" class="r num ' + cls(x.selfYtd) + '">' + pct(x.selfYtd) + '</td>',
    selfY1: (x) => '<td data-c="selfY1" data-l="' + TT('近1年') + '" class="r num ' + cls(x.selfY1) + '">' + pct(x.selfY1) + '</td>',
    selfY3a: (x) => { const t = x.selfY3a == null ? naWhy(x, 3, TT('近3年年化')) : ''; return '<td data-c="selfY3a" data-l="' + TT('近3年年化') + '" class="r num ' + cls(x.selfY3a) + '"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.selfY3a) + '</td>'; },
    selfY5a: (x) => { const t = x.selfY5a == null ? naWhy(x, 5, TT('近5年年化')) : ''; return '<td data-c="selfY5a" data-l="' + TT('近5年年化') + '" class="r num ' + cls(x.selfY5a) + '"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.selfY5a) + '</td>'; },
    selfMdd: (x) => '<td data-c="selfMdd" data-l="' + TT('近1年最大回撤') + '" class="r num down">' + pct(x.selfMdd) + '</td>',
    selfMdd5: (x) => { const t = x.selfMdd5 == null ? naWhy(x, 5, TT('近5年最大回撤')) : ''; return '<td data-c="selfMdd5" data-l="' + TT('近5年最大回撤') + '" class="r num down"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.selfMdd5) + '</td>'; },
    vol1: (x) => '<td data-c="vol1" data-l="' + TT('年化波动率（近1年）') + '" class="r num">' + pct(x.vol1) + '</td>',
    vol3: (x) => { const t = x.vol3 == null ? naWhy(x, 3, TT('3年波幅')) : ''; return '<td data-c="vol3" data-l="' + TT('3年波幅') + '" class="r num"' + (t ? ' data-tip="' + esc(t) + '"' : '') + '>' + pct(x.vol3) + '</td>'; },
    sharpe1: (x) => '<td data-c="sharpe1" data-l="' + TT('夏普比率（近1年）') + '" class="r num">' + (x.sharpe1 == null ? '—' : x.sharpe1.toFixed(2)) + '</td>',
    excess1: (x) => '<td data-c="excess1" data-l="' + TT('超额收益（对恒指·近1年）') + '" class="r num ' + cls(x.excess1) + '">' + pct(x.excess1) + '</td>',
    posM12: (x) => '<td data-c="posM12" data-l="' + TT('正收益月份占比') + '" class="r num">' + (x.posM12 == null ? '—' : x.posM12.toFixed(0) + '%') + '</td>',
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
    fund: '<th data-c="fund" data-i18n-parts data-k="fund" data-defdir="asc" class="sortable fz">成分基金 <span class="arrow">↕</span></th>',
    trustee: '<th data-c="trustee" data-i18n-parts data-k="trustee" data-defdir="asc" class="sortable">受托人 <span class="arrow">↕</span></th>',
    type: '<th data-c="type" data-i18n-parts data-k="typeFull" data-defdir="asc" class="sortable">基金种类 <span class="arrow">↕</span></th>',
    risk: '<th data-c="risk" data-i18n-parts data-k="risk" data-defdir="asc" class="sortable c">风险<br>级别 <span class="arrow">↕</span></th>',
    nav: '<th data-c="nav" data-i18n-parts data-k="nav" data-defdir="desc" class="sortable r">单位资产净值<br><small>取自各受托人官网</small> <span class="arrow">↕</span></th>',
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
      return d.lock || colSet.has(k) || k === DIM_EXTRA;
    });
    if (window.__dimActive && S.key && S.key !== 'size' && S.key !== 'risk' && order.indexOf(S.key) >= 0) {
      order = order.filter((k) => k !== S.key);
      const ri = order.indexOf('risk');
      if (ri >= 0) order.splice(ri + 1, 0, S.key);
    }
    return order;
  }
  function renderThead(order) {
    const th = document.getElementById('thead');
    if (th) th.innerHTML = order.map((k) => TH_HTML[k] || '').join('');
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
