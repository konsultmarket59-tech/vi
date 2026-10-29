/* Демо сайта без сервера: настоящий код кабинетов (market.js, crm-api.js) работает в браузере поверх данных в памяти.
   Входы: заказчик, архитектор, строительная компания — кнопками в демо-панели. */
(function () {
  'use strict';
  try { localStorage.getItem('x'); } catch (e) {
    const m = {}; Object.defineProperty(window, 'localStorage', { value: { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } } });
  }
  // ссылка на конкретный вход: сразу войти этой ролью и открыть кабинет
  if (window.__DEMO_AS && !localStorage.getItem('ld-demo-init')) { localStorage.setItem('ld-demo-init', '1'); localStorage.setItem('dk-token', 'demo-' + window.__DEMO_AS); localStorage.setItem('ld-how-seen', '1'); localStorage.setItem('ld-demo-open', window.__DEMO_AS); }
  const D = '/data', FS = {}, src = window.__DEMO_DATA;
  const b64 = (s) => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  const fhash = (pw, salt) => { let h = 2166136261 >>> 0, out = ''; const s = salt + ':' + pw; for (let r = 0; r < 16; r++) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + r; h = Math.imul(h, 16777619) >>> 0; } out += h.toString(16).padStart(8, '0'); } return out; };
  const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  Object.entries(src).forEach(([k, v]) => { FS[D + '/' + k] = typeof v === 'string' && v.startsWith('b64:') ? b64(v.slice(4)) : JSON.stringify(v); });
  const us = JSON.parse(FS[D + '/users.json']);
  us.forEach(u => { u.pass = fhash('demo12345', u.salt); });
  FS[D + '/users.json'] = JSON.stringify(us);
  // демо-входы: по одному на роль
  const pickU = (f) => us.find(f) || {};
  const ROLES = { client: pickU(u => u.role === 'user' && u.archStatus !== 'verified' && /anna/.test(u.email)), arch: pickU(u => u.archStatus === 'verified'), company: pickU(u => u.role === 'company') };
  const sess = {}; Object.entries(ROLES).forEach(([k, u]) => { if (u.id) sess['demo-' + k] = u.id; });
  FS[D + '/sessions.json'] = JSON.stringify(sess);
  window.__DEMO_ROLES = Object.fromEntries(Object.entries(ROLES).map(([k, u]) => [k, { name: u.name, email: u.email }]));

  const path = { join: (...a) => a.join('/').replace(/\/+/g, '/'), basename: (p) => String(p).split('/').pop(), extname: (p) => { const m = /\.[^./]+$/.exec(String(p)); return m ? m[0] : ''; }, sep: '/' };
  const fs = {
    readFileSync: (p) => { if (!(p in FS)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return FS[p]; },
    writeFileSync: (p, v) => { FS[p] = v; }, existsSync: (p) => p in FS, unlinkSync: (p) => { delete FS[p]; },
    readdirSync: (p) => { const pre = p.replace(/\/$/, '') + '/', s = new Set(); Object.keys(FS).forEach(k => { if (k.startsWith(pre)) s.add(k.slice(pre.length).split('/')[0]); }); return [...s]; },
    mkdirSync: () => {}, createReadStream: (p) => ({ pipe: (res) => { res.body = FS[p]; } }),
  };
  const Buffer = { from: (v, enc) => enc === 'base64' ? b64(String(v)) : String(v) };
  const ncrypto = { randomBytes: (n) => { const a = crypto.getRandomValues(new Uint8Array(n)); a.toString = () => rnd(n); return a; }, scryptSync: (pw, salt) => ({ toString: () => fhash(pw, salt) }), timingSafeEqual: (a, b) => String(a) === String(b) };
  const readJSON = (p, d) => { try { const v = fs.readFileSync(p); return JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v)); } catch (e) { return d; } };
  const writeJSON = (p, v) => { FS[p] = JSON.stringify(v); };
  const send = (res, code, v, type) => { res.code = code; res.body = v; res.type = type; };
  const mail = async () => false, tg = async () => false;
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
  const quality = (p) => { const DK = window.DK, q = DK.normalize(DK.migrate(JSON.parse(JSON.stringify(p)))); ['b', 'f1', 'f2', 'f3'].forEach(k => { if (!q.levels[k]) q.levels[k] = DK.emptyLevel(); }); return DK.quality(q); };
  const ctx = { send, body: async (req) => req._body || {}, readJSON, writeJSON, str, tg, DATA: D, limited: () => false, TG_OWNER: '', ADMIN_KEY: '', PUBLIC_URL: 'https://logikadoma.ru', quality, mail, guard: async () => null, VERIFY_PRICE: 15000, cms: { all: () => [], get: () => null }, preview: () => '' };
  // визуализации: тот же credits.js, что на сервере; в демо — запас кодов и баланс у заказчика
  ctx.credits = (() => { const m = { exports: null }; window.__CREDITS(() => null, m, { env: {} }, Buffer); return m.exports({ readJSON, writeJSON, DATA: D, crypto: ncrypto }); })();
  if (!FS[D + '/viz-codes.json']) {
    writeJSON(D + '/viz-settings.json', { packs: [{ n: 3, price: 150, url: 'https://example.com/pay-3' }, { n: 10, price: 450, url: 'https://example.com/pay-10' }, { n: 30, price: 1200, url: 'https://example.com/pay-30' }], welcome: 1 });
    ctx.credits.make(3, 5, 'Демо-партия', 'Демо'); ctx.credits.make(10, 5, 'Демо-партия', 'Демо');
    if (ROLES.client.id) { ctx.credits.add(ROLES.client.id, 1, 'grant', 'welcome', '', 'Подарок за регистрацию'); ctx.credits.add(ROLES.client.id, 10, 'code', 'LD-DEMO-0010', '', 'Код на 10'); ctx.credits.add(ROLES.client.id, -2, 'render', '', '', 'Визуализация'); }
  }
  window.__DEMO_CODE = (ctx.credits.codes().find(c => !c.usedBy) || {}).code;
  const mk = (fn) => { const m = { exports: null }; fn(function (n) { return { fs, path, crypto: ncrypto }[n]; }, m, { env: {} }, Buffer); return m.exports(ctx); };
  const crmH = mk(window.__CRM_API), marketH = mk(window.__MARKET_API);
  // то, что в server.js: токен формы, каталог, заявка
  async function own(req, res, url) {
    const p = url.pathname;
    if (p === '/api/form-token') return send(res, 200, { t: (Date.now() - 5000) + '.demo' }), true;
    if (p === '/api/catalog') return send(res, 200, readJSON(D + '/companies.json', []).filter(c => c.status === 'approved')), true;
    if (p === '/api/prices') return send(res, 404, { ok: false }), true;
    if (p === '/api/lead' && req.method === 'POST') { const id = 'DEMO-' + rnd(2).toUpperCase(); return send(res, 200, { ok: true, id }), true; }
    if (p === '/api/register' && req.method === 'POST') return send(res, 200, { ok: true }), true;
    return false;
  }
  const MT = { png: 'image/png', jpg: 'image/jpeg' };
  const dataUrl = (p) => { const b = FS[p]; if (!(b instanceof Uint8Array)) return null; let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return 'data:' + (MT[p.split('.').pop()] || 'image/png') + ';base64,' + btoa(s); };
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const u = typeof input === 'string' ? input : input.url;
    if (!/^\/api\//.test(u)) return realFetch(input, init);
    init = init || {};
    const h = {}; const hh = init.headers || {};
    if (hh instanceof Headers) hh.forEach((v, k) => { h[k.toLowerCase()] = v; }); else Object.keys(hh).forEach(k => { h[k.toLowerCase()] = hh[k]; });
    const req = { method: (init.method || 'GET').toUpperCase(), headers: h, _body: init.body ? JSON.parse(init.body) : null, socket: {} };
    const res = { writeHead(c, hd) { this.code = c; this.type = hd && hd['Content-Type']; } }; const url = new URL(u, 'https://logikadoma.ru');
    await new Promise(r => setTimeout(r, 40));
    const ok = (await crmH(req, res, url)) || (await marketH(req, res, url)) || (await own(req, res, url));
    if (!ok) return new Response(JSON.stringify({ ok: false, error: 'Нет в демо' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    if (res.body instanceof Uint8Array) return new Response(new Blob([res.body], { type: res.type || 'application/octet-stream' }), { status: res.code || 200 });
    return new Response(JSON.stringify(res.body), { status: res.code || 200, headers: { 'Content-Type': 'application/json' } });
  };
  // картинки проектов (<img src="/api/projects/…/file/…">) — data:-адресами
  const fix = (img) => { const m = /^\/api\/projects\/([\w-]+)\/file\/([\w.-]+)$/.exec(img.getAttribute('src') || ''); if (m) { const d = dataUrl(`${D}/projects/${m[1]}/${m[2]}`); if (d) img.src = d; } };
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') fix(n); n.querySelectorAll && n.querySelectorAll('img[src^="/api/"]').forEach(fix); }))).observe(document.documentElement, { childList: true, subtree: true });
  window.__DEMO_LOGIN = (k) => { localStorage.setItem('dk-token', 'demo-' + k); localStorage.setItem('ld-how-seen', '1'); localStorage.setItem('ld-demo-open', k); location.reload(); };
})();
