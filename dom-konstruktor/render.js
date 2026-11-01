/* Реалистичная визуализация через API «Пользы» (polza.ai): снимок дома из конструктора → фотореалистичный рендер.
   Ключ только на сервере: POLZA_API_KEY в .env; POLZA_MODEL — модель (по умолчанию gemini-2.5-flash-image), POLZA_BASE_URL — адрес API.
   Взаиморасчёт: перед генерацией списывается 1 визуализация (резерв), при ошибке или таймауте — возвращается.
   Запрос: POST {base}/v1/media { model, input: { prompt, images: [{ type: 'base64', data }], aspect_ratio, output_format }, async: true },
   затем опрос GET {base}/v1/media/{id} до status 'completed' (ссылка на картинку — в data) или 'failed'.
   Картинки хранятся в data/runtime/renders/<пользователь>/, список — renders.json. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const PROMPT = {
  ext: 'Photorealistic architectural visualization from the attached 3D massing render. Preserve exactly: house shape, dimensions, number of floors, roof shape, pitch, color and material; every window and door with position, size and frame color; facade materials and colors; terraces, steps, railings, pool, paths; camera position, lens, perspective and crop. Lighting: golden hour about 30 minutes before sunset, low sun behind or side-behind the house and trees (backlight, contre-jour), warm golden rim light on tree crowns, roof edges and railings, long soft shadows toward the camera, gentle haze; clear sky warm gold near the horizon fading to soft blue, a few thin clouds; soft warm interior light 2700–3000 K in windows, not glowing; realistic reflections in glass. Environment: mature deciduous trees, well-kept lawn, low shrubs and ornamental grasses that never cover the house or paths. Style: professional real-estate architectural photography, natural contrast, crisp edges, photorealistic. Forbidden: people, animals, cars; any text, letters, numbers, signs, logos, watermarks; changes to architecture, materials or colors; new windows, chimneys, extensions or balconies; neon glow, overexposed windows, heavy HDR, orange cast, lens flares, wet surfaces.',
  int: 'Photorealistic interior visualization from the attached 3D room render. Preserve exactly: room shape and dimensions, ceiling height; windows, doors and openings with position and size; furniture layout, sizes and placement; camera position, lens, perspective and crop. Lighting: late afternoon golden hour, low warm sunlight through the existing windows, soft light beams and gentle bounce light; warm 2700–3000 K lamps at low intensity; balanced exposure, windows bright but not blown out. Materials: realistic wood, fabric, stone, tile and paint textures in the colors of the source, neutral whites. Styling: tidy lived-in look, a few books, plants and textiles, no clutter. Style: professional interior photography for real-estate listings, photorealistic. Forbidden: people, pets; any text, letters, numbers, posters with writing, logos, watermarks; moving walls, windows, doors or furniture; neon light, heavy HDR, oversaturated colors, lens flares.',
};

module.exports = function render(ctx) {
  const { send, body, readJSON, writeJSON, DATA, credits, me, tg, TG_OWNER } = ctx;
  const KEY = process.env.POLZA_API_KEY || '', BASE = (process.env.POLZA_BASE_URL || 'https://polza.ai/api').replace(/\/$/, '');
  const MODEL = process.env.POLZA_MODEL || 'gemini-2.5-flash-image', WAIT = (+process.env.POLZA_WAIT || 180) * 1000;
  const DIR = path.join(DATA, 'renders'), LIST = path.join(DATA, 'renders.json');
  const ready = () => !!KEY;
  const list = () => readJSON(LIST, []);
  const running = new Map(), hourly = new Map();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function polza(method, p, payload) {
    const r = await fetch(BASE + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + KEY }, payload ? { 'Content-Type': 'application/json' } : {}), body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(60000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* не JSON */ }
    if (!r.ok) throw new Error((j && (j.error && (j.error.message || j.error) || j.message)) || ('Сервис генерации ответил ' + r.status));
    return j || {};
  }
  const urls = (x) => { const d = x && x.data, out = [];
    if (d && typeof d === 'object' && !Array.isArray(d)) { if (typeof d.url === 'string') out.push(d.url); for (const k of ['urls', 'files']) if (Array.isArray(d[k])) out.push(...d[k].filter(v => typeof v === 'string')); for (const k of ['images', 'results', 'items']) if (Array.isArray(d[k])) d[k].forEach(v => v && typeof v.url === 'string' && out.push(v.url)); }
    else if (Array.isArray(d)) d.forEach(v => typeof v === 'string' ? out.push(v) : v && typeof v.url === 'string' && out.push(v.url));
    return out; };
  // генерация: запуск и опрос до готовности
  async function generate(kind, dataUrl, aspect) {
    let x = await polza('POST', '/v1/media', { model: MODEL, input: { prompt: PROMPT[kind], images: [{ type: 'base64', data: dataUrl }], aspect_ratio: aspect, output_format: 'jpeg' }, async: true });
    const t0 = Date.now();
    while ((x.status || '').toLowerCase() !== 'completed') {
      if ((x.status || '').toLowerCase() === 'failed') throw new Error((x.error && x.error.message) || 'Генерация не удалась');
      if (!x.id) throw new Error('Сервис генерации не вернул номер задачи');
      if (Date.now() - t0 > WAIT) throw new Error('Генерация заняла слишком много времени');
      await sleep(3000);
      x = await polza('GET', '/v1/media/' + encodeURIComponent(x.id));
    }
    const u = urls(x)[0]; if (!u) throw new Error('В ответе нет картинки');
    const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Не удалось скачать картинку');
    return { buf: Buffer.from(await r.arrayBuffer()), cost: x.cost || x.price || null, mediaId: x.id || '' };
  }

  return async function handle(req, res, url) {
    const p = url.pathname, M = req.method;
    if (!p.startsWith('/api/render')) return false;
    // картинка — по длинной случайной ссылке (её можно открыть и вставить в <img> без входа)
    const fm = /^\/api\/render\/file\/(r[a-f0-9]{18})\.jpg$/.exec(p);
    if (fm && M === 'GET') {
      const x = list().find(q => q.id === fm[1]); if (!x) return send(res, 404, { ok: false }), true;
      const f = path.join(DIR, x.user, x.id + '.jpg'); if (!fs.existsSync(f)) return send(res, 404, { ok: false }), true;
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }); fs.createReadStream(f).pipe(res); return true;
    }
    const u = me(req); if (!u) return send(res, 401, { ok: false, error: 'Войдите в личный кабинет' }), true;
    if (p === '/api/renders' && M === 'GET') return send(res, 200, { ok: true, ready: ready(), balance: credits.balance(u.id), list: list().filter(x => x.user === u.id).reverse().slice(0, 60).map(x => ({ id: x.id, at: x.at, kind: x.kind, title: x.title, url: '/api/render/file/' + x.id + '.jpg' })) }), true;
    if (p === '/api/render' && M === 'POST') {
      if (!ready()) return send(res, 503, { ok: false, error: 'Генерация скоро появится — визуализации на балансе сохранятся' }), true;
      const d = await body(req, 8e6), kind = d.kind === 'int' ? 'int' : 'ext';
      if (!/^data:image\/(jpeg|png);base64,/.test(String(d.image || ''))) return send(res, 400, { ok: false, error: 'Нет снимка из конструктора' }), true;
      // лимиты: одна генерация за раз и 30 в час на пользователя
      if (running.get(u.id)) return send(res, 429, { ok: false, error: 'Предыдущая визуализация ещё готовится' }), true;
      const h = (hourly.get(u.id) || []).filter(t => Date.now() - t < 3600e3); if (h.length >= 30) return send(res, 429, { ok: false, error: 'Не больше 30 визуализаций в час' }), true;
      if (credits.balance(u.id) < 1) return send(res, 402, { ok: false, error: 'На балансе нет визуализаций', needPack: true }), true;
      const id = 'r' + crypto.randomBytes(9).toString('hex'), title = String(d.title || '').slice(0, 120);
      running.set(u.id, true); h.push(Date.now()); hourly.set(u.id, h);
      credits.add(u.id, -1, 'render', id, '', kind === 'ext' ? 'Визуализация снаружи' : 'Визуализация интерьера');
      try {
        const g = await generate(kind, d.image, /^(16:9|4:3|3:2|1:1)$/.test(d.aspect) ? d.aspect : '16:9');
        fs.mkdirSync(path.join(DIR, u.id), { recursive: true }); fs.writeFileSync(path.join(DIR, u.id, id + '.jpg'), g.buf);
        const all = list(); all.push({ id, user: u.id, at: new Date().toISOString(), kind, title, model: MODEL, media: g.mediaId, cost: g.cost }); writeJSON(LIST, all);
        return send(res, 200, { ok: true, id, url: '/api/render/file/' + id + '.jpg', balance: credits.balance(u.id) }), true;
      } catch (e) {
        credits.add(u.id, 1, 'refund', id, '', 'Возврат: ' + String(e.message).slice(0, 120));
        if (tg) tg(TG_OWNER, `Визуализация не удалась (${u.email}): ${e.message}`);
        return send(res, 502, { ok: false, error: 'Не получилось: ' + e.message + '. Визуализация возвращена на баланс.', balance: credits.balance(u.id) }), true;
      } finally { running.delete(u.id); }
    }
    return send(res, 404, { ok: false }), true;
  };
};
module.exports.PROMPT = PROMPT;
