/**
 * 单位资产净值核对 —— 广州精研数据有限公司
 * ------------------------------------------------------------------
 * 背景：香港积金局「強積金基金平台」的基金资讯表 **不提供** 单位资产净值列，
 *       净值只有各计划保荐人／受托人官网每日公布。本脚本逐一到各官网读取
 *       最新公布的「每单位资产净值」，与积金局基金列表做匹配后回填。
 *
 * 用法：
 *   node navbuild.js            仅解析已下载页面（tmp/navsrc/*.html）
 *   node navbuild.js --render   先用无头 Chrome 重新抓取各官网页面再解析
 *
 * 输出：data/nav.json
 *   { updatedAt, sources:[{key,label,url,asOf,count}], items:[{fund,unit,scheme,trustee,nav,asOf,src,srcUrl}] }
 * 严格原则：只采用能直接从官网页面读取到的数值，绝不推算、绝不复用旧值；
 *           无法核实的一律不写入，前端显示「待核实」。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, 'tmp', 'navsrc');
const OUT = path.join(ROOT, 'data', 'nav.json');

/* ============================ 资讯来源清单 ============================
 * url   全部取自「积金易 eMPF」平台公布的官方基金价格链接（empf.org.hk/page/fund-prices）
 * file  本地渲染后的页面文件名
 * p     解析方式
 * ==================================================================== */
