#!/usr/bin/env node
/* ============================================================
 * source-pages 维护工具（2026-10-30，5.0）
 * data/source-pages.json 是「人工核定」的净值来源官网表：
 *   merge-nav 每晚用它覆盖 navStat.sources.page；前端在 page 缺失时用它自愈。
 * 本工具负责它的维护闭环：
 *   node tools/source-pages.js --check            逐条探测 URL 可达性（403 反爬视为「疑似正常」）
 *   node tools/source-pages.js --audit            结构校验：match 唯一、URL 合法、cadence 枚举
 *   node tools/source-pages.js --fix              从 funds.json 自动发现「新出现但未登记」的来源，
 *                                                 用该组出现最多的 navSourceUrl 回填并写盘
 *   node tools/source-pages.js --add 'match=XX' 'url=https://...' 'cadence=daily'
 *                                                 新增发行人条目（同 match 覆盖）
 * 退出码：--audit/--check 有结构性错误时非 0（可接入发布闸门）。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'data', 'source-pages.json');
const FUNDS = path.join(ROOT, 'data', 'funds.json');
const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly'];
const argv = process.argv.slice(2);
const arg = (k) => {
  const hit = argv.find((a) => a.indexOf(k + '=') === 0);
  return hit ? hit.slice(k.length + 1) : '';
};

function load() {
  return JSON.parse(fs.readFileSync(PAGES, 'utf8'));
}
function save(j) {
  j.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(PAGES, JSON.stringify(j, null, 2) + '\n');
  console.log('[source-pages] 已写盘：' + j.sources.length + ' 个来源');
}

/* ---------- --audit：结构校验 ---------- */
function audit() {
  const j = load();
  const errs = [], warns = [];
  const seen = new Set();
  j.sources.forEach((s, i) => {
    const tag = '#' + (i + 1) + ' ' + (s.match || '(无 match)');
    if (!s.match) errs.push(tag + '：缺 match');
    if (seen.has(s.match)) errs.push(tag + '：match 重复');
    seen.add(s.match);
    if (!/^https:\/\//i.test(s.url || '')) errs.push(tag + '：URL 非法（须 https）→ ' + s.url);
    if (CADENCES.indexOf(s.cadence) < 0) errs.push(tag + '：cadence 非法（' + s.cadence + '）');
    if (!s.cadenceNote) warns.push(tag + '：缺 cadenceNote（友链上会没有频率文案）');
  });
  /* 与 funds.json 对账：登记的是否都还出现、是否有新来源未登记 */
  try {
    const fd = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
    const live = new Set();
    (fd.funds || []).forEach((f) => {
      const k = String(f.navSource || '').trim().split('｜')[0];
      if (k) live.add(k);
    });
    j.sources.forEach((s) => {
      if (s.friendOnly) return;   /* 友链补充条目（如 AMTD：净值走 etnet，funds.json 无对应来源名） */
      if (!Array.from(live).some((k) => k.indexOf(s.match) >= 0 || s.match.indexOf(k) >= 0)) {
        warns.push('登记来源「' + s.match + '」在当前 funds.json 中已无对应基金（是否已改名？）');
      }
    });
    live.forEach((k) => {
      if (!Array.from(seen).some((m) => k.indexOf(m) >= 0 || m.indexOf(k) >= 0)) {
        warns.push('未登记来源：' + k + '（跑 --fix 自动回填，或 --add 人工核定）');
      }
    });
  } catch (e) { warns.push('funds.json 对账失败：' + e.message); }

  console.log('[audit] 错误 ' + errs.length + '，提醒 ' + warns.length);
  errs.forEach((x) => console.log('  ✗ ' + x));
  warns.forEach((x) => console.log('  ! ' + x));
  if (process.send === undefined && errs.length) process.exitCode = 1;
  return errs.length === 0;
}

/* ---------- --check：可达性 ---------- */
function check() {
  const j = load();
  let bad = 0, soft = 0;
  console.log('[check] 逐条探测 ' + j.sources.length + ' 个来源（--proxy= 可选）');
  const proxy = arg('proxy');
  const env = proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {};
  (function next(i) {
    if (i >= j.sources.length) {
      console.log('[check] 完成：硬失败 ' + bad + '，反爬疑似正常 ' + soft);
      if (bad) process.exitCode = 1;
      return;
    }
    const s = j.sources[i];
    let code = 0;
    try {
      const args = ['-s', '-o', path.join(ROOT, 'tmp', '.sp-probe'), '-w', '%{http_code}', '--max-time', '20', '-A', 'Mozilla/5.0', '-L', s.url];
      if (proxy) args.splice(2, 0, '-x', proxy);
      try { fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true }); } catch (e) {}
      code = Number(execFileSync('curl', args, { encoding: 'utf8', env }).trim()) || 0;
    } catch (e) { code = 0; }
    const ok = code >= 200 && code < 400;
    const softOk = code === 403 || code === 429;   /* 反爬/限频：浏览器通常可开 */
    if (ok) console.log('  ✓ ' + code + ' ' + s.match);
    else if (softOk) { soft++; console.log('  ~ ' + code + ' ' + s.match + '（反爬疑似正常，人工复核）'); }
    else { bad++; console.log('  ✗ ' + (code || 'ERR') + ' ' + s.match + ' → ' + s.url); }
    setTimeout(() => next(i + 1), 300);
  })(0);
}

