/* 公共数据层与工具函数 —— 广州精研数据有限公司 */

const API = '/api/funds';
const REFRESH_API = '/api/refresh?force=1';

let DATA = { funds: [], years: [], updatedAt: 0, source: '', count: 0 };

/* ======================= 多语言助手（i18n.js 先于本文件加载） =======================
 * key 为简体原文；缺 key 自动回退原文，绝不空白。
 * 含 {x} 占位符的长句用 TQ()，避免把一句话拆成十几个碎片键。
 */
const TT = (k, f) => (typeof window.t === 'function' ? window.t(k, f) : (f != null ? f : k));
const TQ = (k, map) => {
  let out = TT(k);
  Object.keys(map || {}).forEach((x) => { out = out.split('{' + x + '}').join(String(map[x])); });
  return out;
};

/* ======================= 风险级别配色（全站统一） =======================
 * 1 级（最低风险）→ 7 级（最高风险），7 个色相区分明显的固定色，
 * 不再用相邻级别过于接近的渐变，确保小屏与色弱用户也能分辨。
 * 仅为风险示意，与涨跌红绿无关。
 */
const MPF_RISK = {
  labels: ['低风险', '低至中风险', '中低风险', '中风险', '中高风险', '高风险', '最高风险'],
  /* 2026-10-22（领导定）：7 级风险改用「蓝色由浅至深」，不再用绿→黄色相；
     风险不是涨跌，避免与「涨红跌绿」混淆，也让全站少两种颜色。 */
  /* 2026-10-22（领导）：整体再调浅一档，1 级最浅、7 级最深 */
  colors: ['#edf7ff', '#d7e9fa', '#c0dcf5', '#a5cbee', '#88b8e6', '#6ba4dc', '#4f90d2'],
  color(lv) {
    const i = Math.max(1, Math.min(7, Math.round(lv || 0)));
    return this.colors[i - 1];
  },
  label(lv) { return TT(this.labels[Math.max(1, Math.min(7, Math.round(lv || 0))) - 1]); },
  /** 风险级别来源提示（表格徽标 / 冠军卡统一使用）：明确由积金局评定，避免被误认为本平台判定 */
  tip(lv) { return TQ('由积金局评定：风险级别 {n} 级（1 级最低、7 级最高）', { n: lv }); },
  /** 7 级风险说明小图例（口径说明区用） */
  legendHTML() {
    let h = '<div class="risk-mini"><b>' + TT('风险级别说明（1–7 级）：') + '</b><ul class="rlm-list">';
    for (let lv = 1; lv <= 7; lv++) {
      h += '<li><i style="background:' + this.color(lv) + '"></i>' + lv + ' ' + this.label(lv) + '</li>';
    }
    h += '</ul><p class="rlm-note">' + TT('风险级别由积金局按基金过往波幅评定，1 级最低、7 级最高；色块由浅至深仅表示级别高低，与涨跌无关。') + '</p></div>';
    return h;
  },
};
window.MPF_RISK = MPF_RISK;

/* ======================= 数据缓存层（提升回访与页面切换速度） =======================
 * 策略：stale-while-revalidate
 *   - 命中缓存（10 分钟内）→ 直接返回，零网络等待
 *   - 缓存已过期 → 先立即返回旧数据让页面马上可交互，同时后台静默刷新
 *   - 无缓存 → 正常请求
 * 缓存放在 sessionStorage（关闭标签页即清），不写入用户设备长期存储。
 */
const CACHE_TTL = 10 * 60 * 1000;

/* 数据缓存（2026-10-11 升级）：由 sessionStorage（仅当前标签页有效，新开标签=全量重下）
 * 改为 localStorage（跨标签 / 跨会话）。过期数据仍然「先上屏、后台静默刷新」（见 fetchJSON），
 * 因此回访与新开标签都能秒开，同时数据保持最新。 */
function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem('mpf-cache:' + key) || 'null'); } catch (e) { return null; }
}
function cacheSet(key, data) {
  try {
    localStorage.setItem('mpf-cache:' + key, JSON.stringify({ at: Date.now(), data: data }));
    // 清理陈旧缓存（只保留当前两类 key，避免 localStorage 膨胀）
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('mpf-cache:') === 0 && k !== 'mpf-cache:' + key && k.indexOf('mpf-cache:updated:') !== 0) {
        const v = JSON.parse(localStorage.getItem(k) || 'null');
        if (v && v.at && Date.now() - v.at > 30 * 86400000) localStorage.removeItem(k);
      }
    });
  } catch (e) {}
}
function cacheClear() {
  try {
    Object.keys(localStorage).forEach((k) => { if (k.indexOf('mpf-cache:') === 0) localStorage.removeItem(k); });
  } catch (e) {}
}

function fetchJSON(url, key, force) {
  const hit = cacheGet(key);
  if (hit && !force && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data);
  /* 2026-10-20：force 刷新时给 URL 加时间戳，绕开 ETag 304（否则「更新数据」仍拿到旧响应体） */
  const reqUrl = force ? url + (url.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now() : url;
  const req = fetch(reqUrl, { cache: 'default' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((j) => { cacheSet(key, j); return j; });
  if (hit && !force) { req.catch(() => {}); return Promise.resolve(hit.data); } // 旧数据先上屏，后台更新
  return req;
}
window.fetchJSON = fetchJSON;

function setLoadMsg(html) {
  document.querySelectorAll('.loading').forEach((el) => {
    el.style.display = 'block';
    el.innerHTML = '<div class="spinner"></div>' + html;
  });
}

async function loadData(onDone, attempt, force) {
  attempt = attempt || 0;
  try {
    const j = await fetchJSON(API, 'funds', force);
    if (!j.funds || !j.funds.length) throw new Error(TT('空数据'));
    DATA = j;
    renderUpdateTime();
    renderFriends();
    renderNavDistCard();
    if (onDone) onDone(DATA);
  } catch (e) {
    // 部署切换 / 冷启动时接口可能短暂 404 / 503，自动重试
    if (attempt < 6) {
      setLoadMsg(TQ('正在连接数据服务{a}（自动重试 {n}/6）', { a: '.'.repeat(attempt + 1), n: attempt + 1 }));
      setTimeout(() => loadData(onDone, attempt + 1, force), 2000 * (attempt + 1));
    } else {
      document.querySelectorAll('.loading').forEach((el) => {
        el.innerHTML =
          '<div style="color:#a8432a">' + TQ('数据服务暂时无法连接：{m}', { m: e.message }) + '</div>' +
          '<div style="margin-top:8px">' + TT('请点击右上角「更新数据」重试，或稍后刷新页面') + '</div>';
      });
    }
  }
}

/** 「更新数据」按钮：清前端缓存 + 强制重拉「最新已发布数据」，并给出明确反馈。
 *  说明：不再触发服务端抓取——线上服务器无法稳定直连积金局官网，数据更新由本机
 *  同步任务（每晚自动 / 手动「同步数据」）负责推送；此按钮保证每次点击都有反馈。 */
async function refreshData(cb) {
  const btn = document.querySelector('.btn-refresh');
  const rt = btn ? btn.querySelector('.rt') : null;
  if (btn) {
    btn.classList.add('spin');
    if (rt) rt.textContent = TT('更新中…');
  }
  try {
    cacheClear();
    await loadData(cb, 0, true);
    mpfToast(TQ('已刷新为最新数据（数据版本 {t}）', { t: fmtDT(DATA.updatedAt || Date.now()) }));
  } catch (e) {
    mpfToast(TT('刷新失败，请稍后重试'));
  } finally {
    if (btn) {
      btn.classList.remove('spin');
      if (rt) rt.textContent = TT('更新数据');
    }
  }
}

/** 时间戳 →「YYYY-MM-DD HH:mm」 */
function fmtDT(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function renderUpdateTime() {
  const el = document.querySelector('.upd .t');
  if (!el || !DATA.updatedAt) return;
  /* 2026-10-14：页头只显示本站更新时间 */
  el.textContent = TQ('数据更新 {t}', { t: fmtDT(DATA.updatedAt) });
  const dot = document.querySelector('.upd .dot');
  if (dot) {
    dot.classList.toggle('warn', DATA.stale);
    if (DATA.stale) dot.setAttribute('title', TT('数据同步可能存在延迟，稍后将自动重试'));
    else dot.removeAttribute('title');
  }
  const cnt = document.querySelector('.upd .cnt');
  if (cnt) cnt.textContent = TQ('{n} 条基金', { n: DATA.count });
  fillVerChip({ updatedAt: DATA.updatedAt, dataAsOf: DATA.dataAsOf });
  renderSrcNote();
}

/* ---------- 「数据版本」徽标（页头）：来源与日期一眼可查 ----------
 * 徽标本身体积小：显示数据同步日期；悬浮（移动端点击）按行展开各来源与最新日期，
 * 回应「数据来源与日期要充分说明」。/api/status 到货后补上指数行情与回填进度。 */
function fillVerChip(st) {
  const chip = document.getElementById('verChip');
  if (!chip || !st) return;
  const val = chip.querySelector('b');
  const dateStr = st.updatedAt ? fmtDT(st.updatedAt).slice(0, 10) : '';
  if (val && dateStr) val.textContent = dateStr;
  let navLatest = st.navLatest || '';
  const funds = (DATA && DATA.funds) || [];
  funds.forEach((f) => { if (f.navAsOf && f.navAsOf > navLatest) navLatest = f.navAsOf; });
  const lines = [
    TQ('官方资料（积金局）：{d}', { d: st.dataAsOf || '—' }),
    TQ('单位净值（发行人官网）：最新 {d}', { d: navLatest || '—' }),
  ];
  if (st.indexAsOf) lines.push(TQ('指数行情（东方财富）：最新 {d}', { d: st.indexAsOf }));
  if (st.histBackfilled) lines.push(TQ('已回填历史净值：{n} 只基金', { n: st.histBackfilled }));
  lines.push(TT('自算指标（日涨跌 / 年初至今 / 区间涨幅 / 回撤）基于官网净值序列，未含分红再投资与费用调整。'));
  const tip = lines.join('\n');
  chip.setAttribute('data-tip', tip);
  chip.setAttribute('aria-label', tip);
}

/** 页头状态行：独立拉取并填充（供不走 loadData 的首页使用；其他页仍由 loadData 驱动） */
window.fetchHeaderStatus = function () {
  return fetch('/api/status', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((st) => {
      if (!st) return;
      const el = document.querySelector('.upd .t');
      if (el) {
        /* 2026-10-14：页头只显示本站更新时间（积金局资料日期在页脚口径说明中） */
        el.textContent = TQ('数据更新 {t}', { t: fmtDT(st.updatedAt) });
      }
      const dot = document.querySelector('.upd .dot');
      if (dot) {
        const bad = st.syncStatus === 'degraded' || !!st.error;
        dot.classList.toggle('warn', bad);
        if (bad) dot.setAttribute('title', TT('数据同步可能存在延迟，稍后将自动重试'));
        else dot.removeAttribute('title');
      }
      const cnt = document.querySelector('.upd .cnt');
      if (cnt) cnt.textContent = TQ('{n} 条基金', { n: st.count });
      fillVerChip(st);
    })
    .catch(() => {});
};

/* 2026-10-22 修：页头状态行（数据更新 / N 条基金 / 数据版本徽标）是异步填的，
   切语言后不随 data-i18n 重译 → 英文界面残留中文。此处独立监听（首页不调用 mountHeader，
   放在那里不会生效），切语言后重拉一次状态（2KB）。 */
if (!window.__statusLangBound) {
  window.__statusLangBound = 1;
  document.addEventListener('mpf:lang', () => {
    if (typeof window.fetchHeaderStatus === 'function') window.fetchHeaderStatus();
    if (typeof DATA !== 'undefined' && DATA && DATA.updatedAt) renderUpdateTime();
  });
}

/* ===================== 匿名访问统计（不记录任何个人信息） =====================
 * 页面浏览（PV/UV）与「导出 / 分享」事件计数；仅一个随机访客 ID，无 IP、无个人信息。 */
(function analyticsInit() {
  try {
    let vid = null;
    try { vid = localStorage.getItem('mpf-vid'); } catch (e) {}
    if (!vid) {
      vid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem('mpf-vid', vid); } catch (e) {}
    }
    window.__mpfVid = vid;
    const page = location.pathname.indexOf('index') >= 0 ? 'idx'
      : (location.pathname.indexOf('ranking') >= 0 ? 'rank'
        : (location.pathname.indexOf('analysis') >= 0 ? 'analysis' : 'home'));
    fetch('/api/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: vid, p: page }),
    }).catch(() => {});
  } catch (e) {}
})();

/** 匿名事件上报（导出 / 分享计数用；失败静默，不影响任何功能） */
function trackEvent(e) {
  try {
    if (!window.__mpfVid) return;
    fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: window.__mpfVid, e: e }),
    }).catch(() => {});
  } catch (e2) {}
}

function renderSrcNote() {
  /* 2026-10-14：净值估值日分布 + 风险级别说明移至「数据来源」页脚之前（顶部图例位），
     其余口径说明文字保留在页脚卡片内。
     2026-10-14 深夜：页脚改为折叠式——核对时间进 summary（#navCheckAt），口径说明折叠展开。 */
  const elTop = document.querySelector('#srcNoteTop');
  if (elTop && DATA.count) elTop.innerHTML = navDateDistHTML() + MPF_RISK.legendHTML();
  const nc = document.querySelector('#navCheckAt');
  if (nc && DATA.navStat && DATA.navStat.navUpdatedAt) {
    const locale = (typeof window.getLang === 'function' && window.getLang() === 'en') ? 'en-GB' : 'zh-CN';
    nc.textContent = new Date(DATA.navStat.navUpdatedAt).toLocaleString(locale, { hour12: false });
  }
  const el = document.querySelector('#srcNote');
  if (!el || !DATA.count) return;
  const declared = DATA.declaredTotal || 382;
  el.innerHTML =
    TQ('本页收录 <b>{c}</b> 条成分基金 · {u} 家受托人 · {s} 个强积金计划，积金局资料截至 <b>{d}</b>。',
      { c: DATA.count, u: DATA.trusteeCount || '—', s: DATA.schemeCount || '—', d: DATA.dataAsOf || '—' }) +
    '<div class="note-diff">' +
    TQ('关于「{c} 条」与官网「{d} 只」的口径差异：积金局基金资讯表<b>每一行对应一个「单位类别」</b>（同一只成分基金可同时设有 A 类、B 类、D 类等单位，收费与净值各自不同），本站逐行完整收录，故为 {c} 条；官网页面顶部标注的「已選擇的成分基金總數: {d}」是把同一只基金的各个单位类别<b>合并成一只基金</b>后的计数。两者并无矛盾，本站提供「详情」可查看该基金各个单位类别的分别数据。',
      { c: DATA.count, d: declared }) +
    '</div>' +
    navStatNote();
}

/** 净值核对情况说明（含「两套数据源日期不同」的口径交代） */
function navStatNote() {
  const n = DATA.navStat;
  if (!n) return '';
  const na = n.na || 0;
  const pct1 = ((n.verified / (n.total || 1)) * 100).toFixed(1);
  const src = n.sources || [];
  const dates = src.map((s) => s.asOf).filter(Boolean).sort();
  const span = dates.length ? (dates[0] === dates[dates.length - 1]
    ? dates[0]
    : dates[0] + ' ~ ' + dates[dates.length - 1]) : '';
  const noDate = src.filter((s) => !s.asOf);
  const locale = (typeof window.getLang === 'function' && window.getLang() === 'en') ? 'en-GB' : 'zh-CN';  /* 英文模式用英式 24 小时格式 */
  return '<div class="note-nav">' +
    '<b>' + TT('单位资产净值（NAV）的数据来源与日期：') + '</b>' +
    TQ('积金局「強積金基金平台」的基金资讯表<b>本身不提供单位资产净值</b>，因此净值一律逐一取自各计划<b>受托人／保荐人官网</b>每日公布的官方数值，本次已完成核实 <b>{v}</b> / {t} 条（{p}%）',
      { v: n.verified, t: n.total, p: pct1 }) +
    (na ? TQ('，另有 <b>{n}</b> 条为官方注明不提供单位价格的保证基金／非单位化基金，显示「{x}」',
      { n: na, x: '<span class="nav-na">' + TT('不适用') + '</span>' }) : '') +
    (n.unmatched ? TQ('，其余 <b>{n}</b> 条暂未能从其官网公开页面取得，一律显示「{x}」，不以任何推测数值代替',
      { n: n.unmatched, x: '<span class="nav-pending">' + TT('待核实') + '</span>' }) : '') +
    '。' +
    (span ? '<br>' + TQ('<b>请注意两套数据的日期口径不同：</b>本表的<b>基金规模、风险级别、各项回报、基金开支比率、管理费</b>等指标取自积金局基金资讯表，其资料截至日为 <b>{d}</b>（由积金局统一更新，通常滞后若干周）；而<b>单位资产净值</b>由各受托人在官网逐日公布，本次取到的估值日集中在 <b>{span}</b>，每一行净值右下方均标注了该基金自己的估值日。两者更新频率不同属正常现象，本站不因日期差异而对任何数值做推算或对齐。',
      { d: esc(DATA.dataAsOf || TT('官网最新公布日')), span: span }) : '') +
    (noDate.length
      ? '<br><span class="muted">' + TQ('其中 {list} 的官网把估值日放在异步脚本中生成，静态页面读不到日期，故这几只只显示净值、不显示估值日（净值本身仍取自其官网）。',
        { list: noDate.map((s) => esc(String(s.label).replace(/（.*$/, ''))).join('、') }) + '</span>'
      : '') +
    ((n.alerts && n.alerts.length)
      ? '<br><span class="nav-alert"><b>' + TT('⚠ 来源告警（自动检测）：') + '</b>' +
        n.alerts.map((a) => esc(a.label) + '：' + esc(a.msg || '') +
          TQ('（上次 {a} 条 → 本次 {b} 条）', { a: a.prev || 0, b: a.now || 0 })).join('；') +
        '。' + (n.unmatched > 0
          ? TQ('受影响的基金本次已暂时显示「{x}」，本站绝不以推测值代替。', { x: '<span class="nav-pending">' + TT('待核实') + '</span>' })
          : TT('相关净值已自动沿用上一次核对结果，数值本身不受影响。')) +
        TT('每日同步任务会重新尝试该来源，恢复正常后告警自动解除。') + '</span>'
      : '') +
    '</div>';
}

