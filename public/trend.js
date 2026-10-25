/* 净值走势对比（第四页主模块 · 2026-10-13 v3 重做）
 * ==================================================================
 * 版式参照合作方站「在线对比MPF股票基金与大盘指数」：
 *   · 图上方两个多选下拉：选择指数 / 选择基金（基金可搜索）
 *   · 区间按钮：1周 / 1个月 / 1年 / 3年 / 5年 / 选择日期 / 全部区间
 *   · 折线图（区间起点归一化 = 1000；两条线时以浅色带填充其间）
 *   · 表格：名称 / 最新点位 / 区间收益 / 区间最大回撤 / 最大回撤起始日期 / 最大回撤结束日期
 *   · 底部按钮「查看具体基金分析」→ 打开所选基金的分析视图
 * 数据源：
 *   · 指数  /api/indices（东方财富日线）
 *   · 基金  /api/hist/<id>（发行人官网历史净值）+ /api/navperf（可用性索引）
 * 用法：TREND.mount(boxEl, [{type:'index',key:'HSI'}, {type:'fund',id:'695'}], opts)
 *   opts: { title, hideGoto }  hideGoto=true 时隐藏「查看具体基金分析」（基金分析视图内嵌用）
 */
window.TREND = (function () {
  /* 2026-10-18：draw 闭包令牌——每次重绘 +1，旧 move 闭包发现令牌过期即失效，
     杜绝「点击图表时上一次的线条数据覆盖 tooltip」的残留浮窗问题 */
  let MOVE_SEQ = 0;
  const RANGES = [
    ['1w', '1周'],
    ['1m', '1个月'],
    ['1y', '1年'],
    ['3y', '3年'],
    ['5y', '5年'],
  ];
  const COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ca8a04', '#db2777'];
  const MAX_ITEMS = 8;
  /* 默认线型（2026-10-14）：前两条精选（蓝实线 / 绿实线，略粗更醒目），其后颜色+线型交替区分；
     用户可点击图例自定义颜色 / 线宽 / 线型。 */
  const DEF_STYLES = [
    { color: '#2563eb', width: 2.6, dash: '' },
    { color: '#059669', width: 2.6, dash: '' },
    { color: '#d97706', width: 2.2, dash: '9 5' },
    { color: '#dc2626', width: 2.2, dash: '' },
    { color: '#7c3aed', width: 2.2, dash: '0.1 5.5' },
    { color: '#0891b2', width: 2.2, dash: '10 5 2 5' },
    { color: '#ca8a04', width: 2.0, dash: '' },
    { color: '#db2777', width: 2.0, dash: '17 7' },
  ];
  const STYLE_PALETTE = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ca8a04', '#db2777', '#0f172a', '#64748b'];
  const STYLE_DASHES = [['', '实线'], ['9 5', '虚线'], ['0.1 5.5', '点线'], ['10 5 2 5', '点划线'], ['17 7', '长虚线'], ['12 4 2 4 2 4', '双点划线']];
  const STYLE_WIDTHS = [1.5, 2, 2.6, 3.4];

  /* ---------------- 全局缓存（多个挂载点共享，避免重复请求） ---------------- */
  let idxLiteP = null;
  let idxP = null, perfP = null;
  const histP = {};
  /* 发行人平均指数（等权链式；/api/trustee-idx） */
  let cachedTAvg = null;
  function ensureTAvg() {
    if (cachedTAvg) return Promise.resolve(cachedTAvg);
    return fetchJSON('/api/trustee-idx', 'tidx').then((j) => { cachedTAvg = j || { items: {} }; return cachedTAvg; })
      .catch(() => { cachedTAvg = { items: {} }; return cachedTAvg; });
  }

  function ensureIdxs() {
    if (!idxP) idxP = fetch('/api/indices', { cache: 'default' }).then((r) => r.json()).catch(() => null);
    return idxP;
  }
  /* 2026-10-21：首屏只要画默认的恒指，先拉 lite（~2KB），点「选择指数」才拉全量 */
  function ensureIdxsLite() {
    if (!idxLiteP) idxLiteP = fetch('/api/indices?lite=1', { cache: 'default' }).then((r) => r.json()).catch(() => null);
    return idxLiteP;
  }
  function ensureIdx(key) {
    return ensureIdxsLite().then((d) => (d && d.items && d.items[key] ? d : ensureIdxs()));
  }
  function ensurePerf() {
    if (!perfP) perfP = fetch('/api/navperf', { cache: 'default' }).then((r) => r.json()).catch(() => null);
    return perfP;
  }
  function ensureHist(id) {
    if (!histP[id]) {
      histP[id] = fetch('/api/hist/' + encodeURIComponent(id), { cache: 'default' })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }
    return histP[id];
  }
  function perfOf(id) { return ensurePerf().then((p) => (p && p.funds && p.funds[String(id)]) || null); }

  /* ---------------- 工具 ---------------- */
  const esc0 = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* 说明：common.js 的 TT/TQ 是顶层 const（脚本作用域共享），**不挂在 window 上**——
     这里必须按名字直接引用；本文件内的包装函数命名为 _t/_tq，避免同名遮蔽递归。 */
  function _t(s) { return (typeof TT === 'function') ? TT(s) : s; }
  function _tq(s, o) { return (typeof TQ === 'function') ? TQ(s, o) : s; }
  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function clsOf(v) { return v == null ? 'muted' : (v > 0.0001 ? 'up' : (v < -0.0001 ? 'down' : 'muted')); }
  function fmtRaw(v) {
    if (v == null || !isFinite(v)) return '';
    if (v >= 1000) return v.toFixed(1);
    if (v >= 100) return v.toFixed(2);
    if (v >= 1) return v.toFixed(3);
    return v.toFixed(4);
  }
  /* 千分位格式化（指数点位等，如 25,247.86） */
  function nf0(v, d) {
    if (v == null || !isFinite(v)) return '';
    try { return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
    catch (e) { return String(v); }
  }
  const ts = (ds) => Date.parse(ds + 'T00:00:00Z');
  const dstr = (t) => new Date(t).toISOString().slice(0, 10);

  function minusRange(lastTs, key) {
    const d = new Date(lastTs);
    if (key === '1w') d.setUTCDate(d.getUTCDate() - 7);
    else if (key === '1m') d.setUTCMonth(d.getUTCMonth() - 1);
    else if (key === '1y') d.setUTCFullYear(d.getUTCFullYear() - 1);
    else if (key === '3y') d.setUTCFullYear(d.getUTCFullYear() - 3);
    else if (key === '5y') d.setUTCFullYear(d.getUTCFullYear() - 5);
    else if (key === '3m') d.setUTCMonth(d.getUTCMonth() - 3);
    else if (key === '6m') d.setUTCMonth(d.getUTCMonth() - 6);
    return d.getTime();
  }

  /** 区间切片 + 归一化（锚点 = 最后一个 ≤ 起点 的点；不足则用首点） */
  function windowed(raw, startTs, endTs) {
    if (!raw || !raw.length) return null;
    const pts = [];
    for (const [d, v] of raw) {
      const t = ts(d);
      if (t > endTs) break;
      if (t >= startTs) pts.push([t, v]);
    }
    let anchor = null;
    for (let i = raw.length - 1; i >= 0; i--) {
      const t = ts(raw[i][0]);
      if (t <= startTs) { anchor = [t, raw[i][1]]; break; }
    }
    if (!anchor && pts.length) anchor = pts[0];
    if (!anchor || !pts.length) return null;
    const a = anchor[1];
    if (!(a > 0)) return null;
    /* 2026-10-19：多线改为「累计回报 %」（区间起点 = 0%），领导要求不用指数化 1000 */
    const norm = pts.map(([t, v]) => [t, (v / a - 1) * 100]);
    return { anchorT: anchor[0], raw: pts, norm };
  }

  function mddOf(win) {
    let peak = -Infinity, peakT = 0, mdd = 0, fromT = 0, toT = 0;
    /* 2026-10-19：回撤必须用「实际值」算比例；norm 已改为累计涨跌幅 %，不能直接相除 */
    for (const [t, v] of win.raw) {
      if (v > peak) { peak = v; peakT = t; }
      const dd = v / peak - 1;
      if (dd < mdd) { mdd = dd; fromT = peakT; toT = t; }
    }
    return { mdd: mdd * 100, fromT, toT };
  }

  /* ---------------- 单个挂载点 ---------------- */
  function mount(box, initItems, opts) {
    opts = opts || {};
    const S = {
      range: opts.range || (initItems && initItems.length >= 2 ? '1y' : '1y'),
      customStart: '', customEnd: '',
      items: (initItems || []).slice(0, MAX_ITEMS),
      data: {}, loading: 0,
      filter: opts.filter || { ids: null, label: '' },   // 受托人筛选（来自第四页左侧栏）
      fundMeta: opts.fundMeta || null,                   // id → { trustee, type }（分级选择用）
      panelTrustee: '', panelType: '',                   // 「选择基金」面板当前层级
      style: {},                                         // 每条的线条样式覆盖 { color, width, dash }
    };
    box.classList.add('tr-box');
    box.innerHTML = shell(opts);

    const q = (s) => box.querySelector(s);
    const qa = (s) => Array.from(box.querySelectorAll(s));

    function keyOf(it) { return it.type === 'index' ? 'i:' + it.key : (it.type === 'tavg' ? 't:' + it.key : 'f:' + it.id); }

    /* ---- 线条样式（颜色 / 线宽 / 线型）：默认取 DEF_STYLES，可被用户自定义覆盖 ---- */
    function styleOf(it, i) {
      const base = DEF_STYLES[i % DEF_STYLES.length] || DEF_STYLES[0];
      const ov = (S.style && S.style[keyOf(it)]) || {};
      return {
        color: ov.color || base.color,
        width: ov.width != null ? ov.width : base.width,
        dash: ov.dash != null ? ov.dash : base.dash,
      };
    }
    function styleOverride(k, patch) {
      S.style[k] = S.style[k] || {};
      Object.assign(S.style[k], patch);
      renderLegend(); draw();
      const p = q('.tr-style');
      if (p && p.getAttribute('data-for') === k) openStylePopover(k);  // 重建弹层以刷新选中态
    }

    /* ---- 选择面板（指数 / 基金） ---- */
    function closePanels() { qa('.tr-panel').forEach((p) => { p.hidden = true; }); qa('.tr-sel').forEach((b) => b.classList.remove('on')); }
    box.querySelector('.tr-selects').addEventListener('click', (e) => {
      const b = e.target.closest('.tr-sel');
      if (!b) return;
      const name = b.getAttribute('data-panel');
      const p = q('.tr-panel-' + name);
      const wasHidden = p.hidden;
      closePanels();
      if (wasHidden) {
        if (name === 'fund' && S.filter && S.filter.label) S.panelTrustee = S.filter.label;
        p.hidden = false; b.classList.add('on'); renderPanel(name);
      }
    });
    box.querySelector('.tr-panels').addEventListener('click', (e) => {
      /* 面板内的一切点击都不冒泡到 document：
         重渲染会把被点节点从 DOM 摘下，冒泡到文档级时 closest('.tr-panel') 失效 → 误关面板（2026-10-14 修复） */
      e.stopPropagation();
      /* 「全部取消」：一键取消所有已选基金（保留指数，2026-10-17） */
      const ca = e.target.closest('[data-tr-clearall]');
      if (ca) {
        S.items = S.items.filter((it) => it.type !== 'fund');
        Object.keys(S.data).forEach((k) => { if (k.indexOf('f:') === 0) delete S.data[k]; });
        renderLegend(); draw(); syncSelButtons();
        renderPanel('fund');
        if (opts.onSelChange) opts.onSelChange();
        return;
      }
      const t = e.target.closest('[data-toggle]');
      if (t) { toggleItem(t.getAttribute('data-toggle')); return; }
      /* 分级选择（发行人 → 类型），2026-10-14 */
      const tt = e.target.closest('[data-trustee]');
      if (tt) {
        const v = tt.getAttribute('data-trustee');
        S.panelTrustee = (S.panelTrustee === v) ? '' : v;   /* 再点一次 = 取消（2026-10-15 两维筛选） */
        renderPanel('fund');
        return;
      }
      const ft2 = e.target.closest('[data-ftype]');
      if (ft2) { S.panelType = ft2.getAttribute('data-ftype'); renderPanel('fund'); return; }
      const fb = e.target.closest('[data-fback]');
      if (fb) { S.panelTrustee = ''; S.panelType = ''; renderPanel('fund'); return; }
      if (e.target.closest('.tr-p-close')) closePanels();
    });
    /* 图例（含「×」移除）委托：图例不在 .tr-panels 内，须单独绑定
       ——2026-10-14 修复：此前 × 点击无效的 bug；同时新增「点线条改样式」 */
    box.querySelector('.tr-legend').addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle]');
      if (t) { e.stopPropagation(); toggleItem(t.getAttribute('data-toggle')); return; }
      const st = e.target.closest('[data-style]');
      if (st) { e.stopPropagation(); openStylePopover(st.getAttribute('data-style')); }
    });

    /* ---- 线条样式弹层：颜色 / 线宽 / 线型（2026-10-14） ---- */
    function closeStylePopover() { const p = q('.tr-style'); if (p) p.remove(); }
    function openStylePopover(k) {
      closeStylePopover();
      const it = S.items.find((x) => keyOf(x) === k);
      if (!it) return;
      const i = S.items.indexOf(it);
      const st = styleOf(it, i);
      const p = document.createElement('div');
      p.className = 'tr-style';
      p.setAttribute('data-for', k);
      p.innerHTML =
        '<div class="st-t">' + esc0(itemLabel(it)) + '<span class="st-sub">' + _t('颜色 / 线宽 / 线型') + '</span></div>' +
        '<div class="st-row"><em>' + _t('颜色') + '</em><span class="st-sw">' +
          STYLE_PALETTE.map((c) => '<button type="button" class="st-c' + (c.toLowerCase() === st.color.toLowerCase() ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>').join('') +
        '</span><input type="color" class="st-cin" value="' + esc0(st.color) + '" title="' + esc0(_t('自定义颜色')) + '"></div>' +
        '<div class="st-row"><em>' + _t('线宽') + '</em><span class="st-w">' +
          STYLE_WIDTHS.map((w) => '<button type="button" class="st-wb' + (Math.abs(w - st.width) < 0.01 ? ' on' : '') + '" data-w="' + w + '" title="' + w + 'px"><i style="height:' + Math.max(2, w) + 'px"></i></button>').join('') +
        '</span></div>' +
        '<div class="st-row"><em>' + _t('线型') + '</em><span class="st-d">' +
          STYLE_DASHES.map(([d, label]) => '<button type="button" class="st-db' + (d === st.dash ? ' on' : '') + '" data-d="' + esc0(d) + '" title="' + esc0(_t(label)) + '"><svg width="52" height="14"><line x1="3" y1="7" x2="49" y2="7" stroke="' + st.color + '" stroke-width="' + st.width + '" stroke-dasharray="' + d + '" stroke-linecap="round"/></svg></button>').join('') +
        '</span></div>';
      box.appendChild(p);
      /* 定位：贴在该图例芯片下方（按实测像素） */
      let chip = null;
      box.querySelectorAll('.tr-legend [data-style]').forEach((el2) => { if (!chip && el2.getAttribute('data-style') === k) chip = el2; });
      if (chip) {
        const rb = chip.getBoundingClientRect();
        const bb = box.getBoundingClientRect();
        const w = p.offsetWidth || 268;
        p.style.left = Math.min(Math.max(4, rb.left - bb.left), Math.max(4, bb.width - w - 4)) + 'px';
        /* 2026-10-21：垂直方向也 clamp —— 靠近底部时翻到芯片上方，避免弹窗被裁掉 */
        const hPop = p.offsetHeight || 260;
        let topPop = rb.bottom - bb.top + 8;
        if (topPop + hPop > bb.height - 4) topPop = Math.max(4, rb.top - bb.top - hPop - 8);
        p.style.top = topPop + 'px';
      }
      p.addEventListener('click', (ev) => {
        const c = ev.target.closest('.st-c');
        const w2 = ev.target.closest('.st-wb');
        const d2 = ev.target.closest('.st-db');
        if (c) styleOverride(k, { color: c.getAttribute('data-c') });
        else if (w2) styleOverride(k, { width: parseFloat(w2.getAttribute('data-w')) });
        else if (d2) styleOverride(k, { dash: d2.getAttribute('data-d') });
      });
      const ci = p.querySelector('.st-cin');
      if (ci) ci.addEventListener('input', () => styleOverride(k, { color: ci.value }));
    }
    /* 面板输入变化（基金搜索） */
    box.querySelector('.tr-panels').addEventListener('input', (e) => {
      if (e.target.classList.contains('tr-p-search')) renderPanel('fund');
    });

    /* ---- 区间按钮 ---- */
    q('.tr-ranges').addEventListener('click', (e) => {
      const b = e.target.closest('.tr-r');
      if (!b) return;
      const r = b.getAttribute('data-r');
      if (r === 'custom') {
        const dr = q('.tr-daterow');
        dr.hidden = !dr.hidden;
        if (!dr.hidden) {
          const inputs = dr.querySelectorAll('input');
          if (inputs[0] && !inputs[0].value) inputs[0].value = S.customStart || '';
          if (inputs[1] && !inputs[1].value) inputs[1].value = S.customEnd || '';
        }
        return;
      }
      S.range = r;
      if (r !== 'custom') q('.tr-daterow').hidden = true;
      qa('.tr-r').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    });
    q('.tr-daterow').addEventListener('click', (e) => {
      if (!e.target.closest('.tr-dgo')) return;
      const inputs = q('.tr-daterow').querySelectorAll('input');
      const a = inputs[0].value, b2 = inputs[1].value;
      if (!a || !b2 || a >= b2) { if (window.mpfToast) mpfToast( _t('请选择有效的起止日期')); return; }
      /* 2026-10-23 修：允许选到未来日期会导致图表永远"数据加载中"、且残留旧提示框 */
      const todayStr = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      if (a > todayStr || b2 > todayStr) { if (window.mpfToast) mpfToast( _t('日期不能晚于今天')); return; }
      const tip0 = q('.tr-tip'); if (tip0) tip0.hidden = true;
      S.customStart = a; S.customEnd = b2; S.range = 'custom';
      qa('.tr-r').forEach((x) => x.classList.toggle('on', x.getAttribute('data-r') === 'custom'));
      draw();
    });
    /* ---- 导出工作簿（HTML/.xls：净值 + 区间涨跌幅 + 区间统计 + 走势图，2026-10-21 重做） ---- */
    const expBtn = q('.tr-exp');
    if (expBtn) expBtn.addEventListener('click', () => { exportBook(); });

    /* 2026-10-21：导出图片补画图例（SVG 本身不含图例，图例是 HTML 节点） */
    function svgToPng(svgEl, legendItems) {
      return new Promise((resolve) => {
        try {
          const clone = svgEl.cloneNode(true);
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
          st.textContent = 'text{font-family:"Microsoft YaHei",sans-serif;font-size:11px;fill:#60758c}' +
            '.tr-axis{fill:#8195a9;font-size:10px}.tr-band{fill-opacity:.10}';
          clone.insertBefore(st, clone.firstChild);
          const xml = new XMLSerializer().serializeToString(clone);
          const img = new Image();
          const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
          img.onload = () => {
            const w = Math.max(600, Math.round(svgEl.clientWidth || 800));
            const hh = Math.max(220, Math.round(svgEl.clientHeight || 300));
            const items = legendItems || [];
            const perRow = 3;
            const rows = Math.max(1, Math.ceil(items.length / perRow));
            const legendH = items.length ? rows * 30 + 10 : 0;
            const cv = document.createElement('canvas');
            cv.width = w * 2; cv.height = (hh + legendH) * 2;
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0, w * 2, hh * 2);
            /* 图例：色块线段 + 名称 */
            ctx.font = '600 24px "Microsoft YaHei", sans-serif';
            ctx.textBaseline = 'middle';
            items.forEach((it, i) => {
              const col = i % perRow;
              const row = Math.floor(i / perRow);
              const x = 24 + col * ((w * 2 - 40) / perRow);
              const y = hh * 2 + 24 + row * 30;
              ctx.strokeStyle = it.color || '#0866bb';
              ctx.lineWidth = 6;
              ctx.lineCap = 'round';
              ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 44, y); ctx.stroke();
              ctx.fillStyle = '#142846';
              ctx.fillText(it.name, x + 56, y + 2);
            });
            URL.revokeObjectURL(url);
            resolve(cv.toDataURL('image/png'));
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
          img.src = url;
        } catch (e) { resolve(''); }
      });
    }

    window.__trendExportBook = exportBook;
    window.__trendDbg = () => ({ items: S.items.length, data: Object.keys(S.data), win: !!currentWindow() });

    function exportBook() {
      /* 2026-10-21：防重复触发（连点会生成多个同名文件） */
      if (S._exporting) return;
      S._exporting = true;
      setTimeout(() => { S._exporting = false; }, 2000);
      const win = currentWindow();
      if (!win) { if (window.mpfToast) mpfToast(_t('暂无可导出的数据')); return; }
      const { startTs, endTs } = win;
      const cols = [];
      S.items.forEach((it, i) => {
        const d = S.data[keyOf(it)];
        if (!d || !d.series) return;
        const raw = d.series.filter((r) => ts(r[0]) >= startTs && ts(r[0]) <= endTs);
        if (!raw.length) return;
        cols.push({ it, name: itemLabel(it), raw, color: styleOf(it, i).color });
      });
      if (!cols.length) { if (window.mpfToast) mpfToast(_t('暂无可导出的数据')); return; }

      const allT = Array.from(new Set(cols.flatMap((c) => c.raw.map((r) => r[0])))).sort((a, b) => ts(b) - ts(a));
      const maps = cols.map((c) => new Map(c.raw));
      const stat = cols.map((c) => {
        const base = c.raw[0][1];
        let peak = -Infinity, mdd = 0, from = '', to = '', pk = '';
        c.raw.forEach(([t, v]) => {
          if (v > peak) { peak = v; pk = t; }
          const dd = peak ? (v / peak - 1) * 100 : 0;
          if (dd < mdd) { mdd = dd; from = pk; to = t; }
        });
        const last = c.raw[c.raw.length - 1][1];
        return { ret: base ? (last / base - 1) * 100 : null, mdd, from, to, base, last };
      });

      const e2 = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const f2 = (v, d) => (v == null ? '' : (v > 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%');
      const span = cols.length * 2 + 1;

      svgToPng(q('.tr-svg'), cols.map((c) => ({ name: c.name, color: c.color }))).then((png) => {
        /* 2026-10-21：改用真 xlsx（MPFXLSX），两个工作表 + 第二个表内嵌走势图。
           Sheet1 = 声明 + 基金详细对比表（全部居中、声明行合并单元格）
           Sheet2 = 逐日净值 + 当日涨跌幅（倒序）+ 右侧内嵌走势图 */
        if (!window.MPFXLSX) { if (window.mpfToast) mpfToast(_t('导出组件未加载，请刷新页面')); return; }
        const FN = (typeof DATA !== 'undefined' && DATA && DATA.funds) ? DATA.funds : [];
        const pickF = (it) => FN.find((f) => String(f.id) === String(it.id));
        const pctS = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
        /* 2026-10-21：写数值而不是文本，避免 Excel 的「文本型数字」绿三角 */
        const pCell = (v) => (v == null || !isFinite(v) ? { v: '—', s: 4 } : { v: Math.round(v * 1e4) / 1e6, s: 5 });
        const n4 = (v) => (v == null || !isFinite(v) ? { v: '—', s: 4 } : { v: Math.round(v * 1e4) / 1e4, s: 6 });
        const n2 = (v) => (v == null || !isFinite(v) ? { v: '—', s: 4 } : { v: Math.round(v * 100) / 100, s: 7 });
        const dCell = (d) => (d ? { v: d, t: 'd', s: 8 } : { v: '—', s: 4 });
        const tCell = (v) => ({ v: v == null || v === '' ? '—' : String(v), s: 4 });

        const cmpRows = [
          ['区间收益', (x, i) => pCell(stat[i].ret)],
          ['最大回撤', (x, i) => pCell(stat[i].mdd)],
          ['回撤区间', (x, i) => tCell(stat[i].from ? dstr(stat[i].from) + ' — ' + dstr(stat[i].to) : '—')],
          ['发行人（受托人）', (x) => tCell(x.trustee)],
          ['强积金计划', (x) => tCell(x.scheme)],
          ['基金种类', (x) => tCell(x.typeFull || x.type)],
          ['推出日期', (x) => tCell(x.launch)],
          ['基金规模（百万港元）', (x) => n2(x.size)],
          ['风险级别', (x) => (x.risk == null || !isFinite(x.risk) ? { v: '—', s: 4 } : { v: Number(x.risk), s: 7 })],
          ['单位资产净值', (x) => (x.nav == null ? { v: '—', s: 4 } : { v: Math.round(x.nav * 1e4) / 1e4, s: 6 })],
          ['近1年年率化回报', (x) => pCell(x.ann1)],
          ['近3年年率化回报', (x) => {
            /* 2026-10-22：数据源没有 ann3 字段，改为用 cal 最近 3 个有值年度反算 */
            const c = x.cal || {};
            const ys = Object.keys(c).filter((y) => c[y] != null).sort().slice(-3);
            if (ys.length < 3) return { v: '—', s: 4 };
            const prod = ys.reduce((a, y) => a * (1 + c[y] / 100), 1);
            return pCell((Math.pow(prod, 1 / 3) - 1) * 100);
          }],
          ['近5年年率化回报', (x) => pCell(x.ann5)],
          ['近10年年率化回报', (x) => pCell(x.ann10)],
          ['推出至今年率化回报', (x) => pCell(x.annLaunch)],
          ['近1年累积回报', (x) => pCell(x.cum1)],
          ['近5年累积回报', (x) => pCell(x.cum5)],
          ['近5年最差年度', (x) => pCell(x.worstYear)],
          ['基金管理费 % p.a.', (x) => n2(x.mgmtFee)],
          ['受托人费／保管人费 %', (x) => n2(x.trusteeFee)],
          ['投资管理费 %', (x) => n2(x.investFee)],
        ];
        const years = Array.from(new Set(cols.flatMap((c) => {
          const f = pickF(c.it);
          return f && f.cal ? Object.keys(f.cal) : [];
        }))).sort().reverse();
        years.forEach((y) => cmpRows.push([y + ' 年回报', (x) => pCell(x.cal ? x.cal[y] : null)]));

        const nCol = cols.length + 1;
        const lastCol = (() => { let n = nCol; let s2 = ''; while (n > 0) { const m = (n - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; n = Math.floor((n - 1) / 26); } return s2; })();

        /* ---------- Sheet1 ---------- */
        const r1 = [];
        r1.push({ h: 34, cells: [{ v: '来源', s: 3 }, { v: '本平台「MPF基金可视化对比」 ' + location.host, s: 9 }] });
        r1.push({ h: 34, cells: [{ v: '口径', s: 3 }, { v: '基金为发行人官网单位资产净值，指数为收盘价；涨跌幅 = 当日数值 ÷ 区间起点数值 − 1', s: 9 }] });
        r1.push({ h: 34, cells: [{ v: '区间', s: 3 }, { v: dstr(startTs) + ' ~ ' + dstr(endTs) + '（' + allT.length + ' 个交易日，按日期倒序）', s: 9 }] });
        /* 2026-10-22（用户要求）：把「数据完整性」说明放在来源/口径/区间同一区域，
           讲清空白单元格是什么（官网未披露/非估值日），并明确未做插值。 */
        const missPer = cols.map((c, i) => {
          let n = 0;
          allT.forEach((t) => { if (maps[i].get(t) == null) n++; });
          return n;
        });
        const missTotal = missPer.reduce((a, b) => a + b, 0);
        const missMax = missPer.length ? Math.max.apply(null, missPer) : 0;
        const missFunds = missPer.filter((n) => n > 0).length;
        const missRow = missTotal === 0
          ? { h: 34, cells: [{ v: '数据完整性', s: 3 }, { v: '区间内 ' + allT.length + ' 个交易日，所选标的全部有值，无空白。', s: 9 }] }
          : { h: 34, cells: [{ v: '数据完整性', s: 3 }, {
            v: '区间内共 ' + allT.length + ' 个交易日：' + (cols.length - missFunds) + ' 只完整、' + missFunds + ' 只有空白（合计 ' +
               missTotal + ' 个单元格，单只最多 ' + missMax + ' 个）。空白 = 发行人官网当日未披露净值（周末、香港公众假期、非估值日，或该基金尚未推出/已终止），' +
               '本表不插值、不用前值填充；如需连续日序列，请以「数据说明」为准。', s: 9 }] };
        r1.push(missRow);
        r1.push({ h: 8, cells: [] });
        r1.push({ h: 28, cells: [{ v: '基金详细对比表', s: 1 }] });
        r1.push({ h: 30, cells: [{ v: '对比项', s: 2 }].concat(cols.map((c) => ({ v: c.name, s: 2 }))) });
        cmpRows.forEach(([label, fn]) => {
          /* 2026-10-22：按 cols 遍历（与 stat 下标对齐）；指数没有基金档案也要能算出区间指标 */
          r1.push({ h: 24, cells: [{ v: label, s: 3 }].concat(cols.map((c, i) => {
            const f = pickF(c.it);
            try { return fn(f || {}, i); } catch (e) { return { v: '—', s: 4 }; }
          })) });
        });
        const merges1 = [
          'B1:' + lastCol + '1', 'B2:' + lastCol + '2', 'B3:' + lastCol + '3', 'B4:' + lastCol + '4',
          'A6:' + lastCol + '6',
        ];

        /* ---------- Sheet2 ---------- */
        const r2 = [];
        r2.push({ h: 26, cells: [{ v: '基金的逐日净值数据', s: 1 }] });
        const headRow = [{ v: '日期', s: 2 }];
        cols.forEach((c) => { headRow.push({ v: c.name, s: 2 }, { v: c.name, s: 2 }); });
        r2.push({ h: 34, cells: headRow });
        const subRow = [{ v: '', s: 2 }];
        cols.forEach(() => { subRow.push({ v: '净值', s: 2 }, { v: '当日涨跌幅', s: 2 }); });
        r2.push({ h: 20, cells: subRow });
        allT.forEach((t, idx) => {
          const cells = [dCell(dstr(t))];
          cols.forEach((c, i) => {
            const v = maps[i].get(t);
            const prevT = allT[idx + 1];
            const pv = prevT != null ? maps[i].get(prevT) : null;
            cells.push(v == null ? { v: '', s: 4 } : { v: Number(v.toFixed(4)), s: 6 });
            cells.push((v == null || !pv) ? { v: '', s: 4 } : { v: Math.round((v / pv - 1) * 1e4) / 1e6, s: 5 });
          });
          r2.push({ cells });
        });
        const nCols2 = cols.length * 2 + 1;
        const merges2 = ['A1:' + (() => { let n = Math.max(nCols2, 3); let s2 = ''; while (n > 0) { const m = (n - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; n = Math.floor((n - 1) / 26); } return s2; })() + '1'];
        cols.forEach((c, i) => {
          const c1 = (() => { let n = 2 + i * 2; let s2 = ''; while (n > 0) { const m = (n - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; n = Math.floor((n - 1) / 26); } return s2; })();
          const c2 = (() => { let n = 3 + i * 2; let s2 = ''; while (n > 0) { const m = (n - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; n = Math.floor((n - 1) / 26); } return s2; })();
          merges2.push(c1 + '2:' + c2 + '2');
        });

        const imgCol = Math.max(nCols2, 3) + 1;
        const blob = window.MPFXLSX.build({
          sheets: [
            { name: '基金对比_' + dstr(startTs) + '_' + dstr(endTs), rows: r1, merges: merges1,
              cols: [20].concat(cols.map(() => 32)) },
            { name: '基金逐日净值数据', rows: r2, merges: merges2,
              cols: [13].concat(cols.reduce((a) => a.concat([12, 12]), [])).concat([2, 2, 2]),
              /* 2026-10-22（用户要求）：走势图横向拉长（8 → 15 列），纵向高度不变 */
              drawing: png ? { col: imgCol, row: 2, col2: imgCol + 15, row2: 2 + 16 } : null },
          ],
          image: png ? { data: png, col: imgCol, row: 2, col2: imgCol + 15, row2: 2 + 16 } : null,
        });

        const allNames = cols.map((c) => c.name.replace(/[\\/:*?"<>|]/g, ''));
        const nm = allNames.length <= 3 ? allNames.join('、') : allNames.slice(0, 2).join('、') + '等' + allNames.length + '只';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '基金对比_' + dstr(startTs) + '_' + dstr(endTs) + ' ' + nm + '.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
        if (window.mpfToast) mpfToast(_t('已导出（两个工作表，含走势图）'));
      });
    }
    const shrBtn = q('.tr-share');
    if (shrBtn) shrBtn.addEventListener('click', () => {
      try {
        const u = new URL(location.href);
        u.searchParams.delete('open');
        u.searchParams.set('set', S.items.map((it) => keyOf(it)).join(','));
        const txt = u.toString();
        const done = () => { if (window.mpfToast) mpfToast(_t('分享链接已复制')); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done, () => { try { window.prompt(_t('复制以下链接：'), txt); } catch (e2) {} });
        } else { try { window.prompt(_t('复制以下链接：'), txt); } catch (e2) {} }
      } catch (e) {}
    });
    const gotoBtn = q('.tr-goto');
    if (gotoBtn) {
      gotoBtn.addEventListener('click', () => {
        const f = S.items.find((it) => it.type === 'fund');
        if (!f) return;
        if (typeof window.openDetail === 'function') window.openDetail(f.id);
        else if (typeof window.anOpen === 'function') window.anOpen(f.id);
        else location.href = 'analysis.html?open=' + encodeURIComponent(f.id);
      });
    }

    /* ---- 数据加载 ---- */
    let cachedIdx = null, cachedPerf = null;
    function indexName(key) {
      const d = cachedIdx && cachedIdx.items && cachedIdx.items[key];
      return (d && d.name) || key;
    }
    function fundLabel(id) {
      const d = S.data['f:' + id];
      if (d && d.meta && d.meta.name) return d.meta.name;
      const pf = cachedPerf && cachedPerf.funds && cachedPerf.funds[String(id)];
      if (pf && pf.name) return pf.name;
      const fm = S.fundMeta && S.fundMeta[String(id)];   /* 2026-10-17：无历史基金也显示真实名称 */
      return (fm && fm.name) || ('#' + id);
    }
    function tavgName(key) {
      const d = cachedTAvg && cachedTAvg.items && cachedTAvg.items[key];
      return (d && d.name) || key;
    }
    function itemLabel(it) {
      if (it.type === 'index') return indexName(it.key);
      if (it.type === 'tavg') return tavgName(it.key);
      return fundLabel(it.id);
    }
    function loadItem(it) {
      const k = keyOf(it);
      if (S.data[k] && !S.data[k].err) return Promise.resolve(S.data[k]);
      S.loading++;
      paintLoading();
      const p = it.type === 'index'
        ? ensureIdx(it.key).then((d) => {
            const m = d && d.items && d.items[it.key];
            return m ? { series: m.series, meta: m } : null;
          })
        : (it.type === 'tavg'
          ? ensureTAvg().then((d) => {
              const m = d && d.items && d.items[it.key];
              return m ? { series: m.series, meta: m } : null;
            })
          : ensureHist(it.id).then((h) => (h && h.series && h.series.length ? { series: h.series, meta: h } : null)));
      return p.then((res) => {
        S.data[k] = res ? { series: res.series, meta: res.meta } : { err: 1 };
        S.loading--;
        renderLegend(); draw(); paintLoading(); syncSelButtons();
        return S.data[k];
      }).catch(() => { S.data[k] = { err: 1 }; S.loading--; renderLegend(); paintLoading(); });
    }
    function paintLoading() {
      const el = q('.tr-loading');
      if (el) el.style.display = S.loading > 0 ? '' : 'none';
    }

    function toggleItem(k) {
      const ty = k.slice(0, 2); // 'i:' 指数 / 't:' 发行人平均 / 'f:' 基金
      const isIdx = ty === 'i:' || ty === 't:';
      const val = k.slice(2);
      if (S.items.some((it) => keyOf(it) === k)) {
        S.items = S.items.filter((it) => keyOf(it) !== k);
        delete S.data[k];
        closeStylePopover();   /* 条目已移除：样式弹层随之关闭 */
        renderLegend(); draw(); syncSelButtons(); renderPanel(isIdx ? 'idx' : 'fund');
        if (opts.onSelChange) opts.onSelChange();
        return;
      }
      if (S.items.length >= MAX_ITEMS) {
        if (window.mpfToast) mpfToast( _tq('最多同时对比 {n} 条', { n: MAX_ITEMS }));
        return;
      }
      const it = ty === 'i:' ? { type: 'index', key: val } : (ty === 't:' ? { type: 'tavg', key: val } : { type: 'fund', id: val });
      S.items.push(it);
      renderLegend(); draw(); syncSelButtons(); renderPanel(isIdx ? 'idx' : 'fund');
      loadItem(it);
      if (opts.onSelChange) opts.onSelChange();
    }

    /* 全量表行：点「＋」把基金加入对比（2026-10-15） */
    box.querySelector('.tr-tablewrap').addEventListener('click', (e) => {
      const a = e.target.closest('[data-addfund]');
      if (!a) return;
      e.stopPropagation();
      toggleItem('f:' + a.getAttribute('data-addfund'));
    });

    /* ---- 结构 ---- */
    function shell(o) {
      const title = o.title ||  _t('在线对比 MPF 基金与大盘指数');
      const hasFund = (o.items || initItems || []).some((it) => it.type === 'fund');
      return '' +
        /* 2026-10-20：bareHead = 不渲染「标题 + 导出/分享」整行（详情页已有「对比基金走势」小标题） */
        (o.bareHead ? '' :
          '<div class="tr-head"><div class="tr-title">' + esc0(title) + '</div>' +
            '<div class="tr-tools">' +
              '<button type="button" class="tr-tool tr-exp" title="' + esc0(_t('导出当前走势数据（CSV）')) + '">' + esc0(_t('导出')) + '</button>' +
              '<button type="button" class="tr-tool tr-share" title="' + esc0(_t('复制包含当前对比组合的分享链接')) + '">' + esc0(_t('分享')) + '</button>' +
            '</div>' +
          '</div>') +
        '<div class="tr-selects">' +
          '<button type="button" class="tr-sel" data-panel="idx"><span>' + esc0( _t('选择指数')) + '</span><i class="tr-cnt" data-cnt="idx"></i><em>▼</em></button>' +
          '<button type="button" class="tr-sel" data-panel="fund"><span>' + esc0( _t('选择基金')) + '</span><i class="tr-cnt" data-cnt="fund"></i><em>▼</em></button>' +
        '</div>' +
        '<div class="tr-panels">' +
          '<div class="tr-panel tr-panel-idx" hidden>' +
            '<div class="tr-p-head"><span>' + esc0( _t('选择指数（可多选）')) + '</span><button type="button" class="tr-p-close" aria-label="' + esc0( _t('关闭')) + '">×</button></div>' +
            '<div class="tr-p-list tr-p-list-idx"></div>' +
          '</div>' +
          '<div class="tr-panel tr-panel-fund" hidden>' +
            '<div class="tr-p-head"><span>' + esc0( _t('选择基金（可多选，支持简体 / 繁体 / 英文搜索）')) + '</span><button type="button" class="tr-p-close" aria-label="' + esc0( _t('关闭')) + '">×</button></div>' +
            '<input class="tr-p-search" type="search" placeholder="' + esc0( _t('搜索基金名称 / 计划 / 受托人')) + '">' +
            '<div class="tr-p-list tr-p-list-fund"></div>' +
          '</div>' +
        '</div>' +
        '<div class="tr-toolbar">' +
          '<div class="tr-ranges" role="group" aria-label="' + esc0( _t('区间')) + '">' +
            RANGES.map(([k, l]) => '<button type="button" class="tr-r' + (S.range === k ? ' on' : '') + '" data-r="' + k + '">' + esc0( _t(l)) + '</button>').join('') +
            '<button type="button" class="tr-r" data-r="custom">' + esc0( _t('选择日期')) + '</button>' +
          '</div>' +
          '<div class="tr-tools2">' +
            '<button type="button" class="tr-r tr-r-all' + (S.range === 'all' ? ' on' : '') + '" data-r="all">' + esc0( _t('全部区间')) + '</button>' +
            '<button type="button" class="tr-tool tr-clear" title="' + esc0( _t('清空所有已选基金并重置筛选（保留指数）')) + '">' + esc0( _t('清空筛选')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="tr-daterow" hidden>' +
          '<input type="date" class="tr-d1"><span>~</span><input type="date" class="tr-d2">' +
          '<button type="button" class="btn sm tr-dgo">' + esc0( _t('确定')) + '</button>' +
        '</div>' +
        '<div class="tr-legend"></div>' +
        '<div class="tr-canvas">' +
          '<div class="tr-loading" style="display:none">' + esc0( _t('加载中…')) + '</div>' +
          '<svg class="tr-svg" viewBox="0 0 760 300" preserveAspectRatio="xMidYMid meet" role="img"></svg>' +
          '<div class="tr-tip" hidden></div>' +
        '</div>' +
        '<div class="tr-tablewrap"></div>' +
        (o.hideGoto ? '' :
          '<div class="tr-gotowrap"><button type="button" class="btn tr-goto"' + (hasFund ? '' : ' style="display:none"') + '>' + esc0( _t('查看具体基金分析')) + '</button></div>') +
        '<div class="tr-note">' + esc0( _t('纵轴为累计涨跌幅：每条线 = 该标的每日数值 ÷ 区间起点数值 − 1（区间起点当天 = 0%）。例：净值 30 → 33 显示为 +10%；悬停可查看实际数值（净值 / 指数点位）。基金净值取自各发行人官网（每交易日），指数为收盘价；自算口径不含分红再投资与费用调整。')) + '</div>';
    }

    /* 「清空筛选」：清空全部对比对象（含指数）并重置面板筛选（2026-10-17） */
    q('.tr-clear').addEventListener('click', () => {
      S.items = [];
      Object.keys(S.data).forEach((k) => { delete S.data[k]; });
      S.filter = null;
      S.panelTrustee = '';
      S.panelType = '';
      const kwIn0 = q('.tr-p-search');
      if (kwIn0) kwIn0.value = '';
      renderLegend(); draw(); syncSelButtons(); closeStylePopover();
      if (opts.onSelChange) opts.onSelChange();
      const p0 = q('.tr-panel-fund');
      if (p0 && !p0.hidden) renderPanel('fund');
    });

    /* 「全部取消」按钮已改在 .tr-panels 委托内处理（该处 stopPropagation 会拦截 box 级监听） */

    /* 「全部区间」按钮单独绑定（不在 .tr-ranges 容器内） */
    q('.tr-r-all').addEventListener('click', () => {
      S.range = 'all';
      qa('.tr-r').forEach((x) => x.classList.toggle('on', x === q('.tr-r-all')));
      q('.tr-daterow').hidden = true;
      draw();
    });

    function renderLegend() {
      const el = q('.tr-legend');
      const parts = S.items.map((it, i) => {
        const k = keyOf(it);
        const d = S.data[k];
        const bad = d && d.err;
        const name = itemLabel(it);
        const st = styleOf(it, i);
        const pending = !d;
        /* 「发行人平均」等条目附计算口径说明（悬浮可见） */
        let tip = _t('点击可改颜色 / 线宽 / 线型');
        if (it.type === 'tavg') tip = _t('发行人均值指数：该发行人旗下「已接入历史净值」的成员基金按每日等权平均（每日涨跌幅的算术平均逐日链式累计，区间起点 = 1000），不含费用。') + '\n' + tip;
        /* 2026-10-22：自算的 MPF 市场指数——图例悬浮显示计算口径（自绘浅蓝浮窗） */
        let selfTip = '';
        if (it.type === 'index' && cachedIdx && cachedIdx.items && cachedIdx.items[it.key] && cachedIdx.items[it.key].tip) {
          selfTip = _t(cachedIdx.items[it.key].tip);
        }
        /* 图例线 = 实际线型预览（颜色 / 粗细 / 虚实一致） */
        const linePrev = '<svg class="tr-lg-line" width="32" height="10" data-style="' + esc0(k) + '">' +
          '<line x1="1" y1="5" x2="31" y2="5" stroke="' + st.color + '" stroke-width="' + st.width + '"' +
          (st.dash ? ' stroke-dasharray="' + st.dash + '"' : '') + ' stroke-linecap="round"/></svg>';
        return '<span class="tr-lg' + (bad ? ' tr-lg-err' : '') + (pending ? ' tr-lg-load' : '') + '" style="--c:' + st.color + '"' +
          (selfTip ? ' data-tip="' + esc0(selfTip) + '"' : ' title="' + esc0(tip) + '"') + '>' +
          linePrev +
          '<span class="tr-lg-n" data-style="' + esc0(k) + '">' + esc0(name) + '</span>' +
          '<b class="tr-lg-x" data-toggle="' + esc0(k) + '" title="' + esc0(_t('移除')) + '">×</b></span>';
      }).join('');
      el.innerHTML = (parts || '<span class="tr-lg-empty">' + esc0(_t('请在上方选择指数或基金开始对比')) + '</span>') +
        (S.items.length ? '<span class="tr-lg-tip">' + esc0(_t('点线条可改颜色 / 线宽 / 线型')) + '</span>' : '');
    }
    function syncSelButtons() {
      const ni = S.items.filter((it) => it.type === 'index').length;
      const nf = S.items.filter((it) => it.type === 'fund').length;
      const a = q('[data-cnt="idx"]'), b = q('[data-cnt="fund"]');
      if (a) a.textContent = ni ? ni : '';
      if (b) b.textContent = nf ? nf : '';
      const g = q('.tr-goto');
      if (g) g.style.display = nf ? '' : 'none';
    }

    /* ---- 面板内容 ---- */
    function renderPanel(name) {
      if (name === 'idx') {
        const list = q('.tr-p-list-idx');
        if (!list) return;
        ensureIdxs().then((d) => {
          cachedIdx = d;
          const items = (d && d.items) || {};
          list.innerHTML = Object.keys(items).map((k) => {
            const on = S.items.some((it) => it.type === 'index' && it.key === k);
            const tip = items[k].tip ? ' data-tip="' + esc0(_t(items[k].tip)) + '"' : '';
            return '<button type="button" class="tr-p-row' + (on ? ' on' : '') + '" data-toggle="i:' + esc0(k) + '"' + tip + '>' +
              '<span class="tr-ck">' + (on ? '✓' : '') + '</span>' +
              '<span class="n">' + esc0(items[k].name) + '</span>' +
              '<span class="s">' + esc0(items[k].selfCalc ? _t('本站自算 · 仅供参考') : (items[k].nameEn || '')) + '</span>' +
              '<span class="d">' + esc0(String(items[k].asOf || '').slice(5)) + '</span>' +
              '</button>';
          }).join('');
        });
        /* 发行人平均指数（等权链式）——可多选实现「发行人间横向对比」 */
        ensureTAvg().then((td) => {
          const tit = (td && td.items) || {};
          const keys = Object.keys(tit);
          if (!keys.length) return;
          const rows = keys.map((k) => {
            const on = S.items.some((it) => it.type === 'tavg' && it.key === k);
            return '<button type="button" class="tr-p-row' + (on ? ' on' : '') + '" data-toggle="t:' + esc0(k) + '">' +
              '<span class="tr-ck">' + (on ? '✓' : '') + '</span>' +
              '<span class="n">' + esc0(tit[k].name) + '</span>' +
              '<span class="s">' + _tq('{n} 只成员 · 等权', { n: tit[k].count }) + '</span>' +
              '<span class="d">' + esc0(String(tit[k].asOf || '').slice(5)) + '</span>' +
              '</button>';
          }).join('');
          list.innerHTML += '<div class="tr-p-sep">' + _t('发行人平均指数（等权）') + '</div>' + rows;
        });
        return;
      }
      const list = q('.tr-p-list-fund');
      if (!list) return;
      ensurePerf().then((p) => {
        cachedPerf = p;
        const funds = (p && p.funds) || {};
        const allIds = Object.keys(funds);
        const meta = S.fundMeta || null;   // id → { trustee, type }（由 analysis.js 注入，用于分级）
        /* 2026-10-17：面板左列始终列出全部发行人（顺序同侧栏）；「已筛选当前发行人」由 panelTrustee 预选实现 */
        const ids = allIds;
        const head = q('.tr-panel-fund .tr-p-head span');
        const kwIn = q('.tr-p-search');
        const kw = kwIn ? kwIn.value.trim() : '';
        const kwNorm = (window.toSimp ? toSimp(kw) : kw).toLowerCase();

        if (!ids.length) {
          if (head) head.textContent = _t('选择基金');
          list.innerHTML = '<div class="tr-p-empty">' + esc0( _t('历史净值回填中：其余受托人陆续接入')) + '</div>';
          return;
        }
        const fundRow = (id) => {
          const f = funds[id];
          const on = S.items.some((it) => it.type === 'fund' && it.id === id);
          return '<button type="button" class="tr-p-row' + (on ? ' on' : '') + '" data-toggle="f:' + esc0(id) + '">' +
            '<span class="tr-ck">' + (on ? '✓' : '') + '</span>' +
            '<span class="n">' + esc0(f.name) + (f.unit ? '<em>' + esc0(f.unit) + '</em>' : '') + '</span>' +
            '<span class="s">' + esc0((f.scheme || '').replace(/（強積金）計劃|\(強積金\)計劃/g, '')) + '</span>' +
            (f.y1 != null ? '<span class="d ' + clsOf(f.y1) + '">' + fmtPct(f.y1) + '</span>' : '<span class="d"></span>') +
            '</button>';
        };

        /* —— 搜索时：全库平铺（简繁英）—— */
        if (kwNorm) {
          const hits = ids.filter((id) => {
            const f = funds[id];
            const hay = (window.toSimp ? toSimp((f.name || '') + ' ' + (f.scheme || '') + ' ' + (f.unit || '')) : '').toLowerCase();
            if (hay.indexOf(kwNorm) >= 0) return true;
            if (window.ensureNamesEn) {
              const EN = window.__mpfNamesEn;
              if (!EN) { ensureNamesEn().then(() => renderPanel('fund')); return true; }
              const e = EN[id];
              if (e && ((e.fund || '') + ' ' + (e.scheme || '') + ' ' + (e.trustee || '')).toLowerCase().indexOf(kwNorm) >= 0) return true;
            }
            return false;
          }).slice(0, 100);
          if (head) head.textContent = _t('搜索结果（全库 · 支持简体 / 繁体 / 英文）');
          list.innerHTML = hits.length ? hits.map(fundRow).join('') : '<div class="tr-p-empty">' + esc0(_t('没有符合条件的基金')) + '</div>';
          return;
        }

        /* —— 无分级数据（如弹窗内嵌）→ 平铺 —— */
        if (!meta || !Object.keys(meta).length) {
          if (head) head.textContent = _t('选择基金（可多选，支持简体 / 繁体 / 英文搜索）') +
            (ids.length ? ' · ' + _tq('已接入历史净值 {n} 只', { n: ids.length }) : '');
          list.innerHTML = ids.slice(0, 120).map(fundRow).join('');
          return;
        }

        /* —— 两维筛选：发行人 × 类别（同时生效，2026-10-15）—— */
        const byT = {};
        ids.forEach((id) => { const t = (meta[id] && meta[id].trustee) || '其他'; byT[t] = (byT[t] || 0) + 1; });
        const P0 = { '宏利': 0, '銀聯信託': 1, '友邦信託': 2 };
        const ORD = opts.trusteeOrder || null;
        const rank = (t) => (ORD ? (ORD.indexOf(t) < 0 ? 99 : ORD.indexOf(t)) : (P0[t] != null ? P0[t] : 9));
        const ts = Object.keys(byT).sort((a, b) => (rank(a) - rank(b)) || byT[b] - byT[a]);
        const tChips = '<button type="button" class="tr-fchip' + (!S.panelTrustee ? ' on' : '') + '" data-trustee="">' + _t('全部发行人') + ' (' + ids.length + ')</button>' +
          ts.map((t) => '<button type="button" class="tr-fchip' + (S.panelTrustee === t ? ' on' : '') + '" data-trustee="' + esc0(t) + '">' + esc0(t) + ' (' + byT[t] + ')</button>').join('');
        const sub = S.panelTrustee ? ids.filter((id) => (meta[id] && meta[id].trustee) === S.panelTrustee) : ids;
        const byType = {};
        sub.forEach((id) => { const ty = (meta[id] && meta[id].type) || ''; byType[ty] = (byType[ty] || 0) + 1; });
        if (S.panelType && byType[S.panelType] == null) S.panelType = '';   /* 换发行人后旧类别失效则自动回落（2026-10-15） */
        const tyKeys = Object.keys(byType).sort((a, b) => byType[b] - byType[a]);
        const yChips = '<button type="button" class="tr-fchip' + (!S.panelType ? ' on' : '') + '" data-ftype="">' + _t('全部类别') + ' (' + sub.length + ')</button>' +
          tyKeys.map((ty) => '<button type="button" class="tr-fchip' + (S.panelType === ty ? ' on' : '') + '" data-ftype="' + esc0(ty) + '">' + esc0(typeof typeLabel === 'function' ? typeLabel(ty) : ty) + ' (' + byType[ty] + ')</button>').join('');
        const shownIds = S.panelType ? sub.filter((id) => (meta[id] && meta[id].type) === S.panelType) : sub;
        /* 已选置顶分组（方便复查 / 取消） */
        const selIds = ids.filter((id) => S.items.some((it) => it.type === 'fund' && it.id === id));
        const selHTML = selIds.length
          ? '<div class="tr-p-sep">' + _tq('已选（{n}）', { n: selIds.length }) +
            '<button type="button" class="tr-p-clearall" data-tr-clearall>' + esc0( _t('全部取消')) + '</button></div>' +
            '<div class="tr-p-selected">' + selIds.map(fundRow).join('') + '</div>'
          : '';
        if (head) head.textContent = _tq('选择基金 · {t}', { t: (S.panelTrustee || _t('全部发行人')) + (S.panelType ? ' · ' + (typeof typeLabel === 'function' ? typeLabel(S.panelType) : S.panelType) : '') });
        /* 左列发行人 × 顶行类别（2026-10-15 布局）*/
        const tCol = '<button type="button" class="tr-tside' + (!S.panelTrustee ? ' on' : '') + '" data-trustee="">' + _t('全部') + '<em>' + ids.length + '</em></button>' +
          ts.map((t) => '<button type="button" class="tr-tside' + (S.panelTrustee === t ? ' on' : '') + '" data-trustee="' + esc0(t) + '">' + esc0(t) + '<em>' + byT[t] + '</em></button>').join('');
        list.innerHTML = '<div class="tr-p-matrix"><div class="tr-p-left">' + tCol + '</div>' +
          '<div class="tr-p-right"><div class="tr-p-note">' + _tq('已接入历史净值 {n} 只（其余数据接入中；资料库可查全量 451 条）', { n: ids.length }) + '</div>' +
          '<div class="tr-fchips-wrap tr-typebar">' + yChips + '</div>' +
          selHTML +
          '<div class="tr-p-sep">' + _tq('符合条件 {n} 只', { n: shownIds.length }) + '</div>' +
          (shownIds.length ? shownIds.map(fundRow).join('') : '<div class="tr-p-empty">' + esc0(_t('没有符合条件的基金')) + '</div>') +
          '</div></div>';
        return;
      });
    }

    /* ---- 计算当前区间 ---- */
    function currentWindow() {
      let endTs = 0, firstTs = Infinity;
      const loaded = [];
      Object.keys(S.data).forEach((k) => {
        const d = S.data[k];
        if (d && d.series && d.series.length) {
          endTs = Math.max(endTs, ts(d.series[d.series.length - 1][0]));
          firstTs = Math.min(firstTs, ts(d.series[0][0]));
        }
      });
      if (!endTs) return null;
      let startTs;
      if (S.range === 'custom' && S.customStart && S.customEnd) {
        startTs = ts(S.customStart); endTs = ts(S.customEnd);
      } else if (S.range === 'all') {
        /* 全部区间：所有线取「最晚的首日」为共同起点（保证可比较） */
        let latestFirst = 0;
        Object.keys(S.data).forEach((k) => {
          const d = S.data[k];
          if (d && d.series && d.series.length) latestFirst = Math.max(latestFirst, ts(d.series[0][0]));
        });
        startTs = latestFirst || firstTs;
      } else {
        startTs = minusRange(endTs, S.range);
      }
      return { startTs, endTs };
    }

    /* ---- 画图 ---- */
    function draw() {
      const svg = q('.tr-svg');
      const tip = q('.tr-tip');
      if (tip) tip.hidden = true;
      /* 按容器实测像素绘制：viewBox = 实际尺寸 → 文字/线条 1:1，任何屏幕都不放大缩小 */
      const W = Math.max(320, Math.round(svg.clientWidth || 900));
      const H = Math.max(220, Math.round(svg.clientHeight || 300));
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      /* 2026-10-19：纵轴刻度移到左边 → 左侧留白给标签，右侧不再留 */
      const PL = 64, PR = W - 12, PT = 24, PB = H - 26;
      const win = currentWindow();
      if (!win) {
        /* 2026-10-21：区分「没选」与「选了但该基金无日度净值」，避免用户以为图坏了 */
        const anyErr = S.items.some((it) => { const d = S.data[keyOf(it)]; return d && d.err; });
        const msg = anyErr ? _t('该基金暂无日度净值数据，无法绘制走势图（利息基金／非单位化基金官方不提供单位净值）') : _t('请在上方选择指数或基金开始对比');
        svg.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" class="tr-empty">' + esc0(msg) + '</text>';
        q('.tr-tablewrap').innerHTML = '';
        return;
      }
      const { startTs, endTs } = win;
      const lines = [];
      S.items.forEach((it, i) => {
        const d = S.data[keyOf(it)];
        if (!d || !d.series) return;
        const w = windowed(d.series, startTs, endTs);
        if (!w) return;
        const isIdx = it.type === 'index' || it.type === 'tavg';
        const name = itemLabel(it);
        const st = styleOf(it, i);
        lines.push({ key: keyOf(it), name, color: st.color, width: st.width, dash: st.dash, win: w, isIdx });
      });
      if (!lines.length) {
        const msg = S.items.length ? _t('数据加载中…') : _t('暂无对比对象——请从上方「选择指数 / 选择基金」添加');
        svg.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" class="tr-empty">' + esc0(msg) + '</text>';
        q('.tr-tablewrap').innerHTML = '';
        return;
      }
      /* 2026-10-17：单线模式直接画实际值（净值 / 指数点位）；多线仍归一化 1000 */
      const single = lines.length === 1;
      const P = (L) => (single ? L.win.raw : L.win.norm);
      const noteEl = q('.tr-note');
      if (noteEl) noteEl.style.display = single ? 'none' : '';
      let ymin = Infinity, ymax = -Infinity;
      lines.forEach((L) => P(L).forEach(([, v]) => { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }));
      if (!(ymax > ymin)) ymax = ymin + 10;
      const pad = (ymax - ymin) * 0.07;
      ymin -= pad; ymax += pad;
      /* 2026-10-19：纵向刻度取「整齐步长」（1/2/2.5/5/10…），上下界对齐步长整数倍 */
      let stepY = 1;
      (function niceAxis() {
        const range = ymax - ymin;
        const raw = range / 4;
        const pw = Math.pow(10, Math.floor(Math.log10(raw || 1)));
        const nn = raw / pw;
        const mul = nn <= 1 ? 1 : nn <= 2 ? 2 : nn <= 2.5 ? 2.5 : nn <= 5 ? 5 : 10;
        let step = mul * pw;
        if (single) step = Math.max(step, Math.pow(10, Math.floor(Math.log10(range || 1))) / 10);
        ymin = Math.floor(ymin / step) * step;
        ymax = Math.ceil(ymax / step) * step;
        if (ymax === ymin) ymax = ymin + step;
        stepY = step;
      })();
      const t0 = startTs, t1 = endTs;
      /* 坐标：plot 区 x ∈ [PL, PR]，y ∈ [PT, PB]（全部按实测像素） */
      const X = (t) => PL + ((t - t0) / Math.max(1, t1 - t0)) * (PR - PL);
      const Y = (v) => PT + (1 - (v - ymin) / (ymax - ymin)) * (PB - PT);

      let g = '';
      /* 纵轴说明：单线=实际值；多线=指数化 */
      g += '<text x="8" y="13" class="tr-ylab">' + esc0(single ? _t('实际值：净值 / 指数点位') : _t('累计涨跌幅（区间起点 = 0%）')) + '</text>';
      /* 刻度条数随上下界与步长决定（保证 5%/10% 这种整齐值） */
      const NGY = Math.min(12, Math.max(2, Math.round((ymax - ymin) / (stepY || 1))));
      const yfmt = (v) => (single ? (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2)) : (Math.round(v * 10) / 10).toFixed(1) + '%');
      for (let i = 0; i <= NGY; i++) {
        const v = ymin + (ymax - ymin) * (i / NGY);
        const y = Y(v);
        g += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + PR + '" y2="' + y.toFixed(1) + '" class="tr-grid"/>';
        /* 2026-10-19：纵轴刻度移到左侧（领导要求） */
        g += '<text x="' + (PL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" class="tr-ylab">' + yfmt(v) + '</text>';
      }
      /* 多线：0% 基准线（对齐合作方图表，涨跌一目了然） */
      if (!single && ymin < 0 && ymax > 0) {
        const y0 = Y(0);
        g += '<line x1="' + PL + '" y1="' + y0.toFixed(1) + '" x2="' + PR + '" y2="' + y0.toFixed(1) +
             '" stroke="#e05252" stroke-width="1" stroke-dasharray="4 3" opacity="0.75"/>';
      }
      const NX = 5;
      for (let i = 0; i <= NX; i++) {
        const t = t0 + (t1 - t0) * (i / NX);
        const x = X(t);
        const lab = dstr(t).replace(/-/g, '/');
        const anchor = i === 0 ? 'start' : (i === NX ? 'end' : 'middle');
        const xx = i === 0 ? PL : (i === NX ? PR : x);
        g += '<text x="' + xx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '" class="tr-xlab">' + lab + '</text>';
      }
      /* 两条线时填充其间色带（参照合作方站） */
      if (lines.length === 2) {
        const A = lines[0].win.norm, B = lines[1].win.norm;
        const bAt = (t) => { let best = null, bd = Infinity; B.forEach(([bt, bv]) => { const d2 = Math.abs(bt - t); if (d2 < bd) { bd = d2; best = bv; } }); return best; };
        let path = '';
        A.forEach(([t, v], i) => { path += (i ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Y(v).toFixed(1); });
        for (let i = A.length - 1; i >= 0; i--) {
          const t = A[i][0]; const bv = bAt(t);
          if (bv == null) continue;
          path += 'L' + X(t).toFixed(1) + ' ' + Y(bv).toFixed(1);
        }
        path += 'Z';
        g += '<path d="' + path + '" fill="' + lines[0].color + '" fill-opacity="0.10" stroke="none" class="tr-band"/>';
      }
      lines.forEach((L) => {
        let path = '';
        P(L).forEach(([t, v], i) => { path += (i ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Y(v).toFixed(1); });
        g += '<path d="' + path + '" fill="none" stroke="' + L.color + '" stroke-width="' + (L.width || 2) + '"' +
          (L.dash ? ' stroke-dasharray="' + L.dash + '"' : '') +
          ' stroke-linejoin="round" stroke-linecap="round" class="tr-line"/>';
      });
      g += '<g class="tr-cross" style="display:none"><line y1="' + PT + '" y2="' + PB + '" class="tr-crossline"/></g>';
      /* 2026-10-18 修复：重绘前强制隐藏悬浮提示——否则取消选择/切换发行人后
         图表已重绘而 tooltip 仍显示上一次的悬停内容（用户报「没选基金却有浮窗」） */
      if (tip) tip.hidden = true;
      svg.innerHTML = g;

      const cross = svg.querySelector('.tr-cross');
      const crossline = svg.querySelector('.tr-crossline');
      const mySeq = ++MOVE_SEQ;
      const move = (ev) => {
        /* 旧 draw 闭包失效 + 无线条（未选基金/全部取消）时不弹悬浮提示 */
        if (mySeq !== MOVE_SEQ) return;
        if (!lines.length) { tip.hidden = true; return; }
        const rect = svg.getBoundingClientRect();
        const cx = (ev.clientX - rect.left) / rect.width * W;
        const L0 = lines[0];
        let best = null, bd = Infinity;
        P(L0).forEach(([t]) => { const d2 = Math.abs(X(t) - cx); if (d2 < bd) { bd = d2; best = t; } });
        if (!best) return;
        const bx = X(best);
        cross.style.display = '';
        crossline.setAttribute('x1', bx); crossline.setAttribute('x2', bx);
        let rows = '';
        const dots = [];
        lines.forEach((L) => {
          let p = null, pd = Infinity, raw = null, rd = Infinity, pn = null, nd = Infinity;
          P(L).forEach(([t, v]) => { const d2 = Math.abs(t - best); if (d2 < pd) { pd = d2; p = [t, v]; } });
          L.win.raw.forEach(([t, v]) => { const d2 = Math.abs(t - best); if (d2 < rd) { rd = d2; raw = [t, v]; } });
          /* 2026-10-18 修复：单线模式 P(L) 返回的是实际净值（非归一化），
             此前直接用 p[1]/10-100 算涨幅 → 净值 44.73 变成 -95.5%（用户报的假大跌）。
             涨幅统一取归一化序列的点计算。 */
          L.win.norm.forEach(([t, v]) => { const d2 = Math.abs(t - best); if (d2 < nd) { nd = d2; pn = [t, v]; } });
          if (!p) return;
          dots.push('<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="3.2" fill="' + L.color + '"/>');
          const chg = pn ? pn[1] : null;   /* norm 已是累计涨跌幅 %（2026-10-19） */
          rows += '<div class="tr-tip-row"><i style="background:' + L.color + '"></i><span class="n">' + esc0(L.name) + '</span>' +
            '<b class="' + clsOf(chg) + '">' + fmtPct(chg) + '</b>' +
            '<em>' + (raw ? fmtRaw(raw[1]) : '') + '</em></div>';
        });
        svg.querySelectorAll('.tr-dot').forEach((n) => n.remove());
        const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        grp.setAttribute('class', 'tr-dot');
        grp.innerHTML = dots.join('');
        svg.appendChild(grp);
        tip.innerHTML = '<div class="tr-tip-date">' + dstr(best) + '</div>' + rows;
        tip.hidden = false;
        const cr = q('.tr-canvas').getBoundingClientRect();
        const px = ev.clientX - cr.left;
        const py = ev.clientY - cr.top;
        const pw = tip.offsetWidth || 220;
        const ph = tip.offsetHeight || 120;
        /* 2026-10-19：跟随光标，优先右下角；右侧不足翻左、下方不足翻上 */
        let lx = px + 14;
        if (lx + pw > cr.width - 8) lx = px - pw - 14;
        lx = Math.min(Math.max(8, lx), Math.max(8, cr.width - pw - 8));
        /* 2026-10-19：浮窗固定落在光标的右下角，不遮挡曲线与数值 */
        let ly = py + 14;
        if (ly + ph > cr.height - 8) ly = py - ph - 14;
        ly = Math.min(Math.max(8, ly), Math.max(8, cr.height - ph - 8));
        tip.style.left = lx + 'px';
        tip.style.top = ly + 'px';
      };
      svg.onpointermove = move;
      /* 2026-10-18 修复：此前 svg.onpointerdown = move 与 addEventListener 并存，
         且 touch listener 每次 draw 累积（旧闭包捕获旧 lines）——点击图表时
         旧 move 用上一次的线条数据覆盖 tooltip（用户报「没选基金却浮出旧基金提示」）。
         现统一为一个赋值式 handler，并用 MOVE_SEQ 令牌令旧闭包失效。 */
      svg.onpointerdown = function (e) {
        if (e.pointerType === 'touch') {
          if (S.touchTip) {
            S.touchTip = false;
            tip.hidden = true;
            const cr2 = svg.querySelector('.tr-cross');
            if (cr2) cr2.style.display = 'none';
          } else {
            move(e);
            S.touchTip = true;
          }
        } else {
          move(e);
        }
      };
      /* 2026-10-14 修复：此前只有 pointermove，鼠标移出/点击空白后悬浮提示不消失 */
      svg.onpointerleave = function () {
        if (S.touchTip) return;   // 触屏点开的提示不因手指移开而消失
        tip.hidden = true;
        const cr = svg.querySelector('.tr-cross');
        if (cr) cr.style.display = 'none';
      };

      renderTable(lines, startTs, endTs);
    }

    let cachedAll = null;
    /* 未选基金（仅指数线）→ 全量基金区间统计（2026-10-15）；弹窗内（hideGoto）不启用 */
    function renderAllFundsTable(wrap) {
      const key = { '1w': 'w1', '1m': 'm1', '1y': 'y1', '3y': 'y3', '5y': 'y5', 'all': 'all' }[S.range];
      const head = '<thead><tr><th>' + esc0( _t('名称')) + '</th><th class="r">' + esc0( _t('最新点位')) + '</th><th class="r">' + esc0( _t('区间收益')) + '</th><th class="r">' + esc0( _t('区间最大回撤')) + '</th><th class="r">' + esc0( _t('最大回撤起始日期')) + '</th><th class="r">' + esc0( _t('最大回撤结束日期')) + '</th></tr></thead>';
      if (!key) {
        wrap.innerHTML = '<div class="tr-allnote">' + esc0( _t('该区间为自定义日期——请先勾选基金，再查看逐只区间统计。')) + '</div>';
        return;
      }
      const done = (all) => {
        const w = (all && all.windows && all.windows[key]) || {};
        const ids = Object.keys(w).sort((a, b) => w[b].r - w[a].r);
        const rows = ids.map((id) => {
          const st = w[id];
          return '<tr><td class="n"><a class="tr-addfund" data-addfund="' + esc0(id) + '" title="' + esc0( _t('加入对比')) + '">＋</a>' +
            '<span class="nm">' + esc0(st.name) + '</span><span class="tr-raw">' + esc0(st.trustee || '') + (st.unit || '') + '</span></td>' +
            '<td class="r">' + nf0(st.last, 2) + '</td>' +
            '<td class="r ' + clsOf(st.r) + '">' + fmtPct(st.r) + '</td>' +
            '<td class="r down">' + (st.d < -0.005 ? fmtPct(st.d) : '0.00%') + '</td>' +
            '<td class="r date">' + (st.f ? dstr(ts(st.f)) : '—') + '</td>' +
            '<td class="r date">' + (st.t ? dstr(ts(st.t)) : '—') + '</td></tr>';
        }).join('');
        wrap.innerHTML = '<div class="tr-tbl-scroll"><table class="tr-tbl tr-tbl-all">' + head + '<tbody>' + rows + '</tbody></table></div>' +
          '<div class="tr-allnote">' + esc0( _t('未选择基金：以上为全部基金的区间统计（点「＋」或名称加入对比）。')) + '</div>';
      };
      if (cachedAll) { done(cachedAll); return; }
      wrap.innerHTML = '<div class="tr-allnote">' + esc0( _t('加载全部基金统计…')) + '</div>';
      fetch('/api/allstats', { cache: 'force-cache' }).then((r) => (r.ok ? r.json() : null))
        .then((j) => { cachedAll = j; done(j); })
        .catch(() => { wrap.innerHTML = ''; });
    }

    function renderTable(lines, startTs, endTs) {
      const wrap = q('.tr-tablewrap');
      const years = (endTs - startTs) / (365.25 * 86400000);
      /* 2026-10-15：未选基金时不再在此处渲染全量表（避免表格跳变）；全量由页面下方资料库列表承担 */
      /* 2026-10-15：主对比页表格只列基金（指数行不混入基金列表；弹窗内保留对比指数走势的双行） */
      if (q('.tr-gotowrap') && lines.some((L) => !L.isIdx)) lines = lines.filter((L) => !L.isIdx);
      const rows = lines.map((L) => {
        const last = L.win.norm[L.win.norm.length - 1][1];
        const ret = last;   /* norm = 累计涨跌幅 % */
        const m = mddOf(L.win);
        const rawLast = L.win.raw[L.win.raw.length - 1][1];
        /* 实际值一并给出（基金=净值 + HKD；指数=点位）——避免纵轴指数化后「对不上」的疑惑 */
        const rawTip = L.isIdx
          ? '<span class="tr-raw">(' + nf0(rawLast, 2) + ')</span>'
          : '<span class="tr-raw">(' + fmtRaw(rawLast) + ' HKD)</span>';
        /* 数据起点晚于所选区间起点时标注（该行收益实际按首日起算） */
        const firstT = ts(L.win.raw[0][0]);
        const late = firstT > startTs + 7 * 86400000;
        const lateMark = late ? '<span class="tr-late" data-tip="' +
          esc0( _tq('该标的的历史数据自 {d} 起，区间收益与回撤按首日起算', { d: L.win.raw[0][0] })) + '">*</span>' : '';
        return '<tr>' +
          '<td class="n"><i style="background:' + L.color + '"></i><span class="nm">' + esc0(L.name) + '</span></td>' +
          /* 2026-10-20：按需求删除「最新点位」列（避免横向滚动） */
          '<td class="r ' + clsOf(ret) + '">' + fmtPct(ret) + lateMark + '</td>' +
          '<td class="r down">' + (m.mdd < -0.005 ? fmtPct(m.mdd) : '0.00%') + lateMark + '</td>' +
          /* 2026-10-24 修 F29：无回撤时 fromT/toT=0，dstr(0) 显示 1970-01-01 → 输出 — */
          '<td class="r date">' + (m.mdd < -0.005 ? dstr(m.fromT) : '—') + '</td>' +
          '<td class="r date">' + (m.mdd < -0.005 ? dstr(m.toT) : '—') + '</td>' +
          '</tr>';
      }).join('');
      wrap.innerHTML =
        '<div class="tr-tbl-scroll"><table class="tr-tbl">' +
          '<thead><tr>' +
            '<th>' + esc0( _t('名称')) + '</th>' +
            '<th class="r">' + esc0( _t('区间收益')) + ' <span class="tr-q" data-tip="' + esc0( _t('区间收益 = 末值 ÷ 区间起点 − 1（区间起点 = 0%）')) + '">?</span></th>' +
            '<th class="r">' + esc0( _t('区间最大回撤')) + ' <span class="tr-q" data-tip="' + esc0( _t('区间最大回撤 = 运行峰值法，取区间内峰值到谷值的最大跌幅')) + '">?</span></th>' +
            '<th class="r">' + esc0( _t('最大回撤起始日期')) + '</th>' +
            '<th class="r">' + esc0( _t('最大回撤结束日期')) + '</th>' +
          '</tr></thead><tbody>' + rows + '</tbody>' +
        '</table></div>';
      void years;
    }

    /* ---- 初始化 ---- */
    renderLegend();
    draw();
    syncSelButtons();
    S.items.forEach(loadItem);
    /* 2026-10-21：默认只有恒指时用 lite（2KB），选了其他指数才拉全量 543KB */
    const needFullIdx = S.items.some((it) => it.type === 'index' && it.key !== 'HSI');
    (needFullIdx ? ensureIdxs() : ensureIdxsLite()).then((d) => { cachedIdx = d; renderLegend(); draw(); syncSelButtons(); });
    ensurePerf().then((p) => { cachedPerf = p; renderLegend(); });
    /* 窗口尺寸变化重绘（viewBox 按容器实测像素，避免文字被整体缩放）；rAF 节流防抖 */
    let rafPending = false;
    function drawSoon() {
      if (rafPending) return;
      rafPending = true;
      const go = function () { rafPending = false; draw(); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else setTimeout(go, 16);
    }
    const onResize = function () {
      if (!box.isConnected) { window.removeEventListener('resize', onResize); return; }
      drawSoon();
    };
    window.addEventListener('resize', onResize);
    /* 容器宽度变化也重绘（弹窗显示、侧栏切换等场景） */
    if (typeof ResizeObserver === 'function') {
      let lastW = 0;
      const ro = new ResizeObserver(function () {
        if (!box.isConnected) { ro.disconnect(); return; }
        const w = box.clientWidth;
        if (Math.abs(w - lastW) < 2) return;
        lastW = w;
        drawSoon();
      });
      ro.observe(box);
    }

    return {
      setItems(items) { S.items = (items || []).slice(0, MAX_ITEMS); S.data = {}; renderLegend(); draw(); syncSelButtons(); S.items.forEach(loadItem); if (opts.onSelChange) opts.onSelChange(); },
      getItems() { return S.items.slice(); },
      getPerf() { return cachedPerf; },
      /* 左侧栏发行人筛选：更新筛选并即时刷新已打开的面板 */
      setFilter(f) { S.filter = f || { ids: null, label: '' }; const p = q('.tr-panel-fund'); if (p && !p.hidden) renderPanel('fund'); },
      /* 打开「选择基金」面板（点选发行人后自动调用） */
      openFundPanel() {
        closePanels();
        if (S.filter && S.filter.label) { S.panelTrustee = S.filter.label; S.panelType = ''; }
        const p = q('.tr-panel-fund');
        if (!p) return;
        p.hidden = false;
        const b = q('.tr-sel[data-panel="fund"]');
        if (b) b.classList.add('on');
        renderPanel('fund');
      },
    };
  }

  /* 点击面板/选择器/样式弹层以外的地方 → 关闭展开的面板、样式弹层与悬浮提示框（2026-10-14 强化） */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.isConnected === false) return;   // 被重渲染摘下的节点 → 不算「外部点击」
    if (e.target.closest && (e.target.closest('.tr-panel') || e.target.closest('.tr-sel') || e.target.closest('.tr-style'))) return;
    document.querySelectorAll('.tr-box .tr-panel').forEach(function (p) { if (!p.hidden) p.hidden = true; });
    document.querySelectorAll('.tr-box .tr-sel.on').forEach(function (b) { b.classList.remove('on'); });
    document.querySelectorAll('.tr-box .tr-style').forEach(function (p) { p.remove(); });
    /* 点击图表以外：收掉提示框与十字线 */
    if (!(e.target.closest && e.target.closest('.tr-canvas'))) {
      document.querySelectorAll('.tr-box .tr-tip').forEach(function (t) { t.hidden = true; });
      document.querySelectorAll('.tr-box .tr-cross').forEach(function (c) { c.style.display = 'none'; });
    }
  });

  return { mount, perfOf, ensurePerf, ensureHist, ensureIdxs };
})();
