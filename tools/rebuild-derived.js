#!/usr/bin/env node
/* 派生文件统一重算入口（2026-11-19，8.0）
   ------------------------------------------------------------------
   背景：派生文件（navperf / mpfindex / allstats / indexbuild / hist-index / breadth）原先散落在
   daily.sh、deploy.yml、site-reconcile.js 三处清单里，任何一处漏项就会出现「改了数据但页面没变」
   —— 11-19 的温度计长期差 1，就是 site-reconcile 清单漏了 breadth。

   用法：
     node tools/rebuild-derived.js                # 只重算数据类派生文件
     node tools/rebuild-derived.js --with-site    # 末尾再构建静态站（site/）

   顺序约束（勿随意调换）：
     navperf 依赖 hist 末点 → mpfindex/allstats 读 hist+funds → hist-index 索引 → breadth 读 hist
     → build-static 通过 /api/* 读上述结果，必须最后跑。
*/
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STEPS = [
  ['navperf.js', '自算指标'],
  ['mpfindex.js', '自算指数'],
  ['allstats.js', '区间统计'],
  ['indexbuild.js', '市场指数'],
  ['tools/hist-index-sync.js', '历史索引'],
  ['tools/breadth.js', '涨跌温度计'],
];
if (process.argv.includes('--with-site')) STEPS.push(['tools/build-static.js', '静态站构建']);

let failed = 0;
STEPS.forEach(([rel, name]) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, stdio: 'inherit' });
  const ms = Date.now() - t0;
  if (r.status !== 0) { failed += 1; console.error(`✘ ${name}（${rel}）失败，退出码 ${r.status}`); }
  else console.log(`✔ ${name}（${rel}）${ms}ms`);
});
if (failed) { console.error(`派生重算：${failed} 步失败`); process.exit(1); }
console.log('派生重算：全部完成');
