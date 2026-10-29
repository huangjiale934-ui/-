#!/usr/bin/env node
/**
 * 链接巡检（2026-10-29，5.0 新增）
 *
 * 背景：2026-10-29 发现「友情链接」点宏利会跳回本站——根因是 navStat.sources 只有 n/asOf，
 * 没有 page，前端 `s.page || s.url` 得到空字符串，<a href=""> 被浏览器当成当前页。
 * 上线前的回归只检查了「存在 .friend-links」，没检查 href 是否有效，所以没拦住。
 *
 * 本脚本做三件事（结构问题必失败，网络问题只告警）：
 *   1) 数据层：/data/funds.json 的 navStat.sources 每一条都必须有 http(s) page，且 n 为数字；
 *   2) 页面层：public/*.html 里的 <a href> 不得为空、不得是 javascript:、不得出现 undefined；
 *   3) 网络层（--net）：逐条请求外链，非 2xx/3xx 只告警（多数受托人官网有反爬，403 属正常）。
 *
 * 用法：
 *   node tools/link-audit.js          # 结构检查（daily.sh 默认调用，秒级）
 *   node tools/link-audit.js --net    # 追加网络可达性检查（约 1–2 分钟）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NET = process.argv.includes('--net');
const fails = [];
const warns = [];

/* ---------- 1. 数据层 ---------- */
let sources = [];
let pageMap = [];
try {
  pageMap = (JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source-pages.json'), 'utf8')).sources) || [];
} catch (e) {
  warns.push('source-pages.json 缺失或无法解析：' + e.message);
}
const cadenceOf = (name) => pageMap.find((x) => name.indexOf(x.match) >= 0) || null;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const daysOld = (d) => (d ? Math.round((new Date(today) - new Date(d)) / 864e5) : 9999);
const LIMIT = { daily: 10, monthly: 50, quarterly: 130 };

try {
  const fd = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'funds.json'), 'utf8'));
  sources = (fd.navStat && fd.navStat.sources) || [];
  if (!sources.length) fails.push('navStat.sources 为空');
  sources.forEach((s, i) => {
    const name = s.name || s.label || ('#' + i);
    if (!/^https?:\/\//i.test(String(s.page || s.url || ''))) fails.push('来源缺官网地址：' + name);
    if (!(typeof s.n === 'number' && s.n > 0)) fails.push('来源条数 n 非数字：' + name + '（' + s.n + '）');
    if (/undefined/.test(String(s.label || s.name || ''))) fails.push('来源名称含 undefined：' + name);
    /* 2026-10-29（5.0）：按来源更新频率判断是否超期——
       「网站没更新」和「发行人不发布」必须分清，超期只告警，由人判断。 */
    const cad = cadenceOf(name);
    if (cad && cad.cadence && LIMIT[cad.cadence]) {
      const old = daysOld(s.asOf);
      if (old > LIMIT[cad.cadence]) {
        warns.push('来源超期：' + name + ' 最新 ' + (s.asOf || '无') + '，已 ' + old + ' 天（' + cad.cadenceNote + '，阈值 ' + LIMIT[cad.cadence] + ' 天）');
      }
    }
  });
} catch (e) {
  fails.push('读取 data/funds.json 失败：' + e.message);
}

/* ---------- 2. 页面层 ---------- */
const htmlFiles = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => /\.html$/.test(f));
const externals = new Map();
htmlFiles.forEach((f) => {
  const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const re = /<a\b[^>]*href="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!href) { fails.push(f + '：存在空 href 的 <a>'); continue; }
    if (/^javascript:/i.test(href)) { fails.push(f + '：href 为 javascript:（' + href + '）'); continue; }
    if (/undefined|null/i.test(href)) { fails.push(f + '：href 含 undefined/null（' + href + '）'); continue; }
    if (/^https?:\/\//i.test(href)) externals.set(href, f);
  }
});

/* 前端模板拼出的外链也要过一遍：href="' + esc(...) + '" 这类写法无法直接取，
   改查「来源渲染函数」是否仍存在空 href 分支 */
const common = fs.readFileSync(path.join(ROOT, 'public', 'common.js'), 'utf8');
if (/<a href="' \+ esc\(a\[1\]\)/.test(common)) warns.push('common.js 的 li() 仍直接拼 href，建议保留空值保护');
if (!/fr-nolink/.test(common)) warns.push('common.js 缺少「无官网链接」的降级渲染标记');

/* ---------- 3. 网络层 ---------- */
function probe(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const req = lib.request(url, { method: 'GET', timeout: 9000, headers: { 'user-agent': 'Mozilla/5.0 (link-audit)' } }, (res) => {
      res.resume();
      resolve({ url, code: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ url, code: 0, err: 'timeout' }); });
    req.on('error', (e) => resolve({ url, code: 0, err: e.code || e.message }));
    req.end();
  });
}

(async function () {
  if (NET) {
    const list = Array.from(externals.keys());
    const results = await Promise.all(list.map(probe));
    results.forEach((r) => {
      const ok = r.code >= 200 && r.code < 400;
      if (!ok) warns.push('外链不可达（' + (r.err || r.code) + '）：' + r.url);
    });
    console.log('[link-audit] 网络检查 ' + list.length + ' 条外链');
  }

  const uniqFails = Array.from(new Set(fails));
  /* 2026-10-29（5.0）：每次巡检把结果落盘。下一轮会话开工先读它，有 fails/warns 就直接修。 */
  try {
    const report = {
      generatedAt: new Date().toISOString(),
      tool: 'link-audit',
      ok: uniqFails.length === 0,
      fails: uniqFails,
      warns: Array.from(new Set(warns)),
      sourceCount: sources.length,
      externalCount: externals.size,
      networkChecked: NET,
      note: 'fails 为结构性错误（必须修）；warns 为可达性或超期提示（需判断是否为发行人未发布）',
    };
    fs.writeFileSync(path.join(ROOT, 'data', 'patrol-report.json'), JSON.stringify(report, null, 2));
  } catch (e) {}
  const uniqWarns = Array.from(new Set(warns));
  uniqWarns.forEach((w) => console.log('  ! ' + w));
  if (uniqFails.length) {
    uniqFails.forEach((f) => console.log('  ✘ ' + f));
    console.log('[link-audit] 失败 ' + uniqFails.length + ' 项，告警 ' + uniqWarns.length + ' 项');
    process.exit(1);
  }
  console.log('[link-audit] 通过：' + sources.length + ' 个净值来源、' + htmlFiles.length + ' 个页面、' + externals.size + ' 条外链，无空链接/空地址');
})();
