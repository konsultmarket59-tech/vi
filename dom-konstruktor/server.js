#!/usr/bin/env node
/* Сервер площадки без зависимостей: статика, заявки, рассылка исполнителям, регистрация, админка.
   Запуск: ADMIN_KEY=секрет node server.js   (порт PORT, по умолчанию 8080)
   Уведомления в Telegram: TG_BOT_TOKEN, TG_OWNER_CHAT (чат владельца). Почта: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
   CRM (/crm.html): первый администратор — CRM_ADMIN_EMAIL и CRM_ADMIN_PASSWORD. */
'use strict';
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = __dirname, DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data', 'runtime'), LEADS = path.join(DATA, 'leads');
const PORT = +process.env.PORT || 8080, ADMIN_KEY = process.env.ADMIN_KEY || '';
const TG = process.env.TG_BOT_TOKEN || '', TG_OWNER = process.env.TG_OWNER_CHAT || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
fs.mkdirSync(LEADS, { recursive: true });

const STATUSES = ['new', 'call', 'tz', 'calc', 'report', 'meeting', 'paid', 'closed'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const companiesFile = path.join(DATA, 'companies.json');
// заголовки безопасности для всех ответов (HSTS ставит nginx вместе с HTTPS)
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); };
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);

function send(res, code, body, type) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': type && /html|xml|text\/plain/.test(type) ? 'no-cache' : 'no-store' }, SEC));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function body(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const ch = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else ch.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
/* защита форм: лимит запросов с адреса, ловушка для ботов, подписанный токен формы, Яндекс SmartCaptcha по ключу */
const hits = new Map();
// адрес клиента: за nginx — из X-Forwarded-For (TRUST_PROXY=1), иначе из соединения, чтобы заголовок нельзя было подделать
const ipOf = (req) => process.env.TRUST_PROXY && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress;
function limited(req) {
  const ip = ipOf(req), now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 10 * 60e3);
  a.push(now); hits.set(ip, a);
  return a.length > 20;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some(t => now - t < 10 * 60e3)) hits.delete(k); }, 10 * 60e3).unref();