/* ---------- --fix：自动发现未登记来源并回填 ---------- */
function fix() {
  const j = load();
  const fd = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const groups = {};
  (fd.funds || []).forEach((f) => {
    const k = String(f.navSource || '').trim().split('｜')[0];
    if (!k) return;
    const g = groups[k] = groups[k] || { n: 0, urls: {} };
    g.n++;
    if (f.navSourceUrl) g.urls[f.navSourceUrl] = (g.urls[f.navSourceUrl] || 0) + 1;
  });
  let added = 0;
  Object.keys(groups).forEach((k) => {
    const known = j.sources.some((s) => k.indexOf(s.match) >= 0 || s.match.indexOf(k) >= 0);
    if (known) return;
    const urls = Object.entries(groups[k].urls).sort((a, b) => b[1] - a[1]);
    const url = urls.length ? urls[0][0] : '';
    if (!/^https:\/\//i.test(url)) {
      console.log('  ! 「' + k + '」有 ' + groups[k].n + ' 条但拿不到合法官网 URL（navSourceUrl 缺失），请 --add 人工核定');
      return;
    }
    j.sources.push({ match: k, url: url, cadence: 'daily', cadenceNote: '每日（自动回填，请人工复核频率）' });
    added++;
    console.log('  + 已回填「' + k + '」（' + groups[k].n + ' 条）→ ' + url);
  });
  if (added) save(j); else console.log('[fix] 无需回填：所有来源均已登记');
}

/* ---------- --add ---------- */
function add() {
  const match = arg('match'), url = arg('url'), cadence = arg('cadence') || 'daily';
  const note = arg('note') || ({ daily: '每日', weekly: '每周', monthly: '月更', quarterly: '季更' }[cadence] || '');
  if (!match || !/^https:\/\//i.test(url)) {
    console.error('用法：node tools/source-pages.js --add \'match=发行人\' \'url=https://...\' [cadence=daily|weekly|monthly|quarterly] [note=频率文案]');
    process.exitCode = 1;
    return;
  }
  if (CADENCES.indexOf(cadence) < 0) {
    console.error('cadence 必须是 ' + CADENCES.join('/'));
    process.exitCode = 1;
    return;
  }
  const j = load();
  const hit = j.sources.find((s) => s.match === match);
  if (hit) {
    hit.url = url; hit.cadence = cadence; hit.cadenceNote = note;
    console.log('[add] 已覆盖「' + match + '」→ ' + url);
  } else {
    j.sources.push({ match: match, url: url, cadence: cadence, cadenceNote: note });
    console.log('[add] 已新增「' + match + '」→ ' + url);
  }
  save(j);
}

/* ---------- 入口 ---------- */
(function main() {
  if (argv.includes('--check')) return check();
  if (argv.includes('--fix')) return fix();
  if (argv.includes('--add')) return add();
  return audit();   /* 默认：结构校验 */
})();