const SOURCES = [
  {
    key: 'AMTD', label: 'AMTD強積金計劃（銀聯信託）', file: 'AMTD.html',
    // 该计划的价格页未挂在受托人 BCT 官网下；由「積金易平台」官方基金价格页指定的发行方页面
    url: 'https://www.ooogroup.xyz/mpf_price.html',
    trustee: '銀聯信託', scheme: 'AMTD強積金計劃', p: 'amtdTable',
  },
  {
    key: 'HSBC', label: '滙豐強積金智選計劃（滙豐銀行）', file: 'HSBC.html',
    url: 'https://www.hsbc.com.hk/zh-hk/mpf/tool/unit-prices/',
    trustee: 'HSBC', scheme: '滙豐強積金智選計劃', p: 'hsbcTable', ti: 0,
    // 价格表由 XHR 异步注入，25s 虚拟时间不足以渲染出数据行
    budget: 60000,
  },
  {
    key: 'HangSeng', label: '恒生強積金智選計劃（恒生銀行）', file: 'HangSeng.html',
    url: 'https://www.hangseng.com/zh-hk/personal/insurance-mpf/e-mpf/fund-price-performance/',
    trustee: 'HSBC', scheme: '恒生強積金智選計劃', p: 'hsbcTable', ti: 0,
    // 与 HSBC 同源的异步价格表：默认 25s 只渲染出表头（0 只），需 60s 才能拿全 20 只
    budget: 60000,
  },
  {
    key: 'BEA-ITP', label: '東亞（強積金）集成信託計劃（東亞銀行）', file: 'BEA.html',
    url: 'https://www.hkbea.com/cgi-bin/rate_mpfcfp.jsp?language=tc',
    trustee: '東亞', scheme: '東亞（強積金）集成信託計劃', p: 'beaTable', ti: 0,
  },
  {
    key: 'BEA-GSP', label: '東亞（強積金）享惠計劃（東亞銀行）', file: 'BEA.html',
    url: 'https://www.hkbea.com/cgi-bin/rate_mpfcfp.jsp?language=tc',
    trustee: '東亞', scheme: '東亞（強積金）享惠計劃', p: 'beaTable', ti: 1,
  },
  {
    key: 'BEA-IND', label: '東亞（強積金）行業計劃（東亞銀行）', file: 'BEA.html',
    url: 'https://www.hkbea.com/cgi-bin/rate_mpfcfp.jsp?language=tc',
    trustee: '東亞', scheme: '東亞（強積金）行業計劃', p: 'beaTable', ti: 2,
  },
  {
    key: 'BOC-My', label: '我的強積金計劃（中銀保誠）', file: 'BOCmy.html',
    url: 'https://www.bocpt.com/homepage/zh-hk/my-choice-mpf/fund-price-enquiry/',
    trustee: '中銀保誠', scheme: '我的強積金計劃', p: 'bocptDiv',
  },
  {
    key: 'BOC-Easy', label: '中銀保誠簡易強積金計劃（中銀保誠）', file: 'BOCeasy.html',
    url: 'https://www.bocpt.com/homepage/easy-choice-mpf/fund-price-enquiry/',
    trustee: '中銀保誠', scheme: '中銀保誠簡易強積金計劃', p: 'bocptDiv',
  },
  {
    key: 'BCT-Pro', label: 'BCT積金之選（銀聯信託）', file: 'bct_pro-choice.json',
    url: 'https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=pro-choice&date=DATE',
    trustee: '銀聯信託', scheme: 'BCT積金之選', p: 'bctJson',
  },
  {
    key: 'BCT-Strategic', label: 'BCT強積金策略計劃（銀聯信託）', file: 'bct_strategic-mpf.json',
    url: 'https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=strategic-mpf&date=DATE',
    trustee: '銀聯信託', scheme: 'BCT強積金策略計劃', p: 'bctJson',
  },
  {
    key: 'BCT-S800', label: 'BCT強積金計劃800系列（銀聯信託）', file: 'bct_series-800.json',
    url: 'https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=series-800&date=DATE',
    trustee: '銀聯信託', scheme: 'BCT強積金計劃800系列', p: 'bctJson',
  },
  {
    key: 'BCT-Smart', label: 'BCT強積金—明智之選（銀聯信託）', file: 'bct_smart-plan.json',
    url: 'https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=smart-plan&date=DATE',
    trustee: '銀聯信託', scheme: 'BCT強積金—明智之選', p: 'bctJson',
  },
  {
    key: 'BCT-Simple', label: 'BCT強積金—易富之選（銀聯信託）', file: 'bct_simple-plan.json',
    url: 'https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=simple-plan&date=DATE',
    trustee: '銀聯信託', scheme: 'BCT強積金—易富之選', p: 'bctJson',
  },
  {
    key: 'BCT-Industry', label: 'BCT（強積金）行業計劃（銀聯信託）', file: 'bct_industry-choice.json',
    url: 'https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=industry-choice&date=DATE',
    trustee: '銀聯信託', scheme: 'BCT（強積金）行業計劃', p: 'bctJson',
  },
  {
    key: 'SunLife', label: '永明彩虹強積金計劃（永明）', file: 'SunLife.html',
    url: 'https://www.sunlife.com.hk/zh-hant/investments/mpf-orso-fund-prices-performance/mpf-fund-prices-performance.type-MPF/',
    trustee: '永明', scheme: '永明彩虹強積金計劃', p: 'sunlifeTable', ti: 0,
  },
  {
    key: 'AIA', label: '友邦強積金優選計劃（友邦信托）', file: 'AIA.html',
    url: 'https://www.aia.com.hk/zh-hk/products/mpf/list',
    trustee: '友邦信託', scheme: '友邦強積金優選計劃', p: 'aiaTable', ti: 1,
  },
  {
    key: 'YF', label: '萬全強制性公積金計劃（萬通信託）', file: 'YFLife.html',
    url: 'https://www.yflife.com/tc/Hong-Kong/Corporate/MPF/Fund-Price-History/',
    trustee: '萬通', scheme: '萬全強制性公積金計劃', p: 'yfTable', ti: 1,
  },
  {
    key: 'BOCOM', label: '交通銀行愉盈退休強積金計劃（交通銀行信託）', file: 'BOCOM.html',
    url: 'https://www.bocomtrust.com.hk/BankCommSite/shtml/trust/tw/2600764/2600785/2600787/2600908/2600910/list.shtml',
    trustee: '交通', scheme: '交通銀行愉盈退休強積金計劃', p: 'bocomTable', ti: 1,
    budget: 45000,
  },
  {
    key: 'ChinaLife', label: '中國人壽強積金集成信託計劃（中國人壽信託）· 單位淨值', file: 'ChinaLife.html',
    url: 'https://trustee.chinalife.com.hk/mpf/dailyPrices?request_locale=zh_TW',
    trustee: '中國人壽', scheme: '中國人壽強積金集成信託計劃', p: 'hsbcTable', ti: 0,
    budget: 45000,
  },
  {
    key: 'Fidelity', label: '富達退休集成信託（富達）', file: 'Fidelity.html',
    url: 'https://www.fidelity.com.hk/zh/our-funds/mpf',
    trustee: 'HSBC', scheme: '富達退休集成信託', p: 'fidelityCards',
  },
  {
    key: 'Manu-GS', label: '宏利環球精選（強積金）計劃（宏利）', file: 'manu_gs_cn2.html',
    url: 'https://www.manulife.com.hk/zh-hk/individual/fund-price/mpf.html/v2?product=%E5%AE%8F%E5%88%A9%E7%92%B0%E7%90%83%E7%B2%BE%E9%81%B8%28%E5%BC%B7%E7%A9%8D%E9%87%91%29%E8%A8%88%E5%8A%83',
    trustee: '宏利', scheme: '宏利環球精選（強積金）計劃', p: 'manulifeList',
  },
  {
    key: 'Manu-RC', label: '宏利退休精選（強積金）計劃（宏利）', file: 'manu_rc_cn2.html',
    url: 'https://www.manulife.com.hk/zh-hk/individual/fund-price/retirechoice.html/v2/fundlist?product=%E5%AE%8F%E5%88%A9%E9%80%80%E4%BC%91%E7%B2%BE%E9%81%B8%28%E5%BC%B7%E7%A9%8D%E9%87%91%29%E8%A8%88%E5%8A%83',
    trustee: '宏利', scheme: '宏利退休精選（強積金）計劃', p: 'manulifeList',
  },
  {
    key: 'Haitong', label: '海通MPF退休金（海通國際投資經理）', file: 'htisec.html',
    url: 'https://www.htisec.com/asm/tc/mpf.jsp?type=1',
    trustee: 'HSBC', scheme: '海通MPF退休金', p: 'haitongCards',
    // 2026-10-10 起改为自动抓取：该站此前在本机偶发不可达，曾用人工核对落盘（htisec.json）；
    // 现本机 Chrome 可稳定访问，故恢复自动抓取，避免净值停在旧日期。
  },
  {
    key: 'SHKP', label: '新地強積金僱主營辦計劃（新鴻基地產）', file: 'SHKP.json',
    url: 'https://www.shkp.com/Html/MPF/Fund%20Price%20and%20FFS%20for%20SHKPESS.pdf',
    trustee: '渣打信托', scheme: '新地強積金僱主營辦計劃', p: 'rawJson',
    // 月度价格 PDF：Chrome dump-dom 拿不到表格内容，改由 tmp/shkp_nav.py 抽取为 SHKP.json
    noRender: true,
  },
];

