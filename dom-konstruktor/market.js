/* Проекты пользователей: аккаунты, заявка архитектора с документами, публикация с ценой, рейтинг, запросы эскизного проекта.
   Подключается из server.js; хранит данные в data/runtime (users.json, sessions.json, projects/<id>/, docs/<user>/). */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

module.exports = function market(ctx) {
  const { send, body, readJSON, writeJSON, str, tg, DATA, limited, TG_OWNER, ADMIN_KEY, PUBLIC_URL, quality } = ctx;
  const guard = ctx.guard || (async () => null);
  // верификация: архитектор и инженер платформы проверяют планировку и при необходимости исправляют; услуга платная
  const VP = ctx.VERIFY_PRICE || 15000, VACTIVE = ['requested', 'paid', 'in_work', 'verified'];
  const vPub = (v) => v ? { status: v.status, fixed: !!v.fixed, at: v.at || v.requestedAt, price: v.price } : null;
  function askVerify(pr, u) {
    if (pr.verify && VACTIVE.includes(pr.verify.status)) return false;
    pr.verify = { status: 'requested', price: VP, requestedAt: new Date().toISOString(), log: ((pr.verify && pr.verify.log) || []).concat({ at: new Date().toISOString(), text: 'заявка на верификацию от автора' }) };
    tg(TG_OWNER, `Заявка на верификацию проекта «${pr.title}» (${VP} ₽) — ${u.name}, ${u.phone || u.email}`);
    return true;
  }
  const USERS = path.join(DATA, 'users.json'), SESS = path.join(DATA, 'sessions.json'), PROJ = path.join(DATA, 'projects'), DOCS = path.join(DATA, 'docs');
  fs.mkdirSync(PROJ, { recursive: true }); fs.mkdirSync(DOCS, { recursive: true });
  const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };

  const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const users = () => readJSON(USERS, []);
  const pub = (u) => u && { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, archStatus: u.archStatus, about: u.about || '', city: u.city || '', companyId: u.companyId || null, staffRole: u.staffRole || null };
  function me(req) {
    const t = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (!t) return null;
    const s = readJSON(SESS, {})[t]; if (!s) return null;
    return users().find(u => u.id === s) || null;
  }
  function session(uid) { const t = crypto.randomBytes(24).toString('hex'), s = readJSON(SESS, {}); s[t] = uid; writeJSON(SESS, s); return t; }
  function adminOk(req) { const k = req.headers['x-admin-key'] || ''; return ADMIN_KEY && k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY)); }
  const projFile = (id) => /^[\w-]+$/.test(id) ? path.join(PROJ, id, 'project.json') : null;
  const allProjects = () => fs.readdirSync(PROJ).map(id => readJSON(path.join(PROJ, id, 'project.json'), null)).filter(Boolean);
  // архитекторы, которых автор добавил к проекту: по id пользователя или по почте (если ещё не зарегистрирован)
  const inTeam = (pr, u) => !!(u && (pr.team || []).some(m => m.id === u.id || (m.email && m.email === String(u.email || '').toLowerCase())));
  const rating = (pr) => { const v = Object.values(pr.votes || {}); return { avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : 0, n: v.length }; };
  function card(pr, all) {
    const u = (all || users()).find(x => x.id === pr.owner) || {};
    return { id: pr.id, title: pr.title, about: pr.about, price: pr.price, license: pr.license, area: pr.area, floors: pr.floors, size: pr.size, at: pr.at,
      author: { name: u.name || 'Автор', verified: u.archStatus === 'verified' }, rating: rating(pr), cover: pr.files.find(f => f.startsWith('exterior')) || pr.files[0] || null, files: pr.files, free: !pr.price, status: pr.status, boost: !!pr.boost, blockReason: pr.blockReason || '', quality: pr.quality || null, verify: vPub(pr.verify), updatedAt: pr.updatedAt || pr.at };
  }
  function saveFile(dir, url, name, okTypes) {
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(url || '')); if (!m) return null;
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'application/pdf': '.pdf' }[m[1]];
    if (!ext || (okTypes && !okTypes.includes(ext))) return null;
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 8e6) return null;
    const fn = name.replace(/[^\w-]/g, '') + ext; fs.writeFileSync(path.join(dir, fn), buf); return fn;
  }

  return async function handle(req, res, url) {
    const p = url.pathname, M = req.method;
    try {
      /* ---- аккаунт ---- */
      if (p === '/api/auth/register' && M === 'POST') {
        if (limited(req)) return send(res, 429, { ok: false, error: 'Слишком много попыток' }), true;
        const d = await body(req, 50e3), email = str(d.email, 120).toLowerCase();
        const gErr = await guard(req, d); if (gErr) return send(res, 400, { ok: false, error: gErr }), true;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { ok: false, error: 'Проверьте почту' }), true;
        if (String(d.password || '').length < 8) return send(res, 400, { ok: false, error: 'Пароль — от 8 символов' }), true;
        if (!str(d.name)) return send(res, 400, { ok: false, error: 'Как вас зовут?' }), true;
        const list = users();
        if (list.some(u => u.email === email)) return send(res, 409, { ok: false, error: 'Такая почта уже зарегистрирована — войдите' }), true;
        const salt = crypto.randomBytes(16).toString('hex');
        const u = { id: 'u' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), email, name: str(d.name, 100), phone: str(d.phone, 40), city: str(d.city, 80), salt, pass: hash(d.password, salt), role: 'user', archStatus: 'none', docs: [], at: new Date().toISOString() };
        list.push(u); writeJSON(USERS, list);
        return send(res, 200, { ok: true, token: session(u.id), user: pub(u) }), true;
      }
      if (p === '/api/auth/login' && M === 'POST') {
        if (limited(req)) return send(res, 429, { ok: false, error: 'Слишком много попыток' }), true;
        const d = await body(req, 50e3), u = users().find(x => x.email === str(d.email, 120).toLowerCase());
        if (!u || !crypto.timingSafeEqual(Buffer.from(hash(d.password || '', u.salt), 'hex'), Buffer.from(u.pass, 'hex'))) return send(res, 401, { ok: false, error: 'Неверная почта или пароль' }), true;
        return send(res, 200, { ok: true, token: session(u.id), user: pub(u) }), true;
      }
      if (p === '/api/auth/logout' && M === 'POST') {
        const t = String(req.headers.authorization || '').replace(/^Bearer\s+/, ''), s = readJSON(SESS, {}); delete s[t]; writeJSON(SESS, s);
        return send(res, 200, { ok: true }), true;
      }
      if (p === '/api/me' && M === 'GET') { const u = me(req); return send(res, u ? 200 : 401, u ? { ok: true, user: pub(u) } : { ok: false }), true; }
      /* заявка на статус архитектора: диплом, свидетельство СРО или портфолио */
      if (p === '/api/architect/apply' && M === 'POST') {
        const u = me(req); if (!u) return send(res, 401, { ok: false, error: 'Войдите' }), true;
        const d = await body(req, 30e6), dir = path.join(DOCS, u.id); fs.mkdirSync(dir, { recursive: true });
        const saved = (Array.isArray(d.files) ? d.files : []).slice(0, 6).map((f, i) => saveFile(dir, f.data, 'doc' + Date.now().toString(36) + i, ['.png', '.jpg', '.pdf'])).filter(Boolean);
        if (!saved.length) return send(res, 400, { ok: false, error: 'Приложите скан диплома (PDF, JPG или PNG до 8 МБ)' }), true;
        const list = users(), x = list.find(q => q.id === u.id);
        Object.assign(x, { archStatus: 'pending', docs: (x.docs || []).concat(saved), diploma: str(d.diploma, 300), about: str(d.about, 2000), sro: str(d.sro, 200), site: str(d.site, 200) });
        writeJSON(USERS, list);
        tg(TG_OWNER, `Заявка архитектора: ${x.name}, ${x.email}, ${x.phone}\nДиплом: ${x.diploma}\nДокументов: ${saved.length}` + (PUBLIC_URL ? `\n${PUBLIC_URL}/admin.html` : ''));
        return send(res, 200, { ok: true, user: pub(x) }), true;
      }
      /* ---- проекты ---- */
      if (p === '/api/projects' && M === 'POST') {
        const u = me(req); if (!u) return send(res, 401, { ok: false, error: 'Войдите, чтобы опубликовать' }), true;
        const d = await body(req, 30e6);
        if (!str(d.title)) return send(res, 400, { ok: false, error: 'Назовите проект' }), true;
        if (!d.project || !d.project.poly) return send(res, 400, { ok: false, error: 'Нет данных проекта' }), true;
        // фильтр качества: с ошибками проекта не сохраняем — интерфейс предлагает исправить
        const q = quality ? quality(d.project) : { ok: true, errs: [], warns: [], score: 100 };
        if (!q.ok) return send(res, 422, { ok: false, error: q.errs.length ? `Исправьте ошибки в проекте (${q.errs.length}): ${q.errs[0].txt}` : `Слишком много замечаний (${q.warns.length}) — исправьте хотя бы часть`, quality: q }), true;
        // повторное сохранение своего проекта — обновляем его
        const old = d.id && projFile(String(d.id)) ? readJSON(projFile(String(d.id)), null) : null;
        if (old && old.owner !== u.id) return send(res, 403, { ok: false, error: 'Это не ваш проект' }), true;
        if (old && old.status === 'blocked') return send(res, 403, { ok: false, error: 'Проект заблокирован модератором' + (old.blockReason ? ': ' + old.blockReason : '') }), true;
        const id = old ? old.id : 'p' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), dir = path.join(PROJ, id); fs.mkdirSync(dir, { recursive: true });
        // проверенный проект изменили — отметка «Проверено» больше не относится к нему
        const changed = old && JSON.stringify(old.project) !== JSON.stringify(d.project);
        if (old) (old.files || []).forEach(fn => { try { fs.unlinkSync(path.join(dir, fn)); } catch (e) { /* нет файла */ } });
        const files = [];
        const im = d.images || {};
        (im.plans || []).slice(0, 4).forEach((x, i) => { const f = saveFile(dir, x, 'plan-' + (i + 1), ['.png', '.jpg']); if (f) files.push(f); });
        const ex = saveFile(dir, im.exterior, 'exterior', ['.png', '.jpg']); if (ex) files.unshift(ex);
        const pr = Object.assign(old || { id, owner: u.id, votes: {}, requests: [], at: new Date().toISOString() }, { title: str(d.title, 120), about: str(d.about, 3000), price: Math.max(0, Math.min(1e6, Math.round(+d.price || 0))), license: d.license === 'build' ? 'build' : 'view',
          area: +d.area || 0, floors: +d.floors || 1, size: str(d.size, 40), project: d.project, files, status: d.visibility === 'private' ? 'private' : 'published', updatedAt: new Date().toISOString(),
          quality: { score: q.score, errs: q.errs.length, warns: q.warns.length } });
        if (changed && pr.verify && pr.verify.status === 'verified') { pr.verify.status = 'outdated'; pr.verify.log = (pr.verify.log || []).concat({ at: new Date().toISOString(), text: 'автор изменил проверенный проект — отметка снята' }); }
        const asked = d.verify ? askVerify(pr, u) : false;
        writeJSON(path.join(dir, 'project.json'), pr);
        if (!old) tg(TG_OWNER, `Новый проект на площадке: «${pr.title}», ${pr.area} м², ${pr.price ? pr.price + ' ₽' : 'бесплатно'} — ${u.name}`);
        return send(res, 200, { ok: true, id, updated: !!old, status: pr.status, verify: vPub(pr.verify), verifyAsked: asked }), true;
      }
      if (p === '/api/projects' && M === 'GET') {
        const all = users(), q = (url.searchParams.get('q') || '').toLowerCase();
        let list = allProjects().filter(x => x.status === 'published').map(x => card(x, all)).filter(x => !q || (x.title + ' ' + x.about).toLowerCase().includes(q));
        const sort = url.searchParams.get('sort');
        list.sort(sort === 'new' ? (a, b) => b.at.localeCompare(a.at) : sort === 'price' ? (a, b) => a.price - b.price : (a, b) => (b.rating.avg * Math.min(1, b.rating.n / 3)) - (a.rating.avg * Math.min(1, a.rating.n / 3)) || b.at.localeCompare(a.at));
        // проверенные платформой и поднятые модератором — сверху при любой сортировке
        const top = (x) => (x.verify && x.verify.status === 'verified' ? 2 : 0) + (x.boost ? 1 : 0);
        list.sort((a, b) => top(b) - top(a));
        return send(res, 200, list), true;
      }
      const mm = /^\/api\/projects\/([\w-]+)(?:\/(\w+)(?:\/([\w.-]+))?)?$/.exec(p);
      if (mm) {
        const f = projFile(mm[1]), pr = f && readJSON(f, null);
        const act = mm[2], u = me(req);
        if (!pr || (pr.status !== 'published' && !adminOk(req) && !(u && u.id === pr.owner) && !inTeam(pr, u))) return send(res, 404, { ok: false }), true;
        if (!act && M === 'GET') {
          const out = card(pr); const mine = u && u.id === pr.owner, granted = u && ((pr.grants || []).includes(u.id) || inTeam(pr, u));
          if (!pr.price || mine || granted) out.project = pr.project;
          out.mine = !!mine; out.team = !!(u && inTeam(pr, u));
          return send(res, 200, out), true;
        }
        if (act === 'file' && M === 'GET') {
          const fn = path.basename(mm[3] || ''); if (!pr.files.includes(fn)) return send(res, 404, { ok: false }), true;
          res.writeHead(200, { 'Content-Type': IMG[path.extname(fn)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
          return fs.createReadStream(path.join(PROJ, pr.id, fn)).pipe(res), true;
        }
        if (act === 'rate' && M === 'POST') {
          if (!u) return send(res, 401, { ok: false, error: 'Войдите, чтобы оценить' }), true;
          if (u.id === pr.owner) return send(res, 400, { ok: false, error: 'Свой проект оценить нельзя' }), true;
          const d = await body(req, 5e3), st = Math.max(1, Math.min(5, Math.round(+d.stars || 0)));
          pr.votes = pr.votes || {}; pr.votes[u.id] = st; writeJSON(f, pr);
          return send(res, 200, { ok: true, rating: rating(pr) }), true;
        }
        if (act === 'request' && M === 'POST') {
          if (limited(req)) return send(res, 429, { ok: false }), true;
          const d = await body(req, 20e3);
          const gErr = await guard(req, d); if (gErr) return send(res, 400, { ok: false, error: gErr }), true;
          const r = { id: 'r' + Date.now().toString(36), at: new Date().toISOString(), user: u ? u.id : null, name: str(d.name || (u && u.name), 100), phone: str(d.phone || (u && u.phone), 40), email: str(d.email || (u && u.email), 120), comment: str(d.comment, 2000), status: 'new' };
          if (!r.name || r.phone.replace(/\D/g, '').length < 10) return send(res, 400, { ok: false, error: 'Нужны имя и телефон' }), true;
          pr.requests = (pr.requests || []).concat(r); writeJSON(f, pr);
          const au = users().find(x => x.id === pr.owner) || {};
          tg(TG_OWNER, `Запрос эскизного проекта «${pr.title}» (${pr.price ? pr.price + ' ₽' : 'бесплатно'}) от ${r.name}, ${r.phone}. Автор: ${au.name || '—'} ${au.phone || ''}`);
          return send(res, 200, { ok: true }), true;
        }
      }
      if (p === '/api/architects' && M === 'GET') return send(res, 200, users().filter(x => x.archStatus === 'verified').map(x => ({ id: x.id, name: x.name, city: x.city || '', about: str(x.about, 300) }))), true;
      if (p === '/api/my' && M === 'GET') {
        const u = me(req); if (!u) return send(res, 401, { ok: false }), true;
        const all = allProjects();
        const mine = all.filter(x => x.owner === u.id).sort((a, b) => (b.updatedAt || b.at).localeCompare(a.updatedAt || a.at)).map(x => Object.assign(card(x), { requests: (x.requests || []).map(r => ({ at: r.at, name: r.name, phone: r.phone, comment: r.comment, status: r.status })) }));
        const asked = all.filter(x => (x.requests || []).some(r => r.user === u.id)).map(x => ({ id: x.id, title: x.title, price: x.price, granted: (x.grants || []).includes(u.id) }));
        const all2 = users();
        mine.forEach(x => { const pr = all.find(q => q.id === x.id); x.team = (pr.team || []).map(m => ({ key: m.id || m.email, name: m.name || m.email, pending: !m.id && !all2.some(q => String(q.email).toLowerCase() === m.email) })); });
        // проекты клиентов, к которым автор добавил этого пользователя архитектором
        const shared = all.filter(x => x.owner !== u.id && inTeam(x, u)).map(x => { const ow = all2.find(q => q.id === x.owner) || {}; return Object.assign(card(x), { client: { name: ow.name || '—', phone: ow.phone || '', email: ow.email || '' } }); });
        return send(res, 200, { ok: true, user: pub(u), projects: mine, asked, shared, verifyPrice: VP }), true;
      }
      if (p.startsWith('/api/my/project/') && M === 'POST') {
        const u = me(req), id = p.split('/').pop(), f = projFile(id), pr = f && readJSON(f, null);
        if (!u || !pr || pr.owner !== u.id) return send(res, 404, { ok: false }), true;
        const d = await body(req, 20e3);
        if (d.price != null) pr.price = Math.max(0, Math.min(1e6, Math.round(+d.price)));
        if (pr.status === 'blocked' && d.status) return send(res, 403, { ok: false, error: 'Проект заблокирован модератором' + (pr.blockReason ? ': ' + pr.blockReason : '') }), true;
        if (d.status === 'published' && quality) { const q = quality(pr.project); if (!q.ok) return send(res, 422, { ok: false, error: 'Сначала исправьте ошибки в проекте', quality: q }), true; }
        if (['published', 'hidden', 'private'].includes(d.status)) pr.status = d.status;
        if (str(d.title)) pr.title = str(d.title, 120);
        // архитектор проекта: из каталога платформы (id) или свой — по почте
        if (d.addArch) {
          const list = users(), byId = d.addArch.id && list.find(q => q.id === d.addArch.id && q.archStatus === 'verified');
          const email = byId ? String(byId.email).toLowerCase() : str(d.addArch.email, 120).toLowerCase();
          if (!byId && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { ok: false, error: 'Выберите архитектора или укажите его почту' }), true;
          if (email === String(u.email).toLowerCase()) return send(res, 400, { ok: false, error: 'Это ваша почта' }), true;
          const reg = byId || list.find(q => String(q.email).toLowerCase() === email);
          pr.team = (pr.team || []).filter(m => m.email !== email && (!reg || m.id !== reg.id));
          pr.team.push({ id: reg ? reg.id : null, email, name: reg ? reg.name : email, at: new Date().toISOString() });
          if (ctx.mail) ctx.mail(email, `Доступ к проекту «${pr.title}»`, `Здравствуйте!\n\n${u.name} добавил(а) вас архитектором проекта «${pr.title}» на платформе «Логика Дома».\n${reg ? 'Проект — в вашем личном кабинете, раздел «Проекты клиентов»: можно открыть в конструкторе и выгрузить файлы для ArchiCAD.' : 'Зарегистрируйтесь с этой почтой — проект появится в личном кабинете, раздел «Проекты клиентов».'}\n${PUBLIC_URL || ''}\n\nЛогика Дома`);
        }
        if (d.removeArch) pr.team = (pr.team || []).filter(m => m.id !== d.removeArch && m.email !== d.removeArch);
        if (d.verify) {
          if (pr.status === 'blocked') return send(res, 403, { ok: false, error: 'Проект заблокирован модератором' }), true;
          if (quality) { const q = quality(pr.project); if (!q.ok) return send(res, 422, { ok: false, error: 'Сначала исправьте ошибки в проекте', quality: q }), true; }
          if (!askVerify(pr, u)) return send(res, 409, { ok: false, error: 'Проект уже на верификации или проверен' }), true;
        }
        writeJSON(f, pr); return send(res, 200, { ok: true, verify: vPub(pr.verify) }), true;
      }
      /* ---- админка ---- */
      if (p.startsWith('/api/admin/market/')) {
        if (!adminOk(req)) return send(res, 401, { ok: false }), true;
        const parts = p.split('/').filter(Boolean); // api admin market <what> <id> [file]
        if (parts[3] === 'users' && M === 'GET') return send(res, 200, users().map(u => Object.assign(pub(u), { docs: u.docs || [], diploma: u.diploma, sro: u.sro, site: u.site, at: u.at }))), true;
        if (parts[3] === 'user' && parts[4] && M === 'POST') {
          const d = await body(req, 5e3), list = users(), x = list.find(q => q.id === parts[4]); if (!x) return send(res, 404, { ok: false }), true;
          if (['none', 'pending', 'verified', 'rejected'].includes(d.archStatus)) { x.archStatus = d.archStatus; x.role = d.archStatus === 'verified' ? 'architect' : 'user'; }
          writeJSON(USERS, list); return send(res, 200, pub(x)), true;
        }
        if (parts[3] === 'doc' && parts[4] && parts[5] && M === 'GET') {
          const fn = path.basename(parts[5]), fp = path.join(DOCS, path.basename(parts[4]), fn);
          if (!fs.existsSync(fp)) return send(res, 404, { ok: false }), true;
          res.writeHead(200, { 'Content-Type': IMG[path.extname(fn)] || 'application/octet-stream' }); return fs.createReadStream(fp).pipe(res), true;
        }
        if (parts[3] === 'projects' && M === 'GET') { const all = users(); return send(res, 200, allProjects().map(x => Object.assign(card(x, all), { requests: x.requests || [], owner: x.owner }))), true; }
        if (parts[3] === 'project' && parts[4] && M === 'POST') {
          const f = projFile(parts[4]), pr = f && readJSON(f, null); if (!pr) return send(res, 404, { ok: false }), true;
          const d = await body(req, 5e3);
          if (['published', 'hidden', 'blocked'].includes(d.status)) pr.status = d.status;
          if (d.grant) pr.grants = Array.from(new Set((pr.grants || []).concat(String(d.grant))));
          writeJSON(f, pr); return send(res, 200, { ok: true }), true;
        }
        return send(res, 404, { ok: false }), true;
      }
    } catch (e) { console.error(e); return send(res, 400, { ok: false, error: 'Не получилось' }), true; }
    return false;
  };
};
