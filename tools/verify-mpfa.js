#!/usr/bin/env node
/**
 * 用积金局「强积金基金平台」逐只核对本站的积金局口径字段
 * （基金规模 / 风险级别 / 基金开支比率 / 推出日期）—— 只读，不改数据。
 * 用法：node tools/verify-mpfa.js [--n 30] [--all]
 */
const fs = require('fs');
const path = require('path');

const funds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'funds.json'), 'utf8')).funds;
const args = process.argv.slice(2);
const ALL = args.includes('--all');
const nArg = args.indexOf('--n');
const N = ALL ? funds.length : (nArg >= 0 ? parseInt(args[nArg + 1], 10) : 30);

/* 抽样：优先覆盖规模最大的 10 只 + 各受托人各 1 只，其余随机 */
let sample = [];
if (!ALL) {
  const bySize = funds.slice().sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 10);
  const seen = new Set();
  const perTrustee = [];
  funds.forEach((f) => { if (!seen.has(f.trustee)) { seen.add(f.trustee); perTrustee.push(f); } });
  const pool = funds.filter((f) => !bySize.includes(f) && !perTrustee.includes(f));
  while (sample.length < N - bySize.length - perTrustee.length && pool.length) {
    sample.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  sample = bySize.concat(perTrustee, sample);
} else sample = funds;

const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function field(html, label) {
  const i = html.indexOf(label);
  if (i < 0) return '';
  const seg = html.slice(i, i + 1200);
  const m = seg.match(/<td[^>]*>([\s\S]*?)<\/td>/);
  return m ? strip(m[1]) : '';
}

const num = (s) => {
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

const dateOf = (s) => {
  const m = String(s).match(/(\d{1,2})\D+(\d{1,2})\D+(\d{4})/);
  if (!m) return '';
  const p = (x) => String(x).padStart(2, '0');
  return m[3] + '-' + p(m[2]) + '-' + p(m[1]);
};

function parseReturns(html) {
  const out = { ret: {}, cal: {} };
  const re = /累積回報<\/a>\s*\((一年期|五年期|十年期|推出至今)\)[\s\S]{0,500}?<td[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    const txt = strip(m[2]);
    const arr = txt.split('/').map((x) => num(x));
    const key = { 一年期: '1', 五年期: '5', 十年期: '10', 推出至今: 'L' }[m[1]];
    out.ret[key] = arr;
  }
  const re2 = /曆年回報:\s*(\d{4})[\s\S]{0,400}?<td[^>]*>([\s\S]*?)<\/td>/g;
  while ((m = re2.exec(html))) out.cal[m[1]] = num(strip(m[2]));
  return out;
}

async function one(f) {
  const url = 'https://mfp.mpfa.org.hk/tch/cf_detail.jsp?cf_id=' + encodeURIComponent(f.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      return {
        id: f.id, fund: f.fund,
        size: num(field(html, '基金規模（港幣百萬元）')),
        risk: num(field(html, '風險級別')),
        fer: num(field(html, '基金開支比率')),
        launch: dateOf(field(html, '推出日期')),
        rets: parseReturns(html),
      };
    } catch (e) {
      if (attempt === 1) return { id: f.id, fund: f.fund, err: e.message };
    }
  }
}

(async () => {
  console.log('核对 ' + sample.length + ' 只（积金局基金平台 cf_detail）…');
  const out = [];
  const CONC = 4;
  for (let i = 0; i < sample.length; i += CONC) {
    const chunk = sample.slice(i, i + CONC);
    const res = await Promise.all(chunk.map(one));
    res.forEach((r) => out.push(r));
    process.stdout.write('.');
  }
  console.log('');

  let mismatch = 0, failed = 0;
  const detail = [];
  out.forEach((r) => {
    if (r.err) { failed++; return; }
    const f = funds.find((x) => String(x.id) === String(r.id));
    const diffs = [];
    if (r.size != null && f.size != null && Math.abs(r.size - f.size) > 0.02) diffs.push('规模 ' + f.size + '→' + r.size);
    if (r.risk != null && f.risk != null && r.risk !== f.risk) diffs.push('风险 ' + f.risk + '→' + r.risk);
    if (r.fer != null && f.fer != null && Math.abs(r.fer - f.fer) > 0.001) diffs.push('FER ' + f.fer + '→' + r.fer);
    if (r.rets && r.rets.ret) {
      const map = { 1: ['ann1', 'cum1'], 5: ['ann5', 'cum5'], 10: ['ann10', 'cum10'], L: ['annLaunch', 'cumLaunch'] };
      Object.keys(map).forEach((k) => {
        const a = r.rets.ret[k];
        if (!a || a.length < 2) return;
        const [fa, fc] = map[k];
        if (f[fa] != null && a[0] != null && Math.abs(a[0] - f[fa]) > 0.02) diffs.push(fa + ' ' + f[fa] + '→' + a[0]);
        if (f[fc] != null && a[1] != null && Math.abs(a[1] - f[fc]) > 0.02) diffs.push(fc + ' ' + f[fc] + '→' + a[1]);
      });
      Object.keys(r.rets.cal || {}).forEach((y) => {
        if (f.cal && f.cal[y] != null && r.rets.cal[y] != null && Math.abs(r.rets.cal[y] - f.cal[y]) > 0.02) {
          diffs.push(y + '年 ' + f.cal[y] + '→' + r.rets.cal[y]);
        }
      });
    }
    if (r.launch && f.launch) {
      const [d, m, y] = String(f.launch).split('-');
      const mine = y + '-' + m + '-' + d;
      if (mine !== r.launch) diffs.push('推出 ' + mine + '→' + r.launch);
    }
    if (diffs.length) { mismatch++; detail.push(r.id + ' ' + r.fund + '：' + diffs.join('；')); }
  });
  console.log('一致 ' + (out.length - failed - mismatch) + ' / ' + out.length + '，差异 ' + mismatch + '，抓取失败 ' + failed);
  detail.slice(0, 20).forEach((d) => console.log('  · ' + d));
  if (!detail.length && !failed) console.log('全部与积金局平台一致 ✓');
})();
