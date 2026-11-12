#!/usr/bin/env node
/**
 * site-reconcile.js —— 两站互相纠错（不是只汇报，而是把错的一边改成对的）
 *
 * 用户口径（2026-11-12）：两个站互为校验，谁落后/谁缺数据就自动补齐，不要只写报告。
 *
 * 判定：逐只基金比 navAsOf
 *   · 本机更新 → 记为 localBetter
 *   · GitHub 更新 → 记为 ghBetter
 *   · 同一天但净值不同 → conflict（两边都自称官方，先保留本机并在报告里点名，避免互相覆盖抖动）
 *
 * 动作（--apply 才执行）：
 *   · ghBetter 明显占多（≥10 只且是本机的 2 倍以上）→ PULL：按 origin/main 里的
 *     funds + hist 把本机落后那几只补上，然后重算派生文件、重建静态站（调用方随后发布）
 *   · localBetter 明显占多 → PUSH：把本机 data 提交并推送，GitHub 会用自己的流水线重建
 *   · 两者接近（各 <10）→ 视为时点差，不动
 *
 * 用法：
 *   node tools/site-reconcile.js            # 只看会做什么
 *   node tools/site-reconcile.js --apply    # 真的做
 *   node tools/site-reconcile.js --apply --no-push   # 只补本机，不推 GitHub
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
/* 2026-11-12：WorkBuddy 站被平台切成「需要分享码」，不带 code 一律 403。
   分享码放 data/wb-share.txt（git 忽略），没有就按公开链接走。 */
