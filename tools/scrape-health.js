#!/usr/bin/env node
/* 节点级抓取监控汇总（tools/scrape-health.js）—— 2026-11-22
 * ------------------------------------------------------------
 * 背景：isValid 只看响应长度/错误串，源站把价格表改成新组件、或换成维护页时仍会
 *       「通过」，随后解析 0 条并静默沿用上次数据（用户看到的是「每天都成功」）。
 * navbuild.js 现在按解析原语做探针，把结果写到 data/scrape-health.json；
 * 本工具负责「读出来 + 人读报告 + 退出码」，供每日链路与自动化判断是否要告警。
 *
 * 用法：
 *   node tools/scrape-health.js          # 人读摘要；有 struct_miss / missing → 退出码 1
 *   node tools/scrape-health.js --json   # 原样输出 JSON
 *   node tools/scrape-health.js --strict # 连 degraded（用了旧文件）也算失败
 * 退出码：0 正常；1 有结构缺失/缺文件（需告警）；2 尚未产出监控文件
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'scrape-health.json');
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

if (!fs.existsSync(FILE)) {
  console.error('[节点监控] 尚无 data/scrape-health.json（navbuild 未跑过）');
  process.exit(2);
}
let doc;
try {
  doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error('[节点监控] 读取失败: ' + e.message);
  process.exit(2);
}
if (JSON_OUT) {
  console.log(JSON.stringify(doc, null, 1));
  process.exit(0);
}

const S = doc.summary || {};
const src = doc.sources || [];
const day = doc.day || '';
const at = doc.updatedAt ? new Date(doc.updatedAt).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '';
const bad = src.filter((s) => s.status !== 'ok');
const hard = src.filter((s) => s.status === 'struct_miss' || s.status === 'missing' || s.status === 'failed');

console.log('[节点监控] ' + day + (at ? '（' + at + '）' : '') +
  ' 来源 ' + (S.total || src.length) + ' · 正常 ' + (S.ok || 0) +
  ' · 结构缺失 ' + (S.structMiss || 0) + ' · 空数据 ' + (S.empty || 0) +
  ' · 缺文件 ' + (S.missing || 0) + ' · 用旧文件 ' + (S.degraded || 0) +
  (S.notRendered ? ' · 未渲染 ' + S.notRendered : ''));

if (bad.length) {
  console.log('');
  bad.forEach((s) => {
    const tag = s.status === 'struct_miss' ? '结构缺失' :
      s.status === 'missing' ? '缺文件' : s.status === 'empty' ? '空数据' : '用旧文件';
    console.log('  · [' + tag + '] ' + s.key + '  ' + (s.node ? '节点「' + s.node + '」 ' : '') +
      (s.detail || '') + (s.count ? '（已取 ' + s.count + ' 条）' : ''));
  });
}
if (doc.history && doc.history.length) {
  const h = doc.history.slice(-5).map((x) => {
    const m = x.summary || {};
    return x.day + ':' + (m.ok || 0) + '/' + (m.total || 0) + (m.structMiss ? ' 缺' + m.structMiss : '');
  });
  console.log('\n  近 5 日：' + h.join('  '));
}

if (hard.length) process.exit(1);
if (STRICT && bad.length) process.exit(1);
process.exit(0);