/**
 * 对外展示用的「人类可读官网页面」。
 * ------------------------------------------------------------------
 * `SOURCES[].url` 是抓取地址，其中若干条是 JSON／异步接口（如 BCT 的 servlet），
 * 直接拿给用户点击会看到一堆原始 JSON 甚至报错，观感很差。故此处为每条来源
 * 单独维护一个可在浏览器里正常阅读的官网页面地址，均已逐条实测可达。
 * 未列出的来源表示抓取地址本身即人类可读页面。
 */
const PAGE_LINKS = {
  AMTD: 'https://www.ooogroup.xyz/mpf_price.html',
  'BCT-Pro': 'https://www.bcthk.com/zh/mpf-orso/fund-information/fund-prices#cat-1',
  'BCT-Strategic': 'https://www.bcthk.com/zh/mpf-orso/fund-information/fund-prices#cat-2',
  'BCT-S800': 'https://www.bcthk.com/zh/mpf-orso/fund-information/fund-prices#cat-3',
  'BCT-Smart': 'https://www.bcthk.com/zh/mpf-orso/fund-information/fund-prices#cat-4',
  'BCT-Simple': 'https://www.bcthk.com/zh/mpf-orso/fund-information/fund-prices#cat-5',
  'BCT-Industry': 'https://www.bcthk.com/zh/mpf-orso/fund-information/fund-prices#cat-6',
  // 展示链接必须落在「強積金」价格页（旧链接落在公積金/ORSO 区，客户核对会看不到强积金数据）
  BOCOM: 'https://www.bocomtrust.com.hk/BankCommSite/shtml/trust/tw/2600764/2600785/2600787/2600908/2600910/list.shtml',
  ChinaLife: 'https://trustee.chinalife.com.hk/mpf/dailyPrices?request_locale=zh_TW',
  Fidelity: 'https://www.fidelity.com.hk/zh/our-funds/mpf',
  Haitong: 'https://www.htisec.com/asm/tc/mpf.jsp?type=1',
  'Manu-GS': 'https://www.manulife.com.hk/zh-hk/individual/fund-price/mpf.html/v2',
  'Manu-RC': 'https://www.manulife.com.hk/zh-hk/individual/fund-price/retirechoice.html/v2/fundlist',
};

/* ============================ 渲染（可选） ============================ */
/* 2026-10-28：原来写死 Windows 路径，GitHub Actions（ubuntu）上永远「未找到 Chrome」，
   导致云端 navbuild 一条官网快照都产不出来、只刷新 updatedAt —— 云端看着更新了其实没数据。
   这里改为跨平台探测，可用 CHROME_PATH 环境变量覆盖。 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch (e) { return false; }
}) || CHROME_CANDIDATES[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* BCT 等接口要求真实估值日；DATE 占位符若原样请求会返回 data:null。
 * 这里由今天起向前回溯若干天，直到拿到有效数据。 */
function urlCandidates(url) {
  if (url.indexOf('DATE') < 0) return [url];
  const out = [];
  const base = new Date(Date.now() + 8 * 3600e3);
  for (let i = 0; i < 10; i++) {
    const d = new Date(base.getTime() - i * 86400000);
    out.push(url.replace(/DATE/g, d.toISOString().slice(0, 10)));
  }
  return out;
}

/** 抓取结果是否有效：避免把错误页 / 空数据覆盖掉上一次的好文件 */
function isValid(res, s) {
  if (!res || res.length < 500) return false;
  if (/"data"\s*:\s*null/.test(res)) return false;
  if (s.p === 'bctJson' && res.indexOf('fundInformationList') < 0) return false;
  if (res.indexOf('Access Denied') >= 0 || res.indexOf('error code:') >= 0) return false;
  return true;
}

function renderAll() {
  if (!fs.existsSync(CHROME)) {
    console.log('[NAV] 未找到 Chrome，跳过渲染（已尝试：' + CHROME_CANDIDATES.join(' / ') + '）');
    return false;
  }
  console.log('[NAV] 渲染器：' + CHROME);
  fs.mkdirSync(SRC_DIR, { recursive: true });
  const done = {};
  for (const s of SOURCES) {
    if (done[s.file]) continue;
    done[s.file] = 1;
    const out = path.join(SRC_DIR, s.file);
    // PDF 等非 HTML 源由外部脚本（如 shkp_nav.py）预先抽取，不能用 dump-dom 覆盖
    if (s.noRender) {
      const sz = fs.existsSync(out) ? fs.statSync(out).size : 0;
      console.log('       ' + s.file + '  跳过渲染（保留已有文件' + (sz ? '，' + sz + ' bytes' : '，缺失!') + '）');
      continue;
    }
    let ok = false;
    for (const u of urlCandidates(s.url)) {
      const res = fetchDom(u, s.key, s.budget);
      if (isValid(res, s)) { fs.writeFileSync(out, res); ok = true; break; }
    }
    if (ok) console.log('       ' + s.file + '  ' + fs.statSync(out).size + ' bytes');
    else console.error('       ' + s.file + '  抓取无效，保留上一次文件');
  }
  return true;
}

function fetchDom(url, key, budget) {
  const ms = budget || 25000;
  const udd = path.join(os.tmpdir(), 'nav-' + key);
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--user-data-dir=' + udd, '--virtual-time-budget=' + ms,
    '--window-size=1920,3000', '--user-agent=' + UA, '--dump-dom', url];
  try {
    return execFileSync(CHROME, args, { maxBuffer: 128 * 1024 * 1024, timeout: ms + 150000 }).toString();
  } catch (e) {
    try {
      return execFileSync('timeout', [String(Math.ceil((ms + 150000) / 1000)), CHROME].concat(args),
        { maxBuffer: 128 * 1024 * 1024, timeout: ms + 170000 }).toString();
    } catch (e2) {
      console.error('[NAV] 读取失败 ' + key + ': ' + e2.message);
      return null;
    }
  }
}

