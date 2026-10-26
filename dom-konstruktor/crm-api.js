/* CRM и кабинет строительной компании.
   Сотрудники (role: staff; staffRole: admin — всё, estimator — сметчик, manager — менеджер) ведут заявки: карточка клиента, статус,
   квалификация и цена лида, тело расчёта с ручной правкой, рассылка эскизного проекта компаниям и сравнение их ответов.
   Компании (role: company) регистрируются, после проверки получают запросы на почту, видят эскиз и ТЗ в кабинете и подают
   расчёт по единой форме. Первый администратор: CRM_ADMIN_EMAIL и CRM_ADMIN_PASSWORD при запуске или POST /api/admin/staff с ключом. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

module.exports = function crm(ctx) {
  const { send, body, readJSON, writeJSON, str, DATA, ADMIN_KEY, PUBLIC_URL, mail, limited, quality, cms, preview } = ctx;
  const guard = ctx.guard || (async () => null);
  const MEDIA = path.join(DATA, 'media');
  const USERS = path.join(DATA, 'users.json'), SESS = path.join(DATA, 'sessions.json'), LEADS = path.join(DATA, 'leads');
  const PROJ = path.join(DATA, 'projects'), COMP = path.join(DATA, 'companies.json'), PRICES = path.join(DATA, 'prices.json'), SETTINGS = path.join(DATA, 'settings.json'), OUTBOX = path.join(DATA, 'outbox.json');
  const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };
  const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const users = () => readJSON(USERS, []);
  const now = () => new Date().toISOString();
  const site = () => PUBLIC_URL || '';

  /* роли и сетка цены лида */
  const BID_ROWS = { found: 'Фундамент', walls: 'Стены и перегородки', slabs: 'Перекрытия', roof: 'Кровля', windows: 'Окна и двери', facade: 'Утепление и фасад', ext: 'Гараж, террасы, постройки', other: 'Прочее' };
  const QUAL = { plot: 'Есть участок', now: 'Готов строиться сейчас', cash: 'Деньги в наличии (наличные / одобренная ипотека)', price: 'Согласовал предварительную цену', meet: 'Готов к встрече' };
  const settings = () => Object.assign({ grid: { cold: 0, warm: 0.5, hot: 2 } }, readJSON(SETTINGS, {}));
  function grade(l) {
    const q = l.qual || {};
    if (Object.keys(QUAL).every(k => q[k])) return 'hot';
    if (q.plot && (q.now || q.cash)) return 'warm';
    return 'cold';
  }
  const homeValue = (l) => +l.agreed || (l.est && l.est.total) || (l.estimate && l.estimate.to ? (l.estimate.from + l.estimate.to) / 2 * 1e6 : 0);
  const leadPrice = (l) => Math.round(homeValue(l) * (settings().grid[grade(l)] || 0) / 100);

  // первый администратор из переменных окружения
  (function bootstrap() {
    const e = (process.env.CRM_ADMIN_EMAIL || '').toLowerCase(), pw = process.env.CRM_ADMIN_PASSWORD || '';
    if (!e || pw.length < 8) return;
    const list = users(); let u = list.find(x => x.email === e);
    if (!u) { const salt = crypto.randomBytes(16).toString('hex'); u = { id: 'u' + Date.now().toString(36), email: e, name: 'Администратор', salt, pass: hash(pw, salt), at: now() }; list.push(u); }
    u.role = 'staff'; u.staffRole = 'admin'; writeJSON(USERS, list);
  })();

  function me(req) {
    const t = String(req.headers.authorization || '').replace(/^Bearer\s+/, ''); if (!t) return null;
    const s = readJSON(SESS, {})[t]; if (!s) return null;
    return users().find(u => u.id === s) || null;
  }
  function session(uid) { const t = crypto.randomBytes(24).toString('hex'), s = readJSON(SESS, {}); s[t] = uid; writeJSON(SESS, s); return t; }
  const adminKey = (req) => { const k = req.headers['x-admin-key'] || ''; return ADMIN_KEY && k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY)); };
  const leadFile = (id) => /^[\w-]+$/.test(id) ? path.join(LEADS, id, 'lead.json') : null;
  const allLeads = () => { try { return fs.readdirSync(LEADS).map(id => readJSON(path.join(LEADS, id, 'lead.json'), null)).filter(Boolean); } catch (e) { return []; } };
  const companies = () => readJSON(COMP, []);
  const allProj = () => { try { return fs.readdirSync(PROJ).map(id => readJSON(path.join(PROJ, id, 'project.json'), null)).filter(Boolean); } catch (e) { return []; } };
  const projFile = (id) => /^[\w-]+$/.test(id) ? path.join(PROJ, id, 'project.json') : null;
  function projCard(pr, us) {
    const o = us.find(x => x.id === pr.owner) || {}, v = Object.values(pr.votes || {});
    return { id: pr.id, title: pr.title, about: pr.about, area: pr.area, floors: pr.floors, size: pr.size, price: pr.price, license: pr.license, status: pr.status, boost: !!pr.boost, blockReason: pr.blockReason || '',
      at: pr.at, updatedAt: pr.updatedAt || pr.at, files: pr.files || [], cover: (pr.files || []).find(f => f.startsWith('exterior')) || (pr.files || [])[0] || null, quality: pr.quality || null,
      rating: { avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : 0, n: v.length }, requests: (pr.requests || []).length,
      owner: { id: o.id, name: o.name || '—', email: o.email || '', phone: o.phone || '', city: o.city || '', role: o.role || 'user', archStatus: o.archStatus || 'none' } };
  }
  const staffPub = (u) => ({ id: u.id, name: u.name, email: u.email, staffRole: u.staffRole });
  const fileOut = (res, l, fn) => { fn = path.basename(fn || ''); if (!(l.files || []).includes(fn)) return send(res, 404, { ok: false }); send(res, 200, fs.readFileSync(path.join(LEADS, l.id, fn)), TYPES[path.extname(fn)] || 'application/octet-stream'); };
  function summary(l) {
    const a = l.answers || {}, c = l.client || {};
    return { id: l.id, at: l.at, status: l.status, name: c.name || a.name, phone: c.phone || a.phone, city: c.city || a.city, cls: a.cls, area: l.estimate && l.estimate.area,
      est: l.est && l.est.total || null, range: l.estimate ? [l.estimate.from, l.estimate.to] : null, grade: grade(l), leadPrice: leadPrice(l), bids: (l.bids || []).length, rfq: (l.rfq || []).length, manager: l.manager || null,
      deal: (l.deal || []).map(id => ((l.bids || []).find(b => b.company === id) || {}).name || id) };
  }
  // для компании: без контактов клиента, пока клиент не выбрал компанию
  function forCompany(l, cid) {
    const shared = (l.shareWith || []).includes(cid), a = l.answers || {}, c = l.client || {};
    return { id: l.id, at: l.at, city: c.city || a.city, area: l.estimate && l.estimate.area, cls: a.cls, material: a.material, term: a.term, plot: a.plot, slope: a.slope,
      brief: l.brief || [], tz: l.tz || [], changes: l.changes || [], files: l.files || [], project: l.project || null, range: l.estimate ? [l.estimate.from, l.estimate.to] : null,
      grade: grade(l), leadPrice: leadPrice(l), myBid: (l.bids || []).find(b => b.company === cid) || null, rows: BID_ROWS, deal: (l.deal || []).includes(cid),
      contacts: shared ? { name: c.name || a.name, phone: c.phone || a.phone } : null };
  }
  const json = (res, v) => send(res, 200, v);
  // профиль компании: города работы, аккредитация в банках, эскроу
  function profile(d) {
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => str(s, 80)).filter(Boolean);
    const cities = Array.from(new Set(list(d.cities != null ? d.cities : d.regions))).slice(0, 40);
    const banks = Array.from(new Set(list(d.banks))).slice(0, 20);
    return { cities, regions: cities, banks, escrow: !!d.escrow };
  }

  return async function handle(req, res, url) {
    const p = url.pathname, M = req.method, parts = p.split('/').filter(Boolean);
    try {
      if (p === '/api/prices' && M === 'GET') { const pr = readJSON(PRICES, {}); return json(res, { prices: pr.prices || {}, updatedAt: pr.updatedAt || null }), true; }

      // первый сотрудник по ключу администратора (admin.html)
      if (p === '/api/admin/staff' && M === 'POST') {
        if (!adminKey(req)) return send(res, 401, { ok: false }), true;
        return createStaff(await body(req, 20e3), res), true;
      }

      /* ---------- регистрация и кабинет компании ---------- */
      if (p === '/api/company/register' && M === 'POST') {
        if (limited(req)) return send(res, 429, { ok: false, error: 'Слишком много попыток' }), true;
        const d = await body(req, 100e3), email = str(d.email, 120).toLowerCase();
        const gErr = await guard(req, d); if (gErr) return send(res, 400, { ok: false, error: gErr }), true;
        if (!str(d.name) || !str(d.city) || !str(d.phone)) return send(res, 400, { ok: false, error: 'Заполните название, город и телефон' }), true;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { ok: false, error: 'Проверьте почту' }), true;
        if (String(d.password || '').length < 8) return send(res, 400, { ok: false, error: 'Пароль — от 8 символов' }), true;
        if (d.inn && !/^\d{10}(\d{2})?$/.test(String(d.inn))) return send(res, 400, { ok: false, error: 'ИНН — 10 или 12 цифр' }), true;
        const list = users(); if (list.some(u => u.email === email)) return send(res, 409, { ok: false, error: 'Почта уже зарегистрирована — войдите' }), true;
        const cs = companies(), cid = 'c' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
        const prof = profile(d);
        if (!prof.cities.length) prof.cities = [str(d.city, 80)];
        cs.push(Object.assign({ id: cid, status: 'pending', at: now(), type: 'builder', name: str(d.name), inn: str(d.inn, 12), city: str(d.city, 80),
          materials: (Array.isArray(d.materials) ? d.materials : []).slice(0, 10).map(s => str(s, 20)), phone: str(d.phone, 40), email, site: str(d.site, 200), about: str(d.about, 2000), classes: [], rating: null, reviews: 0 }, prof));
        writeJSON(COMP, cs);
        const salt = crypto.randomBytes(16).toString('hex'), u = { id: 'u' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), email, name: str(d.contact || d.name, 100), phone: str(d.phone, 40), city: str(d.city, 80), salt, pass: hash(d.password, salt), role: 'company', companyId: cid, at: now() };
        list.push(u); writeJSON(USERS, list);
        users().filter(x => x.role === 'staff' && x.staffRole !== 'estimator').forEach(s => mail(s.email, `Новая компания: ${str(d.name)}`, `Зарегистрировалась компания «${str(d.name)}» (${str(d.city)}), ${str(d.phone)}, ИНН ${str(d.inn) || '—'}.\nПроверьте и одобрите в CRM: ${site()}/crm.html`));
        return json(res, { ok: true, token: session(u.id), user: { id: u.id, name: u.name, email, role: 'company', companyId: cid } }), true;
      }
      if (p.startsWith('/api/company/')) {
        const u = me(req); if (!u || u.role !== 'company') return send(res, 401, { ok: false, error: 'Войдите как строительная компания' }), true;
        const comp = companies().find(c => c.id === u.companyId) || null;
        if (p === '/api/company/me' && M === 'GET') {
          const reqs = comp && comp.status === 'approved' ? allLeads().filter(l => (l.rfq || []).some(r => r.companies.includes(comp.id))).map(l => { const v = forCompany(l, comp.id); delete v.project; return v; }).sort((a, b) => b.at.localeCompare(a.at)) : [];
          return json(res, { company: comp, requests: reqs, grid: settings().grid, qual: QUAL }), true;
        }
        if (p === '/api/company/me' && M === 'POST') {
          const d = await body(req, 50e3), cs = companies(), c = cs.find(x => x.id === u.companyId); if (!c) return send(res, 404, { ok: false }), true;
          Object.assign(c, profile(d)); if (d.phone != null) c.phone = str(d.phone, 40); if (d.site != null) c.site = str(d.site, 200); if (d.about != null) c.about = str(d.about, 2000);
          if (!c.cities.length) return send(res, 400, { ok: false, error: 'Укажите хотя бы один город' }), true;
          writeJSON(COMP, cs); return json(res, c), true;
        }
        const l = parts[2] === 'lead' && parts[3] ? readJSON(leadFile(parts[3]) || '', null) : null;
        if (!l || !comp || !(l.rfq || []).some(r => r.companies.includes(comp.id))) return send(res, 404, { ok: false }), true;
        if (M === 'GET' && parts[4] === 'file') return fileOut(res, l, parts[5]), true;
        if (M === 'GET') return json(res, forCompany(l, comp.id)), true;
        if (M === 'POST' && parts[4] === 'bid') {
          const d = await body(req, 50e3), rows = {};
          Object.keys(BID_ROWS).forEach(k => { rows[k] = Math.max(0, Math.round(+((d.rows || {})[k]) || 0)); });
          const bid = { company: comp.id, name: comp.name, at: now(), rows, total: Object.values(rows).reduce((a, b) => a + b, 0), term: Math.max(0, +d.term || 0), comment: str(d.comment, 3000) };
          l.bids = (l.bids || []).filter(b => b.company !== comp.id).concat(bid);
          (l.log = l.log || []).push({ at: now(), text: `Расчёт от «${comp.name}»: ${bid.total.toLocaleString('ru-RU')} ₽, срок ${bid.term} мес.` });
          writeJSON(leadFile(l.id), l);
          users().filter(x => x.role === 'staff').forEach(s => mail(s.email, `Расчёт по заявке ${l.id} от «${comp.name}»`, `«${comp.name}» прислала расчёт по заявке ${l.id}: ${bid.total.toLocaleString('ru-RU')} ₽, срок ${bid.term} мес.\n${site()}/crm.html#${l.id}`));
          return json(res, { ok: true, bid }), true;
        }
        return send(res, 404, { ok: false }), true;
      }

      /* ---------- CRM: только сотрудники ---------- */
      if (!p.startsWith('/api/crm/')) return false;
      if (p === '/api/crm/login' && M === 'POST') {
        if (limited(req)) return send(res, 429, { ok: false, error: 'Слишком много попыток' }), true;
        const d = await body(req, 20e3), u = users().find(x => x.email === str(d.email, 120).toLowerCase());
        if (!u || u.role !== 'staff' || !crypto.timingSafeEqual(Buffer.from(hash(d.password || '', u.salt), 'hex'), Buffer.from(u.pass, 'hex'))) return send(res, 401, { ok: false, error: 'Неверная почта или пароль сотрудника' }), true;
        return json(res, { ok: true, token: session(u.id), user: staffPub(u) }), true;
      }
      const u = me(req); if (!u || u.role !== 'staff') return send(res, 401, { ok: false, error: 'Вход для сотрудников' }), true;
      const can = (...roles) => u.staffRole === 'admin' || roles.includes(u.staffRole);
      // маркетолог видит только контент сайта и проекты пользователей
      if (u.staffRole === 'marketer' && !/^\/api\/crm\/(me|cms|media|projects?)(\/|$)/.test(p)) return send(res, 403, { ok: false, error: 'Раздел недоступен для роли «маркетолог»' }), true;
      /* ---------- контент сайта (CMS): страницы, статьи, SEO, настройки, медиатека ---------- */
      if (p.startsWith('/api/crm/cms') || p.startsWith('/api/crm/media')) {
        if (!cms) return send(res, 501, { ok: false, error: 'CMS не подключена' }), true;
        if (!can('marketer')) return send(res, 403, { ok: false, error: 'Контент правят маркетолог и администратор' }), true;
        const q = url.searchParams.get('path') || '';
        if (p === '/api/crm/cms' && M === 'GET') return json(res, cms.all()), true;
        if (p === '/api/crm/cms/page' && M === 'GET') { const r = cms.get(q); return r ? json(res, r) : send(res, 404, { ok: false }), true; }
        if (p === '/api/crm/cms/page' && M === 'PUT') {
          const d = await body(req, 2e6);
          try { return json(res, cms.save(str(d.path || q, 300), d.rec || {}, u.name)), true; } catch (e) { return send(res, 400, { ok: false, error: e.message }), true; }
        }
        if (p === '/api/crm/cms/page' && M === 'DELETE') { try { cms.remove(q); return json(res, { ok: true }), true; } catch (e) { return send(res, 400, { ok: false, error: e.message }), true; } }
        if (p === '/api/crm/cms/reset' && M === 'POST') { const d = await body(req, 5e3); return json(res, cms.reset(str(d.path, 300))), true; }
        if (p === '/api/crm/cms/preview' && M === 'POST') { const d = await body(req, 2e6); return json(res, { html: preview ? preview(req, Object.assign({ path: str(d.path, 300) || '/' }, d.rec || {})) : '' }), true; }
        if (p === '/api/crm/cms/site') {
          if (M === 'GET') return json(res, cms.site()), true;
          if (M === 'PUT') return json(res, cms.saveSite(await body(req, 50e3))), true;
        }
        if (p === '/api/crm/media' && M === 'GET') {
          let list = []; try { list = fs.readdirSync(MEDIA).filter(f => /\.(png|jpe?g|webp|gif|mp3|m4a|ogg|mp4|webm)$/.test(f)).map(f => ({ name: f, url: '/media/' + f, size: fs.statSync(path.join(MEDIA, f)).size, at: fs.statSync(path.join(MEDIA, f)).mtime })); } catch (e) { /* пусто */ }
          return json(res, list.sort((a, b) => String(b.at).localeCompare(String(a.at)))), true;
        }
        if (p === '/api/crm/media' && M === 'POST') {
          const d = await body(req, 60e6), m = /^data:(image|audio|video)\/(png|jpeg|webp|gif|mpeg|mp3|mp4|x-m4a|ogg|webm);base64,(.+)$/.exec(String(d.data || ''));
          if (!m || (m[1] === 'image') !== ['png', 'jpeg', 'webp', 'gif'].includes(m[2])) return send(res, 400, { ok: false, error: 'Нужна картинка (PNG, JPG, WebP, GIF), аудио (MP3, M4A, OGG) или видео (MP4, WebM)' }), true;
          const buf = Buffer.from(m[3], 'base64'), lim = m[1] === 'image' ? 8e6 : 40e6; if (buf.length > lim) return send(res, 400, { ok: false, error: `Файл больше ${lim / 1e6} МБ` }), true;
          const ext = { jpeg: 'jpg', mpeg: 'mp3', 'x-m4a': 'm4a' }[m[2]] || (m[1] === 'audio' && m[2] === 'mp4' ? 'm4a' : m[2]);
          const nm = (str(d.name, 60).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || m[1]) + '-' + crypto.randomBytes(3).toString('hex') + '.' + ext;
          fs.mkdirSync(MEDIA, { recursive: true }); fs.writeFileSync(path.join(MEDIA, nm), buf);
          return json(res, { ok: true, name: nm, url: '/media/' + nm }), true;
        }
        if (parts[2] === 'media' && parts[3] && M === 'DELETE') { try { fs.unlinkSync(path.join(MEDIA, path.basename(parts[3]))); } catch (e) { /* уже нет */ } return json(res, { ok: true }), true; }
        return send(res, 404, { ok: false }), true;
      }
      if (p === '/api/crm/me') return json(res, { user: staffPub(u), qual: QUAL, rows: BID_ROWS, settings: settings() }), true;
      if (p === '/api/crm/leads' && M === 'GET') return json(res, allLeads().map(summary).sort((a, b) => b.at.localeCompare(a.at))), true;
      if (parts[2] === 'lead' && parts[3]) {
        const f = leadFile(parts[3]), l = f && readJSON(f, null); if (!l) return send(res, 404, { ok: false }), true;
        if (M === 'GET' && parts[4] === 'file') return fileOut(res, l, parts[5]), true;
        if (M === 'GET') return json(res, Object.assign({}, l, { grade: grade(l), leadPrice: leadPrice(l), homeValue: homeValue(l) })), true;
        if (M === 'POST' && parts[4] === 'rfq') {
          // рассылка эскизного проекта выбранным компаниям: письмо на почту аккаунта и в кабинет
          const d = await body(req, 50e3), cs = companies().filter(c => c.status === 'approved' && (d.companies || []).includes(c.id));
          if (!cs.length) return send(res, 400, { ok: false, error: 'Выберите проверенные компании' }), true;
          const r = { at: now(), by: u.name, companies: cs.map(c => c.id), message: str(d.message, 3000) };
          if (Array.isArray(d.tz) && !(l.tz && l.tz.length)) l.tz = d.tz.slice(0, 60).map(x => str(x, 500));
          l.rfq = (l.rfq || []).concat(r); if (!['calc', 'report', 'meeting', 'paid', 'closed'].includes(l.status)) l.status = 'calc';
          (l.log = l.log || []).push({ at: now(), text: `${u.name}: отправлено на расчёт — ${cs.map(c => c.name).join(', ')}` });
          writeJSON(f, l);
          const accs = users().filter(x => x.role === 'company');
          const area = l.estimate ? Math.round(l.estimate.area) + ' м²' : '';
          for (const c of cs) {
            const to = new Set([c.email].concat(accs.filter(a => a.companyId === c.id).map(a => a.email)).filter(Boolean));
            for (const addr of to) await mail(addr, `Запрос расчёта: дом ${area}, ${(l.client || {}).city || l.answers.city}`,
              `Здравствуйте!\n\nНовый запрос на расчёт стоимости дома ${area} (${(l.client || {}).city || l.answers.city}).\n${(l.brief || []).slice(0, 4).join('\n')}\n${r.message ? '\nКомментарий: ' + r.message + '\n' : ''}\nЭскизный проект, техзадание и форма расчёта — в личном кабинете: ${site()}/#company\n\nСвой Дом`);
          }
          return json(res, Object.assign({}, l, { grade: grade(l), leadPrice: leadPrice(l), homeValue: homeValue(l) })), true;
        }
        if (M === 'POST') {
          const d = await body(req, 400e3);
          if (d.status && ['new', 'call', 'tz', 'calc', 'report', 'meeting', 'paid', 'closed'].includes(d.status) && d.status !== l.status) { (l.log = l.log || []).push({ at: now(), text: `${u.name}: статус → ${d.status}` }); l.status = d.status; }
          if (d.client) { l.client = Object.assign({}, l.client || {}, ['name', 'phone', 'email', 'city', 'address', 'plotNo', 'source'].reduce((o, k) => (d.client[k] != null && (o[k] = str(d.client[k], 300)), o), {})); }
          if (d.qual) { l.qual = {}; Object.keys(QUAL).forEach(k => { l.qual[k] = !!d.qual[k]; }); }
          if (d.agreed != null) l.agreed = Math.max(0, +d.agreed || 0);
          if (d.manager != null) l.manager = str(d.manager, 100);
          if (Array.isArray(d.shareWith)) l.shareWith = d.shareWith.filter(x => /^c\w+$/.test(x));
          if (Array.isArray(d.deal)) {
            const nd = d.deal.filter(x => /^c\w+$/.test(x)), was = l.deal || [], cn = (id) => ((l.bids || []).find(b => b.company === id) || {}).name || id;
            nd.filter(x => !was.includes(x)).forEach(x => (l.log = l.log || []).push({ at: now(), text: `${u.name}: готовы к сделке с «${cn(x)}»` }));
            was.filter(x => !nd.includes(x)).forEach(x => (l.log = l.log || []).push({ at: now(), text: `${u.name}: сделка с «${cn(x)}» снята` }));
            l.deal = nd;
          }
          if (d.tz && Array.isArray(d.tz)) l.tz = d.tz.slice(0, 60).map(s => str(s, 500));
          if (d.est && can('estimator')) l.est = { ov: d.est.ov || {}, cls: str(d.est.cls, 20), total: +d.est.total || 0, min: +d.est.min || 0, max: +d.est.max || 0, by: u.name, at: now() };
          if (str(d.note, 4000)) (l.notes = l.notes || []).push({ at: now(), by: u.name, text: str(d.note, 4000) });
          writeJSON(f, l);
          return json(res, Object.assign({}, l, { grade: grade(l), leadPrice: leadPrice(l), homeValue: homeValue(l) })), true;
        }
      }
      /* проекты пользователей: модерация — блокировка мусора, «поднять» удачные */
      if (p === '/api/crm/projects' && M === 'GET') { const us = users(); return json(res, allProj().map(x => projCard(x, us)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), true; }
      if (parts[2] === 'project' && parts[3]) {
        const f = projFile(parts[3]), pr = f && readJSON(f, null); if (!pr) return send(res, 404, { ok: false }), true;
        if (M === 'GET' && parts[4] === 'file') { const fn = path.basename(parts[5] || ''); if (!(pr.files || []).includes(fn)) return send(res, 404, { ok: false }), true; return send(res, 200, fs.readFileSync(path.join(PROJ, pr.id, fn)), TYPES[path.extname(fn)] || 'application/octet-stream'), true; }
        if (M === 'GET') return json(res, Object.assign(projCard(pr, users()), { project: pr.project, requestsList: pr.requests || [], modLog: pr.modLog || [], seo: pr.seo || {}, qualityNow: quality ? quality(pr.project) : null })), true;
        if (M === 'POST') {
          if (!can('manager', 'marketer')) return send(res, 403, { ok: false, error: 'Нет прав' }), true;
          const d = await body(req, 20e3), log = (t) => (pr.modLog = pr.modLog || []).push({ at: now(), by: u.name, text: t });
          if (['published', 'hidden', 'blocked', 'private'].includes(d.status) && d.status !== pr.status) {
            if (d.status === 'blocked') { pr.blockReason = str(d.reason, 500) || 'Не соответствует правилам площадки'; pr.boost = false; }
            else pr.blockReason = '';
            log({ published: 'опубликован', hidden: 'скрыт', blocked: 'заблокирован: ' + pr.blockReason, private: 'только в кабинете автора' }[d.status]);
            pr.status = d.status;
            const ow = users().find(x => x.id === pr.owner);
            if (ow && d.status === 'blocked') mail(ow.email, `Проект «${pr.title}» снят с публикации`, `Здравствуйте!\n\nПроект «${pr.title}» снят модератором: ${pr.blockReason}.\nИсправьте проект в конструкторе и напишите нам — мы проверим ещё раз.\n\nСвой Дом`);
          }
          if (d.boost != null && !!d.boost !== !!pr.boost) { pr.boost = !!d.boost && pr.status !== 'blocked'; log(pr.boost ? 'поднят вверх каталога' : 'снят с поднятия'); }
          if (d.seo && typeof d.seo === 'object') { pr.seo = { title: str(d.seo.title, 120), desc: str(d.seo.desc, 300), keywords: str(d.seo.keywords, 300), noindex: !!d.seo.noindex }; log('SEO страницы обновлено'); }
          if (str(d.note, 1000)) log('заметка: ' + str(d.note, 1000));
          writeJSON(f, pr); return json(res, projCard(pr, users())), true;
        }
      }
      if (p === '/api/crm/companies' && M === 'GET') {
        const accs = users().filter(x => x.role === 'company');
        return json(res, companies().map(c => Object.assign({}, c, { accounts: accs.filter(a => a.companyId === c.id).map(a => a.email) }))), true;
      }
      if (parts[2] === 'company' && parts[3] && M === 'POST') {
        if (!can('manager')) return send(res, 403, { ok: false }), true;
        const d = await body(req, 20e3), cs = companies(), c = cs.find(x => x.id === parts[3]); if (!c) return send(res, 404, { ok: false }), true;
        const was = c.status;
        if (['pending', 'approved', 'rejected'].includes(d.status)) c.status = d.status;
        if (d.rating != null) c.rating = Math.max(0, Math.min(5, +d.rating)) || null;
        if (Array.isArray(d.classes)) c.classes = d.classes.filter(k => ['eco', 'comfort', 'premium'].includes(k));
        if (d.cities != null || d.banks != null || d.escrow != null) Object.assign(c, profile(Object.assign({ cities: c.cities || c.regions, banks: c.banks, escrow: c.escrow }, d)));
        writeJSON(COMP, cs);
        if (was !== 'approved' && c.status === 'approved') users().filter(a => a.companyId === c.id).forEach(a => mail(a.email, 'Компания проверена — заявки открыты', `«${c.name}» прошла проверку. Запросы на расчёт будут приходить на эту почту и в кабинет: ${site()}/#company`));
        return json(res, c), true;
      }
      if (p === '/api/crm/prices') {
        if (M === 'GET') return json(res, readJSON(PRICES, { prices: {} })), true;
        if (M === 'PUT') {
          if (!can('estimator')) return send(res, 403, { ok: false, error: 'Цены правит сметчик' }), true;
          const d = await body(req, 200e3), out = {};
          Object.entries(d.prices || {}).forEach(([k, v]) => { if (/^\w+$/.test(k) && v) out[k] = { m: Math.max(0, +v.m || 0), w: Math.max(0, +v.w || 0) }; });
          writeJSON(PRICES, { prices: out, updatedAt: now(), by: u.name });
          return json(res, { ok: true }), true;
        }
      }
      if (p === '/api/crm/settings') {
        if (M === 'GET') return json(res, settings()), true;
        if (M === 'PUT') { if (!can()) return send(res, 403, { ok: false }), true; const d = await body(req, 20e3), g = d.grid || {}; writeJSON(SETTINGS, { grid: { cold: +g.cold || 0, warm: +g.warm || 0, hot: +g.hot || 0 } }); return json(res, settings()), true; }
      }
      if (p === '/api/crm/outbox') return json(res, readJSON(OUTBOX, [])), true;
      if (p === '/api/crm/staff') {
        if (M === 'GET') return json(res, users().filter(x => x.role === 'staff').map(staffPub)), true;
        if (M === 'POST') { if (!can()) return send(res, 403, { ok: false }), true; return createStaff(await body(req, 20e3), res), true; }
      }
      return send(res, 404, { ok: false }), true;
    } catch (e) { console.error(e); send(res, 400, { ok: false, error: 'Ошибка запроса' }); return true; }
  };

  function createStaff(d, res) {
    const email = str(d.email, 120).toLowerCase(), role = ['admin', 'estimator', 'manager', 'marketer'].includes(d.staffRole) ? d.staffRole : 'manager';
    if (!/@/.test(email) || String(d.password || '').length < 8) return send(res, 400, { ok: false, error: 'Почта и пароль от 8 символов' });
    const list = users(); let u = list.find(x => x.email === email);
    if (!u) { const salt = crypto.randomBytes(16).toString('hex'); u = { id: 'u' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), email, salt, pass: hash(d.password, salt), at: now() }; list.push(u); }
    u.name = str(d.name || u.name || email, 100); u.role = 'staff'; u.staffRole = role;
    writeJSON(USERS, list); send(res, 200, { ok: true, user: staffPub(u) });
  }
};