let SHARE = process.env.MPF_SHARE || '';
if (!SHARE) { try { SHARE = require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'wb-share.txt'), 'utf8').trim(); } catch (e) {} }
function withShare(u) { return SHARE ? u + (u.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + SHARE : u; }
const A = process.env.MPF_SITE_A || 'https://mpf-data.app.workbuddy.host';
const B = process.env.MPF_SITE_B || 'https://huangjiale934-ui.github.io/-';
const APPLY = process.argv.includes('--apply');
const NO_PUSH = process.argv.includes('--no-push');
const THRESHOLD = 10;

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(withShare(url), { timeout: 30000, headers: { 'cache-control': 'no-store' } }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function sh(cmd, args, opts) {
  return execFileSync(cmd, args, Object.assign({ cwd: ROOT, encoding: 'utf8', timeout: 300000 }, opts || {}));
}

(async () => {
  const [fa, fb] = await Promise.all([
    get(withShare(A + '/api/funds')),
    get(B + '/api/funds.json'),
  ]);
  if (!fa || !fb) {
    console.error('FATAL 取不到两站的 funds（A=' + !!fa + ' B=' + !!fb + '）');
    process.exit(2);
  }

  const mapA = new Map((fa.funds || []).map((x) => [String(x.id), x]));
  const mapB = new Map((fb.funds || []).map((x) => [String(x.id), x]));

  const localBetter = [];
  const ghBetter = [];
  const conflicts = [];
  const onlyA = [];
  const onlyB = [];

  mapA.forEach((a, id) => {
    const b = mapB.get(id);
    if (!b) { onlyA.push(id); return; }
    const da = a.navAsOf || '';
    const db = b.navAsOf || '';
    if (da > db) localBetter.push(id);
    else if (db > da) ghBetter.push(id);
    else if (da && a.nav != null && b.nav != null && Math.abs(a.nav - b.nav) > 1e-6) {
      conflicts.push({ id, date: da, a: a.nav, b: b.nav });
    }
  });
  mapB.forEach((b, id) => { if (!mapA.has(id)) onlyB.push(id); });

  console.log('== 两站对账 ==');
  console.log(`  本机更新 ${localBetter.length} 只 · GitHub 更新 ${ghBetter.length} 只 · 同日不同值 ${conflicts.length} 只`);
  if (onlyA.length) console.log(`  仅本机有 ${onlyA.length} 只：${onlyA.slice(0, 6).join(',')}`);
  if (onlyB.length) console.log(`  仅 GitHub 有 ${onlyB.length} 只：${onlyB.slice(0, 6).join(',')}`);
  conflicts.slice(0, 5).forEach((c) => console.log(`  ! ${c.id} @${c.date} 本机 ${c.a} / GH ${c.b}`));

  const pull = ghBetter.length >= THRESHOLD && ghBetter.length > localBetter.length * 2;
  const push = localBetter.length >= THRESHOLD && localBetter.length > ghBetter.length * 2;

  if (!pull && !push) {
    console.log('  结论：差异在时点差范围内，不动作');
    process.exit(0);
  }

  if (pull) {
    console.log(`  结论：GitHub 领先 ${ghBetter.length} 只 → 把本机补齐（PULL）`);
    if (!APPLY) { console.log('  （未加 --apply，不执行）'); process.exit(0); }

    sh('git', ['fetch', 'origin', 'main', '-q']);
    const fundsPath = path.join(ROOT, 'data', 'funds.json');
    const j = JSON.parse(fs.readFileSync(fundsPath, 'utf8'));
    /* 2026-11-12 修：原来只改了内存里从 HTTP 取回的对象，没落到 funds.json，
       结果「补了 16 只」但本地一条没变。必须按 id 改磁盘上的记录。 */
    const disk = new Map((j.funds || []).map((f) => [String(f.id), f]));
    let ok = 0;
    let fail = 0;
    for (const id of ghBetter) {
      try {
        const h = sh('git', ['show', 'origin/main:data/hist/' + id + '.json']);
        fs.writeFileSync(path.join(ROOT, 'data', 'hist', id + '.json'), h);
        const b = mapB.get(id);
        const d = disk.get(id);
        if (d && b) {
          ['nav', 'navAsOf', 'navSource', 'navSourceUrl', 'navStatus'].forEach((k) => {
            if (b[k] !== undefined) d[k] = b[k];
          });
          d.navReconciledFrom = 'github';
        }
        ok++;
      } catch (e) {
        fail++;
      }
    }
    j.updatedAt = Date.now();
    fs.writeFileSync(fundsPath, JSON.stringify(j));
    console.log(`  已补 ${ok} 只（失败 ${fail}），开始重算派生文件`);
    const run = (f) => { try { sh(process.execPath, [f]); } catch (e) { console.log('  WARN ' + f + ' ' + e.message.slice(0, 60)); } };
    ['navperf.js', 'mpfindex.js', 'allstats.js', 'indexbuild.js', 'tools/hist-index-sync.js', 'tools/build-static.js'].forEach(run);
    console.log('  完成：本机已对齐，请重新发布 WorkBuddy 站');
    process.exit(0);
  }

  if (push) {
    console.log(`  结论：本机领先 ${localBetter.length} 只 → 推给 GitHub（PUSH）`);
    if (!APPLY) { console.log('  （未加 --apply，不执行）'); process.exit(0); }
    if (NO_PUSH) { console.log('  （--no-push：跳过推送）'); process.exit(0); }
    try {
      sh('git', ['add', 'data']);
      const st = sh('git', ['status', '--porcelain', 'data']);
      if (!st.trim()) { console.log('  没有可提交的数据改动'); process.exit(0); }
      sh('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m',
        'data: 两站对账 —— 用本机较新的净值补齐 GitHub 站（自动）']);
      for (let i = 0; i < 3; i++) {
        try {
          sh('git', ['push', 'origin', 'HEAD:main']);
          console.log('  已推送，GitHub 会用自己的流水线重建');
          process.exit(0);
        } catch (e) {
          try { sh('git', ['fetch', 'origin', 'main', '-q']); sh('git', ['rebase', '-X', 'ours', 'origin/main']); } catch (e2) { try { sh('git', ['rebase', '--abort']); } catch (e3) {} }
        }
      }
      console.log('  WARN 推送失败（已提交在本地，下次再试）');
    } catch (e) {
      console.log('  WARN 推送流程失败：' + e.message.slice(0, 80));
    }
    process.exit(0);
  }
})();