/* ============================ 通用工具 ============================ */
const clean = (s) =>
  String(s == null ? '' : s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, '')
    .replace(/\u200b|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** 名称归一化：全角转半角、去空格、去脚注星号，用于跨站点比对基金名 */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[*#＊#]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .toLowerCase();
}

function readFile(f) {
  const p = path.join(SRC_DIR, f);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function cleanHtml(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

// 从可能是「纯 JSON」或「Chrome dump-dom 包装后的 JSON」的文本中还原对象
// dump-dom 输出形如 <html><head>…</head><body><pre>{…}</pre></body></html>
function jsonFrom(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { /* 继续尝试解包 */ }
  // 优先取 <pre> 内容（Chrome 把 JSON 放进 pre 并做 HTML 转义）
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(s);
  const cand = pre ? pre[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  const txt = String(cand)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
  try { return JSON.parse(txt); } catch (e2) { return null; }
}

function rowsOf(html, ti) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const t = tables[ti];
  if (!t) return [];
  const out = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(t))) {
    const cells = [];
    const cre = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cre.exec(m[1]))) cells.push(clean(c[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}

function num(s) {
  const m = /(-?\d[\d,]*\.?\d*)/.exec(String(s).replace(/,/g, ''));
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

// 源页面未提供显式估值日时的兜底：扫描全文日期，只接受距今天 45 天内的值
// （避免误取基金成立日、条款生效日等历史日期）
function fallbackAsOf(raw) {
  const txt = String(raw || '');
  const now = Date.now();
  const span = 45 * 86400e3;
  const found = [];
  const push = (y, m, d) => {
    const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const t = Date.parse(iso + 'T00:00:00Z');
    if (!Number.isFinite(t)) return;
    if (t > now + 86400e3 || t < now - span) return; // 未来或过旧
    found.push(iso);
  };
  const reDMY = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(20\d{2})/g;
  let m;
  while ((m = reDMY.exec(txt))) push(m[3], +m[2], +m[1]);
  const reISO = /(20\d{2})-(\d{1,2})-(\d{1,2})/g;
  while ((m = reISO.exec(txt))) push(m[1], +m[2], +m[3]);
  const reCN = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  while ((m = reCN.exec(txt))) push(m[1], +m[2], +m[3]);
  if (!found.length) return '';
  const cnt = {};
  found.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; });
  return Object.keys(cnt).sort((a, b) => (cnt[b] - cnt[a]) || (a < b ? 1 : -1))[0];
}

function pickDate(text, patterns) {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1] || (m[1] || '');
  }
  return '';
}

/** 各种日期写法 → YYYY-MM-DD */
function toIso(d) {
  if (!d) return '';
  let m = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(d);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(d);
  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  return '';
}

