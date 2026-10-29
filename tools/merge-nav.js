/**
 * 把 data/nav.json（各发行人官网最新净值）合并进 data/funds.json
 * 用法：node tools/merge-nav.js
 * 说明：navbuild.js 只生成 nav.json；attachNav 负责按「计划 + 基金名」匹配写回 funds.json。
 *       此前每日链路缺少这一步，导致抓了新净值但页面仍显示旧值。
 *
 * 2026-10-22 追加：用 hist 序列里「真实变动」的最新点补齐 funds.nav。
 * 背景（第三方核查 S1）：永明的页面抓取比其 webservice 慢，导致 funds.nav 停在 10-16、
 * 而 hist 已到 10-20。这里只在「hist 末点比 navAsOf 新，且末点与前一交易日不同」时才覆盖，
 * 避免把官网对未公布日期返回的「前值填充」写进 funds.nav。
 */
const fs = require('fs');
const path = require('path');
const { attachNav } = require('../scraper');

const P = path.join(__dirname, '..', 'data', 'funds.json');
const HIST = path.join(__dirname, '..', 'data', 'hist');
const fd = JSON.parse(fs.readFileSync(P, 'utf8'));
const stat = attachNav(fd.funds);
fd.navStat = stat;
fd.updatedAt = Date.now();

let filled = 0
let fixedNa = 0, corrected = 0, appended = 0, aligned = 0, synced = 0;
fd.funds.forEach((f) => {
  const fp = path.join(HIST, String(f.id) + '.json');
  if (!fs.existsSync(fp)) return;
  let h;
  try { h = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return; }
  const s = h.series || [];
  if (s.length < 2) return;
  /* 找「最后一个真实变动点」：跳过官网对未公布日期返回的前值填充 */
  let idx = s.length - 1;
  while (idx > 0 && Math.abs(s[idx][1] - s[idx - 1][1]) < 1e-9) idx--;
  const last = s[idx];
  const prev = s[idx - 1] || last;
  /* 2026-10-23 修（核验报告 #1）：同一日期下，列表净值与 hist 末点不一致时，以 hist 为准。
     起因：中国人寿 8 只的 funds.nav 取的是官网「卖出价」，而 hist 存的是单位净值，
     两者相差 0.1%–1.2%，导致列表、详情走势、自算指标三处对不上。hist 已与 etnet/ooogroup 官方价核对一致。 */
  const sameDay = last[0] === (f.navAsOf || '') && f.nav;
  if (sameDay && Math.abs(last[1] / f.nav - 1) > 0.001) {
    f.nav = last[1];
    f.navSource = (f.navSource || '').replace(/｜[^｜]*$/, '') + '｜与净值序列校正';
    corrected++;
    return;
  }
  /* 2026-10-23 修（核验报告 v2 #阻断）：中国人寿官网「每日价格」页给的是卖出价，
     与单位净值差 0.03%–1.24%，而 hist 序列是净值口径。凡中国人寿，净值一律以 hist 末点为准。 */
  if (f.trustee === '中國人壽' && Math.abs(last[1] / f.nav - 1) > 0.003) {
    f.nav = last[1];
    f.navAsOf = last[0];
    f.navSource = '中國人壽強積金集成信託計劃（中國人壽信託）· 單位淨值';
    corrected++;
    return;
  }
  /* 末点必须比现有 navAsOf 新，且与前一交易日不同（真实变动，不是官网填充值） */
  if (last[0] > (f.navAsOf || '') && Math.abs(last[1] - prev[1]) > 1e-9) {
    f.nav = last[1];
    f.navAsOf = last[0];
    if (!f.navSource || f.navSource.indexOf('hist') < 0) {
      f.navSource = (f.navSource || '') + '｜hist 序列末点';
    }
    filled++;
  }
});

/* 2026-10-23：hist 比 nav 旧一天时，把 nav 追加进 hist（nav 是官网当日公布价），
   让 funds / hist / navperf 三处日期一致，避免"列表 10-22、走势 10-21"。 */
(function appendNavDay() {
  fd.funds.forEach((f) => {
    if (!f.nav || !f.navAsOf) return;
    if (f.navStatus === 'na') return;
    const fp = path.join(HIST, String(f.id) + '.json');
    if (!fs.existsSync(fp)) return;
    try {
      const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const s2 = o.series || [];
      if (!s2.length) return;
      const lastD = s2[s2.length - 1][0];
      if (f.navAsOf <= lastD) return;                      // 已经不比 nav 旧
      if (Math.abs(f.nav / s2[s2.length - 1][1] - 1) > 0.05) return;  // 差异过大不敢追加
      s2.push([f.navAsOf, f.nav]);
      o.series = s2; o.asOf = f.navAsOf; o.last = f.nav; o.points = s2.length;
      fs.writeFileSync(fp, JSON.stringify(o));
      appended++;
    } catch (e) {}
  });
})();

/* 2026-10-24：若 hist 末点比 navAsOf 新（且不超过 7 天），直接把 nav 对齐到 hist 末点。
   即便当日净值与前一日相同（价格未变），日期也应前进——否则列表停在 10-20、走势到 10-21。 */
(function alignToHist() {
  fd.funds.forEach((f) => {
    if (!f.nav || !f.navAsOf || f.navStatus === 'na') return;
    const fp = path.join(HIST, String(f.id) + '.json');
    if (!fs.existsSync(fp)) return;
    try {
      const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const s2 = o.series || [];
      if (!s2.length) return;
      const last = s2[s2.length - 1];
      if (last[0] <= f.navAsOf) return;
      if (Math.round((new Date(last[0]) - new Date(f.navAsOf)) / 864e5) > 7) return;
      if (!(last[1] > 0)) return;
      f.nav = last[1]; f.navAsOf = last[0];
      /* 2026-10-25 渠道优先级重构：navSource 同步为 hist 实际来源（官网优先的显示层固化） */
      if (o.src && f.navSource !== o.src) f.navSource = o.src;
      aligned++;
    } catch (e) {}
  });
})();

