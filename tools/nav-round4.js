#!/usr/bin/env node
/* 净值精度归一（2026-11-13，第五十三轮）
 *
 * 问题：funds.json 的 nav 是抓取原值（銀聯信託 52 只保留 6–7 位），hist 序列统一存 4 位，
 *       于是「基金表末值」与「历史末点」在小数第 5 位以后不同（最大相对误差 3.5e-6）。
 *       页面展示取 4 位，用户看不见，但两套数据不一致会让外部核验反复报 A4，
 *       也让「表里的净值 + 图里的净值」无法逐位对上。
 *
 * 处理：当 funds.navAsOf 与该只 hist 末点日期相同时，统一取 hist 末点的 4 位值
 *       （hist 是全站走势图的唯一来源，以它为准才能保证表/图/接口三处完全一致）。
 *       日期不同则跳过——那属于「hist 还没追到最新净值日」，由 gap-check / freshness 处理，
 *       不能在这里用旧值覆盖新净值。
 *
 * 用法：node tools/nav-round4.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const DATA = path.join(BASE, 'data');
const FUNDS = path.join(DATA, 'funds.json');

const round4 = (v) => Math.round(v * 10000) / 10000;

function main() {
  const dry = process.argv.includes('--dry');
  const j = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const funds = j.funds || [];
  let same = 0;
  let changed = 0;
  let skipped = 0;
  const samples = [];

  funds.forEach((f) => {
    if (f.nav == null || !f.navAsOf) { skipped++; return; }
    let series;
    try {
      series = JSON.parse(fs.readFileSync(path.join(DATA, 'hist', String(f.id) + '.json'), 'utf8')).series;
    } catch (e) { skipped++; return; }
    if (!series || !series.length) { skipped++; return; }
    const last = series[series.length - 1];
    if (last[0] !== f.navAsOf) { skipped++; return; }
    same++;
    const target = round4(last[1]);
    if (round4(f.nav) !== target) {
      /* 末点同日但值不同 —— 不是精度问题，是真不一致，交给 nav-consistency 报警，这里不改 */
      if (samples.length < 8) samples.push(f.id + ' nav=' + f.nav + ' hist=' + last[1]);
      return;
    }
    if (f.nav !== target) {
      if (samples.length < 8 && changed < 8) samples.push(f.id + ' ' + f.nav + ' → ' + target);
      f.nav = target;
      changed++;
    }
  });

  console.log(`[nav-round4] 日期对齐 ${same} 只，精度归一 ${changed} 只，跳过 ${skipped} 只（历史未追平或声明 NA）`);
  if (samples.length) console.log('[nav-round4] 样例：' + samples.join('；'));
  if (!dry && changed) {
    fs.writeFileSync(FUNDS, JSON.stringify(j), 'utf8');
    console.log('[nav-round4] 已写入 data/funds.json');
  } else if (dry) {
    console.log('[nav-round4] --dry：不写盘');
  }
  return changed;
}

if (require.main === module) main();
module.exports = { round4 };
