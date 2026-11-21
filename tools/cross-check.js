#!/usr/bin/env node
/* 两站交叉核验 → 差异清单（tools/cross-check.js）—— 2026-11-22
 * ------------------------------------------------------------------
 * 用户要求（2026-11-22）：本机不再向 GitHub 站推数据，两站各自独立更新；
 * 但必须自己核验「有哪些数据不一致」，说明原因，并让对方自己去更正。
 *
 * 做法：只读两边公开接口（A 站带分享码），逐只比对 nav / navAsOf，
 * 把差异分成四类并写 data/cross-check.json（前端页脚「核对」第二行直接读它）：
 *   lagB    B 站比 A 站旧（≤3 个自然日）—— 抓取时点不同，正常
 *   aheadB  B 站比 A 站新 —— A 站该重抓（或 B 站提前发布了）
 *   valueDiff 同一净值日但数值不同 —— 必须复核，不允许互覆盖
 *   onlyA / onlyB 只在一侧存在 —— 结构性异常
 *
 * 用法：
 *   node tools/cross-check.js            # 打印摘要并写 data/cross-check.json
 *   node tools/cross-check.js --dry      # 只打印
 *   node tools/cross-check.js --json     # 输出完整 JSON
 * 退出码：0 正常；1 存在 valueDiff / 结构性异常
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let SHARE = process.env.MPF_SHARE || '';
if (!SHARE) { try { SHARE = fs.readFileSync(path.join(ROOT, 'data', 'wb-share.txt'), 'utf8').trim(); } catch (e) {} }
const A = (process.env.MPF_SITE_A || 'https://mpf-data.app.workbuddy.host').replace(/\/$/, '');
const B = (process.env.MPF_SITE_B || 'https://huangjiale934-ui.github.io/-').replace(/\/$/, '');
const DRY = process.argv.includes('--dry');
const JSON_OUT = process.argv.includes('--json');

const withCode = (u) => (SHARE ? u + (u.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + SHARE : u);

async function getJson(url, tries = 2) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'cache-control': 'no-store' } });
      const t = await r.text();
      if (r.ok && /json/.test(r.headers.get('content-type') || '') ) return JSON.parse(t);
      // GitHub Pages 的 /api/xxx 是 404 HTML，真正的文件是 /api/xxx.json
      if (!/\.json$/.test(url)) {
        const r2 = await fetch(url.replace(/\/api\/([a-z-]+)$/, '/api/$1.json'), { signal: AbortSignal.timeout(25000) });
        const t2 = await r2.text();
        if (r2.ok) return JSON.parse(t2);
      }
      last = 'HTTP ' + r.status;
    } catch (e) { last = e.message; }
  }
  throw new Error(last);
}

(async () => {
  const out = { at: Date.now(), atHKT: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), a: {}, b: {}, summary: {}, diffs: [], verdict: 'ok', note: '' };
  try {
    const [sa, sb, fa, fb] = await Promise.all([
      getJson(withCode(A + '/api/status')),
      getJson(B + '/api/status.json'),
      getJson(withCode(A + '/api/funds')),
      getJson(B + '/api/funds.json'),
    ]);
    const pack = (s, f) => ({
      count: s.count, navLatest: s.navLatest || '', dataAsOf: s.dataAsOf || '', updatedAt: s.updatedAt || 0,
      funds: (f.funds || []).map((x) => ({ id: String(x.id), name: x.fund || x.name || '', nav: x.nav, asOf: x.navAsOf || '' })),
    });
    const pa = pack(sa, fa), pb = pack(sb, fb);
    out.a = { count: pa.count, navLatest: pa.navLatest, dataAsOf: pa.dataAsOf, updatedAt: pa.updatedAt };
    out.b = { count: pb.count, navLatest: pb.navLatest, dataAsOf: pb.dataAsOf, updatedAt: pb.updatedAt };

    const mb = new Map(pb.funds.map((x) => [x.id, x]));
    const ma = new Map(pa.funds.map((x) => [x.id, x]));
    let lagB = 0, aheadB = 0, valueDiff = 0, onlyA = 0, onlyB = 0;
    const days = (x, y) => Math.round((new Date(y) - new Date(x)) / 864e5);
    pa.funds.forEach((x) => {
      const y = mb.get(x.id);
      if (!y) { onlyA++; out.diffs.push({ id: x.id, name: x.name, kind: 'onlyA' }); return; }
      if (x.asOf && y.asOf && x.asOf !== y.asOf) {
        if (y.asOf > x.asOf) { aheadB++; out.diffs.push({ id: x.id, name: x.name, kind: 'aheadB', a: x.asOf, b: y.asOf }); }
        else if (days(y.asOf, x.asOf) <= 3) lagB++;
        else { lagB++; out.diffs.push({ id: x.id, name: x.name, kind: 'lagB', a: x.asOf, b: y.asOf }); }
        return;
      }
      if (x.asOf && y.asOf && x.asOf === y.asOf && x.nav != null && y.nav != null && Math.abs(Number(x.nav) - Number(y.nav)) > 0.00005) {
        valueDiff++;
        out.diffs.push({ id: x.id, name: x.name, kind: 'valueDiff', a: x.nav, b: y.nav, asOf: x.asOf });
      }
    });
    pb.funds.forEach((y) => { if (!ma.get(y.id)) { onlyB++; out.diffs.push({ id: y.id, name: y.name, kind: 'onlyB' }); } });

    out.summary = { fundsA: pa.funds.length, fundsB: pb.funds.length, lagB, aheadB, valueDiff, onlyA, onlyB,
      same: Math.min(pa.funds.length, pb.funds.length) - lagB - aheadB - valueDiff };
    const hard = valueDiff + onlyA + onlyB;
    out.verdict = hard ? 'attention' : (aheadB ? 'aheadB' : 'ok');
    out.note = hard
      ? '存在同日不同值/结构性差异，需人工复核（不自动互相覆盖）'
      : (aheadB ? 'B 站有 ' + aheadB + ' 只比 A 站新，A 站下一班重抓即可' : '两站一致（允许 ≤3 日时点差）');
  } catch (e) {
    out.verdict = 'error';
    out.note = '核验失败：' + e.message;
  }

  if (!DRY) {
    try { fs.writeFileSync(path.join(ROOT, 'data', 'cross-check.json'), JSON.stringify(out, null, 1)); } catch (e) {}
  }
  if (JSON_OUT) { console.log(JSON.stringify(out, null, 1)); }
  else {
    const s = out.summary || {};
    if (out.verdict === 'error') console.log('[两站核验] ' + out.note);
    else console.log('[两站核验] A ' + out.a.navLatest + '/' + out.a.count + ' 条 · B ' + out.b.navLatest + '/' + out.b.count +
      ' 条 · 一致 ' + (s.same || 0) + ' · B 落后 ' + (s.lagB || 0) + ' · B 较新 ' + (s.aheadB || 0) +
      ' · 同日不同值 ' + (s.valueDiff || 0) + (s.onlyA || s.onlyB ? ' · 单侧 ' + (s.onlyA + s.onlyB) : ''));
    console.log('           ' + out.note);
  }
  process.exit(out.verdict === 'attention' || out.verdict === 'error' ? 1 : 0);
})();
