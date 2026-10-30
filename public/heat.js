/* 持仓涨跌热度条（2026-10-17）：来自 /api/holdings 的 544 条行情聚合 */
(function () {
  function cls(v) { return v > 0 ? 'hh-up' : (v < 0 ? 'hh-down' : 'hh-flat'); }
  function sign(v) { return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function catOf(t) {
    const c = t.code || '';
    const n = t.name || '';
    if (/bonds? |treasury|deposit|債券|债券|國庫|国库/i.test(n)) return '債券/存款';
    if (c.endsWith('.HK')) return '港股';
    if (/^[A-Z]{2,5}$/.test(c)) return '美股';
    if (t.unit === 'KRW' || t.unit === 'TWD') return '韓台股';
    return '其他';
  }
  function esc(s) {
    if (window.__t2sActive && window.t2s) s = window.t2s(s); return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function render(box, hld) {
    const rows = [];
    Object.values(hld.funds || {}).forEach((f) => (f.top10 || []).forEach((t) => {
      if (t.chg == null || !t.code) return;
      rows.push({ name: t.name, code: t.code, chg: t.chg, cat: catOf(t) });
    }));
    if (!rows.length) { box.innerHTML = '<div class="hh-empty">持仓行情尚未就绪</div>'; return; }
    const agg = {};
    rows.forEach((r) => {
      const a = (agg[r.cat] = agg[r.cat] || { n: 0, sum: 0, up: 0, dn: 0 });
      a.n++; a.sum += r.chg;
      if (r.chg > 0) a.up++;
      if (r.chg < 0) a.dn++;
    });
    const order = ['美股', '港股', '債券/存款', '其他', '韓台股'];
    const tiles = order.filter((k) => agg[k]).map((k) => {
      const a = agg[k];
      const avg = a.sum / a.n;
      return '<div class="hh-tile ' + cls(avg) + '"><div class="hh-k">' + esc(k) + ' · ' + a.n + ' 条</div>' +
        '<div class="hh-v">' + sign(avg) + '</div><div class="hh-s">涨 ' + a.up + ' · 跌 ' + a.dn + '</div></div>';
    }).join('');
    /* 领涨领跌（按出现次数加权：同名合并，先看涨跌幅） */
    const map = {};
    rows.forEach((r) => { if (!map[r.name]) map[r.name] = r; });
    const arr = Object.values(map);
    arr.sort((a, b) => b.chg - a.chg);
    const top = arr.slice(0, 3), bad = arr.slice(-3).reverse();
    const row = (r) => '<div class="hh-mr"><span class="hh-nm">' + esc(r.name.slice(0, 14)) +
      ' <i>' + esc(r.code) + '</i></span><b class="' + cls(r.chg) + '">' + sign(r.chg) + '</b></div>';
    const movers = '<div class="hh-col hh-upc"><div class="hh-cl">▲ 领涨</div>' + top.map(row).join('') + '</div>' +
      '<div class="hh-col hh-dnc"><div class="hh-cl">▼ 领跌</div>' + bad.map(row).join('') + '</div>';
    /* 持有最广 */
    const cnt = {};
    rows.forEach((r) => { cnt[r.name] = (cnt[r.name] || 0) + 1; });
    const wide = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([nm, c]) => {
      const chg = map[nm].chg;
      return '<span class="hh-chip">' + esc(nm.slice(0, 12)) + ' <b class="' + cls(chg) + '">' + sign(chg) + '</b> · ' + c + ' 只</span>';
    }).join('');
    box.innerHTML = '<div class="hh-tiles">' + tiles + '</div>' +
      '<div class="hh-movers">' + movers + '</div>' +
      '<div class="hh-wide"><div class="hh-wl">持有最广重仓</div><div class="hh-chips">' + wide + '</div></div>';
  }

  function init() {
    const box = document.getElementById('hhBox');
    if (!box) return;
    fetch('/api/holdings').then((r) => r.json()).then((hld) => render(box, hld)).catch(() => {
      box.innerHTML = '<div class="hh-empty">持仓行情加载失败</div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