/** 净值估值日分布（口径说明内）：分类与数量实时计算；
    资料库页（有筛选栏）的标签可点击筛选，其余页面仅展示。 */
function navDateDistHTML() {
  const funds = (DATA.funds || []).filter((x) => x.navStatus === 'verified' && x.nav != null);
  if (!funds.length) return '';
  const map = {};
  funds.forEach((x) => { const k = x.navAsOf || 'none'; map[k] = (map[k] || 0) + 1; });
  const keys = Object.keys(map).filter((k) => k !== 'none').sort().reverse();
  if (map.none) keys.push('none');
  /* 资料库（#fType）= 筛选表格；可视化对比页（#anTbody2）= 筛选下方基金列表 —— 均可点击 */
  const clickable = !!document.querySelector('#fType') || !!document.querySelector('#anTbody2');
  return '<div class="navdist">' + TT('净值估值日分布：') +
    keys.map((k) => '<b' + (clickable ? ' class="ndk" data-navdate="' + k + '"' : '') + '>' +
      (k === 'none' ? TT('无估值日') : k.slice(5).replace('-', '/')) + ' ×' + map[k] + '</b>').join('') +
    (clickable ? '<i class="ndhint">' + TT('（点击任一标签只看对应条目）') + '</i>' : '') +
    '</div>';
}

/** 2026-10-24（领导）：把「净值估值日分布」从折叠区提到列表下方，做成可点击的卡片。
    数据就绪（loadData）后渲染；点某日期只看该日估值的基金，再点取消。 */
function renderNavDistCard() {
  const el = document.getElementById('navDistCard');
  if (!el) return;
  const funds = (DATA.funds || []).filter((x) => x.navStatus === 'verified' && x.nav != null);
  if (!funds.length) { el.hidden = true; el.innerHTML = ''; return; }
  const map = {};
  funds.forEach((x) => { const k = x.navAsOf || 'none'; map[k] = (map[k] || 0) + 1; });
  const keys = Object.keys(map).filter((k) => k !== 'none').sort().reverse();
  if (map.none) keys.push('none');
  let max = 0;
  keys.forEach((k) => { if (map[k] > max) max = map[k]; });
  const cur = window.__MPF_NAVDATE || '';
  el.hidden = false;
  el.innerHTML =
    '<div class="ndc-head"><b>' + TT('净值估值日分布') + '</b>' +
    '<span>' + TQ('共 {n} 只已核对官方净值；点日期只看该日，再点取消', { n: funds.length }) + '</span></div>' +
    '<div class="ndc-list">' +
    keys.map((k) => '<button type="button" class="ndc' + (cur === k ? ' on' : '') + (map[k] === max ? ' peak' : '') +
      '" data-navdate="' + k + '"><b>' + (k === 'none' ? TT('无估值日') : k) + '</b>' +
      '<span>' + TQ('{n} 只', { n: map[k] }) + '</span></button>').join('') +
    '</div>';
  Array.prototype.forEach.call(el.querySelectorAll('.ndc'), (btn) => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-navdate');
      const next = (window.__MPF_NAVDATE === v) ? '' : v;
      window.__MPF_NAVDATE = next;
      if (window.mpfSetNavDate) window.mpfSetNavDate(next);
      else if (window.anSetNavDate) window.anSetNavDate(next);
      renderNavDistCard();
    });
  });
}
window.renderNavDistCard = renderNavDistCard;

/**
 * 历年回报走势图（柱状）
 * 数据全部来自积金局「曆年回報」官方字段，不做任何插值或补全：
 * 缺哪一年就不画哪一根，不会为了使曲线好看而伪造数据。
 */
function calChart(x) {
  const cal = x.cal || {};
  const yrs = Object.keys(cal).filter((y) => cal[y] != null).sort();
  if (yrs.length < 2) {
    return '<div class="chart-box"><div class="chart-empty">' + TT('该基金官网尚未公布足够的历年回报数据，无法绘制走势图') + '</div></div>';
  }
  const UP = '#c0392b';    // 涨（中国市场习惯用红色）
  const DOWN = '#1a7a55';  // 跌（绿色）
  const W = 620, H = 200, PL = 8, PR = 8, PT = 16, PB = 22;
  const vals = yrs.map((y) => cal[y]);
  let max = Math.max.apply(null, vals);
  let min = Math.min.apply(null, vals);
  if (min > 0) min = 0;               // 始终包含 0 基准线
  const pad = (max - min) * 0.18 || 1;
  max += pad; if (min < 0) min -= pad;
  const iw = W - PL - PR, ih = H - PT - PB;
  const bw = iw / yrs.length;
  const barW = Math.min(48, bw * 0.56);
  const y0 = PT + ih * (max / (max - min));   // 0 值对应的 y
  const yOf = (v) => PT + ih * ((max - v) / (max - min));

  let g = '';
  // 横向网格 + 刻度
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = max - ((max - min) * i) / ticks;
    const yy = yOf(v);
    g += '<line class="chart-grid" x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) +
      '" y2="' + yy.toFixed(1) + '"/>' +
      '<text class="chart-axis" x="' + (PL + 2) + '" y="' + (yy - 3).toFixed(1) + '">' + v.toFixed(0) + '%</text>';
  }
  // 0 基准线
  if (min < 0 && max > 0) g += '<line class="chart-zero" x1="' + PL + '" y1="' + y0.toFixed(1) +
    '" x2="' + (W - PR) + '" y2="' + y0.toFixed(1) + '"/>';

  yrs.forEach((y, i) => {
    const v = cal[y];
    const cx = PL + bw * (i + 0.5);
    const yv = yOf(v);
    const top = v >= 0 ? yv : y0;
    const h = Math.max(2, Math.abs(y0 - yv));
    g += '<rect class="chart-bar" x="' + (cx - barW / 2).toFixed(1) + '" y="' + top.toFixed(1) +
      '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + (v >= 0 ? UP : DOWN) + '">' +
      '<title>' + TQ('{y} 年　{v}%', { y: esc(y), v: (v >= 0 ? '+' : '') + v.toFixed(2) }) + '</title></rect>';
    g += '<text class="chart-val" x="' + cx.toFixed(1) + '" y="' + (v >= 0 ? (top - 4) : (top + h + 11)).toFixed(1) +
      '" text-anchor="middle" fill="' + (v >= 0 ? UP : DOWN) + '">' + (v >= 0 ? '+' : '') + v.toFixed(2) + '</text>';
    g += '<text class="chart-axis" x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(y) + '</text>';
  });

  const best = yrs.reduce((a, b) => (cal[b] > cal[a] ? b : a), yrs[0]);
  const worst = yrs.reduce((a, b) => (cal[b] < cal[a] ? b : a), yrs[0]);

  return '<div class="chart-box">' +
    '<div class="chart-head">' +
      '<span class="ct">' + TT('历年回报走势（%）') + '</span>' +
      '<span class="cl">' + esc(yrs[0]) + ' – ' + esc(yrs[yrs.length - 1]) + ' ' +
        TQ('共 {n} 个年度　·　最佳 {b} 年 {v1}　·　最差 {w} 年 {v2}', {
          n: yrs.length,
          b: esc(best),
          v1: '<b style="color:' + UP + '">' + (cal[best] >= 0 ? '+' : '') + cal[best].toFixed(2) + '%</b>',
          w: esc(worst),
          v2: '<b style="color:' + DOWN + '">' + cal[worst].toFixed(2) + '%</b>',
        }) +
      '</span>' +
    '</div>' +
    '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" ' +
      'aria-label="' + TQ('该基金 {a} 至 {b} 年历年回报柱状图', { a: esc(yrs[0]), b: esc(yrs[yrs.length - 1]) }) + '">' + g + '</svg>' +
    '<div class="chart-note">' + TT('数据取自积金局「曆年回報」官方字段；缺数据的年度不绘制，不做插值或补全。') + '</div>' +
    '</div>';
}

/** 详情页里的净值大数字 */
function navValHtml(x) {
  if (x.navStatus === 'verified' && x.nav != null) {
    // 无估值日的条目在弹窗内同样加「?」标记（与资料库表格一致）
    const q = x.navAsOf ? ''
      : '<span class="nav-q" data-tip="' + esc(TT('该基金官网把估值日放在动态脚本中生成，静态页面读不到，故只显示净值、不显示估值日；净值本身仍为该官网公布的官方原值。')) + '">?</span>';
    return nf(x.nav, 4) + q;
  }
  if (x.navStatus === 'na') return '<span class="nav-na">' + TT('不适用') + '</span>';
  return '<span class="nav-pending">' + TT('待核实') + '</span>';
}

/** 单位资产净值单元格：已核实按官方值显示，未核实显示「待核实」，官方不提供的显示「不适用」。
    悬浮说明统一走自绘浮层（data-tip）：鼠标悬停 / 点击 / 键盘聚焦都能看到，移动端可点。 */
function navCell(x, noDate) {
  const Q_TIP = TT('该基金官网把估值日放在动态脚本中生成，静态页面读不到，故只显示净值、不显示估值日；净值本身仍为该官网公布的官方原值。');
  if (x.navStatus === 'verified' && x.nav != null) {
    // AMTD 价格页由脚本动态载入（静态回退为旧日期），客户点入核对时需提示等待加载
    const dynTip = /ooogroup/i.test(x.navSourceUrl || '')
      ? ' ' + TT('该来源页的价格由脚本动态载入，请以页面实际显示为准（若未加载完成可能显示较早日期的价格）。')
      : '';
    // 显示保留 4 位小数；官网原值小数位更多时，在悬浮说明里给出原值（透明、可核对）
    const rawStr = String(x.nav);
    const rawTip = (rawStr.split('.')[1] || '').length > 4 ? '　' + TQ('官网原值 {v}', { v: rawStr }) : '';
    const tip = (x.navAsOf
      ? TQ('已核对官方来源：{s}　净值截至 {d}', { s: x.navSource || '', d: x.navAsOf })
      : TQ('已核对官方来源：{s}　该基金官网未静态公布估值日', { s: x.navSource || '' })) + rawTip + dynTip;
    // 有净值、但官网未静态公布估值日：加「?」标记 + 悬浮解释（客户最常问「为什么这只没日期」）
    const q = x.navAsOf ? ''
      : '<span class="nav-q" data-tip="' + esc(Q_TIP) + '" aria-label="' + esc(Q_TIP) + '">?</span>';
    /* noDate=true 时不显示净值下方的日期小字（用于「基金分析」页——该页有独立的「更新日期」列） */
    return '<div class="nav-v num" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + nf(x.nav, 4) + q + '</div>' +
      (noDate ? '' : '<div class="nav-d">' + (x.navAsOf ? esc(x.navAsOf.slice(5).replace('-', '/')) : '—') + '</div>');
  }
  if (x.navStatus === 'na') {
    const t1 = TT('该基金为官方注明不提供单位资产净值的保证基金／非单位化基金');
    return '<span class="nav-na" data-tip="' + esc(t1) + '" aria-label="' + esc(t1) + '">' + TT('不适用') + '</span>';
  }
  const t2 = TT('未能从受托人／保荐人官网公开页面取得最新净值，为避免出错暂不填值');
  return '<span class="nav-pending" data-tip="' + esc(t2) + '" aria-label="' + esc(t2) + '">' + TT('待核实') + '</span>';
}

/** 文末友情链接（官方数据来源） */
const FRIEND_LINKS = [
  ['积金局 · 强积金基金平台（基金列表）', 'https://mfp.mpfa.org.hk/tch/mpp_list.jsp', '本站基金列表与各项数据的官方来源'],
  ['积金局 · 官方网站', 'https://www.mpfa.org.hk/', '强制性公积金计划管理局'],
  ['积金易平台 · 基金价格', 'https://www.empf.org.hk/page/fund-prices', '官方汇总的各强积金计划基金价格链接'],
];

/** 各计划受托人／保荐人官网基金价格页（首页无数据时使用的静态回退） */
const TRUSTEE_LINKS = [
  ['滙豐強積金智選計劃', 'https://www.hsbc.com.hk/zh-hk/mpf/tool/unit-prices/'],
  ['恒生強積金智選計劃', 'https://www.hangseng.com/zh-hk/personal/insurance-mpf/e-mpf/fund-price-performance/'],
  ['東亞（強積金）計劃', 'https://www.hkbea.com/cgi-bin/rate_mpfcfp.jsp?language=tc'],
  ['我的強積金計劃（中銀保誠）', 'https://www.bocpt.com/homepage/zh-hk/my-choice-mpf/fund-price-enquiry/'],
  ['中銀保誠簡易強積金計劃', 'https://www.bocpt.com/homepage/easy-choice-mpf/fund-price-enquiry/'],
  ['BCT 積金之選', 'https://www.bcthk.com/zh/mpf-orso/fund-information/fund-prices'],
  ['永明彩虹強積金計劃', 'https://www.sunlife.com.hk/zh-hant/investments/mpf-orso-fund-prices-performance/mpf-fund-prices-performance.type-MPF/'],
  ['友邦強積金優選計劃', 'https://www.aia.com.hk/zh-hk/products/mpf/list'],
  ['萬全強制性公積金計劃', 'https://www.yflife.com/tc/Hong-Kong/Corporate/MPF/Fund-Price-History/'],
  ['交通銀行愉盈退休強積金計劃', 'https://www.bocomtrust.com.hk/BankCommSite/shtml/trust/tw/2600764/2600904/2600905/list.shtml?channelId=2600764'],
  ['中國人壽強積金集成信託計劃', 'https://trustee.chinalife.com.hk/mpf/dailyPrices?request_locale=zh_TW'],
  ['富達退休集成信託', 'https://www.fidelity.com.hk/zh/our-funds/mpf'],
];

function li(a) {
  // a[0] 为链接标题（多为界面文案，走翻译；受托人计划名等数据值查不到词条会原样返回）
  return '<li><a href="' + esc(a[1]) + '" target="_blank" rel="noopener">' + esc(TT(a[0])) +
    (a[2] ? '<span>' + esc(a[2]) + '</span>' : '') + '</a></li>';
}

function renderFriends() {
  const ns = DATA.navStat;
  // 优先使用 `page`（官网人类可读页面）；个别来源的 `url` 是 JSON 接口，直接点击只会看到原始数据
  const src = (ns && ns.sources && ns.sources.length)
    ? ns.sources.map((s) => [s.label, s.page || s.url,
      s.asOf ? TQ('净值截至 {d} · {n} 条', { d: s.asOf, n: s.count }) : TQ('{n} 条', { n: s.count })])
    : TRUSTEE_LINKS.map((t) => [t[0], t[1], '']);
  document.querySelectorAll('.friend-links').forEach((box) => {
    box.innerHTML =
      '<div class="fr-title">' + TT('友情链接 · 官方数据来源') + '</div>' +
      '<ul class="fr-list">' + FRIEND_LINKS.map((x) => li([x[0], x[1], TT(x[2])])).join('') + '</ul>' +
      '<div class="fr-sub">' + TT('各计划受托人／保荐人官网基金价格页（单位资产净值核对来源）') + '</div>' +
      '<ul class="fr-list fr-sm">' + src.map(li).join('') + '</ul>';
  });
  // 未加载全量数据的页面（如首页），补拉轻量状态接口以呈现带核对日期的完整来源
  if (!(ns && ns.sources && ns.sources.length)) {
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((st) => {
        if (!st || !st.navStat || !st.navStat.sources || !st.navStat.sources.length) return;
        DATA.navStat = st.navStat;
        renderFriends();
      })
      .catch(() => {});
  }
}

