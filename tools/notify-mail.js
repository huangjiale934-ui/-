/**
 * 云端告警发信（GitHub Actions 用）
 * ==================================
 * 失败/滞后时给指定邮箱发一封纯文本邮件。凭据来自 Secrets：
 *   MPF_SMTP_USER / MPF_SMTP_PASS / MPF_MAIL_TO（可选 MPF_SMTP_HOST / MPF_SMTP_PORT）
 *
 * 用法：
 *   node tools/notify-mail.js --subject "..." --body "..." [--to a@b,c@d]
 * 退出码：0 发出；1 配置缺失或发送失败（不阻断主流程时可加 `|| true`）
 */
'use strict';
const tls = require('tls');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

function sendMail(cfg, subject, body) {
  return new Promise((resolve, reject) => {
    const host = cfg.host || 'smtp.qq.com';
    const port = cfg.port || 465;
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const sock = tls.connect({ host, port, servername: host }, () => {});
    let buf = '';
    let step = 0;
    const msg = [
      'From: =?UTF-8?B?' + b64(cfg.fromName || 'MPF 监控') + '?= <' + cfg.user + '>',
      'To: ' + cfg.to.join(', '),
      'Subject: =?UTF-8?B?' + b64(subject) + '?=',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(body),
    ].join('\r\n');
    const send = (s) => sock.write(s + '\r\n');
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('SMTP 超时')); }, 40000);

    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (!/^\d{3} /.test(last)) return;
      buf = '';
      const code = parseInt(last.slice(0, 3), 10);
      if (step === 0 && code === 220) { step = 1; return send('EHLO mpf-notify'); }
      if (step === 1 && code === 250) { step = 2; return sock.write('AUTH LOGIN\r\n'); }
      if (step === 2 && code === 334) { step = 3; return sock.write(b64(cfg.user) + '\r\n'); }
      if (step === 3 && code === 334) { step = 4; return sock.write(b64(cfg.pass) + '\r\n'); }
      if (step === 4 && code === 235) { step = 5; return send('MAIL FROM:<' + cfg.user + '>'); }
      if (step === 5 && code === 250) { step = 6; return send('RCPT TO:<' + cfg.to[0] + '>'); }
      if (step === 6 && code === 250) { step = 7; return send('DATA'); }
      if (step === 7 && code === 354) { step = 8; return sock.write(msg + '\r\n.\r\n'); }
      if (step === 8 && code === 250) { clearTimeout(timer); send('QUIT'); sock.end(); return resolve(true); }
      if (code >= 400) { clearTimeout(timer); sock.destroy(); return reject(new Error('SMTP ' + code + ' ' + last)); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

(async () => {
  const user = process.env.MPF_SMTP_USER;
  const pass = process.env.MPF_SMTP_PASS;
  const to = (arg('to') || process.env.MPF_MAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!user || !pass || !to.length) {
    console.log('[notify] 缺少 SMTP 配置（MPF_SMTP_USER/PASS/MAIL_TO），跳过发信');
    process.exit(1);
  }
  const subject = arg('subject', '[强积金] 云端告警');
  const body = arg('body', '(无正文)');
  try {
    await sendMail({ user, pass, to, host: process.env.MPF_SMTP_HOST, port: Number(process.env.MPF_SMTP_PORT || 465) }, subject, body);
    console.log('[notify] 已发送 → ' + to.join(', '));
  } catch (e) {
    console.log('[notify] 发送失败：' + e.message);
    process.exit(1);
  }
})();
