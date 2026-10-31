(function (w) {
var HANT = w.HANT = {};
var EN = w.EN = {};
var DICT = { 'zh-Hans': {}, 'zh-Hant': HANT, 'en': EN };
var ORDER = ['zh-Hans', 'zh-Hant', 'en'];
var STORE = 'mpf-lang';

function detect() {
/* 2026-10-20：支持 ?lang=en / zh-Hant 深链（便于分享指定语言页面） */
try {
var q = /[?&]lang=([a-zA-Z-]+)/.exec(location.search);
if (q) { var m = { 'en': 'en', 'zh-Hant': 'zh-Hant', 'zh-Hans': 'zh-Hans', 'zh-TW': 'zh-Hant', 'zh-HK': 'zh-Hant' }; if (m[q[1]]) return m[q[1]]; }
} catch (e) {}
try {
var s = localStorage.getItem(STORE);
if (s && DICT[s]) return s;
} catch (e) {}
var n = (navigator.language || 'zh-CN');
if (/^en/i.test(n)) return 'en';
if (/hant|tw|hk|mo/i.test(n)) return 'zh-Hant';
return 'zh-Hans';
}

var cur = detect();
w.__t2sActive = (cur === 'zh-Hans');

function t(key, fallback) {
var d = DICT[cur] || {};
var v = d[key];
if (v == null) v = fallback != null ? fallback : key;
/* 2026-10-31（领导要求）：简体模式彻底繁转简——数据原文（基金名/新闻/积金局文案）也转换 */
if (cur === 'zh-Hans' && w.t2s) v = w.t2s(v);
return v;
}

function applyI18n(root) {
var r = root || document;
var nodes = r.querySelectorAll('[data-i18n]');
for (var i = 0; i < nodes.length; i++) {
var k = nodes[i].getAttribute('data-i18n');
if (k) {
nodes[i].textContent = t(k);
/* 2026-10-31：ⓘ 悬浮文案随语言切换（data-tip 与 data-i18n 同键时才生效） */
var _dt = nodes[i].getAttribute('data-tip');
if (_dt && t(_dt) !== _dt) nodes[i].setAttribute('data-tip', t(_dt));
}
}
var phs = r.querySelectorAll('[data-i18n-ph]');
for (var j = 0; j < phs.length; j++) {
var pk = phs[j].getAttribute('data-i18n-ph');
if (pk) phs[j].setAttribute('placeholder', t(pk));
}
var tts = r.querySelectorAll('[data-i18n-title]');
for (var m = 0; m < tts.length; m++) {
var tk = tts[m].getAttribute('data-i18n-title');
if (tk) tts[m].setAttribute('title', t(tk));
}
var parts = r.querySelectorAll('[data-i18n-parts]');
for (var p = 0; p < parts.length; p++) {
var walker = document.createTreeWalker(parts[p], NodeFilter.SHOW_TEXT, null, false);
var tn;
while ((tn = walker.nextNode())) {
if (tn.__i18nRaw === undefined) tn.__i18nRaw = tn.nodeValue;
var raw = tn.__i18nRaw;
var trim = raw.replace(/^\s+|\s+$/g, '');
if (!trim) continue;
tn.nodeValue = raw.replace(trim, t(trim));
}
}
}

/* 2026-10-21：繁体/英文字典改为按需加载（i18n.js 从 181KB 降到 7KB） */
function ensureDict(code, cb) {
if (code === 'zh-Hans') { cb(); return; }
var flag = code === 'zh-Hant' ? '__hantLoaded' : '__enLoaded';
if (window[flag]) { cb(); return; }
var sc = document.createElement('script');
sc.src = (code === 'zh-Hant' ? 'i18n-hant.js' : 'i18n-en.js') + '?v=20261101c';
sc.onload = function () { window[flag] = 1; cb(); };
sc.onerror = function () { cb(); };
document.head.appendChild(sc);
}

function setLang(code) {
if (!DICT[code]) return;
cur = code;
w.LANG = code;   /* 2026-10-22 修：切换器走的是 setLang，原实现只改内部 cur，window.LANG 会一直停在初始值 */
w.__t2sActive = (code === 'zh-Hans');   /* 2026-10-31：简体模式繁转简开关 */
try { localStorage.setItem(STORE, code); } catch (e) {}
ensureDict(code, function () {
document.documentElement.setAttribute('lang', code === 'en' ? 'en' : code === 'zh-Hant' ? 'zh-Hant' : 'zh-CN');
applyI18n(document);
syncSwitcher();
try { document.dispatchEvent(new CustomEvent('mpf:lang', { detail: { lang: code } })); } catch (e) {}
});
}

function syncSwitcher() {
var btns = document.querySelectorAll('.lang-sw button');
for (var i = 0; i < btns.length; i++) {
btns[i].classList.toggle('on', btns[i].getAttribute('data-lang') === cur);
}
}

function initSwitcher() {
var sw = document.getElementById('langSw');
if (!sw) return;
sw.addEventListener('click', function (e) {
var b = e.target.closest ? e.target.closest('button[data-lang]') : null;
if (b) setLang(b.getAttribute('data-lang'));
});
syncSwitcher();
}

w.MPF_LANGS = ORDER;
w.LANG = cur;
w.t = t;
w.applyI18n = applyI18n;
w.setLang = function (c) { w.LANG = c; setLang(c); };
w.getLang = function () { return cur; };

document.addEventListener('DOMContentLoaded', function () {
document.documentElement.setAttribute('lang', cur === 'en' ? 'en' : cur === 'zh-Hant' ? 'zh-Hant' : 'zh-CN');
ensureDict(cur, function () {
applyI18n(document);
/* 2026-10-23 修：字典是异步加载的，首屏各模块（导航、徽标、走势面板）在字典到位前就渲染完了，
   英文/繁体直链会残留中文。字典就位后再广播一次语言事件，让各模块按当前语言重绘。 */
try { document.dispatchEvent(new CustomEvent('mpf:lang', { detail: { lang: cur, initial: true } })); } catch (e) {}
});
initSwitcher();
});
})(window);

