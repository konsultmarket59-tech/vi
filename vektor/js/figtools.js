// Инструменты «Фигмы», которых нет во встроенном редакторе (OpenPencil):
// коррекция изображения (как Image adjustments в Figma), фильтры и эффекты (шум, текстура, прогрессивное размытие…),
// кадрирование картинки, удаление фона на месте, вставка изображения, стрелки, упрощение кривых.
// Всё работает через Plugin API редактора — тот же, что у плагинов Figma, — и попадает в его историю отмены.
'use strict';

const FigTools = {
  seq: 0,
  // выполнить код в редакторе как плагин; body видит figma и a (аргументы), результат кладёт в io.out
  async plug(name, body, args = {}) {
    const api = await FigmaWS.api();
    if (!api.runPlugin) throw new Error('Редактор «Фигма» устарел — обновите программу');
    const w = FigmaWS.frame.contentWindow, key = '__vkft' + (++FigTools.seq);
    w[key] = { args, out: undefined, err: null };
    await api.runPlugin({ name, code: `return (async () => { const io = window['${key}']; const a = io.args; try { ${body} } catch (e) { io.err = String(e && e.message || e); } finally { figma.closePlugin(); } })()` });
    const r = w[key]; delete w[key];
    if (r.err) throw new Error(r.err);
    return r.out;
  },

  // ---------- картинка выделенного слоя ----------
  async selected() {
    const info = await FigTools.plug('Вектор: выделение', `
      const n = figma.currentPage.selection[0];
      if (!n) throw new Error('Выделите слой');
      const fills = Array.isArray(n.fills) ? n.fills : [];
      const idx = fills.findIndex(f => f.type === 'IMAGE' && f.imageHash && f.visible !== false);
      const bytes = idx >= 0 ? figma.graph.images.get(fills[idx].imageHash) : null;
      const rb = n.absoluteRenderBounds || n.absoluteBoundingBox || { x: 0, y: 0, width: n.width, height: n.height };
      io.out = { id: n.id, name: n.name, type: n.type, idx, bytes: bytes ? Array.from(bytes) : null, w: n.width, h: n.height, rb: { x: rb.x, y: rb.y, w: rb.width, h: rb.height }, count: figma.currentPage.selection.length };
    `);
    if (info.bytes) { info.blob = new Blob([new Uint8Array(info.bytes)]); delete info.bytes; }
    return info;
  },
  // исходник для обработки: картинка-заливка, иначе — снимок слоя
  async source() {
    const s = await FigTools.selected();
    if (s.blob) { s.img = await Polza.loadImage(s.blob); s.mode = 'fill'; return s; }
    const api = await FigmaWS.api();
    const buf = await api.exportPNG(2, [s.id]);
    if (!buf) throw new Error('Слой пустой');
    s.img = await Polza.loadImage(new Blob([buf], { type: 'image/png' })); s.mode = 'layer';
    return s;
  },
  canvasOf(img) { const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height; c.getContext('2d').drawImage(img, 0, 0); return c; },
  async bytesOf(canvas, type = 'image/png') { const b = await new Promise(r => canvas.toBlob(r, type, 0.93)); return Array.from(new Uint8Array(await b.arrayBuffer())); },
  // заменить картинку в заливке слоя (resize — новый размер слоя)
  async replaceFill(s, canvas, label, resize) {
    await FigTools.plug(label, `
      const n = figma.getNodeById(a.id); if (!n) throw new Error('Слой не найден');
      const img = figma.createImage(new Uint8Array(a.bytes));
      const fills = n.fills.map(f => Object.assign({}, f));
      if (a.idx >= 0) fills[a.idx] = Object.assign({}, fills[a.idx], { imageHash: img.hash });
      else fills.push({ type: 'IMAGE', imageHash: img.hash, imageScaleMode: 'FILL', opacity: 1, visible: true, color: { r: 1, g: 1, b: 1, a: 1 } });
      n.fills = fills;
      if (a.resize) n.resize(a.resize[0], a.resize[1]);
    `, { id: s.id, idx: s.idx, bytes: await FigTools.bytesOf(canvas), resize });
  },
  // положить результат новым слоем точно поверх исходного (для «запечённых» эффектов)
  async placeOver(s, canvas, label, hide) {
    await FigTools.plug(label, `
      const src = figma.getNodeById(a.id); if (!src) throw new Error('Слой не найден');
      const img = figma.createImage(new Uint8Array(a.bytes));
      const r = figma.createRectangle();
      r.name = a.name;
      r.resize(a.rb.w, a.rb.h);
      r.fills = [{ type: 'IMAGE', imageHash: img.hash, imageScaleMode: 'FILL', opacity: 1, visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }];
      const p = src.parent;
      try { const i = p.children.indexOf(src); p.insertChild(i + 1, r); } catch (e) { try { p.appendChild(r); } catch (e2) { } }
      let ox = 0, oy = 0;
      try { if (p.type !== 'PAGE' && p.absoluteTransform) { ox = p.absoluteTransform[0][2]; oy = p.absoluteTransform[1][2]; } } catch (e) { }
      r.x = a.rb.x - ox; r.y = a.rb.y - oy;
      if (a.hide) src.visible = false;
      figma.currentPage.selection = [r];
    `, { id: s.id, rb: s.rb, name: label, hide: !!hide, bytes: await FigTools.bytesOf(canvas) });
  },
  async apply(s, canvas, label, opts = {}) {
    if (s.mode === 'fill') await FigTools.replaceFill(s, canvas, label, opts.resize);
    else await FigTools.placeOver(s, canvas, label, opts.hide !== false);
    UI.toast('Готово: ' + label.toLowerCase());
  },
  wrap(fn) { return async () => { try { await fn(); } catch (e) { console.error(e); UI.toast(e.message || String(e), true); } }; },

  // ---------- коррекция (как Image adjustments в Figma, плюс всё из Lightroom) ----------
  adjust: null,
  // ---------- фильтры и эффекты ----------
  FX: [
    ['grain', 'Шум / зерно', 0, 100, 0], ['texture', 'Текстура бумаги', 0, 100, 0], ['pblur', 'Прогрессивное размытие', 0, 60, 0],
    ['blur', 'Размытие', 0, 40, 0], ['sharpen', 'Резкость', 0, 100, 0], ['pixel', 'Пикселизация', 0, 60, 0],
    ['halftone', 'Полутон (точки)', 0, 30, 0], ['posterize', 'Постеризация (уровней)', 0, 16, 0],
    ['glass', 'Матовое стекло', 0, 100, 0],
  ],
  FXMODES: [['none', 'Без цветового фильтра'], ['gray', 'Чёрно-белое'], ['sepia', 'Сепия'], ['invert', 'Инверсия'], ['duotone', 'Дуотон']],
  fx(src, o) {
    const W = src.width, H = src.height, k = Math.max(W, H) / 1000;
    let c = document.createElement('canvas'); c.width = W; c.height = H;
    let g = c.getContext('2d');
    g.filter = o.blur ? `blur(${o.blur * k}px)` : 'none'; g.drawImage(src, 0, 0); g.filter = 'none';
    if (o.pblur) {
      // прогрессивное размытие: сила растёт к краю (направление dir)
      const bl = document.createElement('canvas'); bl.width = W; bl.height = H;
      const bg = bl.getContext('2d'); bg.filter = `blur(${o.pblur * k}px)`; bg.drawImage(c, 0, 0);
      const m = document.createElement('canvas'); m.width = W; m.height = H;
      const mg = m.getContext('2d');
      const d = o.pdir || 'bottom', st = (o.pstart ?? 40) / 100;
      const gr = d === 'bottom' ? mg.createLinearGradient(0, 0, 0, H) : d === 'top' ? mg.createLinearGradient(0, H, 0, 0) : d === 'right' ? mg.createLinearGradient(0, 0, W, 0) : mg.createLinearGradient(W, 0, 0, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(Math.min(0.99, st), 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
      mg.fillStyle = gr; mg.fillRect(0, 0, W, H);
      mg.globalCompositeOperation = 'source-in'; mg.drawImage(bl, 0, 0);
      g.drawImage(m, 0, 0);
    }
    if (o.glass) {
      const t = document.createElement('canvas'); t.width = W; t.height = H;
      const tg = t.getContext('2d'); tg.filter = `blur(${(6 + o.glass / 4) * k}px) saturate(1.3)`; tg.drawImage(c, 0, 0); tg.filter = 'none';
      tg.fillStyle = `rgba(255,255,255,${0.08 + o.glass / 500})`; tg.globalCompositeOperation = 'source-atop'; tg.fillRect(0, 0, W, H);
      g.clearRect(0, 0, W, H); g.drawImage(t, 0, 0);
    }
    if (o.pixel) {
      const s = Math.max(2, Math.round(o.pixel * k / 2 + 1));
      const sm = document.createElement('canvas'); sm.width = Math.max(1, Math.round(W / s)); sm.height = Math.max(1, Math.round(H / s));
      sm.getContext('2d').drawImage(c, 0, 0, sm.width, sm.height);
      g.clearRect(0, 0, W, H); g.imageSmoothingEnabled = false; g.drawImage(sm, 0, 0, W, H); g.imageSmoothingEnabled = true;
    }
    const id = g.getImageData(0, 0, W, H), p = id.data;
    if (o.sharpen) {
      const a = o.sharpen / 100, src2 = new Uint8ClampedArray(p);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const v = src2[i + ch] * 5 - src2[i - 4 + ch] - src2[i + 4 + ch] - src2[i - W * 4 + ch] - src2[i + W * 4 + ch];
          p[i + ch] = src2[i + ch] + (v - src2[i + ch]) * a;
        }
      }
    }
    const d1 = o.c1 ? Color.hexToRgb(o.c1) : { r: 20, g: 20, b: 60 }, d2 = o.c2 ? Color.hexToRgb(o.c2) : { r: 255, g: 210, b: 120 };
    const lv = o.posterize >= 2 ? o.posterize : 0;
    let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < p.length; i += 4) {
      let r = p[i], gg = p[i + 1], b = p[i + 2];
      const L = 0.299 * r + 0.587 * gg + 0.114 * b;
      if (o.mode === 'gray') r = gg = b = L;
      else if (o.mode === 'sepia') { const r2 = 0.393 * r + 0.769 * gg + 0.189 * b, g2 = 0.349 * r + 0.686 * gg + 0.168 * b, b2 = 0.272 * r + 0.534 * gg + 0.131 * b; r = r2; gg = g2; b = b2; }
      else if (o.mode === 'invert') { r = 255 - r; gg = 255 - gg; b = 255 - b; }
      else if (o.mode === 'duotone') { const t = L / 255; r = d1.r + (d2.r - d1.r) * t; gg = d1.g + (d2.g - d1.g) * t; b = d1.b + (d2.b - d1.b) * t; }
      if (lv) { const q = 255 / (lv - 1); r = Math.round(r / q) * q; gg = Math.round(gg / q) * q; b = Math.round(b / q) * q; }
      if (o.grain) { const n = (rnd() - 0.5) * o.grain * 1.6; if (o.grainColor) { r += n; gg += (rnd() - 0.5) * o.grain * 1.6; b += (rnd() - 0.5) * o.grain * 1.6; } else { r += n; gg += n; b += n; } }
      if (o.texture) { const n = (rnd() - 0.5) * 0.5 + (rnd() - 0.5) * 0.5; const f = 1 - o.texture / 260 + n * o.texture / 260; r *= f; gg *= f; b *= f; }
      p[i] = r; p[i + 1] = gg; p[i + 2] = b;
    }
    g.putImageData(id, 0, 0);
    if (o.halftone) {
      const step = Math.max(3, Math.round((4 + o.halftone) * k));
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const og = out.getContext('2d'); og.fillStyle = '#ffffff'; og.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
        const i = (Math.min(H - 1, y + (step >> 1)) * W + Math.min(W - 1, x + (step >> 1))) * 4;
        if (p[i + 3] < 10) continue;
        const L = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
        const rad = (1 - L) * step * 0.7;
        if (rad < 0.3) continue;
        og.fillStyle = o.mode === 'gray' || o.mode === 'none' || !o.mode ? '#000' : `rgb(${p[i]},${p[i + 1]},${p[i + 2]})`;
        og.beginPath(); og.arc(x + step / 2, y + step / 2, rad, 0, Math.PI * 2); og.fill();
      }
      og.globalCompositeOperation = 'destination-in'; og.drawImage(src, 0, 0);
      c = out;
    }
    return c;
  },
  async effects() {
    const s = await FigTools.source();
    const src = FigTools.canvasOf(s.img);
    const kp = Math.min(1, 700 / Math.max(src.width, src.height));
    const small = document.createElement('canvas'); small.width = Math.round(src.width * kp); small.height = Math.round(src.height * kp);
    small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
    let o = {}; try { o = JSON.parse(localStorage.getItem('vektor.figfx') || '{}'); } catch (e) { }
    o = Object.assign({ mode: 'none', pdir: 'bottom', pstart: 40, c1: '#14143c', c2: '#ffd278', grainColor: false }, o);
    const prev = h('canvas', { class: 'ft-prev' });
    const draw = () => { cancelAnimationFrame(FigTools._raf); FigTools._raf = requestAnimationFrame(() => { const r = FigTools.fx(small, o); prev.width = r.width; prev.height = r.height; prev.getContext('2d').drawImage(r, 0, 0); }); };
    const rows = FigTools.FX.map(([k, l, min, max]) => {
      const v = h('span', { class: 'muted' }, String(o[k] || 0));
      return h('label', { class: 'mk-sl', title: 'Двойной щелчок — сбросить' }, h('span', {}, l), h('input', { type: 'range', min, max, step: 1, value: o[k] || 0, oninput: e => { o[k] = +e.target.value; v.textContent = e.target.value; draw(); }, ondblclick: e => { o[k] = 0; e.target.value = 0; v.textContent = '0'; draw(); } }), v);
    });
    const mode = h('select', { onchange: e => { o.mode = e.target.value; draw(); } }, ...FigTools.FXMODES.map(([v, l]) => h('option', { value: v, selected: o.mode === v }, l)));
    const pdir = h('select', { onchange: e => { o.pdir = e.target.value; draw(); } }, ...[['bottom', 'к низу'], ['top', 'к верху'], ['right', 'вправо'], ['left', 'влево']].map(([v, l]) => h('option', { value: v, selected: o.pdir === v }, l)));
    const col = k => h('input', { type: 'color', value: o[k], oninput: e => { o[k] = e.target.value; draw(); } });
    const hide = h('input', { type: 'checkbox', checked: true });
    UI.dialog('Фильтры и эффекты — ' + (s.name || 'слой'), h('div', { class: 'ft-dlg' },
      h('div', { class: 'ft-view' }, prev),
      h('div', { class: 'ft-panel' },
        h('label', {}, 'Цветовой фильтр ', mode), h('div', { class: 'row small' }, 'Дуотон: тени ', col('c1'), ' света ', col('c2')),
        ...rows,
        h('div', { class: 'row small' }, 'Размытие нарастает ', pdir, ' с ', h('input', { type: 'number', min: 0, max: 95, value: o.pstart, style: { width: '56px' }, oninput: e => { o.pstart = +e.target.value; draw(); } }), ' %'),
        h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: o.grainColor, onchange: e => { o.grainColor = e.target.checked; draw(); } }), ' цветной шум'),
        s.mode === 'layer' ? h('label', { class: 'row small' }, hide, ' скрыть исходный слой (результат — картинкой поверх)') : h('p', { class: 'muted small' }, 'Картинка в заливке заменится; отменить — Ctrl+Z в «Фигме».'))),
    [{ label: 'Отмена' }, { label: 'Применить', primary: true, action: () => {
      try { localStorage.setItem('vektor.figfx', JSON.stringify(o)); } catch (e) { }
      withBusy('Применяю…', () => FigTools.apply(s, FigTools.fx(src, o), 'Фильтры и эффекты', { hide: hide.checked }));
    } }]);
    draw();
  },

  // ---------- кадрирование картинки ----------
  async crop() {
    const s = await FigTools.selected();
    if (!s.blob) return UI.toast('Выделите слой с картинкой (заливка «Изображение»)');
    s.mode = 'fill';
    const img = await Polza.loadImage(s.blob), W = img.naturalWidth, H = img.naturalHeight;
    const kp = Math.min(1, 620 / W, 460 / H);
    const view = h('div', { class: 'ft-crop', style: { width: Math.round(W * kp) + 'px', height: Math.round(H * kp) + 'px' } });
    const pic = h('canvas', { width: Math.round(W * kp), height: Math.round(H * kp) }); pic.getContext('2d').drawImage(img, 0, 0, pic.width, pic.height);
    const box = h('div', { class: 'ft-cropbox' });
    view.append(pic, box);
    let r = { x: 0, y: 0, w: W, h: H }, aspect = 0;
    const show = () => Object.assign(box.style, { left: r.x * kp + 'px', top: r.y * kp + 'px', width: r.w * kp + 'px', height: r.h * kp + 'px' });
    const fix = () => {
      r.w = G.clamp(r.w, 8, W); r.h = G.clamp(r.h, 8, H);
      if (aspect) { if (r.w / r.h > aspect) r.w = r.h * aspect; else r.h = r.w / aspect; }
      r.x = G.clamp(r.x, 0, W - r.w); r.y = G.clamp(r.y, 0, H - r.h); show();
    };
    // перетаскивание рамки и уголка
    box.append(h('div', { class: 'ft-cropk' }));
    box.addEventListener('pointerdown', e => {
      e.preventDefault(); const corner = e.target.classList.contains('ft-cropk');
      const sx = e.clientX, sy = e.clientY, r0 = Object.assign({}, r);
      const mv = ev => { const dx = (ev.clientX - sx) / kp, dy = (ev.clientY - sy) / kp; if (corner) { r.w = r0.w + dx; r.h = aspect ? r.w / aspect : r0.h + dy; } else { r.x = r0.x + dx; r.y = r0.y + dy; } fix(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    const asp = h('select', { onchange: e => { aspect = +e.target.value; if (aspect) { r.w = W; r.h = H; } fix(); } },
      ...[['0', 'Свободно'], ['1', '1:1'], [String(4 / 5), '4:5'], [String(3 / 4), '3:4'], [String(4 / 3), '4:3'], [String(16 / 9), '16:9'], [String(9 / 16), '9:16'], [String(W / H), 'Как у слоя']].map(([v, l]) => h('option', { value: v }, l)));
    show();
    UI.dialog('Кадрировать изображение', h('div', { class: 'form' }, h('div', { class: 'row' }, 'Пропорции ', asp, h('span', { class: 'muted small' }, ' — тяните рамку и правый нижний угол')), view),
      [{ label: 'Отмена' }, { label: 'Кадрировать', primary: true, action: () => {
        const c = document.createElement('canvas'); c.width = Math.round(r.w); c.height = Math.round(r.h);
        c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
        // размер слоя меняется пропорционально вырезанной части
        const nw = s.w * r.w / W, nh = s.h * r.h / H;
        withBusy('Кадрирую…', () => FigTools.apply(s, c, 'Кадрировать', { resize: [Math.max(1, nw), Math.max(1, nh)] }));
      } }]);
  },

  async adjustImage() {
    const s = await FigTools.source();
    Develop.open(s.img, { title: 'Коррекция: ' + (s.name || 'изображение'), done: c => withBusy('Применяю…', () => FigTools.apply(s, c, 'Коррекция изображения', { hide: true })) });
  },
  async removeBg() {
    const s = await FigTools.source();
    if (!await Polza.choose(['bg', 'edit'], 'Удалить фон')) return;
    await withBusy('Удаляю фон…', async onStatus => {
      const out = await Polza.removeBackground(s.blob || await new Promise(r => FigTools.canvasOf(s.img).toBlob(r, 'image/png')), { onStatus });
      const im = await Polza.loadImage(out);
      await FigTools.apply(s, FigTools.canvasOf(im), 'Удалить фон', { hide: true });
    });
  },
  async placeImage() {
    const files = await Host.pickFiles('.png,.jpg,.jpeg,.webp,.gif,.svg', true, 'Поместить изображение');
    if (!files.length) return;
    const api = await FigmaWS.api();
    const svgs = [], imgs = [];
    for (const f of files) {
      const b = await Host.blobOf(f);
      if (/\.svg$/i.test(f.name)) svgs.push(await b.text());
      else imgs.push({ bytes: await b.arrayBuffer(), name: f.name, type: b.type || 'image/png' });
    }
    if (imgs.length) await api.placeImages(imgs);
    for (const s of svgs) await api.pasteSVG(s);
    UI.toast('Помещено: ' + files.length);
  },
  // стрелка: линия с наконечником в центре экрана
  async arrow(kind = 'ARROW_LINES') {
    await FigTools.plug('Стрелка', `
      const l = figma.createLine();
      l.name = 'Стрелка'; l.resize(160, 0);
      l.x = figma.viewport.center.x - 80; l.y = figma.viewport.center.y;
      l.strokes = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1, visible: true }];
      l.strokeWeight = 3;
      try { l.strokeCap = a.kind; } catch (e) { }
      try { l.strokeEndCap = a.kind; } catch (e) { }
      try { if (l.parent !== figma.currentPage) figma.currentPage.appendChild(l); } catch (e) { }
      figma.currentPage.selection = [l];
    `, { kind });
  },
  // упростить и сгладить кривые (как Simplify path)
  async simplify() {
    const tolIn = h('input', { type: 'range', min: 0.2, max: 8, step: 0.1, value: +(localStorage.getItem('vektor.figSimplify') || 1) });
    const smooth = h('input', { type: 'checkbox', checked: true });
    UI.dialog('Упростить кривую', h('div', { class: 'form' }, h('label', {}, 'Точность (больше — меньше узлов)', tolIn), h('label', { class: 'row' }, smooth, ' сгладить узлы'),
      h('p', { class: 'muted small' }, 'Фигуры, текст и группы сначала превращаются в вектор (Flatten).')),
    [{ label: 'Отмена' }, { label: 'Упростить', primary: true, action: () => { localStorage.setItem('vektor.figSimplify', tolIn.value); FigTools.wrap(() => FigTools.doSimplify(+tolIn.value, smooth.checked))(); } }]);
  },
  async doSimplify(tol, smooth) {
    const paths = await FigTools.plug('Упростить: чтение', `
      let sel = figma.currentPage.selection.slice();
      if (!sel.length) throw new Error('Выделите кривые');
      // у рамок и групп упрощаются вложенные кривые, сама рамка не трогается
      const out = [];
      const walk = n => {
        if (n.type === 'VECTOR') out.push(n);
        else if (n.children && n.children.length) n.children.forEach(walk);
        else if (['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'TEXT', 'BOOLEAN_OPERATION'].includes(n.type)) out.push(figma.flatten([n]));
      };
      sel.forEach(walk);
      sel = out;
      if (!sel.length) throw new Error('В выделении нет кривых');
      io.out = sel.map(n => ({ id: n.id, paths: n.vectorPaths.map(p => ({ windingRule: p.windingRule, data: p.data })) }));
    `);
    let before = 0, after = 0;
    for (const n of paths) for (const p of n.paths) {
      const subs = Path.parse(p.data);
      const out = Path.flatten(subs, null, 16).map(sp => {
        const pts = sp.closed ? sp.pts.concat([sp.pts[0]]) : sp.pts;
        let q = G.simplify(pts, tol); if (sp.closed && q.length > 2) q.pop();
        before += sp.pts.length; after += q.length;
        return smooth ? { closed: sp.closed, nodes: G.smoothNodes(q, sp.closed) } : { closed: sp.closed, nodes: q.map(pt => Path.node(pt.x, pt.y)) };
      });
      p.data = Path.toD(out);
    }
    await FigTools.plug('Упростить кривую', `
      for (const n of a.paths) { const node = figma.getNodeById(n.id); if (node) node.vectorPaths = n.paths; }
    `, { paths });
    UI.toast(`Точек было ${before}, узлов стало ${after}`);
  },

  menuImage(anchor) {
    const r = anchor.getBoundingClientRect(), W = FigTools.wrap;
    UI.showMenuList([
      { label: 'Коррекция (экспозиция, контраст, температура, света, тени…)…', action: W(FigTools.adjustImage) },
      { label: 'Фильтры и эффекты (шум, текстура, прогрессивное размытие, стекло, дуотон…)…', action: W(FigTools.effects) },
      { label: 'Кадрировать изображение…', action: W(FigTools.crop) },
      { label: 'Удалить фон (на месте)', action: W(FigTools.removeBg) },
      '-',
      { label: 'Поместить изображение…', action: W(FigTools.placeImage) },
    ], r.left, r.bottom);
  },
  menuVector(anchor) {
    const r = anchor.getBoundingClientRect(), W = FigTools.wrap;
    UI.showMenuList([
      { label: 'Упростить кривую…', action: W(FigTools.simplify) },
      { label: 'Векторизовать изображение (число цветов)…', action: () => FigmaWS.ai('vector') },
      '-',
      { label: 'Стрелка', action: W(() => FigTools.arrow('ARROW_LINES')) },
      { label: 'Стрелка с треугольником', action: W(() => FigTools.arrow('ARROW_EQUILATERAL')) },
    ], r.left, r.bottom);
  },
};
