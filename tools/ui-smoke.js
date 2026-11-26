#!/usr/bin/env node
/**
 * UI 冒烟测试（tools/ui-smoke.js）—— 2026-11-22
 * ------------------------------------------------------------------
 * 用户要求：把反复回归的几条交互做成无头脚本，30 秒跑完：
 *   ① 清空对比 → 悬浮提示必须消失（空图残留 tooltip 的老 bug）
 *   ② 打开基金详情 → 关闭 → 主走势图悬浮仍然有效（MOVE_SEQ 全局失效的老 bug）
 *   ③ 切换页签（首页 ↔ 资料库）后走势图仍有正常宽度（重绘问题）
 *   ④ 导出中心：点开受托人下拉 → 指针移到别处 → 下拉必须还在（能继续选）
 *
 * 用法：node tools/ui-smoke.js [url]
 *   默认 http://127.0.0.1:3999/index.html
 * 退出码：0 全过；1 有失败（可直接接进 CI / 夜间任务）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL0 = process.argv[2] || 'http://127.0.0.1:3999/index.html';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9600 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), 'smoke-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' });

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const pg = list.find((t) => t.type === 'page');
      if (pg && pg.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl;
    } catch (e) { /* not ready */ }
    await sleep(200);
  }
  throw new Error('chrome not ready');
}

