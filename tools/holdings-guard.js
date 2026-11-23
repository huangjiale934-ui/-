#!/usr/bin/env node
/* 持倉/分布入庫校驗（2026-10-23；2026-10-24 加 top10 四規則）
   規則 A：資產分布合計必須在 99.5–100.5，否則標 allocIncomplete=true（前端據此顯示說明）
   規則 B（top10，2026-10-24 新增——核驗發現 guard 原先完全不查 top10，18 隻 P0 全部漏報）：
     B1 名稱非空（無空白行）
     B2 十大合計 ≤ 100.5（物理上限；混入評級桶/統計行會爆表）
     B3 無統計行污染（Fund Risk Indicator / Yield to Maturity / Expense Ratio /
        Modified Duration / 級別桶 AAA、AA/Aa、A、BBB/Baa、BBB、B、CCC、Others*）
     B4 無控制字符（PDF 解析殘留 \u0000-\u001F）
   規則 C（2026-11-23，核驗發現雲端把個股名寫進資產分布）：
     資產分布的標籤不得與同基金 top10 的持倉名稱重合（否則就是把持股當資產類別）
   違反規則 B 任一條 → exit 1（CI/自動化可據此攔截）；規則 C 只告警 + 記 allocOverlap，不阻斷發布
   用法：node tools/holdings-guard.js [--fix]
*/
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'data', 'holdings.json');
const j = JSON.parse(fs.readFileSync(P, 'utf8'));
let bad = [], none = [], ok = 0;
const STAT = /Fund Risk Indicator|Yield to Maturity|Expense Ratio|Modified Duration|Credit Rating/i;
const BUCKET = /^(AAA|AA\/Aa|A|BBB\/Baa|BBB|B|CCC|Others\*)$/i;
let topFail = [];
let allocOverlap = [];
Object.entries(j.funds).forEach(([id, x]) => {
  const a = x.alloc || [];
  if (!a.length) { none.push(id); } else {
    const s = a.reduce((p, c) => p + (+c.weight || 0), 0);
    if (Math.abs(s - 100) > 0.5) { bad.push({ id, sum: +s.toFixed(2) }); x.allocIncomplete = true; x.allocSum = +s.toFixed(2); }
    else { x.allocIncomplete = false; x.allocSum = +s.toFixed(2); ok++; }
  }
  /* ---- 規則 B：top10 ---- */
  const t = x.top10 || [];
  const errs = [];
  if (t.some((y) => !String(y.name || '').trim())) errs.push('空名稱');
  const sum = t.reduce((p, c) => p + (+c.weight || 0), 0);
  if (sum > 100.5) errs.push('合計' + sum.toFixed(2));
  if (t.some((y) => STAT.test(String(y.name || '')) || BUCKET.test(String(y.name || '').trim()))) errs.push('統計行');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t.map((y) => y.name || '').join(''))) errs.push('控制字符');
  if (errs.length) topFail.push({ id, errs: errs.join('/') });
  /* ---- 規則 C：分布標籤不得是持倉名稱 ---- */
  const norm = (v) => String(v || '').toLowerCase().replace(/[^0-9a-z一-鿿]/g, '');
  const tset = new Set(t.map((y) => norm(y.name)).filter(Boolean));
  const over = (x.alloc || []).filter((b) => tset.has(norm(b.label)));
  if (over.length) {
    allocOverlap.push({ id, labels: over.map((b) => b.label).slice(0, 4) });
    x.allocOverlap = over.map((b) => b.label);
  } else if (x.allocOverlap) {
    delete x.allocOverlap;
  }
});
if (process.argv.includes('--fix')) fs.writeFileSync(P, JSON.stringify(j));
console.log('持仓校验：合规', ok, '只 | 合计异常', bad.length, '只 | 缺分布', none.length, '只');
if (bad.length) console.log('  异常明细：', bad.map((b) => b.id + ':' + b.sum).join(' '));
if (none.length) console.log('  缺分布：', none.join(' '));
if (allocOverlap.length) {
  console.log('  ⚠ 分布混入持仓名', allocOverlap.length, '只（疑似把 top10 当资产类别）：',
    allocOverlap.slice(0, 10).map((b) => b.id + '(' + b.labels.join('/') + ')').join(' '));
}
if (topFail.length) {
  console.log('  top10 违规', topFail.length, '只：', topFail.map((b) => b.id + '(' + b.errs + ')').join(' '));
  process.exit(1);
}
/* 2026-11-23（核验 D-07）：原来无论条数多少都打印「全部通过」，8 只 top10 不足 10 条被这句话盖住。
   官方只披露 7–9 条的属于正常，但要显式列出来，不能让人以为都齐了。 */
const shortIds = Object.entries(j.funds || {})
  .filter(([, v]) => (v.top10 || []).length > 0 && (v.top10 || []).length < 10)
  .map(([k, v]) => k + '(' + v.top10.length + ')');
if (shortIds.length) {
  console.log('top10 校验：无违规 ✓；其中 ' + shortIds.length + ' 只官方只披露不足 10 条（非抓取缺陷）：' + shortIds.slice(0, 14).join(' '));
} else {
  console.log('top10 校验：全部通过 ✓');
}