window.TYPE_I18N = {
'保證基金': { s: '保证基金', e: 'Guaranteed Fund' },
'債券基金': { s: '债券基金', e: 'Bond Fund' },
'混合資產基金': { s: '混合资产基金', e: 'Mixed Assets Fund' },
'股票基金': { s: '股票基金', e: 'Equity Fund' },
'貨幣市場基金 — 不包括強積金保守基金': { s: '货币市场基金 — 不包括强积金保守基金', e: 'Money Market Fund (other than MPF Conservative Fund)' },
'貨幣市場基金 — 強積金保守基金': { s: '货币市场基金 — 强积金保守基金', e: 'MPF Conservative Fund' },
'21% 至 40% 股票': { s: '21% 至 40% 股票', e: '21% to 40% Equity' },
'41% 至 60% 股票': { s: '41% 至 60% 股票', e: '41% to 60% Equity' },
'61% 至 80% 股票': { s: '61% 至 80% 股票', e: '61% to 80% Equity' },
'81% 至 100% 股票': { s: '81% 至 100% 股票', e: '81% to 100% Equity' },
'中國股票基金': { s: '中国股票基金', e: 'China Equity Fund' },
'亞洲債券基金': { s: '亚洲债券基金', e: 'Asia Bond Fund' },
'亞洲股票基金': { s: '亚洲股票基金', e: 'Asia Equity Fund' },
'人民幣債券基金': { s: '人民币债券基金', e: 'RMB Bond Fund' },
'大中華股票基金': { s: '大中华股票基金', e: 'Greater China Equity Fund' },
'日本股票基金': { s: '日本股票基金', e: 'Japan Equity Fund' },
'未分類混合資產基金': { s: '未分类混合资产基金', e: 'Uncategorized Mixed Asset Fund' },
'未分類股票基金': { s: '未分类股票基金', e: 'Uncategorized Equity Fund' },
'歐洲股票基金': { s: '欧洲股票基金', e: 'Europe Equity Fund' },
'港元債券基金': { s: '港元债券基金', e: 'Hong Kong Dollar Bond Fund' },
'環球債券基金': { s: '环球债券基金', e: 'Global Bond Fund' },
'環球股票基金': { s: '环球股票基金', e: 'Global Equity Fund' },
'美國股票基金': { s: '美国股票基金', e: 'United States Equity Fund' },
'預設投資策略-65歲後基金': { s: '预设投资策略-65岁后基金', e: 'Default Investment Strategy - Age 65 Plus Fund' },
'預設投資策略-核心累積基金': { s: '预设投资策略-核心累积基金', e: 'Default Investment Strategy - Core Accumulation Fund' },
'香港股票基金': { s: '香港股票基金', e: 'Hong Kong Equity Fund' },
'香港股票基金（追蹤指數）': { s: '香港股票基金（追踪指数）', e: 'Hong Kong Equity Fund (Index Tracking)' },
'DIS 核心累積基金': { s: 'DIS 核心累积基金', e: 'DIS Core Accumulation Fund' },
'DIS 65歲後基金': { s: 'DIS 65岁后基金', e: 'DIS Age 65 Plus Fund' },
'其他': { s: '其他', e: 'Others' },
'強積金保守基金': { s: '强积金保守基金', e: 'MPF Conservative Fund' },
'貨幣市場基金（非保守）': { s: '货币市场基金（非保守）', e: 'Money Market Fund (non-conservative)' },
'貨幣市場（保守）': { s: '货币市场（保守）', e: 'MPF Conservative Fund' },
'貨幣市場（非保守）': { s: '货币市场（非保守）', e: 'Money Market Fund (non-conservative)' },
'股票': { s: '股票', e: 'Equity' },
'混合資產': { s: '混合资产', e: 'Mixed' },
'保證': { s: '保证', e: 'Guaranteed' },
'債券': { s: '债券', e: 'Bond' },
'貨幣保守': { s: '货币（保守）', e: 'MMF (Cons.)' },
'貨幣非保守': { s: '货币（非保守）', e: 'MMF (Non-cons.)' },
};

window.typeLabel = function (v) {
if (v == null) return '';
var lang = (typeof window.getLang === 'function') ? window.getLang() : 'zh-Hans';
if (lang === 'zh-Hant') return v;   // 繁体模式直接使用数据原值
var T = window.TYPE_I18N;
var direct = T[v];
if (direct) return lang === 'en' ? (direct.e || v) : (direct.s || v);
var i = v.indexOf(' - ');            // 全名（大类 - 细类）动态组合
if (i > 0) {
var a = v.slice(0, i), b = v.slice(i + 3);
var A = T[a], B = T[b];
if (A || B) {
var fa = A ? (lang === 'en' ? A.e : A.s) : a;
var fb = B ? (lang === 'en' ? B.e : B.s) : b;
return fa + ' - ' + fb;
}
}
return v;
};
