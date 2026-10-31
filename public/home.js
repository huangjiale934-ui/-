/* 首页：香港强积金市场概览 + 市场排行榜
 * 数据来自 /api/market（服务端按积金局官方数值直接汇总，只做求和与算术平均）
 * 图表全部为原生 SVG —— 涨红跌绿（中国惯例），不引入任何第三方图表库。
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  /* 多语言取值（统一用 TT，避免与循环变量同名冲突） */
  const TT = (k, f) => (typeof window.t === 'function' ? window.t(k, f) : (f != null ? f : k));
  /* 带占位符的长句翻译：{x} 由调用处替换，避免把一句话拆成十几个碎片键 */
  const TQ = (k, map) => {
    let out = TT(k);
    Object.keys(map || {}).forEach((key) => { out = out.split('{' + key + '}').join(String(map[key])); });
    return out;
  };

  /** 规模入参单位为「百万港元」，按量级转成易读的亿 / 万亿 */
  function fmtSize(m) {
    if (m == null || Number.isNaN(m)) return '—';
    const en = (typeof window.getLang === 'function' && window.getLang() === 'en');
    if (Math.abs(m) >= 1e6) return en ? 'HK$' + (m / 1e6).toFixed(2) + 'tn' : (m / 1e6).toFixed(2) + ' ' + TT('万亿');
    if (Math.abs(m) >= 100) {
      return en ? 'HK$' + (m / 1000).toFixed(1) + 'bn'
        : Math.round(m / 100).toLocaleString('zh-CN') + ' ' + TT('亿');
    }
    return en ? 'HK$' + m.toFixed(0) + 'm' : m.toFixed(0) + ' ' + TT('百万');
  }
  const num = (v, d) => (v == null ? '—' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  const pctv = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%');
  const sgn = (v) => (v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

  /* ---------------- 配色 ---------------- */
  /* 2026-10-22（领导定）：全站图表配色改为「蓝 + 浅绿」双色，风险级别用蓝色由浅至深。
     保留 ?pal=old 可回看旧六色板；?pal=mono 为单色蓝备选。 */
  const PAL_MODE = (function () {
    try { return String(new URLSearchParams(location.search).get('pal') || '').toLowerCase(); }
    catch (e) { return ''; }
  })();
  const PAL_OLD = PAL_MODE === 'old';
  const PAL_MONO = PAL_MODE === 'mono';
  const PAL_BG = !PAL_OLD && !PAL_MONO;      /* 默认：蓝 + 浅绿 */
  /* 蓝绿交替，绿色一律取浅调（#7ed3b2 起），避免与「下跌绿」抢注意力 */
  const PALETTE = PAL_MONO
    ? ['#dbeaf9', '#c3daf2', '#a9cbea', '#8fbce3', '#76acdc', '#5d9cd4']
    : PAL_OLD
      ? ['#1f5fa8', '#2f9e8f', '#e0a13e', '#7b6bb0', '#d4695f', '#6b7f99']
      /* 2026-10-29（5.0）：整体加深一档——深蓝 / logo 绿 / 中蓝 / 浅绿 / 亮蓝 / 淡绿 */
      : ['#0b5fa5', '#8cc63f', '#2e86c8', '#b5d96b', '#7bbef4', '#d7e9b8'];
  const PALETTE_TR = PAL_MONO
    ? ['#dbeaf9', '#c3daf2', '#a9cbea', '#8fbce3', '#76acdc', '#eef6fd']
    : PAL_OLD
      ? ['#1f5fa8', '#2f9e8f', '#e0a13e', '#7b6bb0', '#d4695f', '#b9c2cf']
      : ['#0b5fa5', '#8cc63f', '#2e86c8', '#b5d96b', '#7bbef4', '#d7e9b8'];
  const C_UP = '#d93025';   // 涨 · 红
  const C_DOWN = '#12996b'; // 跌 · 绿
  const C_FLAT = '#7a8699';
  /* 2026-10-29（5.0，用户指定）：市场温度计单独用「品牌蓝 + logo 绿」——
     高回报深蓝、中段亮蓝、低回报绿；仅此组件生效，站内其他涨跌仍为红涨绿跌 */
  const T_HI = '#084e8c';
  const T_MID = '#7bbef4';
  const T_LO = '#5f9e2f';

  /* 风险级别：统一走 common.js 的 MPF_RISK（已改为蓝色由浅至深），与详情页/资料库一致 */
  const riskColor = (lv) => MPF_RISK.color(lv);
  const RISK_LABEL = MPF_RISK.labels;

  /* 图表列名缩写（面板较窄，避免折行） */
  function shortType(n) {
    return String(n)
      .replace('貨幣市場基金 — 強積金保守基金', '貨幣市場（保守）')
      .replace('貨幣市場基金 — 不包括強積金保守基金', '貨幣市場（非保守）')
      .replace('貨幣市場基金 — ', '貨幣市場（');
  }
  function axisType(n) {
    return String(n)
      .replace('貨幣市場基金 — 強積金保守基金', '貨幣保守')
      .replace('貨幣市場基金 — 不包括強積金保守基金', '貨幣非保守')
      .replace('混合資產基金', '混合資產')
      .replace('股票基金', '股票')
      .replace('保證基金', '保證')
      .replace('債券基金', '債券');
  }

  /* ---------------- SVG 基础工具 ---------------- */
  const TAU = Math.PI * 2;
  const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const fx = (n) => Math.round(n * 100) / 100;

  function arc(cx, cy, r, r0, a0, a1) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p0 = polar(cx, cy, r, a0);
    const p1 = polar(cx, cy, r, a1);
    if (r0 <= 0) {
      return 'M' + cx + ' ' + cy + 'L' + fx(p0[0]) + ' ' + fx(p0[1])
        + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + fx(p1[0]) + ' ' + fx(p1[1]) + 'Z';
    }
    const p2 = polar(cx, cy, r0, a1);
    const p3 = polar(cx, cy, r0, a0);
    return 'M' + fx(p0[0]) + ' ' + fx(p0[1])
      + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + fx(p1[0]) + ' ' + fx(p1[1])
      + 'L' + fx(p2[0]) + ' ' + fx(p2[1])
      + 'A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + fx(p3[0]) + ' ' + fx(p3[1]) + 'Z';
  }

  /** 环形图 / 扇形图（inner=0 时即扇形图） */
  function pieSVG(items, opt) {
    opt = opt || {};
    const S = opt.size || 132;
    const cx = S / 2;
    const cy = S / 2;
    const r = S / 2 - 1;
    const r0 = r * (opt.inner == null ? 0.6 : opt.inner);
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) return '<div class="chart-empty">' + TT('暂无可统计数据') + '</div>';
    let a = -Math.PI / 2;
    let paths = '';
    items.forEach((it) => {
      if (it.value <= 0) return;
      const ang = (it.value / total) * TAU;
      const segs = ang >= TAU - 1e-6 ? [ang / 2, ang / 2] : [ang];
      segs.forEach((seg) => {
        paths += '<path d="' + arc(cx, cy, r, r0, a, a + seg) + '" fill="' + it.color + '">'
          + '<title>' + esc(it.name) + '：' + (it.lt ? '<' : '') + num(it.value)
          + '（' + (it.lt ? '<' : '') + ((it.value / total) * 100).toFixed(1) + '%）</title></path>';
        a += seg;
      });
    });
    const c = opt.center || {};
    return '<svg class="chart-svg pie" viewBox="0 0 ' + S + ' ' + S + '" width="' + S + '" height="' + S + '" role="img">'
      + paths
      + (c.top || c.bottom
        ? '<text class="pie-c1" x="' + cx + '" y="' + (cy - (c.bottom ? 0 : 4)) + '" text-anchor="middle">' + esc(c.top || '') + '</text>'
          + (c.bottom ? '<text class="pie-c2" x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle">' + esc(c.bottom) + '</text>' : '')
        : '')
      + '</svg>';
  }

  function legendHTML(items, total, vfmt) {
    return '<ul class="pie-legend">'
      + items.map((it) => '<li>'
        + '<i style="background:' + it.color + '"></i>'
        + '<span class="lg-n" title="' + esc(it.name) + '">' + esc(it.label || it.name) + '</span>'
        + '<span class="lg-v">' + String(vfmt(it, total)).replace(/ {2,}/g, ' ') + '</span>'
        + '</li>').join('')
      + '</ul>';
  }

  /** 计算「好看」的纵轴刻度 */
  function niceScale(minV, maxV, target) {
    const tg = target || 5;
    let lo = Math.min(0, minV == null ? 0 : minV);
    let hi = Math.max(0, maxV == null ? 0 : maxV);
    if (hi - lo < 1e-6) hi = lo + 1;
    const raw = (hi - lo) / tg;
    const cands = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200];
    const step = cands.find((c) => c >= raw) || 200;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { lo: lo, hi: hi, ticks: ticks, step: step };
  }

  /* ---------------- 1. 市场涨跌温度计 ---------------- */
  function thermometer(m) {
    /* 2026-10-22（用户要求）：温度计改用「自算净值口径」的日度数据（最新净值日），
       积金局季频口径（含费含息）作为对照单列一行，两套口径分开标注、不混用。 */
    const sf = (m.self && m.self.base) ? m.self : null;
    /* 2026-10-31（用户要求）：平均回报改规模加权 */
    const v = sf ? (sf.wavg != null ? sf.wavg : sf.avg) : m.avgAnn1;
    if (v == null) return '<div class="chart-empty">' + TT('暂无回报数据') + '</div>';
    const lo = Math.min(-10, Math.floor((v - 12) / 5) * 5);
    const hi = Math.max(10, Math.ceil((v + 12) / 5) * 5);
    const W = 168, H = 308;
    const tubeX = 52, tubeW = 40, tubeTop = 16, tubeH = 226;
    const tubeBot = tubeTop + tubeH;
    const bulbCx = tubeX + tubeW / 2, bulbCy = tubeBot + 30, bulbR = 30;
    const pos = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const markY = tubeTop + tubeH * (1 - pos);
    const col = v > 0 ? T_HI : v < 0 ? T_LO : C_FLAT;

    const tick = (val) => {
      const p = (val - lo) / (hi - lo);
      const y = tubeTop + tubeH * (1 - p);
      return '<line class="tick-line" x1="' + (tubeX + tubeW + 6) + '" y1="' + fx(y) + '" x2="' + (tubeX + tubeW + 16) + '" y2="' + fx(y) + '"/>'
        + '<text class="tick-txt" x="' + (tubeX - 6) + '" y="' + fx(y + 3.5) + '" text-anchor="end">' + (val > 0 ? '+' : '') + val + '%</text>'
        + '<line class="tick-grid" x1="' + tubeX + '" y1="' + fx(y) + '" x2="' + (tubeX + tubeW) + '" y2="' + fx(y) + '"/>';
    };

    const svg = '<svg class="thermo-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(TT('市场涨跌温度计')) + '">'
      + '<defs>'
      + '<linearGradient id="tgrad" gradientUnits="userSpaceOnUse" x1="0" y1="' + tubeTop + '" x2="0" y2="' + tubeBot + '">'
      + '<stop offset="0" stop-color="' + T_HI + '"/><stop offset="0.52" stop-color="' + T_MID + '"/><stop offset="1" stop-color="' + T_LO + '"/>'
      + '</linearGradient>'
      + '<clipPath id="tclip"><rect x="' + tubeX + '" y="' + tubeTop + '" width="' + tubeW + '" height="' + tubeH + '" rx="' + tubeW / 2 + '"/></clipPath>'
      + '</defs>'
      + '<rect class="thermo-track" x="' + tubeX + '" y="' + tubeTop + '" width="' + tubeW + '" height="' + tubeH + '" rx="' + tubeW / 2 + '"/>'
      + '<g clip-path="url(#tclip)"><rect x="' + tubeX + '" y="' + fx(markY) + '" width="' + tubeW + '" height="' + fx(tubeBot - markY) + '" fill="url(#tgrad)"/></g>'
      + '<circle class="thermo-bulb" cx="' + bulbCx + '" cy="' + bulbCy + '" r="' + bulbR + '" fill="' + T_LO + '"/>'
      + tick(hi) + tick(0) + tick(lo)
      + '<line class="mark-line" x1="' + (tubeX - 2) + '" y1="' + fx(markY) + '" x2="' + (tubeX + tubeW + 34) + '" y2="' + fx(markY) + '" stroke="' + col + '"/>'
      + '<circle class="mark-dot" cx="' + bulbCx + '" cy="' + fx(markY) + '" r="7" fill="' + col + '"/>'
      + '<g transform="translate(' + (tubeX + tubeW + 12) + ',' + fx(Math.max(tubeTop, Math.min(tubeBot - 12, markY - 11))) + ')">'
      + '<rect class="mark-pill" width="62" height="22" rx="11" fill="' + col + '"/>'
      + '<text class="mark-val" x="31" y="15.5" text-anchor="middle">' + pctv(v) + '</text>'
      + '</g>'
      + '</svg>';

    const base = sf ? sf.base : (m.upBase || 0);
    const up = sf ? sf.up : (m.upCount || 0);
    const flat = sf ? sf.flat : (m.flatCount || 0);
    const down = sf ? sf.down : (m.downCount || 0);
    const med = sf ? sf.median : m.medianAnn1;
    const asOfTxt = sf ? sf.asOf : (m.dataAsOf || '');
    const pc = (n) => (base ? ((n / base) * 100).toFixed(1) : '0.0');
    const w = (n) => (base ? Math.max(n ? 3 : 0, (n / base) * 100) : 0);

    const stats = '<div class="thermo-stats">'
      + '<div class="ts-row">'
      + '<div class="ts-box"><span class="ts-k">' + TT('近 1 年平均回报') + '</span>'
      + '<b class="ts-v ' + sgn(v) + '">' + pctv(v) + '</b><span class="ts-s">' + TT('全市场规模加权') + '</span></div>'
      + '<div class="ts-box"><span class="ts-k">' + TT('近 1 年中位数回报') + '</span>'
      + '<b class="ts-v ' + sgn(med) + '">' + pctv(med) + '</b><span class="ts-s">' + TT('一半基金高于此值') + '</span></div>'
      + '<div class="ts-box"><span class="ts-k">' + TT('正回报基金占比') + '</span>'
      + '<b class="ts-v">' + pc(up) + '%</b><span class="ts-s">' + num(up) + ' / ' + num(base) + '</span></div>'
      + '</div>'
      + '<div class="ts-bar">'
      + '<i class="tb-up" style="width:' + w(up) + '%"></i>'
      + '<i class="tb-flat" style="width:' + w(flat) + '%"></i>'
      + '<i class="tb-down" style="width:' + w(down) + '%"></i>'
      + '</div>'
      + '<ul class="ts-list">'
      + '<li><i class="mk-dot up"></i>' + TT('上涨') + ' <b class="up">' + num(up) + ' ' + TT('条') + '</b><span>（' + pc(up) + '%）</span></li>'
      + '<li><i class="mk-dot flat"></i>' + TT('平盘') + ' <b>' + num(flat) + ' ' + TT('条') + '</b><span>（' + pc(flat) + '%）</span></li>'
      + '<li><i class="mk-dot down"></i>' + TT('下跌') + ' <b class="down">' + num(down) + ' ' + TT('条') + '</b><span>（' + pc(down) + '%）</span></li>'
      + '</ul>'
      + '</div>';

    return '<div class="thermo-wrap">' + svg + stats + '</div>';
  }

  /* ---------------- 2. 各类基金平均回报对比（分组柱状图） ---------------- */
  function groupedBars(types) {
    /* 三期分别用红 / 蓝 / 青三色，红色突出最新一年 */
    const series = [
      { key: 'avgAnn1', name: TT('近 1 年'), color: '#d93025' },
      { key: 'avgAnn5', name: TT('近 5 年'), color: '#0866bb' },
      { key: 'avgAnn10', name: TT('近 10 年'), color: '#2f9e8f' },
    ];
    const cats = types.filter((x) => x.avgAnn1 != null || x.avgAnn5 != null || x.avgAnn10 != null);
    if (!cats.length) return '<div class="chart-empty">' + TT('暂无回报数据') + '</div>';

    const W = 372, H = 214, padL = 30, padR = 10, padT = 30, padB = 40;
    const pw = W - padL - padR, ph = H - padT - padB;
    let minV = 0, maxV = 0;
    cats.forEach((c) => series.forEach((s) => { if (c[s.key] != null) { minV = Math.min(minV, c[s.key]); maxV = Math.max(maxV, c[s.key]); } }));
    const sc = niceScale(minV, maxV, 5);
    const y = (v) => padT + ph * (1 - (v - sc.lo) / (sc.hi - sc.lo));
    const y0 = y(0);
    const gw = pw / cats.length;
    const bw = Math.max(5, Math.min(15, (gw - 10) / series.length));

    let grid = '';
    sc.ticks.forEach((tk) => {
      grid += '<line class="chart-grid" x1="' + padL + '" y1="' + fx(y(tk)) + '" x2="' + (W - padR) + '" y2="' + fx(y(tk)) + '"/>'
        + '<text class="chart-axis" x="' + (padL - 5) + '" y="' + fx(y(tk) + 3.5) + '" text-anchor="end">' + (tk > 0 ? '+' : '') + tk + '</text>';
    });

    let bars = '';
    cats.forEach((c, i) => {
      const gx = padL + gw * i + gw / 2;
      const total = bw * series.length + 3 * (series.length - 1);
      const x0 = gx - total / 2;
      series.forEach((s, j) => {
        const v = c[s.key];
        if (v == null) return;
        const bx = x0 + j * (bw + 3);
        const top = Math.min(y(v), y0);
        const h = Math.max(1.5, Math.abs(y(v) - y0));
        bars += '<rect class="mk-bar" x="' + fx(bx) + '" y="' + fx(top) + '" width="' + fx(bw) + '" height="' + fx(h) + '" rx="2" fill="' + s.color + '">'
          + '<title>' + esc(c.name) + ' · ' + esc(s.name) + '：' + pctv(v) + '</title></rect>';
        if (j === 0) {
          bars += '<text class="bar-val" x="' + fx(bx + bw / 2) + '" y="' + fx(y(v) - 4) + '" text-anchor="middle">' + Number(v).toFixed(1) + '</text>';
        }
      });
      bars += '<text class="chart-xlab" x="' + fx(gx) + '" y="' + (padT + ph + 15) + '" text-anchor="middle">' + esc(typeLabel(axisType(c.name))) + '</text>';
      bars += '<text class="chart-xsub" x="' + fx(gx) + '" y="' + (padT + ph + 26) + '" text-anchor="middle">' + c.count + '</text>';
    });

    const legend = '<ul class="chart-legend">' + series.map((s) =>
      '<li><i style="background:' + s.color + '"></i>' + s.name + '</li>').join('') + '</ul>';

    return '<div class="chart-head">' + legend + '</div>'
      + '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(TT('各类基金平均回报对比')) + '">'
      + grid
      + '<line class="chart-zero" x1="' + padL + '" y1="' + fx(y0) + '" x2="' + (W - padR) + '" y2="' + fx(y0) + '"/>'
      + bars + '</svg>'
      + '<p class="chart-foot">' + TT('单位：% p.a.（年率化）。由积金局各类别内基金算术平均得出；「貨幣保守」＝強積金保守基金，「貨幣非保守」＝不包括強積金保守基金；不足 10 年历史的类别不计算近 10 年值。') + '</p>';
  }

  /* ---------------- 3. 市场整体回报走势（可切换年份探索） ---------------- */
  let lastM = null;
  let yearSel = 'all';

  function yearLine(rows) {
    const rows2 = (rows || []).filter((r) => (r.wavg != null ? r.wavg : r.avg) != null);
    if (rows2.length < 2) return '<div class="chart-empty">' + TT('暂无历年回报数据') + '</div>';
    const W = 372, H = 240, padL = 32, padR = 14, padT = 22, padB = 34;   /* 2026-10-31 二版（用户要求）：图收窄协调 */
    const pw = W - padL - padR, ph = H - padT - padB;
    let minV = 0, maxV = 0;
    rows2.forEach((r) => { const A = (r.wavg != null ? r.wavg : r.avg); minV = Math.min(minV, A, r.median == null ? A : r.median); maxV = Math.max(maxV, A, r.median == null ? A : r.median); });
    const sc = niceScale(minV, maxV, 4);
    const X = (i) => padL + (pw / (rows2.length - 1)) * i;
    const Y = (v) => padT + ph * (1 - (v - sc.lo) / (sc.hi - sc.lo));
    const y0 = Y(0);

    let grid = '';
    sc.ticks.forEach((tk) => {
      grid += '<line class="chart-grid" x1="' + padL + '" y1="' + fx(Y(tk)) + '" x2="' + (W - padR) + '" y2="' + fx(Y(tk)) + '"/>'
        + '<text class="chart-axis" x="' + (padL - 5) + '" y="' + fx(Y(tk) + 3.5) + '" text-anchor="end">' + (tk > 0 ? '+' : '') + tk + '</text>';
    });

    const line = (key, color, dash) => {
      const pts = rows2.map((r, i) => (r[key] == null ? null : [X(i), Y(r[key])])).filter(Boolean);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + fx(p[0]) + ' ' + fx(p[1])).join('');
      return '<path class="line-path" d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2"'
        + (dash ? ' stroke-dasharray="5 4" opacity="0.85"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
    };

    const areaPts = rows2.map((r, i) => [X(i), Y(r.wavg != null ? r.wavg : r.avg)]);
    const area = 'M' + fx(areaPts[0][0]) + ' ' + fx(y0) + areaPts.map((p) => 'L' + fx(p[0]) + ' ' + fx(p[1])).join('')
      + 'L' + fx(areaPts[areaPts.length - 1][0]) + ' ' + fx(y0) + 'Z';

    let dots = '';
    rows2.forEach((r, i) => {
      const cx = X(i);
      const lx = Math.max(padL + 16, Math.min(W - padR - 16, cx));
      dots += '<text class="chart-xlab" x="' + fx(cx) + '" y="' + (padT + ph + 16) + '" text-anchor="middle">' + esc(r.year) + '</text>';
      if (r.median != null) {
        dots += '<circle cx="' + fx(cx) + '" cy="' + fx(Y(r.median)) + '" r="3" fill="#fff" stroke="' + C_FLAT + '" stroke-width="1.6">'
          + '<title>' + r.year + ' ' + TT('中位数') + '：' + pctv(r.median) + '</title></circle>';
      }
      const A = (r.wavg != null ? r.wavg : r.avg);
      if (A != null) {
        const c = A > 0 ? C_UP : A < 0 ? C_DOWN : C_FLAT;
        const vy = Y(A) - (A >= 0 ? 9 : -16);
        dots += '<circle cx="' + fx(cx) + '" cy="' + fx(Y(A)) + '" r="4.2" fill="' + c + '" stroke="#fff" stroke-width="1.6">'
          + '<title>' + r.year + ' ' + TT('规模加权平均') + '：' + pctv(A) + '（' + r.up + ' / ' + r.down + '，' + r.n + '）</title></circle>'
          + '<text class="line-val ' + sgn(A) + '" x="' + fx(lx) + '" y="' + fx(vy) + '" text-anchor="middle">' + pctv(A) + '</text>';
      }
    });

    return '<div class="chart-head"><ul class="chart-legend">'
      + '<li><i style="background:' + C_UP + '"></i>' + TT('规模加权平均') + '</li>'
      + '<li><i class="ln-dash"></i>' + TT('中位数') + '</li></ul></div>'
      + '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(TT('市场整体回报走势')) + '">'
      + grid
      + '<path d="' + area + '" fill="#e8f0f9" opacity="0.85"/>'
      + line('median', C_FLAT, true)
      + line('avg', '#1a6fb5', false)
      + '<line class="chart-zero" x1="' + padL + '" y1="' + fx(y0) + '" x2="' + (W - padR) + '" y2="' + fx(y0) + '"/>'
      + dots + '</svg>';
  }

  function yearPanel(m) {
    const rows = m.byYear || [];
    const keys = ['all'].concat(rows.map((r) => r.year));
    const tabs = '<div class="yr-tabs">' + keys.map((yy) =>
      '<button type="button" class="yr-tab' + (String(yearSel) === String(yy) ? ' on' : '') +
      '" data-y="' + yy + '">' + (yy === 'all' ? TT('全部年份') : yy) + '</button>').join('') + '</div>';
    if (String(yearSel) === 'all') return tabs + yearLine(rows);

    const r = rows.filter((x) => String(x.year) === String(yearSel))[0];
    if (!r || r.avg == null) return tabs + '<div class="chart-empty">' + TT('暂无历年回报数据') + '</div>';
    const i = rows.indexOf(r);
    const p = i > 0 ? rows[i - 1] : null;
    const base = r.n || 0;
    const pc = (n) => (base ? ((n / base) * 100).toFixed(1) : '0.0');
    const w = (n) => (base ? Math.max(n ? 3 : 0, (n / base) * 100) : 0);
    const d = p && p.avg != null ? (r.avg - p.avg) : null;
    return tabs + '<div class="yr-detail">' +
      '<div class="ts-row">' +
      '<div class="ts-box"><span class="ts-k">' + r.year + ' ' + TT('年率化回报（规模加权）') + '</span>' +
      '<b class="ts-v ' + sgn(r.wavg != null ? r.wavg : r.avg) + '">' + pctv(r.wavg != null ? r.wavg : r.avg) + '</b>' +
      '<span class="ts-s">' + (d == null ? TT('无上一年数据可比') :
        TT('较') + ' ' + p.year + ' ' + TT('年') + (d >= 0 ? TT('提升') : TT('回落')) + ' ' + Math.abs(d).toFixed(2) + ' ' + TT('个百分点')) + '</span></div>' +
      '<div class="ts-box"><span class="ts-k">' + r.year + ' ' + TT('中位数') + '</span>' +
      '<b class="ts-v ' + sgn(r.median) + '">' + pctv(r.median) + '</b>' +
      '<span class="ts-s">' + TT('一半基金高于此值') + '</span></div>' +
      '<div class="ts-box"><span class="ts-k">' + TT('当年正回报占比') + '</span>' +
      '<b class="ts-v">' + pc(r.up) + '%</b><span class="ts-s">' + num(r.up) + ' / ' + num(base) + '</span></div>' +
      '</div>' +
      '<div class="ts-bar">' +
      '<i class="tb-up" style="width:' + w(r.up) + '%"></i><i class="tb-down" style="width:' + w(r.down) + '%"></i></div>' +
      '<ul class="ts-list">' +
      '<li><i class="mk-dot up"></i>' + TT('上涨') + ' <b class="up">' + num(r.up) + '</b><span>（' + pc(r.up) + '%）</span></li>' +
      '<li><i class="mk-dot down"></i>' + TT('下跌') + ' <b class="down">' + num(r.down) + '</b><span>（' + pc(r.down) + '%）</span></li>' +
      '</ul>' +
      '<p class="ts-note">' + esc(r.year) + ' · ' + TT('参与统计') + ' ' + num(base) + ' ' + TT('条基金') + '</p>' +
      '</div>';
  }

  function renderYearPanel() {
    const host = $('#mkYearLine');
    if (!host || !lastM) return;
    host.innerHTML = yearPanel(lastM);
    host.querySelectorAll('.yr-tab').forEach((b) =>
      b.addEventListener('click', () => { yearSel = b.dataset.y; renderYearPanel(); }));
  }

  /* ---------------- 4. 风险级别图例（1–7 级） ---------------- */
  function renderRiskLegend(byRisk) {
    const ul = document.querySelector('#riskLegend .rl-list');
    if (!ul) return;
    const cnt = {};
    (byRisk || []).forEach((r) => { cnt[r.risk] = r.count; });
    let h = '';
    for (let lv = 1; lv <= 7; lv++) {
      const n = cnt[lv];
      h += '<li><i style="background:' + riskColor(lv) + '"></i>'
        + '<b>' + lv + '</b><span>' + TT(RISK_LABEL[lv - 1]) + '</span>'
        + '<em>' + (n == null ? '—' : n) + '</em></li>';
    }
    ul.innerHTML = h;
  }

  /* ---------------- 积金局最新月度公布（按月更新） ---------------- */

  /* ---------------- 积金局最新月度公布（按月更新） ----------------
   * 官方口径为「過去 12 個月」年率化净回报。左栏为回报横条（零线双向：正条向右、
   * 负条向左，避免负值只靠颜色区分）；右栏为资产占比环形图（顶层 6 类，DIS 含于
   * 混合资产内不重复计入）。数字全部照抄积金局新闻稿表格。 */
  function renderOfficial(mo) {
    const box = $('#mkOfficial');
    if (!box) return;
    if (!mo || !mo.rows || !mo.rows.length) {
      box.innerHTML = '<div class="chart-empty">' + TT('暂无官方月度数据') + '</div>';
      return;
    }
    const srcA = $('#moSrc');
    if (srcA) {
      srcA.href = mo.source || '#';
      srcA.textContent = TQ('数据截至 {d} · {p} 公布 ↗', { d: mo.asOf, p: mo.publishedAt });
    }

    // —— 左栏：回报横条（零线双向）——
    const vals = mo.rows.map((r) => r.m12).filter((v) => v != null);
    const mn = Math.min(0, Math.min.apply(null, vals));
    const mx = Math.max(0, Math.max.apply(null, vals));
    const span = (mx - mn) || 1;
    const zeroPct = ((0 - mn) / span) * 100;
    // 数值带符号格式化（正数加 +，与主数值风格一致；缺值显示 —）
    const sgnv = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + String(v));
    const list = '<div class="mo-list">' + mo.rows.map((r) => {
      const v = r.m12;
      const w = v == null ? 0 : (Math.abs(v) / span) * 100;
      const left = v >= 0 ? zeroPct : zeroPct - w;
      /* 2026-10-23（领导）：改回标准涨红跌绿，不再用自定义浅色 */
      const col = v >= 0 ? 'var(--up)' : 'var(--down)';
      /* 2026-10-31（用户要求）：悬浮精简——只保留类别内最高/最低 */
      const tip = typeLabel(r.name) + '：' +
        TQ('该类别内个别基金的最高回报为 {a}%、最低为回报为 {b}%', { a: sgnv(r.m12Hi), b: sgnv(r.m12Lo) });
      return '<div class="mo-row' + (r.sub ? ' sub' : '') + '" data-tip="' + esc(tip) + '">' +
        '<div class="mo-name">' + esc(typeLabel(r.name)) + '</div>' +
        '<div class="mo-track"><i class="mo-zero" style="left:' + zeroPct.toFixed(1) + '%"></i>' +
          '<i class="mo-bar" style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%;background:' + col + '"></i></div>' +
        '<div class="mo-val ' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%' +
          '</div>' +
        '</div>';
    }).join('') + '</div>';

    // —— 右栏：资产占比环形图（顶层 6 类；DIS 两项与「其他」为混合资产内细分，不重复计入）——
    const PIE_KEYS = ['equity', 'mixed', 'cons', 'guar', 'bond', 'mmf'];
    const PIE_COLORS = PALETTE;   // 与全站图表同色板（去掉此前的自定义配色）
    const pieItems = PIE_KEYS.map((k, i) => {
      const r = mo.rows.find((x) => x.key === k);
      return r ? { name: r.name, value: r.share, lt: r.shareLt, color: PIE_COLORS[i % PIE_COLORS.length] } : null;
    }).filter(Boolean);
    const pie = pieItems.length >= 2
      ? '<div class="mo-pietitle">' + TT('全市场资产占比') + '</div>' +
        pieSVG(pieItems, { inner: 0.6, size: 188, title: TT('全市场资产占比'), center: { top: TT('全市场'), bottom: TT('基金资产') } }) +
        legendHTML(pieItems, 100, (it) => (it.lt ? '<' : '') + Number(it.value).toFixed(1) + '%')
      : '';

    box.innerHTML = '<div class="mo-flex">' +
      '<div class="mo-left">' + list + '</div>' +
      (pie ? '<div class="mo-right">' + pie + '</div>' : '') +
      '</div>';
  }

  /* ---------------- 载入与渲染 ---------------- */
  function fetchMarket() {
    if (typeof window.fetchJSON === 'function') return window.fetchJSON('/api/market', 'market');
    return fetch('/api/market').then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
  }

  function load() {
    fetchMarket()
      .then(render)
      .catch((e) => {
        console.error('[home] market load failed:', e);
        $$('.mk-slot').forEach((el) => {
          el.innerHTML = '<div class="mk-empty">' + esc(e && e.message ? e.message : e) + '</div>';
        });
      });
  }

  function render(m) {
    lastM = m;
    // 显著显示数据更新时间：让客户一眼判断数据新旧（m.updatedAt 为本站同步时间）
    /* 2026-10-31：走势标题悬浮补数据截止日 */
    const yrTip = document.getElementById('yrTip');
    if (yrTip && m.dataAsOf) yrTip.dataset.tip = TQ('数据取自积金局「曆年回報」列，截止至 {d}', { d: m.dataAsOf });
    $$('.mk-asof').forEach((el) => {
      /* 2026-10-31（用户要求）：「数据更新时间」小字删除，仅保留积金局资料截至 */
      el.innerHTML = m.dataAsOf
        ? '<span class="upd-of">' + TQ('积金局资料截至 <b>{d}</b>', { d: m.dataAsOf }) + '</span>'
        : '';
    });

    /* 2026-10-22：KPI 的「近 1 年平均回报」改用自算净值口径（最新净值日），与温度计一致；
       积金局口径在温度计下方单列对照，避免同屏两个口径混用。 */
    const sf0 = (m.self && m.self.base) ? m.self : null;
    const kpi = [
      [TT('成分基金'), num(m.unitRows) + ' <small>' + TT('条') + '</small>', ''],
      [TT('受托人／发行人'), num(m.trusteeCount) + ' <small>' + TT('家') + '</small>', ''],
      [TT('市场总规模'), fmtSize(m.totalSize) + '<small>' + TT('港元') + '</small>', ''],
      sf0
        ? [TT('近 1 年平均回报'), pctv(sf0.wavg != null ? sf0.wavg : sf0.avg), '']
        : [TT('近 1 年平均回报'), pctv(m.avgAnn1), ''],
    ];
    /* 2026-10-31（用户要求）：KPI 卡不再带小字说明 */
    $('#mkKpi').innerHTML = kpi
      .map((k) => '<div class="mk-card"><div class="mk-k">' + k[0] + '</div>' +
        '<div class="mk-v">' + k[1] + '</div></div>')
      .join('');

    $('#mkThermo').innerHTML = thermometer(m);

    const types = m.byType || [];
    const typeItems = types.map((x, i) => ({ name: typeLabel(x.name), label: typeLabel(shortType(x.name)), value: x.count, color: PALETTE[i % PALETTE.length], size: x.size }));
    $('#mkTypeRing').innerHTML = pieSVG(typeItems, {
      inner: 0.62, size: 132, title: TT('基金种类分布'),
      center: { top: String(m.unitRows), bottom: TT('条基金') },
    }) + legendHTML(typeItems, m.unitRows, (it) => num(it.value) + ' ' + TT('条') + ' · ' + fmtSize(it.size));

    const trs = m.byTrustee || [];
    const top5 = trs.slice(0, 5).map((x, i) => ({ name: x.name, value: x.size, color: PALETTE_TR[i] }));
    const restSize = trs.slice(5).reduce((a, x) => a + (x.size || 0), 0);
    if (restSize > 0) top5.push({ name: TQ('其他 {n} 家受托人', { n: trs.length - 5 }), label: TQ('其他 {n} 家', { n: trs.length - 5 }), value: restSize, color: PALETTE_TR[5] });
    const trTotal = trs.reduce((a, x) => a + (x.size || 0), 0);
    $('#mkTrusteePie').innerHTML = pieSVG(top5, { inner: 0, size: 132, title: TT('受托人市场份额') })
      + legendHTML(top5, trTotal, (it) => fmtSize(it.value) + ' · ' + ((it.value / trTotal) * 100).toFixed(1) + '%');

    const risks = (m.byRisk || []).filter((x) => x.risk > 0);
    const naRisk = (m.byRisk || []).filter((x) => x.risk === 0);
    const rMax = Math.max.apply(null, risks.map((x) => x.count).concat([1]));
    $('#mkRisk').innerHTML = risks
      .map((x) => '<div class="col"><div class="cb"><i style="height:' + ((x.count / rMax) * 100).toFixed(1) +
        '%;background:' + riskColor(x.risk) + '"></i></div>' +
        '<span class="cv">' + x.count + '</span><span class="cx">' + x.risk + ' ' + TT('级') + '</span></div>')
      .join('');
    renderRiskLegend(m.byRisk);

    /* 2026-10-20：各类基金平均回报对比图表已下线，该位置改为「MPF 最新资讯」 */
    const barsBox = $('#mkTypeBars');
    if (barsBox) barsBox.innerHTML = groupedBars(types);
    renderYearPanel();

    // —— 积金局最新月度公布 ——
    renderOfficial(m.mpfaMonthly);

    const top1 = types[0];
    // 按基金数目计的类别第一（与按规模计可能不同，两句都写出来避免误读）
    const topCount = types.slice().sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    const dy = m.byYear && m.byYear.length ? m.byYear[m.byYear.length - 1] : null;

    renderTop('#mkTop1', m.topReturn, (x) => pctv(x.ann1), (x) => x.ann1);
    renderTop('#mkTop4', m.topReturn5, (x) => pctv(x.ann5), (x) => x.ann5);
    renderTop('#mkTop5', m.topCumLaunch, (x) => pctv(x.cumLaunch), (x) => x.cumLaunch);
    renderTop('#mkTop2', m.topSize, (x) => fmtSize(x.size), null);
    renderTop('#mkTop3', m.lowFee, (x) => num(x.fer, 2) + '%', null);
    renderTop('#mkTop6', m.lowRisk, (x) => (x.risk == null ? 'n.a.' : x.risk + ' ' + TT('级')), null);
    try { renderSelfTop(window.__MPF_FUNDS || (typeof DATA !== 'undefined' ? DATA.funds : null)); } catch (e) {}
  }


  /* 2026-10-19：前两张榜单改用「官网净值自算」口径（比积金局月报新 2–6 周） */
  let __selfDone = false;
  function renderSelfTop(funds) {
    if (__selfDone) return;
    __selfDone = true;
    /* 2026-10-20：改用轻量接口 /api/top（各取前 5），不再下载 508KB 全量基金表 */
    const get = (k) => fetch('/api/top?k=' + k + '&n=5')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => (j.items || []).map((x) => ({ ...x, sY1: x.y1, sY5a: x.y5a })))
      .catch(() => []);
    Promise.all([get('y1'), get('y5a')]).then(([t1, t5]) => {
      renderTop('#mkTop1', t1, (x) => pctv(x.sY1), (x) => x.sY1);
      renderTop('#mkTop4', t5, (x) => pctv(x.sY5a), (x) => x.sY5a);
    }).catch(() => {});
  }

  function renderTop(sel, list, fmt, colorVal) {
    const el = $(sel);
    if (!el) return;
    if (!list || !list.length) { el.innerHTML = '<li class="mk-empty">' + TT('暂无数据') + '</li>'; return; }
    el.innerHTML = list
      .map((x, i) => '<li>' +
        '<span class="r r' + (i < 3 ? i + 1 : '0') + '">' + (i + 1) + '</span>' +
        '<span class="n" title="' + esc(x.fund) + (x.scheme ? ' · ' + esc(x.scheme) : '') + '">' + esc(x.fund) + '</span>' +
        '<span class="v ' + (colorVal == null ? '' : (colorVal(x) >= 0 ? 'up' : 'down')) + '">' + fmt(x) + '</span>' +
        '</li>')
      .join('');
  }

  /* 2026-10-23（核验报告 #3）：首页支持 ?f=<id> 深链——直接转到资料库并打开该基金详情 */
  try {
    const m = /[?&]f=([0-9]+)/.exec(location.search);
    if (m) {
      location.replace('index.html?f=' + m[1] + '#db');
      return;
    }
  } catch (e) {}

  /* 语言切换后重绘（数据已在内存，无需重新请求） */
  document.addEventListener('mpf:lang', () => {
    if (!lastM) return;
    /* 让出主线程一帧再重绘 5 张 SVG 图表：文字先变、图表随后，点击手感不掉帧 */
    setTimeout(() => render(lastM), 16);
  });

  /* 页头状态行 + 「更新数据」按钮（与资料库/排名页一致的体验）：
     按钮 = 清缓存 + 重拉首页数据 + 刷新状态行，并给出明确反馈（不触发服务端抓取）。 */
  function initHeaderStatus() {
    if (typeof window.fetchHeaderStatus === 'function') window.fetchHeaderStatus();
    const btn = document.querySelector('.btn-refresh');
    if (btn && !btn.__bound) {
      btn.__bound = 1;
      btn.addEventListener('click', async () => {
        const rt = btn.querySelector('.rt');
        btn.classList.add('spin');
        if (rt) rt.textContent = TT('更新中…');
        try {
          cacheClear();
          load();
          if (typeof window.fetchHeaderStatus === 'function') await window.fetchHeaderStatus();
          mpfToast(TT('已刷新为最新数据'));
        } finally {
          btn.classList.remove('spin');
          if (rt) rt.textContent = TT('更新数据');
        }
      });
    }
  }
  /* ---------------- MPF 最新资讯（积金局新闻稿，标题直达官网） ---------------- */
  function loadNews() {
    const box = document.getElementById('newsList');
    if (!box) return;
    const fetcher = (typeof window.fetchJSON === 'function')
      ? window.fetchJSON('/api/news', 'news')
      : fetch('/api/news').then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
    fetcher.then((j) => {
      /* 2026-10-20：展示 15 条（原 10 条），配合字号放大填满右栏空白 */
      /* 2026-10-31（用户要求）：资讯保留 10 条，与右侧走势栏底端对齐 */
      const items = ((j && j.items) || []).slice(0, 10);
      if (!items.length) { box.innerHTML = '<li class="news-item news-empty">' + TT('暂无资讯') + '</li>'; return; }
      box.innerHTML = items.map((x) =>
        '<li class="news-item">' +
          '<span class="news-date">' + esc(x.date) + '</span>' +
          '<a class="news-title" href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' +
            esc(x.title) + '<i class="news-out">↗</i></a>' +
        '</li>').join('');
    }).catch(() => {
      box.innerHTML = '<li class="news-item news-empty">' + TT('资讯加载失败，可前往积金局官网查看') + '</li>';
    });
  }

  initHeaderStatus();

  load();
  loadNews();
})();

