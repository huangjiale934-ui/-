#!/usr/bin/env node
/* 各步骤耗时排行（tools/step-times.js）—— 2026-11-22
 * ------------------------------------------------------------------
 * 用户要求：夜间日志末尾给一段「最慢前 3 名」，以后优化只看这 3 个，
 * 不用把整条链的日志翻一遍。
 *
 * 输入：tmp/step-times-YYYYMMDD.tsv（daily.sh 由 step/soft_step 逐行追加：名称|秒|退出码）
 * 输出：控制台「耗时排行 TOP3 + 合计」；data/step-times.json 保留最近 30 天（便于看趋势）
 *
 * 用法：node tools/step-times.js [tsv路径]
 * 退出码恒为 0（统计失败不影响主链）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const file = process.argv[2] || '';
const OUT = path.join(ROOT, 'data', 'step-times.json');

function hkDay() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
function fmt(s) { return s >= 60 ? (Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's') : s + 's'; }

let rows = [];
try {
  rows = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split('|');
    return { name: p[0] || '?', sec: Number(p[1]) || 0, rc: Number(p[2]) || 0 };
  });
} catch (e) {
  console.log('[耗时] 无计时文件（' + file + '），跳过排行');
  process.exit(0);
}
if (!rows.length) { console.log('[耗时] 本次没有记录到步骤耗时'); process.exit(0); }

const total = rows.reduce((a, b) => a + b.sec, 0);
const top = rows.slice().sort((a, b) => b.sec - a.sec).slice(0, 3);
const slowN = rows.filter((r) => r.sec >= 60).length;

console.log('');
console.log('=== 耗时排行（共 ' + rows.length + ' 步，合计 ' + fmt(total) + '） ===');
top.forEach((r, i) => {
  const pct = total ? Math.round((r.sec / total) * 100) : 0;
  console.log('  ' + (i + 1) + '. ' + r.name.padEnd(28, ' ') + fmt(r.sec).padStart(6, ' ') +
    '  占 ' + String(pct).padStart(2, ' ') + '%' + (r.rc ? '  (退出码 ' + r.rc + ')' : ''));
});
if (slowN > 3) console.log('  其余 ' + (slowN - 3) + ' 步耗时 ≥1 分钟，详见上方各步 [耗时] 行');

/* 落盘：按天覆盖，保留 30 天 */
let doc = { updatedAt: 0, days: [] };
try { doc = JSON.parse(fs.readFileSync(OUT, 'utf8')) || doc; } catch (e) { /* 首次 */ }
const day = hkDay();
const days = (doc.days || []).filter((d) => d && d.day !== day);
days.push({ day, total, steps: rows, top: top.map((r) => ({ name: r.name, sec: r.sec })) });
doc = { updatedAt: Date.now(), days: days.slice(-30) };
try { fs.writeFileSync(OUT, JSON.stringify(doc)); } catch (e) { console.log('[耗时] 写盘失败：' + e.message); }
process.exit(0);
