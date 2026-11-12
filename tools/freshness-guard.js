#!/usr/bin/env node
/* 净值新鲜度闸门（2026-11-13，第三方核验 P1-2）
   ------------------------------------------------------------------
   背景：新地 10 只停在 09-30 达 41 天，一路「退出码 0 + 照常发布」，
   因为整条链路只有告警没有闸门。这里补一道**按来源**的停滞检测：

   · 用全站 funds.json 里出现过的 navAsOf 当交易日历（不额外请求）；
   · 逐受托人取「该来源最新净值日」，算它落后全站最新日几个交易日；
   · 落后 > --max-lag（默认 4 个交易日）→ 记一条 warn；
   · 落后 > --hard-lag（默认 10 个交易日）或全站最新日距今 > 7 天 → hard=true（可阻断发布）；
   · data/freshness-whitelist.json 可给某个来源豁免（写清原因与到期日）。

   用法：
     node tools/freshness-guard.js            # 打印 + 写 data/freshness.json
     node tools/freshness-guard.js --json     # 只输出 JSON
   退出码：hard=true 时 1，否则 0。
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FUNDS = path.join(ROOT, 'data', 'funds.json');
const OUT = path.join(ROOT, 'data', 'freshness.json');
const WL = path.join(ROOT, 'data', 'freshness-whitelist.json');

const argMax = Number((process.argv.find((a) => a.startsWith('--max-lag=')) || '').split('=')[1]) || 4;
const argHard = Number((process.argv.find((a) => a.startsWith('--hard-lag=')) || '').split('=')[1]) || 10;
const jsonOnly = process.argv.includes('--json');

function main() {
  const j = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const funds = (j.funds || []).filter((f) => f.navAsOf);
  if (!funds.length) { console.log('[freshness] funds.json 无有效净值日'); return 2; }

  /* 交易日历：所有出现过的净值日（升序） */
  const cal = Array.from(new Set(funds.map((f) => f.navAsOf))).sort();
  const latest = cal[cal.length - 1];

  /* 白名单：{ "受托人名": {"until":"2026-12-31","reason":"月频"} } */
  let wl = {};
  try { wl = JSON.parse(fs.readFileSync(WL, 'utf8')).trustees || {}; } catch (e) { /* 无白名单 */ }
  const today = new Date().toISOString().slice(0, 10);

  const byTrustee = new Map();
  funds.forEach((f) => {
    const t = f.trustee || '(未知)';
    const cur = byTrustee.get(t);
    if (!cur || f.navAsOf > cur.max) byTrustee.set(t, { max: f.navAsOf, n: (cur ? cur.n : 0) + 1 });
    else byTrustee.set(t, { max: cur.max, n: cur.n + 1 });
  });

  const items = [];
  Array.from(byTrustee.entries()).sort().forEach(([t, v]) => {
    const lag = cal.filter((d) => d > v.max).length;   /* 落后几个「出现过的净值日」 */
    let exempt = null;
    const w = wl[t];
    if (w && (!w.until || w.until >= today)) exempt = w.reason || '白名单';
    items.push({ trustee: t, count: v.n, latest: v.max, lagDays: lag, exempt });
  });

  const globalAge = Math.round((Date.now() - new Date(latest + 'T00:00:00Z').getTime()) / 864e5);
  const warn = items.filter((x) => !x.exempt && x.lagDays > argMax);
  const hardList = items.filter((x) => !x.exempt && x.lagDays > argHard);
  const hard = hardList.length > 0 || globalAge > 7;

  const res = { at: new Date().toISOString(), latest, globalAge, maxLag: argMax, hardLag: argHard, warnCount: warn.length, hard, items };

  if (!jsonOnly) {
    console.log('== 净值新鲜度 ==  全站最新 ' + latest + '（' + globalAge + ' 天前）');
    items.forEach((x) => {
      const tag = x.exempt ? '（豁免：' + x.exempt + '）' : (x.lagDays > argHard ? ' ✘ 停滞' : (x.lagDays > argMax ? ' ⚠ 偏慢' : ''));
      console.log('  ' + x.trustee.padEnd(10, ' ') + ' ' + String(x.count).padStart(3) + ' 只  最新 ' + x.latest + '  落后 ' + x.lagDays + ' 个净值日' + tag);
    });
    if (hardList.length) console.log('  ✘ 严重停滞：' + hardList.map((x) => x.trustee).join('、') + '（> ' + argHard + ' 个净值日）');
    if (!warn.length && !hard) console.log('  ✔ 各来源均在阈值内');
  }
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  if (jsonOnly) console.log(JSON.stringify(res, null, 1));
  return hard ? 1 : 0;
}

process.exit(main());
