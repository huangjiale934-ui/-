#!/usr/bin/env node
/* 从另一站补齐本地缺失的历史点（2026-11-13，用户要求脚本化）
 * ------------------------------------------------------------------
 * 场景：两站各自抓取，某些来源（etnet 日度、HKET 当日快照）在一天里不同时刻
 *       能抓到的最后一天不同 —— 云端 02:26 抓到 11-11，本机 09:51 只到 11-10，
 *       于是两站 funds 分布不同、breadth 差 1 个百分点。
 *       本轮是手工从云端拉下来补的，这个脚本把它固化。
 *
 * 安全原则（宁可少补，不可写坏）：
 *   · 只补「远端有、本地没有，且日期晚于本地末点」的点；
 *   · 本地已有的每一个点都必须与远端**数值完全相同**，否则整只跳过并告警
 *     （说明两边对同一历史点的口径不同，属于要人工判断的情况）；
 *   · 单只最多补 --max-add 个点（默认 5），超过说明远端做过历史回填，需人工确认；
 *   · 补完更新该只 hist 的 asOf / last，不碰其他字段。
 *
 * 用法：
 *   node tools/sync-hist-from-cloud.js                 # 默认从 GitHub 站补（公开、无码）
 *   node tools/sync-hist-from-cloud.js --from=wb       # 从 WorkBuddy 站补（读 data/wb-share.txt）
 *   node tools/sync-hist-from-cloud.js --dry           # 只看会补什么，不写盘
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'hist');

const arg = (k, d) => {
  const hit = process.argv.find((x) => x.startsWith('--' + k + '='));
  return hit ? hit.split('=')[1] : d;
};
const FROM = (arg('from', 'gh') || 'gh').toLowerCase();
const DRY = process.argv.includes('--dry');
const MAX_ADD = Number(arg('max-add', '5')) || 5;

function shareCode() {
  try { return fs.readFileSync(path.join(DATA, 'wb-share.txt'), 'utf8').trim(); } catch (e) { return ''; }
}

const BASES = {
  gh: 'https://huangjiale934-ui.github.io/-/api',
  wb: 'https://mpf-data.app.workbuddy.host/api',
};

function get(u) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, { headers: { 'User-Agent': 'mpf-sync/1.0' } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); reject(new Error('HTTP ' + r.statusCode + ' ' + u)); return; }
      let s = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { s += d; });
      r.on('end', () => resolve(s));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
  });
}

function apiUrl(p) {
  const base = BASES[FROM] || BASES.gh;
  let u = base + '/' + p;
  if (FROM === 'wb') {
    const c = shareCode();
    if (!c) throw new Error('缺少 data/wb-share.txt，无法访问 WorkBuddy 站');
    u += (u.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(c);
  }
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'cb=' + Date.now();
}

async function main() {
  console.log('[sync-hist] 来源 ' + FROM + (DRY ? '（--dry 不写盘）' : ''));
  const idxRaw = await get(apiUrl('hist-index.json'));
  const idx = JSON.parse(idxRaw);
  const remote = idx.funds || idx;
  const ids = Object.keys(remote);
  console.log('[sync-hist] 远端索引 ' + ids.length + ' 只');

  let pulled = 0;
  let added = 0;
  let skippedMismatch = 0;
  let skippedBig = 0;
  const detail = [];

  for (const id of ids) {
    const pf = path.join(HIST, id + '.json');
    if (!fs.existsSync(pf)) continue;                 /* 本地没有这只，交给常规抓取 */
    let loc;
    try { loc = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch (e) { continue; }
    const ls = loc.series || [];
    if (!ls.length) continue;
    const lastLocal = ls[ls.length - 1][0];
    const r = remote[id] || {};
    /* 远端末点不比本地新 → 跳过（绝大多数） */
    if (!r.asOf || r.asOf <= lastLocal) continue;

    let g;
    try { g = JSON.parse(await get(apiUrl('hist/' + id + '.json'))); } catch (e) {
      console.log('  ! ' + id + ' 拉取失败：' + e.message);
      continue;
    }
    pulled++;
    const gs = g.series || g || [];
    if (!gs.length) continue;

    /* 本地每个点都必须在远端存在且数值一致 */
    const mg = new Map(gs.map((x) => [x[0], x[1]]));
    let mismatch = null;
    for (const [d, v] of ls) {
      if (!mg.has(d)) { mismatch = d + '（远端缺）'; break; }
      if (Math.abs(mg.get(d) - v) > 1e-9) { mismatch = d + ' ' + v + '≠' + mg.get(d); break; }
    }
    if (mismatch) {
      skippedMismatch++;
      console.log('  ✘ ' + id + ' 历史口径不同：' + mismatch + ' → 跳过');
      continue;
    }

    const add = gs.filter((x) => x[0] > lastLocal);
    if (!add.length) continue;
    if (add.length > MAX_ADD) {
      skippedBig++;
      console.log('  ✘ ' + id + ' 远端多 ' + add.length + ' 个点（>' + MAX_ADD + '），疑似历史回填，需人工确认 → 跳过');
      continue;
    }

    const merged = ls.concat(add).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (!DRY) {
      loc.series = merged;
      loc.asOf = merged[merged.length - 1][0];
      loc.last = merged[merged.length - 1][1];
      fs.writeFileSync(pf, JSON.stringify(loc), 'utf8');
    }
    added += add.length;
    detail.push(id + ' +' + add.length + '（' + add.map((x) => x[0]).join(',') + '）');
  }

  console.log('[sync-hist] 远端较新的 ' + pulled + ' 只，补入 ' + added + ' 个点' +
    (skippedMismatch ? '，因口径不同跳过 ' + skippedMismatch + ' 只' : '') +
    (skippedBig ? '，因回填过多跳过 ' + skippedBig + ' 只' : ''));
  detail.slice(0, 20).forEach((d) => console.log('  + ' + d));
  if (detail.length > 20) console.log('  … 共 ' + detail.length + ' 只');
  if (!added && !skippedMismatch && !skippedBig) console.log('  ✔ 本地已与远端同步');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('[sync-hist] 失败：' + e.message); process.exit(1); });
