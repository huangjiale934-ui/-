#!/usr/bin/env node
/* 把本机 data/update-status.json 推到 A 站（2026-11-19，8.0）
   目的：A 站是静态部署包，状态文件原本只在发布时更新 → 运行期间用户看不到「正在更新」。
   现在每次 write_ustat 顺带推一次，线上提示栏即可实时反映 running/done/error。
   失败一律静默（状态上报绝不能阻断数据链路）。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = (process.env.MPF_SITE || 'https://mpf-data.app.workbuddy.host').replace(/\/$/, '');
const TOKEN = (() => { try { return fs.readFileSync(path.join(ROOT, 'data', 'upload-token.txt'), 'utf8').trim(); } catch (e) { return ''; } })();

(async () => {
  if (!TOKEN) return;
  let st;
  try { st = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'update-status.json'), 'utf8')); } catch (e) { return; }
  if (!st || !st.phase) return;
  const body = JSON.stringify({
    phase: String(st.phase).slice(0, 16),
    step: String(st.step || '').slice(0, 160),
    day: String(st.day || '').slice(0, 10),
    startedAt: st.startedAt ? String(st.startedAt).slice(0, 8) : undefined,
    finishedAt: st.finishedAt ? String(st.finishedAt).slice(0, 8) : undefined,
    host: 'workbuddy',
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    await fetch(SITE + '/api/status-push?token=' + encodeURIComponent(TOKEN), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, signal: ac.signal,
    });
  } catch (e) { /* 静默 */ }
  clearTimeout(timer);
})();
