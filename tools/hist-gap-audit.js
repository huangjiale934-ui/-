#!/usr/bin/env node
/* 历史净值「真缺日」审计（2026-11-03 · 第二十九轮）
   ------------------------------------------------------------------
   背景：gap-check.js / health-check.js 一直用「HSI 交易日历」判缺：
   只要市场开市而某只基金没有该日净值，就记为缺日。实际有大量日期是
   **发行人都还没发布**（宏利退休精選滞后 1 天、AMTD 走 etnet 转载滞后 1 天、
   新地是按季 PDF），于是每天报 55–244 只，把真正的问题淹没了。

   本脚本改用「自身净值日期」作基准，输出三类：
     A 真缺  realGap ：funds.navAsOf > hist 末点 —— 净值已更新、历史没跟上，必须补
     B 源站滞后 behind：navAsOf == hist 末点，但早于市场最新交易日 —— 正常，仅登记
     C 历史超前 ahead ：hist 末点 > navAsOf —— 异常（应由 merge-nav 对齐）

   用法：
     node tools/hist-gap-audit.js           人类可读摘要
     node tools/hist-gap-audit.js --json    机器可读
*/
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const HISTD = path.join(D, 'hist');

function readJson(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; }
}

/** 交易日序列（HSI 日线）：用于算「滞后几个交易日」——基金净值普遍 T+1/T+2，
    滞后 1 个交易日属正常，只有 ≥2 个才值得登记。 */
function tradeDays() {
  const idx = readJson(path.join(D, 'index.json'), {});
  const hsi = idx && idx.items && idx.items.HSI && idx.items.HSI.series
    ? idx.items.HSI.series.map((x) => x[0]) : [];
  return hsi;
}
function marketLatest() {
  const hsi = tradeDays();
  return hsi.length ? hsi[hsi.length - 1] : '';
}

function audit() {
  const funds = (readJson(path.join(D, 'funds.json'), { funds: [] }).funds) || [];
  const days = tradeDays();
  const mk = days.length ? days[days.length - 1] : '';
  const posOf = {};
  days.forEach((d, i) => { posOf[d] = i; });
  /* 该日期距离最新交易日几个交易日；不在日历里的（周末/假日/月频旧点）返回 99 */
  const lagOf = (d) => (posOf[d] == null ? 99 : days.length - 1 - posOf[d]);
  const realGap = [], behind = [], ahead = [], noHist = [];
  const behindByScheme = {};

  funds.forEach((f) => {
    const fp = path.join(HISTD, String(f.id) + '.json');
    if (!fs.existsSync(fp)) { if (f.navAsOf) noHist.push(f); return; }
    const o = readJson(fp, null);
    const s = (o && o.series) || [];
    if (!s.length) { if (f.navAsOf) noHist.push(f); return; }
    const lastD = s[s.length - 1][0];
    const navD = f.navAsOf || '';
    if (!navD) return;
    if (navD > lastD) {
      realGap.push({ id: f.id, fund: f.fund, scheme: f.scheme, trustee: f.trustee, navAsOf: navD, histLast: lastD, src: o.src || f.navSource || '' });
    } else if (navD < lastD) {
      ahead.push({ id: f.id, fund: f.fund, scheme: f.scheme, trustee: f.trustee, navAsOf: navD, histLast: lastD });
    } else if (mk && lastD < mk) {
      /* 只登记滞后 ≥2 个交易日的：T+1 是行业常态，全列出来会把真正的滞后淹掉 */
      const lag = lagOf(lastD);
      if (lag >= 2) {
        behind.push({ id: f.id, fund: f.fund, scheme: f.scheme, trustee: f.trustee, last: lastD, lag, src: o.src || f.navSource || '' });
        const k = f.scheme || f.trustee || '—';
        behindByScheme[k] = behindByScheme[k] || { days: new Set(), n: 0, trustee: f.trustee, lag: 0 };
        behindByScheme[k].n++;
        behindByScheme[k].days.add(lastD);
        behindByScheme[k].lag = Math.max(behindByScheme[k].lag, lag);
      }
    }
  });

  return { marketLatest: mk, realGap, ahead, behind, noHist, behindByScheme };
}

function summarize(r) {
  const lines = [];
  lines.push('市场最新交易日：' + (r.marketLatest || '—'));
  lines.push('A 真缺（净值已更新、历史没跟上）：' + r.realGap.length + ' 只');
  r.realGap.slice(0, 20).forEach((x) => lines.push('   ! ' + x.id + ' ' + x.fund + '  净值 ' + x.navAsOf + ' > 历史 ' + x.histLast + '  [' + x.scheme + ']'));
  lines.push('B 源站滞后 ≥2 个交易日（净值日 = 历史末点，属发行人节奏）：' + r.behind.length + ' 只');
  Object.keys(r.behindByScheme).forEach((k) => {
    const v = r.behindByScheme[k];
    lines.push('   · ' + k + '（' + v.trustee + '）' + v.n + ' 只，最新 ' + [...v.days].join('/') + '（滞后 ' + v.lag + ' 个交易日）');
  });
  lines.push('C 历史超前（历史比净值新，需 merge-nav 对齐）：' + r.ahead.length + ' 只');
  r.ahead.slice(0, 10).forEach((x) => lines.push('   ? ' + x.id + ' ' + x.fund + '  历史 ' + x.histLast + ' > 净值 ' + x.navAsOf));
  if (r.noHist.length) lines.push('无历史文件但有净值：' + r.noHist.length + ' 只');
  return lines.join('\n');
}

module.exports = { audit, summarize, marketLatest };

if (require.main === module) {
  const r = audit();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      marketLatest: r.marketLatest,
      realGap: r.realGap,
      ahead: r.ahead,
      behindCount: r.behind.length,
      behindByScheme: Object.keys(r.behindByScheme).map((k) => ({ scheme: k, trustee: r.behindByScheme[k].trustee, funds: r.behindByScheme[k].n, days: [...r.behindByScheme[k].days], lag: r.behindByScheme[k].lag })),
      noHist: r.noHist.map((x) => x.id),
    }, null, 1));
  } else {
    console.log(summarize(r));
  }
  /* 退出码：只有「真缺」与「历史超前」才算失败，源站滞后不算 */
  process.exit(r.realGap.length || r.ahead.length ? 1 : 0);
}
