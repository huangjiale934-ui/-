/**
 * 自算净值指标 —— 广州精研数据有限公司 · 香港强积金数据平台
 * ======================================================
 * 输入：data/hist/<id>.json（历史净值序列，各发行人官网）
 * 输出：data/nav-perf.json
 *   { updatedAt, source, note, funds: { "<id>": {
 *       asOf, nav, days, first,
 *       d1, w1, m1, ytd, y1, y3a, y5a,          // 百分比（%，保留 2 位）
 *       mdd, mddFrom, mddTo, mddDays            // 全序列最大回撤（运行峰值法）
 *   } } }
 * 口径说明：
 *   · 全部为「单位资产净值」涨幅，未含分红再投资与费用调整 —— 与积金局「基金回报」口径可能有差异；
 *   · 区间锚点 = 最后一个 ≤ 目标日的净值点（与实习生站一致，避免落在非交易日）；
 *   · 年化： (末值/初值)^(1/年数) - 1；1 年以内用累计涨幅；
 *   · 最大回撤：运行峰值法，记录峰/谷日期。
 * 用法：node navperf.js
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const HIST_DIR = path.join(DATA, 'hist');
const OUT = path.join(DATA, 'nav-perf.json');

const r2 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 10000) / 100; // 分数 → 百分数（2 位小数）

function iso(d) { return d.toISOString().slice(0, 10); }

/** 取「最后一个 ≤ date 的点」的索引；找不到返回 -1 */
function idxAt(series, date) {
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** shift 天/月/年 */
function minusDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() - n); return x; }
function minusMonths(d, n) {
  const x = new Date(d); const day = x.getUTCDate();
  x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last)); return x;
}
function minusYears(d, n) {
  const x = new Date(d); const day = x.getUTCDate();
  x.setUTCDate(1); x.setUTCFullYear(x.getUTCFullYear() - n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last)); return x;
}

function growth(series, anchorIdx, endIdx) {
  if (anchorIdx < 0 || endIdx <= anchorIdx) return null;
  const a = series[anchorIdx][1], b = series[endIdx][1];
  if (!(a > 0)) return null;
  return r2(b / a - 1);
}
function annualized(series, anchorIdx, endIdx, years) {
  if (anchorIdx < 0 || endIdx <= anchorIdx) return null;
  const a = series[anchorIdx][1], b = series[endIdx][1];
  if (!(a > 0)) return null;
  return r2(Math.pow(b / a, 1 / years) - 1);
}

/** 日收益序列（从 startIdx 起） */
function dailyRets(s, startIdx) {
  const out = [];
  for (let i = Math.max(1, startIdx); i < s.length; i++) {
    const a = s[i - 1][1], b = s[i][1];
    if (a > 0 && b > 0) out.push(b / a - 1);
  }
  return out;
}
/** 年化波动率（日收益标准差 × √252，单位 %） */
function annVol(rets) {
  if (rets.length < 20) return null;
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  const v = rets.reduce((x, y) => x + (y - m) * (y - m), 0) / (rets.length - 1);
  return r2(Math.sqrt(v) * Math.sqrt(252));
}
/** 近 12 个自然月的月度收益，返回 {pos, total, ratio} */
function monthlyStats(s) {
  const bym = new Map();
  for (const [d, v] of s) bym.set(d.slice(0, 7), v);           // 每月最后一个值
  const ks = [...bym.keys()].sort().slice(-13);
  if (ks.length < 3) return null;
  let pos = 0, tot = 0;
  for (let i = 1; i < ks.length; i++) {
    const a = bym.get(ks[i - 1]), b = bym.get(ks[i]);
    if (a > 0 && b > 0) { tot++; if (b > a) pos++; }
  }
  return tot ? { pos, total: tot, ratio: r2(pos / tot) } : null;
}

/** 运行峰值法最大回撤 */
function maxDrawdown(series) {
  let peak = series[0][1], peakDate = series[0][0];
  let mdd = 0, from = series[0][0], to = series[0][0];
  for (const [d, v] of series) {
    if (v > peak) { peak = v; peakDate = d; }
    const dd = v / peak - 1;
    if (dd < mdd) { mdd = dd; from = peakDate; to = d; }
  }
  return { mdd: r2(mdd), mddFrom: from, mddTo: to };
}

