/* Демо-режим CRM без сервера: настоящий код crm-api.js работает в браузере поверх данных в памяти. */
(function () {
  'use strict';
  try { localStorage.getItem('x'); } catch (e) {
    const m = {}; Object.defineProperty(window, 'localStorage', { value: { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } } });
  }
  const D = '/data', FS = {}, src = window.__DEMO_DATA;
  const b64 = (s) => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  const fhash = (pw, salt) => { let h = 2166136261 >>> 0, out = ''; const s = salt + ':' + pw; for (let r = 0; r < 16; r++) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + r; h = Math.imul(h, 16777619) >>> 0; } out += h.toString(16).padStart(8, '0'); } return out; };
  const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  Object.entries(src).forEach(([k, v]) => { FS[D + '/' + k] = typeof v === 'string' && v.startsWith('b64:') ? b64(v.slice(4)) : JSON.stringify(v); });
  // пароли демо-аккаунтов
  const us = JSON.parse(FS[D + '/users.json']);
  us.forEach(u => { u.pass = fhash(u.role === 'staff' ? 'demo12345' : 'company123', u.salt); });
  FS[D + '/users.json'] = JSON.stringify(us);
  const sess = {}; us.filter(u => u.role === 'staff').forEach(u => { sess['demo-' + u.staffRole] = u.id; });
  FS[D + '/sessions.json'] = JSON.stringify(sess);
  window.__DEMO_USERS = us.filter(u => u.role === 'staff').map(u => ({ email: u.email, name: u.name, role: u.staffRole }));

  const path = {
    join: (...a) => a.join('/').replace(/\/+/g, '/'),
    basename: (p) => String(p).split('/').pop(),
    extname: (p) => { const m = /\.[^./]+$/.exec(String(p)); return m ? m[0] : ''; },
  };
  const fs = {
    readFileSync: (p) => { if (!(p in FS)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return FS[p]; },
    writeFileSync: (p, v) => { FS[p] = v; },
    readdirSync: (p) => { const pre = p.replace(/\/$/, '') + '/', s = new Set(); Object.keys(FS).forEach(k => { if (k.startsWith(pre)) s.add(k.slice(pre.length).split('/')[0]); }); if (!s.size) throw new Error('ENOENT'); return [...s]; },
    mkdirSync: () => {},
  };
  const Buffer = { from: (v, enc) => enc === 'base64' ? b64(String(v)) : String(v) }; // base64 → байты для медиатеки
  const ncrypto = { randomBytes: (n) => { const a = crypto.getRandomValues(new Uint8Array(n)); a.toString = () => rnd(n); return a; }, scryptSync: (pw, salt) => ({ toString: () => fhash(pw, salt) }), timingSafeEqual: (a, b) => String(a) === String(b) };
  const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p)); } catch (e) { return d; } };
  const writeJSON = (p, v) => { FS[p] = JSON.stringify(v); };
  const send = (res, code, v, type) => { res.code = code; res.body = v; res.type = type; };
  const mail = async (to, subject, text) => {
    const a = readJSON(D + '/outbox.json', []);
    a.unshift({ at: new Date().toISOString(), to, subject, text: String(text).slice(0, 4000), sent: false, error: 'демо-режим: письмо только в журнале' });
    writeJSON(D + '/outbox.json', a.slice(0, 500)); return false;
  };
  // модули сервера в браузере: контент, CMS, генератор страниц (для предпросмотра)
  const mods = {};
  const req2 = (n) => ({ fs, path, crypto: ncrypto, vm: { runInNewContext() {} }, './content.js': mods.content, './cms-store.js': mods.cms, './docs-content.js': mods.docs }[n]);
  const load = (n) => { const m = { exports: null }; window['__MOD_' + n](req2, m, { env: {} }, Buffer, '/app'); return (mods[n] = m.exports); };
  load('content'); load('docs'); load('cms');
  const store = mods.cms(D, mods.content, { brand: 'Логика Дома', owner: {} });
  const pagesH = load('pages')({ send() {}, PUBLIC_URL: 'https://logikadoma.ru', ROOT: '/app', DATA: D, cms: store });
  const preview = (rq, r) => mediaUrls(pagesH.preview(rq, r)).replace('<link rel="stylesheet" href="/css/pages.css">', '<style>' + window.__PAGES_CSS + '</style>');
  const quality = (p) => { const DK = window.DK, q = DK.normalize(DK.migrate(JSON.parse(JSON.stringify(p)))); ['b', 'f1', 'f2', 'f3'].forEach(k => { if (!q.levels[k]) q.levels[k] = DK.emptyLevel(); }); return DK.quality(q); };
  // картинки медиатеки — из памяти
  const blobs = {};
  const b64of = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const MT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' };
  // файлы медиатеки — data:-адресами (просмотрщик не пускает blob: и чужие адреса)
  const mediaUrls = (t) => String(t).replace(/\/media\/([\w-]+\.(png|jpe?g|webp|gif|mp3|m4a|ogg|mp4|webm))/g, (m, f, e) => { const b = FS[D + '/media/' + f]; if (!b) return m; return blobs[f] || (blobs[f] = 'data:' + MT[e] + ';base64,' + b64of(b)); });
  const credits = (() => { const m = { exports: null }; window.__CREDITS(() => null, m, { env: {} }, Buffer); return m.exports({ readJSON, writeJSON, DATA: D, crypto: ncrypto }); })();
  if (!FS[D + '/viz-codes.json']) { credits.make(3, 6, 'Демо-партия', 'Демо'); credits.make(10, 6, 'Демо-партия', 'Демо'); credits.make(30, 3, 'Для архитекторов', 'Демо'); credits.issue(10, 'client@mail.example', 'Демо', 'Платёж №12345'); }

  // демо-наполнение каталога в просмотре: удалить и вернуть — из снимка данных при загрузке
  const demoSnap = { files: Object.keys(FS).filter(k => k.startsWith(D + '/projects/demo-')).map(k => [k, FS[k]]), comps: readJSON(D + '/companies.json', []).filter(c => c.demo), users: readJSON(D + '/users.json', []).filter(u => u.demo) };
  const demoApi = {
    counts() { const c = readJSON(D + '/companies.json', []).filter(x => x.demo); return { projects: new Set(Object.keys(FS).filter(k => k.startsWith(D + '/projects/demo-')).map(k => k.split('/')[3])).size, builders: c.filter(x => x.type === 'builder').length, architects: c.filter(x => x.type !== 'builder').length, state: {} }; },
    purge() { Object.keys(FS).filter(k => k.startsWith(D + '/projects/demo-')).forEach(k => delete FS[k]); writeJSON(D + '/companies.json', readJSON(D + '/companies.json', []).filter(c => !c.demo)); writeJSON(D + '/users.json', readJSON(D + '/users.json', []).filter(u => !u.demo)); return this.counts(); },
    seed() { this.purge(); demoSnap.files.forEach(([k, v]) => { FS[k] = v; }); writeJSON(D + '/companies.json', readJSON(D + '/companies.json', []).concat(demoSnap.comps)); writeJSON(D + '/users.json', readJSON(D + '/users.json', []).concat(demoSnap.users)); return this.counts(); },
  };
  const mod = { exports: null };
  window.__CRM_API(function (n) { return { fs, path, crypto: ncrypto }[n]; }, mod, { env: {} }, Buffer);
  const handle = mod.exports({ send, body: async (req) => req._body || {}, readJSON, writeJSON, str: (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200),
    DATA: D, ADMIN_KEY: '', PUBLIC_URL: 'https://logikadoma.ru', credits, demo: demoApi, mail, limited: () => false, cms: store, preview, quality });

  const realFetch = window.fetch.bind(window); // fetchCss: /css/pages.css отдаём из сборки

  window.fetch = async function (input, init) {
    const u = typeof input === 'string' ? input : input.url;
    if (u === '/css/pages.css') return new Response(window.__PAGES_CSS, { headers: { 'Content-Type': 'text/css' } });
    if (!/^\/api\//.test(u)) return realFetch(input, init);
    init = init || {};
    const h = {}; const hh = init.headers || {};
    if (hh instanceof Headers) hh.forEach((v, k) => { h[k.toLowerCase()] = v; }); else Object.keys(hh).forEach(k => { h[k.toLowerCase()] = hh[k]; });
    const req = { method: (init.method || 'GET').toUpperCase(), headers: h, _body: init.body ? JSON.parse(init.body) : null, socket: {} };
    const res = {}; const url = new URL(u, 'https://logikadoma.ru');
    await new Promise(r => setTimeout(r, 60));
    const ok = await handle(req, res, url);
    if (!ok) return new Response(JSON.stringify({ ok: false, error: 'Нет в демо' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    if (res.body instanceof Uint8Array) return new Response(new Blob([res.body], { type: res.type || 'application/octet-stream' }), { status: res.code });
    return new Response(mediaUrls(JSON.stringify(res.body)), { status: res.code, headers: { 'Content-Type': 'application/json' } });
  };
  if (window.__DEMO_AS_CRM && !localStorage.getItem('ld-crm-init')) { localStorage.setItem('ld-crm-init', '1'); localStorage.setItem('crm-token', 'demo-' + window.__DEMO_AS_CRM); }
  if (!localStorage.getItem('crm-token')) localStorage.setItem('crm-token', 'demo-admin');
})();