/* 2026-10-23（核验报告 v2）：状态自洽处理
   - navStatus='na' 的（146/365），nav 与 navAsOf 必须同时为空，避免"有日期无净值"
   - nav 有值但 navAsOf 为空（603），用 hist 末点日期补上 */
/* 2026-10-25 修 P1-1：navStatus='na' 但 hist 有日度末点的（146 保證組合——積金局平台
   最新淨值列顯示 n.a.，但基金實際有 aia-pt 日度價），用 hist 末點回填並改 verified。
   放在 normalize 之前，避免被 normalize 清空。365 真無日度（hist 不存在）不受影響。 */
(function fixNaWithHist() {
  fd.funds.forEach((f) => {
    if (f.navStatus !== 'na') return;
    const fp = path.join(HIST, String(f.id) + '.json');
    if (!fs.existsSync(fp)) return;
    try {
      const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const last = (o.series || []).slice(-1)[0];
      if (last && last[1] > 0) {
        f.nav = last[1]; f.navAsOf = last[0];
        f.navStatus = 'verified';
        if (o.src) f.navSource = o.src;
        fixedNa++;
      }
    } catch (e) {}
  });
})();

/* 2026-10-25 渠道优先级重构：全量同步 navSource = hist 实际来源（官网第一优先）。
   修复历史遗留：富达 7 只 hist 已是官网 NavChartData，navSource 仍写 etnet */
(function syncNavSource() {
  fd.funds.forEach((f) => {
    const fp = path.join(HIST, String(f.id) + '.json');
    if (!fs.existsSync(fp)) return;
    try {
      const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (o.src && f.navSource !== o.src) { f.navSource = o.src; synced++; }
    } catch (e) {}
  });
})();

(function normalize() {
  fd.funds.forEach((f) => {
    if (f.navStatus === 'na') { f.nav = null; f.navAsOf = ''; return; }
    if (f.nav && !f.navAsOf) {
      try {
        const h = JSON.parse(fs.readFileSync(path.join(HIST, String(f.id) + '.json'), 'utf8'));
        const last = (h.series || []).slice(-1)[0];
        if (last) f.navAsOf = last[0];
      } catch (e) {}
    }
  });
})();

/* 2026-10-23（核验报告 #6）：净值日距今天数 > 7 的，标 navStale，避免"已验证"误导（如新地源抓取失败仍计 verified） */
(function markStale() {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const toDays = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);
  fd.funds.forEach((f) => {
    f.navStale = !!(f.navAsOf && toDays(today, f.navAsOf) > 7);
  });
})();

/* 按实际 navSource 重建来源统计（G7） */
(function rebuildSources() {
  /* 2026-10-26 修 4-06：na 基金不再计入 verified（此前「宏利環球精選 n=1 verified=1」实为 na 的 365）；
     汇总 verified/na 同步按本地明细重算（fixNaWithHist 修正后 scrape 时刻的计数已过期，
     此前汇总 449 vs 明细 450 vs 渠道合计 451 三者不一致） */
  const bySrc = {};
  let sumVerified = 0, sumNa = 0;
  fd.funds.forEach((f) => {
    const raw = String(f.navSource || '').trim();
    if (!raw) return;
    const key = raw.split('｜')[0].trim();
    const g = bySrc[key] = bySrc[key] || { name: key, n: 0, asOf: '', verified: 0, na: 0, urls: {} };
    g.n++;
    if (f.navStatus === 'na') { g.na++; sumNa++; } else { g.verified++; sumVerified++; }
    if (f.navAsOf && f.navAsOf > g.asOf) g.asOf = f.navAsOf;
    /* 2026-10-29（5.0）：记录每组出现最多的官方页面，供「友情链接」直接跳转官网。
       此前 sources 只有 name/n/asOf，前端拿不到 URL，href 变空 → 点击跳回本站。 */
    if (f.navSourceUrl) g.urls[f.navSourceUrl] = (g.urls[f.navSourceUrl] || 0) + 1;
  });
  const list = Object.values(bySrc).sort((a, b) => b.n - a.n);
  if (fd.navStat) {
    fd.navStat.sources = list.map((g) => {
      const page = Object.entries(g.urls).sort((a, b) => b[1] - a[1])[0];
      return { name: g.name, label: g.name, n: g.n, asOf: g.asOf, verified: g.verified, na: g.na, page: page ? page[0] : '' };
    });
    fd.navStat.bySource = list;
    fd.navStat.verified = sumVerified;
    fd.navStat.na = sumNa;
    fd.navStat.unmatched = fd.funds.length - sumVerified - sumNa;
  }
})();

fs.writeFileSync(P, JSON.stringify(fd));
const asof = {};
fd.funds.forEach((f) => { const k = f.navAsOf || '无'; asof[k] = (asof[k] || 0) + 1; });
console.log('[merge-nav] 已核实 %d / 待核实 %d / 不适用 %d', stat.verified, stat.pending, (stat.sources || []).reduce((a, s) => a + (s.na || 0), 0));
console.log('[merge-nav] hist 末点补齐 %d 只；同日校正 %d 只；nav 追加进 hist %d 只；日期对齐 %d 只', filled, corrected, appended, aligned);
console.log('[merge-nav] navAsOf 分布：%s', JSON.stringify(Object.entries(asof).sort().slice(-5)));