/* ---------- 格式化 ---------- */
function nf(v, d, dash) {
  if (v == null || v === '' || Number.isNaN(v)) return dash === undefined ? '—' : dash;
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
/** 费用展示：官网为区间（1.18 – 1.92）或「最高 x」时，按官网原文形式显示；否则正常数值。
 *  more 来自数据字段 feeMore（见 scraper.js 的 fee() 解析）。 */
function feeText(v, more) {
  if (more && more.cap) return TT('最高') + ' ' + nf(more.max, 2);
  if (more && more.min != null && more.max != null && more.max !== more.min) return nf(more.min, 2) + ' – ' + nf(more.max, 2);
  return nf(v, 2);
}
/** 费用悬浮说明（注明官网原文形式） */
function feeTip(label, more) {
  if (!more) return '';
  if (more.cap) return TQ('官网原文：{k}「最高 {v}% p.a.」', { k: label, v: nf(more.max, 2) });
  return TQ('官网原文：{k}「{a}% – {b}% p.a.」', { k: label, a: nf(more.min, 2), b: nf(more.max, 2) });
}

function pct(v, d) {
  if (v == null) return '—';
  const s = nf(v, d === undefined ? 2 : d);
  return (v > 0 ? '+' : '') + s + '%';
}
function cls(v) {
  if (v == null) return 'flat';
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function riskTag(r) {
  if (r == null) return '<span class="muted">—</span>';
  const tip = MPF_RISK.tip(r);
  return '<span class="risk r' + r + '" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + r + '</span>';
}
function uniq(arr) {
  return Array.from(new Set(arr.filter((x) => x != null && x !== '')));
}

/* ---------- 搜索归一化：简繁互通 + 英文名（2026-10-13） ----------
 * · 简繁：public/zhmap.js 提供「繁→简」逐字映射（仅收录数据中出现的字），
 *   搜索时把查询与命中文本都折算为简体再比对，输简体/繁体均可命中；
 * · 英文：/api/names-en 提供积金局英文版基金/计划/受托人名（按 cf_id 关联），
 *   首次输入时懒加载，不拖慢首屏。 */
let __NAMES_EN = null, __NAMES_EN_P = null;
function ensureNamesEn() {
  if (!__NAMES_EN_P) {
    __NAMES_EN_P = fetch('/api/names-en', { cache: 'default' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { __NAMES_EN = (j && j.funds) || null; window.__mpfNamesEn = __NAMES_EN; return __NAMES_EN; })
      .catch(() => null);
  }
  return __NAMES_EN_P;
}
/** 繁体→简体 逐字折算（无映射的字符原样保留） */
function toSimp(s) {
  const m = window.ZH_MAP;
  const t = String(s == null ? '' : s);
  if (!m) return t;
  let out = '';
  for (const ch of t) out += m[ch] || ch;
  return out;
}
/** 基金搜索命中判定：查询与「基金名+计划+受托人+类别+英文名」的归一化文本比对 */
function fundMatch(x, kwNorm) {
  if (!kwNorm) return true;
  const hay = toSimp((x.fundBase || '') + ' ' + (x.fund || '') + ' ' + (x.scheme || '') + ' ' +
    (x.trustee || '') + ' ' + (x.typeFull || '') + ' ' + (x.unit || '')).toLowerCase();
  let en = '';
  if (__NAMES_EN && __NAMES_EN[x.id]) {
    const e = __NAMES_EN[x.id];
    en = ((e.fund || '') + ' ' + (e.scheme || '') + ' ' + (e.trustee || '')).toLowerCase();
  }
  const kw = String(kwNorm).toLowerCase();
  return hay.indexOf(kw) >= 0 || (en && en.indexOf(kw) >= 0);
}
window.ensureNamesEn = ensureNamesEn;
window.toSimp = toSimp;
window.fundMatch = fundMatch;

/* ---------- 排序：点击表头切换升/降 ---------- */
/* 表头排序：三态（2026-10-22 用户要求）
   ① 第一次点击 → 按该列默认方向（多为「最大在前」= 降序）
   ② 再点同一列 → 反向（「最小在前」= 升序）
   ③ 第三次点击 → 取消排序，恢复页面默认顺序（名次/规模）
   绑定时的 state 即为「默认顺序」，取消时还原。 */
function makeSorter(thList, state, onSort) {
  const D0 = { key: state.key, dir: state.dir };
  const paint = () => {
    thList.forEach((o) => {
      o.classList.remove('sorted');
      const a = o.querySelector('.arrow');
      if (a) a.textContent = '↕';
      if (o.hasAttribute('data-k')) o.setAttribute('aria-sort', 'none');
    });
    /* 2026-10-26 修 2-04：取消态=回到默认序列，也是三态之一——恢复默认列的箭头标记，
       否则默认列（如 size desc）的「降序」肉眼不可见（aria-sort 在 none/asc 间跳） */
    thList.forEach((o) => {
      if (o.dataset.k === D0.key) {
        o.classList.add('sorted');
        const a = o.querySelector('.arrow');
        if (a) a.textContent = D0.dir === 'desc' ? '↓' : '↑';
        if (o.hasAttribute('data-k')) o.setAttribute('aria-sort', D0.dir);
      }
    });
    /* 表头排序与「排名维度」卡片互斥：表头动过之后，卡片不再显示选中态 */
    const tabs = document.querySelector('#selfTabs');
    if (tabs) tabs.querySelectorAll('.st').forEach((n) => { n.classList.remove('on'); n.classList.remove('asc'); });
  };
  thList.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.k;
      if (!key) return;
      const first = th.dataset.defdir === 'asc' ? 'asc' : 'desc';
      const second = first === 'asc' ? 'desc' : 'asc';
      if (state.key !== key) {
        state.key = key;
        state.dir = first;
      } else if (state.dir === first) {
        state.dir = second;
      } else {
        state.key = D0.key;      // ③ 取消：回默认顺序
        state.dir = D0.dir;
        paint();
        onSort();
        return;
      }
      paint();
      th.classList.add('sorted');
      const a2 = th.querySelector('.arrow');
      if (a2) a2.textContent = state.dir === 'asc' ? '↑' : '↓';
      th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      onSort();
    });
  });
}

function sortRows(rows, key, dir) {
  const s = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    let x = a[key];
    let y = b[key];
    const xn = x == null || x === '';
    const yn = y == null || y === '';
    if (xn && yn) return 0;
    if (xn) return 1; // 空值永远排最后
    if (yn) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * s;
    x = String(x);
    y = String(y);
    return x.localeCompare(y, 'zh-Hans-CN') * s;
  });
}

/* ---------- 表格双滚动条：顶部滚动条与表格容器同步 ---------- */
function initDualScroll(scrollSel, topSel, ghostSel) {
  const ts = document.querySelector(scrollSel);
  const top = document.querySelector(topSel);
  const ghost = document.querySelector(ghostSel);
  if (!ts || !top || !ghost) return;
  function syncWidth() {
    ghost.style.width = ts.scrollWidth + 'px';
    top.style.display = ts.scrollWidth > ts.clientWidth + 4 ? '' : 'none';
  }
  ts.addEventListener('scroll', () => { top.scrollLeft = ts.scrollLeft; });
  top.addEventListener('scroll', () => { ts.scrollLeft = top.scrollLeft; });
  window.addEventListener('resize', syncWidth);
  window.__syncTableScroll = syncWidth;
  syncWidth();
  setTimeout(syncWidth, 400);
}

/* ---------- 头部 ---------- */
function mountHeader(active) {
  /* 2026-10-26 修 Pages 子路径 404：全部改相对路径（WorkBuddy 根路径与 Pages /-/ 子路径两站通用） */
  const navs = [
    ['home.html', '首页', 'home'],
    ['index.html', '强积金资料库', 'db'],
    ['analysis.html', 'MPF基金可视化对比', 'an'],
  ];
  const tb = (k) => (typeof window.t === 'function' ? window.t(k) : k);
  document.querySelector('.nav').innerHTML = navs
    .map((n) => '<a href="' + n[0] + '" class="' + (active === n[2] ? 'on' : '') + '">' + tb(n[1]) + '</a>')
    .join('');
  const btn = document.querySelector('.btn-refresh');
  if (btn && !btn.__bound) {
    btn.__bound = 1;
    btn.addEventListener('click', () => refreshData(window.__onRefresh));
  }
  if (!window.__navLangBound) {
    window.__navLangBound = 1;
    document.addEventListener('mpf:lang', () => mountHeader(active));
  }
}

/* 状态行静态占位按当前语言初始化（英文/繁体界面不闪现中文）。
   注意：该元素不能加 data-i18n 属性——缓存命中时 i18n 引擎会把动态状态文本
   打回静态值（此前专门排查过，见页面 HTML 注释）。 */
function localizeStatusPlaceholder() {
  const el = document.querySelector('.upd .t');
  if (!el) return;
  const s = el.textContent || '';
  if (s.indexOf('加载中') >= 0 || s.indexOf('加載中') >= 0 || s.indexOf('Loading') >= 0) {
    el.textContent = TT('数据加载中…');
  }
}
localizeStatusPlaceholder();
document.addEventListener('mpf:lang', localizeStatusPlaceholder);