/* 2026-10-24（核验报告 v3 #8）：首页 5 处「451 条」不再依赖手写数字。
   基金总数以接口返回为准；等于 451 时什么都不做（零风险），一旦增减自动跟着改。 */
(function syncFundCount() {
  fetch('/api/status').then(function (r) { return r.json(); }).then(function (j) {
    var n = j && j.count;
    if (!n || n === 451) return;
    var s = String(n);
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      if (el.textContent && el.textContent.indexOf('451') >= 0) {
        el.textContent = el.textContent.replace(/451/g, s);
      }
    });
    var md = document.querySelector('meta[name="description"]');
    if (md && md.content.indexOf('451') >= 0) md.content = md.content.replace(/451/g, s);
  }).catch(function () {});
})();

/* ================= 市场行情栏（2026-10-31，用户要求） =================
   雅虎财经式：导航下方一行小卡（随页面滚动、不固定），展示
   MPF 市场指数（规模加权）+ 五大类规模加权指数 + 恒生指数。 */
(function () {
  /* 2026-10-31（用户要求）：市场/股/混/债 + 恒指 + 上证，全部可见；「基金」改「积金」 */
  var NAMES = {
    MPFAVG: '积金市场指数', MPF_STOCK: '股票积金', MPF_MIX: '混合积金',
    MPF_BOND: '债券积金', HSI: '恒生指数', SSE: '上证指数',
  };
  var ORDER = ['MPFAVG', 'MPF_STOCK', 'MPF_MIX', 'MPF_BOND', 'HSI', 'SSE'];

  function spark(series, up) {
    var w = 58, h = 24, n = series.length;   /* 2026-10-31 二版：收窄让名称完整显示 */
    if (n < 2) return '';
    var mn = Math.min.apply(null, series), mx = Math.max.apply(null, series);
    var rg = mx - mn || 1;
    var pts = series.map(function (v, i) {
      return (i / (n - 1) * w).toFixed(1) + ',' + (h - 3 - (v - mn) / rg * (h - 6)).toFixed(1);
    });
    var c = up ? '#d93025' : '#12996b';
    return '<svg class="tk-spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + c + '" stroke-width="1.6"/>' +
      '</svg>';
  }

  function fmt(v) {
    return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : (Math.round(v * 100) / 100).toFixed(2);
  }

  function render(j) {
    var box = document.getElementById('mktTicker');
    if (!box || !j || !j.items) return;
    var cards = '';
    ORDER.forEach(function (k) {
      var it = j.items[k];
      if (!it) return;
      var up = it.chg > 0, flat = !it.chg;
      var cls = flat ? 'flat' : (up ? 'up' : 'down');
      var pct = (up ? '+' : '') + it.chg.toFixed(2) + '%';
      cards += '<div class="tk-card" data-tip="' + esc(it.name + ' · 截至 ' + it.asOf) + '">' +
        '<span class="tk-name">' + TT(NAMES[k] || it.name) + '</span>' +
        '<span class="tk-nums"><b class="tk-last">' + fmt(it.last) + '</b>' +
        '<b class="tk-chg ' + cls + '">' + pct + '</b></span>' +
        spark(it.spark, up) +
        '</div>';
    });
    box.querySelector('.tk-track').innerHTML = cards;
  }

  function esc(s) {
    if (window.__t2sActive && window.t2s) s = window.t2s(s);
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function TT(s) { return (typeof window.t === 'function' && window.t(s, s)) || s; }

  fetch('/api/ticker').then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j) render(j); })
    .catch(function () {
      var box = document.getElementById('mktTicker');
      if (box) box.style.display = 'none';
    });
})();

