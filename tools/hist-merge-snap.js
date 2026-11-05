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
  /* 2026-11-05（第三十八轮，数据事故复盘）：
     旧实现是「把当前 data/hist 整体复制成快照，再把上一份快照改名成 .old-时间戳」。
     11-05 早上 09:53 那一轮跑到一半被打断，HSBC/恒生 40 只 hist 被截成 7 个点；
     10:35 重跑时 save() 直接把这份残缺状态当作基线 → 快照也残缺，merge() 救不回来，
     40 只 2015 年以来的历史全部只剩 7 天（当天已从 git 恢复）。
     现在改为「快照 = 历史见过的所有点的并集」，并且不再轮转目录：
       · 当前文件被截断时，快照仍保留完整序列（先写后读，不回退）
       · 不再产生 .hist-snap.old-* 这种 100MB+ 的目录
     同一天以「当前文件的值」为准（官网可能修订），其余日期保留。 */
  fs.mkdirSync(SNAP, { recursive: true });
  let n = 0, kept = 0;
  fs.readdirSync(HIST).forEach((f) => {
    if (!f.endsWith('.json')) return;
    const pCur = path.join(HIST, f);
    const pSnap = path.join(SNAP, f);
    let cur;
    try { cur = JSON.parse(fs.readFileSync(pCur, 'utf8')); } catch (e) { return; }
    const curSeries = cur.series || [];
    let out = cur;
    if (fs.existsSync(pSnap)) {
      try {
        const old = JSON.parse(fs.readFileSync(pSnap, 'utf8'));
        const m = new Map();
        (old.series || []).forEach(([d, v]) => m.set(d, v));
        curSeries.forEach(([d, v]) => m.set(d, v));       /* 同日以当前为准 */
        if (m.size > curSeries.length) kept++;
        const arr = Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        out = Object.assign({}, old, cur, {
          series: arr,
          points: arr.length,
          first: arr[0] ? arr[0][0] : '',
          asOf: arr.length ? arr[arr.length - 1][0] : '',
          last: arr.length ? arr[arr.length - 1][1] : null,
        });
      } catch (e) { out = cur; }
    }
    fs.writeFileSync(pSnap, JSON.stringify(out));
    n++;
  });
  try { fs.copyFileSync(INDEX, SNAP_INDEX); } catch (e) {}
  console.log('[snap] 快照已更新', n, '个 hist 文件（其中', kept, '只用快照里的完整历史兜底）');
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
    /* 2026-10-28：并集与文件里已有的完全相同 → 不重写。
       否则每次跑都会重排/重写全部 450 个 hist 文件，制造几百个「1 行变更」的假 diff，
       git 历史被噪声淹没，也白白多传几十 MB。 */
    const samePoint = arr.length === newSeries.length &&
      arr.every((p, i) => p[0] === newSeries[i][0] && p[1] === newSeries[i][1]);
    const headOk = newJ.first === (arr[0] ? arr[0][0] : '') &&
      newJ.asOf === (arr.length ? arr[arr.length - 1][0] : '') &&
      newJ.points === arr.length;
    if (samePoint && headOk) return;
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