/* 自算指标（/api/navperf）懒加载：详情小窗与详情页共用同一份缓存 */
let __perfReq = null;
window.ensurePerf = function () {
  if (window.__PERF) return Promise.resolve(window.__PERF);
  if (window.TREND && window.TREND.ensurePerf) {
    return window.TREND.ensurePerf().then((j) => { window.__PERF = j; return j; }).catch(() => null);
  }
  if (!__perfReq) {
    __perfReq = fetch('/api/navperf', { cache: 'default' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { window.__PERF = j; return j; })
      .catch(() => null);
  }
  return __perfReq;
};

/* 近 1 年排名：同类 = 同一「基金种类 - 细类」，按官网净值近 1 年涨幅降序 */
window.mpfSelfRank = function (id, y1) {
  if (y1 == null) return null;
  const list = (DATA && DATA.funds) || [];
  const pf = (window.__PERF && window.__PERF.funds) || {};
  const f = list.find((z) => z.id === id);
  const peers = list.filter((z) => pf[z.id] && pf[z.id].y1 != null);
  if (!f || !peers.length) return null;
  const rk = (arr) => arr.filter((z) => pf[z.id].y1 > y1).length + 1;
  const same = peers.filter((z) => z.subtype === f.subtype && z.type === f.type);
  return { sub: rk(same), subAll: same.length, all: rk(peers), allAll: peers.length };
};

/* ================= 基金详情统一渲染（2026-10-20 v4） =================
 * 小窗（#mBody）与「放大」页（analysis.html #anDetail）共用同一份 HTML 与同一个顺序，
 * 保证「放大 = 纯粹放大」：不多模块、不换顺序，只是版心更宽。
 * 顺序（用户 2026-10-20 定稿）：
 *   ① 表头：醒目价格 + 资产类别 / 3年表现 / 3年波幅 / 收费（含同类星级）
 *   ② 对比基金走势（小标题保留，组件本身不再渲染「净值走势｜导出｜分享」行）
 *   ③ 净值来源说明（紧跟走势图）
 *   ④ 基金详细信息（费用并入，不再单列模块）
 *   ⑤ 自算指标（小标题含同类排名与数据截止日）
 *   ⑥ 累计表现（小标题含来源与截止日）
 *   ⑦ 历年回报
 *   ⑧ 十大持仓 / 投资组合分布（放最后）
 */
let __tperfReq = null;
window.ensureTPerf = function () {
  if (window.__TPERF) return Promise.resolve(window.__TPERF);
  if (!__tperfReq) {
    __tperfReq = fetch('/api/trustee-perf', { cache: 'default' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { window.__TPERF = j; return j; })
      .catch(() => null);
  }
  return __tperfReq;
};

/* 同类星级：5 星 = 同类最好。同类口径 = 同一「基金种类」；样本 < 6 只不给星（避免误导）。 */
function fdStars(id, pick, lowerBetter) {
  const P = window.__PERF;
  if (!P || !P.funds) return '';
  const me = (DATA.funds || []).find((f) => String(f.id) === String(id));
  if (!me) return '';
  const v = pick(me);
  if (v == null || !isFinite(v)) return '';
  const peers = (DATA.funds || [])
    .filter((f) => f.type === me.type)
    .map((f) => pick(f))
    .filter((w) => w != null && isFinite(w));
  if (peers.length < 6) return '';
  const better = peers.filter((w) => (lowerBetter ? w < v : w > v)).length;
  const n = Math.max(1, Math.min(5, 5 - Math.floor((better / peers.length) * 5)));
  const tip = TQ('同类「{t}」{n} 只中排第 {r} 位（{p} 分位），星级仅作同类别横向参考。', {
    t: typeLabel(me.type), n: peers.length, r: better + 1,
    p: Math.round((better / peers.length) * 100) + '%',
  });
  return '<span class="fd-stars" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">' +
    '<i>' + '★'.repeat(n) + '</i>' + '☆'.repeat(5 - n) + '</span>';
}

/** 表头：醒目价格 + 其他重要信息（对齐积金局基金页表头的信息密度） */
function fdHead(x, pf) {
  const hasNav = x.navStatus === 'verified' && x.nav != null;
  const price = hasNav ? nf(x.nav, 4) : (x.navStatus === 'na' ? TT('不适用') : TT('待核实'));
  const asof = hasNav && x.navAsOf ? TQ('截至 {d}', { d: x.navAsOf }) : (hasNav ? TT('估值日未公布') : '');
  const rng = (pf && pf.hi52)
    ? TQ('52周波幅 {a} – {b}', { a: nf(pf.hi52.lo, 2), b: nf(pf.hi52.hi, 2) })
    : '';
  const y3 = pf ? pf.y3 : null;
  const vol3 = pf ? pf.vol3 : null;
  const pickY3 = (f) => { const p = window.__PERF && window.__PERF.funds && window.__PERF.funds[String(f.id)]; return p ? p.y3 : null; };
  const pickVol = (f) => { const p = window.__PERF && window.__PERF.funds && window.__PERF.funds[String(f.id)]; return p ? p.vol3 : null; };
  return '<div class="fd-head" id="fdHead">' +
    '<div class="fd-price">' +
      '<div class="fd-k">' + TT('价格（HKD）') + '</div>' +
      (asof ? '<div class="fd-asof">' + asof + '</div>' : '') +
      '<div class="fd-v">' + price + '</div>' +
      (rng ? '<div class="fd-range">' + rng + '</div>' : '') +
    '</div>' +
    '<div class="fd-cell">' +
      '<div class="fd-k">' + TT('资产类别') + '</div>' +
      '<div class="fd-v2 fd-type">' + esc(typeLabel(x.type || x.typeFull)) + '</div>' +
      (x.subtype ? '<div class="fd-s">' + esc(x.subtype) + '</div>' : '') +
    '</div>' +
    '<div class="fd-cell">' +
      '<div class="fd-k">' + TT('表现（3年回报）') + '</div>' +
      '<div class="fd-v2 ' + cls(y3) + '">' + (y3 == null ? '—' : pct(y3)) + '</div>' +
      fdStars(x.id, pickY3, false) +
    '</div>' +
    '<div class="fd-cell">' +
      '<div class="fd-k">' + TT('风险指标（3年波幅）') + '</div>' +
      '<div class="fd-v2">' + (vol3 == null ? '—' : nf(vol3, 2) + '%') + '</div>' +
      fdStars(x.id, pickVol, true) +
    '</div>' +
    '<div class="fd-cell">' +
      '<div class="fd-k">' + TT('收费（基金开支比率）') + '</div>' +
      '<div class="fd-v2">' + (x.fer == null ? '—' : nf(x.fer, 2) + '%') + '</div>' +
      fdStars(x.id, (f) => f.fer, true) +
    '</div>' +
  '</div>';
}

/** 净值来源说明（独立成段，紧跟走势图） */
function fdNavSrc(x) {
  if (!((x.navStatus === 'verified' && x.nav != null) || x.navStatus === 'na')) return '';
  return '<div class="nav-srcnote">' +
    (x.navStatus === 'na'
      ? TQ('该基金为官方注明不提供单位资产净值的保证基金／非单位化基金（来源：{s}），可前往官方页面核对。', { s: esc(x.navSource || TT('发行方官网')) })
      : (x.navAsOf
        ? TQ('该净值取自<b>{s}</b>，估值日 <b>{d}</b>；页面其余各项指标取自积金局基金资讯表（资料截至 {a}）。', { s: esc(x.navSource || TT('发行方官网')), d: esc(x.navAsOf), a: esc((DATA && DATA.dataAsOf) || TT('官网最新公布日')) })
        : TQ('该净值取自<b>{s}</b>，其官网未静态公布估值日；页面其余各项指标取自积金局基金资讯表（资料截至 {a}）。', { s: esc(x.navSource || TT('发行方官网')), a: esc((DATA && DATA.dataAsOf) || TT('官网最新公布日')) }))) +
    (x.navSourceUrl ? '<a class="srcbtn" href="' + esc(x.navSourceUrl) + '" target="_blank" rel="noopener"' +
      (/fidelity\.com\.hk|manulife\.com\.hk/.test(x.navSourceUrl) ? ' title="' + TT('该官网有反爬，若打不开请在浏览器地址栏直接访问') + '"' : '') +
      '>' + TT('打开官方页面核对') + ' ↗</a>' : '') +
    /* 2026-10-23（核验报告 v2 中）：来源长期未更新的基金在详情弹窗也要标出 */
    (x.navStale ? '<span class="hl-src hl-stale" style="margin-left:8px">' + TQ('来源已 {n} 天未更新', { n: Math.round((Date.now() - new Date(x.navAsOf + 'T00:00:00').getTime()) / 864e5) }) + '</span>' : '') +
    (x.id ? '<a class="srcbtn srcbtn-green" href="https://mfp.mpfa.org.hk/mobile/tch/cf_detail.jsp?cf_id=' + esc(x.id) + '" target="_blank" rel="noopener">' + TT('积金局基金详情') + ' ↗</a>' : '') +
    (/中國人壽|中国人寿/.test((x.navSource || '') + (x.trustee || '')) ? '<span class="src-note-inline">' + TT('中国人寿官网公布的是「卖出价」，本站净值取该值（其买入价通常与卖出价相同）。') + '</span>' : '') +
    '</div>';
}

/** 基金详细信息（基本信息 + 投资目标与类别 + 费用及收费，费用并入不再单列） */
function fdBasic(x) {
  const kv = (k, v) => '<div class="bcell"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  const sizeYi = x.size == null ? null : x.size / 100;
  const left =
    '<div class="an-col">' +
      '<div class="ac-title">' + TT('基金与管理') + '</div>' +
      '<div class="ac-kv">' +
        kv(TT('受托人'), esc(x.trustee)) +
        kv(TT('所属计划'), esc(x.scheme)) +
        kv(TT('单位类别'), x.unit ? esc(x.unit) + ' ' + TT('类单位') : TT('单一类别')) +
        kv(TT('推出日期'), esc(x.launch)) +
        kv(TT('基金规模（亿港元）'), sizeYi == null ? '—' : nf(sizeYi, 2)) +
        kv(TT('最近期基金开支比率'), x.fer == null ? '—' : nf(x.fer, 2) + '%') +
      '</div>' +
    '</div>';
  const right =
    '<div class="an-col">' +
      '<div class="ac-title">' + TT('投资目标与类别') + '</div>' +
      '<div class="ac-kv">' +
        kv(TT('基金类别'), esc(typeLabel(x.typeFull))) +
        kv(TT('细类'), esc(x.subtype || '—')) +
        kv(TT('风险级别'), (x.risk == null ? '—' : riskTag(x.risk) + ' <span class="rk-lbl">' + MPF_RISK.label(x.risk) + '</span>')) +
      '</div>' +
      '<p class="ac-note">' + TT('各成分基金的投资目标与投资政策以计划说明书及官方基金页面为准；本页类别描述取自积金局基金资讯表。') + '</p>' +
    '</div>';
  const feeCell = (k, v, more) => '<th>' + k + '</th><td class="num">' + feeText(v, more) + '</td>';
  const fees =
    '<div class="fd-fees">' +
      '<div class="ac-title fee-title">' + TT('费用及收费（% p.a.）') + '</div>' +
      '<table class="kv-tbl"><tbody>' +
        '<tr>' + feeCell(TT('基金管理费'), x.mgmtFee, x.feeMore && x.feeMore.mgmtFee) +
          feeCell(TT('受托人费／保管人费'), x.trusteeFee, x.feeMore && x.feeMore.trusteeFee) + '</tr>' +
        '<tr>' + feeCell(TT('积金易平台费'), x.empfFee, x.feeMore && x.feeMore.empfFee) +
          feeCell(TT('成员服务费'), x.sponsorFee, x.feeMore && x.feeMore.sponsorFee) + '</tr>' +
        '<tr>' + feeCell(TT('投资管理费'), x.investFee, x.feeMore && x.feeMore.investFee) +
          feeCell(TT('保证费'), x.guaranteeFee, x.feeMore && x.feeMore.guaranteeFee) + '</tr>' +
        '<tr><th>' + TT('最近期基金开支比率') + '</th><td class="num">' + (x.fer == null ? '—' : nf(x.fer, 2) + '%') + '</td><th></th><td></td></tr>' +
      '</tbody></table>' +
      '<p class="fee-note">' + TT('部分基金收费在官网以区间或「最高」形式公布（如 1.18 – 1.92%、最高 0.68%），此处按官网原文显示；实际收费以计划说明书为准。') + '</p>' +
    '</div>';
  return '<div class="sect-title">' + TT('基金详细信息') + '</div>' +
    '<div class="an-two">' + left + right + '</div>' + fees;
}

/** 单位类别明细（同一基金多个单位类别时才有） */
function fdUnits(x) {
  const units = x.units || [];
  if (units.length < 2) return '';
  const repId = units.slice().sort((a, b) => ((b.size || 0) - (a.size || 0)))[0].cfId;
  return '<div class="fd-units">' +
    '<div class="ac-title">' + TT('单位类别明细') + '</div>' +
    '<div class="unit-wrap"><table class="unit-tb"><thead><tr>' +
      '<th>' + TT('单位类别') + '</th><th>' + TT('单位资产净值') + '</th><th>' + TT('基金规模') +
      '<br><small>' + TT('百万港元') + '</small></th>' +
      '<th>' + TT('近 1 年') + '</th><th>' + TT('近 5 年') + '</th><th>' + TT('推出至今') + '</th>' +
      '<th>' + TT('基金管理费') + '<br><small>% p.a.</small></th>' +
    '</tr></thead><tbody>' +
    units.map((u) =>
      '<tr' + (u.cfId === repId ? ' class="rep"' : '') + '>' +
      '<td class="uc">' + esc(u.unit) + (u.cfId === repId ? '<span class="rep-tag">' + TT('代表单位') + '</span>' : '') + '</td>' +
      '<td class="r num">' + navCell(u) + '</td>' +
      '<td class="r num">' + nf(u.size, 2) + '</td>' +
      '<td class="r num ' + cls(u.ann1) + '">' + pct(u.ann1) + '</td>' +
      '<td class="r num ' + cls(u.ann5) + '">' + pct(u.ann5) + '</td>' +
      '<td class="r num ' + cls(u.annLaunch) + '">' + pct(u.annLaunch) + '</td>' +
      '<td class="r num">' + nf(u.mgmtFee, 2) + '</td>' +
      '</tr>').join('') +
    '</tbody></table></div>' +
    '<div class="unit-note">' + TQ('同一只成分基金设有 {n} 个单位类别，各单位的收费与净值不同，因此回报表现亦有差异。列表及排名以规模最大的单位类别为代表。', { n: units.length }) + '</div>' +
    '</div>';
}

/** 自算指标条（标题含同类排名与数据截止日） */
function fdSelf(x, pf) {
  if (!pf) {
    return '<div class="sect-title">' + TT('自算指标') + '</div>' +
      '<div class="self-empty">' + TT('该基金暂无官网逐日净值序列（新成立或发行人未提供），无法计算自算指标。') + '</div>';
  }
  const rk = window.mpfSelfRank ? window.mpfSelfRank(x.id, pf.y1) : null;
  let title = TT('自算指标');
  if (rk) title += ' · ' + TQ('近1年同类排名 {a}/{b}', { a: rk.sub, b: rk.subAll });
  title += '（' + TQ('基于官网净值，数据截止至 {d}', { d: pf.asOf || '—' }) + '）';
  const tip = TQ('自算口径：基于发行人官网每日单位资产净值（净值日 {d}），未含分红再投资与费用调整；与积金局「基金回报」的统计期间与算法不同，数值可能有差异。', { d: pf.asOf || '—' });
  /* 2026-10-21：小于 0.01% 的涨跌不再显示成误导性的 0.00% */
  const tinyTip = TT('该区间净值变动小于 0.01%，显示为 <0.01%（非未计算）。');
  const it = (k, v, t, digits) => {
    const tiny = false;
    const txt = pct(v, digits);
    const tip2 = t || '';
    return '<span class="sc-item"' + (tip2 ? ' data-tip="' + esc(tip2) + '" aria-label="' + esc(tip2) + '"' : '') +
      '><em>' + k + '</em><b class="' + cls(v) + '">' + txt + '</b></span>';
  };
  return '<div class="sect-title">' + title +
      '<i class="sc-info" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '">ⓘ</i></div>' +
    '<div class="an-selfcalc">' +
      it(TT('日涨跌'), pf.d1, null, 3) +
      it(TT('近1周'), pf.w1) +
      it(TT('近1月'), pf.m1) +
      it(TT('年初至今'), pf.ytd) +
      it(TT('近1年'), pf.y1) +
      it(TT('近3年年化'), pf.y3a) +
      it(TT('近5年年化'), pf.y5a) +
      '<span class="sc-item"><em>' + TT('5年最大回撤') + '</em><b class="down">' + (pf.mdd5 != null ? pct(pf.mdd5) : '—') + '</b></span>' +
      '<span class="sc-item"><em>' + TT('3年波幅') + '</em><b>' + (pf.vol3 != null ? pct(pf.vol3) : '—') + '</b></span>' +
      '<span class="sc-item"><em>' + TT('夏普(1年)') + '</em><b>' + (pf.sharpe1 != null ? pf.sharpe1.toFixed(2) : '—') + '</b></span>' +
    '</div>';
}

/** 累计表现（8 区间，逐行标来源） */
function fdReturns(x, pf) {
  const cell = (v) => '<td class="num ' + cls(v) + '">' + (v == null ? '—' : pct(v)) + '</td>';
  const row = (label, cum, ann) =>
    '<tr><th scope="row">' + label + '</th>' + cell(cum) + cell(ann) + '</tr>';
  /* 2026-10-21：按用户要求只保留积金局公布的 4 个区间（近1年/近5年/近10年/推出至今），
     自算的年初至今、1/3 个月、近 3 年与上方「自算指标」重复，已移除；口径说明一并去掉。 */
  const rows = [
    row(TT('近 1 年'), x.cum1, x.ann1),
    row(TT('近 5 年'), x.cum5, x.ann5),
    row(TT('近 10 年'), x.cum10, x.ann10),
    row(TT('推出至今'), x.cumLaunch, x.annLaunch),
  ];
  const asOf = (DATA && DATA.dataAsOf) || TT('官网最新公布日');
  return '<div class="sect-title">' + TQ('累计表现（基于积金局官网月度数据，截止至 {d}）', { d: esc(asOf) }) + '</div>' +
    '<div class="an-perf">' +
    '<table class="perf-table"><thead><tr>' +
      '<th scope="col">' + TT('区间') + '</th>' +
      '<th scope="col">' + TT('累积回报（%）') + '</th>' +
      '<th scope="col">' + TT('年率化（% p.a.）') + '</th>' +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
    '</div>';
}

/** 持仓/分布骨架：保证「即使没有数据，模块也必须在页面上」（用户 2026-10-21 强调） */
function fdBone(title) {
  return '<div class="an-hold"><div class="sect-title"><i class="st-accent"></i>' + TT(title) +
    '<span class="hl-src">' + TT('加载中…') + '</span></div>' +
    '<div class="empty">' + TT('正在读取数据…') + '</div></div>';
}
window.fdBone = fdBone;

/** 完整详情 HTML（不含走势图挂载点内容，由调用方 mount） */
window.fundDetailHTML = function (x, opts) {
  opts = opts || {};
  const pf = opts.perf !== undefined ? opts.perf
    : ((window.__PERF && window.__PERF.funds) ? (window.__PERF.funds[String(x.id)] || null) : null);
  const tp = opts.tperf !== undefined ? opts.tperf
    : ((window.__TPERF && window.__TPERF.funds) ? (window.__TPERF.funds[String(x.id)] || null) : null);
  const unitTag = x.unit ? '<span class="tag unit">' + TQ('{u} 类单位', { u: esc(x.unit) }) + '</span>' : '';
  const title = opts.withTitle === false ? '' :
    '<div class="fd-title">' + esc(x.fundBase || x.fund) + unitTag + '</div>' +
    '<div class="fd-sub">' + esc(x.scheme) + ' · ' + esc(x.trustee) + ' · <span class="tag g">' + esc(typeLabel(x.typeFull)) + '</span></div>';
  return '<div class="fd">' +
    title +
    fdHead(x, pf) +
    '<div class="sect-title">' + TT('对比基金走势') + '</div>' +
    '<div class="an-trendwrap" id="fdTrend"></div>' +
    fdNavSrc(x) +
    fdBasic(x) +
    fdUnits(x) +
    '<div id="fdSelf">' + fdSelf(x, pf) + '</div>' +
    '<div id="fdRet">' + fdReturns(x, pf) + '</div>' +
    '<div class="sect-title">' + TT('历年走势') + '</div>' +
    '<div class="fd-cal">' + calChart(x) + '</div>' +
    '<div id="fdHolds">' + fdBone('前十大持仓') + '</div>' +
    '<div id="fdAlloc">' + fdBone('投资组合分布') + '</div>' +
    '</div>';
};

/** 数据到货后局部刷新（不动走势图，避免闪烁） */
window.fundDetailRefresh = function (x) {
  if (!x) return;
  const pf = (window.__PERF && window.__PERF.funds) ? (window.__PERF.funds[String(x.id)] || null) : null;
  const tp = (window.__TPERF && window.__TPERF.funds) ? (window.__TPERF.funds[String(x.id)] || null) : null;
  const h = document.querySelector('#fdHead');
  if (h) h.outerHTML = fdHead(x, pf);
  const s = document.querySelector('#fdSelf');
  if (s) s.innerHTML = fdSelf(x, pf);
  const r = document.querySelector('#fdRet');
  if (r) r.innerHTML = fdReturns(x, pf);
};

/* ---------- 基金详情弹窗（资料库 / 排名页共用） ---------- */
/* ================= 持仓 / 投资组合分布（共享渲染：详情页 + 小窗，2026-10-15） =================
 * 版式对齐实习生页面：白卡、单一蓝系、细线、名称左 / 占比右、汇总行、来源行。
 * 数据：/api/holdings（宏利官网基金详情 + 友邦 FPR 月刊）；无数据时给出空态提示。 */
/* 2026-10-20：改为按基金 id 懒加载（全量 433KB → 单条约 2KB），已加载的按 id 累积缓存 */
window.__HLDG = window.__HLDG || { funds: {}, count: 0 };
const __hldgPending = Object.create(null);
window.ensureHoldings = function (id) {
  const H = window.__HLDG;
  if (id && H.funds && H.funds[String(id)]) return Promise.resolve(H);
  if (!id && H.count) return Promise.resolve(H);           /* 全量已加载 */
  const key = id ? String(id) : '__all__';
  if (__hldgPending[key]) return __hldgPending[key];
  const url = id ? '/api/holdings?id=' + encodeURIComponent(id) : '/api/holdings';
  __hldgPending[key] = fetch(url, { cache: 'default' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && j.funds) Object.assign(H.funds, j.funds);
      if (j && j.updatedAt) H.updatedAt = j.updatedAt;
      if (j && j.count) H.count = j.count;
      if (j && j.source) H.source = j.source;
      return H;
    })
    .catch(() => H)
    .then((x) => { delete __hldgPending[key]; return x; });
  return __hldgPending[key];
};

window.holdBlockHTML = function (id) {
  const HLDG = window.__HLDG;
  const d = HLDG && HLDG.funds ? HLDG.funds[id] : null;
  /* 2026-10-18：来源优先取该基金条目的 src（各发行人不同），不再一律用顶层混合文案 */
  const src = (d && d.src) || (HLDG && HLDG.source) || TT('各发行人官网「基金便览」(Fund Fact Sheet)');
  const cnt = (HLDG && HLDG.count) || 0;
  /* 2026-10-23：报告期过期提示——持仓截至日超过 1 个季度（>4 个月）时明确标出，避免用户把旧持仓当最新 */
  /* 2026-10-24（领导）：不得一律归咎"发行人未更新"——AMTD 已核实按季发布便览，只是托管在 Google Drive 而本站取数通道不可达 */
  let staleBadge = '';
  if (d && d.asOf) {
    const t0 = new Date(d.asOf + 'T00:00:00');
    const now = new Date();
    const mAgo = (now.getFullYear() - t0.getFullYear()) * 12 + (now.getMonth() - t0.getMonth());
    /* 判定用「上一个已结束季度末 − 100 天」为界（与季度任务的 98% 口径一致）：
       季报通常季末后 1–2 个月才发，刚过季末的 Q2 数据不算过期，避免误标 */
    const qEnd = (function (n) {
      const y = n.getFullYear(), m = n.getMonth();
      const qm = [2, 5, 8, 11], qd = [31, 30, 30, 31];
      for (let i = 3; i >= 0; i--) if (m > qm[i]) return new Date(y, qm[i], qd[i]);
      return new Date(y - 1, 11, 31);
    })(now);
    const floor = new Date(qEnd.getTime() - 100 * 86400000);
    if (isFinite(mAgo) && t0 < floor) {
      const st = d.srcStatus || '';
      let msg;
      if (st === 'blocked') {
        msg = TQ('发行人已按季发布更新报告，但本站取数通道暂不可达；本页为 {d} 的报告（距今 {n} 个月）', { d: d.asOf, n: mAgo });
      } else if (st === 'lag') {
        msg = TQ('本站数据源尚未转载最新季度；本页为 {d} 的报告（距今 {n} 个月）', { d: d.asOf, n: mAgo });
      } else {
        /* 未核实发行人是否已发布，只陈述我方事实，不作推断 */
        msg = TQ('数据源最后更新为 {d}（距今 {n} 个月）', { d: d.asOf, n: mAgo });
      }
      staleBadge = '<span class="hl-src hl-stale">' + msg + '</span>';
    }
  }
  const srcNote = (d && d.srcNote) ? '<div class="hl-note hl-note-warn">' + esc(TT(d.srcNote)) + '</div>' : '';
  const title = '<div class="sect-title"><i class="st-accent"></i>' + TT('前十大持仓') +
    '<span class="hl-src">' + (d && d.asOf ? TQ('截至 {d}', { d: d.asOf }) : TT('数据接入中')) + '</span>' + staleBadge + '</div>';
  if (!d || !d.top10 || !d.top10.length) {
    return '<div class="an-hold">' + title +
      '<div class="empty">' + TT('持仓数据接入中——将展示十大持仓的名称与投资占比（含汇总）。') + '</div>' +
      '<div class="hl-note">' + TQ('数据来源：{s}；当前已接入 {n} 只基金。', { s: src, n: cnt }) + '</div>' + srcNote + '</div></div>';
  }
  const sum = d.top10.reduce((a, h) => a + (h.weight || 0), 0);
  /* 有代码/价格明细时（未来接入行情）：七列完整表 */
  const hasDetail = d.top10.some((h) => h.code);
  if (hasDetail) {
    const rows = d.top10.map((h) => '<tr>' +
      '<td class="fz">' + esc(h.name || '') + '</td>' +
      '<td class="c">' + esc(h.code || '') + '</td>' +
      '<td class="r num">' + (h.price == null ? '—' : nf(h.price, 2)) + '</td>' +
      '<td class="c">' + esc(h.unit || '') + '</td>' +
      '<td class="r num ' + cls(h.chg) + '">' + (h.chg == null ? '—' : (h.chg > 0 ? '▲ ' : (h.chg < 0 ? '▼ ' : '')) + pct(h.chg)) + '</td>' +
      '<td class="c">' + esc(h.date || '') + '</td>' +
      '<td class="r num">' + (h.weight == null ? '—' : nf(h.weight, 2) + '%') + '</td></tr>').join('');
    return '<div class="an-hold">' + title +
      '<div class="table-scroll"><table class="data hl-table"><thead><tr>' +
      ['中文简称', '股票代码', '收盘价', '单位', '涨跌幅', '更新日期', '投资占比'].map((k, i) => '<th class="' + (i === 0 ? 'fz' : (i === 2 || i === 4 || i === 6 ? 'r' : 'c')) + '">' + TT(k) + '</th>').join('') +
      '</tr></thead><tbody>' + rows +
      '<tr class="hl-sumrow"><td class="fz">' + TT('汇总') + '</td><td colspan="5"></td><td class="r num">' + nf(sum, 2) + '%</td></tr>' +
      '</tbody></table></div>' +
      '<div class="hl-note">' + TQ('数据来源：{s}；截至 {d}。', { s: src, d: d.asOf || '—' }) + '</div>' + srcNote + '</div></div>';
  }
  /* 官网仅公布「名称 + 占比」时的简洁表（照抄实习生版式：细线、名称左、占比右、汇总行） */
  const rows2 = d.top10.map((h) => '<tr><td class="fz">' + esc(h.name || '') + '</td>' +
    '<td class="r num">' + (h.weight == null ? '—' : nf(h.weight, 2) + '%') + '</td></tr>').join('');
  return '<div class="an-hold">' + title +
    '<table class="data hl-table hl-simple"><thead><tr><th class="fz">' + TT('中文简称') + '</th><th class="r">' + TT('投资占比') + '</th></tr></thead>' +
    '<tbody>' + rows2 +
    '<tr class="hl-sumrow"><td class="fz">' + TT('汇总') + '</td><td class="r num">' + nf(sum, 2) + '%</td></tr>' +
    '</tbody></table>' +
    '<div class="hl-note">' + TQ('数据来源：{s}；截至 {d}。', { s: src, d: d.asOf || '—' }) + '</div>' + srcNote + '</div></div>';
};

window.allocBlockHTML = function (id) {
  const HLDG = window.__HLDG;
  const d = HLDG && HLDG.funds ? HLDG.funds[id] : null;
  /* 2026-10-18：来源优先取该基金条目的 src（各发行人不同），不再一律用顶层混合文案 */
  const src = (d && d.src) || (HLDG && HLDG.source) || TT('各发行人官网「基金便览」(Fund Fact Sheet)');
  /* 2026-10-20：标题可被该基金的 allocTitle 覆盖（如海通按行业/地区披露） */
  /* 2026-10-23（核验报告 #4）：源未给口径标题时，统一显示「投资组合分布」，不再留空 */
  const titleText = (d && d.allocTitle) ? TT(d.allocTitle) : TT('投资组合分布');
  const title = '<div class="sect-title"><i class="st-accent"></i>' + titleText +
    (d && d.allocLabel ? '<span class="hl-src">' + esc(d.allocLabel) + '</span>' : '') +
    '<span class="hl-src">' + (d && d.asOf ? TQ('截至 {d}', { d: d.asOf }) : TT('报告期不详（源便览未标注）')) + '</span></div>';
  if (!d || !d.alloc || !d.alloc.length) {
    return '<div class="an-hold">' + title +
      '<div class="empty">' + TT('投资组合分布尚未接入：该计划便览可能只披露十大持仓，或本站仍在解析该版式。') + '</div>' +
      '<div class="hl-note">' + TQ('数据来源：{s}（月度）。', { s: src }) + '</div></div>';
  }
  /* 2026-10-15 重做（二修）：百分比一律在柱外（不压柱）；仅最大项用深蓝，其余浅蓝 */
  const max = Math.max.apply(null, d.alloc.map((a) => a.weight || 0)) || 1;
  let axisMax = Math.max(10, Math.ceil(max / 10) * 10);
  if (max / axisMax > 0.75) axisMax += 10;   /* 给柱外数字留位 */
  const step = axisMax <= 30 ? 5 : 10;
  const ticks = [];
  for (let t = 0; t <= axisMax; t += step) ticks.push(t);
  const grid = '<div class="alx-grid">' + ticks.map((t) => '<i style="left:' + (t / axisMax * 100).toFixed(2) + '%"></i>').join('') + '</div>';
  const axis = '<div class="alx-axis">' + ticks.map((t) => '<span style="left:' + (t / axisMax * 100).toFixed(2) + '%">' + t + '</span>').join('') + '</div>';
  const rows = d.alloc.map((a) => {
    const pct = axisMax ? ((a.weight || 0) / axisMax * 100) : 0;
    const dark = (a.weight || 0) >= max;   /* 最大项深蓝，其余浅蓝（对齐同业版式） */
    return '<div class="alx-row"><span class="alx-k">' + esc(a.label || '') + '</span>' +
      '<span class="alx-plot"><i class="' + (dark ? 'alx-strong' : '') + '" style="width:' + pct.toFixed(2) + '%"></i>' +
      '<b>' + nf(a.weight, 2) + '%</b></span></div>';
  }).join('');
  /* 2026-10-23：合计校验。源便览只列主要类别时合计会明显低于 100%（本站 48 只如此，
     最低 73%），此前直接画图会让人误以为剩余部分是"其他"。这里如实标注缺口。 */
  const allocSum = d.alloc.reduce((a, c) => a + (+c.weight || 0), 0);
  const allocGap = Math.abs(allocSum - 100) > 0.5
    ? '<div class="hl-note hl-warn">' + TQ('上图仅列出该基金便览披露的主要类别，合计 {s}%；未列出的类别（约 {g}%）未在源文件中单列，本站不做推算补齐。', { s: nf(allocSum, 2), g: nf(100 - allocSum, 2) }) + '</div>'
    : '';
  return '<div class="an-hold">' + title +
    '<div class="alx">' + grid + rows + axis + '</div>' +
    '<div class="hl-note">' + TQ('数据来源：{s}；截至 {d}。', { s: src, d: d.asOf || '—' }) + '</div>' + allocGap + '</div>';
};

window.openDetail = function (id) {
  const x = DATA.funds.find((f) => f.id === id);
  const title = document.querySelector('#mTitle');
  if (!x || !title) return;
  setFundParam(id);

  title.textContent = x.fundBase || x.fund;
  document.querySelector('#mSub').innerHTML =
    esc(x.scheme) + ' · ' + esc(x.trustee) + ' · <span class="tag g">' + esc(typeLabel(x.typeFull)) + '</span>' +
    (x.groupSize > 1 ? ' · <span class="tag unit">' + TQ('{n} 个单位类别', { n: x.groupSize }) + '</span>' : '');

  /* 2026-10-20 v4：小窗内容 = 详情页同一份渲染（withTitle:false，标题在 modal 头部） */
  const body = document.querySelector('#mBody');
  body.innerHTML = window.fundDetailHTML(x, { withTitle: false });
  const modalEl = document.querySelector('#modal');
  modalEl.classList.add('show');
  modalEl.scrollTop = 0;   /* 滚动容器是 .modal 本身（overflow:auto），不是 body */

  const stillOpen = () => {
    const t = document.querySelector('#mTitle');
    const m = document.querySelector('#modal');
    return !!t && t.textContent === (x.fundBase || x.fund) && m && m.classList.contains('show');
  };

  mountFD(x, stillOpen);
  fillFDHolds(x, stillOpen);

  /* 自算指标 / 累计表现 / 表头星级：数据到货后局部刷新（不重建走势图）。
     2026-10-21：navperf 271KB 与 hist 同时抢带宽会让走势图迟迟不出，故延后 500ms 再拉。 */
  setTimeout(() => {
    window.ensurePerf().then(() => { if (stillOpen()) window.fundDetailRefresh(x); }).catch(() => {});
    window.ensureTPerf().then(() => { if (stillOpen()) window.fundDetailRefresh(x); }).catch(() => {});
  }, 500);

  /* 头部按钮：用 onclick 覆盖（addEventListener 会在每次打开时累积监听，导致「导出」被触发多次） */
  const btnEx = document.querySelector('#mExport');
  /* 2026-10-21：导出改用走势图工作簿（逐日净值 + 当日涨跌幅 + 走势图 + 对比表），单只基金同样适用 */
  if (btnEx) btnEx.onclick = () => { if (window.__trendExportBook) window.__trendExportBook(); else exportOneFund(x); };
  const btnSh = document.querySelector('#mShare');
  if (btnSh) btnSh.onclick = () => shareFundLink(x.id);
  const btnEx2 = document.querySelector('#mExpand');
  if (btnEx2) btnEx2.onclick = () => {
    if (typeof window.anOpen === 'function') {
      const m = document.querySelector('#modal');
      if (m) m.classList.remove('show');
      try {
        const u = new URL(location.href);
        if (u.searchParams.has('fund')) { u.searchParams.delete('fund'); history.replaceState(null, '', u); }
      } catch (e) {}
      window.anOpen(x.id, { replace: true });
    } else {
      window.location.href = 'analysis.html?open=' + encodeURIComponent(x.id);
    }
  };
};

/* 详情（小窗 / 放大页）走势图：只画本基金，不带「净值走势｜导出｜分享」标题行 */
function mountFD(x, alive) {
  const box = document.querySelector('#fdTrend');
  if (!box) return;
  if (!window.TREND || !TREND.ensurePerf) return;
  TREND.ensurePerf().then((p) => {
    if (!box.isConnected || (alive && !alive())) return;
    const has = !!(p && p.funds && p.funds[String(x.id)]);
    box.innerHTML = '';
    if (has) {
      /* 2026-10-21：注入 fundMeta，使小窗/详情页的「选择基金」面板与第三页一致（发行人 × 类别两维筛选） */
      const meta = {};
      (DATA.funds || []).forEach((f) => { meta[String(f.id)] = { trustee: f.trustee || '其他', type: f.type || '' }; });
      TREND.mount(box, [{ type: 'fund', id: x.id }], { bareHead: true, hideGoto: true, fundMeta: meta });
      /* 2026-10-21：历史有缺口的基金（早期源站只有月度价）→ 图例旁加一个悬浮提示 */
      (function () {
        if (!window.__gapsP) window.__gapsP = fetch('/api/hist-gaps').then((r) => r.json()).catch(() => null);
        window.__gapsP.then((g) => {
          const info = g && g.funds && g.funds[String(x.id)];
          if (!info || !document.body.contains(box)) return;
          const old = box.querySelector('.gap-flag');
          if (old) old.remove();
          const el = document.createElement('span');
          el.className = 'gap-flag';
          el.setAttribute('data-tip', TQ('该基金在 {a} 至 {b} 之间有 {n} 处缺日（源站当时只公布月度价格，非本站漏抓）', { a: info.first, b: info.last, n: info.n }));
          el.textContent = TT('ⓘ 早期为月度数据');
          const bar = box.querySelector('.tr-tools2') || box.querySelector('.tr-selects');
          if (bar) bar.appendChild(el);
        });
      })();
    } else {
      box.innerHTML = '<div class="an-coming"><b>' + TT('净值走势对比（1周–5年）') + '</b>' +
        TQ('历史净值回填中：当前已接入 {n} 只基金，其余受托人陆续接入；本基金数据就绪后走势对比将自动开放。', { n: (p && p.count) || 0 }) + '</div>';
    }
  }).catch(() => {});
}
window.mountFD = mountFD;

/* 详情（小窗 / 放大页）持仓与组合分布：按 id 懒加载 */
function fillFDHolds(x, alive) {
  const hb = document.querySelector('#fdHolds');
  const ab = document.querySelector('#fdAlloc');
  if (!hb || !ab) return;
  /* 9 秒兜底：接口挂起时把骨架改成明确提示，避免一直显示「正在读取数据」 */
  const guard = setTimeout(() => {
    [hb, ab].forEach((box) => {
      if (!box || !box.isConnected) return;
      const e = box.querySelector('.empty');
      if (e && /正在读取数据/.test(e.textContent)) e.textContent = TT('数据暂不可用，请稍后刷新重试');
    });
  }, 9000);
  const paint = () => {
    clearTimeout(guard);
    if (!hb.isConnected || (alive && !alive())) return;
    /* 兜底：渲染函数返回空也保留模块（用户强调「没数据也要有栏目」） */
    const hHtml = window.holdBlockHTML ? window.holdBlockHTML(String(x.id)) : '';
    const aHtml = window.allocBlockHTML ? window.allocBlockHTML(String(x.id)) : '';
    hb.innerHTML = hHtml || window.fdBone(TT('前十大持仓'));
    ab.innerHTML = aHtml || window.fdBone(TT('投资组合分布'));
  };
  if (window.ensureHoldings) window.ensureHoldings(x.id).then(paint).catch(paint);
  else paint();
}
window.fillFDHolds = fillFDHolds;
window.closeModal = function () {
  const m = document.querySelector('#modal');
  if (m) m.classList.remove('show');
  clearFundParam();
};

/* ======================= 可分享的基金深链（?fund=<id>） =======================
 * 打开详情时把 fund 参数写入地址栏：首次打开 pushState（浏览器「返回」= 关闭弹窗），
 * 弹窗内切换基金则 replaceState（不堆积历史）；关闭时若存在我们的历史记录则回退一步。
 * 以 ?fund=<id> 打开页面时，数据就绪后自动弹出对应基金的详情。 */
function setFundParam(id) {
  try {
    const u = new URL(location.href);
    const cur = u.searchParams.get('fund');
    if (cur === id) return;
    u.searchParams.set('fund', id);
    if (cur) history.replaceState({ mpfModal: id }, '', u);   // 弹窗已开着 → 只替换
    else history.pushState({ mpfModal: id }, '', u);          // 首次打开 → 新增历史记录
  } catch (e) {}
}
function clearFundParam() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('fund')) return;
    if (history.state && history.state.mpfModal) { history.back(); return; }  // 由 popstate 关闭
    u.searchParams.delete('fund');
    history.replaceState(null, '', u);
  } catch (e) {}
}
/* 深链：支持 ?fund=<id>（本站规范）与 ?f=<id>（首页/分享入口，2026-10-24 核验报告 v3 #3）
   两者都按字符串比对 id，命中后统一改写成 ?fund=，避免地址栏里留着 ?f= 干扰后续状态 */