/* ================= 积金表现指数（2026-10-31，用户要求；参考 GUM 版式、自有设计语言） =================
   四张卡=四大类规模加权自算指数的区间累计回报（点卡切换）；下方为该指数的面积走势图（基期=100）。 */
(function () {
  const KEYS = [['MPFAVG', '积金市场指数'], ['MPF_STOCK', '股票基金指数'], ['MPF_MIX', '混合资产基金指数'], ['MPF_BOND', '债券基金指数']];
  const RANGES = [['1y', '近 1 年'], ['3y', '近 3 年'], ['5y', '近 5 年'], ['all', '全部']];
  let DB = null, cur = 'MPFAVG', range = '3y';

  function esc2(s) {
    let o = String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (window.__t2sActive && window.t2s) o = window.t2s(o);
    return o;
  }
  function TT(s) { return (typeof window.t === 'function' && window.t(s, s)) || s; }

  function sliceSeries(rows, rg) {
    if (!rows || !rows.length) return [];
    if (rg === 'all') return rows;
    const days = rg === '1y' ? 365 : rg === '3y' ? 365 * 3 : 365 * 5;
    const last = new Date(rows[rows.length - 1][0]).getTime();
    const cutoff = last - days * 86400000;
    const out = rows.filter((r) => new Date(r[0]).getTime() >= cutoff);
    return out.length > 1 ? out : rows.slice(-2);
  }
  function cum(series) {
    if (!series || series.length < 2) return null;
    const a = series[0][1], b = series[series.length - 1][1];
    return a ? (b / a - 1) * 100 : null;
  }

  function renderRanges() {
    const box = document.getElementById('piRanges');
    if (!box) return;
    box.innerHTML = RANGES.map(([k, label]) =>
      '<button type="button" class="yr-tab' + (k === range ? ' on' : '') + '" data-pr="' + k + '">' + esc2(TT(label)) + '</button>').join('');
    box.querySelectorAll('.yr-tab').forEach((b) =>
      b.addEventListener('click', () => { range = b.dataset.pr; render(); }));
  }

  function renderCards() {
    const box = document.getElementById('piCards');
    if (!box || !DB) return;
    box.innerHTML = KEYS.map(([k, label]) => {
      const it = DB.items[k];
      if (!it) return '';
      const s = sliceSeries(it.series, range);
      const c = cum(s);
      const cls = c == null ? 'flat' : (c >= 0 ? 'up' : 'down');
      return '<button type="button" class="pi-card' + (k === cur ? ' on' : '') + '" data-pi="' + k + '">' +
        '<span class="pi-k">' + esc2(TT(label)) + '</span>' +
        '<b class="pi-v ' + cls + '">' + (c == null ? '—' : (c >= 0 ? '+' : '') + c.toFixed(2) + '%') + '</b>' +
        '<span class="pi-sub">' + (s.length ? esc2(s[0][0].slice(0, 7)) + ' = 100' : '') + '</span></button>';
    }).join('');
    box.querySelectorAll('.pi-card').forEach((b) =>
      b.addEventListener('click', () => { cur = b.dataset.pi; render(); }));
  }

  function renderChart() {
    const host = document.getElementById('piChart');
    if (!host || !DB) return;
    const it = DB.items[cur];
    if (!it || !it.series || it.series.length < 2) {
      host.innerHTML = '<div class="chart-empty">' + esc2(TT('暂无指数数据')) + '</div>';
      return;
    }
    const s = sliceSeries(it.series, range);
    const W = 1000, H = 300, padL = 46, padR = 16, padT = 16, padB = 30;
    const base = s[0][1] || 1;
    const pts = s.map((r) => [r[0], (r[1] / base) * 100]);
    let mn = Math.min.apply(null, pts.map((p) => p[1]));
    let mx = Math.max.apply(null, pts.map((p) => p[1]));
    const padv = (mx - mn) * 0.08 || 1; mn -= padv; mx += padv;
    const X = (i) => padL + (W - padL - padR) * (i / (pts.length - 1));
    const Y = (v) => padT + (H - padT - padB) * (1 - (v - mn) / (mx - mn));
    let grid = '', yl = '';
    for (let g = 0; g <= 4; g++) {
      const v = mn + (mx - mn) * g / 4;
      grid += '<line x1="' + padL + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + Y(v).toFixed(1) + '" stroke="#eef2f7" stroke-width="1"/>';
      yl += '<text x="' + (padL - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" class="pi-yk">' + v.toFixed(0) + '</text>';
    }
    const seen = {}; let xt = '';
    pts.forEach((p, i) => {
      const y = p[0].slice(0, 4);
      if (!seen[y]) { seen[y] = 1; xt += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="pi-yk">' + y + '</text>'; }
    });
    const lineD = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    const areaD = lineD + ' L' + X(pts.length - 1).toFixed(1) + ' ' + (H - padB) + ' L' + padL + ' ' + (H - padB) + ' Z';
    const last = pts[pts.length - 1];
    host.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="auto" role="img" aria-label="' + esc2(TT('积金表现指数')) + '">' +
      '<defs><linearGradient id="piGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0866bb" stop-opacity="0.26"/><stop offset="1" stop-color="#0866bb" stop-opacity="0.02"/></linearGradient></defs>' +
      grid + yl + xt +
      '<path d="' + areaD + '" fill="url(#piGrad)"/>' +
      '<path d="' + lineD + '" fill="none" stroke="#0866bb" stroke-width="2.2"/>' +
      '<circle cx="' + X(pts.length - 1).toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="3.5" fill="#0866bb"/>' +
      '<line id="piGuide" x1="0" y1="' + padT + '" x2="0" y2="' + (H - padB) + '" stroke="#9db8d4" stroke-dasharray="3 3" opacity="0"/>' +
      '<circle id="piDot" r="4" fill="#fff" stroke="#0866bb" stroke-width="2" opacity="0"/>' +
      '<rect id="piHit" x="' + padL + '" y="0" width="' + (W - padL - padR) + '" height="' + H + '" fill="transparent"/></svg>' +
      '<div class="pi-bubble" id="piBubble" hidden></div>';
    const svg = host.querySelector('svg'), hit = host.querySelector('#piHit'),
      guide = host.querySelector('#piGuide'), dot = host.querySelector('#piDot'), bub = host.querySelector('#piBubble');
    if (hit) {
      hit.addEventListener('mousemove', (e) => {
        const r = svg.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width * W;
        let i = Math.round((x - padL) / (W - padL - padR) * (pts.length - 1));
        i = Math.max(0, Math.min(pts.length - 1, i));
        const gx = X(i).toFixed(1), gy = Y(pts[i][1]).toFixed(1);
        guide.setAttribute('x1', gx); guide.setAttribute('x2', gx); guide.setAttribute('opacity', '1');
        dot.setAttribute('cx', gx); dot.setAttribute('cy', gy); dot.setAttribute('opacity', '1');
        const dpct = pts[i][1] - 100;
        bub.hidden = false;
        bub.textContent = pts[i][0] + ' · ' + pts[i][1].toFixed(1) + ' 点（' + (dpct >= 0 ? '+' : '') + dpct.toFixed(1) + '%）';
        bub.style.left = Math.min(Math.max(X(i) / W * 100, 14), 86) + '%';
        bub.style.top = (Y(pts[i][1]) / H * 100) + '%';
      });
      hit.addEventListener('mouseleave', () => {
        guide.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); bub.hidden = true;
      });
    }
  }

  function render() { renderRanges(); renderCards(); renderChart(); }

  fetch('/api/perf-idx').then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j || !j.items) return;
    DB = j;
    render();
  }).catch(() => {});
})();
