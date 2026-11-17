#!/usr/bin/env node
/**
 * 历史净值统一 4 位小数（2026-11-17，用户要求）
 * ===============================================
 * 背景：部分发行人官网给 7 位（如 11.9909727），funds 已归一到 4 位，但 hist 保留原值，
 * 导致两站「同一天数值不同」的假差异、以及页面/导出展示口径不一致。
 * 处理：把 data/hist/*.json 的每个点四舍五入到 4 位；无需改动则跳过（幂等、可反复跑）。
 * 之后必须重算派生：navperf / allstats / breadth / plan-lag / hist-index。
 *
 * 用法：node tools/hist-round4.js [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'hist');
const DRY = process.argv.includes('--dry');
const r4 = (v) => Math.round(v * 10000) / 10000;

let files = 0;
let points = 0;
let changedFiles = 0;

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  files++;
  const p = path.join(DIR, f);
  let obj;
  try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { continue; }
  const s = obj.series || [];
  let hit = 0;
  for (const row of s) {
    if (typeof row[1] === 'number' && r4(row[1]) !== row[1]) { row[1] = r4(row[1]); hit++; }
  }
  points += hit;
  if (!hit) continue;
  changedFiles++;
  if (obj.last != null) obj.last = r4(obj.last);
  if (!DRY) fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
}

console.log('[hist-round4] 扫描 ' + files + ' 个文件，' + changedFiles + ' 个含 >4 位小数，归一 ' + points + ' 个点' + (DRY ? '（dry-run 未写盘）' : ''));