function deepFundId() {
  const m = /[?&](?:fund|f)=([^&#]+)/.exec(location.search);
  return m ? decodeURIComponent(m[1]) : '';
}
function findFundLoose(id) {
  if (!DATA || !DATA.funds) return null;
  const want = String(id);
  return DATA.funds.filter((f) => String(f.id) === want)[0] || null;
}
function openDeepFund(rawId) {
  const x = findFundLoose(rawId);
  if (!x) return false;
  try {
    if (/[?&]f=/.test(location.search)) {
      const u = new URL(location.href);
      u.searchParams.delete('f');
      u.searchParams.set('fund', String(x.id));
      history.replaceState({ mpfModal: x.id }, '', u);
    }
  } catch (e) {}
  window.openDetail(x.id);
  return true;
}
/* 浏览器前进 / 后退：按地址栏的 fund 参数开 / 关弹窗 */
window.addEventListener('popstate', function () {
  try {
    const want = deepFundId();
    if (want) openDeepFund(want);
    else if (window.closeModal) window.closeModal();
  } catch (e) {}
});
(function initFundLink() {
  const want = deepFundId();
  if (!want) return;
  let n = 0;
  const t = setInterval(() => {
    n++;
    if (DATA && DATA.funds && DATA.funds.length) {
      clearInterval(t);
      openDeepFund(want);
    } else if (n > 100) clearInterval(t);
  }, 200);
})();

/** 构建某基金的分享链接（当前页 + ?fund=<id>，打开即弹该基金详情；保留当前榜单 hash 上下文） */
function fundShareURL(id) {
  try {
    const u = new URL(location.href);
    u.searchParams.set('fund', id);
    return u.toString();
  } catch (e) {
    return location.origin + location.pathname + '?fund=' + encodeURIComponent(id);
  }
}

/** 详情弹窗「分享」按钮：复制该基金分享链接（clipboard API，失败时退回 execCommand） */
function shareFundLink(id) {
  const url = fundShareURL(id);
  const done = () => { mpfToast(TT('链接已复制，可直接发给客户')); trackEvent('share'); };
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) { mpfToast(url); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(fallback);
  } else fallback();
}

/** 详情弹窗「导出」按钮：导出单只基金数据（CSV，列与资料库导出一致，含 FER） */
function exportOneFund(x) {
  const head = [TT('成分基金'), TT('单位类别'), TT('基金种类'), TT('强积金计划'), TT('发行人'), TT('风险级别'),
    TT('单位资产净值'), TT('净值估值日'), TT('近1年年率化回报'), TT('近5年年率化回报'), TT('近10年年率化回报'),
    TT('推出至今年率化回报'), TQ('基金规模（{u}）', { u: TT('百万港元') }), TT('基金管理费 %'), TT('最近期基金开支比率'), TT('推出日期')];
  const row = [
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
  ];
  const fname = 'MPF_' + String(x.fundBase || x.fund).replace(/[\\/:*?"<>|]/g, '') + '_' + TT('数据截至') + '_' + (DATA.dataAsOf || '') + '.csv';
  csvDownload(csvSourceNote().concat([head], [row]), fname);
}

/* ======================= 通用 CSV 下载（UTF-8 BOM，Excel 打开不乱码） ======================= */
/** 导出文件的溯源头（# 注释行）：供分析师/机构客户引用时标注数据来源与日期 */
function csvSourceNote(opt) {
  const rows = [];
  if (opt && opt.self) {
    /* 自算榜：数据全部来自发行人官网净值，不含积金局字段 */
    rows.push(['# 数据来源：各计划受托人官网每日单位资产净值（本站自算，不依赖积金局月报）']);
    const navDates = (DATA.funds || []).filter((f) => f.navStatus === 'verified' && f.navAsOf).map((f) => f.navAsOf).sort();
    const nr = navDates.length ? navDates[0] + ' 至 ' + navDates[navDates.length - 1] : '—';
    rows.push(['# 净值估值日区间：' + nr + '；本站同步时间：' + fmtDT(DATA.updatedAt)]);
    rows.push(['# 自算口径：纯净值涨幅，未含分红再投资与费用调整，与积金局「基金回报」期间与算法不同']);
    rows.push(['# 本站原则：仅对官方数字做汇总，不做任何推算、加权或补全']);
    rows.push(['# 历史序列如实呈现发行人官网发布：部分发行人早期历史含周末或休市日价格（官方即如此发布），本站以官网为准、不做过滤或插值']);
    return rows;
  }
  rows.push(['# 数据来源：香港积金局「強積金基金平台」' + (DATA.source ? '（' + DATA.source + '）' : '') + '；单位资产净值来源：各计划受托人官网']);
  rows.push(['# 积金局资料截至：' + (DATA.dataAsOf || '—') + '；本站同步时间：' + fmtDT(DATA.updatedAt)]);
  const navDates = (DATA.funds || []).filter((f) => f.navStatus === 'verified' && f.navAsOf).map((f) => f.navAsOf).sort();
  const nr = navDates.length ? navDates[0] + ' 至 ' + navDates[navDates.length - 1] : '—';
  rows.push(['# 净值估值日区间：' + nr + '（逐条与受托人官网核对）']);
  rows.push(['# 本站原则：仅对官方数字做汇总，不做任何推算、加权或补全']);
  rows.push(['# 历史序列如实呈现发行人官网发布：部分发行人早期历史含周末或休市日价格（官方即如此发布），本站以官网为准、不做过滤或插值']);
  return rows;
}

window.csvDownload = function (rows, filename) {
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  trackEvent('export');
};

/* ======================= 基金对比（全站共享） =======================
 * 对比列表存 sessionStorage：同一标签页内跨页（资料库 → 排名）保持，
 * 关闭标签页即清，不写用户设备长期存储。
 * 注意：ids() 只在数据已载入的页面做「存在性过滤」，避免在没有基金数据的页面
 * 把用户的对比列表误清空。
 */
const CMP_MAX = 6;
const CMPX = {
  key: 'mpf-cmp',
  ids() {
    try {
      const a = JSON.parse(sessionStorage.getItem(this.key) || '[]');
      if (!Array.isArray(a)) return [];
      return (DATA.funds && DATA.funds.length)
        ? a.filter((id) => DATA.funds.some((f) => f.id === id))
        : a;
    } catch (e) { return []; }
  },
  save(a) { try { sessionStorage.setItem(this.key, JSON.stringify(a)); } catch (e) {} },
  has(id) { return this.ids().indexOf(id) >= 0; },
  add(id) {
    const a = this.ids();
    if (a.indexOf(id) < 0) {
      if (a.length >= CMP_MAX) { mpfToast(TQ('最多同时对比 {n} 只基金', { n: CMP_MAX })); return false; }
      a.push(id);
    }
    this.save(a);
    return true;
  },
  remove(id) { this.save(this.ids().filter((x) => x !== id)); },
  toggle(id) { if (this.has(id)) { this.remove(id); return false; } return this.add(id); },
  clear() { this.save([]); },
};
window.CMPX = CMPX;

/** 轻提示 */
let _toastTimer = null;
function mpfToast(msg) {
  let el = document.getElementById('mpfToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mpfToast';
    el.className = 'mpf-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

/** 绘制对比栏（无此容器的页面自动跳过） */
function renderCmpBar() {
  const el = document.getElementById('cmp');
  if (!el) return;
  const ids = CMPX.ids();
  el.classList.toggle('show', ids.length > 0);
  const list = document.getElementById('cmpList');
  if (list) {
    list.innerHTML = ids.map((id) => {
      const f = DATA.funds.find((y) => y.id === id);
      return '<span class="cmp-item"><b>' + esc(f ? (f.fundBase || f.fund) : id) + '</b><span class="x" data-x="' + esc(id) + '">×</span></span>';
    }).join('');
    list.querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => {
      CMPX.remove(b.dataset.x);
      renderCmpBar();
      if (document.querySelector('#cmpModal.show')) window.openCmp();
    }));
  }
  const n = document.getElementById('cmpN');
  if (n) n.textContent = ids.length;
}
window.renderCmpBar = renderCmpBar;

window.clearCmp = function () { CMPX.clear(); renderCmpBar(); };
window.closeCmp = function () { const m = document.getElementById('cmpModal'); if (m) m.classList.remove('show'); };
window.openCmp = function () {
  const ids = CMPX.ids();
  if (!ids.length) return;
  if (ids.length < 2) { mpfToast(TT('请至少选择 2 只基金进行对比')); return; }
  const list = ids.map((id) => DATA.funds.find((f) => f.id === id)).filter(Boolean);
  const rows = [
    [TT('发行人（受托人）'), (x) => esc(x.trustee)],
    [TT('强积金计划'), (x) => esc(x.scheme)],
    [TT('基金种类'), (x) => esc(typeLabel(x.typeFull))],
    [TT('推出日期'), (x) => esc(x.launch)],
    [TQ('基金规模（{u}）', { u: TT('百万港元') }), (x) => '<span class="num">' + nf(x.size, 2) + '</span>'],
    [TT('风险级别'), (x) => riskTag(x.risk)],
    [TT('单位资产净值'), (x) => navCell(x)],
    [TT('近1年年率化回报'), (x) => '<span class="num ' + cls(x.ann1) + '">' + pct(x.ann1) + '</span>'],
    [TT('近5年年率化回报'), (x) => '<span class="num ' + cls(x.ann5) + '">' + pct(x.ann5) + '</span>'],
    [TT('近10年年率化回报'), (x) => '<span class="num ' + cls(x.ann10) + '">' + pct(x.ann10) + '</span>'],
    [TT('推出至今年率化回报'), (x) => '<span class="num ' + cls(x.annLaunch) + '">' + pct(x.annLaunch) + '</span>'],
    [TT('近1年累积回报'), (x) => '<span class="num ' + cls(x.cum1) + '">' + pct(x.cum1) + '</span>'],
    [TT('近5年累积回报'), (x) => '<span class="num ' + cls(x.cum5) + '">' + pct(x.cum5) + '</span>'],
    [TT('近5年最差年度'), (x) => '<span class="num ' + cls(x.worstYear) + '">' + pct(x.worstYear) + '</span>'],
    [TT('基金管理费 % p.a.'), (x) => '<span class="num">' + feeText(x.mgmtFee, x.feeMore && x.feeMore.mgmtFee) + '</span>'],
    [TT('受托人费／保管人费 %'), (x) => '<span class="num">' + feeText(x.trusteeFee, x.feeMore && x.feeMore.trusteeFee) + '</span>'],
    [TT('投资管理费 %'), (x) => '<span class="num">' + feeText(x.investFee, x.feeMore && x.feeMore.investFee) + '</span>'],
  ];
  const years = Object.keys(list[0].cal || {}).sort().reverse();
  years.forEach((y) => rows.push([TQ('{y} 年回报', { y: y }), (x) => '<span class="num ' + cls(x.cal[y]) + '">' + pct(x.cal[y]) + '</span>']));

  let h = '<table class="data"><thead><tr><th style="min-width:130px">' + TT('对比项') + '</th>' +
    list.map((x) => '<th>' + esc(x.fund) + '<div class="sub-line" style="font-weight:400">' + esc(x.trustee) + '</div></th>').join('') +
    '</tr></thead><tbody>';
  rows.forEach(([label, fn]) => {
    /* 2026-10-19：按行的语义判断「越大越好 / 越小越好」，标出最优值（绿色） */
    const nums = list.map((x) => {
      const raw = String(fn(x)).replace(/<[^>]+>/g, '').replace(/[+%,，\s]/g, '');
      const v = parseFloat(raw);
      return Number.isFinite(v) ? v : null;
    });
    const lowerBetter = /费|开支|波幅|风险|收费/.test(label);   /* 回撤是负数，越接近 0 越好 → 按“越大越好”处理 */
    const valid = nums.filter((v) => v != null);
    const best = valid.length > 1 ? (lowerBetter ? Math.min(...valid) : Math.max(...valid)) : null;
    h += '<tr><td style="font-weight:550;white-space:nowrap">' + label + '</td>';
    list.forEach((x, i) => {
      const mark = best != null && nums[i] === best ? ' cmp-best' : '';
      h += '<td class="r' + mark + '">' + fn(x) + '</td>';
    });
    h += '</tr>';
  });
  h += '<tr><td style="font-weight:550">' + TT('移除') + '</td>' +
    list.map((x) => '<td class="c"><button class="btn ghost sm" data-rm="' + esc(x.id) + '">' + TT('移除') + '</button></td>').join('') +
    '</tr>';
  h += '</tbody></table>';
  const body = document.getElementById('cmpBody');
  if (!body) return;
  /* 走势对比模块置顶（所选基金的净值走势，最多 6 条；详表在下方）
     2026-10-20：导出/分享从走势图上方移到弹窗右上角（与详情页一致），图内不再渲染标题行 */
  const tb = document.getElementById('cmpTrend');
  if (tb && window.TREND && TREND.mount) {
    tb.innerHTML = '';
    const items = list.slice(0, 8).map((x) => ({ type: 'fund', id: x.id }));
    if (items.length) {
      const meta2 = {};
      (DATA.funds || []).forEach((f) => { meta2[String(f.id)] = { trustee: f.trustee || '其他', type: f.type || '' }; });
      TREND.mount(tb, items, { bareHead: true, hideGoto: true, fundMeta: meta2 });
    }
  }
  body.innerHTML = h;
  body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    CMPX.remove(b.dataset.rm);
    renderCmpBar();
    if (CMPX.ids().length) window.openCmp(); else window.closeCmp();
  }));
  const m = document.getElementById('cmpModal');
  if (m) {
    /* 宽度随对比数量变化：2 只时收窄（不再固定 1100px 大片留白），最多 6 只时展宽 */
    const box = m.querySelector('.cmp-box');
    if (box) box.style.maxWidth = Math.min(1400, 240 + list.length * 200) + 'px';
    /* 右上角工具条：放大 / 分享 / 下载（对齐详情页表头按钮） */
    const hd = m.querySelector('.hd');
    if (hd && !hd.querySelector('.cmp-tools')) {
      const tools = document.createElement('div');
      tools.className = 'cmp-tools';
      tools.innerHTML =
        '<button type="button" class="btn ghost sm" data-cmp="expand" title="' + TT('在分析页放大查看这组对比') + '">⤢ ' + TT('放大') + '</button>' +
        '<button type="button" class="btn ghost sm" data-cmp="share" title="' + TT('复制包含这组对比的分享链接') + '">' + TT('分享') + '</button>' +
        '<button type="button" class="btn ghost sm" data-cmp="csv" title="' + TT('下载对比数据（CSV）') + '">' + TT('下载') + '</button>';
      const cx = hd.querySelector('.close-x');
      hd.insertBefore(tools, cx || null);
    }
    const tools = hd && hd.querySelector('.cmp-tools');
    if (tools) tools.onclick = (e) => {
      const b = e.target.closest('[data-cmp]');
      if (!b) return;
      const act = b.getAttribute('data-cmp');
      const ids2 = CMPX.ids();
      if (act === 'expand') {
        /* 2026-10-20：放大 = 同一份内容就地放大（容器变宽变高），不再跳到第三个页面。
           用户口径：「单纯放大不就是共用一套渲染」——所以这里只切一个 CSS 状态类。 */
        const on = m.classList.toggle('cmp-max');
        b.innerHTML = on ? '⤢ ' + TT('还原') : '⤢ ' + TT('放大');
        b.setAttribute('title', on ? TT('还原为普通窗口') : TT('放大查看这组对比'));
        try { document.body.style.overflow = on ? 'hidden' : ''; } catch (e2) {}
        return;
      }
      if (act === 'share') {
        const u = new URL(location.href);
        u.searchParams.set('cmp', ids2.join(','));
        u.searchParams.delete('fund');
        u.searchParams.delete('open');
        u.searchParams.delete('set');
        const url = u.toString();
        const done = () => mpfToast(TT('对比链接已复制'));
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => { window.prompt(TT('复制以下链接'), url); });
        else window.prompt(TT('复制以下链接'), url);
        return;
      }
      if (act === 'csv') {
        /* 2026-10-21：改用走势图工作簿（净值+涨跌幅+区间统计+截图），不再导出裸 CSV */
        if (window.__trendExportBook) { window.__trendExportBook(); return; }
        const head = [TT('对比项')].concat(list.map((x) => x.fund));
        const out = [head];
        rows.forEach(([label, fn]) => {
          out.push([label].concat(list.map((x) => String(fn(x)).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())));
        });
        window.csvDownload(out, 'mpf-compare-' + ids2.length + '.csv');
      }
    };
    m.classList.add('show');
  }
};

