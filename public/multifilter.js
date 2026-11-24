/* 多选筛选下拉（2026-11-19，8.0）
   ------------------------------------------------------------------
   用户反馈：资料库表头的「受托人 / 种类 / 细类」一次只能选一个，且导出中心的筛选不联动。
   这里做一个共用的多选组件，外观沿用站内已有的 .mpfsel（按钮 + 浮层），
   第一项固定为「全部…」，点它清空；其余为复选项，可多选。
   用法：
     const mf = MPFMulti(hostEl, { allLabel: '全部受托人', onChange: (arr) => {} });
     mf.setOptions(['宏利', { v: 'HSBC', n: 77 }]);   // 字符串或 {v,label,n}
     mf.setSelected(['宏利']);
     mf.getSelected();
     mf.setAllLabel('全部受托人');                     // 语言切换时更新按钮文案
*/
(function () {
  if (window.MPFMulti) return;
  /* 2026-11-24（用户反馈：点开筛选时选项会闪一下繁体再变简体）：
     这里原来只做 HTML 转义，不跟全站繁→简口径，列表先用繁体原文绘制，
     等 common.js 的 t2s 观察器扫到才改。与 common.js 的 esc() 保持同一出口。 */
  const t2sText = (s) => {
    let out = String(s == null ? '' : s);
    if (window.__t2sActive && window.t2s) out = window.t2s(out);
    return out;
  };
  const esc = (s) => t2sText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* 2026-11-24（事故复盘）：选项的 value 是「身份值」，绝不能做繁转简——
     否则勾选后存进选中集合的是简体计划名，与数据里的繁体名永远匹配不上，直接筛出 0 条。
     与 common.js 的 escA 同一规则：只做 HTML 转义。 */
  const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lbl = (s) => (typeof TT === 'function' ? TT(s) : s);

  function create(host, opt) {
    if (typeof host === 'string') host = document.querySelector(host);
    if (!host) return null;
    if (host.__mf) return host.__mf;
    const o = Object.assign({ allLabel: '全部', onChange: () => {} }, opt || {});
    let options = [];            /* [{v,label,n}] */
    let sel = new Set();

    host.classList.add('mpfsel', 'mf');
    host.innerHTML = '<button type="button" class="mpfsel-btn" aria-haspopup="listbox" aria-expanded="false">' +
      '<span class="mpfsel-txt"></span>' +
      '<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="#0866bb" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button><div class="mpfsel-pop" role="listbox" hidden></div>';
    const btn = host.querySelector('.mpfsel-btn');
    const txt = host.querySelector('.mpfsel-txt');
    const pop = host.querySelector('.mpfsel-pop');

    const labelOf = (v) => {
      const it = options.find((x) => x.v === v);
      return t2sText(it ? it.label : v);
    };
    function syncText() {
      if (!sel.size) txt.textContent = o.allLabel;
      else if (sel.size === 1) txt.textContent = labelOf(Array.from(sel)[0]);
      else txt.textContent = (typeof TQ === 'function' ? TQ('已选 {n} 项', { n: sel.size }) : '已选 ' + sel.size + ' 项');
      btn.title = txt.textContent;
    }
    function renderPop() {
      pop.innerHTML = '<button type="button" class="mf-all' + (sel.size ? '' : ' on') + '" data-all="1">' + esc(o.allLabel) + '</button>' +
        options.map((it) =>
          '<label class="mf-opt' + (sel.has(it.v) ? ' on' : '') + '">' +
          '<input type="checkbox" value="' + escAttr(it.v) + '"' + (sel.has(it.v) ? ' checked' : '') + '>' +
          '<span>' + esc(it.label) + '</span>' +
          (it.n != null ? '<b>' + it.n + '</b>' : '') + '</label>').join('') ||
        '<div class="mf-empty">' + esc(lbl('暂无可选项')) + '</div>';
    }
    function close() { host.classList.remove('open'); pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function open() { host.classList.add('open'); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    function fire() {
      syncText(); renderPop();
      const arr = Array.from(sel);
      o.onChange(arr);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.mf.open, .mpfsel.open').forEach((h) => { if (h !== host && h.__mfClose) h.__mfClose(); });
      if (host.classList.contains('open')) close(); else { renderPop(); open(); }
    });
    host.__mfClose = close;

    const api = {
      setOptions(list, keep) {
        options = (list || []).map((x) => (typeof x === 'string' ? { v: x, label: x, n: null } : { v: x.v, label: x.label != null ? x.label : x.v, n: x.n == null ? null : x.n }));
        const valid = new Set(options.map((x) => x.v));
        if (!keep) sel = new Set(Array.from(sel).filter((v) => valid.has(v)));
        syncText(); renderPop();
      },
      setSelected(arr, silent) {
        sel = new Set((arr || []).map(String));
        syncText(); renderPop();
        if (!silent) o.onChange(Array.from(sel));
      },
      getSelected() { return Array.from(sel); },
      toggle(v) { if (sel.has(v)) sel.delete(v); else sel.add(v); fire(); },
      clear() { sel.clear(); fire(); },
      setAllLabel(t) { o.allLabel = t; syncText(); renderPop(); },
      close,
    };
    host.__mf = api;
    syncText();
    return api;
  }

  /* 点空白处关闭 + 选项点击（2026-11-19：改为文档级委托——
     组件实例的节点曾被页面重建替换，绑在节点上的监听会失效，表现为「怎么点都选不上」）。
     只绑一次，避免重复监听。 */
  if (!window.__mfDocBound) {
    window.__mfDocBound = 1;
    document.addEventListener('click', (e) => {
      const t = e.target;
      const opt = t && t.closest ? t.closest('.mf-opt') : null;
      if (opt) {
        const host = opt.closest('.mf');
        const cb = opt.querySelector('input[type=checkbox]');
        if (host && host.__mf && cb) {
          e.preventDefault(); e.stopPropagation();
          host.__mf.toggle(cb.value);
          return;
        }
      }
      const all = t && t.closest ? t.closest('.mf-all') : null;
      if (all) {
        const host = all.closest('.mf');
        if (host && host.__mf) { e.preventDefault(); e.stopPropagation(); host.__mf.clear(); return; }
      }
      document.querySelectorAll('.mf.open').forEach((h) => { if (h.__mfClose) h.__mfClose(); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('.mf.open').forEach((h) => { if (h.__mfClose) h.__mfClose(); });
    });
  }
  window.MPFMulti = create;
})();