const FORM_SECRET = (() => { const f = path.join(DATA, 'form-secret'); try { return fs.readFileSync(f, 'utf8'); } catch (e) { const k = crypto.randomBytes(32).toString('hex'); try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, k); } catch (x) { /* только в памяти */ } return k; } })();
const sign = (t) => crypto.createHmac('sha256', FORM_SECRET).update(String(t)).digest('hex').slice(0, 32);
const formToken = () => { const t = Date.now(); return t + '.' + sign(t); };
const CAPTCHA_SERVER = process.env.SMARTCAPTCHA_SERVER_KEY || '', CAPTCHA_CLIENT = process.env.SMARTCAPTCHA_CLIENT_KEY || '';
function captchaOk(token, ip) {
  if (!CAPTCHA_SERVER) return Promise.resolve(true);
  if (!token) return Promise.resolve(false);
  return new Promise((resolve) => {
    const q = `/validate?secret=${encodeURIComponent(CAPTCHA_SERVER)}&token=${encodeURIComponent(token)}&ip=${encodeURIComponent(ip || '')}`;
    const r = https.get({ host: 'smartcaptcha.yandexcloud.net', path: q, timeout: 6000 }, (res) => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b).status === 'ok'); } catch (e) { resolve(res.statusCode !== 200); } }); });
    // сервис капчи недоступен — не блокируем людей, остальные проверки остаются
    r.on('error', () => resolve(true)); r.on('timeout', () => { r.destroy(); resolve(true); });
  });
}
/* null — можно, строка — причина отказа */
async function guard(req, d) {
  d = d || {};
  if (str(d.website)) return 'Похоже на автоматическую отправку';
  const [t, sg] = String(d.ft || '').split('.'), age = Date.now() - +t;
  if (!t || sg !== sign(t) || !(age > 2500 && age < 12 * 3600e3)) return 'Обновите страницу и отправьте форму ещё раз';
  if (!(await captchaOk(d.captcha, ipOf(req)))) return 'Подтвердите, что вы не робот';
  return null;
}
function tg(chat, text) {
  if (!TG || !chat) return Promise.resolve(false);
  const data = JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true });
  return new Promise((resolve) => {
    const r = https.request({ host: 'api.telegram.org', path: `/bot${TG}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { res.resume(); resolve(res.statusCode === 200); });
    r.on('error', () => resolve(false)); r.setTimeout(8000, () => { r.destroy(); resolve(false); });
    r.end(data);
  });
}
const cityMatch = (c, city) => {
  const q = String(city || '').toLowerCase();
  return !q || [c.city].concat(c.regions || []).filter(Boolean).some(x => { const v = String(x).toLowerCase(); return v.includes(q) || q.includes(v); });
};

/* ---------- заявка ---------- */
async function lead(req, res) {
  if (limited(req)) return send(res, 429, { ok: false, error: 'Слишком много заявок, попробуйте позже' });
  let d;
  try { d = await body(req, 25e6); } catch (e) { return send(res, 400, { ok: false, error: 'bad body' }); }
  const gErr = await guard(req, d); if (gErr) return send(res, 400, { ok: false, error: gErr });
  const a = d.answers || {};
  if (!str(a.name) || str(a.phone).replace(/\D/g, '').length < 10) return send(res, 400, { ok: false, error: 'Нужны имя и телефон' });
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const id = day + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  const dir = path.join(LEADS, id); fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const saveImg = (url, name) => {
    const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(url || ''));
    if (!m) return;
    const fn = name + (m[1] === 'png' ? '.png' : '.jpg');
    fs.writeFileSync(path.join(dir, fn), Buffer.from(m[2], 'base64')); files.push(fn);
  };
  const im = d.images || {};
  (im.plans || []).slice(0, 4).forEach((u, i) => saveImg(u, 'plan-' + (i + 1)));
  saveImg(im.exterior, 'exterior');
  const rec = {
    id, at: new Date().toISOString(), status: 'new', notes: [],
    answers: { city: str(a.city), plot: str(a.plot, 20), slope: str(a.slope, 20), term: str(a.term, 20), cls: str(a.cls, 20), material: str(a.material, 20),
      name: str(a.name, 100), phone: str(a.phone, 40), time: str(a.time), note: str(a.note, 2000) },
    brief: (d.brief || []).slice(0, 60).map(s => str(s, 400)), changes: (d.changes || []).slice(0, 20).map(s => str(s, 400)),
    notesAuto: (d.notes || []).slice(0, 30).map(s => str(s, 400)), estimate: d.estimate || null, project: d.project || null, files, dispatch: [],
  };
  // рассылка: исполнители города получают анонс без контактов клиента
  const comps = readJSON(companiesFile, []).filter(c => c.status === 'approved' && cityMatch(c, rec.answers.city));
  const teaser = `Новая заявка ${id}: ${rec.answers.city}, ${rec.estimate ? Math.round(rec.estimate.area) + ' м²' : ''}, бюджет «${rec.answers.cls}», материал «${rec.answers.material}», срок «${rec.answers.term}».\n` +
    rec.brief.slice(0, 3).join('\n') + '\nТЗ пришлём после созвона с заказчиком.';
  for (const c of comps) rec.dispatch.push({ company: c.id, name: c.name, at: new Date().toISOString(), sent: await tg(c.tg, teaser) });
  writeJSON(path.join(dir, 'lead.json'), rec);
  tg(TG_OWNER, `🏠 Заявка ${id}\n${rec.answers.name}, ${rec.answers.phone}${rec.answers.time ? ' (' + rec.answers.time + ')' : ''}\n${rec.answers.city}; участок: ${rec.answers.plot}; уклон: ${rec.answers.slope}\n` +
    rec.brief.join('\n') + (rec.answers.note ? '\nПожелания: ' + rec.answers.note : '') + `\nРассылка: ${comps.length} исп.` + (PUBLIC_URL ? `\n${PUBLIC_URL}/admin.html#${id}` : ''));
  // сотрудникам — письмо о новой заявке (если почта настроена)
  readJSON(path.join(DATA, 'users.json'), []).filter(u => u.role === 'staff' && u.staffRole !== 'estimator')
    .forEach(u => mail(u.email, `Заявка ${id}: ${rec.answers.name}, ${rec.answers.city}`, `${rec.answers.name}, ${rec.answers.phone}\n${rec.answers.city}; участок: ${rec.answers.plot}\n${rec.brief.slice(0, 5).join('\n')}\n${PUBLIC_URL}/crm.html#${id}`));
  send(res, 200, { ok: true, id });
}

/* ---------- регистрация исполнителя ---------- */
async function register(req, res) {
  if (limited(req)) return send(res, 429, { ok: false });
  let d; try { d = await body(req, 100e3); } catch (e) { return send(res, 400, { ok: false }); }
  const gErr = await guard(req, d); if (gErr) return send(res, 400, { ok: false, error: gErr });
  if (!str(d.name) || !str(d.city) || !str(d.phone) || !str(d.email)) return send(res, 400, { ok: false, error: 'Заполните обязательные поля' });
  if (d.inn && !/^\d{10}(\d{2})?$/.test(String(d.inn))) return send(res, 400, { ok: false, error: 'ИНН' });
  const list = readJSON(companiesFile, []);
  const c = {
    id: 'c' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), status: 'pending', at: new Date().toISOString(),
    type: ['builder', 'architect', 'bureau'].includes(d.type) ? d.type : 'builder', name: str(d.name), inn: str(d.inn, 12), city: str(d.city, 80),
    regions: (Array.isArray(d.regions) ? d.regions : []).slice(0, 20).map(s => str(s, 80)), materials: (Array.isArray(d.materials) ? d.materials : []).slice(0, 10).map(s => str(s, 20)),
    priceFrom: +d.priceFrom || null, since: +d.since || null, phone: str(d.phone, 40), email: str(d.email, 120), site: str(d.site, 200), tg: str(d.tg, 60),
    about: str(d.about, 2000), classes: [], rating: null, reviews: 0,
  };
  list.push(c); writeJSON(companiesFile, list);
  tg(TG_OWNER, `Новая регистрация: ${c.name} (${c.city}), ${c.phone}, ИНН ${c.inn || '—'}`);
  send(res, 200, { ok: true });
}

/* ---------- админка ---------- */
function admin(req, res, url) {
  const key = req.headers['x-admin-key'] || '';
  if (!ADMIN_KEY || key.length !== ADMIN_KEY.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY))) return send(res, 401, { ok: false });
  const parts = url.pathname.split('/').filter(Boolean); // api admin ...
  const leadPath = (id) => /^[\w-]+$/.test(id) ? path.join(LEADS, id, 'lead.json') : null;
  if (req.method === 'GET' && parts[2] === 'leads') {
    const out = fs.readdirSync(LEADS).map(id => readJSON(path.join(LEADS, id, 'lead.json'), null)).filter(Boolean)
      .map(l => ({ id: l.id, at: l.at, status: l.status, name: l.answers.name, phone: l.answers.phone, city: l.answers.city, cls: l.answers.cls, area: l.estimate && l.estimate.area, dispatch: l.dispatch.length }))
      .sort((a, b) => b.at.localeCompare(a.at));
    return send(res, 200, out);
  }
  if (parts[2] === 'lead' && parts[3]) {
    const f = leadPath(parts[3]); const l = f && readJSON(f, null);
    if (!l) return send(res, 404, { ok: false });
    if (req.method === 'GET' && parts[4] === 'file') {
      const fn = path.basename(parts[5] || '');
      if (!l.files.includes(fn)) return send(res, 404, { ok: false });
      return send(res, 200, fs.readFileSync(path.join(LEADS, l.id, fn)), TYPES[path.extname(fn)]);
    }
    if (req.method === 'GET') return send(res, 200, l);
    if (req.method === 'POST') return body(req, 50e3).then(d => {
      if (STATUSES.includes(d.status)) l.status = d.status;
      if (str(d.note, 4000)) l.notes.push({ at: new Date().toISOString(), text: str(d.note, 4000) });
      writeJSON(f, l); send(res, 200, l);
    }).catch(() => send(res, 400, { ok: false }));
  }
  if (req.method === 'GET' && parts[2] === 'companies') return send(res, 200, readJSON(companiesFile, []));
  if (req.method === 'POST' && parts[2] === 'company' && parts[3]) return body(req, 50e3).then(d => {
    const list = readJSON(companiesFile, []), c = list.find(x => x.id === parts[3]);
    if (!c) return send(res, 404, { ok: false });
    if (['pending', 'approved', 'rejected'].includes(d.status)) c.status = d.status;
    if (d.rating != null) c.rating = Math.max(0, Math.min(5, +d.rating)) || null;
    if (d.reviews != null) c.reviews = Math.max(0, +d.reviews | 0);
    if (Array.isArray(d.classes)) c.classes = d.classes.filter(k => ['eco', 'comfort', 'premium'].includes(k));
    writeJSON(companiesFile, list); send(res, 200, c);
  }).catch(() => send(res, 400, { ok: false }));
  send(res, 404, { ok: false });
}