function bindCmpChrome() {
  const m = document.getElementById('cmpModal');
  if (m && !m.__bound) { m.__bound = 1; m.addEventListener('click', (e) => { if (e.target.id === 'cmpModal') window.closeCmp(); }); }
  renderCmpBar();
}

/* 2026-10-20：对比分享链接 ?cmp=id1,id2 —— 打开即还原对比表（此前分享的 ?set= 只还原走势图组合，
   对比表不会出现，链接分享出去对方看不到「对比」） */
(function initCmpLink() {
  let ids = [];
  try {
    const m = /[?&]cmp=([^&#]+)/.exec(location.search);
    if (!m) return;
    ids = decodeURIComponent(m[1]).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
  } catch (e) { return; }
  if (!ids.length) return;
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    if (!DATA || !DATA.count) { if (tries > 100) clearInterval(t); return; }
    clearInterval(t);
    ids.forEach((id) => { if (DATA.funds.some((f) => String(f.id) === String(id))) CMPX.add(id); });
    renderCmpBar();
    if (CMPX.ids().length >= 2) setTimeout(() => window.openCmp(), 120);
  }, 150);
})();

document.addEventListener('DOMContentLoaded', () => {
  const b = document.querySelector('.btn-refresh');
  if (b) b.addEventListener('click', () => refreshData(window.__onRefresh));
  const modal = document.querySelector('#modal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); window.closeCmp(); } });
  bindCmpChrome();
  /* 语言切换后：对比栏 + 计数/时间 + 口径说明（口径说明文字量最大，必须重绘，
     否则英文/繁体模式下仍显示简体——上一版就漏了这一处） */
  document.addEventListener('mpf:lang', () => {
    renderCmpBar();
    renderFriends();   // 友链标题/说明也是多语言文案，切换语言时一并重绘
    /* 2026-10-20：详情小窗开着时，切语言需整块重绘（否则仍是旧语言） */
    (function () {
      const m = document.querySelector('#modal');
      const t = document.querySelector('#mTitle');
      if (!m || !m.classList.contains('show') || !t || !DATA.count) return;
      const f = (DATA.funds || []).find((x) => (x.fundBase || x.fund) === t.textContent);
      if (f) window.openDetail(f.id);
    })();
    if (!DATA.count) return;
    const el = document.querySelector('.upd .t');
    if (el && DATA.updatedAt) {
      el.textContent = TQ('数据更新 {t}', { t: fmtDT(DATA.updatedAt) });   /* 2026-10-14：只显示本站更新时间 */
    }
    const cnt = document.querySelector('.upd .cnt');
    if (cnt) cnt.textContent = TQ('{n} 条基金', { n: DATA.count });
    renderSrcNote();
  });
});

/* ======================= 回到顶部按钮 ======================= */
function initToTop() {
  const btn = document.getElementById('toTop');
  if (!btn) return;
  const onScroll = () => btn.classList.toggle('show', window.scrollY > 420);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ======================= 页面切换过渡（轻微淡入 / 淡出） ======================= */
function initPageTransition() {
  const de = document.documentElement;
  de.classList.add('fx-ready');
  try {
    if (sessionStorage.getItem('mpf-fx-out')) {
      sessionStorage.removeItem('mpf-fx-out');
      de.classList.add('fx-enter');
      requestAnimationFrame(() => requestAnimationFrame(() => de.classList.remove('fx-enter')));
    }
  } catch (e) {}
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(href)) return;
    if (/^https?:/i.test(href) && href.indexOf(location.origin) !== 0) return;
    e.preventDefault();
    de.classList.add('fx-leave');
    try { sessionStorage.setItem('mpf-fx-out', '1'); } catch (err) {}
    setTimeout(() => { location.href = href; }, 110);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initToTop();
  initPageTransition();
});

