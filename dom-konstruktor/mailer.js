/* Отправка писем без зависимостей: SMTP с TLS (порт 465) или STARTTLS (587/25), авторизация LOGIN.
   Настройки: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM. Без них письма копятся в журнале outbox.json —
   его видно в CRM, чтобы ничего не потерялось, пока почта не настроена. */
'use strict';
const net = require('net'), tls = require('tls'), fs = require('fs'), path = require('path'), crypto = require('crypto');

module.exports = function mailer(DATA) {
  const H = process.env.SMTP_HOST || '', PORT = +process.env.SMTP_PORT || 465, USER = process.env.SMTP_USER || '', PASS = process.env.SMTP_PASS || '';
  const FROM = process.env.SMTP_FROM || USER || 'noreply@localhost', OUT = path.join(DATA, 'outbox.json');
  const log = (rec) => { let a = []; try { a = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* пусто */ } a.unshift(rec); fs.writeFileSync(OUT, JSON.stringify(a.slice(0, 500), null, 1)); };
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const hdr = (s) => '=?UTF-8?B?' + b64(s) + '?=';

  function smtp(to, subject, text, html) {
    return new Promise((resolve, reject) => {
      let sock = PORT === 465 ? tls.connect(PORT, H, { servername: H }) : net.connect(PORT, H), buf = '', step = 0, secure = PORT === 465;
      const boundary = 'b' + crypto.randomBytes(8).toString('hex');
      const msg = [`From: ${hdr('Логика Дома')} <${FROM}>`, `To: <${to}>`, `Subject: ${hdr(subject)}`, 'MIME-Version: 1.0', `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${crypto.randomBytes(8).toString('hex')}@${FROM.split('@')[1] || 'localhost'}>`, `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text).replace(/.{76}/g, '$&\r\n'),
        `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html || text.replace(/\n/g, '<br>')).replace(/.{76}/g, '$&\r\n'), `--${boundary}--`, ''].join('\r\n');
      const send = (l) => sock.write(l + '\r\n');
      const fail = (e) => { try { sock.destroy(); } catch (x) { /* закрыт */ } reject(e instanceof Error ? e : new Error(String(e))); };
      const on = (d) => {
        buf += d.toString('utf8');
        if (!/\r\n$/.test(buf)) return;
        const lines = buf.trim().split('\r\n'), last = lines[lines.length - 1]; if (/^\d{3}-/.test(last)) return;
        const code = +last.slice(0, 3); buf = '';
        if (code >= 400) return fail(new Error('SMTP ' + last));
        // порядок диалога: EHLO → (STARTTLS → EHLO) → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT
        if (step === 0) { step = 1; return send('EHLO logikadoma'); }
        if (step === 1) {
          if (!secure && /STARTTLS/i.test(lines.join(' '))) { step = 2; return send('STARTTLS'); }
          step = USER ? 3 : 6; return USER ? send('AUTH LOGIN') : send(`MAIL FROM:<${FROM}>`);
        }
        if (step === 2) { sock.removeListener('data', on); sock = tls.connect({ socket: sock, servername: H }, () => { secure = true; step = 1; send('EHLO logikadoma'); }); sock.on('data', on); sock.on('error', fail); return; }
        if (step === 3) { step = 4; return send(b64(USER)); }
        if (step === 4) { step = 5; return send(b64(PASS)); }
        if (step === 5) { step = 6; return send(`MAIL FROM:<${FROM}>`); }
        if (step === 6) { step = 7; return send(`RCPT TO:<${to}>`); }
        if (step === 7) { step = 8; return send('DATA'); }
        if (step === 8) { step = 9; return sock.write(msg.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n'); }
        if (step === 9) { step = 10; send('QUIT'); return resolve(true); }
      };
      sock.on('data', on); sock.on('error', fail); sock.setTimeout(15000, () => fail(new Error('SMTP timeout')));
    });
  }

  /* письмо: отправляем, если почта настроена; в любом случае пишем в журнал */
  return async function mail(to, subject, text, html) {
    const rec = { at: new Date().toISOString(), to, subject, text: text.slice(0, 4000), sent: false };
    if (!to || !/@/.test(to)) { rec.error = 'нет адреса'; log(rec); return false; }
    if (!H) { rec.error = 'почта не настроена (SMTP_HOST)'; log(rec); return false; }
    try { await smtp(to, subject, text, html); rec.sent = true; } catch (e) { rec.error = e.message; }
    log(rec); return rec.sent;
  };
};
