#!/usr/bin/env node
/**
 * 状态漂移检查（tools/status-drift.js）—— 2026-11-23
 * ------------------------------------------------------------------
 * 用户要求：每日任务里单列一项「na / unmatched 数量与昨天不同就提醒」，
 * 避免被「T+1 落后」这类每日都有的 warn 淹没。
 *
 * 判定口径：
 *   · 对比「今天」与「上一次记录」的 na / unmatched 基金集合（按 id）；
 *   · 有进有出都算漂移，逐只打印「哪只、从什么状态变成什么状态」；
 *   · 仅数量相同但换了基金也算漂移（按集合比较，不看数量）。
 *
 * 输出：
 *   data/status-drift.json —— 保留 30 天，字段：days[{date,total,verified,na,unmatched,pending,naIds,unmatchedIds}]
 *   末次记录带 drift=true/false 与 changes[]（供夜间汇报直接引用）
 *
 * 退出码：恒为 0（有漂移只打印 !!! 并写 drift=true，不阻断发布；夜间汇报读 JSON 即可）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FUNDS = path.join(ROOT, 'data', 'funds.json');
const OUT = path.join(ROOT, 'data', 'status-drift.json');

function hktDate() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function main() {
  const fd = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const funds = fd.funds || [];
  const by = { verified: [], na: [], unmatched: [], pending: [] };
  funds.forEach((f) => {
    const s = String(f.navStatus || 'pending');
    (by[s] || by.pending).push(String(f.id));
  });

  const today = hktDate();
  const entry = {
    date: today,
    total: funds.length,
    verified: by.verified.length,
    na: by.na.length,
    unmatched: by.unmatched.length,
    pending: by.pending.length,
    naIds: by.na.slice().sort(),
    unmatchedIds: by.unmatched.slice().sort(),
  };

  let hist = { updatedAt: 0, days: [] };
  try { hist = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  const days = Array.isArray(hist.days) ? hist.days : [];
  const prev = days.filter((d) => d.date < today).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;

  const nameOf = {};
  funds.forEach((f) => { nameOf[String(f.id)] = f.fund || String(f.id); });

  const changes = [];
  if (prev) {
    const diff = (key, label) => {
      const before = new Set(prev[key] || []);
      const now = new Set(entry[key] || []);
      now.forEach((id) => { if (!before.has(id)) changes.push({ type: '+' + label, id, name: nameOf[id] || id }); });
      before.forEach((id) => { if (!now.has(id)) changes.push({ type: '-' + label, id, name: nameOf[id] || id }); });
    };
    diff('naIds', 'na');
    diff('unmatchedIds', 'unmatched');
  }

  entry.drift = changes.length > 0;
  entry.changes = changes;
  entry.prevDate = prev ? prev.date : '';
  entry.prev = prev ? { na: prev.na, unmatched: prev.unmatched, verified: prev.verified } : null;

  const kept = days.filter((d) => d.date !== today);
  kept.push(entry);
  kept.sort((a, b) => (a.date < b.date ? -1 : 1));
  while (kept.length > 30) kept.shift();
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: Date.now(), days: kept }, null, 1));

  console.log('[状态漂移] ' + today + ' 已核实 ' + entry.verified + ' / 不适用 ' + entry.na + ' / 待核实 ' + entry.unmatched +
    (prev ? '（上次 ' + prev.date + '：' + prev.verified + ' / ' + prev.na + ' / ' + prev.unmatched + '）' : '（首次记录，无基线）'));
  if (!prev) return 0;
  if (!changes.length) {
    console.log('[状态漂移] 与上次一致，无漂移');
    return 0;
  }
  console.log('!!! [状态漂移] 共 ' + changes.length + ' 处变化：');
  changes.slice(0, 20).forEach((c) => console.log('    ' + c.type + '  ' + c.id + '  ' + c.name));
  if (changes.length > 20) console.log('    …… 其余 ' + (changes.length - 20) + ' 处见 data/status-drift.json');
  return 0;
}

process.exit(main());
