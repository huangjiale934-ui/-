/**
 * 数据新鲜度看门狗 —— 广州精研数据有限公司 · 香港强积金数据平台
 * ================================================================
 * 目的：不再靠人肉发现「今天其实没更新」。
 *
 * 判据（任一不满足即告警）：
 *   A. 两站都能访问，且 status.updateStatus.day == 今天（说明当天有数据任务跑过）
 *   B. funds.updatedAt 距今 < 26 小时
 *   C. 我方 navLatest >= 参考源当前最新日（参考源取 BCT 官方接口的 priceDate）
 *      —— 这一条能区分「源站没发」与「我们漏抓」：源站没发时不误报。
 *   D. 两站一致：count / navLatest / updatedAt 完全相同
 *
 * 输出：data/freshness.json（供页面状态接口与 Actions 摘要读取）
 * 退出码：0 正常；1 异常（CI 里会让 job 失败，GitHub 会发失败邮件）
 *
 * 用法：
 *   node tools/freshness-watch.js            # 只检查、写文件
 *   node tools/freshness-watch.js --mail     # 异常时发邮件（需 data/mail.json）
 *   node tools/freshness-watch.js --quiet
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'data', 'freshness.json');
const MAIL_CFG = path.join(ROOT, 'data', 'mail.json');

const arg = (k) => process.argv.includes('--' + k);
const QUIET = arg('quiet');

/** 带超时的 JSON GET（正确处理多字节：setEncoding，避免 FFFD 误判） */
function getJson(url, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'mpf-freshness/1.0', 'cache-control': 'no-cache' }, timeout }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.setEncoding('utf8');
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(s));
        } catch (e) {
          reject(new Error('JSON 解析失败（' + s.length + ' 字节）'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function hktNow() {
  return new Date(Date.now() + 8 * 3600e3);
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
/** 最近一个工作日（不含今天之后的日期；周一到周五） */
function lastBusinessDay(now) {
  const d = new Date(now.getTime());
  for (let i = 0; i < 10; i++) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) return ymd(d);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymd(d);
}

/** 参考源：BCT 官方接口的 priceDate（取一个计划即可，8 次请求取最大） */
async function referenceLatest() {
  const plans = ['pro-choice', 'series-800', 'strategic-mpf', 'smart-plan', 'industry-choice', 'simple-plan'];
  const dates = [];
  for (const p of plans) {
    try {
      const u = 'https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=' + p + '&date=' + lastBusinessDay(hktNow());
      const j = await getJson(u, 20000);
      const rows = ((j.data || {}).fundInformationList) || [];
      for (const r of rows) {
        const d = (r.fundPerformanceDetail || {}).priceDate;
        if (d) dates.push(d);
      }
    } catch (e) {
      /* 参考源不可用不阻断判定，只记录 */
    }
  }
  dates.sort();
  return dates.length ? dates[dates.length - 1] : '';
}

async function siteStatus(base, params) {
  const j = await getJson(base + '/api/status' + params);
  return j;
}

/** 极简 SMTP（SSL 465 + AUTH LOGIN），不依赖第三方库 */
function sendMail(cfg, subject, body) {
  return new Promise((resolve, reject) => {
    const tls = require('tls');
    const host = cfg.host || 'smtp.qq.com';
    const port = cfg.port || 465;
    const user = cfg.user;
    const pass = cfg.pass;
    if (!user || !pass) return reject(new Error('mail.json 缺少 user/pass'));

    const sock = tls.connect({ host, port, servername: host }, () => {});
    let buf = '';
    let step = 0;
    const to = (cfg.to || []).join(', ');
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const msg = [
      'From: ' + (cfg.fromName ? '=?UTF-8?B?' + b64(cfg.fromName) + '?= ' : '') + '<' + user + '>',
      'To: ' + to,
      'Subject: =?UTF-8?B?' + b64(subject) + '?=',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(body),
    ].join('\r\n');

    const send = (s) => sock.write(s + '\r\n');
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('SMTP 超时'));
    }, 40000);

    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (!/^\d{3} /.test(last)) return;
      buf = '';
      const code = parseInt(last.slice(0, 3), 10);
      try {
        if (step === 0 && code === 220) {
          step = 1;
          return send('EHLO mpf-watch');
        }
        if (step === 1 && code === 250) {
          step = 2;
          sock.write('AUTH LOGIN\r\n');
          return;
        }
        if (step === 2 && code === 334) {
          step = 3;
          sock.write(b64(user) + '\r\n');
          return;
        }
        if (step === 3 && code === 334) {
          step = 4;
          sock.write(b64(pass) + '\r\n');
          return;
        }
        if (step === 4 && code === 235) {
          step = 5;
          return send('MAIL FROM:<' + user + '>');
        }
        if (step === 5 && code === 250) {
          step = 6;
          return send('RCPT TO:<' + (cfg.to || [])[0] + '>');
        }
        if (step === 6 && code === 250) {
          step = 7;
          return send('DATA');
        }
        if (step === 7 && code === 354) {
          step = 8;
          sock.write(msg + '\r\n.\r\n');
          return;
        }
        if (step === 8 && code === 250) {
          send('QUIT');
          clearTimeout(timer);
          sock.end();
          return resolve(true);
        }
        if (code >= 400) {
          clearTimeout(timer);
          sock.destroy();
          return reject(new Error('SMTP ' + code + ' ' + last));
        }
      } catch (e) {
        clearTimeout(timer);
        sock.destroy();
        reject(e);
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  const code = (fs.existsSync(path.join(ROOT, 'data', 'wb-share.txt'))
    ? fs.readFileSync(path.join(ROOT, 'data', 'wb-share.txt'), 'utf8').trim()
    : '');
  const A = 'https://mpf-data.app.workbuddy.host';
  const B = 'https://huangjiale934-ui.github.io/-';

  const problems = [];
  const detail = {};
  let sa = null;
  let sb = null;
  if (code) {
    try {
      sa = await siteStatus(A, '?sharecode=' + code);
      detail.A = { navLatest: sa.navLatest, count: sa.count, updatedAt: sa.updatedAt, build: sa.build, status: sa.updateStatus };
    } catch (e) {
      problems.push('WorkBuddy 站状态接口不可用：' + e.message);
    }
  } else {
    detail.A = null;   /* 云端没有 sharecode：只检查 GitHub 站 */
  }
  try {
    sb = await siteStatus(B, '.json?cb=' + Date.now());
    detail.B = { navLatest: sb.navLatest, count: sb.count, updatedAt: sb.updatedAt, build: sb.build, status: sb.updateStatus };
  } catch (e) {
    problems.push('GitHub 站状态接口不可用：' + e.message);
  }

  const today = ymd(hktNow());
  const ref = await referenceLatest();
  detail.referenceLatest = ref;
  detail.today = today;

  const check = (s, label) => {
    if (!s) return;
    const day = (s.updateStatus || {}).day || '';
    if (day !== today) problems.push(label + ' 当天（' + today + '）没有完成的数据任务（updateStatus.day=' + (day || '空') + '）');
    const ageH = (Date.now() - (s.updatedAt || 0)) / 3600e3;
    if (!s.updatedAt || ageH > 26) problems.push(label + ' 数据时间已 ' + Math.round(ageH) + ' 小时未更新');
    if (ref && s.navLatest && s.navLatest < ref) {
      problems.push(label + ' 净值落后参考源：本站 ' + s.navLatest + ' < BCT ' + ref);
    }
    if (ref && (!s.navLatest || s.navLatest < ref)) {
      /* 已在上一条覆盖 */
    }
    const lag = (s.planLag || {}).lagging;
    if (lag) detail[label + '_planLag'] = lag;
  };
  check(sa, 'WorkBuddy 站');
  check(sb, 'GitHub 站');

  if (sa && sb) {
    if (sa.navLatest !== sb.navLatest) problems.push('两站净值日不一致：' + sa.navLatest + ' vs ' + sb.navLatest);
    if (sa.count !== sb.count) problems.push('两站基金数不一致：' + sa.count + ' vs ' + sb.count);
    if (sa.updatedAt !== sb.updatedAt) problems.push('两站数据时间不一致：' + sa.updatedAtText + ' vs ' + sb.updatedAtText);
  }

  const doc = {
    checkedAt: new Date().toISOString(),
    checkedAtHKT: new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19),
    ok: problems.length === 0,
    problems,
    detail,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1), 'utf8');
  if (!QUIET) {
    console.log('[freshness] ' + (doc.ok ? '正常' : '异常 ' + problems.length + ' 项') + ' | 本站 ' + (sa && sa.navLatest) + ' | 参考源 ' + (ref || 'n/a'));
    problems.forEach((p) => console.log('  · ' + p));
  }

  if (!doc.ok && arg('mail')) {
    let cfg = null;
    try {
      cfg = JSON.parse(fs.readFileSync(MAIL_CFG, 'utf8'));
    } catch (e) {
      /* 云端用 GitHub Secrets 提供，不落盘 */
      if (process.env.MPF_SMTP_USER && process.env.MPF_SMTP_PASS) {
        cfg = {
          user: process.env.MPF_SMTP_USER,
          pass: process.env.MPF_SMTP_PASS,
          to: (process.env.MPF_MAIL_TO || '1171800084@qq.com').split(','),
          host: process.env.MPF_SMTP_HOST || 'smtp.qq.com',
          port: Number(process.env.MPF_SMTP_PORT || 465),
        };
      }
    }
    if (!cfg) console.log('[freshness] 未配置邮件（data/mail.json 或 MPF_SMTP_USER/PASS），跳过发信');
    if (cfg && cfg.user && cfg.pass && (cfg.to || []).length) {
      const body = [
        '强积金数据平台 · 数据新鲜度告警',
        '',
        '检查时间（HKT）：' + doc.checkedAtHKT,
        '本站净值日：' + (sa && sa.navLatest) + '　参考源最新：' + (ref || '无法获取'),
        '两站数据时间：' + (sa && sa.updatedAtText) + ' / ' + (sb && sb.updatedAtText),
        '',
        '异常项：',
        ...problems.map((p) => '  - ' + p),
        '',
        '详情：https://mpf-data.app.workbuddy.host/',
      ].join('\n');
      try {
        await sendMail(cfg, '[强积金] 数据未按时更新 · ' + doc.checkedAtHKT, body);
        console.log('[freshness] 告警邮件已发送至 ' + (cfg.to || []).join(', '));
      } catch (e) {
        console.log('[freshness] 发信失败：' + e.message);
      }
    }
  }

  process.exit(doc.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('[freshness] 运行失败：' + e.message);
  process.exit(2);
});
