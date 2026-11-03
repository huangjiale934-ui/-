#!/usr/bin/env node
/* 近端缺日巡检（2026-10-23 建立；2026-11-03 重做判据 + 自动补抓）
   ------------------------------------------------------------------
   旧版用「HSI 交易日历」判缺：市场开市而基金没该日净值就算缺。
   结果把「发行人都还没发布」的日期（宏利退休精選 T+2、AMTD 走 etnet 转载、新地按季 PDF）
   全算成缺日，每天报 55–244 只，真正的问题反而看不出来，也没人真去补。

   新版：
     A 真缺   = 净值日 > 历史末点   → --fix 时自动补（先 merge-nav 追点，再按发行人重抓）
     B 源站滞后 = 净值日 = 历史末点，但落后最新交易日 ≥2 天 → 只登记，不算故障
   用法：
     node tools/gap-check.js              只报告
     node tools/gap-check.js --json       机器可读
     node tools/gap-check.js --fix        自动补真缺（幂等，可每日跑）
*/
const { execFileSync } = require('child_process');
const path = require('path');
const { audit } = require('./hist-gap-audit');

const ROOT = path.join(__dirname, '..');
const PY = process.env.MPF_PY || 'C:/Users/11718/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe';
const FIX = process.argv.includes('--fix');

/* 发行人 → 补抓命令（--fix 用；$FROM 由最近缺日替换） */
const FETCH = [
  [/^富達/, ['fetch-fidelity-hist.py']],
  [/^AMTD/, ['nav-etnet.py']],
  [/^海通/, ['ht_daily.py']],
  [/^宏利/, ['fetch-manulife-hist.py']],
  [/^友邦/, ['aia_ingest2.py']],
  [/^東亞/, ['fetch-bea-hist.py']],
  [/智選計劃/, ['fetch-hsbc-family.py', '--from', '$FROM', '--days', '90']],
  [/^BCT/, ['fetch-bct-hist.py', '--max-dates', '8']],
  [/^(中銀保誠|我的強積金)/, ['fetch-bocpt-hist.py', '--from', '$FROM']],
  [/^永明/, ['fetch-sunlife-hist.py']],
  [/^中國人壽/, ['fetch-chinalife-hist.py']],
  [/^萬全/, ['yflife_daily.py']],
  [/^交通/, ['fetch-bocom-hist.py']],
];

function group(list) {
  const m = {};
  list.forEach((x) => {
    const k = x.scheme || x.trustee || '—';
    m[k] = m[k] || { scheme: k, trustee: x.trustee, funds: 0, days: new Set() };
    m[k].funds++;
    const d = x.histLast || x.last || '';
    if (d) m[k].days.add(d);
  });
  return Object.values(m).map((v) => ({ ...v, days: [...v.days].sort() }));
}

function run(args, label, isPy) {
  try {
    console.log('  → ' + label);
    execFileSync(isPy ? PY : process.execPath, args, { cwd: ROOT, stdio: 'inherit', timeout: 15 * 60e3 });
    return true;
  } catch (e) {
    console.log('  ! ' + label + ' 失败：' + String(e.message || e).slice(0, 140));
    return false;
  }
}

function main() {
  let r = audit();
  const real = group(r.realGap);
  const lag = group(r.behind);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ marketLatest: r.marketLatest, realGap: real, behind: lag }));
    process.exit(r.realGap.length || r.ahead.length ? 1 : 0);
  }

  console.log('市场最新交易日：' + (r.marketLatest || '—'));
  if (!real.length) {
    console.log('  真缺日：无 ✔（净值与历史末点全部对齐）');
  } else {
    console.log('  真缺日 ' + r.realGap.length + ' 只：');
    real.forEach((o) => console.log('    ! ' + o.scheme + '（' + o.trustee + '）' + o.funds + ' 只，最新 ' + o.days.join('/')));
  }
  if (r.ahead.length) {
    console.log('  历史超前 ' + r.ahead.length + ' 只（历史比净值新，需 merge-nav 对齐）');
  }
  if (lag.length) {
    console.log('  源站滞后（净值日 = 历史末点，属发行人节奏，不算故障）：');
    lag.forEach((o) => console.log('    · ' + o.scheme + '（' + o.trustee + '）' + o.funds + ' 只，最新 ' + o.days.join('/')));
  }

  if (!FIX || !real.length) process.exit(r.ahead.length ? 1 : 0);

  /* ---- --fix：先追点（funds.nav 已有值，最快），再按发行人重抓 ---- */
  console.log('\n== 自动补抓 ==');
  run([path.join(__dirname, 'merge-nav.js')], 'merge-nav（用已抓到的净值追点）');
  r = audit();
  const rest = group(r.realGap);
  if (!rest.length) {
    console.log('  追点后已无真缺 ✔');
    process.exit(0);
  }
  console.log('  追点后仍缺 ' + r.realGap.length + ' 只，按发行人重抓：');
  rest.forEach((o) => {
    const rule = FETCH.find(([re]) => re.test(o.scheme));
    if (!rule) { console.log('    ? ' + o.scheme + ' 无补抓命令，跳过'); return; }
    const from = o.days[o.days.length - 1] || '';
    const args = rule[1].map((x) => x.replace('$FROM', from));
    run(args, o.scheme + ' ← ' + args.join(' '), /\.py$/.test(args[0]));
  });
  run([path.join(__dirname, 'merge-nav.js')], 'merge-nav（补抓后再次追点）');
  const after = audit();
  console.log('\n补抓后：真缺 ' + after.realGap.length + ' 只');
  process.exit(after.realGap.length ? 1 : 0);
}

main();