function computeOne(obj) {
  const s = obj.series;
  if (!s || s.length < 12) return null;   // 月度序列（友邦 FPR）≥12 点即可用
  const endIdx = s.length - 1;
  const lastDate = new Date(s[endIdx][0] + 'T00:00:00Z');
  /* 稀疏数据护栏：末尾两点相隔过远时，短周期指标（日/周/月）不可信 → 置 null
     （BCT 等来源早期为月频/周频，避免把月间隔误算成「日涨跌幅」） */
  const gap1 = Math.round((lastDate - new Date(s[endIdx - 1][0] + 'T00:00:00Z')) / 86400000);

  // 年初至今：上一个公历年最后一个点
  const prevYearEnd = iso(new Date(Date.UTC(lastDate.getUTCFullYear() - 1, 11, 31)));
  const ytdIdx = idxAt(s, prevYearEnd);

  const md = maxDrawdown(s);
  /* 近 1 年回撤（窗口 = 最后一日往前 1 年） */
  const y1StartIdx = idxAt(s, iso(minusYears(lastDate, 1)));
  const md1 = y1StartIdx > 0 ? maxDrawdown(s.slice(y1StartIdx)) : md;
  /* 近 5 年回撤（同一口径，窗口 = 最后一日往前 5 年） */
  const y5StartIdx = idxAt(s, iso(minusYears(lastDate, 5)));
  const md5 = y5StartIdx > 0 ? maxDrawdown(s.slice(y5StartIdx)) : md;
  return {
    asOf: s[endIdx][0],
    nav: s[endIdx][1],
    days: s.length,
    first: s[0][0],
    /* 2026-10-19：节假日/数据滞后不再留空——只要距今 ≤40 天就用「最新 vs 上一个有效交易日」算 */
    d1: gap1 <= 40 ? growth(s, endIdx - 1, endIdx) : null,
    w1: gap1 <= 20 ? growth(s, idxAt(s, iso(minusDays(lastDate, 7))), endIdx) : null,
    m1: gap1 <= 60 ? growth(s, idxAt(s, iso(minusMonths(lastDate, 1))), endIdx) : null,
    /* 2026-10-20：补 3 个月与 3/5/10 年累积，供详情页「累计表现」完整区间使用 */
    m3: gap1 <= 60 ? growth(s, idxAt(s, iso(minusMonths(lastDate, 3))), endIdx) : null,
    ytd: growth(s, ytdIdx, endIdx),
    y1: growth(s, idxAt(s, iso(minusYears(lastDate, 1))), endIdx),
    y3: growth(s, idxAt(s, iso(minusYears(lastDate, 3))), endIdx),
    y5: growth(s, idxAt(s, iso(minusYears(lastDate, 5))), endIdx),
    y10: growth(s, idxAt(s, iso(minusYears(lastDate, 10))), endIdx),
    yLaunch: growth(s, 0, endIdx),
    y3a: annualized(s, idxAt(s, iso(minusYears(lastDate, 3))), endIdx, 3),
    y5a: annualized(s, idxAt(s, iso(minusYears(lastDate, 5))), endIdx, 5),
    y10a: annualized(s, idxAt(s, iso(minusYears(lastDate, 10))), endIdx, 10),
    vol1: annVol(dailyRets(s, y1StartIdx)),
    vol3: annVol(dailyRets(s, idxAt(s, iso(minusYears(lastDate, 3))))),
    sharpe1: (function () {
      const v = annVol(dailyRets(s, y1StartIdx));
      const r = growth(s, idxAt(s, iso(minusYears(lastDate, 1))), endIdx);
      return (v && v > 0.5 && r != null) ? Math.round(r / v * 100) / 100 : null;   /* 无风险利率按 0 */
    })(),
    posM12: (monthlyStats(s) || {}).ratio,
    posM12n: (monthlyStats(s) || {}).total,
    /* 2026-10-20：52 周波幅（近一年最高／最低净值），供详情页表头「52周波幅」使用 */
    hi52: (function () {
      const i = Math.max(0, idxAt(s, iso(minusYears(lastDate, 1))));
      let hi = null, lo = null;
      for (let k = i; k < s.length; k++) {
        const v = s[k][1];
        if (v == null || !isFinite(v)) continue;
        if (hi == null || v > hi) hi = v;
        if (lo == null || v < lo) lo = v;
      }
      return hi == null ? null : { hi, lo };
    })(),
    ...md,
    mdd1: md1.mdd, mdd1From: md1.mddFrom, mdd1To: md1.mddTo,
    mdd5: md5.mdd, mdd5From: md5.mddFrom, mdd5To: md5.mddTo,
  };
}

