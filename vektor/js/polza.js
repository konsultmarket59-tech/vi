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
    const cost = result.usage && (result.usage.cost_rub || result.usage.cost);
    if (signal && cost) try { signal.vkCost = (signal.vkCost || 0) + (+cost || 0); } catch (e) { } // «Ноды» показывают стоимость
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
  async removeBackground(image, { model, onStatus, signal } = {}) {
    const m = model || await Polza.pick('bg');
    if (m) return (await Polza.run(m, { prompt: 'remove background', image, images: [image] }, { onStatus, signal })).blob;
    const green = await Polza.generateImage('Keep the main subject exactly as it is (same shape, colors, details, position and size). Replace the whole background with a flat solid pure green color #00FF00. No shadows, no gradients, no green on the subject.', { images: [image], onStatus, signal });
    return Polza.chromaKey(green);
  },
  async upscale(image, { scale = 2, model, onStatus, signal } = {}) {
    const m = model || await Polza.pick('upscale');
    if (m) return (await Polza.run(m, { prompt: 'upscale', image, images: [image], scale, upscale_factor: scale }, { onStatus, signal })).blob;
    return Polza.generateImage(`Upscale this image ${scale}x: identical content and composition, sharper details, higher resolution, no changes.`, { images: [image], onStatus, signal });
  },
  // векторизация: модель Polza, отдающая SVG; без неё — трассировка на компьютере
  async vectorize(image, { colors = 8, palette, model, onStatus, signal } = {}) {
    const m = model || await Polza.pick('vector');
    if (m) {
      const b = (await Polza.run(m, { prompt: 'vectorize', image, images: [image] }, { onStatus, signal })).blob;
      const t = await b.text();
      if (/<svg[\s>]/i.test(t)) return t;
    }
    return Polza.trace(image, { colors, palette, detail: arguments[1] && arguments[1].detail, smooth: arguments[1] && arguments[1].smooth, removeBg: arguments[1] && arguments[1].removeBg });
  },
  // трассировка на компьютере: число цветов, детализация, сглаживание, фирменная палитра, без фона
  async trace(image, { colors = 8, palette, detail = 'mid', smooth = 0, removeBg = false, maxSide = 1600 } = {}) {
    const T = await Host.lib('tracer');
    const img = image instanceof HTMLImageElement || image instanceof HTMLCanvasElement ? image : await Polza.loadImage(image);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const k = Math.min(1, maxSide / Math.max(iw, ih));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
    const data = g.getImageData(0, 0, c.width, c.height);
    const D = { low: { ltres: 3, qtres: 3, pathomit: 24 }, mid: { ltres: 1, qtres: 1, pathomit: 8 }, high: { ltres: 0.5, qtres: 0.5, pathomit: 2 }, max: { ltres: 0.2, qtres: 0.2, pathomit: 0 } }[detail] || {};
    const opt = Object.assign({ numberofcolors: colors, blurradius: smooth, blurdelta: 20, strokewidth: 0, viewbox: true, colorquantcycles: 4, mincolorratio: 0 }, D);
    if (palette && palette.length) opt.pal = palette.map(hx => { const [r, gg, b] = Color.hexToRgb(hx); return { r, g: gg, b, a: 255 }; });
    let svg = T.imagedataToSVG(data, opt);
    if (removeBg) {
      // фон — цвет углов картинки: такие контуры удаляются
      const P = data.data, W = c.width, H = c.height, cs = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4];
      const bg = cs.map(i => [P[i], P[i + 1], P[i + 2]]).reduce((a, x) => [a[0] + x[0] / 4, a[1] + x[1] / 4, a[2] + x[2] / 4], [0, 0, 0]);
      svg = svg.replace(/<path[^>]*fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*\/>/g, (m, r, gg, bb) => (Math.abs(r - bg[0]) + Math.abs(gg - bg[1]) + Math.abs(bb - bg[2]) < 45 ? '' : m));
    }
    return svg;
  },
  // окно векторизации (как в плагинах Figma): настройки и живой просмотр; done(svg)
  async vectorizeDialog(image, done, title = 'Векторизация') {
    const O = Object.assign({ colors: 8, detail: 'mid', smooth: 0, removeBg: false, palette: '', how: 'local' }, (() => { try { return JSON.parse(localStorage.getItem('vektor.vectorize') || '{}'); } catch (e) { return {}; } })());
    const img = await Polza.loadImage(image);
    const colors = h('input', { type: 'range', min: 2, max: 64, value: O.colors }), colorsN = h('b', {}, O.colors);
    const detail = UI.sel([['low', 'Низкая (меньше узлов)'], ['mid', 'Средняя'], ['high', 'Высокая'], ['max', 'Максимальная']], O.detail, () => upd(), '', 200);
    const smooth = h('input', { type: 'range', min: 0, max: 5, value: O.smooth }), smoothN = h('b', {}, O.smooth);
    const removeBg = h('input', { type: 'checkbox', checked: O.removeBg });
    const pal = h('input', { type: 'text', class: 'wide', value: O.palette, placeholder: 'Фирменные цвета через запятую: #E30613, #1D1D1B (необязательно — тогда число цветов из ползунка)' });
    const how = UI.sel([['local', 'На компьютере (трассировка)'], ['model', 'Модель Polza (если выбрана)']], O.how, () => upd(), '', 240);
    const prev = h('div', { class: 'vz-prev' }), info = h('div', { class: 'muted small' });
    const read = () => {
      const palette = pal.value.split(/[,;\s]+/).map(x => x.trim()).filter(x => /^#?[0-9a-f]{6}$/i.test(x)).map(x => x[0] === '#' ? x : '#' + x);
      return { colors: palette.length || +colors.value, detail: detail.value, smooth: +smooth.value, removeBg: removeBg.checked, palette, how: how.value };
    };
    let t = 0;
    const upd = () => {
      colorsN.textContent = colors.value; smoothN.textContent = smooth.value;
      clearTimeout(t);
      t = setTimeout(async () => {
        const o = read();
        if (o.how === 'model') { prev.innerHTML = ''; info.textContent = 'Векторизует модель Polza (просмотра нет).'; return; }
        info.textContent = 'Строю просмотр…';
        const svg = await Polza.trace(img, Object.assign({}, o, { maxSide: 420 }));
        prev.innerHTML = svg.replace(/<svg /, '<svg style="max-width:100%;max-height:100%" ');
        info.textContent = `Контуров в просмотре: ${(svg.match(/<path/g) || []).length}. В результате детализация будет выше.`;
      }, 250);
    };
    for (const el of [colors, smooth, removeBg, pal]) el.addEventListener('input', upd);
    UI.dialog(title, h('div', { class: 'form vz' },
      h('div', { class: 'vz-cols' },
        h('div', {},
          h('label', {}, 'Цветов: ', colorsN, colors),
          h('label', {}, 'Детализация', detail),
          h('label', {}, 'Сглаживание: ', smoothN, smooth),
          h('label', { class: 'row' }, removeBg, ' убрать фон (цвет углов картинки)'),
          h('label', {}, 'Фирменная палитра', pal),
          h('label', {}, 'Чем векторизовать', how),
          Polza.pickRow('vector')),
        h('div', {}, prev, info))),
      [{ label: 'Отмена' }, { label: 'Векторизовать', primary: true, action: () => {
        const o = read();
        try { localStorage.setItem('vektor.vectorize', JSON.stringify(Object.assign({}, o, { palette: pal.value, colors: +colors.value }))); } catch (e) { }
        withBusy('Векторизую…', async onStatus => {
          const svg = o.how === 'model' && (Polza.media.vector || await Polza.pick('vector')) ? await Polza.vectorize(image, Object.assign({ onStatus }, o)) : await Polza.trace(image, o);
          await done(svg, o);
        });
      } }]);
    upd();
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
    if (typeof DS !== 'undefined') await DS.ready();
    H.push({ role: 'user', content: text });
    const ev = opts.onEvent || (() => { });
    let usage = { p: 0, c: 0 };
    for (let step = 0; step < (opts.maxSteps || +Agent.settings.maxSteps || 60); step++) {
      if (opts.shouldStop && opts.shouldStop()) { ev({ type: 'note', text: 'Остановлено.' }); break; }
      ev({ type: 'status', text: 'Думаю…' });
      const js = await Agent.callModel([{ role: 'system', content: (typeof opts.system === 'function' ? opts.system() : opts.system) + (typeof DS !== 'undefined' ? DS.prompt() : '') }, ...Polza.trim(H)], opts.tools);
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
    const row = (k, label) => { const auto = ['bg', 'upscale', 'vector'].includes(k); const p = ModelPick.el(MODEL_KIND[k], M[k], () => { }, { auto }); p.dataset.k = k; return h('label', {}, label, p); };
    const form = h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'Модели Polza.ai для каждой задачи (ключ — из настроек агента). ▾ — выбрать из списка моделей Polza, можно и вписать вручную. «Автоматически» — модель подбирается по названию, а если подходящей нет: фон вырезается хромакеем, векторизация идёт на компьютере.'),
      h('label', {}, 'Модель агентов (чат)', (() => { const p = ModelPick.el('chat', Agent.settings.model, () => { }); p.dataset.chat = '1'; return p; })()),
      row('image', 'Генерация картинок'), row('edit', 'Правка по картинке (референсы)'),
      row('video', 'Генерация видео'), row('bg', 'Удаление фона'), row('upscale', 'Увеличение (апскейл)'),
      row('vector', 'Векторизация (SVG)'), row('videoUpscale', 'Апскейл видео'),
      h('label', {}, 'Поле для референсов', h('select', { 'data-sel': 'imageField' }, ...['images', 'image', 'image_url', 'image_urls'].map(v => h('option', { value: v, selected: M.imageField === v ? true : undefined }, v)))));
    UI.dialog('Модели Polza', form, [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: () => {
      form.querySelectorAll('.mpick[data-k]').forEach(p => { M[p.dataset.k] = p.get(); });
      const ch = form.querySelector('.mpick[data-chat]'); if (ch && ch.get()) { Agent.settings.model = ch.get(); Agent.saveSettings(); Agent.renderMaterials && Agent.el && Agent.renderMaterials(); }
      const sel = form.querySelector('[data-sel]'); if (sel) M.imageField = sel.value;
      Polza.save();
    } }]);
  },
};
Polza.load();