/* ============================ 各站点解析器 ============================ */
const PARSERS = {
  // 汇丰 / 恒生 / 中国人寿：表格第一列为基金名，第二列为净值
  hsbcTable(s, html) {
    const h = cleanHtml(html);
    const t = clean(h);
    const asOf = toIso(
      (/單位價格日期\s*(\d{4}-\d{2}-\d{2})/.exec(t) ||
        /價格日期\s*(\d{4}-\d{2}-\d{2})/.exec(t) ||
        /截至[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日)/.exec(t) ||
        /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/.exec(t) || [])[1] || ''
    );
    return rowsOf(h, s.ti)
      .slice(1)
      .map((c) => {
        const name = String(c[0] || '').replace(/\s*註?\s*\d+\s*$/, '').trim();
        const v = num(c[1]);
        return v == null ? null : { fund: name, nav: v, asOf };
      })
      .filter(Boolean);
  },

  // 东亚银行：同一页三个表格对应三个计划；日期写在「最新成分基金價格 (截至: dd/mm/yyyy)」
  beaTable(s, html) {
    const h = cleanHtml(html);
    const t = clean(h);
    const asOf = toIso((/截至:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(t) || /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/.exec(t) || [])[1] || '');
    return rowsOf(h, s.ti)
      .slice(1)
      .map((c) => {
        const name = String(c[0] || '').replace(/\s*註\s*\d+\s*$/, '').trim();
        const v = num(c[1]);
        return v == null ? null : { fund: name, nav: v, asOf };
      })
      .filter(Boolean);
  },

  // 中银保诚：无 table，用形如「成分基金* | 我的增長基金 | 賣出價 (港幣) | 26.95640」的版块
  bocptDiv(s, html) {
    const h = cleanHtml(html);
    const t = clean(h.replace(/<[^>]+>/g, '|'));
    const asOf = toIso((/定價日[^0-9]{0,12}(\d{1,2}\/\d{1,2}\/\d{4})/.exec(t) || /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/.exec(t) || [])[1] || '');
    const re = /成分基金\*?[\s|]*([^|]+?)[\s|]*賣出價\s*\(港幣\)[\s|]*([\d.,]+)/g;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(t))) {
      const name = m[1].trim();
      const v = num(m[2]);
      if (!name || v == null || seen.has(name)) continue;
      seen.add(name);
      out.push({ fund: name, nav: v, asOf });
    }
    return out;
  },

  // BCT：形如「BCT 中國及香港股票基金 2 基金價格 1 HKD 1.1472 截至 2026年10月06日」
  bctDiv(s, html) {
    const h = cleanHtml(html);
    const flat = clean(h);
    // 页面版式：… BCT 中國及香港股票基金 2 基金價格 1 HKD 1.1472 截至 2026年10月06日 …
    const re = /HKD\s*\s*([\d.,]+)\s*截至\s*(\d{4}年\d{1,2}月\d{1,2}日)/g;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(flat))) {
      const v = num(m[1]);
      if (v == null) continue;
      let seg = flat.slice(Math.max(0, m.index - 200), m.index);
      const k = seg.lastIndexOf('基金價格');
      if (k >= 0) seg = seg.slice(0, k);
      // 去掉尾部的脚注序号 / 「派息」标签 / 空白
      seg = seg.replace(/[\s\d]+$/, '').replace(/派息$/, '').trim();
      const tail = seg.length > 60 ? seg.slice(-60) : seg;
      // 页面同时输出桌面版与移动端两套列表，名称前会夹带上一条基金的表现数据，故取最后一个基金名
      const cands = tail.match(/BCT\s?[^\s]{0,30}?基金/g);
      const at = tail.lastIndexOf('BCT');
      let name = cands && cands.length ? cands[cands.length - 1] : tail;
      if (at >= 0 && (!cands || !cands.length)) name = tail.slice(at);
      name = String(name).trim();
      const key = norm(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ fund: name, nav: v, asOf: toIso(m[2]) });
    }
    return out;
  },

  // 永明：表格首列为「基金名 + 单位类别」，另有独立的单位类别列
  sunlifeTable(s, html) {
    const h = cleanHtml(html);
    const asOf = toIso((/截至\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(clean(h)) || [])[1] || '');
    const seen = new Set();
    return rowsOf(h, s.ti)
      .slice(1)
      .map((c) => {
        const full = String(c[0] || '');
        const unit = String(c[1] || '').trim();
        const fund = full.replace(new RegExp('單位類別\\s*' + unit + '.*$'), '').trim();
        const v = num(c[3] != null ? c[3] : c[2]);
        if (v == null) return null;
        const key = fund + '#' + unit;
        if (seen.has(key)) return null;
        seen.add(key);
        return { fund, unit, nav: v, asOf };
      })
      .filter(Boolean);
  },

  // 海通（卡片式）：每张卡片＝一只成分基金，内含 A/T 类别的单位价格与「截至 YYYY年M月D日」。
  // 注意：页面下方还有「核准匯集投資基金 (APIF)」段落，不属于强积金计划成分基金，需排除。
  haitongCards(s, raw) {
    const txt = clean(cleanHtml(String(raw)));
    const cut = txt.indexOf('核准匯集投資基金');
    const seg = cut > 0 ? txt.slice(0, cut) : txt;
    const out = [];
    const re = /(海通[^\s]{1,12}基金)\s+成分基金([\s\S]*?)(?:截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|$)/g;
    let m;
    while ((m = re.exec(seg))) {
      const fund = m[1];
      const asOf = m[3] ? m[3] + '-' + String(m[4]).padStart(2, '0') + '-' + String(m[5]).padStart(2, '0') : '';
      const rre = /單位價格\s*-\s*([A-Z])\s*類別\s*單位價格\s*([\d.]+)\s*\(港元\)/g;
      let r;
      while ((r = rre.exec(m[2]))) {
        const v = num(r[2]);
        if (v != null) out.push({ fund: fund, unit: r[1], nav: v, asOf: asOf });
      }
    }
    return out;
  },

  // 友邦：列序为 基金类别 / 成分基金 / 风险级别 / 投资经理 / 货币 / 单位价格 / 计值日期
  aiaTable(s, html) {
    const h = cleanHtml(html);
    const asOf = toIso((/(\d{1,2}-\d{1,2}-\d{4})/.exec(clean(h)) || [])[1] || '');
    const out = [];
    for (const c of rowsOf(h, s.ti).slice(1)) {
      const name = String(c[1] || '').replace(/[#＊*]/g, '').trim();
      const v = num(c[5]);
      if (v == null) continue;
      out.push({ fund: name, nav: v, asOf: (c[6] ? toIso(c[6]) : '') || asOf });
    }
    // 友邦「保證組合」为非单位化基金，官网明确不提供单位价格 —— 标注为「不适用」而非「待核实」
    const flat = clean(h);
    if (/保證組合[\s\S]{0,60}本基金為非單位化基金/.test(flat)) {
      out.push({ fund: '保證組合', nav: null, na: true, asOf });
    }
    return out;
  },

  // 万通：列序 成分基金名称 / 货币 / 单位价格 / 估值日期（月/日/年）
  yfTable(s, html) {
    const h = cleanHtml(html);
    const out = [];
    for (const c of rowsOf(h, s.ti).slice(1)) {
      const name = String(c[0] || '').replace(/[#＊*]/g, '').trim();
      const v = num(c[2]);
      if (v == null) continue;
      let asOf = '';
      const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(c[3] || ''));
      if (m) asOf = m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
      out.push({ fund: name, nav: v, asOf });
    }
    return out;
  },

  // 富达：基金以卡片呈现，「名稱 價格 港元 日變動%」
  fidelityCards(s, html) {
    const h = cleanHtml(html);
    const t = clean(h);
    const asOf = toIso((/截至\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(t) || [])[1] || '');
    const out = [];
    const seen = new Set();
    const re = /([^\s][^\s]{0,26}?)\s+(\d{1,4}\.\d{2,6})\s*港元\s*-?\d+\.\d+%/g;
    let m;
    while ((m = re.exec(t))) {
      let name = m[1].trim();
      const v = num(m[2]);
      if (v == null || !name) continue;
      name = name.replace(/^.*?(\d|風險級別)\s*/, '');
      const key = norm(name);
      if (seen.has(key) || /%$/.test(name)) continue;
      seen.add(key);
      out.push({ fund: name, nav: v, asOf });
    }
    return out;
  },

  // 交通银行：列序 成分基金 / 发售价(港币) / 赎回价(港币)
  bocomTable(s, html) {
    const h = cleanHtml(html);
    const asOf = toIso((/估值日\s*(\d{4}-\d{2}-\d{2})/.exec(clean(h)) || [])[1] || '');
    const out = [];
    for (const c of rowsOf(h, s.ti).slice(1)) {
      const v = num(c[1]);
      if (v == null) continue;
      out.push({ fund: String(c[0] || '').trim(), nav: v, asOf });
    }
    return out;
  },

  /* ---------------- 新接入来源 ---------------- */

  // BCT：官方 Angular 站点背后的 JSON 服务（fundInformation）
  // 结构：data.fundInformationList[] = { name, unitClass, fundPerformanceDetail:{ price, priceDate } }
  bctJson(s, raw) {
    let j = jsonFrom(raw);
    const list = (j && j.data && j.data.fundInformationList) || [];
    const out = [];
    for (const it of list) {
      const d = it.fundPerformanceDetail || {};
      const v = num(d.price);
      if (v == null) continue;
      out.push({
        fund: String(it.name || '').trim(),
        unit: String(it.unitClass || '').trim(),
        nav: v,
        asOf: d.priceDate || '',
      });
    }
    return out;
  },

  // 宏利：Angular 渲染后的「Latest prices」列表
  // 每个条目为 <div id="funditemN">，内含 <h3>基金名</h3> 与 <span class="price">净值</span>
  manulifeList(s, html) {
    const h = cleanHtml(html);
    const segs = h.split(/(?=<div[^>]*\sid="funditem\d+")/);
    const out = [];
    const seen = new Set();
    for (const seg of segs) {
      if (!/id="funditem\d+"/.test(seg.slice(0, 200))) continue;
      const nm = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(seg);
      if (!nm) continue;
      const raw = clean(nm[1]);
      // 去掉脚注星号／尖号；「XXX基金 - 單位A」拆出单位类别
      let name = raw.replace(/[*＊^＾]+/g, '').trim();
      // 去掉名称尾部的脚注符号（Ø ‡ † 等）
      name = name.replace(/[^A-Za-z0-9)\]）\u3400-\u4dbf\u4e00-\u9fff]+$/, '').trim();
      let unit = '';
      const um = /^(.*?)\s*[-－–]\s*(?:單位|單位類別)?\s*([A-Za-z0-9]{1,2})\s*(?:類別)?$/.exec(name);
      if (um) { name = um[1].trim(); unit = um[2].toUpperCase(); }
      const pr = /class="price"[^>]*>([\s\S]*?)<\/span>/.exec(seg);
      const v = pr ? num(clean(pr[1])) : null;
      if (!name) continue;
      const txt = clean(seg);
      const dt = /(?:截至|as of)\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(txt);
      const asOf = dt ? toIso(dt[1]) : '';
      const key = norm(name) + '#' + unit;
      if (seen.has(key)) continue;
      seen.add(key);
      // 保证基金（如「宏利MPF利息基金」）官网不公布单位资产净值 —— 标注「不适用」
      if (v == null) out.push({ fund: name, unit, nav: null, na: true, asOf });
      else out.push({ fund: name, unit, nav: v, asOf });
    }
    return out;
  },

  // 海通国际：静态页面，形如「基金名 | 成分基金 | 單位價格 - A類別 | 單位價格 | 12.6 (港元) | 變動 | 0.00%」
  haitongCards(s, html) {
    const t = cleanHtml(html)
      .replace(/<[^>]+>/g, '|')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .replace(/\s*\|\s*/g, '|')
      .replace(/\|+/g, '|');
    const words = t.replace(/\|/g, ' ');
    let asOf = '';
    const dm = /截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(words);
    if (dm) asOf = dm[1] + '-' + String(dm[2]).padStart(2, '0') + '-' + String(dm[3]).padStart(2, '0');
    const marks = [];
    const hre = /([^|]{2,40})\|成分基金\|/g;
    let h;
    while ((h = hre.exec(t))) marks.push({ name: h[1].trim(), idx: h.index });
    const out = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx;
      const end = i + 1 < marks.length ? marks[i + 1].idx : t.length;
      let seg = t.slice(start, end);
      const cut = seg.indexOf('|核准匯集投資基金|');
      if (cut > 0) seg = seg.slice(0, cut);
      const name = marks[i].name;
      const re = /\|單位價格\s*-\s*([A-Za-z0-9]{1,6})\s*(?:類別)?\|[^|]*\|([\d.,]+)\s*\(港元\)/g;
      let m;
      while ((m = re.exec(seg))) {
        const v = num(m[2]);
        if (v == null) continue;
        out.push({ fund: name, unit: m[1].toUpperCase(), nav: v, asOf });
      }
    }
    return out;
  },

  // 由外部脚本（PDF 解析等）预先抽取好的 [{fund,unit,nav,asOf,na}]
  /**
   * AMTD 计划价格页（積金易平台官方基金价格页指定的发行方页面）。
   * 页面里同时存在两个表格：一个 style="display:none" 的旧日期快照，一个是当前可见的最新表。
   * 必须跳过隐藏表，只读可见表，并把表头里的日期当作估值日。
   */
  amtdTable(s, raw) {
    const tables = raw.match(/<table[\s\S]*?<\/table>/g) || [];
    let best = null;
    for (const tb of tables) {
      if (/style="[^"]*display:\s*none/.test(tb.slice(0, 400))) continue; // 隐藏的旧表，跳过
      const rows = [...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
      if (rows.length < 2) continue;
      const headText = rows[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      // 页面表头写法为「年-月-日」且年份取两位（如 26-10-07 = 2026年10月7日，另见旧表 26-4-24）
      const d = /(\d{2,4})-(\d{1,2})-(\d{1,2})/.exec(headText);
      let asOf = '';
      if (d) {
        const yy = d[1].length === 2 ? 2000 + +d[1] : +d[1];
        asOf = yy + '-' + String(+d[2]).padStart(2, '0') + '-' + String(+d[3]).padStart(2, '0');
      }
      const items = [];
      for (let i = 1; i < rows.length; i++) {
        const cells = [...rows[i].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/g)]
          .map((m) => m[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        if (cells.length < 2) continue;
        const fund = clean(cells[0]);
        const nav = num(cells[1]);
        if (!fund || nav == null) continue;
        items.push({ fund, unit: '', nav, asOf });
      }
      if (items.length && (!best || asOf > best.asOf)) best = { asOf, items };
    }
    return best ? best.items : [];
  },

  rawJson(s, raw) {
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : j.items || [];
      return arr.map((x) => ({
        fund: String(x.fund || '').trim(),
        unit: String(x.unit || '').trim(),
        nav: x.nav == null ? null : num(x.nav),
        na: !!x.na,
        asOf: x.asOf || '',
      }));
    } catch (e) {
      return [];
    }
  },
};