/* ======================= 自绘悬浮说明（.mpf-tip） =======================
 * 为什么不用浏览器原生 title：触屏没有悬停、桌面要等约 1 秒、样式不可控。
 * 机制：任何带 [data-tip] 的元素 —— 鼠标悬停（延迟 160ms，防划过表格连弹）/
 * 点击（触屏可用，再点或点空白关闭）/ 键盘聚焦 显示统一浮层；滚动与 ESC 关闭。
 */
(function () {
  let el = null, cur = null, timer = null;
  function ensure() {
    if (!el) {
      el = document.createElement('div');
      el.className = 'mpf-tip';
      el.setAttribute('role', 'tooltip');
      document.body.appendChild(el);
    }
    return el;
  }
  let mx = 0, my = 0;
  document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; }, true);
  function place(a, atCursor) {
    const box = ensure();
    box.textContent = a.getAttribute('data-tip') || '';
    box.classList.add('show');
    box.style.left = '0px';
    box.style.top = '0px';
    const w = box.offsetWidth, h = box.offsetHeight;
    if (atCursor) {
      /* 2026-10-17：优先显示在光标附近（右下 14/16px），越界自动翻转/夹紧 */
      let left = mx + 14, top = my + 16;
      if (left + w > window.innerWidth - 8) left = mx - w - 14;
      if (top + h > window.innerHeight - 8) top = my - h - 14;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      box.style.left = left + 'px';
      box.style.top = top + 'px';
    } else {
      const r = a.getBoundingClientRect();
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = r.top - h - 9;
      if (top < 8) top = r.bottom + 9;
      box.style.left = left + 'px';
      box.style.top = top + 'px';
    }
    cur = a;
  }
  function hide() {
    clearTimeout(timer);
    if (el) el.classList.remove('show');
    cur = null;
  }
  document.addEventListener('mouseover', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!a || a === cur) return;
    clearTimeout(timer);
    timer = setTimeout(() => place(a, true), 160);
  });
  document.addEventListener('mouseout', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (a && a === cur) hide(); else clearTimeout(timer);
  });
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (a) { if (cur === a) hide(); else place(a, true); } else hide();
  });
  document.addEventListener('focusin', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (a) place(a);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.mpfHideTip = hide;
})();

/* 通用提示浮窗（2026-10-17）：数据不全等说明 */
window.mpfNotice = function (title, html) {
  var old = document.getElementById('mpfNotice');
  if (old) old.remove();
  var d = document.createElement('div');
  d.id = 'mpfNotice';
  d.className = 'mpfn-mask';
  d.innerHTML = '<div class="mpfn-card" role="dialog" aria-modal="true">' +
    '<div class="mpfn-hd"><span class="mpfn-ic">!</span>' + esc(title) + '</div>' +
    '<div class="mpfn-bd">' + html + '</div>' +
    '<div class="mpfn-ft"><button type="button" class="btn primary" data-mpfn-ok>知道了</button></div></div>';
  document.body.appendChild(d);
  /* 2026-10-21：关闭时统一移除 keydown（此前用「知道了」关闭会残留监听） */
  var esc2;
  var close = function () { d.remove(); if (esc2) document.removeEventListener('keydown', esc2); };
  d.addEventListener('click', function (e) {
    if (e.target === d || (e.target.closest && e.target.closest('[data-mpfn-ok]'))) close();
  });
  esc2 = function (e) { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc2);
};

/* ==========================================================
   2026-10-20 供款（定投）计算器
   悬浮按钮（全站常驻）+ 弹层；最多 3 只基金按占比组合；
   按月取月末净值累加份额，服务端 /api/dca 计算。
   ========================================================== */
/* 2026-10-24 修 C26：拆出 build 函数 + 监听 mpf:lang 重建弹层（此前一次性 innerHTML
   固化全部标签，切繁/英后计算器仍是简体）。重建会重置表单为默认值，可接受。 */
