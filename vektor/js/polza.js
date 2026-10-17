// Polza.ai: генерация и обработка картинок и видео (POST /media, опрос GET /media/{id}),
// ИИ-обработка (удаление фона, апскейл, векторизация) и общий цикл агента с инструментами
// для рабочих пространств «Моушн», «Ноды» и «Make». Все запросы — только к Polza (адрес и ключ
// из настроек агента), все результаты сохраняются на компьютере.
'use strict';

const Polza = {
  // модели по задачам; пусто — выбирается автоматически из списка моделей Polza
  media: { image: 'google/gemini-3.1-flash-image-preview', edit: 'google/gemini-3.1-flash-image-preview', video: 'seedance-2', bg: '', upscale: '', vector: '', videoUpscale: 'topaz/video-upscale', imageField: 'images' },
  POLL: { image: 3000, video: 8000 },
  MAX_WAIT: { image: 900000, video: 1800000 },
  _models: {},

  load() {
    if (typeof Agent !== 'undefined') Agent.load();
    try { Object.assign(Polza.media, JSON.parse(localStorage.getItem('vektor.media') || '{}')); } catch (e) { }
  },
  save() { try { localStorage.setItem('vektor.media', JSON.stringify(Polza.media)); } catch (e) { } },
  get base() { return (Agent.settings.baseUrl || 'https://polza.ai/api/v1').replace(/\/+$/, ''); },
  key() {
    const k = Agent.settings.apiKey;
    if (!k) throw new Error('Не задан ключ Polza.ai: ✦ Агент → ⚙ Настройки.');
    if (/[^\x20-\x7E]/.test(k)) throw new Error('В ключе Polza.ai посторонние символы — вставьте ключ заново в настройках агента.');
    return k;
  },
  // в настольной версии запросы идут через главный процесс: без CORS, с потоками и двоичными данными
  url(u) { return Host.net(u); },
  async req(path, opts = {}) {
    const res = await fetch(Polza.url(Polza.base + path), Object.assign({}, opts, {
      headers: Object.assign({ Authorization: 'Bearer ' + Polza.key() }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {}),
    }));
    const text = await res.text();
    let js = {}; try { js = JSON.parse(text); } catch (e) { js = { raw: text }; }
    if (!res.ok) {
      const msg = (js.error && (js.error.message || js.error)) || js.message || text.slice(0, 400) || res.statusText;
      const err = new Error(`Polza (${res.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      err.status = res.status;
      throw err;
    }
    return js;
  },

  // ---------- модели ----------
  async models(type = 'image') {
    if (Polza._models[type]) return Polza._models[type];
    const js = await Polza.req('/models?type=' + encodeURIComponent(type));
    const list = (js.data || js.models || js || []).map(m => typeof m === 'string' ? { id: m } : m).filter(m => m && (m.id || m.name))
      .map(m => ({ id: m.id || m.name, name: m.name || m.id, description: m.description || '', raw: m }));
    Polza._models[type] = list;
    return list;
  },
  // подходящая модель по словам в id: для фона, апскейла, векторизации
  async pick(kind) {
    if (Polza.media[kind]) return Polza.media[kind];
    const words = { bg: /remove[-_ ]?b(ack)?g|background[-_ ]?remov|rembg|bria.*(bg|background)|birefnet/i, upscale: /upscal|esrgan|topaz.*image|clarity|recraft.*(crisp|creative)/i, vector: /vector|svg/i }[kind];
    if (!words) return '';
    try {
      const list = await Polza.models('image');
      const m = list.find(x => words.test(x.id) || words.test(x.name));
      return m ? m.id : '';
    } catch (e) { return ''; }
  },

  // ---------- заказ и ожидание ----------
  pending() { try { return JSON.parse(localStorage.getItem('vektor.media.pending') || '[]'); } catch (e) { return []; } },
  setPending(list) { try { localStorage.setItem('vektor.media.pending', JSON.stringify(list.slice(-200))); } catch (e) { } },
  // input: { prompt, images?: [dataURL|Blob], ...параметры модели }
  async run(model, input, { type = 'image', onStatus, signal } = {}) {
    if (!model) throw new Error('Не выбрана модель');
    const body = Object.assign({}, input);
    // картинки — строками data: в виде, который принимает шлюз
    for (const k of Object.keys(body)) {
      const v = body[k];
      if (v instanceof Blob) body[k] = { type: 'base64', data: await Polza.dataURL(v) };
      else if (Array.isArray(v) && v.some(x => x instanceof Blob || (typeof x === 'string' && x.startsWith('data:')))) {
        body[k] = await Promise.all(v.map(async x => ({ type: 'base64', data: x instanceof Blob ? await Polza.dataURL(x) : x })));
      } else if (typeof v === 'string' && v.startsWith('data:') && k !== 'prompt') body[k] = { type: 'base64', data: v };
    }
    const order = b => Polza.req('/media', { method: 'POST', body: JSON.stringify({ model, input: b, async: true }) });
    let created;
    try { created = await order(body); } catch (e) {
      // поле не того типа: сообщение называет поле и тип — пробуем один раз с поправкой
      const fixed = Polza.coerce(body, e.message);
      if (!fixed) throw e;
      created = await order(fixed);
    }
    const rec = { id: created.id, model, type, prompt: String(input.prompt || '').slice(0, 300), at: Date.now() };
    if (created.id) Polza.setPending([...Polza.pending(), rec]);
    onStatus && onStatus(created.status || 'pending');
    let result = created;
    if (!(created.status === 'completed' && Polza.payload(created))) {
      const t0 = Date.now();
      for (;;) {
        if (signal && signal.aborted) throw new Error('Остановлено. Заказ записан в «Незабранные» — его можно забрать позже.');
        if (Date.now() - t0 > (Polza.MAX_WAIT[type] || Polza.MAX_WAIT.image)) throw new Error('Долго нет результата. Заказ не пропал — заберите его позже в «Незабранных».');
        await new Promise(r => setTimeout(r, Polza.POLL[type] || 3000));
        result = await Polza.req('/media/' + encodeURIComponent(created.id));
        onStatus && onStatus(result.status);
        if (result.status === 'completed') break;
        if (result.status === 'failed') {
          Polza.setPending(Polza.pending().filter(p => p.id !== created.id));
          throw new Error('Генерация не удалась: ' + ((result.error && (result.error.message || result.error)) || 'ошибка модели'));
        }
      }
    }
    const blob = await Polza.download(result, type);
    Polza.setPending(Polza.pending().filter(p => p.id !== created.id));
    return { blob, id: created.id, cost: result.usage && (result.usage.cost_rub || result.usage.cost), raw: result };
  },
  async collect(id, type = 'image') {
    const r = await Polza.req('/media/' + encodeURIComponent(id));
    if (r.status === 'failed') { Polza.setPending(Polza.pending().filter(p => p.id !== id)); throw new Error('Заказ завершился ошибкой'); }
    if (r.status !== 'completed') return null;
    const blob = await Polza.download(r, type);
    Polza.setPending(Polza.pending().filter(p => p.id !== id));
    return blob;
  },
  coerce(input, message) {
    const m = String(message || '').match(/\binput\.([A-Za-z0-9_]+)/);
    if (!m || !(m[1] in input)) return null;
    const k = m[1], v = input[k];
    const asked = String(message).match(/(?:должно быть|должен быть|must be(?: a| an)?|expected)\s+([^\s,.;]+)/i);
    if (asked && /строк|string/i.test(asked[1]) && typeof v !== 'string') return Object.assign({}, input, { [k]: String(v) });
    if (asked && /числ|number|integer/i.test(asked[1]) && typeof v !== 'number' && isFinite(+v)) return Object.assign({}, input, { [k]: +v });
    return null;
  },
  // где в ответе лежит файл: data:, ссылка, b64_json — ищем по всему ответу
  payload(result) {
    const MEDIA_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a)(\?|#|$)/i;
    const MEDIA_KEY = /(^|_)(url|uri|link|file|output|result|image|video|audio|src|asset|download|svg)s?($|_)/i;
    const NOT_MEDIA = /(^|\/\/)(docs?|help|support|status|www)\.|\/(docs|pricing|terms|privacy|models)(\/|$)/i;
    let best = null; const seen = new Set();
    const walk = (v, key) => {
      if (!v || typeof v === 'number' || typeof v === 'boolean') return;
      if (typeof v === 'string') {
        if (/^data:[^;,]+;base64,/.test(v)) { if (!best || best.score < 4) best = { kind: 'data', url: v, score: 4 }; return; }
        if (/^\s*<svg[\s>]/i.test(v) || /^\s*<\?xml[^>]*>\s*<svg/i.test(v)) { if (!best || best.score < 4) best = { kind: 'svg', text: v, score: 4 }; return; }
        if (/^https?:\/\//.test(v)) {
          const sc = NOT_MEDIA.test(v) ? 0 : MEDIA_EXT.test(v) ? 3 : MEDIA_KEY.test(key) ? 2 : 0;
          if (sc && (!best || sc > best.score)) best = { kind: 'url', url: v, score: sc };
          return;
        }
        if (/^(b64|base64)/i.test(key) && v.length > 256 && /^[A-Za-z0-9+/=\s]+$/.test(v)) { if (!best || best.score < 4) best = { kind: 'b64', data: v, score: 4 }; }
        return;
      }
      if (typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
      for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(result, '');
    return best;
  },
  async download(result, type) {
    const f = Polza.payload(result);
    if (!f) throw new Error('Заказ выполнен, но файла в ответе не нашлось: ' + JSON.stringify(result).slice(0, 300));
    if (f.kind === 'svg') return new Blob([f.text], { type: 'image/svg+xml' });
    if (f.kind === 'data') return (await fetch(f.url)).blob();
    if (f.kind === 'b64') {
      const bin = atob(f.data.replace(/\s+/g, '')); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new Blob([u], { type: type === 'video' ? 'video/mp4' : 'image/png' });
    }
    const r = await fetch(Polza.url(f.url));
    if (!r.ok) throw new Error('Не удалось скачать результат (' + r.status + ')');
    const b = await r.blob();
    if (b.type && b.type !== 'application/octet-stream') return b;
    const ext = (f.url.match(/\.(\w+)(\?|#|$)/) || [])[1] || '';
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', gif: 'image/gif' }[ext.toLowerCase()];
    return new Blob([b], { type: mime || (type === 'video' ? 'video/mp4' : 'image/png') });
  },

  // ---------- готовые операции ----------
  async generateImage(prompt, { images = [], model, params = {}, onStatus, signal } = {}) {
    const input = Object.assign({ prompt }, params);
    if (images.length) input[Polza.media.imageField || 'images'] = images;
    return (await Polza.run(model || (images.length ? Polza.media.edit : Polza.media.image), input, { type: 'image', onStatus, signal })).blob;
  },
  async generateVideo(prompt, { image, endImage, images = [], model, params = {}, onStatus, signal } = {}) {
    const input = Object.assign({ prompt }, params);
    if (image) input.image = image;
    if (endImage) input.end_image = endImage;
    if (images.length) input.images = images;
    return (await Polza.run(model || Polza.media.video, input, { type: 'video', onStatus, signal })).blob;
  },
  // удаление фона: модель удаления фона, а если её нет — модель редактирования кладёт объект
  // на чистый зелёный, и фон вырезается здесь же (хромакей с подавлением зелёной каймы)
  async removeBackground(image, { onStatus, signal } = {}) {
    const m = await Polza.pick('bg');
    if (m) return (await Polza.run(m, { prompt: 'remove background', image, images: [image] }, { onStatus, signal })).blob;
    const green = await Polza.generateImage('Keep the main subject exactly as it is (same shape, colors, details, position and size). Replace the whole background with a flat solid pure green color #00FF00. No shadows, no gradients, no green on the subject.', { images: [image], onStatus, signal });
    return Polza.chromaKey(green);
  },
  async upscale(image, { scale = 2, onStatus, signal } = {}) {
    const m = await Polza.pick('upscale');
    if (m) return (await Polza.run(m, { prompt: 'upscale', image, images: [image], scale, upscale_factor: scale }, { onStatus, signal })).blob;
    return Polza.generateImage(`Upscale this image ${scale}x: identical content and composition, sharper details, higher resolution, no changes.`, { images: [image], onStatus, signal });
  },
  // векторизация: модель Polza, отдающая SVG; без неё — трассировка на компьютере
  async vectorize(image, { colors = 8, palette, onStatus, signal } = {}) {
    const m = await Polza.pick('vector');
    if (m) {
      const b = (await Polza.run(m, { prompt: 'vectorize', image, images: [image] }, { onStatus, signal })).blob;
      const t = await b.text();
      if (/<svg[\s>]/i.test(t)) return t;
    }
    return Polza.trace(image, { colors, palette });
  },
  async trace(image, { colors = 8, palette } = {}) {
    const T = await Host.lib('tracer');
    const img = await Polza.loadImage(image);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
    const data = g.getImageData(0, 0, c.width, c.height);
    const opt = { numberofcolors: colors, ltres: 1, qtres: 1, pathomit: 8, blurradius: 0, strokewidth: 0, viewbox: true };
    if (palette && palette.length) opt.pal = palette.map(hx => { const [r, gg, b] = Color.hexToRgb(hx); return { r, g: gg, b, a: 255 }; });
    return T.imagedataToSVG(data, opt);
  },
  async chromaKey(blob) {
    const img = await Polza.loadImage(blob);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], gg = p[i + 1], b = p[i + 2];
      const key = gg - Math.max(r, b);          // насколько пиксель «зелёный»
      if (key > 90) p[i + 3] = 0;
      else if (key > 25) { p[i + 3] = Math.round(255 * (1 - (key - 25) / 65)); p[i + 1] = Math.max(r, b); }
      else if (key > 0) p[i + 1] = Math.max(r, b) + key * 0.3;   // подавление каймы
    }
    g.putImageData(d, 0, 0);
    return new Promise(r => c.toBlob(r, 'image/png'));
  },

  // ---------- утилиты ----------
  dataURL(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); }); },
  async loadImage(src) {
    const url = src instanceof Blob ? URL.createObjectURL(src) : src;
    const img = new Image(); img.decoding = 'async'; img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Не удалось открыть картинку')); img.src = url; });
    return img;
  },
  // картинка поменьше — для глаз модели
  async thumb(src, max = 1024, type = 'image/jpeg') {
    const img = await Polza.loadImage(src);
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d'); if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type, 0.85);
  },

  // ---------- общий цикл агента с инструментами ----------
  // opts: { system, tools, exec(name,args), history (массив, дополняется), onEvent(ev), maxSteps, shouldStop() }
  async agent(text, opts) {
    const H = opts.history;
    H.push({ role: 'user', content: text });
    const ev = opts.onEvent || (() => { });
    let usage = { p: 0, c: 0 };
    for (let step = 0; step < (opts.maxSteps || +Agent.settings.maxSteps || 60); step++) {
      if (opts.shouldStop && opts.shouldStop()) { ev({ type: 'note', text: 'Остановлено.' }); break; }
      ev({ type: 'status', text: 'Думаю…' });
      const js = await Agent.callModel([{ role: 'system', content: typeof opts.system === 'function' ? opts.system() : opts.system }, ...Polza.trim(H)], opts.tools);
      if (js.usage) { usage.p += js.usage.prompt_tokens || 0; usage.c += js.usage.completion_tokens || 0; }
      const msg = js.choices && js.choices[0] && js.choices[0].message;
      if (!msg) throw new Error('Пустой ответ модели');
      const calls = msg.tool_calls || [];
      H.push({ role: 'assistant', content: msg.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
      if (msg.content && msg.content.trim()) ev({ type: 'assistant', text: msg.content.trim() });
      if (!calls.length) break;
      const images = [];
      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { }
        const entry = { type: 'tool', name: call.function.name, args, status: 'run' };
        ev(entry);
        let result;
        try { result = await opts.exec(call.function.name, args); entry.status = 'ok'; } catch (e) {
          console.warn(e); result = { error: String(e.message || e) }; entry.status = 'err'; entry.error = result.error;
        }
        if (result && result._image) {
          images.push({ url: result._image, caption: result._caption || call.function.name });
          entry.image = result._image;
          result = Object.assign({}, result, { _image: undefined, image: 'изображение приложено следующим сообщением' });
        }
        ev({ type: 'tool-done', entry });
        H.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result === undefined ? { ok: true } : result).slice(0, 60000) });
      }
      if (images.length) H.push({ role: 'user', content: [{ type: 'text', text: 'Изображения от инструментов: ' + images.map(i => i.caption).join('; ') }, ...images.map(i => ({ type: 'image_url', image_url: { url: i.url } }))] });
    }
    if (usage.p || usage.c) ev({ type: 'note', text: `Токены: запрос ${usage.p.toLocaleString('ru')}, ответ ${usage.c.toLocaleString('ru')}` });
  },
  trim(H) {
    let n = 0; const out = [];
    for (let i = H.length - 1; i >= 0; i--) {
      const m = H[i];
      if (Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')) {
        n++;
        if (n > 3) { out.unshift({ role: 'user', content: m.content.filter(p => p.type === 'text').map(p => p.text).join(' ') + ' [картинка скрыта для экономии]' }); continue; }
      }
      out.unshift(m);
    }
    return out;
  },
  tool(name, description, properties = {}, required = []) { return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } }; },

  // ---------- настройки моделей ----------
  async settingsDialog() {
    Polza.load();
    const M = Polza.media;
    const dl = (id) => h('datalist', { id });
    const field = (k, label, list) => { const i = h('input', { type: 'text', class: 'wide', value: M[k] || '', list, placeholder: 'автоматически' }); i.dataset.k = k; return h('label', {}, label, i); };
    const lists = [dl('pzImg'), dl('pzVid')];
    const load = h('button', { class: 'pbt', onclick: async () => {
      load.textContent = 'Загружаю…';
      try {
        const [im, vi] = await Promise.all([Polza.models('image').catch(() => []), Polza.models('video').catch(() => [])]);
        lists[0].innerHTML = im.map(m => `<option value="${Render.esc(m.id)}">${Render.esc(m.name)}</option>`).join('');
        lists[1].innerHTML = vi.map(m => `<option value="${Render.esc(m.id)}">${Render.esc(m.name)}</option>`).join('');
        load.textContent = `Картинки: ${im.length}, видео: ${vi.length}`;
      } catch (e) { load.textContent = e.message; }
    } }, 'Загрузить модели Polza');
    const form = h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'Модели Polza.ai для картинок и видео (ключ — из настроек агента). Пустое поле — модель подбирается автоматически, а если подходящей нет: фон вырезается хромакеем, векторизация идёт на компьютере.'),
      ...lists, load,
      field('image', 'Генерация картинок', 'pzImg'), field('edit', 'Правка по картинке (референсы)', 'pzImg'),
      field('video', 'Генерация видео', 'pzVid'), field('bg', 'Удаление фона', 'pzImg'), field('upscale', 'Увеличение (апскейл)', 'pzImg'),
      field('vector', 'Векторизация (SVG)', 'pzImg'), field('videoUpscale', 'Апскейл видео', 'pzVid'),
      h('label', {}, 'Поле для референсов', h('select', { 'data-k': 'imageField' }, ...['images', 'image', 'image_url', 'image_urls'].map(v => h('option', { value: v, selected: M.imageField === v ? true : undefined }, v)))));
    UI.dialog('Модели Polza для картинок и видео', form, [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: () => {
      form.querySelectorAll('[data-k]').forEach(i => { M[i.dataset.k] = i.value.trim(); });
      Polza.save();
    } }]);
  },
};
Polza.load();