/* ============================ 主流程 ============================ */
function build() {
  const items = [];
  const sources = [];
  const cntByKey = {};   // 各来源本次取得的可核实条数（用于来源失效告警）
  for (const s of SOURCES) {
    const raw = readFile(s.file);
    if (raw == null) {
      console.log('[NAV] × ' + s.key + ' 缺文件 ' + s.file);
      cntByKey[s.key] = null;
      continue;
    }
    const fn = PARSERS[s.p];
    let rows = [];
    try {
      rows = fn(s, raw) || [];
    } catch (e) {
      console.log('[NAV] × ' + s.key + ' 解析异常: ' + e.message);
    }
    rows = rows.filter((r) => r.fund && (r.na || r.nav != null));
    const priced = rows.filter((r) => r.nav != null);
    cntByKey[s.key] = priced.length;
    const naCnt = rows.length - priced.length;
    const asOf = priced.find((r) => r.asOf) ? priced.find((r) => r.asOf).asOf : fallbackAsOf(raw);
    console.log('[NAV] √ ' + s.key.padEnd(13) + ' ' + String(priced.length).padStart(3) + ' 只' +
      (naCnt ? ' + ' + naCnt + ' 条不适用' : '') + (asOf ? '  截至 ' + asOf : ''));
    // 部分官方接口（如 BCT）必须带真实估值日，URL 中的 DATE 占位符在此落地
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const realUrl = String(s.url || '').replace(/DATE/g, asOf || today);
    sources.push({
      key: s.key, label: s.label, url: realUrl, asOf, count: priced.length, na: naCnt,
      // 对外展示用的人类可读官网页面（个别来源的抓取地址是 JSON 接口，不宜直接点击）
      page: PAGE_LINKS[s.key] || realUrl,
    });
    rows.forEach((r) => {
      items.push({
        trustee: s.trustee,
        scheme: s.scheme,
        fund: r.fund,
        unit: r.unit || '',
        nav: r.nav,
        na: !!r.na,
        asOf: r.asOf || asOf,
        src: s.label,
        srcUrl: realUrl,
      });
    });
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  // 防退化：若本次条数明显少于上一次，说明部分官网来源抓取/解析失败。
  // 此时绝不能覆盖上一次的完整结果——否则已核实的净值会被大面积打成「待核实」。
  let prev = null;
  try {
    if (fs.existsSync(OUT)) prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch (e) { prev = null; }

  /* ---------- 来源失效自动告警 ----------
   * 某来源本次条数归零（读取/解析失败）或较上一次骤降三成以上时记录在案，
   * 由 /api/status、/api/market 与前端「净值说明」条共同展示——绝不静默退化成「待核实」。 */
  const prevCnt = {};
  if (prev && Array.isArray(prev.sources)) prev.sources.forEach((s) => { prevCnt[s.key] = s.count || 0; });
  const alerts = [];
  for (const s of SOURCES) {
    const now = cntByKey[s.key];
    const before = prevCnt[s.key] || 0;
    /* 2026-10-25 修 P2-4：SHKP 为月度 PDF 且渲染链路偶发失败，「源文件缺失」易被误读为官方没发布
       （核验证实官网 PDF 可正常下载）。文案改为如实描述：本次渲染/抽取失败，保留上月数据 */
    if (now == null) alerts.push({ key: s.key, label: s.label, prev: before, now: 0, level: 'fail', msg: '本次抓取失败，已保留上次数据（非官方未发布；月度来源请留意下轮）' });
    else if (before > 0 && now === 0) alerts.push({ key: s.key, label: s.label, prev: before, now: 0, level: 'fail', msg: '本次解析结果为 0 条，官网页面可能改版或被拦截' });
    else if (before > 5 && now < before * 0.7) alerts.push({ key: s.key, label: s.label, prev: before, now: now, level: 'degrade', msg: '条数较上次骤降，部分基金可能未取到' });
  }
  /* ---------- 按来源防退化（2026-10-10 新增）----------
   * 只按「总量 90%」兜底是不够的：今天 AIA 单源解析为 0 条（页面渲染不完整），
   * 总量 430/451 = 95% 仍会照写，导致 21 条已核实净值静默消失。
   * 这里改为按来源兜底：某来源本次为 0 条而上次有值 → 沿用上一次该来源的条目，
   * 并把该来源的 count / asOf 还原为上一次的值（告警仍然保留，绝不静默）。 */
  if (prev && Array.isArray(prev.items) && prev.items.length) {
    const prevBySrc = {};
    prev.items.forEach((it) => { const k = it.src || ''; if (k) (prevBySrc[k] = prevBySrc[k] || []).push(it); });
    const nowSrc = {};
    items.forEach((it) => { if (it.src) nowSrc[it.src] = 1; });
    const carried = [];
    Object.keys(prevBySrc).forEach((k) => {
      if (nowSrc[k]) return;
      const old = prevBySrc[k];
      if (!old.length) return;
      /* 2026-10-17：去重——同方案+同基金已被本次官方源取到则不再追加旧条目，
         防止「etnet 影子值」覆盖官方新值（此前 125 条重复，官方 10-15 被 10-14 顶掉） */
      const seen = new Set(items.map((it) => (it.scheme || '') + '|' + (it.fund || '')));
      const kept = old.filter((it) => !seen.has((it.scheme || '') + '|' + (it.fund || '')));
      if (!kept.length) return;
      kept.forEach((it) => items.push(it));
      carried.push({ src: k, n: kept.length });
      const ps = (prev.sources || []).find((x) => x.label === k);
      const cs = sources.find((x) => x.label === k);
      if (cs && ps) { cs.count = ps.count; cs.asOf = ps.asOf; cs.carried = true; }
    });
    if (carried.length) {
      console.log('[NAV] ⚠ ' + carried.map((c) => c.src + ' ' + c.n + ' 条').join('、') +
        ' 本次解析为 0 条，已沿用上一次核对结果（详见 alerts）');
    }
  }

  const totalNow = items.length;
  const totalPrev = prev && Array.isArray(prev.items) ? new Set(prev.items.map((x) => (x.scheme || "") + "|" + (x.fund || ""))).size : 0;

  if (prev && Array.isArray(prev.items) && totalPrev &&
      totalNow < totalPrev * 0.9) {
    console.error('\n[NAV] 本次仅取得 ' + totalNow + ' 条，不足上一次 ' + totalPrev +
      ' 条的 90%，判定为抓取异常 → 已放弃写入，保留上一次完整的 ' + totalPrev + ' 条');
    if (!alerts.length) alerts.push({ key: '-', label: '整体抓取', prev: totalPrev, now: totalNow, level: 'degrade', msg: '本次抓取总量不足上一次的 90%，已沿用上一次核对结果' });
    // 告警必须落盘，否则「静默失败」——条目沿用上一次，仅追加 alerts 字段
    const merged = Object.assign({}, prev, { alerts: alerts, alertsAt: Date.now() });
    try { fs.writeFileSync(OUT, JSON.stringify(merged, null, 1)); } catch (e) { console.error('[NAV] 告警写入失败: ' + e.message); }
    return merged;
  }

  /* 2026-10-19：navAsOf 缺失时用 hist-index 末点日期回填
     （人寿等 SPA 站点的静态快照无日期文本，导致详情页「估值日」空白） */
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hist-index.json'), 'utf8')).funds || {};
    const byKey = {};
    for (const [fid, v] of Object.entries(idx)) {
      if (v && v.asOf) byKey[(v.scheme || '') + '|' + (v.name || '')] = v.asOf;
    }
    let filled = 0;
    items.forEach((it) => {
      if (!it.asOf) {
        const a = byKey[(it.scheme || '') + '|' + (it.fund || '')];
        if (a) { it.asOf = a; filled++; }
      }
    });
    if (filled) console.log('[NAV] navAsOf 缺失回填（hist-index 末点）：' + filled + ' 条');
  } catch (e) { console.error('[NAV] navAsOf 回填失败: ' + e.message); }

  const out = { updatedAt: Date.now(), sources, items, alerts: alerts, alertsAt: alerts.length ? Date.now() : 0 };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('\n[NAV] 共取得 ' + items.length + ' 条官方净值，已写入 ' + OUT);

  /* 2026-10-19：同步 navAsOf 到 funds.json（人寿等 SPA 站点的净值日期只能在 nav 里拿到，
     funds.json 由 scraper 生成时该字段为空 → 详情页估值日空白） */
  try {
    const FUNDS = path.join(__dirname, 'data', 'funds.json');
    if (fs.existsSync(FUNDS)) {
      const fd = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
      const by = {};
      items.forEach((x) => { if (x.asOf) by[(x.scheme || '') + '|' + (x.fund || '')] = x.asOf; });
      let n = 0;
      (fd.funds || []).forEach((f) => {
        if (!f.navAsOf) {
          const k = (f.scheme || '') + '|' + (f.fundBase || f.fund || '');
          if (by[k]) { f.navAsOf = by[k]; n++; }
        }
      });
      if (n) {
        fs.writeFileSync(FUNDS, JSON.stringify(fd));
        console.log('[NAV] funds.json 的 navAsOf 已同步：' + n + ' 条');
      }
    }
  } catch (e) { console.error('[NAV] funds.json 同步失败: ' + e.message); }
  return out;
}

function main() {
  if (process.argv.includes('--render')) renderAll();
  build();
}
if (require.main === module) main();
module.exports = { SOURCES, SRC_DIR, build, urlCandidates, isValid };
