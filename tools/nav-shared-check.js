#!/usr/bin/env node
/* 「共用净值」备案复核（2026-11-13，第三方复验报告 P1-3 的闭环）
 *
 * 背景：101,475 对全量比对里，有 6 对（12 只）基金的历史序列逐点完全相同，
 * 每轮核验都会被标成「疑似单位类别串档」。经直接查询发行人接口确认：
 * BCT 强积金策略计划 4 对景顺 A/H、宏利退休精選 2 对安联 B/T 官方就是同价，
 * 且同计划内另有 9 对 A/H 价格不同（反证我方链路能区分类别）。证据见
 * data/nav-shared-verified.json。
 *
 * 本脚本负责：逐对复核「备案时相同、现在是否仍相同」。
 *   · 仍相同 → OK（已知共用，不算缺陷）
 *   · 出现差异 → 说明其中一只已被修正/被写坏，必须重新取证定性
 *   · 文件里某只缺 hist → 报错
 *
 * 用法：node tools/nav-shared-check.js [--quiet]   退出码 0=一致，1=有变化，2=备案文件缺失
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DOC = path.join(DATA, 'nav-shared-verified.json');
const quiet = process.argv.includes('--quiet');

function readSeries(id) {
  const p = path.join(DATA, 'hist', String(id) + '.json');
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(j.series) ? j.series : null;
  } catch (e) { return null; }
}

function main() {
  if (!fs.existsSync(DOC)) {
    console.error('[shared-nav] 缺少 data/nav-shared-verified.json');
    return 2;
  }
  const doc = JSON.parse(fs.readFileSync(DOC, 'utf8'));
  const pairs = doc.pairs || [];
  const rows = [];
  let bad = 0;

  for (const p of pairs) {
    const sa = readSeries(p.a);
    const sb = readSeries(p.b);
    if (!sa || !sb) { rows.push({ id: p.a + '/' + p.b, status: 'MISSING', note: '缺 hist 文件' }); bad++; continue; }
    const mb = new Map(sb.map((r) => [r[0], r[1]]));
    let common = 0;
    let diff = 0;
    let firstDiff = null;
    for (const [d, v] of sa) {
      if (!mb.has(d)) continue;
      common++;
      if (Math.abs(mb.get(d) - v) > 1e-9) {
        diff++;
        if (!firstDiff) firstDiff = [d, v, mb.get(d)];
      }
    }
    if (!common) { rows.push({ id: p.a + '/' + p.b, status: 'NO-OVERLAP', note: '无共同日期' }); bad++; continue; }
    if (diff === 0) {
      rows.push({ id: p.a + '/' + p.b, status: 'OK', common, note: (p.fund || '') + ' ' + (p.units || []).join('/') });
    } else {
      rows.push({ id: p.a + '/' + p.b, status: 'CHANGED', common, diff, firstDiff, note: '两类别已出现差异，需重新取证定性' });
      bad++;
    }
  }

  if (!quiet) {
    console.log('== 共用净值备案（' + pairs.length + ' 对） ==');
    rows.forEach((r) => {
      const tag = r.status === 'OK' ? '✔' : '✘';
      console.log('  ' + tag + ' ' + r.id.padEnd(11) + ' ' + String(r.common || 0).padStart(5) + ' 个共同点  ' +
        (r.status === 'OK' ? '逐点相同（已知共用）' : r.status + ' ' + (r.firstDiff ? JSON.stringify(r.firstDiff) : '') + ' ' + r.note));
    });
    console.log(bad ? '  ✘ 有 ' + bad + ' 对需要重新定性' : '  ✔ 备案的 6 对仍逐点相同（官方共用净值，非串档）');
  }
  return bad ? 1 : 0;
}

process.exit(main());
