/* 批量导出中心（8.0，2026-11-19）
   ------------------------------------------------------------------
   入口：资料库「数据说明」折叠区底部「批量导出数据 →」；资料库「导出」按钮也走这里
        （预置当前筛选结果，字段默认全选 = 与旧导出一致）。
   设计：先筛基金 → 再选字段 → 导出 xlsx。字段注册表复用 app.js 的 buildExportSchema()，
        保证列名、百分比口径（存百分数 + 0.00"%"）、隐藏列与旧导出完全一致。
   约束：纯前端生成（A/B 两站同代码）；逐日净值限 ≤10 只；持仓图只画前 30 只。 */
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
    extra: new Set(),       /* 'hld' | 'hist' */
    kw: '',
    trustee: new Set(),
    cat: new Set(),
    scheme: new Set(),
    navOnly: false,
    busy: false,
    preset: null,           /* 打开时预置的 id 列表（来自当前筛选） */
  };

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
  function msValues(key) {
    const m = new Map();
    rowsAll().forEach((x) => {
      const v = key === 'trustee' ? x.trustee : key === 'cat' ? catOf(x) : x.scheme;
      if (!v) return;
      m.set(v, (m.get(v) || 0) + 1);
    });
    const label = (v) => (key === 'trustee' && window.trusteeDisplay ? window.trusteeDisplay(v) : (key === 'cat' && window.typeLabel ? window.typeLabel(v) : v));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n, label: label(v) }));
  }

  function renderMS() {
    document.querySelectorAll('.ec-ms').forEach((host) => {
      const key = host.getAttribute('data-k');
      const set = ST[key];
      const vals = msValues(key);
      const label = key === 'trustee' ? '受托人' : key === 'cat' ? '基金种类' : '强积金计划';
      const txt = set.size ? TQ('已选 {n} 项', { n: set.size }) : TT('全部');
      host.innerHTML = '<button type="button" class="ec-ms-btn' + (set.size ? ' on' : '') + '">' + esc(TT(label)) +
        '<span class="ec-ms-t">' + esc(txt) + '</span><i>▾</i></button>' +
        '<div class="ec-ms-panel">' + vals.map((o) =>
          '<label class="ec-ms-i"><input type="checkbox" value="' + esc(o.v) + '"' + (set.has(o.v) ? ' checked' : '') + '>' +
          '<span>' + esc(o.label) + '</span><b>' + o.n + '</b></label>').join('') +
        '<div class="ec-ms-f"><button type="button" data-a="clear">' + esc(TT('清空')) + '</button></div></div>';
    });
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
        '<span class="ec-mt">' + esc(x.scheme || '') + ' · ' + esc(x.navAsOf === latest ? TT('最新') : (x.navAsOf || '—')) + '</span>' +
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
      const sheets = 2 + (ST.extra.has('hld') ? 1 : 0) + (ST.extra.has('hist') ? 1 : 0);
      est.textContent = TQ('预计输出：{s} 个工作表 · {r} 行 × {c} 列', { s: sheets, r: sel + 2, c: fcnt });
    }
    const go = $('#ecGo');
    if (go) go.disabled = ST.busy || !sel || !fcnt;
  }

  /* ---------- 字段树 ---------- */
  function renderTree() {
    const box = $('#ecTree');
    if (!box) return;
    const schema = window.mpfExportSchema ? window.mpfExportSchema() : null;
    if (!schema) { box.innerHTML = '<div class="ec-empty">' + esc(TT('导出组件未加载，请刷新页面')) + '</div>'; return; }
    const COLS = schema.COLS;
    box.innerHTML = GROUPS.map((g) => {
      const on = g.idx.filter((i) => ST.fields.has(i)).length;
      return '<div class="ec-g">' +
        '<label class="ec-g-h"><input type="checkbox" data-g="' + g.k + '"' + (on === g.idx.length ? ' checked' : '') + '>' +
        '<b>' + esc(TT(g.n)) + '</b><span>' + on + '/' + g.idx.length + '</span></label>' +
        g.idx.map((i) => '<label class="ec-f" title="' + esc(COLS[i][4] || '') + '">' +
          '<input type="checkbox" data-i="' + i + '"' + (ST.fields.has(i) ? ' checked' : '') + '>' +
          '<span>' + esc(COLS[i][0]) + '</span></label>').join('') +
        '</div>';
    }).join('') +
      '<div class="ec-g"><div class="ec-g-h"><b>' + esc(TT('附加工作表')) + '</b></div>' +
      '<label class="ec-f"><input type="checkbox" data-x="hld"' + (ST.extra.has('hld') ? ' checked' : '') + '><span>' + esc(TT('持仓与分布（前十大 + 资产分布）')) + '</span></label>' +
      '<label class="ec-f"><input type="checkbox" data-x="hist"' + (ST.extra.has('hist') ? ' checked' : '') + '><span>' + esc(TT('逐日净值（长表，限 10 只）')) + '</span></label>' +
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
      '<div class="ec-head"><b id="ecTitle">' + esc(TT('导出中心')) + '</b>' +
      '<span class="ec-sub">' + esc(TT('先选基金，再选字段')) + '</span>' +
      '<button type="button" class="ec-x" aria-label="' + esc(TT('关闭')) + '">×</button></div>' +
      '<div class="ec-cols">' +
      '<section class="ec-left"><div class="ec-cap">① ' + esc(TT('选基金')) + ' <span id="ecSelCount"></span></div>' +
      '<input id="ecKw" class="ec-kw" type="search" placeholder="' + esc(TT('搜索基金名称 / 计划 / 受托人')) + '" autocomplete="off">' +
      '<div class="ec-ms" data-k="trustee"></div><div class="ec-ms" data-k="cat"></div><div class="ec-ms" data-k="scheme"></div>' +
      '<label class="ec-only"><input type="checkbox" id="ecNavOnly">' + esc(TT('仅最新净值日')) + '</label>' +
      '<div class="ec-btns"><button type="button" data-a="all">' + esc(TT('全选')) + '</button>' +
      '<button type="button" data-a="inv">' + esc(TT('反选')) + '</button>' +
      '<button type="button" data-a="none">' + esc(TT('清空')) + '</button></div>' +
      '<div class="ec-list" id="ecList"></div></section>' +
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
    if (schema && !ST.fields.size) {
      schema.COLS.forEach((c, i) => ST.fields.add(i));   /* 默认全选 = 与旧导出一致 */
    }
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

  async function exportNow() {
    if (ST.busy) return;
    if (!ST.sel.size) { mpfToast(TT('请至少选择一只基金')); return; }
    if (!ST.fields.size) { mpfToast(TT('请至少选择一个字段')); return; }
    if (ST.extra.has('hist') && ST.sel.size > 10) { mpfToast(TT('逐日净值限选 10 只以内')); return; }
    if (!window.MPFXLSX) { mpfToast(TT('导出组件未加载，请刷新页面')); return; }

    const schema = window.mpfExportSchema();
    const COLS = schema.COLS;
    const picked = Array.from(ST.fields).sort((a, b) => a - b);
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
        page: TT('数据导出'),
        title: TT('数据说明'),
        meta: [
          [TT('净值截至'), navLatest || '—'],
          [TT('积金局字段截至'), DS().dataAsOf || '—'],
          [TT('本站同步时间'), new Date(DS().updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })],
          [TT('导出时间'), new Date().toLocaleString('zh-CN', { hour12: false })],
          [TT('导出范围'), TQ('{n} 条成分基金（按单位类别逐条）', { n: rowsSel.length })],
          [TT('筛选条件'), summary + (ST.kw ? ' · ' + TQ('关键词「{v}」', { v: ST.kw }) : '')],
        ],
        notes: [
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

      if (ST.extra.has('hld')) {
        ST.stage = 'hld'; tick(TT('正在生成持仓与分布…'));
        if (window.buildHoldAllocSheet) {
          const ent = rowsSel.map((x) => ({ id: x.id, name: nameOf(x) }));
          const sh = await window.buildHoldAllocSheet(ent, { chartLimit: 30, imgScale: 0.8 });
          if (sh) sheets.push(Object.assign({ name: TT('持仓与分布') }, sh));
        }
      }

      if (ST.extra.has('hist')) {
        ST.stage = 'hist';
        const list = rowsSel.slice(0, 10);
        const out = [{ h: 30, cells: [{ v: TT('逐日净值（每行一个交易日）'), s: 1 }] },
          { h: 30, cells: [TT('基金名称'), TT('日期'), TT('单位资产净值'), TT('日涨跌')].map((v) => ({ v, s: 2 })) }];
        for (let k = 0; k < list.length; k++) {
          const x = list[k];
          const nm = nameOf(x);   /* 2026-11-19：名称含繁转简，必须在行循环外只算一次，
                                     否则 1 万行 × 每行一次转换会把主线程卡死（实测 3 只即超时） */
          tick(TQ('正在读取逐日净值 {n}/{t}…', { n: k + 1, t: list.length }));
          try {
            const r = await fetch('/api/hist/' + encodeURIComponent(String(x.id)), { cache: 'default' });
            if (!r.ok) continue;
            const h = await r.json();
            const ser = h.series || h.points || [];
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
          } catch (e) { /* 单只失败不阻断 */ }
        }
        sheets.push({ name: TT('逐日净值'), rows: out, cols: [30, 12, 14, 10], freeze: { x: 0, y: 2, top: 'A3' } });
      }

      ST.stage = 'pack'; tick(TT('正在打包 xlsx…'));
      const blob = window.MPFXLSX.build({ sheets: sheets });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'MPF数据导出_' + summary.replace(/[\\/:*?"<>|]/g, '') + '_' + (navLatest || DS().dataAsOf || '') + '.xlsx';
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
      /* 多选下拉：开合 */
      const msBtn = t.closest('.ec-ms-btn');
      if (msBtn) {
        const host = msBtn.parentNode;
        document.querySelectorAll('.ec-ms.open').forEach((h) => { if (h !== host) h.classList.remove('open'); });
        host.classList.toggle('open');
        ev.stopPropagation();
        return;
      }
      /* 点面板内不关闭 */
      if (t.closest('.ec-ms-panel')) {
        const clr = t.closest('button[data-a="clear"]');
        if (clr) {
          const key = clr.closest('.ec-ms').getAttribute('data-k');
          ST[key].clear(); renderMS(); renderList(); ev.preventDefault();
        }
        return;
      }
      if (!modal) {
        document.querySelectorAll('.ec-ms.open').forEach((h) => h.classList.remove('open'));
        return;
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
      if (t.matches('#ecModal .ec-ms-i input')) {
        const key = t.closest('.ec-ms').getAttribute('data-k');
        if (t.checked) ST[key].add(t.value); else ST[key].delete(t.value);
        renderList(); syncSel();
        const host = t.closest('.ec-ms');
        if (host) host.querySelector('.ec-ms-btn').classList.toggle('on', ST[key].size > 0);
        return;
      }
      if (t.matches('#ecNavOnly')) { ST.navOnly = t.checked; renderList(); syncSel(); return; }
      if (t.matches('#ecTree input[data-i]')) {
        const i = +t.getAttribute('data-i');
        if (t.checked) ST.fields.add(i); else ST.fields.delete(i);
        renderTree(); paintCounts(); return;
      }
      if (t.matches('#ecTree input[data-x]')) {
        const k = t.getAttribute('data-x');
        if (t.checked) ST.extra.add(k); else ST.extra.delete(k);
        paintCounts(); return;
      }
      if (t.matches('#ecTree input[data-g]')) {
        const g = GROUPS.find((x) => x.k === t.getAttribute('data-g'));
        if (!g) return;
        g.idx.forEach((i) => { t.checked ? ST.fields.add(i) : ST.fields.delete(i); });
        renderTree(); paintCounts(); return;
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
