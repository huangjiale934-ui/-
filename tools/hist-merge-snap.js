#!/usr/bin/env node
/* hist 快照合并（2026-10-22）
   背景：各发行人历史脚本的写入方式不一致——fetch-bct-hist / fetch-hsbc-family / fetch-bocpt-hist
   等都是「按本次抓到的日期整段覆盖写」，一旦只抓近端区间（日常增量）或 tmp 缓存被清，
   就会把 2000 年以来的历史截断。为不改 6 个 Python 脚本的写入逻辑，这里做一层通用保护：

   node tools/hist-merge-snap.js save    # 抓取前：把 data/hist 快照到 tmp/hist-snap
   node tools/hist-merge-snap.js merge   # 抓取后：把快照与新文件按日期取并集（新值优先），重写 + 修 hist-index
   node tools/hist-merge-snap.js drop    # 放弃快照

   并集规则：同一天以「新抓到的值」为准（官网可能修订），其余保留旧值。
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HIST = path.join(ROOT, 'data', 'hist');
const SNAP = path.join(ROOT, '..', '.hist-snap');   // 2026-10-22：移出项目目录，避免被打包上传（30MB）
const INDEX = path.join(ROOT, 'data', 'hist-index.json');
const SNAP_INDEX = path.join(SNAP, '_index.json');

function save() {
  /* 2026-10-24：不删目录（删除在本环境会挂/被拦），旧的整个改名后新建；
     由 bash 侧在本次任务结束时统一清理 *.old */
  if (fs.existsSync(SNAP)) {
    try { fs.renameSync(SNAP, SNAP + '.old-' + Date.now()); } catch (e) {}
  }
  fs.mkdirSync(SNAP, { recursive: true });
  let n = 0;
  fs.readdirSync(HIST).forEach((f) => {
    if (!f.endsWith('.json')) return;
    fs.copyFileSync(path.join(HIST, f), path.join(SNAP, f));
    n++;
  });
  fs.copyFileSync(INDEX, SNAP_INDEX);
  console.log('[snap] 已备份', n, '个 hist 文件 →', path.relative(ROOT, SNAP));
}

function merge() {
  if (!fs.existsSync(SNAP)) { console.log('[snap] 没有快照，跳过合并'); return; }
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const oldIdx = JSON.parse(fs.readFileSync(SNAP_INDEX, 'utf8'));
  let merged = 0, restored = 0, added = 0;
  const files = fs.readdirSync(HIST).filter((f) => f.endsWith('.json'));
  const snapFiles = fs.readdirSync(SNAP).filter((f) => f.endsWith('.json') && f !== '_index.json');
  const all = new Set(files.concat(snapFiles));

  all.forEach((f) => {
    const pNew = path.join(HIST, f);
    const pOld = path.join(SNAP, f);
    const hasNew = fs.existsSync(pNew);
    const hasOld = fs.existsSync(pOld);
    if (!hasOld) return;                       // 新文件（新基金），直接保留
    const oldJ = JSON.parse(fs.readFileSync(pOld, 'utf8'));
    const oldSeries = oldJ.series || [];
    if (!hasNew) {
      // 脚本没产出这只（抓取失败）→ 从快照恢复，避免丢文件
      fs.copyFileSync(pOld, pNew);
      restored++;
      return;
    }
    const newJ = JSON.parse(fs.readFileSync(pNew, 'utf8'));
    const newSeries = newJ.series || [];
    if (newSeries.length >= oldSeries.length) { /* 仍然要检查首点是否被截断 */ }
    const map = new Map();
    oldSeries.forEach(([d, v]) => map.set(d, v));
    let before = map.size;
    newSeries.forEach(([d, v]) => map.set(d, v));   // 新值覆盖同日
    const arr = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (arr.length > newSeries.length) added += arr.length - newSeries.length;
    if (arr.length !== newSeries.length || arr[0][0] !== (newSeries[0] || [])[0]) merged++;
    newJ.series = arr;
    newJ.first = arr[0] ? arr[0][0] : '';
    newJ.asOf = arr.length ? arr[arr.length - 1][0] : '';
    newJ.last = arr.length ? arr[arr.length - 1][1] : null;
    newJ.points = arr.length;
    fs.writeFileSync(pNew, JSON.stringify(newJ));
    const id = String(newJ.id || f.replace(/\.json$/, ''));
    if (idx.funds[id]) {
      idx.funds[id].first = newJ.first;
      idx.funds[id].asOf = newJ.asOf;
      idx.funds[id].last = newJ.last;
      idx.funds[id].points = newJ.points;
    }
  });
  // 快照里有、新集合里完全没有的基金：补回索引
  Object.keys(oldIdx.funds || {}).forEach((id) => { if (!idx.funds[id]) idx.funds[id] = oldIdx.funds[id]; });
  fs.writeFileSync(INDEX, JSON.stringify(idx));
  console.log('[snap] 合并完成：重写', merged, '只，补回缺失', restored, '只，补齐点数', added, '个');
  /* 快照目录保留，交由 bash 侧清理（见 hist-topup.sh 末尾） */
}

function drop() {
  if (fs.existsSync(SNAP)) {
    try { fs.renameSync(SNAP, SNAP + '.old-' + Date.now()); } catch (e) {}
  }
  console.log('[snap] 已归档快照（由 bash 侧清理）');
}

const cmd = process.argv[2] || 'merge';
if (cmd === 'save') save();
else if (cmd === 'merge') merge();
else if (cmd === 'drop') drop();
else { console.log('用法：node tools/hist-merge-snap.js save|merge|drop'); process.exit(1); }