// ---------- выбор модели из списка Polza (везде, где работает ИИ) ----------
// type: 'image' | 'video' | 'chat'. Поле можно и заполнить вручную; ▾ — список моделей Polza с поиском.
const MODEL_KIND = { image: 'image', edit: 'image', bg: 'image', upscale: 'image', vector: 'image', video: 'video', videoUpscale: 'video', chat: 'chat' };
const MODEL_LABEL = { image: 'Генерация картинок', edit: 'Правка по картинке', bg: 'Удаление фона', upscale: 'Апскейл', vector: 'Векторизация', video: 'Видео', videoUpscale: 'Апскейл видео', chat: 'Модель агента (чат)' };
const ModelPick = {
  async list(type) {
    if (type === 'chat') {
      try { const l = await Polza.models('chat'); if (l.length) return l; } catch (e) { }
      return (await Agent.listModels()).map(id => ({ id, name: id, description: '' }));
    }
    return Polza.models(type);
  },
  // поле с кнопкой списка; auto — разрешить «Автоматически» (пустое значение)
  el(type, value, onChange, { auto = false, placeholder = '', width } = {}) {
    const inp = h('input', { type: 'text', class: 'mp-in', value: value || '', placeholder: placeholder || (auto ? 'Автоматически' : 'Модель Polza'), spellcheck: 'false' });
    const stop = e => e.stopPropagation();
    inp.addEventListener('keydown', stop); inp.addEventListener('pointerdown', stop);
    inp.addEventListener('change', () => onChange(inp.value.trim()));
    const btn = h('button', { class: 'mp-btn', type: 'button', title: 'Выбрать из моделей Polza' }, '▾');
    const wrap = h('span', { class: 'mpick', style: width ? { width: width + 'px' } : {} }, inp, btn);
    btn.addEventListener('pointerdown', stop);
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); ModelPick.open(wrap, type, inp.value.trim(), v => { inp.value = v; onChange(v); }, auto); });
    wrap.get = () => inp.value.trim();
    wrap.set = v => { inp.value = v || ''; };
    return wrap;
  },
  close() { if (ModelPick.pop) { ModelPick.pop.remove(); ModelPick.pop = null; document.removeEventListener('pointerdown', ModelPick._out, true); } },
  _out(e) { if (ModelPick.pop && !ModelPick.pop.contains(e.target)) ModelPick.close(); },
  async open(anchor, type, cur, done, auto) {
    ModelPick.close();
    const r = anchor.getBoundingClientRect();
    const q = h('input', { type: 'text', class: 'mp-q', placeholder: 'Поиск модели…', spellcheck: 'false' });
    const box = h('div', { class: 'mp-list' }, h('div', { class: 'mp-note' }, 'Загружаю модели Polza…'));
    const pop = h('div', { class: 'mp-pop' }, q, box);
    const top = Math.min(r.bottom + 2, window.innerHeight - 340);
    Object.assign(pop.style, { left: Math.max(4, Math.min(r.left, window.innerWidth - 424)) + 'px', top: Math.max(4, top) + 'px', minWidth: Math.max(r.width, 300) + 'px' });
    document.body.append(pop);
    ModelPick.pop = pop;
    setTimeout(() => document.addEventListener('pointerdown', ModelPick._out, true), 0);
    q.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') ModelPick.close(); if (e.key === 'Enter') { const f = box.querySelector('.mp-it'); if (f) f.click(); } });
    let list = [];
    try { list = await ModelPick.list(type); } catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'mp-note err' }, 'Список не загрузился: ' + (e.message || e) + '. Модель можно вписать в поле вручную.')); return; }
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      box.innerHTML = '';
      const pick = v => { ModelPick.close(); done(v); };
      if (auto && !s) box.append(h('div', { class: 'mp-it' + (!cur ? ' on' : ''), onclick: () => pick('') }, h('b', {}, 'Автоматически'), h('span', {}, 'подбирается по задаче')));
      const f = list.filter(m => !s || (m.id + ' ' + m.name + ' ' + (m.description || '')).toLowerCase().includes(s));
      for (const m of f.slice(0, 300)) box.append(h('div', { class: 'mp-it' + (m.id === cur ? ' on' : ''), title: m.description || m.id, onclick: () => pick(m.id) }, h('b', {}, m.name || m.id), m.name && m.name !== m.id ? h('span', {}, m.id) : null));
      if (!f.length) box.append(h('div', { class: 'mp-note' }, list.length ? 'Ничего не найдено' : 'Polza не вернула модели этого типа'));
    };
    q.addEventListener('input', draw);
    draw(); q.focus();
  },
};