(function main() {
  if (!fs.existsSync(HIST_DIR)) { console.error('无 ' + HIST_DIR + '，先运行 fetch-manulife-hist.py'); process.exit(1); }
  const files = fs.readdirSync(HIST_DIR).filter((f) => f.endsWith('.json'));
  /* 2026-10-19：最新净值同步——发行人价格源（funds.json 的 nav/navAsOf）常比历史文件新 1–2 天，
     直接补一点，避免「净值日期 10-15、日涨跌其实是 10-13」的错位。
     护栏：日期更新、净值 >0、涨跌幅 <20%（防单位类别串档）。 */
  const metaById = {};
  JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'funds.json'), 'utf8')).funds
    .forEach((x) => { metaById[String(x.id)] = x; });
  let stitched = 0;
  const funds = {};
  let ok = 0, skip = 0;
  for (const f of files) {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), 'utf8'));
      const m = metaById[String(obj.id)];
      if (m && m.navAsOf && m.nav > 0 && Array.isArray(obj.series) && obj.series.length) {
        const lastD = obj.series[obj.series.length - 1][0];
        const lastV = obj.series[obj.series.length - 1][1];
        if (m.navAsOf > lastD && lastV > 0 && Math.abs(m.nav / lastV - 1) < 0.2) {
          obj.series.push([m.navAsOf, m.nav]);
          stitched++;
        }
      }
      const perf = computeOne(obj);
      if (!perf) { skip++; continue; }
      const srcLabel = String(obj.src || '');
      const srcKey = obj.srcKey || (/BCT/i.test(srcLabel) ? 'bct'
        : (/宏利/.test(srcLabel) ? 'manulife'
          : (/滙豐/.test(srcLabel) ? 'hsbc'
            : (/恒生/.test(srcLabel) ? 'hangseng'
              : (/友邦/.test(srcLabel) ? 'aia' : srcLabel.slice(0, 12))))));
      funds[String(obj.id)] = { src: srcKey, name: obj.name, unit: obj.unit, scheme: obj.scheme, ...perf };
      ok++;
    } catch (e) { skip++; }
  }
  /* 恒生指数近 1 年涨跌幅（供前端算「超额收益」） */
  let hsi = null;
  try {
    const ix = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'index.json'), 'utf8')).items.HSI;
    const ser = ix.series || [];
    if (ser.length > 30) {
      const lastD = new Date(ser[ser.length - 1][0] + 'T00:00:00Z');
      const cut = iso(new Date(Date.UTC(lastD.getUTCFullYear() - 1, lastD.getUTCMonth(), lastD.getUTCDate())));
      let base = null;
      for (const [d, v] of ser) { if (d <= cut) base = v; else break; }
      if (base > 0) hsi = { asOf: ser[ser.length - 1][0], y1: r2(ser[ser.length - 1][1] / base - 1) };
    }
  } catch (e) { /* 无指数文件则忽略 */ }
  const out = {
    updatedAt: Date.now(),
    meta: { hsi },
    source: '各发行人官网单位资产净值（每日）',
    note: '自算口径：纯净值涨幅，未含分红再投资与费用调整，与积金局「基金回报」口径可能有差异',
    count: ok,
    funds,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
  console.log('已写入 ' + OUT);
  console.log('  最新净值补点 ' + stitched + ' 只');
  console.log('  自算 ' + ok + ' 只（跳过 ' + skip + '），文件 ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');

  /* ---------- 发行人平均指数（等权、链式链接；区间起点 = 1000） ----------
     口径：每个交易日，取「当日与上一数据点均有净值」的成员基金的日涨跌幅算术平均，
     链式乘到指数上（等价于每日再平衡的等权组合，不含费用）。用于第四页「发行人平均 vs 恒指」。 */
  const fundsMeta = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'funds.json'), 'utf8')).funds;
  const byTrustee = {};
  fundsMeta.forEach((x) => {
    if (x.navStatus === 'na') return;
    (byTrustee[x.trustee] = byTrustee[x.trustee] || []).push(String(x.id));
  });
  const tIdx = {};
  Object.keys(byTrustee).forEach((t) => {
    const ids = byTrustee[t].filter((id) => funds[id] && funds[id].src !== ''); // 有历史净值的成员
    if (ids.length < 1) return;
    /* 收集成员序列（日期 → 净值） */
    const seriesMap = ids.map((id) => {
      const h = JSON.parse(fs.readFileSync(path.join(HIST_DIR, id + '.json'), 'utf8'));
      const m = new Map();
      h.series.forEach(([d, p]) => m.set(d, p));
      return m;
    });
    const allDates = new Set();
    seriesMap.forEach((m) => { m.forEach((v, d) => allDates.add(d)); });
    const dates = Array.from(allDates).sort();
    /* 链式等权：每个日期按「有前后两点的基金」的平均日收益推进 */
    const series = [];
    let lvl = 1000;
    let lastPt = null;
    const prev = new Map(); // i -> [date, value]
    dates.forEach((d) => {
      let sum = 0; let cnt = 0;
      seriesMap.forEach((m, i) => {
        if (!m.has(d)) return;
        const p0 = prev.get(i);
        if (p0 && p0[0] < d) {
          const v = m.get(d);
          if (p0[1] > 0 && v > 0) { sum += v / p0[1] - 1; cnt++; }
        }
        prev.set(i, [d, m.get(d)]);
      });
      if (cnt > 0) lvl *= 1 + sum / cnt;
      /* 2026-10-18：输出抽样为「每周最后一个交易日」（周五；遇假期顺延到下一个交易日由 last 补齐），
         链式计算仍按日全量进行——控制 trustee-idx.json 体积（原全历史日度已 462KB+） */
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      if ((series.length || cnt > 0) && d >= '2016-01-01' && (dow === 5)) {
        series.push([d, Math.round(lvl * 100) / 100]);
        lastPt = [d, Math.round(lvl * 100) / 100];
      } else if (cnt > 0 && d >= '2016-01-01') {
        lastPt = [d, Math.round(lvl * 100) / 100];
      }
    });
    /* 补最后一个交易日（保证 asOf 为最新） */
    if (lastPt && (!series.length || series[series.length - 1][0] !== lastPt[0])) series.push(lastPt);
    if (series.length >= 60) {
      tIdx[t] = { name: t + ' · 发行人平均', count: ids.length, start: series[0][0], asOf: series[series.length - 1][0], series };
    }
  });
  const tOut = {
    updatedAt: Date.now(),
    source: '等权链式计算（成员基金官网净值，每日）',
    note: '每家发行人的成员基金（已接入官网历史净值的）等权平均：区间起点 = 1000，不含费用',
    items: tIdx,
  };
  fs.writeFileSync(path.join(__dirname, 'data', 'trustee-idx.json'), JSON.stringify(tOut, null, 0));
  console.log('  发行人平均指数 ' + Object.keys(tIdx).length + ' 条 → data/trustee-idx.json');

  // 抽样打印
  const sample = Object.entries(funds).slice(0, 3);
  for (const [id, p] of sample) {
    console.log('  #' + id + ' ' + p.name + '  asOf ' + p.asOf +
      '  日 ' + p.d1 + '%  YTD ' + p.ytd + '%  1年 ' + p.y1 + '%  MDD ' + p.mdd + '% (' + p.mddFrom + '→' + p.mddTo + ')');
  }
})();
