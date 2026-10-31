#!/usr/bin/env node
/* GitHub Pages 静态化构建（2026-10-25）
   原理：启动真实 server.js（随机端口）→ 逐一拉取全部 /api/* 响应原样落盘到 site/api/* →
        拷贝 public/* 到 site/ → 杀进程。
   好处：api/*.json 与 Node 版服务逐字节一致（聚合逻辑零漂移），前端只需一个 fetch 适配层。
   用法：node tools/build-static.js   （产物在 site/）
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const PORT = 3977;

function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { 'user-agent': 'build-static/1.0' } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(p + ' → ' + res.statusCode + ' ' + buf.slice(0, 120)));
        resolve(buf);
      });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(SITE, { recursive: true, force: true });
  fs.mkdirSync(path.join(SITE, 'api', 'hist'), { recursive: true });

  /* 1) 启动 server.js */
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(500);
    try { await getJson('/api/status'); up = true; } catch (e) {}
  }
  if (!up) { console.error('server 未能在 20s 内就绪'); process.exit(1); }
  console.log('server 就绪 :' + PORT);

  /* 2) 拉取全部 API 响应 */
  const put = (rel, body) => {
    const p = path.join(SITE, 'api', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };

  const status = await getJson('/api/status');
  put('status.json', status);
  const st = JSON.parse(status);
  console.log('status: count=' + st.count + ' navLatest=' + st.navLatest);

  put('funds.json', await getJson('/api/funds'));
  put('market.json', await getJson('/api/market'));
  put('holdings.json', await getJson('/api/holdings'));
  put('navperf.json', await getJson('/api/navperf'));
  put('hist-index.json', await getJson('/api/hist-index'));
  put('names-en.json', await getJson('/api/names-en'));
  put('trustee-perf.json', await getJson('/api/trustee-perf'));
  put('trustee-idx.json', await getJson('/api/trustee-idx'));
  put('allstats.json', await getJson('/api/allstats'));
  put('news.json', await getJson('/api/news'));
  put('hist-gaps.json', await getJson('/api/hist-gaps').catch(() => JSON.stringify({ error: '未生成', funds: {} })));
  put('indices.json', await getJson('/api/indices?lite=0'));
  put('indices-lite.json', await getJson('/api/indices?lite=1'));
  put('top-y1.json', await getJson('/api/top?k=y1&n=20'));
  put('top-y5a.json', await getJson('/api/top?k=y5a&n=20'));

  /* 3) 逐只 hist（server 响应含 mergeLatestNav 补点，与 Node 版逐字节一致） */
  const perfs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'nav-perf.json'), 'utf8'));
  const fundIds = new Set([].concat(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'funds.json'), 'utf8')).funds.map((f) => String(f.id)),
                                    Object.keys(perfs.funds || {})));
  let n = 0, miss = 0;
  for (const id of fundIds) {
    try {
      put(path.join('hist', id + '.json'), await getJson('/api/hist/' + id));
      n++;
    } catch (e) { miss++; }
  }
  console.log('hist: ' + n + ' 只落盘（无历史 ' + miss + '）');

  /* 4) 拷贝 public/*（静态页与资源） */
  fs.cpSync(path.join(ROOT, 'public'), SITE, { recursive: true });

  /* 4.5) b.js / b.css 合并包静态化（server.js 的动态端点 → 拼装落盘）+
          HTML 引用改写（b.css?p=home 需含 home.css，Pages 忽略 query 无法区分） */
  const P = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  fs.writeFileSync(path.join(SITE, 'b.js'), ['t2s.js', 'i18n.js', 'zhmap.js', 'common.js', 'trend.js', 'xlsx.js'].map(P).join('\n;\n'));
  fs.writeFileSync(path.join(SITE, 'b.css'), ['style.css', 'analysis.css'].map(P).join('\n'));
  fs.writeFileSync(path.join(SITE, 'b-home.css'), ['style.css', 'analysis.css', 'home.css'].map(P).join('\n'));
  const htmls = ['index.html', 'home.html', 'ranking.html'];   /* 2026-10-31 四版：analysis.html 已删除（并入 index#cmp） */
  for (const h of htmls) {
    const hp = path.join(SITE, h);
    if (!fs.existsSync(hp)) continue;
    let t = fs.readFileSync(hp, 'utf8');
    t = t.replace(/b\.css\?p=home[^"']*/g, 'b-home.css')
         .replace(/b\.css\?p=[^"']*/g, 'b.css')
         .replace(/b\.js\?p=[^"']*/g, 'b.js');
    fs.writeFileSync(hp, t);
  }
  console.log('b.js/b.css 拼装 + HTML 引用改写完成');

  /* 2026-10-26 断言（核验 2-01/2-02）：产物 HTML 中不得再出现 href="/"（Pages 子路径会 404 死链） */
  for (const h of htmls) {
    const hp = path.join(SITE, h);
    if (fs.existsSync(hp) && /href="\/"/.test(fs.readFileSync(hp, 'utf8'))) {
      throw new Error('构建断言失败: ' + h + ' 仍含 href="/" —— 请改为相对路径');
    }
  }
  console.log('href="/" 断言通过');

  /* 2026-10-26 新增（致命缓存事故根因）：静态站没有 server.js 的动态 ?v=，
     HTML 里 app.js?v=20261011a 这种手写版本号永远不变 → 部署后浏览器/CDN 仍用旧 JS
     与新 HTML 混搭，表现为「列错位 / 整列数据变 —」。改为按文件内容哈希生成查询串，内容一变 URL 必变。 */
  const crypto = require('crypto');
  const hashCache = {};
  const hv = (rel) => {
    if (hashCache[rel]) return hashCache[rel];
    const fp = path.join(SITE, rel);
    if (!fs.existsSync(fp)) return null;
    const h = crypto.createHash('md5').update(fs.readFileSync(fp)).digest('hex').slice(0, 8);
    hashCache[rel] = h;
    return h;
  };
  let rewritten = 0;
  for (const h of htmls.concat(['404.html'])) {
    const hp = path.join(SITE, h);
    if (!fs.existsSync(hp)) continue;
    let t = fs.readFileSync(hp, 'utf8');
    t = t.replace(/(src|href)="([^"?:/]+\.(?:js|css))(?:\?[^"]*)?"/g, (m, attr, rel) => {
      const hh = hv(rel);
      if (!hh) return m;
      rewritten++;
      return attr + '="' + rel + '?v=' + hh + '"';
    });
    fs.writeFileSync(hp, t);
  }
  console.log('资源版本哈希写入完成（' + rewritten + ' 处）');

  console.log('public/* 已拷贝');

  /* 5) 根路径定位：Pages 上 / → index.html（已拷）✓ */

  child.kill();
  console.log('构建完成 → site/（' + (fs.readdirSync(path.join(SITE, 'api', 'hist')).length) + ' 个 hist 文件）');
  process.exit(0);
})().catch((e) => { console.error('构建失败：', e.message); process.exit(1); });