/* ---------- статика ---------- */
function stat(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT + path.sep) || f.startsWith(DATA) || f.startsWith(path.join(ROOT, 'data', 'runtime') + path.sep) || /\/(server|market|pages|content|crm-api|mailer|model-vm|cms-store)\.js$|\/\./.test(f)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  fs.stat(f, (e, s) => {
    if (e || !s.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    // библиотеки и шрифты не меняются — кешируем надолго; остальное проверяется при каждом заходе
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': p.startsWith('/vendor/') ? 'public, max-age=2592000' : 'no-cache' }, SEC));
    fs.createReadStream(f).pipe(res);
  });
}

const mail = require('./mailer.js')(DATA);
const MODEL = require('./model-vm.js')(ROOT);
const pagesHandle = require('./pages.js')({ send, PUBLIC_URL, ROOT, DATA });
const crmHandle = require('./crm-api.js')({ send, body, readJSON, writeJSON, str, DATA, ADMIN_KEY, PUBLIC_URL, mail, limited, guard, ROOT, quality: MODEL.quality, cms: pagesHandle.store, preview: pagesHandle.preview });
const marketHandle = require('./market.js')({ send, body, readJSON, writeJSON, str, tg, DATA, limited, TG_OWNER, ADMIN_KEY, PUBLIC_URL, quality: MODEL.quality, mail, guard });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/') && await crmHandle(req, res, url)) return;
    if (url.pathname.startsWith('/api/') && await marketHandle(req, res, url)) return;
    if (url.pathname === '/api/form-token' && req.method === 'GET') return send(res, 200, { t: formToken(), captchaKey: CAPTCHA_CLIENT });
    if (url.pathname === '/api/lead' && req.method === 'POST') return lead(req, res);
    if (url.pathname === '/api/register' && req.method === 'POST') return register(req, res);
    if (url.pathname === '/api/catalog' && req.method === 'GET') {
      return send(res, 200, readJSON(companiesFile, []).filter(c => c.status === 'approved').map(c => {
        const o = Object.assign({}, c); delete o.inn; delete o.tg; delete o.status; delete o.at; return o;
      }));
    }
    if (url.pathname.startsWith('/api/admin/')) return admin(req, res, url);
    if (url.pathname.startsWith('/api/')) return send(res, 404, { ok: false });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false });
    if (pagesHandle(req, res, url)) return;
    stat(req, res, url);
  } catch (e) { console.error(e); send(res, 500, { ok: false }); }
}).listen(PORT, () => console.log(`Конструктор дома: http://localhost:${PORT}  (админка: /admin.html${ADMIN_KEY ? '' : ' — задайте ADMIN_KEY'})`));