// перед запуском ИИ-операции из интерфейса: показать и дать сменить модели (выбор запоминается)
Polza.choose = function (kinds, title, extra) {
  Polza.load();
  let skip = false; try { skip = localStorage.getItem('vektor.askModel') === 'no'; } catch (e) { }
  if (skip && !extra) return Promise.resolve(true);
  return new Promise(res => {
    const picks = kinds.map(k => {
      const auto = ['bg', 'upscale', 'vector'].includes(k);
      const p = ModelPick.el(MODEL_KIND[k] || 'image', k === 'chat' ? Agent.settings.model : Polza.media[k], () => { }, { auto });
      return [k, p];
    });
    const ask = h('input', { type: 'checkbox' });
    const form = h('div', { class: 'form' },
      ...picks.map(([k, p]) => h('label', {}, MODEL_LABEL[k] || k, p)),
      ...(extra ? [].concat(extra) : []),
      ['bg', 'upscale', 'vector'].some(k => kinds.includes(k)) ? h('p', { class: 'muted' }, '«Автоматически» — модель подбирается по названию; если подходящей нет, работает модель правки по картинке.') : null,
      h('label', { class: 'row' }, ask, ' Больше не спрашивать (сменить можно в ИИ → Модели Polza)'));
    let ok = false;
    UI.dialog(title || 'Модель Polza', form, [{ label: 'Отмена' }, { label: 'Запустить', primary: true, action: () => {
      for (const [k, p] of picks) { if (k === 'chat') { if (p.get()) { Agent.settings.model = p.get(); Agent.saveSettings(); } } else Polza.media[k] = p.get(); }
      Polza.save();
      if (ask.checked) try { localStorage.setItem('vektor.askModel', 'no'); } catch (e) { }
      ok = true;
    } }], { onClose: () => res(ok) });
  });
};

// строка «модель» для диалогов: выбор сразу запоминается
Polza.pickRow = function (kind, label) {
  Polza.load();
  const auto = ['bg', 'upscale', 'vector'].includes(kind);
  const cur = kind === 'chat' ? Agent.settings.model : Polza.media[kind];
  const p = ModelPick.el(MODEL_KIND[kind] || 'image', cur, v => {
    if (kind === 'chat') { if (v) { Agent.settings.model = v; Agent.saveSettings(); } } else { Polza.media[kind] = v; Polza.save(); }
  }, { auto });
  return h('label', {}, (label || MODEL_LABEL[kind] || kind) + ' — модель', p);
};