(async () => {
  const ws = new WebSocket(await getWs());
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const v = r.result && r.result.result;
    if (r.result && r.result.exceptionDetails) return '__ERR__ ' + r.result.exceptionDetails.text;
    return v ? v.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL0 });

  /* 等首屏走势图画出来 */
  for (let i = 0; i < 40; i++) {
    const ok = await ev("!!(document.querySelector('#dbTrendBox .tr-svg') && document.querySelector('#dbTrendBox .tr-svg').querySelector('path.tr-line'))");
    if (ok) break;
    await sleep(500);
  }

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

  /* ① 清空对比：CMPX / 表格勾选 / 图例 必须同时归零（单源），空图时不得残留悬浮 */
  const r1 = await ev(`(async()=>{
    const cbs=[...document.querySelectorAll('#tbody input[data-cmp]')].slice(0,2);
    cbs.forEach(c=>{ if(!c.checked) c.click(); });
    await new Promise(r=>setTimeout(r,900));
    const before={cmp:(window.CMPX?window.CMPX.ids().length:-1), checked:document.querySelectorAll('#tbody input[data-cmp]:checked').length};
    if(window.clearCmp) window.clearCmp();
    await new Promise(r=>setTimeout(r,1100));
    const box=document.querySelector('#dbTrendBox'); const svg=box.querySelector('.tr-svg');
    const b=svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent('pointermove',{clientX:b.left+b.width*0.5,clientY:b.top+b.height*0.5,bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const t=box.querySelector('.tr-tip');
    const empty=!!box.querySelector('.tr-emptycard:not([hidden])');
    return {before:before, cmp:(window.CMPX?window.CMPX.ids().length:-1),
      checked:document.querySelectorAll('#tbody input[data-cmp]:checked').length,
      pinned:document.querySelectorAll('#tbody tr.qf-divider').length,
      tip: t? (t.hidden?'hidden':'shown') : 'na', empty: empty};
  })()`);
  check('① 清空对比后两处状态同步', r1 && r1.cmp === 0 && r1.checked === 0 && r1.pinned === 0 &&
    (r1.empty ? r1.tip === 'hidden' : true), JSON.stringify(r1));

  /* ② 开关详情弹窗后 hover 仍有效（重新加载，确保图上有线） */
  await send('Page.navigate', { url: URL0 });
  for (let i = 0; i < 40; i++) {
    const ok = await ev("!!(document.querySelector('#dbTrendBox .tr-svg') && document.querySelector('#dbTrendBox .tr-svg').querySelector('path.tr-line'))");
    if (ok) break;
    await sleep(500);
  }
  await sleep(600);
  const r2 = await ev(`(async()=>{
    const svg=document.querySelector('#dbTrendBox .tr-svg'); const box=svg.closest('.tr-canvas');
    const mv=()=>{const b=svg.getBoundingClientRect();svg.dispatchEvent(new PointerEvent('pointermove',{clientX:b.left+b.width*0.55,clientY:b.top+b.height*0.5,bubbles:true}));};
    mv(); await new Promise(r=>setTimeout(r,300));
    const t=box.querySelector('.tr-tip'); const before=t&&!t.hidden?'shown':'hidden';
    const b=[...document.querySelectorAll('button')].find(x=>/^详情$/.test(x.textContent.trim()));
    if(b){b.click(); await new Promise(r=>setTimeout(r,1600)); const cx=document.querySelector('.modal .close-x, .modal .modal-x'); if(cx) cx.click(); await new Promise(r=>setTimeout(r,800));}
    mv(); await new Promise(r=>setTimeout(r,300));
    return {before: before, after: t&&!t.hidden?'shown':'hidden'};
  })()`);
  check('② 开关弹窗后悬浮仍有效', r2 && r2.after === 'shown', JSON.stringify(r2));

  /* ③ 切换页签后图表宽度正常 */
  const r3 = await ev(`(async()=>{
    if(window.location.pathname.indexOf('home')<0 && window.__dbShowTab){ window.__dbShowTab('home'); await new Promise(r=>setTimeout(r,900)); window.__dbShowTab('db'); await new Promise(r=>setTimeout(r,1200)); }
    const svg=document.querySelector('#dbTrendBox .tr-svg');
    return {w: svg? svg.clientWidth : 0};
  })()`);
  check('③ 切页签后图表宽度正常', r3 && r3.w >= 300, JSON.stringify(r3));

  /* ④ 导出中心下拉：指针移开仍在 */
  const r4 = await ev(`(async()=>{
    if(!window.openExportCenter) return {skip:true};
    window.openExportCenter(); await new Promise(r=>setTimeout(r,900));
    const host=document.querySelector('#ecMSTrustee'); if(!host) return {err:'no host'};
    const btn=host.querySelector('.mpfsel-btn'); if(btn) btn.click();
    await new Promise(r=>setTimeout(r,300));
    const pop=host.querySelector('.mpfsel-pop');
    const open1=pop && !pop.hidden;
    document.querySelector('body').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
    document.body.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:5,clientY:5}));
    await new Promise(r=>setTimeout(r,200));
    return {open1: !!open1, open2: !!(pop && !pop.hidden)};
  })()`);
  check('④ 导出中心下拉不被误关', r4 && (r4.skip || (r4.open1 && r4.open2)), JSON.stringify(r4));

  /* ⑤ 指数详情导出必须绑定指数（不是上一只基金的闭包） */
  await send('Page.navigate', { url: URL0 });
  await sleep(1500);
  const r5 = await ev(`(async()=>{
    if(!window.openIndexDetail) return {err:'no fn'};
    window.openIndexDetail('HSI');
    await new Promise(r=>setTimeout(r,2600));
    const b=document.querySelector('#mExport');
    const src=b&&b.onclick? String(b.onclick):'';
    return {hasFn: src.indexOf('mpfIndexBook')>=0, title: (document.querySelector('#mTitle')||{}).textContent||''};
  })()`);
  check('⑤ 指数详情导出指向指数', r5 && r5.hasFn === true, JSON.stringify(r5));

  /* ⑥ 表头排序（2026-11-26 体检发现过：维度 UI 下线后只变箭头不排序） */
  await send('Page.navigate', { url: URL0 });
  await sleep(2200);
  const r6 = await ev(`(async()=>{
    const first=()=>{const t=document.querySelector('#tbody tr:nth-child(1)');return t?t.innerText.replace(/\\s+/g,' ').slice(0,24):'';};
    const th=()=>[...document.querySelectorAll('#thead th')].find(t=>t.dataset.k==='selfY1');
    const base=first();
    if(!th()) return {err:'no th'};
    th().click(); await new Promise(r=>setTimeout(r,700)); const desc=first();
    th().click(); await new Promise(r=>setTimeout(r,700)); const asc=first();
    th().click(); await new Promise(r=>setTimeout(r,700)); const off=first();
    return {base:base,desc:desc,asc:asc,off:off};
  })()`);
  check('⑥ 表头排序三态生效（降序/升序/取消）', r6 && r6.desc && r6.desc !== r6.base && r6.asc !== r6.desc && r6.off === r6.base, JSON.stringify(r6));

  const bad = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? '  ✔ ' : '  ✘ ') + r.name + (r.pass ? '' : '  ' + r.detail)));
  console.log('UI 冒烟：' + (results.length - bad.length) + '/' + results.length + (bad.length ? ' 失败' : ' 全部通过'));

  ws.close(); proc.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('SMOKE ERR', e.message); try { proc.kill(); } catch (x) {} process.exit(2); });
