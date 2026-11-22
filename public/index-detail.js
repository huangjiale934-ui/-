/* 指数详情页（public/index-detail.js）—— 2026-11-22
 * ------------------------------------------------------------------
 * 用户要求：走势图里点「恒生指数」这类指数名称，应能像基金一样打开详情；
 * 版式完全参照基金详情页（fd-* 同一套样式），没有的项目就不显示。
 *
 * 数据：/api/indices（东方财富日线 + 自算 MPF 指数，每晚随 indexbuild/navperf 更新）
 * 说明：所有指标都是**在打开时用最新序列现算**的，因此每晚数据一更新，详情页自动跟着变，
 *       不需要额外维护一份静态文件。
 */
(function () {
  'use strict';

  /* 指数元信息：类别 / 编制说明 / 来源。新增指数没写在这里也能打开（走通用兜底）。 */
  var META = {
    HSI: { cat: '港股', desc: '香港恒生指数，反映香港股市整体表现，1969 年发布，基日 1964-07-31 = 100 点。', src: '东方财富日线', url: 'https://quote.eastmoney.com/gb/zsHSI.html' },
    HSCEI: { cat: '港股', desc: '恒生中国企业指数（国企指数），反映在港上市中国内地企业表现。', src: '东方财富日线', url: 'https://quote.eastmoney.com/gb/zsHSCEI.html' },
    HSTECH: { cat: '港股', desc: '恒生科技指数，覆盖香港上市的 30 家最大科技企业。2020-07-27 推出，基日 2014-12-31 = 3000 点。', src: '东方财富日线', url: 'https://quote.eastmoney.com/gb/zsHSTECH.html' },
    SPX: { cat: '美股', desc: '标准普尔 500 指数，覆盖美国 500 家大型上市公司，是全球最常用的美股基准。', src: '东方财富日线', url: 'https://quote.eastmoney.com/gb/zsSPX.html' },
    NDX: { cat: '美股', desc: '纳斯达克 100 指数，覆盖纳斯达克市值最大的 100 家非金融企业。', src: '东方财富日线', url: 'https://quote.eastmoney.com/gb/zsNDX.html' },
    DJIA: { cat: '美股', desc: '道琼斯工业平均指数，30 家美国大型蓝筹公司的价格加权平均。', src: '东方财富日线', url: 'https://quote.eastmoney.com/gb/zsDJIA.html' },
    N225: { cat: '日股', desc: '日经 225 指数，东京证券交易所 225 家代表性企业的价格加权指数。', src: '东方财富日线', url: 'https://quote.eastmoney.com/gb/zsN225.html' },
    CSI300: { cat: 'A 股', desc: '沪深 300 指数，沪深两市规模与流动性最好的 300 只股票，2005-04-08 发布，基日 2004-12-31 = 1000 点。', src: '东方财富日线', url: 'https://quote.eastmoney.com/zs000300.html' },
    SSE: { cat: 'A 股', desc: '上证综合指数，覆盖上海证券交易所全部上市股票。', src: '东方财富日线', url: 'https://quote.eastmoney.com/zs000001.html' },
    SZSE: { cat: 'A 股', desc: '深证成指，深交所 500 家代表性企业。', src: '东方财富日线', url: 'https://quote.eastmoney.com/zs399001.html' },
    CHINEXT: { cat: 'A 股', desc: '创业板指，深交所创业板 100 家代表性企业。', src: '东方财富日线', url: 'https://quote.eastmoney.com/zs399006.html' },
    CSI500: { cat: 'A 股', desc: '中证 500 指数，覆盖沪深两市中等市值 500 只股票。', src: '东方财富日线', url: 'https://quote.eastmoney.com/zs000905.html' },
    SSE50: { cat: 'A 股', desc: '上证 50 指数，沪市规模最大、流动性最好的 50 只股票。', src: '东方财富日线', url: 'https://quote.eastmoney.com/zs000016.html' },
    STAR50: { cat: 'A 股', desc: '科创 50 指数，科创板市值与流动性靠前的 50 只股票。', src: '东方财富日线', url: 'https://quote.eastmoney.com/zs000688.html' },
    MPFAVG: { cat: '自算 MPF 指数', desc: '本站自算：全部「已接入历史净值」的强积金成分基金，按每日等权平均涨跌幅链式累计，基期 = 1000，不含费用。反映全市场平均表现，非官方指数。', src: '本站自算（成分基金官方净值等权）', url: '#', self: true },
    MPF_STOCK: { cat: '自算 MPF 指数', desc: '本站自算：股票类强积金基金等权链式累计，基期 = 1000，不含费用。', src: '本站自算（股票类成分基金等权）', url: '#', self: true },
    MPF_MIX: { cat: '自算 MPF 指数', desc: '本站自算：混合资产类强积金基金等权链式累计，基期 = 1000，不含费用。', src: '本站自算（混合类成分基金等权）', url: '#', self: true },
    MPF_BOND: { cat: '自算 MPF 指数', desc: '本站自算：债券类强积金基金等权链式累计，基期 = 1000，不含费用。', src: '本站自算（债券类成分基金等权）', url: '#', self: true },
    MPF_MONEY: { cat: '自算 MPF 指数', desc: '本站自算：货币市场类强积金基金等权链式累计，基期 = 1000，不含费用。', src: '本站自算（货币类成分基金等权）', url: '#', self: true },
    MPF_GUAR: { cat: '自算 MPF 指数', desc: '本站自算：保证类强积金基金等权链式累计，基期 = 1000，不含费用。', src: '本站自算（保证类成分基金等权）', url: '#', self: true }
  };

  var CACHE = null;
  function load() {
    if (CACHE) return Promise.resolve(CACHE);
    return fetch('/api/indices', { cache: 'default' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { CACHE = j || { items: {} }; return CACHE; })
      .catch(function () { return { items: {} }; });
  }

  var DAY = 864e5;
  function pct(v) { if (v == null || !isFinite(v)) return '—'; return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; }
  function cls(v) { return v == null ? '' : (v > 0 ? 'up' : v < 0 ? 'down' : ''); }
  function nf(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function dnum(s) { return new Date(s + 'T00:00:00Z').getTime(); }

  /* 从序列里取「不晚于 target 的最后一个点」 */
  function atOrBefore(series, targetMs, lastIdx) {
    for (var i = lastIdx; i >= 0; i--) { if (dnum(series[i][0]) <= targetMs) return i; }
    return 0;
  }

  function stats(it) {
    var s = it.series || [];
    if (s.length < 2) return null;
    var n = s.length, last = s[n - 1];
    var lastMs = dnum(last[0]), lastV = Number(last[1]);
    function ret(days) {
      var i = atOrBefore(s, lastMs - days * DAY, n - 1);
      var v0 = Number(s[i][1]);
      return v0 ? lastV / v0 - 1 : null;
    }
    var yStart = new Date(new Date(lastMs).getUTCFullYear() - 1, 11, 31).getTime();
    var iy = atOrBefore(s, yStart, n - 1);
    var ytd = Number(s[iy][1]) ? lastV / Number(s[iy][1]) - 1 : null;

    /* 近 1 年：波动率（按平均间隔年化）、最大回撤、高低 */
    var i1 = atOrBefore(s, lastMs - 365 * DAY, n - 1);
    var seg = s.slice(i1);
    var hi = -Infinity, lo = Infinity, mdd = 0, peak = -Infinity, peakD = '', mddFrom = '', mddTo = '';
    var rets = [], spans = [];
    for (var k = 0; k < seg.length; k++) {
      var v = Number(seg[k][1]);
      if (v > hi) hi = v;
      if (v < lo) lo = v;
      if (v > peak) { peak = v; peakD = seg[k][0]; }
      if (peak > 0) { var dd = v / peak - 1; if (dd < mdd) { mdd = dd; mddFrom = peakD; mddTo = seg[k][0]; } }
      if (k > 0) {
        var pv = Number(seg[k - 1][1]);
        if (pv) rets.push(v / pv - 1);
        spans.push((dnum(seg[k][0]) - dnum(seg[k - 1][0])) / DAY);
      }
    }
    var mean = rets.length ? rets.reduce(function (a, b) { return a + b; }, 0) / rets.length : 0;
    var varr = rets.length > 1 ? rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (rets.length - 1) : 0;
    var span = spans.length ? spans.reduce(function (a, b) { return a + b; }, 0) / spans.length : 1;
    var vol = span > 0 ? Math.sqrt(varr) * Math.sqrt(365 / span) : null;

    return {
      mddFrom: mddFrom, mddTo: mddTo,
      sharpe: (vol && vol > 0.005) ? (lastV / Number(s[i1][1]) - 1) / vol : null,
      lastV: lastV, asOf: last[0], first: it.first || s[0][0], points: n,
      r1m: ret(30), r3m: ret(91), r6m: ret(182), r1y: ret(365), r3y: ret(1095), r5y: ret(1825), ytd: ytd,
      vol: vol, mdd: mdd, hi: hi, lo: lo, series: s
    };
  }

  function spark(series) {
    var s = series.slice(-260);
    if (s.length < 2) return '';
    var vs = s.map(function (p) { return Number(p[1]); });
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs), rng = (mx - mn) || 1;
    var W = 900, H = 220, pad = 8;
    var pts = s.map(function (p, i) {
      var x = pad + (i / (s.length - 1)) * (W - pad * 2);
      var y = pad + (1 - (Number(p[1]) - mn) / rng) * (H - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="idx-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--brand,#0866bb)" stroke-width="1.6"/></svg>' +
      '<div class="idx-spark-x"><span>' + s[0][0] + '</span><span>最高 ' + nf(mx) + ' · 最低 ' + nf(mn) + '</span><span>' + s[s.length - 1][0] + '</span></div>';
  }

  function row(label, val, klass) {
    return '<div class="idx-row"><span>' + label + '</span><b class="' + (klass || '') + '">' + val + '</b></div>';
  }


  function body(key, it) {
    var m = META[key] || { cat: '指数', desc: '该指数的编制说明暂未收录。', src: '' };
    var st = stats(it);
    var head = '', perf = '', base = '', risk = '';
    if (st) {
      head =
        '<div class="fd-head" id="fdHead">' +
          '<div class="fd-price"><div class="fd-k">最新点位</div>' +
            '<div class="fd-asof">截至 ' + st.asOf + '</div>' +
            '<div class="fd-v">' + nf(st.lastV) + '</div>' +
            '<div class="fd-range">52 周波幅 ' + nf(st.lo) + ' – ' + nf(st.hi) + '</div></div>' +
          '<div class="fd-cell"><div class="fd-k">近 1 年</div><div class="fd-v2 ' + cls(st.r1y) + '">' + pct(st.r1y) + '</div></div>' +
          '<div class="fd-cell"><div class="fd-k">年化波动率</div><div class="fd-v2">' + (st.vol == null ? '—' : (st.vol * 100).toFixed(1) + '%') + '</div></div>' +
          /* 2026-11-22（用户要求）：价格那一行不再写回撤区间，下面「风险指标」里已有 */
          '<div class="fd-cell"><div class="fd-k">最大回撤（1 年）</div><div class="fd-v2 down">' + pct(st.mdd) + '</div></div>' +
          '<div class="fd-cell"><div class="fd-k">夏普比率（1 年）</div><div class="fd-v2">' + (st.sharpe == null ? 'n.a.' : nf(st.sharpe, 2)) + '</div></div>' +
        '</div>';
      base = '<div class="idx-sec"><div class="idx-sec-h">基本信息</div><div class="idx-grid">' +
        row('指数类别', m.cat) + row('代码', it.code || key) + row('数据来源', m.src || '—') + row('更新频率', '每交易日') +
        row('数据起点', st.first) + row('数据点数', nf(st.points, 0)) + row('最新日期', st.asOf) + row('币种', '指数点位') +
        '</div></div>';
      perf = '<div class="idx-sec"><div class="idx-sec-h">区间表现</div><div class="idx-grid">' +
        row('近 1 月', pct(st.r1m), cls(st.r1m)) + row('近 3 月', pct(st.r3m), cls(st.r3m)) +
        row('近 6 月', pct(st.r6m), cls(st.r6m)) + row('年初至今', pct(st.ytd), cls(st.ytd)) +
        row('近 1 年', pct(st.r1y), cls(st.r1y)) + row('近 3 年', pct(st.r3y), cls(st.r3y)) +
        row('近 5 年', pct(st.r5y), cls(st.r5y)) + row('52 周最高 / 最低', nf(st.hi) + ' / ' + nf(st.lo)) +
        '</div></div>';
      risk = '<div class="idx-sec"><div class="idx-sec-h">风险指标</div><div class="idx-grid">' +
        row('年化波动率（1 年）', st.vol == null ? '—' : (st.vol * 100).toFixed(2) + '%') +
        row('最大回撤（1 年）', pct(st.mdd)) +
        row('回撤区间', st.mddFrom ? (st.mddFrom + ' → ' + st.mddTo) : '—') +
        row('夏普比率（1 年）', st.sharpe == null ? 'n.a.' : nf(st.sharpe, 2)) +
        '</div></div>';
    }
    return '<div class="fd">' + head +
      '<div class="an-trendwrap" id="idxTrend"></div>' +
      base + perf + risk +
      '<div class="idx-sec"><div class="idx-sec-h">指数说明</div><div class="idx-desc">' + m.desc + '</div></div>' +
      '</div>';
  }

  function html(key, it) {
    var m = META[key] || { cat: '指数', desc: '该指数的编制说明暂未收录。', src: '东方财富日线', url: '#' };
    var st = stats(it);
    var title = it.name || key;
    var head = '';
    var perf = '';
    if (st) {
      head =
        '<div class="fd-head" id="fdHead">' +
          '<div class="fd-price">' +
            '<div class="fd-k">最新点位</div>' +
            '<div class="fd-asof">截至 ' + st.asOf + '</div>' +
            '<div class="fd-v">' + nf(st.lastV) + '</div>' +
            '<div class="fd-range">52 周波幅 ' + nf(st.lo) + ' – ' + nf(st.hi) + '</div>' +
          '</div>' +
          '<div class="fd-cell"><div class="fd-k">近 1 年</div><div class="fd-v2 ' + cls(st.r1y) + '">' + pct(st.r1y) + '</div></div>' +
          '<div class="fd-cell"><div class="fd-k">年化波动率</div><div class="fd-v2">' + (st.vol == null ? '—' : (st.vol * 100).toFixed(1) + '%') + '</div></div>' +
          '<div class="fd-cell"><div class="fd-k">最大回撤（1 年）</div><div class="fd-v2 down">' + pct(st.mdd) + '</div></div>' +
          '<div class="fd-cell"><div class="fd-k">数据点</div><div class="fd-v2">' + nf(st.points, 0) + '</div><div class="fd-s">' + st.first + ' 起</div></div>' +
        '</div>';
      perf =
        '<div class="idx-sec"><div class="idx-sec-h">区间表现</div><div class="idx-grid">' +
          row('近 1 月', pct(st.r1m), cls(st.r1m)) +
          row('近 3 月', pct(st.r3m), cls(st.r3m)) +
          row('近 6 月', pct(st.r6m), cls(st.r6m)) +
          row('年初至今', pct(st.ytd), cls(st.ytd)) +
          row('近 1 年', pct(st.r1y), cls(st.r1y)) +
          row('近 3 年', pct(st.r3y), cls(st.r3y)) +
          row('近 5 年', pct(st.r5y), cls(st.r5y)) +
        '</div></div>';
    }
    return '<div class="an-dwrap">' +
      '<button type="button" class="an-back" onclick="window.idxBack()">' + (window.TT ? TT('← 返回对比') : '← 返回对比') + '</button>' +
      '<div class="fd">' +
        '<div class="fd-title">' + (it.name || key) + '<span class="tag unit">' + key + '</span></div>' +
        '<div class="fd-sub">' + m.cat + ' · ' + m.src + (it.code ? ' · ' + it.code : '') + '</div>' +
        head +
        '<div class="idx-sec"><div class="idx-sec-h">走势（近一年左右）</div>' + spark(st ? st.series : []) + '</div>' +
        perf +
        '<div class="idx-sec"><div class="idx-sec-h">指数说明</div><div class="idx-desc">' + m.desc + '</div></div>' +
      '</div></div>';
  }

  /* 供「数据导出中心」复用：指数清单与现算指标 */
  window.idxMetaOf = function (k) { return META[k] || null; };
  window.idxStatsOf = function (it) { return stats(it); };
  window.loadIndices = load;

  window.openIndexDetail = function (key) {
    /* 2026-11-22：改为在「详情弹窗」里打开（和基金详情同一个容器）。
       之前走 #anDetail 放大视图，在小窗/首页等场景没有该容器 → 用户点了一点反应都没有。 */
    load().then(function (j) {
      var it = (j.items || {})[key];
      if (!it) return;
      var m = document.querySelector('#modal');
      if (!m) return;
      var mh = m.querySelector('#mTitle'), ms = m.querySelector('#mSub'), mb = m.querySelector('#mBody');
      if (!mb) return;
      var meta = META[key] || { cat: '指数', src: '' };
      if (mh) mh.textContent = it.name || key;
      if (ms) ms.textContent = meta.cat + (it.code ? ' · ' + it.code : '') + ' · ' + (meta.src || '');
      mb.innerHTML = body(key, it);
      m.classList.add('show');
      /* 2026-11-22（用户反馈「恒生指数详情页导出出来是一只基金的表格」）：
         指数详情复用基金详情的弹窗，而 #mExport 上还挂着上一只基金的导出闭包。
         这里必须重新绑定成「导出该指数」，并清掉 dataset.fid，避免基金侧 stillOpen 误判。 */
      if (mh) mh.dataset.fid = '';
      var ex2 = m.querySelector('#mExport');
      if (ex2) ex2.onclick = function () {
        if (window.mpfIndexBook) {
          window.mpfIndexBook([key]).then(function (ok) {
            if (ok && window.mpfToast) window.mpfToast(TT('已导出该指数（数据说明 / 指数数据 / 逐日点位 / 净值走势图）'));
          });
        } else if (window.mpfToast) window.mpfToast(TT('导出组件未加载，请刷新页面'));
      };
      var sh2 = m.querySelector('#mShare');
      if (sh2) sh2.onclick = function () {
        var u = location.origin + location.pathname + '?idx=' + encodeURIComponent(key);
        var done = function () { if (window.mpfToast) window.mpfToast(TT('已复制该指数的链接')); };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, done);
          else { var ta = document.createElement('textarea'); ta.value = u; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
        } catch (e) { done(); }
      };
      /* 2026-11-22（用户要求）：走势图接主走势组件（十字线 + 悬停涨跌） */
      setTimeout(function () {
        var tb = document.querySelector('#idxTrend');
        if (tb && window.TREND) {
          try {
            /* 2026-11-22（用户要求）：与基金详情完全一致的工具条 ——
               添加指数 / 添加基金 / 清空 / 区间 / 导出 / 分享，一个都不能少 */
            var meta = {};
            ((typeof DATA !== 'undefined' && DATA && DATA.funds) || []).forEach(function (f) {
              meta[String(f.id)] = { trustee: f.trustee || '其他', type: f.type || '' };
            });
            window.TREND.mount(tb, [{ type: 'index', key: key }],
              { hideGoto: true, fundMeta: meta, title: (it.name || key) + ' 走势图' });
          } catch (e) {}
        }
      }, 30);
      document.body.classList.add('modal-open');
      try { history.replaceState(null, '', location.href); } catch (e) {}
    });
  };

  window.idxBack = function () {
    try {
      if (history.state && history.state.mpfView === 'index') { history.back(); return; }
      close();
    } catch (e) { close(); }
  };

  function close() {
    var d = document.querySelector('#anDetail');
    if (d) d.hidden = true;
    var c = document.querySelector('#anCompare');
    if (c) c.hidden = false;
    document.body.classList.remove('an-detail');
    try {
      var u = new URL(location.href);
      u.searchParams.delete('idx');
      history.replaceState(null, '', u);
    } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.addEventListener('popstate', function () {
    var k = '';
    try { k = new URLSearchParams(location.search).get('idx') || ''; } catch (e) {}
    if (k) window.openIndexDetail(k);
    else if (document.body.classList.contains('an-detail')) {
      var open = ''; try { open = new URLSearchParams(location.search).get('open') || ''; } catch (e) {}
      if (!open) close();
    }
  });

  /* 空闲时预取指数数据：用户点名称时基本已在内存里 */
  setTimeout(function () { load(); }, 2500);

  /* 直接带 ?idx=HSI 打开（分享链接） */
  document.addEventListener('DOMContentLoaded', function () {
    var k = '';
    try { k = new URLSearchParams(location.search).get('idx') || ''; } catch (e) {}
    if (!k) return;
    var tries = 0;
    (function wait() {
      tries += 1;
      /* DATA 是 bundle 内的模块级变量（不是 window.DATA） */
      if (typeof DATA !== 'undefined' && DATA && DATA.count) { window.openIndexDetail(k); return; }
      if (tries < 40) setTimeout(wait, 300);
    })();
  });
})();
