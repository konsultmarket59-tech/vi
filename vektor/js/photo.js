// «Фото»: растровый редактор как Photoshop (встроенный miniPaint, MIT — слои, режимы наложения,
// кисти, штамп, текст, кадрирование, фильтры) + обработка как в Lightroom (develop.js),
// файлы PSD (ag-psd, MIT), ИИ через Polza (фон, апскейл, генеративное расширение и правка),
// экспорт с сжатием без видимой потери качества и обмен с «Вектором», «Фигмой», «Моушном».
'use strict';

const PhotoWS = {
  el: null, frame: null, editing: null,
  BLEND: { 'normal': 'source-over', 'multiply': 'multiply', 'screen': 'screen', 'overlay': 'overlay', 'darken': 'darken', 'lighten': 'lighten', 'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light', 'difference': 'difference', 'exclusion': 'exclusion', 'hue': 'hue', 'saturation': 'saturation', 'color': 'color', 'luminosity': 'luminosity', 'linear dodge': 'lighter' },
  build() {
    const el = h('div', { class: 'photows' });
    const B = (label, title, fn, cls = 'pbt') => h('button', { class: cls, title, onclick: fn }, label);
    const menu = (label, title, items) => B(label, title, e => { const r = e.currentTarget.getBoundingClientRect(); UI.showMenuList(items(), r.left, r.bottom); });
    el.append(h('div', { class: 'wsbar' },
      B('Открыть', 'JPG, PNG, WEBP, PSD (слои)', () => PhotoWS.openDialog()),
      menu('Сохранить ▾', 'PSD со слоями или картинка', () => [
        { label: 'PSD (слои, для Photoshop)…', action: () => PhotoWS.savePSD() },
        { label: 'PNG…', action: () => PhotoWS.exportImage('png') },
        { label: 'JPG…', action: () => PhotoWS.exportImage('jpg') },
        { label: 'WEBP…', action: () => PhotoWS.exportImage('webp') },
        '-', { label: 'Сжать до минимума без видимой потери…', action: () => PhotoWS.compressDialog() }]),
      h('span', { class: 'sep' }),
      B('✦ Обработка', 'Свет, цвет, детали, пресеты — как в Lightroom (к текущему слою)', () => PhotoWS.develop(), 'primary'),
      B('Холст…', 'Расширить или уменьшить холст, сменить размер', () => PhotoWS.canvasDialog()),
      h('span', { class: 'sep' }), h('span', { class: 'muted' }, 'ИИ (Polza):'),
      B('Удалить фон', 'У текущего слоя', () => PhotoWS.ai('bg')), B('Увеличить', 'Апскейл текущего слоя', () => PhotoWS.ai('upscale')),
      B('Дорисовать края…', 'Генеративное расширение: холст больше, ИИ дорисовывает', () => PhotoWS.outpaintDialog()),
      B('Изменить по описанию…', 'Генеративная правка всей картинки', () => PhotoWS.editDialog()),
      h('span', { class: 'sep' }),
      menu('Отправить ▾', '', () => [
        ...(PhotoWS.editing ? [{ label: '← Вернуть в «Вектор» (заменить картинку)', action: () => PhotoWS.backToVektor() }] : []),
        { label: '→ «Вектор» новой картинкой', action: () => PhotoWS.send('vektor') },
        { label: '→ «Фигма»', action: () => PhotoWS.send('figma') }, { label: '→ «Моушн»', action: () => PhotoWS.send('motion') },
        { label: '→ Мокап (как дизайн)', action: () => PhotoWS.send('mockup-design') }, { label: '→ Мокап (как фото-основа)', action: () => PhotoWS.send('mockup-base') }]),
      h('span', { class: 'grow' }), B('⚙ Polza', '', () => Polza.settingsDialog())));
    PhotoWS.frame = h('iframe', { class: 'figframe', src: 'photo/index.html?lang=ru' });
    el.append(PhotoWS.frame);
    PhotoWS.ready = new Promise(res => {
      const check = () => { try { const w = PhotoWS.frame.contentWindow; if (w && w.Layers && w.AppConfig && w.AppConfig.layers && w.AppConfig.layers.length) return res(w); } catch (e) { } setTimeout(check, 150); };
      PhotoWS.frame.addEventListener('load', check); check();
    });
    return el;
  },
  async mp() { if (WS.current !== 'photo') WS.show('photo'); return PhotoWS.ready; },

  // ---------- документ miniPaint ----------
  docJSON(w, hh, layers) {
    // layers: [{name, canvas|dataURL, x, y, opacity(0..1), visible, blend}] — снизу вверх
    const L = [], D = [];
    layers.forEach((l, i) => {
      const id = i + 1;
      const data = l.data || l.canvas.toDataURL('image/png');
      const lw = l.width || l.canvas.width, lh = l.height || l.canvas.height;
      L.unshift({ id, parent_id: 0, name: l.name || 'Слой ' + id, type: 'image', link: null, x: l.x || 0, y: l.y || 0, width: lw, height: lh, width_original: lw, height_original: lh,
        visible: l.visible !== false, is_vector: false, hide_selection_if_active: false, opacity: Math.round((l.opacity ?? 1) * 100), order: id, composition: l.blend || 'source-over',
        rotate: 0, data: null, params: {}, status: null, color: null, filters: [], render_function: null });
      D.push({ id, data });
    });
    return { info: { width: w, height: hh, version: '4.14.3', layer_active: layers.length, guides: [], date: new Date().toISOString() }, user_fonts: {}, layers: L, data: D };
  },
  async openImage(blob, name = 'Фото') {
    const mp = await PhotoWS.mp();
    const img = await Polza.loadImage(blob);
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    await mp.FileOpen.load_json(PhotoWS.docJSON(c.width, c.height, [{ name, canvas: c }]));
    PhotoWS.name = name.replace(/\.\w+$/, '');
  },
  async openDialog() {
    const [f] = await Host.pickFiles('.jpg,.jpeg,.png,.webp,.gif,.bmp,.psd', false, 'Открыть фото или PSD');
    if (f) PhotoWS.openBuffer(await f.read(), f.name);
  },
  async openBuffer(buf, name) {
    PhotoWS.editing = null;
    await withBusy('Открываю ' + name + '…', async () => {
      if (/\.psd$/i.test(name)) return PhotoWS.openPSD(buf, name);
      await PhotoWS.openImage(new Blob([buf], { type: Host.mimeOf(name) }), name);
    });
  },
  async openPSD(buf, name) {
    const psd = (await Host.lib('psd')).readPsd(new Uint8Array(buf), { skipThumbnail: true });
    const layers = [];
    const walk = (list, hidden) => {
      for (const l of list || []) {
        if (l.children) { walk(l.children, hidden || l.hidden); continue; }
        if (!l.canvas) continue;
        let cv = l.canvas;
        // маска слоя — сразу в пиксели (в редакторе масок нет)
        if (l.mask && l.mask.canvas && !l.mask.disabled) {
          const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d');
          g.drawImage(cv, 0, 0); g.globalCompositeOperation = 'destination-in';
          const m = document.createElement('canvas'); m.width = l.mask.canvas.width; m.height = l.mask.canvas.height; const mg = m.getContext('2d'); mg.drawImage(l.mask.canvas, 0, 0);
          const d = mg.getImageData(0, 0, m.width, m.height); for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; } mg.putImageData(d, 0, 0);
          g.drawImage(m, (l.mask.left || 0) - (l.left || 0), (l.mask.top || 0) - (l.top || 0)); cv = c;
        }
        layers.push({ name: l.name, canvas: cv, x: l.left || 0, y: l.top || 0, opacity: l.opacity ?? 1, visible: !(hidden || l.hidden), blend: PhotoWS.BLEND[l.blendMode] || 'source-over' });
      }
    };
    walk(psd.children);
    if (!layers.length && psd.canvas) layers.push({ name: 'Фон', canvas: psd.canvas });
    const mp = await PhotoWS.mp();
    await mp.FileOpen.load_json(PhotoWS.docJSON(psd.width, psd.height, layers));
    PhotoWS.name = name.replace(/\.\w+$/, '');
    UI.toast(`PSD: слоёв ${layers.length}${psd.children && psd.children.some(c => c.text) ? ' (текстовые слои — картинками)' : ''}`);
  },
  // ---------- чтение из редактора ----------
  async size() { const mp = await PhotoWS.mp(); return mp.Layers.get_dimensions(); },
  async merged() {
    const mp = await PhotoWS.mp();
    const { width, height } = mp.Layers.get_dimensions();
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    mp.Layers.convert_layers_to_canvas(c.getContext('2d'), null, false);
    return c;
  },
  async layersList() {
    const mp = await PhotoWS.mp();
    const out = [];
    for (const l of mp.Layers.get_sorted_layers().slice().reverse()) {
      const c = mp.Layers.convert_layer_to_canvas(l.id, true);
      out.push({ l, canvas: c });
    }
    return out;
  },
  async current() {
    const mp = await PhotoWS.mp();
    const L = mp.AppConfig.layer;
    if (!L) throw new Error('Нет слоя');
    return { mp, L, canvas: mp.Layers.convert_layer_to_canvas(L.id, true) };
  },
  async replaceCurrent(canvas, name) {
    const { mp, L } = await PhotoWS.current();
    if (canvas.width === L.width_original && canvas.height === L.height_original) { mp.Layers.update_layer_image(canvas, L.id); return; }
    // другой размер (апскейл) — новым слоем того же положения и видимого размера
    await mp.Layers.insert({ name: name || (L.name + ' (ИИ)'), type: 'image', data: canvas.toDataURL('image/png'), x: L.x, y: L.y });
    const N = mp.AppConfig.layer;
    if (N && N !== L) { Object.assign(N, { width: L.width, height: L.height }); mp.AppConfig.need_render = true; mp.Layers.refresh_gui && mp.Layers.refresh_gui(); }
  },
  // ---------- сохранение ----------
  async savePSD() {
    const mp = await PhotoWS.mp(), lib = await Host.lib('psd');
    const { width, height } = mp.Layers.get_dimensions();
    const rev = Object.fromEntries(Object.entries(PhotoWS.BLEND).map(([k, v]) => [v, k]));
    const children = [];
    for (const { l, canvas } of await PhotoWS.layersList()) {
      if (!canvas || !canvas.width) continue;
      children.push({ name: l.name, canvas, left: Math.round(l.x), top: Math.round(l.y), opacity: (l.opacity ?? 100) / 100, hidden: !l.visible, blendMode: rev[l.composition] || 'normal' });
    }
    const bytes = lib.writePsdUint8Array({ width, height, children, canvas: await PhotoWS.merged() }, { generateThumbnail: true });
    await Host.saveFile((PhotoWS.name || 'фото') + '.psd', new Blob([bytes]), 'image/vnd.adobe.photoshop', 'psd');
  },
  async exportImage(fmt, { quality = 0.92, maxSide } = {}) {
    let c = await PhotoWS.merged();
    if (maxSide && Math.max(c.width, c.height) > maxSide) { const k = maxSide / Math.max(c.width, c.height), d = document.createElement('canvas'); d.width = Math.round(c.width * k); d.height = Math.round(c.height * k); const g = d.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, d.width, d.height); c = d; }
    const type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt];
    if (fmt === 'jpg') { const d = document.createElement('canvas'); d.width = c.width; d.height = c.height; const g = d.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, d.width, d.height); g.drawImage(c, 0, 0); c = d; }
    const b = await new Promise(r => c.toBlob(r, type, quality));
    await Host.saveFile((PhotoWS.name || 'фото') + '.' + fmt, b, type, fmt);
    return b;
  },
  // сжатие: подбираем наименьшее качество, при котором картинка почти не отличается (по ошибке)
  async smallest(c, type = 'image/jpeg', maxErr = 1.6) {
    const ref = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let best = null;
    for (const q of [0.95, 0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.65, 0.6]) {
      const b = await new Promise(r => c.toBlob(r, type, q));
      const img = await Polza.loadImage(b);
      const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const g = t.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let err = 0, n = 0; for (let i = 0; i < d.length; i += 16) { err += Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2]); n += 3; }
      if (err / n > maxErr) break;
      best = { b, q };
    }
    return best || { b: await new Promise(r => c.toBlob(r, type, 0.95)), q: 0.95 };
  },
  compressDialog() {
    const fmt = UI.sel([['jpg', 'JPG — фото'], ['webp', 'WEBP — веб (меньше на 25–35%)'], ['png', 'PNG — с прозрачностью']], 'jpg', () => { }, '', 240);
    const side = UI.sel([[0, 'Как есть'], [4000, 'До 4000 px'], [2500, 'До 2500 px'], [1920, 'До 1920 px (экран)'], [1200, 'До 1200 px (соцсети, почта)']], 0, () => { }, '', 240);
    const strict = UI.sel([[1.0, 'Без различий на глаз (строго)'], [1.6, 'Не заметно (рекомендуется)'], [2.6, 'Максимальное сжатие']], 1.6, () => { }, '', 260);
    UI.dialog('Сжать картинку', h('div', { class: 'form' }, h('label', {}, 'Формат', fmt), h('label', {}, 'Размер', side), h('label', {}, 'Качество', strict),
      h('p', { class: 'muted' }, 'Программа сама подбирает минимальное качество, при котором картинка не отличается от исходной.')),
    [{ label: 'Отмена' }, { label: 'Сжать и сохранить', primary: true, action: () => {
      withBusy('Подбираю сжатие…', async () => {
        let c = await PhotoWS.merged();
        const ms = +side.value;
        if (ms && Math.max(c.width, c.height) > ms) { const k = ms / Math.max(c.width, c.height), d = document.createElement('canvas'); d.width = Math.round(c.width * k); d.height = Math.round(c.height * k); const g = d.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, d.width, d.height); c = d; }
        const f = fmt.value, type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[f];
        if (f === 'jpg') { const d = document.createElement('canvas'); d.width = c.width; d.height = c.height; const g = d.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, d.width, d.height); g.drawImage(c, 0, 0); c = d; }
        const r = f === 'png' ? { b: await new Promise(rr => c.toBlob(rr, type)), q: 1 } : await PhotoWS.smallest(c, type, +strict.value);
        await Host.saveFile((PhotoWS.name || 'фото') + '.' + f, r.b, type, f);
        UI.toast(`${c.width}×${c.height}, ${(r.b.size / 1024).toFixed(0)} КБ (качество ${Math.round(r.q * 100)})`, true);
      });
    } }]);
  },
  // ---------- обработка ----------
  async develop() {
    let cur; try { cur = await PhotoWS.current(); } catch (e) { return UI.toast(e.message, true); }
    Develop.open(cur.canvas, { title: 'Обработка: ' + cur.L.name, done: c => { cur.mp.Layers.update_layer_image(c, cur.L.id); } });
  },
  canvasDialog() {
    PhotoWS.size().then(({ width, height }) => {
      const w = h('input', { type: 'number', value: width }), hh = h('input', { type: 'number', value: height });
      const mode = UI.sel([['canvas', 'Расширить/обрезать холст (картинка не меняется)'], ['scale', 'Изменить размер изображения']], 'canvas', () => { }, '', 340);
      const anchor = UI.sel([['c', 'по центру'], ['tl', 'от левого верхнего'], ['b', 'снизу'], ['t', 'сверху']], 'c', () => { }, '', 200);
      UI.dialog('Размер холста', h('div', { class: 'form' }, h('div', { class: 'row' }, h('label', {}, 'Ширина, px', w), h('label', {}, 'Высота, px', hh)), h('label', {}, 'Что делать', mode), h('label', {}, 'Привязка', anchor),
        h('p', { class: 'muted' }, 'Чтобы заполнить новые края содержимым, используйте «Дорисовать края» (ИИ).')),
      [{ label: 'Отмена' }, { label: 'Применить', primary: true, action: () => { PhotoWS.resizeCanvas(+w.value, +hh.value, mode.value, anchor.value); } }]);
    });
  },
  async resizeCanvas(W, H, mode, anchor = 'c') {
    const mp = await PhotoWS.mp(), { width, height } = mp.Layers.get_dimensions();
    const list = await PhotoWS.layersList();
    const kx = W / width, ky = H / height;
    const dx = { c: (W - width) / 2, tl: 0, b: (W - width) / 2, t: (W - width) / 2 }[anchor], dy = { c: (H - height) / 2, tl: 0, b: H - height, t: 0 }[anchor];
    const layers = list.map(({ l, canvas }) => {
      if (mode === 'scale') { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(canvas.width * kx)); c.height = Math.max(1, Math.round(canvas.height * ky)); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, 0, 0, c.width, c.height); return { name: l.name, canvas: c, x: Math.round(l.x * kx), y: Math.round(l.y * ky), opacity: (l.opacity ?? 100) / 100, visible: l.visible, blend: l.composition }; }
      return { name: l.name, canvas, x: Math.round(l.x + dx), y: Math.round(l.y + dy), opacity: (l.opacity ?? 100) / 100, visible: l.visible, blend: l.composition };
    });
    await mp.FileOpen.load_json(PhotoWS.docJSON(W, H, layers));
  },
  // ---------- ИИ ----------
  async ai(kind) {
    let cur; try { cur = await PhotoWS.current(); } catch (e) { return UI.toast(e.message, true); }
    if (!await Polza.choose([kind === 'bg' ? 'bg' : 'upscale', 'edit'], kind === 'bg' ? 'Удалить фон' : 'Апскейл')) return;
    await withBusy(kind === 'bg' ? 'Удаляю фон…' : 'Увеличиваю…', async onStatus => {
      const blob = await new Promise(r => cur.canvas.toBlob(r, 'image/png'));
      const out = kind === 'bg' ? await Polza.removeBackground(blob, { onStatus }) : await Polza.upscale(blob, { onStatus });
      const img = await Polza.loadImage(out);
      const c = document.createElement('canvas');
      if (kind === 'bg') { c.width = cur.canvas.width; c.height = cur.canvas.height; } else { c.width = img.naturalWidth; c.height = img.naturalHeight; }
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      await PhotoWS.replaceCurrent(c);
    });
  },
  outpaintDialog() {
    const sides = ['top', 'right', 'bottom', 'left'].map(() => h('input', { type: 'number', value: 25, min: 0, max: 200, class: 'num' }));
    const prompt = h('textarea', { rows: 3, class: 'wide', placeholder: 'Необязательно: что должно появиться по краям' });
    UI.dialog('Дорисовать края (ИИ)', h('div', { class: 'form' }, h('div', { class: 'row' }, ...['Сверху', 'Справа', 'Снизу', 'Слева'].map((l, i) => h('label', {}, l + ', %', sides[i]))), prompt,
      Polza.pickRow('edit'), h('p', { class: 'muted' }, 'Холст увеличится, модель Polza достроит фон так, будто кадр был шире. Исходная картинка сохранится отдельным слоем поверх.')),
    [{ label: 'Отмена' }, { label: 'Дорисовать', primary: true, action: () => { PhotoWS.outpaint(sides.map(s => +s.value / 100), prompt.value.trim()); } }]);
  },
  async outpaint([t, r, b, l], extra) {
    await withBusy('ИИ дорисовывает края…', async onStatus => {
      const src = await PhotoWS.merged();
      const W = Math.round(src.width * (1 + l + r)), H = Math.round(src.height * (1 + t + b)), ox = Math.round(src.width * l), oy = Math.round(src.height * t);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.drawImage(src, ox, oy);
      const blob = await new Promise(rr => c.toBlob(rr, 'image/png'));
      const out = await Polza.generateImage(`Outpaint: the photo in the middle is surrounded by empty white margins. Extend the scene naturally into the white margins so the result looks like one wider original photo (same lighting, perspective, style). Keep the central photo exactly unchanged.${extra ? ' In the extended areas: ' + extra : ''}`, { images: [blob], onStatus });
      const img = await Polza.loadImage(out);
      const bg = document.createElement('canvas'); bg.width = W; bg.height = H; bg.getContext('2d').drawImage(img, 0, 0, W, H);
      const mp = await PhotoWS.mp();
      await mp.FileOpen.load_json(PhotoWS.docJSON(W, H, [{ name: 'Дорисовано ИИ', canvas: bg }, { name: 'Исходное фото', canvas: src, x: ox, y: oy }]));
    });
  },
  editDialog() {
    const prompt = h('textarea', { rows: 4, class: 'wide', placeholder: 'Например: «убрать людей на заднем плане», «сделать вечер с тёплым светом», «заменить фон на студийный серый»' });
    UI.dialog('Изменить по описанию (ИИ)', h('div', { class: 'form' }, prompt, Polza.pickRow('edit'), h('p', { class: 'muted' }, 'Результат добавится новым слоем — исходник останется.')),
      [{ label: 'Отмена' }, { label: 'Изменить', primary: true, action: () => {
        const p = prompt.value.trim(); if (!p) return false;
        withBusy('ИИ правит картинку…', async onStatus => {
          const src = await PhotoWS.merged();
          const out = await Polza.generateImage(p + '. Keep everything else in the photo unchanged.', { images: [await new Promise(r => src.toBlob(r, 'image/png'))], onStatus });
          const img = await Polza.loadImage(out);
          const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const mp = await PhotoWS.mp();
          await mp.Layers.insert({ name: 'ИИ: ' + p.slice(0, 30), type: 'image', data: c.toDataURL('image/png'), x: 0, y: 0 });
        });
      } }]);
  },
  // ---------- обмен ----------
  async editFromVektor(o) {
    WS.show('photo');
    await withBusy('Открываю картинку…', async () => { await PhotoWS.openImage(await (await fetch(o.href)).blob(), o.name || 'Изображение'); });
    PhotoWS.editing = { id: o.id };
    UI.toast('Правьте картинку. «Отправить → Вернуть в Вектор» заменит её в макете');
  },
  async backToVektor() {
    const c = await PhotoWS.merged();
    const o = Model.get(PhotoWS.editing.id);
    if (!o) return UI.toast('Картинка в «Векторе» не найдена', true);
    o.href = c.toDataURL('image/png'); o.natW = c.width; o.natH = c.height;
    WS.show('vektor'); App.commit('Правка в «Фото»'); UI.refresh();
  },
  async send(where) {
    const c = await PhotoWS.merged();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const name = PhotoWS.name || 'Фото';
    if (where === 'vektor') { WS.show('vektor'); await IO.importRaster(blob, name); }
    else if (where === 'figma') { const api = await FigmaWS.api(); await api.placeImages([{ bytes: await blob.arrayBuffer(), name: name + '.png', type: 'image/png' }]); }
    else if (where === 'motion') { WS.show('motion'); await Motion.addImages([{ name, blob }]); }
    else if (where === 'mockup-design') Mockup.open({ design: blob });
    else if (where === 'mockup-base') Mockup.open({ base: blob });
  },
};
