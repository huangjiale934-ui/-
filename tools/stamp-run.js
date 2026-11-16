#!/usr/bin/env node
/* 运行时间戳 —— 2026-11-16
   问题：云端轻量任务当天没有数据变化时不会提交，`data/funds.json` 里的 updatedAt
   与 `data/update-status.json` 都停在上一班（用户看到 B 站横幅还是凌晨 04:41，
   而 A 站是 10:38）。
   做法：每次数据任务结束时显式打一次时间戳（updatedAt + update-status.json），
   让「数据更新」反映**最近一次成功刷新**，而不是「最近一次数值变化」。
   用法：node tools/stamp-run.js "净值更新完成" [github|workbuddy]
*/
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const step = process.argv[2] || '净值更新完成';
const host = process.argv[3] || (process.env.MPF_HOST || 'github');
const now = new Date();
const hhmm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong' }).format(now);
const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Hong_Kong' }).format(now);

const fundsPath = path.join(DATA, 'funds.json');
try {
  const doc = JSON.parse(fs.readFileSync(fundsPath, 'utf8'));
  doc.updatedAt = now.getTime();
  fs.writeFileSync(fundsPath, JSON.stringify(doc), 'utf8');
  console.log('[stamp] funds.updatedAt → ' + doc.updatedAt);
} catch (e) {
  console.error('[stamp] 更新 funds.json 失败：' + e.message);
}

const status = { phase: 'done', step, finishedAt: hhmm, day, host };
fs.writeFileSync(path.join(DATA, 'update-status.json'), JSON.stringify(status), 'utf8');
console.log('[stamp] update-status.json → ' + JSON.stringify(status));
