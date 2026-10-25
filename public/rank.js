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
  if (/^self/i.test(QSB) && !/index\.html$/.test(location.pathname)) {
    location.replace('index.html#db');
  }
  const S = {
    // 2026-10-19：默认改为「自算·近1年」——积金局月报截至上月月底，比官网净值慢 2–6 周
    board: BOARDS.some((b) => b.id === HASH0) ? HASH0 : (BOARDS.some((b) => b.id === QSB) ? QSB : 'ann1'),
    type: '', sub: '', risk: '', trustee: '', kw: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '', top: 10, sortKey: null, sortDir: null, calYear: '',
  };
  let FUND_HEAD = '';   // 基金榜表头（初始 DOM 快照，切换回来时还原）
  let HEAD_MODE = '';   // 当前表头模式，避免重复重绘
  let PERFD = null;     // 自算净值指标（/api/navperf，覆盖已接入历史净值的基金）
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function cur() { return BOARDS.find((b) => b.id === S.board); }

  function init() {
    mountHeader('db');   /* 2026-10-15：合并页导航项为「强积金资料库」（key=db），此前传 rk 导致无高亮 */
    loadData(() => {
      S.calYear = (DATA.years && DATA.years[0]) || String(new Date().getFullYear() - 1);
      buildTabs();
      const sd = document.querySelector('#rkScopeDate');
      if (sd && DATA.dataAsOf) sd.textContent = DATA.dataAsOf;
      buildFilters();
      buildMobileSort();
      initDualScroll('#rkTscroll', '#rkTopScroll', '#rkScrollGhost');
      FUND_HEAD = $('#rkThead').innerHTML;
      // 排名页表头排序由本页状态管理（名次列始终按榜单指标）
      bindHeadSort();
      bind();
      window.__onRefresh = () => { buildFilters(); render(); };
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
  function bindHeadSort() {
    $$('#rkThead th[data-k]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.k;
        const d0 = th.dataset.defdir || 'desc';
        if (S.sortKey !== k) { S.sortKey = k; S.sortDir = d0; }
        else if (S.sortDir === d0) { S.sortDir = flip(d0); }
        else { S.sortKey = null; S.sortDir = null; }   // ③ 取消
        render();
      });
    });
  }

  /** 发行人实力榜列结构不同，切换榜单时整体替换表头。
      文案全部经过 TT()，切换语言后由 mpf:lang 监听重建即可跟随。 */
  const aggHead = () =>
    '<th class="c" style="width:56px">' + TT('名次') + '</th>' +
    '<th data-k="fund" data-defdir="asc" class="sortable fz">' + TT('发行人（受托人）') + ' <span class="arrow">↕</span></th>' +
    '<th data-k="count" data-defdir="desc" class="sortable r">' + TT('成分') + '<br>' + TT('基金数') + ' <span class="arrow">↕</span></th>' +
    '<th data-k="sizeSum" data-defdir="desc" class="sortable r">' + TT('总规模') + '<br><small>' + TT('百万港元') + '</small> <span class="arrow">↕</span></th>' +
    '<th data-k="ann1Avg" data-defdir="desc" class="sortable r">' + TT('平均近1年') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th data-k="ann5Avg" data-defdir="desc" class="sortable r">' + TT('平均近5年') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th data-k="ann10Avg" data-defdir="desc" class="sortable r">' + TT('平均近10年') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th data-k="annLaunchAvg" data-defdir="desc" class="sortable r">' + TT('平均推出至今') + '<br>' + TT('年率化') + ' <span class="arrow">↕</span></th>' +
    '<th data-k="mgmtFee" data-defdir="asc" class="sortable r">' + TT('平均管理费') + '<br><small>% p.a.</small> <span class="arrow">↕</span></th>' +
    '<th class="r" title="' + TT('已从该受托人官网核对到最新单位资产净值的基金数 / 旗下基金总数') + '">' + TT('净值') + '<br>' + TT('核实率') + '</th>' +
    '<th class="c" style="width:86px">' + TT('详情') + '</th>';

  function applyHeader(b, isCal) {
    const mode = b.self ? 'self' : (b.agg === 'trustee' ? 'agg' : 'fund');
    if (mode !== HEAD_MODE) {
      $('#rkThead').innerHTML = mode === 'agg' ? aggHead() : (mode === 'self' ? selfHead() : FUND_HEAD);
      HEAD_MODE = mode;
      bindHeadSort();
    }
    const thCal = $('#rkThCalYear');
    if (thCal) thCal.style.display = mode === 'fund' && isCal ? '' : 'none';
    /* 2026-10-19：列设置按当前榜单模式重新套用（各模式列数不同） */
    window.__rkMode = mode;
    window.__rkIsCal = !!isCal;
    if (typeof window.__rkApplyCols === 'function') window.__rkApplyCols();
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
    '<th data-i18n-parts class="c" style="width:56px">' + TT('名次') + '</th>' +
    '<th data-i18n-parts data-k="fund" data-defdir="asc" class="sortable fz">' + TT('成分基金') + ' <span class="arrow">↕</span></th>' +
    '<th data-i18n-parts data-k="trustee" data-defdir="asc" class="sortable">' + TT('发行人') + ' <span class="arrow">↕</span></th>' +
    '<th data-i18n-parts data-k="typeFull" data-defdir="asc" class="sortable">' + TT('基金种类') + ' <span class="arrow">↕</span></th>' +
    '<th data-i18n-parts data-k="risk" data-defdir="asc" class="sortable c">' + TT('风险') + ' <span class="arrow">↕</span></th>' +
    '<th data-i18n-parts data-k="size" data-defdir="desc" class="sortable r">' + TT('基金规模') + '<br><small>' + TT('百万港元') + '</small> <span class="arrow">↕</span></th>' +
    SELF_COLS.map(([k, n, d]) =>
      '<th data-i18n-parts data-k="' + k + '" data-defdir="' + d + '" class="sortable r">' + TT(n) + ' <span class="arrow">↕</span></th>').join('') +
    '<th data-i18n-parts class="c" style="width:56px">' + TT('对比') + '</th>' +
    '<th data-i18n-parts class="c" style="width:86px">' + TT('详情') + '</th>';

  function buildTabs() {
    // 榜单较多，按主题分组展示，避免一排长标签难以定位
    const groups = [];
    BOARDS.forEach((b) => {
      let g = null;
      for (const x of groups) if (x.name === b.g) { g = x; break; }
      if (!g) { g = { name: b.g, list: [] }; groups.push(g); }
      g.list.push(b);
    });
    const onGroup = (g) => (g.list.some((b) => b.id === S.board) ? ' on-group' : '');
    $('#rkTabs').innerHTML = groups.map((g) =>
      '<div class="tab-group' + onGroup(g) + '">' +
        '<span class="tg-label">' + esc(TT(g.name)) + '</span>' +
        '<div class="tg-items">' + g.list.map((b) =>
          '<button class="tab' + (b.id === S.board ? ' on' : '') + '" data-b="' + b.id + '">' + esc(TT(b.name)) + '</button>'
        ).join('') + '</div>' +
      '</div>'
    ).join('');

    // 维度提示：让客户一眼知道共有多少个排名维度，而不是以为只有一份榜
    const note = $('#rkTabsNote');
    if (note) note.innerHTML = TQ('共 <b>{n}</b> 个排名维度 · {g} 组 · 点击任意标签切换', { n: BOARDS.length, g: groups.length });
    const tg = $('#rkTabsToggle');
    if (tg) {
      const syncTg = () => {
        tg.textContent = $('#rkTabs').classList.contains('mini') ? TT('点此展开全部') : TT('收起全部');
      };
      if (!tg.__bound) {
        tg.__bound = 1;
        tg.addEventListener('click', () => {
          $('#rkTabs').classList.toggle('mini');
          $$('#rkTabs .tab-group').forEach((el) => el.classList.remove('on-group'));
          const curG = groups.filter((g) => g.list.some((b) => b.id === S.board))[0];
          if (curG && $('#rkTabs').classList.contains('mini')) {
            const idx = groups.indexOf(curG);
            const el = $$('#rkTabs .tab-group')[idx];
            if (el) el.classList.add('on-group');
          }
          syncTg();
        });
      }
      syncTg();
    }

    $$('#rkTabs .tab').forEach((t) => t.addEventListener('click', () => {
      S.board = t.dataset.b;
      S.sortKey = null; S.sortDir = null;
      if (history.replaceState) history.replaceState(null, '', '#' + t.dataset.b);
      $$('#rkTabs .tab').forEach((o) => o.classList.remove('on'));
      t.classList.add('on');
      $$('#rkTabs .tab-group').forEach((el) => el.classList.remove('on-group'));
      if (t.closest('.tab-group')) t.closest('.tab-group').classList.add('on-group');
      renderYearSwitch();
      render();
    }));
    renderYearSwitch();
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
      render();
    }));
  }

  function buildFilters() {
    const f = DATA.funds;
    fill('#rkRType', uniq(f.map((x) => x.type)), (v) => typeLabel(v));
    fill('#rkRTrustee', uniq(f.map((x) => x.trustee)));
  }

  function fill(sel, arr) {
    const el = $(sel);
    const cur = el.value;
    el.innerHTML = '<option value="">' + el.options[0].text + '</option>';
    arr.sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
    arr.forEach((v) => {
      const o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o);
    });
    if (arr.indexOf(cur) >= 0) el.value = cur;
  }

  function buildMobileSort() {
    const keys = { ann1: '近1年年率化', ann5: '近5年年率化', ann10: '近10年年率化', annLaunch: '推出至今年率化', worstYear: '近5年最差年度', mgmtFee: '基金管理费', size: '基金规模', risk: '风险级别', nav: '单位资产净值', calYear: '历年回报' };
    const el = $('#rkMSortKey');
    el.innerHTML = Object.keys(keys).map((k) => '<option value="' + k + '">' + TT(keys[k]) + '</option>').join('');
    el.addEventListener('change', () => { S.sortKey = el.value; S.sortDir = 'desc'; render(); });
    $('#rkMSortDir').addEventListener('click', () => {
      S.sortDir = flip(S.sortDir || 'desc');
      $('#rkMSortDir').textContent = S.sortDir === 'asc' ? '升序 ↑' : '降序 ↓';
      render();
    });
  }

  function bind() {
    $('#rkRType').addEventListener('change', () => { S.type = $('#rkRType').value; render(); });
    $('#rkRTrustee').addEventListener('change', () => { S.trustee = $('#rkRTrustee').value; render(); });
    $('#rkRTop').addEventListener('change', () => { S.top = parseInt($('#rkRTop').value, 10); render(); });
    var kwEl = document.querySelector('#rkKw');
    if (kwEl) kwEl.addEventListener('input', function () { S.kw = this.value.trim(); render(); });

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
          render();
        });
      };
      setK('#rkRType', 'type'); setK('#rkRSub', 'sub');
      setK('#rkRTrustee', 'trustee'); setK('#rkRRisk', 'risk');
      setK('#rkRRetDim', 'retDim'); setK('#rkRRetMin', 'retMin', 1); setK('#rkRRetMax', 'retMax', 1);
      setK('#rkRDdMin', 'ddMin', 1); setK('#rkRDdMax', 'ddMax', 1); setK('#rkRFeeMax', 'feeMax', 1);

      /* 细类 / 风险级别选项 */
      const sub = document.querySelector('#rkRSub');
      if (sub && sub.options.length <= 1) {
        [...new Set(DATA.funds.map((x) => x.subtype).filter(Boolean))].sort().forEach((v) => {
          const o = document.createElement('option'); o.value = v; o.textContent = typeLabel(v); sub.appendChild(o);
        });
      }
      const rk = document.querySelector('#rkRRisk');
      if (rk && rk.options.length <= 1) {
        [...new Set(DATA.funds.map((x) => x.risk).filter((v) => v != null))].sort((a, b) => a - b).forEach((v) => {
          const o = document.createElement('option'); o.value = v; o.textContent = v + ' ' + TT('级'); rk.appendChild(o);
        });
      }
      const rst = document.querySelector('#rkRReset');
      if (rst) rst.addEventListener('click', () => {
        Object.assign(S, { type: '', sub: '', risk: '', trustee: '', kw: '', retDim: 'ann1', retMin: '', retMax: '', ddMin: '', ddMax: '', feeMax: '' });
        document.querySelectorAll('#rkKW,#rkKw,#rkRType,#rkRSub,#rkRTrustee,#rkRRisk,#rkRRetMin,#rkRRetMax,#rkRDdMin,#rkRDdMax,#rkRFeeMax').forEach((el) => {
          if (el.tagName === 'INPUT') el.value = ''; else if (el.options) el.selectedIndex = 0;
        });
        render();
      });
    })();
    const re = $('#rkRExport');
    if (re) re.addEventListener('click', exportCurrent);
  }

  function pool() {
    const b = cur();
    let arr = DATA.funds.filter((x) => {
      if (S.type && x.type !== S.type) return false;
      if (S.sub && x.subtype !== S.sub) return false;
      if (S.trustee && x.trustee !== S.trustee) return false;
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
    if (S.type) c.push([TQ('种类：{v}', { v: typeLabel(S.type) }), 'type']);
    if (S.sub) c.push([TQ('细类：{v}', { v: typeLabel(S.sub) }), 'sub']);
    if (S.trustee) c.push([TQ('发行人：{v}', { v: S.trustee }), 'trustee']);
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
      else if (k === 'type') { S.type = ''; const i = document.querySelector('#rkRType'); if (i) i.selectedIndex = 0; }
      else if (k === 'sub') { S.sub = ''; const i = document.querySelector('#rkRSub'); if (i) i.selectedIndex = 0; }
      else if (k === 'trustee') { S.trustee = ''; const i = document.querySelector('#rkRTrustee'); if (i) i.selectedIndex = 0; }
      else if (k === 'risk') { S.risk = ''; const i = document.querySelector('#rkRRisk'); if (i) i.selectedIndex = 0; }
      else if (k === 'ret') { S.retMin = S.retMax = ''; ['#rkRRetMin', '#rkRRetMax'].forEach((q) => { const i = document.querySelector(q); if (i) i.value = ''; }); }
      else if (k === 'dd') { S.ddMin = S.ddMax = ''; ['#rkRDdMin', '#rkRDdMax'].forEach((q) => { const i = document.querySelector(q); if (i) i.value = ''; }); }
      else if (k === 'fee') { S.feeMax = ''; const i = document.querySelector('#rkRFeeMax'); if (i) i.value = ''; }
      render();
    }));
  }

  function render() {
    const b = cur();
    const isCal = b.id === 'calYear';
    $('#rkLoading').style.display = 'none';
    $('#rkBoardTitle').textContent = isCal ? TQ('{y} 年回报榜', { y: S.calYear }) : TT(b.name);
    $('#rkBoardDesc').textContent =
      (isCal ? TQ('按积金局「曆年回報」列，{y} 年单年回报由高至低排名', { y: S.calYear }) : TT(b.desc)) + ' · ' +
      (b.self
        ? TQ('数据截至各发行人官网最新净值日（已接入 {n} 只）', { n: PERFD && PERFD.funds ? Object.keys(PERFD.funds).length : 0 })
        : TT('数据截至积金局最新公布'));
    applyHeader(b, isCal);
    renderRankChips();
    const thCal = $('#rkThCalYear');
    if (isCal && thCal && thCal.firstChild) thCal.firstChild.textContent = TQ('{y} 年', { y: S.calYear });
    $('#rkYearSwitch').style.display = isCal ? '' : 'none';

    // 排名主榜
    const ranked = sortRows(pool(), b.metric, b.dir);
    // 分类冠军（当前筛选下，按当前榜单指标）；区块标题随榜单类型切换（发行人榜 ≠ 各类别冠军）
    const chT = $('#rkChampTitle'), chD = $('#rkChampDesc');
    if (chT) chT.textContent = b.agg === 'trustee' ? TT('发行人综合表现') : TT('各类别冠军');
    if (chD) chD.textContent = b.agg === 'trustee'
      ? TT('按发行人聚合旗下成分基金，平均表现由高至低')
      : TT('按当前排名指标，各基金种类中表现最好的基金');
    if (b.agg === 'trustee') renderAggChampions(ranked);
    else renderChampions(ranked, b);

    // 表格：若用户手动点了其他列排序，则按用户排序；否则按榜单指标
    const key = S.sortKey || b.metric;
    const dir = S.sortDir || b.dir;
    let rows = sortRows(pool(), key, dir);
    const total = rows.length;
    const shown = rows.slice(0, S.top);
    $('#rkRcnt').textContent = total;
    $('#rkRcntUnit').textContent = b.agg === 'trustee' ? TT('家发行人（受托人）') : TT('条');
    $('#rkRtip').textContent = shown.length < total ? TQ('（显示前 {n} 名）', { n: shown.length }) : TT('（全部显示）');

    // 名次列始终按榜单指标计算
    const rankMap = {};
    ranked.forEach((x, i) => { rankMap[x.id] = i + 1; });

    $('#rkTbody').innerHTML = shown.length ? shown.map((x, i) => {
      const rk = rankMap[x.id];
      const medal = rk <= 3 ? '<span class="medal g' + rk + '">' + rk + '</span>' : '<span class="rank-cell">' + rk + '</span>';
      if (x.aggTrustee) return aggRowHtml(x, b, medal, rankMap[x.id], shown);
      const mv = x[b.metric];
      const share = maxBar(shown, b.metric, x);
      return '<tr>' +
        '<td class="c" data-l="' + TT('名次') + '">' + medal + '</td>' +
        '<td class="f-main fz" data-l="' + TT('成分基金') + '"><div class="fund-name">' + esc(x.fund) + '</div>' +
          '<div class="sub-line">' + esc(x.scheme) + (x.groupSize > 1 ? ' · ' + TQ('{n} 个单位类别', { n: x.groupSize }) : '') + '</div>' +
          barHTML(b, x, ranked) + '</td>' +
        '<td data-l="' + TT('发行人') + '"><span class="tag">' + esc(x.trustee) + '</span></td>' +
        '<td data-l="' + TT('基金种类') + '"><span class="tag g">' + esc(typeLabel(x.type)) + '</span><div class="sub-line">' + esc(typeLabel(x.subtype)) + '</div></td>' +
        '<td data-l="' + TT('风险级别') + '" class="c">' + riskTag(x.risk) + '</td>' +
        '<td data-l="' + TQ('基金规模（{u}）', { u: TT('百万港元') }) + '" class="r num">' + nf(x.size, 2) + '</td>' +
        (b.self
          ? SELF_COLS.map(([k, n]) =>
              k === 'selfMdd' || k === 'selfMdd5'
                ? '<td data-l="' + TT(n) + '" class="r num down">' + pct(x[k]) + '</td>'
                : '<td data-l="' + TT(n) + '" class="r num ' + cls(x[k]) + '">' + pct(x[k]) + '</td>').join('')
          : '<td data-l="' + TT('近1年年率化') + '" class="r num ' + cls(x.ann1) + '">' + pct(x.ann1) + '</td>' +
            '<td data-l="' + TT('近5年年率化') + '" class="r num ' + cls(x.ann5) + '">' + pct(x.ann5) + '</td>' +
            '<td data-l="' + TT('近10年年率化') + '" class="r num ' + cls(x.ann10) + '">' + pct(x.ann10) + '</td>' +
            '<td data-l="' + TT('推出至今年率化') + '" class="r num ' + cls(x.annLaunch) + '">' + pct(x.annLaunch) + '</td>' +
            '<td data-l="' + TT('基金管理费 %') + '" class="r num">' + feeText(x.mgmtFee, x.feeMore && x.feeMore.mgmtFee) + '</td>' +
            /* 2026-10-19：历年回报列固定在表头第 12 位（管理费之后）；始终渲染以与 nth-child 对齐 */
            '<td data-l="' + TQ('{y} 年回报', { y: S.calYear }) + '" class="r num ' + cls(isCal ? x.calYear : null) + '">' +
              (isCal ? '<b>' + pct(x.calYear) + '</b>' : '') + '</td>') +
        /* 2026-10-19：可选列（默认隐藏，列设置里打开）——累积回报 + 历年回报 2021–2025 */
        '<td data-l="' + TT('近1年累积') + '" class="r num rk-opt o-cum ' + cls(x.cum1) + '">' + pct(x.cum1) + '</td>' +
        '<td data-l="' + TT('近5年累积') + '" class="r num rk-opt o-cum ' + cls(x.cum5) + '">' + pct(x.cum5) + '</td>' +
        '<td data-l="' + TT('近10年累积') + '" class="r num rk-opt o-cum ' + cls(x.cum10) + '">' + pct(x.cum10) + '</td>' +
        '<td data-l="' + TT('推出至今累积') + '" class="r num rk-opt o-cum ' + cls(x.cumLaunch) + '">' + pct(x.cumLaunch) + '</td>' +
        ['2021', '2022', '2023', '2024', '2025'].map((y) => {
          const v = x.cal && x.cal[y] != null ? x.cal[y] : null;
          return '<td data-l="' + y + '" class="r num rk-opt o-cal ' + cls(v) + '">' + pct(v) + '</td>';
        }).join('') +
        '<td data-l="' + TT('对比') + '" class="c"><input type="checkbox" data-cmp="' + esc(x.id) + '"' + (CMPX.has(x.id) ? ' checked' : '') + '></td>' +
        '<td data-l="' + TT('详情') + '" class="c"><button class="btn-detail" onclick="openDetail(\'' + esc(x.id) + '\')">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
          TT('详情') + '</button></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="' + (isCal ? 14 : (b.self ? 17 : 13)) + '"><div class="empty">' + TT('当前条件下没有可排名的基金') + '</div></td></tr>';

    $$('#rkTbody input[data-cmp]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) { if (!CMPX.add(c.dataset.cmp)) c.checked = false; } else CMPX.remove(c.dataset.cmp);
      renderCmpBar();
    }));

    syncHeader(key, dir);
    if (window.__syncTableScroll) window.__syncTableScroll();
  }

  /** 发行人实力榜的聚合行（列结构与基金榜不同，单独渲染） */
  function aggRowHtml(x, b, medal, rk, shown) {
    const share = maxBar(shown, b.metric, x);
    const rate = x.navTotal ? Math.round((x.navOk / x.navTotal) * 100) : 0;
    return '<tr data-agg="1">' +
      '<td class="c" data-l="' + TT('名次') + '">' + medal + '</td>' +
      '<td class="f-main fz" data-l="' + TT('发行人') + '"><div class="fund-name">' + esc(x.trustee) + '</div>' +
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
  function exportCurrent() {
    const b = cur();
    const list = sortRows(pool(), S.sortKey || b.metric, S.sortDir || b.dir);
    if (b.self) {
      /* 自算榜导出：只输出官网净值口径的指标，不含积金局字段 */
      const sHead = [TT('名次'), TT('成分基金'), TT('单位类别'), TT('基金种类'), TT('计划'), TT('发行人'), TT('净值估值日')]
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
    const head = [TT('名次'), TT('成分基金'), TT('单位类别'), TT('基金种类'), TT('强积金计划'), TT('发行人'), TT('风险级别'),
      TT('单位资产净值'), TT('净值估值日'), TT('近1年年率化回报'), TT('近5年年率化回报'), TT('近10年年率化回报'),
      TT('推出至今年率化回报'), TQ('基金规模（{u}）', { u: TT('百万港元') }), TT('基金管理费 % p.a.'), TT('最近期基金开支比率'), TT('推出日期')];
    const body = list.map((x, i) => [
      i + 1,
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
    if (b.self) return;   /* 自算榜已在函数开头单独导出 */
    csvDownload(csvSourceNote().concat([head], body), 'MPF排名_' + TT(b.name) + '_' + TT('数据截至') + '_' + (DATA.dataAsOf || '') + '.csv');
  }

  function maxBar(rows, k, x) {
    const vals = rows.map((r) => Math.abs(r[k] || 0));
    const m = Math.max.apply(null, vals.concat([0.0001]));
    return Math.min(100, (Math.abs(x[k] || 0) / m) * 100).toFixed(1);
  }

  function syncHeader(key, dir) {
    $$('#rkThead th[data-k]').forEach((th) => {
      const on = th.dataset.k === key;
      th.classList.toggle('sorted', on);
      th.querySelector('.arrow').textContent = on ? (dir === 'asc' ? '↑' : '↓') : '↕';
    });
    const el = $('#rkMSortKey');
    if (el && el.value !== key && Array.from(el.options).some((o) => o.value === key)) el.value = key;
    const d = $('#rkMSortDir'); if (d) d.textContent = dir === 'asc' ? '升序 ↑' : '降序 ↓';
  }

  /** 发行人实力榜的领跑卡片：改以「平均回报 + 旗下规模」呈现，不再按基金种类分组 */
  function renderAggChampions(ranked) {
    const top = ranked.slice(0, 6);
    $('#rkChampions').innerHTML = top.length ? top.map((x, i) => {
      return '<div class="pod p' + (i + 1) + '">' +
        '<div class="no">' + TQ('第 {n} 名', { n: i + 1 }) + '</div>' +
        '<div class="nm">' + esc(x.trustee) + '</div>' +
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
        '<div class="nm">' + esc(x.fund) + '</div>' +
        '<div class="tr">' + esc(x.trustee) + '</div>' +
        '<div class="val num ' + c + '">' + label + '</div>' +
        '<div class="meta"><span' + (x.risk == null ? '' : ' data-tip="' + esc(MPF_RISK.tip(x.risk)) + '"') + '>' + TT('风险') + ' ' + (x.risk == null ? '—' : x.risk + ' ' + TT('级')) + '</span><span>' + TQ('规模 {v} 百万', { v: nf(x.size, 0) }) + '</span><span>' + podRefText(b, x) + '</span></div>' +
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
    const KEY = 'mpf-rk-cols-v2';

    /* 列定义：k=列键、n=显示名、lock=必显 */
    const FUND = [
      ['rank', '名次', 1], ['fund', '成分基金', 1], ['trustee', '发行人', 0],
      ['type', '基金种类', 0], ['risk', '风险级别', 0], ['size', '基金规模', 0],
      ['ann1', '近1年年率化', 0], ['ann5', '近5年年率化', 0], ['ann10', '近10年年率化', 0],
      ['annLaunch', '推出至今年率化', 0], ['mgmtFee', '管理费', 0],
      ['calYear', '历年回报（当年）', 1],   /* 仅历年榜显示，跟随榜单逻辑 */
      ['cum1', '近1年累积', 0], ['cum5', '近5年累积', 0], ['cum10', '近10年累积', 0],
      ['cumLaunch', '推出至今累积', 0],
      ['cal2021', '2021 年回报', 0], ['cal2022', '2022 年回报', 0], ['cal2023', '2023 年回报', 0],
      ['cal2024', '2024 年回报', 0], ['cal2025', '2025 年回报', 0],
      ['cmp', '对比', 1], ['ops', '详情', 1],
    ];
    const AGG = [
      ['rank', '名次', 1], ['trustee', '发行人（受托人）', 1], ['count', '成分基金数', 0],
      ['sizeSum', '总规模', 0], ['ann1Avg', '平均近1年年率化', 0], ['ann5Avg', '平均近5年年率化', 0],
      ['ann10Avg', '平均近10年年率化', 0], ['annLaunchAvg', '平均推出至今年率化', 0],
      ['mgmtFee', '平均管理费', 0], ['navRate', '净值核实率', 0], ['ops', '详情', 1],
    ];
    const SELF = [
      ['rank', '名次', 1], ['fund', '成分基金', 1], ['trustee', '发行人', 0], ['type', '基金种类', 0],
      ['risk', '风险级别', 0], ['size', '基金规模', 0],
      ['selfD1', '日涨跌', 0], ['selfW1', '近1周', 0], ['selfM1', '近1月', 0], ['selfYtd', '年初至今', 0],
      ['selfY1', '近1年', 0], ['selfY3a', '近3年年化', 0], ['selfY5a', '近5年年化', 0],
      ['selfMdd', '近1年回撤', 0], ['selfMdd5', '近5年回撤', 0],
      ['cmp', '对比', 1], ['ops', '详情', 1],
    ];
    const MODES = { fund: FUND, agg: AGG, self: SELF };
    const DEFAULT_OFF = ['cum1', 'cum5', 'cum10', 'cumLaunch',
      'cal2021', 'cal2022', 'cal2023', 'cal2024', 'cal2025'];
    const SLIM_OFF = ['trustee', 'type', 'risk', 'size', 'ann5', 'ann10', 'annLaunch', 'mgmtFee',
      'cum1', 'cum5', 'cum10', 'cumLaunch', 'cal2021', 'cal2022', 'cal2023', 'cal2024', 'cal2025',
      'selfW1', 'selfY3a', 'selfY5a', 'selfMdd5', 'count', 'sizeSum', 'ann5Avg', 'ann10Avg',
      'annLaunchAvg', 'navRate'];

    let off = null;   /* 隐藏列集合 */
    try { const raw = localStorage.getItem(KEY); off = raw ? new Set(JSON.parse(raw)) : null; } catch (e) { off = null; }
    if (!off) off = new Set(DEFAULT_OFF);

    const curMode = () => (window.__rkMode && MODES[window.__rkMode]) ? window.__rkMode : 'fund';

    function apply() {
      const mode = curMode();
      const defs = MODES[mode];
      const isCal = !!window.__rkIsCal;
      let idx = 0;
      const rules = [];
      defs.forEach(([k, , lock]) => {
        idx++;   /* 始终递增：表格 DOM 恒有该列（历年榜单元格在未选年份时为空占位） */
        if (k === 'calYear') {
          /* 历年回报列只在「历年回报榜」显示，由当前榜单决定，不受列设置影响 */
          rules.push('#rkTable tr > *:nth-child(' + idx + ') { display: ' + (isCal ? 'table-cell' : 'none') + ' !important; }');
          return;
        }
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

    function buildList() {
      const defs = MODES[curMode()];
      box.innerHTML = defs.filter(([k]) => k !== 'calYear').map(([k, n, lock]) =>
        '<label' + (lock ? ' class="cp-lock"' : '') + '><input type="checkbox" value="' + k + '"' +
        (lock || !off.has(k) ? ' checked' : '') + (lock ? ' disabled' : '') + '>' + n + '</label>').join('');
      box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) off.delete(cb.value); else off.add(cb.value);
        apply();
      }));
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pop.hidden) buildList();
      pop.hidden = !pop.hidden;
    });
    const bAll = document.querySelector('#rkColAll');
    if (bAll) bAll.addEventListener('click', () => {
      MODES[curMode()].forEach(([k]) => off.delete(k));
      apply(); buildList();
    });
    const bSlim = document.querySelector('#rkColSlim');
    if (bSlim) bSlim.addEventListener('click', () => {
      MODES[curMode()].forEach(([k, , lock]) => { if (lock) off.delete(k); else off.add(k); });
      SLIM_OFF.forEach((k) => off.add(k));
      MODES[curMode()].forEach(([k, , lock]) => { if (lock) off.delete(k); });
      apply(); buildList();
    });
    document.addEventListener('click', (e) => {
      if (!pop.hidden && !(e.target.closest && e.target.closest('#rkColPop')) && e.target.id !== 'rkColBtn') pop.hidden = true;
    });
    apply();
    buildList();   /* 初始化即构建清单（弹层默认隐藏，不影响渲染） */
  })();