function initDCABuild() {

  const MAXF = 10;                 /* 2026-10-20：最多 10 只基金 */
  const MIN_MONTH = '2000-01';     /* 可选最早月份 */

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'dca-fab';
  fab.setAttribute('aria-label', TT('供款计算器'));
  fab.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 7h8M8 12h2M8 16h2M14 12h2M14 16h2"/></svg><span>' + TT('供款计算器') + '</span>';
  document.body.appendChild(fab);

  const wrap = document.createElement('div');
  wrap.className = 'dca-wrap';
  wrap.hidden = true;
  wrap.innerHTML =
    '<div class="dca-box" role="dialog" aria-modal="true">' +
      '<div class="dca-head"><b>' + TT('供款（定投）计算器') + '</b>' +
        '<button type="button" class="dca-x" aria-label="' + TT('关闭') + '">×</button></div>' +
      '<div class="dca-body">' +
        '<div class="dca-row">' +
          '<label>' + TT('每月供款（港元）') + '</label>' +
          '<input type="number" id="dcaAmt" min="100" step="100" value="2000">' +
          '<label>' + TT('第一次定投') + '</label>' +
          '<div class="dca-ym" id="dcaYm">' +
            '<button type="button" class="dca-ym-btn" id="dcaYmBtn" aria-expanded="false">' +
              '<span id="dcaYmText">2020 年 1 月</span><em>▾</em></button>' +
          '</div>' +
          '<label>' + TT('最后一次定投') + '</label>' +
          '<div class="dca-ym" id="dcaYmEnd">' +
            '<button type="button" class="dca-ym-btn" id="dcaYmEndBtn" aria-expanded="false">' +
              '<span id="dcaYmEndText">—</span><em>▾</em></button>' +
          '</div>' +
        '</div>' +
        /* 年月面板内联展开（放在行下方，避免被弹层裁剪）；两个选择器共用同一套渲染 */
        '<div class="dca-ym-pop" id="dcaYmPop" hidden>' +
          '<div class="dca-ym-years" id="dcaYmYears"></div>' +
          '<div class="dca-ym-months" id="dcaYmMonths"></div>' +
        '</div>' +
        '<div class="dca-ym-pop" id="dcaYmEndPop" hidden>' +
          '<div class="dca-ym-years" id="dcaYmEndYears"></div>' +
          '<div class="dca-ym-months" id="dcaYmEndMonths"></div>' +
        '</div>' +
        '<div class="dca-funds" id="dcaFunds"></div>' +
        '<div class="dca-actions">' +
          '<button type="button" class="btn ghost sm" id="dcaAdd">' + TQ('+ 添加基金（最多 {n} 只）', { n: MAXF }) + '</button>' +
          '<button type="button" class="btn sm" id="dcaGo">' + TT('开始计算') + '</button>' +
        '</div>' +
        '<p class="dca-tip">' + TT('按月内最后一个交易日的单位净值买入，不计分红再投资与费用；结果仅供示意，实际以受托人结单为准。') + '</p>' +
      '</div>' +
      '<div class="dca-result" id="dcaRes"></div>' +
      /* 基金选择面板（搜索 + 类别筛选，参照走势图弹窗） */
      '<div class="dca-picker" id="dcaPicker" hidden>' +
        '<div class="dca-pk-head"><span>' + TT('选择基金') + '</span>' +
          '<button type="button" class="dca-pk-x" aria-label="' + TT('关闭') + '">×</button></div>' +
        '<input type="search" class="dca-pk-search" id="dcaPkSearch" placeholder="' + TT('搜索基金名称 / 计划 / 受托人') + '">' +
        '<div class="dca-pk-matrix">' +
          '<div class="dca-pk-left" id="dcaPkTrustees"></div>' +
          '<div class="dca-pk-right">' +
            '<div class="dca-pk-cats" id="dcaPkCats"></div>' +
            '<div class="dca-pk-list" id="dcaPkList"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  /* 2026-10-20：计算中的全屏转圈（原「计算中…」小字不明显，用户反馈） */
  function showSpin(on) {
    let el = document.getElementById('dcaSpin');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dcaSpin';
      el.className = 'dca-spin';
      el.innerHTML = '<div class="dca-spin-box"><i></i><span>' + TT('正在计算供款结果…') + '</span></div>';
      document.body.appendChild(el);
    }
    el.hidden = !on;
    const go = wrap.querySelector('#dcaGo');
    if (go) go.disabled = !!on;
  }

  let FUNDS = null;
  let rows = [];
  let startYM = '2020-01';          /* 定投开始月份 */
  /* 2026-10-21：定投结束月份，默认上一个月（避免「本月到底算不算」的歧义） */
  const _nowD = new Date();
  const _prev = new Date(_nowD.getFullYear(), _nowD.getMonth() - 1, 1);
  let endYM = _prev.getFullYear() + '-' + String(_prev.getMonth() + 1).padStart(2, '0');

  /* ---------------- 基金数据 ---------------- */
  function ensureFunds() {
    if (FUNDS) return Promise.resolve(FUNDS);
    const f = (typeof window.fetchJSON === 'function')
      ? window.fetchJSON('/api/funds', 'funds')
      : fetch('/api/funds').then((r) => r.json());
    return f.then((j) => { FUNDS = (j && j.funds) || []; return FUNDS; });
  }

  /* ---------------- 年月选择器（两个实例共用同一套渲染） ---------------- */
  function makeYmPicker(cfg) {
    const text = wrap.querySelector(cfg.text);
    const pop = wrap.querySelector(cfg.pop);
    const years = wrap.querySelector(cfg.years);
    const months = wrap.querySelector(cfg.months);
    const btn = wrap.querySelector(cfg.btn);
    let pickYear = parseInt(cfg.get().slice(0, 4), 10);
    let monthsOpen = true;
    const isEnd = cfg.kind === 'end';

    function yearsList() {
      const nowY = new Date().getFullYear();
      const out = [];
      for (let y = nowY; y >= 2000; y--) out.push(y);
      return out;
    }
    function render() {
      const [sy, sm] = cfg.get().split('-').map(Number);
      text.textContent = TQ('{y} 年 {m} 月', { y: sy, m: sm });
      years.innerHTML = yearsList().map((y) =>
        '<button type="button" class="dca-ym-y' + (y === pickYear ? ' on' : '') + '" data-y="' + y + '">' + y + '</button>').join('');
      if (!monthsOpen) { months.hidden = true; return; }
      months.hidden = false;
      const now = new Date();
      months.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const disabled = (pickYear === now.getFullYear() && m > now.getMonth() + 1) || (pickYear === 2000 && m < 1);
        const on = (pickYear === sy && m === sm);
        return '<button type="button" class="dca-ym-m' + (on ? ' on' : '') + '" data-m="' + m + '"' +
          (disabled ? ' disabled' : '') + '>' + m + ' 月</button>';
      }).join('');
    }
    years.addEventListener('click', (e) => {
      const b = e.target.closest('.dca-ym-y');
      if (!b) return;
      e.stopPropagation();
      const y = parseInt(b.dataset.y, 10);
      if (y === pickYear) { monthsOpen = !monthsOpen; render(); return; }
      const curM = parseInt(cfg.get().slice(5, 7), 10) || 1;
      const now = new Date();
      const mm = (y === now.getFullYear()) ? Math.min(curM, now.getMonth() + 1) : curM;
      pickYear = y; monthsOpen = true;
      cfg.set(y + '-' + String(mm).padStart(2, '0'));
      render();
    });
    months.addEventListener('click', (e) => {
      const b = e.target.closest('.dca-ym-m');
      if (!b || b.disabled) return;
      cfg.set(pickYear + '-' + String(parseInt(b.dataset.m, 10)).padStart(2, '0'));
      pop.hidden = true;
      render();
      if (cfg.onPick) cfg.onPick();
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      /* 两个面板互斥 */
      wrap.querySelectorAll('.dca-ym-pop').forEach((el) => { if (el !== pop) el.hidden = true; });
      pop.hidden = !pop.hidden;
      if (!pop.hidden) { pickYear = parseInt(cfg.get().slice(0, 4), 10); monthsOpen = true; render(); }
    });
    return { render, pop, close() { pop.hidden = true; }, isOpen() { return !pop.hidden; } };
  }

  const ymStart = makeYmPicker({
    kind: 'start', text: '#dcaYmText', pop: '#dcaYmPop', years: '#dcaYmYears', months: '#dcaYmMonths', btn: '#dcaYmBtn',
    get: () => startYM, set: (v) => { startYM = v; },
    onPick: () => { if (endYM < startYM) { endYM = startYM; ymEnd.render(); } },
  });
  const ymEnd = makeYmPicker({
    kind: 'end', text: '#dcaYmEndText', pop: '#dcaYmEndPop', years: '#dcaYmEndYears', months: '#dcaYmEndMonths', btn: '#dcaYmEndBtn',
    get: () => endYM, set: (v) => { endYM = v; },
  });
  ymStart.render();
  ymEnd.render();
  /* 2026-10-24：document 级监听注册化，语言切换重建时先移除，防累积 */
  window.__dcaDocHandlers = window.__dcaDocHandlers || [];
  const onDocClick = (e) => {
    if (!ymStart.isOpen() && !ymEnd.isOpen()) return;
    if (e.target.closest('#dcaYm') || e.target.closest('#dcaYmPop') || e.target.closest('#dcaYmEnd') || e.target.closest('#dcaYmEndPop')) return;
    ymStart.close(); ymEnd.close();
  };
  window.__dcaDocHandlers.push({ type: 'click', fn: onDocClick });
  document.addEventListener('click', onDocClick);

  /* ---------------- 基金选择面板 ---------------- */
  const picker = wrap.querySelector('#dcaPicker');
  const pkSearch = wrap.querySelector('#dcaPkSearch');
  const pkCats = wrap.querySelector('#dcaPkCats');
  const pkList = wrap.querySelector('#dcaPkList');
  const pkTrustees = wrap.querySelector('#dcaPkTrustees');
  let pkTarget = null;      /* 正在为哪一行选基金 */
  let pkCat = '';
  let pkTrustee = '';       /* 2026-10-20：发行人筛选（与走势图选择面板同构） */

  function trusteeCounts(base) {
    const m = {};
    (base || FUNDS).forEach((x) => { const t = x.trustee || '其他'; m[t] = (m[t] || 0) + 1; });
    return m;
  }
  function catsOf(base) {
    const m = {};
    base.forEach((x) => { const k = x.type || ''; if (k) m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a]).map((k) => [k, m[k]]);
  }

  function renderPicker() {
    const q = (pkSearch.value || '').trim().toLowerCase();
    /* 左列：全部发行人（计数始终按全库，切换类别时不会跳数） */
    const tc = trusteeCounts(FUNDS);
    const tKeys = Object.keys(tc).sort((a, b) => tc[b] - tc[a]);
    pkTrustees.innerHTML =
      '<button type="button" class="dca-tside' + (pkTrustee === '' ? ' on' : '') + '" data-t="">' +
        TT('全部') + '<em>' + FUNDS.length + '</em></button>' +
      tKeys.map((t) => '<button type="button" class="dca-tside' + (pkTrustee === t ? ' on' : '') + '" data-t="' + esc(t) + '">' +
        esc(t) + '<em>' + tc[t] + '</em></button>').join('');

    /* 顶行：类别 chips（受发行人筛选影响） */
    const base = pkTrustee ? FUNDS.filter((x) => (x.trustee || '其他') === pkTrustee) : FUNDS;
    const cats = catsOf(base);
    if (pkCat && !cats.some((c) => c[0] === pkCat)) pkCat = '';   /* 换发行人后旧类别失效则回落 */
    pkCats.innerHTML = '<button type="button" class="dca-cat' + (pkCat === '' ? ' on' : '') + '" data-c="">' +
      TT('全部类别') + ' <i>' + base.length + '</i></button>' +
      cats.map(([k, n]) => '<button type="button" class="dca-cat' + (pkCat === k ? ' on' : '') +
        '" data-c="' + esc(k) + '">' + esc(typeLabel(k)) + ' <i>' + n + '</i></button>').join('');

    const list = base.filter((x) => {
      if (pkCat && x.type !== pkCat) return false;
      if (!q) return true;
      const hay = ((x.fundBase || x.fund || '') + ' ' + (x.scheme || '') + ' ' + (x.trustee || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    }).slice(0, 300);
    pkList.innerHTML = list.length
      ? list.map((x) => '<button type="button" class="dca-pk-item" data-id="' + x.id + '">' +
          '<span class="n">' + esc(x.fundBase || x.fund) + (x.unit ? '（' + esc(x.unit) + ' 类）' : '') + '</span>' +
          '<span class="s">' + esc(x.trustee || '') + ' · ' + esc(x.scheme || '') + '</span></button>').join('')
      : '<div class="dca-pk-empty">' + TT('没有符合条件的基金') + '</div>';
  }

  pkTrustees.addEventListener('click', (e) => {
    const b = e.target.closest('.dca-tside');
    if (!b) return;
    pkTrustee = b.getAttribute('data-t') || '';
    pkCat = '';
    renderPicker();
  });
  pkCats.addEventListener('click', (e) => {
    const b = e.target.closest('.dca-cat');
    if (!b) return;
    pkCat = b.dataset.c || '';
    renderPicker();
  });
  pkSearch.addEventListener('input', renderPicker);
  pkList.addEventListener('click', (e) => {
    const b = e.target.closest('.dca-pk-item');
    if (!b || !pkTarget) return;
    const f = FUNDS.find((x) => String(x.id) === b.dataset.id);
    pkTarget.id = String(b.dataset.id);
    pkTarget.btn.querySelector('.n').textContent = (f.fundBase || f.fund) + (f.unit ? '（' + f.unit + ' 类）' : '');
    pkTarget.btn.querySelector('.s').textContent = f.scheme || '';
    picker.hidden = true;
  });
  picker.querySelector('.dca-pk-x').addEventListener('click', () => { picker.hidden = true; });

  function openPicker(row) {
    pkTarget = row;
    picker.hidden = false;
    pkSearch.value = '';
    pkCat = '';
    pkTrustee = '';
    renderPicker();
    pkSearch.focus();
  }

  /* ---------------- 基金行 ---------------- */
  function addRow(fundId) {
    if (rows.length >= MAXF) return;
    const div = document.createElement('div');
    div.className = 'dca-frow';
    div.innerHTML =
      '<button type="button" class="dca-sel">' +
        '<span class="n">' + TT('选择基金') + '</span><span class="s"></span><em>▾</em></button>' +
      '<div class="dca-w"><input type="number" class="dca-wi" min="0" max="100" step="5" value="100"><span>%</span></div>' +
      '<button type="button" class="dca-del" title="' + TT('移除') + '">×</button>';
    wrap.querySelector('#dcaFunds').appendChild(div);
    const row = { div, btn: div.querySelector('.dca-sel'), wi: div.querySelector('.dca-wi'), id: '' };
    rows.push(row);
    div.querySelector('.dca-sel').addEventListener('click', () => openPicker(row));
    div.querySelector('.dca-del').addEventListener('click', () => {
      div.remove();
      rows = rows.filter((r) => r !== row);
      equalize();
    });
    if (rows.length > 1) equalize();
    /* 首只基金也要有删除按钮（用户反馈） */
    if (fundId && FUNDS) {
      const f = FUNDS.find((x) => String(x.id) === String(fundId));
      if (f) {
        row.id = String(f.id);
        row.btn.querySelector('.n').textContent = (f.fundBase || f.fund) + (f.unit ? '（' + f.unit + ' 类）' : '');
        row.btn.querySelector('.s').textContent = f.scheme || '';
      }
    }
    return row;
  }

  function equalize() {
    const n = rows.length;
    if (!n) return;
    const base = Math.floor(100 / n);
    rows.forEach((r, i) => { r.wi.value = i === n - 1 ? 100 - base * (n - 1) : base; });
  }

  function open(fundId) {
    wrap.hidden = false;
    document.body.classList.add('dca-open');
    ensureFunds().then(() => {
      if (!rows.length) addRow(fundId);
      else if (fundId && rows[0]) {
        const f = FUNDS.find((x) => String(x.id) === String(fundId));
        if (f) {
          rows[0].id = String(f.id);
          rows[0].btn.querySelector('.n').textContent = (f.fundBase || f.fund) + (f.unit ? '（' + f.unit + ' 类）' : '');
          rows[0].btn.querySelector('.s').textContent = f.scheme || '';
        }
      }
    });
  }
  function close() { wrap.hidden = true; document.body.classList.remove('dca-open'); }
  window.mpfOpenDCA = open;

  fab.addEventListener('click', () => open());
  wrap.querySelector('.dca-x').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const onDocKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!picker.hidden) { picker.hidden = true; return; }
    /* O4（2026-10-22 核查报告）：双月份选择器重构后 ymPop 已不存在，改为各自关闭 */
    if (ymStart.isOpen() || ymEnd.isOpen()) { ymStart.close(); ymEnd.close(); return; }
    if (!wrap.hidden) close();
  };
  window.__dcaDocHandlers.push({ type: 'keydown', fn: onDocKey });
  document.addEventListener('keydown', onDocKey);
  wrap.querySelector('#dcaAdd').addEventListener('click', () => {
    if (rows.length >= MAXF) return;
    addRow();
    if (rows.length >= MAXF) wrap.querySelector('#dcaAdd').disabled = true;
  });

  if (location.hash === '#dca' || /[?&]dca=1/.test(location.search)) open();

  /* ---------------- 计算 ---------------- */
  wrap.querySelector('#dcaGo').addEventListener('click', () => {
    const amount = parseFloat(wrap.querySelector('#dcaAmt').value) || 0;
    const res = wrap.querySelector('#dcaRes');
    const picked = rows.filter((r) => r.id);
    if (!amount) { res.innerHTML = '<div class="dca-err">' + TT('请填写每月供款额') + '</div>'; return; }
    if (!picked.length) { res.innerHTML = '<div class="dca-err">' + TT('请至少选择一只基金') + '</div>'; return; }
    const list = picked.map((r) => r.id + ':' + (parseFloat(r.wi.value) || 0)).join(',');
    res.innerHTML = '';
    showSpin(true);
    const url = '/api/dca?amount=' + amount + '&start=' + encodeURIComponent(startYM) + '&end=' + encodeURIComponent(endYM) + '&funds=' + encodeURIComponent(list);
    const ask = (retry) => fetch(url, { cache: 'no-store' }).then((r) => r.text().then((txt) => {
      /* 2026-10-21：冷启动时网关可能返回 HTML 错误页，直接 r.json() 会抛 Unexpected token '<' */
      try { return JSON.parse(txt); } catch (e) {
        if (retry) return new Promise((ok) => setTimeout(ok, 1200)).then(() => ask(false));
        throw new Error(TT('数据服务暂时不可用（返回了非预期内容），请稍后重试'));
      }
    }));
    ask(true)
      .then((j) => {
        showSpin(false);
        const money = (v) => (v < 0 ? '-' : '') + 'HK$' + Math.abs(v).toLocaleString('en-US');
        const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

        const renderResult = (allowPartial) => {
          const gaps = (j.gaps || []);
          const errs = (j.funds || []).filter((f) => f.error);
          let alertHTML = '';
          if (errs.length) {
            alertHTML += '<div class="dca-alert">' + TT('以下基金无法计算：') +
              errs.map((f) => '<b>' + esc(f.name || f.id) + '</b> ' + esc(f.error)).join('；') + '</div>';
          }
          /* 2026-10-21：区间内断档 → 先拦下，给「以可用月份计算」的选择 */
          if (gaps.length && !allowPartial) {
            alertHTML += '<div class="dca-alert">' +
              TT('以下基金在所选区间内缺少部分月份的日度净值，无法按完整区间计算：') + '<br>' +
              gaps.map((g) => {
                const why = g.tail
                  ? TQ('该基金 {m} 的净值尚未公布（月末价格还没出）', { m: j.end || g.firstMonth })
                  : (g.reason === 'late-launch'
                    ? TQ('该基金 {d} 才发行，因此只有 {f} 起的数据', { d: g.launch || '—', f: g.firstDate || g.firstMonth })
                    : TQ('该基金官网只提供 {f} 之后的净值（更早的未公布）', { f: g.firstDate || g.firstMonth }));
                return '<b>' + esc(g.name) + '</b>：' + why + '；所选区间 ' + esc(j.start || '') + ' ~ ' + esc(j.end || '') +
                  ' 中有 <b>' + g.gapMonths + '</b> 个月无数据。';
              }).join('<br>') +
              '<div style="margin-top:8px"><button type="button" class="btn sm" id="dcaPartial">' + TT('以可用月份计算') + '</button></div></div>';
            res.innerHTML = alertHTML;
            const pb = res.querySelector('#dcaPartial');
            if (pb) pb.addEventListener('click', () => renderResult(true));
            return;
          }
          if (!j.ok) {
            res.innerHTML = alertHTML + '<div class="dca-err">' + esc((j.funds && j.funds[0] && j.funds[0].error) || j.error || TT('该基金历史数据不足')) + '</div>';
            return;
          }
          /* 截止口径：各基金最新净值日不同时，按最早的那只截断并说明 */
          let cutNote = '';
          if (j.limitDate && j.limiter) {
            cutNote = '<div class="dca-note">' + TQ('由于「{f}」的净值只更新到 {d}，本次计算统一截止到 {d}。', { f: j.limiter, d: j.limitDate }) + '</div>';
          }
          res.innerHTML = alertHTML +
            '<div class="dca-kpis">' +
              '<div><span>' + TT('供款本金') + '</span><b>' + money(j.principal) + '</b></div>' +
              '<div><span>' + TT('当前市值') + '</span><b>' + money(j.value) + '</b></div>' +
              '<div><span>' + TT('收益金额') + '</span><b class="' + cls(j.gain) + '">' + money(j.gain) + '</b></div>' +
              '<div><span>' + TT('持仓收益率') + '</span><b class="' + cls(j.gain) + '">' + (j.rate == null ? '—' : (j.rate > 0 ? '+' : '') + j.rate + '%') + '</b></div>' +
            '</div>' +
            (function () {
              /* P1（复核报告）：各基金计价日可能不同，显示为区间而不是单日 */
              const dates = (j.funds || []).filter((f) => !f.error && f.lastDate).map((f) => f.lastDate).sort();
              const dTxt = !dates.length ? '—' : (dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + ' ~ ' + dates[dates.length - 1]);
              /* P1-b：区间终点用「所选结束月」，不再用被截断的 limitMonth */
              const bTxt = j.limitMonth || j.end || '';
              /* P2-1：多只基金时注明有几只缺期，避免误以为每只都投满 */
              const shortOnes = (j.funds || []).filter((f) => !f.error && f.gapMonths > 0).length;
              return '<div class="dca-note">' + TQ('共 {m} 期（{a} 至 {b}），净值日 {d}', {
                m: j.months, a: j.firstMonth || j.start || '', b: bTxt, d: dTxt }) +
                (shortOnes ? ' · ' + TQ('其中 {n} 只缺期，见下表', { n: shortOnes }) : '') + '</div>';
            })() +
            (j.warning ? '<div class="dca-alert">' + esc(j.warning) + '</div>' : '') +
            cutNote +
            (gaps.length ? '<div class="dca-note">' + TT('已按各基金实际可得的月份计算（部分基金存在缺月）。') + '</div>' : '') +
            /* 2026-10-23：明确口径——期末市值按「最新净值」估值，不是所选结束月份当月的净值 */
            '<div class="dca-note">' + TT('口径：每月按当月最后一个交易日的单位净值买入；期末市值按最新净值估值（不是结束月份当月净值），因此与「截至结束月」的算法会有小幅差异。') + '</div>' +
            '<table class="dca-tbl"><thead><tr><th>' + TT('基金') + '</th><th class="r">' + TT('占比') + '</th><th class="r">' + TT('供款本金') + '</th><th class="r">' + TT('当前市值') + '</th><th class="r">' + TT('收益率') + '</th></tr></thead><tbody>' +
            j.funds.map((f) => f.error
              ? '<tr><td>' + esc(f.id) + '</td><td colspan="4" class="muted">' + esc(f.error) + '</td></tr>'
              : '<tr><td>' + esc(f.name) + '<div class="dca-sub">' + esc(f.scheme) + (f.gapMonths > 0 ? ' · ' + TQ('缺 {n} 期', { n: f.gapMonths }) : '') + '</div></td>' +
                '<td class="r">' + f.weight + '%</td><td class="r">' + money(f.principal) + '</td>' +
                '<td class="r">' + money(f.value) + '</td>' +
                '<td class="r ' + cls(f.gain) + '">' + (f.rate == null ? '—' : (f.rate > 0 ? '+' : '') + f.rate + '%') + '</td></tr>').join('') +
            '</tbody></table>';
        };
        renderResult(false);
      })
      .catch((e) => {
        /* P0（2026-10-21 复核报告）：失败时必须关掉转圈，否则整页被遮罩锁死 */
        showSpin(false);
        const go = wrap.querySelector('#dcaGo');
        if (go) go.disabled = false;
        res.innerHTML = '<div class="dca-err">' + esc(e.message || e) + '</div>';
      });
  });

  ymStart.render(); ymEnd.render();

}
initDCABuild();
document.addEventListener('mpf:lang', () => {
  document.querySelectorAll('.dca-fab, .dca-wrap').forEach((n) => n.remove());
  (window.__dcaDocHandlers || []).forEach((h) => document.removeEventListener(h.type, h.fn));
  window.__dcaDocHandlers = [];
  initDCABuild();
});


/* 2026-10-23：抓取进行中时给用户一个可见提示（领导反馈：数据在更新但页面没提示，容易被误认为数据没更新）
   2026-10-23 二改：提示条放在页头下方（不再遮住导航），并带 × 关闭；关闭后本次会话内不再打扰。 */
(function updateBanner() {
  if (window.__updBanner) return;
  window.__updBanner = 1;
  var DISMISS = 'mpf-updbar-dismiss';
  function make() {
    var el = document.createElement('div');
    el.id = 'updBar';
    el.className = 'upd-bar';
    el.innerHTML = '<i></i><span class="t"></span>' +
      '<button type="button" class="x" aria-label="关闭">×</button>';
    el.querySelector('.x').addEventListener('click', function () {
      el.remove();
      document.body.classList.remove('has-updbar');
      try { sessionStorage.setItem(DISMISS, String(Date.now())); } catch (e) {}
    });
    document.body.appendChild(el);
    document.body.classList.add('has-updbar');
    return el;
  }
  function tick() {
    fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (st) {
        if (!st) return;
        var el = document.getElementById('updBar');
        var dismissed = 0;
        try { dismissed = +(sessionStorage.getItem(DISMISS) || 0); } catch (e) {}
        var quiet = dismissed && Date.now() - dismissed < 30 * 60 * 1000;
        if (st.refreshing && !quiet) {
          if (!el) el = make();
          var since = st.refreshingSince ? new Date(st.refreshingSince) : null;
          var hh = since ? String(since.getHours()).padStart(2, '0') + ':' + String(since.getMinutes()).padStart(2, '0') : '';
          el.querySelector('.t').textContent = TQ('正在从各发行人官网同步最新净值（{t} 开始），页面上的日期稍后会自动更新，无需手动刷新。', { t: hh });
        } else if (el) {
          el.remove();
          document.body.classList.remove('has-updbar');
        }
      })
      .catch(function () {});
  }
  tick();
  setInterval(tick, 30000);
})();
