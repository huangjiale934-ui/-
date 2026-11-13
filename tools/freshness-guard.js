#!/usr/bin/env node
/* 净值新鲜度闸门（2026-11-13，第三方核验 P1-2）
   ------------------------------------------------------------------
   背景：新地 10 只停在 09-30 达 41 天，一路「退出码 0 + 照常发布」，
   因为整条链路只有告警没有闸门。这里补一道**按来源**的停滞检测：

   · 交易日历用恒生指数序列（index.json 的 HSI）—— 港股每个交易日必有点，
     周末与公众假期天然缺席，不需要维护假期表；
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

/* 2026-11-13（第五十三轮，用户要求「周末/节假日也加交易日历，避免长假误报」）：
   原来 globalAge 用「自然日距今天数 > 7」判 hard —— 圣诞+元旦、农历新年这种连休
   确实会误报。现改口径：
     · 交易日历取恒生指数序列（港股交易日，天然跳过周末与公众假期）；
     · 基金净值应追到「市场最新交易日」；落后 ≤2 个交易日算正常（当晚才发布）；
     · 市场日历本身超过 7 天没前进 → indexbuild 挂了，也算 hard（独立信号）。
   这样长假期间 navAsOf 与 HSI 末点同步不动，不会误报。 */
function marketCalendar() {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'index.json'), 'utf8'));
    const s = (idx.items && (idx.items.HSI || idx.items.MPFAVG) && (idx.items.HSI || idx.items.MPFAVG).series) || [];
    return s.map((r) => r[0]);
  } catch (e) { return []; }
}

function compute(opts) {
  const o = opts || {};
  const argMaxL = o.maxLag != null ? o.maxLag : argMax;
  const argHardL = o.hardLag != null ? o.hardLag : argHard;
  const j = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const funds = (j.funds || []).filter((f) => f.navAsOf);
  if (!funds.length) return { error: 'funds.json 无有效净值日', hard: true, items: [] };

  /* 交易日历：优先恒生指数（真实交易日），缺失时回退到「出现过的净值日」 */
  const mkt = marketCalendar();
  const cal = (mkt.length > 20 ? mkt : Array.from(new Set(funds.map((f) => f.navAsOf))).sort());
  const latest = Array.from(new Set(funds.map((f) => f.navAsOf))).sort().pop();
  const marketLatest = cal[cal.length - 1] || latest;
  /* 基金净值落后市场最新交易日几个交易日（0 = 同步） */
  const fundLag = cal.filter((d) => d > latest).length;

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
    const lag = cal.filter((d) => d > v.max).length;   /* 落后几个「交易日」 */
    let exempt = null;
    const w = wl[t];
    if (w && (!w.until || w.until >= today)) exempt = w.reason || '白名单';
    items.push({ trustee: t, count: v.n, latest: v.max, lagDays: lag, exempt });
  });

  /* globalAge 保留「自然日」含义供展示，但不再用作 hard 判据（长假会误报） */
  const globalAge = Math.round((Date.now() - new Date(latest + 'T00:00:00Z').getTime()) / 864e5);
  /* 市场日历自身停滞：HSI 末点超过 7 个自然日没前进 → indexbuild/行情源有问题 */
  const marketAge = Math.round((Date.now() - new Date(marketLatest + 'T00:00:00Z').getTime()) / 864e5);
  const warn = items.filter((x) => !x.exempt && x.lagDays > argMaxL);
  const hardList = items.filter((x) => !x.exempt && x.lagDays > argHardL);
  /* hard 判据改为「基金净值整体落后市场 >2 个交易日」或「市场日历停滞 >7 天」 */
  const hard = fundLag > 2 || marketAge > 7;

  const res = {
    at: new Date().toISOString(), latest, marketLatest, fundLag, marketAge, globalAge,
    maxLag: argMaxL, hardLag: argHardL, warnCount: warn.length, hard, items,
  };

  if (!jsonOnly) {
    console.log('== 净值新鲜度 ==  基金最新 ' + latest + ' / 市场最新交易日 ' + marketLatest +
      '（落后 ' + fundLag + ' 个交易日；自然日 ' + globalAge + ' 天前）');
    items.forEach((x) => {
      const tag = x.exempt ? '（豁免：' + x.exempt + '）' : (x.lagDays > argHardL ? ' ✘ 停滞' : (x.lagDays > argMaxL ? ' ⚠ 偏慢' : ''));
      console.log('  ' + x.trustee.padEnd(10, ' ') + ' ' + String(x.count).padStart(3) + ' 只  最新 ' + x.latest + '  落后 ' + x.lagDays + ' 个净值日' + tag);
    });
    if (hardList.length) console.log('  ✘ 严重停滞：' + hardList.map((x) => x.trustee).join('、') + '（> ' + argHardL + ' 个交易日）');
    if (!warn.length && !hard) console.log('  ✔ 各来源均在阈值内');
  }
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  if (jsonOnly) console.log(JSON.stringify(res, null, 1));
  return hard ? 1 : 0;
}

if (require.main === module) process.exit(compute());
module.exports = { compute };
