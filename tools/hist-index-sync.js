#!/usr/bin/env node
/**
 * tools/hist-index-sync.js —— 把 data/hist-index.json 与 data/hist/*.json 对齐（幂等）
 *
 * 背景（2026-10-29）：
 *   `merge-nav.js` 会把官方当日净值追加进 data/hist/<id>.json，但它**不更新** hist-index.json；
 *   各发行人 python 抓取脚本只写自己写过的那些条目。结果索引长期落后于实际序列：
 *   两站都会出现「索引说 250 点 @10-22，实际文件已 252 点 @10-26」，
 *   影响 /api/hist-index、覆盖率与 gap 类展示（gap-check 读文件，不受影响）。
 *
 * 用法：node tools/hist-index-sync.js [--quiet]
 * 退出码：0 正常；1 数据目录缺失
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'hist');
const IDX = path.join(DATA, 'hist-index.json');
const QUIET = process.argv.includes('--quiet');

function main() {
  if (!fs.existsSync(HIST) || !fs.existsSync(IDX)) {
    console.error('[hist-index-sync] 缺少 data/hist 或 data/hist-index.json');
    process.exit(1);
  }

  const idx = JSON.parse(fs.readFileSync(IDX, 'utf8'));
  idx.funds = idx.funds || {};

  const files = fs.readdirSync(HIST).filter((f) => f.endsWith('.json'));
  let updated = 0;
  let added = 0;
  const changed = [];

  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(path.join(HIST, file), 'utf8'));
    } catch (e) {
      continue;
    }
    const s = obj.series || (Array.isArray(obj) ? obj : []);
    if (!s.length) continue;

    const asOf = s[s.length - 1][0];
    const last = s[s.length - 1][1];
    const first = s[0][0];
    const points = s.length;

    let e = idx.funds[id];
    if (!e) {
      idx.funds[id] = {
        code: obj.code || '',
        src: obj.src || '',
        name: obj.name || '',
        unit: obj.unit || '',
        scheme: obj.scheme || '',
        asOf,
        last,
        first,
        points,
      };
      added++;
      changed.push(id + ':新增 ' + points + '点@' + asOf);
      continue;
    }

    if (e.asOf !== asOf || e.points !== points || e.last !== last || e.first !== first) {
      e.asOf = asOf;
      e.last = last;
      e.first = first;
      e.points = points;
      updated++;
      changed.push(id + ':' + points + '点@' + asOf);
    }
  }

  idx.count = Object.keys(idx.funds).length;
  if (updated || added) {
    idx.updatedAt = Date.now();
    fs.writeFileSync(IDX, JSON.stringify(idx), 'utf8');
  }

  if (!QUIET) {
    console.log(
      '[hist-index-sync] 索引 %d 只｜校正 %d 只｜新增 %d 只%s',
      idx.count,
      updated,
      added,
      updated || added ? ' → ' + changed.slice(0, 6).join(' ') : '（已一致）'
    );
  }
}

main();
