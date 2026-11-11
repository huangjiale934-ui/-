#!/usr/bin/env node
/**
 * 積金局「基金資訊表」刷新 —— 广州精研数据有限公司 · 香港强积金数据平台
 * ================================================================
 * 背景（2026-11-11 自查发现）：
 *   data/funds.json 里的「规模 / 年率化回報 / 風險級別 / 開支比率」等字段来自
 *   積金局基金資訊表，但每日/每夜鏈路从来没有调用过 build.js，于是这些字段
 *   长期停在上一次手工跑 build.js 的月份（实测 2026-09-30，而官网已到 10-31）。
 *
 * 做法：只做「外科式合并」——
 *   · 按 cfid 对齐（積金局自己的 id，稳定）；
 *   · 只覆盖積金局口径字段；
 *   · 保护 nav / navAsOf / navSource / navStale 等由 navbuild、merge-nav 维护的字段；
 *   · dataAsOf 倒退时直接跳过，避免把旧月份写回去。
 *
 * 用法：
 *   node tools/mpfa-refresh.js            # 有变化才写盘
 *   node tools/mpfa-refresh.js --dry      # 只看差异，不写
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FUNDS = path.join(ROOT, 'data', 'funds.json');
const { scrape } = require(path.join(ROOT, 'scraper.js'));

/* 这些字段由净值链路维护，積金局快照里虽然也有，但不能拿它覆盖 */
const PROTECT = new Set([
  'id', 'nav', 'navAsOf', 'navSource', 'navStatus', 'navPriceUrl', 'navSourceUrl', 'navStale',
  'groupSize', 'groupUnits',
]);

const dry = process.argv.includes('--dry');

function main() {
  return scrape().then((r) => {
    if (!r.funds || !r.funds.length) {
      console.log('[mpfa] 抓取结果为空，保留现有 funds.json');
      return 0;
    }
    const old = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
    const oldFunds = old.funds || [];
    const byId = new Map(oldFunds.map((x) => [String(x.id), x]));

    if (old.dataAsOf && r.dataAsOf && r.dataAsOf < old.dataAsOf) {
      console.log('[mpfa] 官网日期 ' + r.dataAsOf + ' 早于现有 ' + old.dataAsOf + '，跳过（避免倒退）');
      return 0;
    }

    let changed = 0, added = 0;
    const merged = r.funds.map((n) => {
      const o = byId.get(String(n.id));
      if (!o) { added++; return n; }
      const out = Object.assign({}, n);
      /* 保护净值相关字段 + 保留旧对象里独有的键（如 navStale） */
      PROTECT.forEach((k) => { if (k in o) out[k] = o[k]; });
      Object.keys(o).forEach((k) => { if (!(k in out)) out[k] = o[k]; });
      const keys = new Set([...Object.keys(o), ...Object.keys(out)]);
      for (const k of keys) {
        if (PROTECT.has(k)) continue;
        if (JSON.stringify(o[k]) !== JSON.stringify(out[k])) { changed++; break; }
      }
      return out;
    });

    /* 官网已下架的条目：保留旧记录，避免历史/持仓出现孤儿引用 */
    const newIds = new Set(r.funds.map((x) => String(x.id)));
    const dropped = oldFunds.filter((x) => !newIds.has(String(x.id)));
    dropped.forEach((x) => {
      console.log('[mpfa] 官网已无此条目，保留旧记录：' + x.id + ' ' + (x.fund || ''));
      merged.push(x);
    });

    const next = Object.assign({}, old, {
      updatedAt: Date.now(),
      dataAsOf: r.dataAsOf || old.dataAsOf || '',
      years: r.years || old.years,
      count: merged.length,
      unitRows: (r.units || []).length || old.unitRows,
      declaredTotal: r.declaredTotal || old.declaredTotal || null,
      /* navStat 由 navbuild 维护（含 sources 的 n/verified/cadence，首页友情链接要用），
         不能用 scrape() 里 attachNav 的简化版覆盖——形状不同会让友链显示 undefined。 */
      navStat: old.navStat || r.navStat || null,
      funds: merged,
    });

    console.log('[mpfa] 官网日期 ' + (r.dataAsOf || '-') + '（原 ' + (old.dataAsOf || '-') + '）'
      + '｜行数 ' + merged.length + '｜字段有变化 ' + changed + ' 只｜新增 ' + added + ' 只');

    if (changed === 0 && added === 0 && next.dataAsOf === old.dataAsOf) {
      console.log('[mpfa] 无变化，不写盘');
      return 0;
    }
    if (dry) { console.log('[mpfa] --dry：不写盘'); return 0; }
    fs.writeFileSync(FUNDS, JSON.stringify(next));
    console.log('[mpfa] 已写入 data/funds.json');
    return changed;
  });
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[mpfa] 失败：' + e.message);
  process.exit(1);
});
