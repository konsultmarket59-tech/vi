// «Моушн»: анимация кадров и графики на фоне цвета, фото или видео с компьютера.
// Слои (картинка, видео, текст, фигура) с ключевыми кадрами и готовыми анимациями,
// таймлайн, просмотр, экспорт в MP4/WebM (WebCodecs) и ИИ-агент через Polza, который
// сам составляет план анимации и собирает ролик «под ключ». Проект — файл .vkm (ZIP).
'use strict';

const Motion = {
  el: null, p: null, assets: {}, media: {}, sel: null, t: 0, playing: false, selKey: null,
  PROPS: ['x', 'y', 'scale', 'rotation', 'opacity', 'blur', 'reveal', 'chars'],
  PROP_NAMES: { x: 'X', y: 'Y', scale: 'Масштаб', rotation: 'Поворот', opacity: 'Непрозрачность', blur: 'Размытие', reveal: 'Проявление', chars: 'Печать текста' },
  SIZES: [['1080x1920', 'Stories / Reels 1080×1920'], ['1080x1080', 'Квадрат 1080×1080'], ['1080x1350', 'Пост 1080×1350'], ['1920x1080', 'Full HD 1920×1080'], ['1280x720', 'HD 1280×720'], ['3840x2160', '4K 3840×2160']],
  PRESETS: {
    fadeIn: 'Появление', fadeOut: 'Исчезание', slideIn: 'Въезд', slideOut: 'Выезд', zoomIn: 'Приближение', zoomOut: 'Отдаление', pop: 'Выскакивание',
    rotateIn: 'Влёт с поворотом', blurIn: 'Из размытия', wipe: 'Шторка', typewriter: 'Печать текста', kenBurns: 'Кен Бёрнс (медленный наезд)',
    float: 'Парение', pulse: 'Пульс', shake: 'Тряска', spin: 'Вращение', bounceIn: 'Падение с отскоком',
  },
  EASES: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'backOut', 'backIn', 'elasticOut', 'bounceOut'],

  // ================= проект =================
  newProject(w = 1080, h = 1920) {
    return { version: 1, name: 'Ролик', w, h, fps: 30, duration: 8, bg: { type: 'color', color: '#101418', asset: null, fit: 'cover', start: 0, loop: true, audio: true, opacity: 1 }, audio: null, layers: [] };
  },
  uid() { return 'l' + Math.random().toString(36).slice(2, 9); },
  layer(id) { return Motion.p.layers.find(l => l.id === id); },
  mkLayer(type, props = {}) {
    const P = Motion.p;
    const L = Object.assign({
      id: Motion.uid(), type, name: { image: 'Картинка', video: 'Видео', text: 'Текст', shape: 'Фигура' }[type],
      x: P.w / 2, y: P.h / 2, w: P.w * 0.6, h: P.h * 0.3, scale: 1, rotation: 0, opacity: 1, blur: 0, reveal: 1, chars: 1,
      start: 0, end: P.duration, keys: {}, visible: true,
    }, props);
    if (type === 'text') Object.assign(L, Object.assign({ text: 'Текст', font: 'Oswald', size: Math.round(P.w / 12), color: '#ffffff', weight: 700, align: 'center', lineHeight: 1.15, letterSpacing: 0, stroke: null, shadow: true, bgColor: null }, props));
    if (type === 'shape') Object.assign(L, Object.assign({ shape: 'rect', fill: '#e30613', radius: 0 }, props));
    if (type === 'image' || type === 'video') Object.assign(L, Object.assign({ fit: 'contain', radius: 0 }, props));
    return L;
  },

  // ================= ресурсы =================
  async addAsset({ name, blob, path, kind }) {
    kind = kind || (/^video\//.test(blob && blob.type) || /\.(mp4|mov|webm|m4v|mkv)$/i.test(name) ? 'video' : /^audio\//.test(blob && blob.type) || /\.(mp3|wav|ogg|m4a)$/i.test(name) ? 'audio' : 'image');
    const id = 'a' + Math.random().toString(36).slice(2, 9);
    const a = { id, name, kind, path: path || null, blob: blob || null };
    a.url = blob ? URL.createObjectURL(blob) : Host.fileURL(path);
    Motion.assets[id] = a;
    await Motion.loadMedia(a);
    return a;
  },
  async assetFromEntry(e) {
    const name = e.name || (e.rel || '').split('/').pop();
    if (e.path && Host.fileURL(e.path) && /\.(mp4|mov|webm|m4v|mkv|mp3|wav|m4a|ogg)$/i.test(name)) return Motion.addAsset({ name, path: e.path });
    return Motion.addAsset({ name, blob: await Host.blobOf(e) });
  },
  loadMedia(a) {
    if (Motion.media[a.id]) return Motion.media[a.id].ready;
    if (a.kind === 'image') {
      const img = new Image(); img.decoding = 'async';
      const ready = new Promise(res => { img.onload = () => res(img); img.onerror = () => res(null); });
      img.src = a.url;
      Motion.media[a.id] = { el: img, ready };
      return ready;
    }
    const v = document.createElement(a.kind === 'audio' ? 'audio' : 'video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    const ready = new Promise(res => { v.onloadeddata = () => res(v); v.onerror = () => res(null); setTimeout(() => res(v), 15000); });
    v.src = a.url;
    Motion.media[a.id] = { el: v, ready };
    return ready;
  },
  mediaEl(id) { const m = Motion.media[id]; return m && m.el; },
  assetDuration(id) { const v = Motion.mediaEl(id); return v && isFinite(v.duration) ? v.duration : 0; },

  // ================= анимация =================
  ease(name, k) {
    const c1 = 1.70158, c3 = c1 + 1, c4 = 2 * Math.PI / 3;
    switch (name) {
      case 'easeIn': return k * k * k;
      case 'easeOut': return 1 - Math.pow(1 - k, 3);
      case 'easeInOut': return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      case 'backOut': return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      case 'backIn': return c3 * k * k * k - c1 * k * k;
      case 'elasticOut': return k === 0 || k === 1 ? k : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * c4) + 1;
      case 'bounceOut': { const n1 = 7.5625, d1 = 2.75; if (k < 1 / d1) return n1 * k * k; if (k < 2 / d1) return n1 * (k -= 1.5 / d1) * k + 0.75; if (k < 2.5 / d1) return n1 * (k -= 2.25 / d1) * k + 0.9375; return n1 * (k -= 2.625 / d1) * k + 0.984375; }
      default: return k;
    }
  },
  val(L, prop, t) {
    const ks = L.keys && L.keys[prop];
    if (!ks || !ks.length) return L[prop];
    if (t <= ks[0].t) return ks[0].v;
    const last = ks[ks.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1];
      if (t >= a.t && t <= b.t) {
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return a.v + (b.v - a.v) * Motion.ease(b.ease || 'easeInOut', k);
      }
    }
    return last.v;
  },
  setKey(L, prop, t, v, ease = 'easeInOut') {
    t = Math.round(t * 1000) / 1000;
    const ks = (L.keys[prop] = L.keys[prop] || []);
    const ex = ks.find(k => Math.abs(k.t - t) < 0.0005);
    if (ex) { ex.v = v; if (ease) ex.ease = ease; } else ks.push({ t, v, ease });
    ks.sort((a, b) => a.t - b.t);
  },
  clearKeys(L, prop, t0, t1) { if (L.keys[prop]) L.keys[prop] = L.keys[prop].filter(k => k.t < t0 - 1e-4 || k.t > t1 + 1e-4); },
  // готовая анимация → ключевые кадры (значения «в покое» — текущие свойства слоя)
  applyPreset(L, name, t0, d, o = {}) {
    const P = Motion.p;
    t0 = Math.max(0, +t0 || 0); d = Math.max(0.05, +d || 0.6);
    const t1 = t0 + d, ease = o.ease;
    const base = p => (L.keys[p] && L.keys[p].length) ? Motion.val(L, p, name.endsWith('Out') ? t0 : t1) : L[p];
    const K = (p, list) => { Motion.clearKeys(L, p, list[0][0], list[list.length - 1][0]); for (const [t, v, e] of list) Motion.setKey(L, p, t, v, e || ease || 'easeOut'); };
    const dir = o.direction || 'left';
    const dist = +o.distance || (dir === 'left' || dir === 'right' ? P.w * 0.6 : P.h * 0.4);
    const sx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, sy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    const I = +o.intensity || 1;
    switch (name) {
      case 'fadeIn': K('opacity', [[t0, 0], [t1, base('opacity') || 1]]); break;
      case 'fadeOut': K('opacity', [[t0, base('opacity') || 1], [t1, 0, ease || 'easeIn']]); break;
      case 'slideIn': {
        const bx = base('x'), by = base('y');
        if (sx) K('x', [[t0, bx + sx * dist], [t1, bx]]);
        if (sy) K('y', [[t0, by + sy * dist], [t1, by]]);
        K('opacity', [[t0, 0], [t0 + d * 0.4, base('opacity') || 1]]);
        break;
      }
      case 'slideOut': {
        const bx = base('x'), by = base('y');
        if (sx) K('x', [[t0, bx], [t1, bx + sx * dist, ease || 'easeIn']]);
        if (sy) K('y', [[t0, by], [t1, by + sy * dist, ease || 'easeIn']]);
        K('opacity', [[t1 - d * 0.4, base('opacity') || 1], [t1, 0, 'linear']]);
        break;
      }
      case 'zoomIn': K('scale', [[t0, base('scale') * 0.6], [t1, base('scale'), ease || 'backOut']]); K('opacity', [[t0, 0], [t0 + d * 0.5, base('opacity') || 1]]); break;
      case 'zoomOut': K('scale', [[t0, base('scale')], [t1, base('scale') * 0.6, ease || 'easeIn']]); K('opacity', [[t0, base('opacity') || 1], [t1, 0]]); break;
      case 'pop': { const s = base('scale'); K('scale', [[t0, 0], [t0 + d * 0.65, s * (1 + 0.12 * I), 'easeOut'], [t1, s, 'easeInOut']]); K('opacity', [[t0, 0], [t0 + d * 0.3, base('opacity') || 1]]); break; }
      case 'bounceIn': { const by = base('y'); K('y', [[t0, by - P.h * 0.5], [t1, by, 'bounceOut']]); K('opacity', [[t0, 0], [t0 + d * 0.2, base('opacity') || 1]]); break; }
      case 'rotateIn': K('rotation', [[t0, base('rotation') - 90 * I], [t1, base('rotation'), ease || 'backOut']]); K('scale', [[t0, base('scale') * 0.4], [t1, base('scale'), ease || 'backOut']]); K('opacity', [[t0, 0], [t0 + d * 0.4, base('opacity') || 1]]); break;
      case 'blurIn': K('blur', [[t0, 24 * I], [t1, 0]]); K('opacity', [[t0, 0], [t0 + d * 0.6, base('opacity') || 1]]); break;
      case 'wipe': K('reveal', [[t0, 0], [t1, 1, ease || 'easeInOut']]); break;
      case 'typewriter': K('chars', [[t0, 0], [t1, 1, 'linear']]); break;
      case 'kenBurns': { const s = base('scale'); K('scale', [[t0, s], [t1, s * (1 + 0.12 * I), 'linear']]); const bx = base('x'); K('x', [[t0, bx], [t1, bx - P.w * 0.03 * I, 'linear']]); break; }
      case 'spin': K('rotation', [[t0, base('rotation')], [t1, base('rotation') + 360 * I, ease || 'linear']]); break;
      case 'float': case 'pulse': case 'shake': {
        const period = name === 'shake' ? 0.08 : name === 'pulse' ? 0.8 : 2;
        const prop = name === 'pulse' ? 'scale' : name === 'shake' ? 'x' : 'y';
        const b = base(prop), amp = name === 'pulse' ? b * 0.06 * I : name === 'shake' ? 10 * I : P.h * 0.012 * I;
        const list = [[t0, b]]; let i = 0;
        for (let t = t0 + period / 2; t < t1 - 1e-6; t += period / 2) list.push([t, b + (i++ % 2 === 0 ? amp : (name === 'pulse' ? 0 : -amp)), 'easeInOut']);
        list.push([t1, b, 'easeInOut']);
        K(prop, list);
        break;
      }
      default: throw new Error('Нет такой анимации: ' + name);
    }
  },

  // ================= отрисовка кадра =================
  drawFit(g, src, sw, sh, w, hh, fit) {
    if (!sw || !sh) return;
    let dw = w, dh = hh;
    if (fit === 'contain' || fit === 'cover') {
      const k = fit === 'contain' ? Math.min(w / sw, hh / sh) : Math.max(w / sw, hh / sh);
      dw = sw * k; dh = sh * k;
    }
    g.drawImage(src, -dw / 2, -dh / 2, dw, dh);
  },
  rr(g, x, y, w, hh, r) { r = Math.min(r, w / 2, hh / 2); g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, hh, r); else g.rect(x, y, w, hh); },
  textLines(g, L, maxW) {
    const out = [];
    for (const para of String(L.text).split('\n')) {
      const words = para.split(' '); let line = '';
      for (const wd of words) {
        const test = line ? line + ' ' + wd : wd;
        if (maxW && g.measureText(test).width > maxW && line) { out.push(line); line = wd; } else line = test;
      }
      out.push(line);
    }
    return out;
  },
  drawLayer(g, L, t) {
    if (!L.visible || t < L.start || t > L.end) return;
    const v = p => Motion.val(L, p, t);
    const op = Math.max(0, Math.min(1, v('opacity')));
    if (op <= 0.001) return;
    g.save();
    g.globalAlpha = op;
    const blur = v('blur'); if (blur > 0.1) g.filter = `blur(${blur}px)`;
    g.translate(v('x'), v('y'));
    g.rotate(v('rotation') * Math.PI / 180);
    const s = v('scale'); g.scale(s, s);
    const w = L.w, hh = L.h;
    const reveal = Math.max(0, Math.min(1, v('reveal')));
    if (reveal < 1) { g.beginPath(); g.rect(-w / 2, -hh / 2, w * reveal, hh); g.clip(); }
    if (L.type === 'image' || L.type === 'video') {
      const el = Motion.mediaEl(L.asset);
      if (el) {
        const sw = L.type === 'video' ? el.videoWidth : el.naturalWidth, sh = L.type === 'video' ? el.videoHeight : el.naturalHeight;
        if (L.radius) { Motion.rr(g, -w / 2, -hh / 2, w, hh, L.radius); g.clip(); }
        if (L.fit === 'cover') { g.beginPath(); g.rect(-w / 2, -hh / 2, w, hh); g.clip(); }
        Motion.drawFit(g, el, sw, sh, w, hh, L.fit || 'contain');
      }
    } else if (L.type === 'shape') {
      g.fillStyle = L.fill || '#000';
      if (L.shape === 'ellipse') { g.beginPath(); g.ellipse(0, 0, w / 2, hh / 2, 0, 0, Math.PI * 2); } else Motion.rr(g, -w / 2, -hh / 2, w, hh, L.radius || 0);
      g.fill();
    } else if (L.type === 'text') {
      g.font = `${L.italic ? 'italic ' : ''}${L.weight || 400} ${L.size}px "${L.font}", sans-serif`;
      if ('letterSpacing' in g) g.letterSpacing = (L.letterSpacing || 0) + 'px';
      g.textBaseline = 'middle';
      g.textAlign = L.align || 'center';
      const lines = Motion.textLines(g, L, w);
      const lh = L.size * (L.lineHeight || 1.15);
      const total = lines.reduce((n, l) => n + l.length, 0);
      let left = Math.round(total * Math.max(0, Math.min(1, v('chars'))));
      const x0 = L.align === 'left' ? -w / 2 : L.align === 'right' ? w / 2 : 0;
      let y = -((lines.length - 1) * lh) / 2;
      if (L.bgColor) {
        let mw = 0; for (const ln of lines) mw = Math.max(mw, g.measureText(ln).width);
        const pad = L.size * 0.35, bw = mw + pad * 2, bh = lines.length * lh + pad;
        const bx = L.align === 'left' ? -w / 2 - pad : L.align === 'right' ? w / 2 - bw + pad : -bw / 2;
        g.fillStyle = L.bgColor; Motion.rr(g, bx, -bh / 2, bw, bh, L.size * 0.2); g.fill();
      }
      if (L.shadow) { g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = L.size * 0.15; g.shadowOffsetY = L.size * 0.05; }
      for (const ln of lines) {
        const part = ln.slice(0, Math.max(0, left)); left -= ln.length;
        if (part) {
          if (L.stroke) { g.lineWidth = L.stroke.width || 4; g.strokeStyle = L.stroke.color || '#000'; g.lineJoin = 'round'; g.strokeText(part, x0, y); }
          g.fillStyle = L.color || '#fff'; g.fillText(part, x0, y);
        }
        y += lh;
      }
    }
    g.restore();
  },
  drawFrame(g, t, { forExport = false } = {}) {
    const P = Motion.p;
    g.save();
    g.clearRect(0, 0, P.w, P.h);
    g.fillStyle = P.bg.color || '#000'; g.fillRect(0, 0, P.w, P.h);
    if (P.bg.type !== 'color' && P.bg.asset) {
      const el = Motion.mediaEl(P.bg.asset);
      if (el) {
        g.globalAlpha = P.bg.opacity ?? 1;
        g.translate(P.w / 2, P.h / 2);
        const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
        if (P.bg.zoom) { const k = 1 + (P.bg.zoom - 1) * (t / P.duration); g.scale(k, k); }
        Motion.drawFit(g, el, sw, sh, P.w, P.h, P.bg.fit || 'cover');
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
      }
      if (P.bg.dim) { g.fillStyle = `rgba(0,0,0,${P.bg.dim})`; g.fillRect(0, 0, P.w, P.h); }
    }
    for (const L of P.layers) Motion.drawLayer(g, L, t);
    g.restore();
  },
  // видео на нужном времени: при экспорте — точная перемотка
  videoTime(L, t) {
    const el = Motion.mediaEl(L ? L.asset : Motion.p.bg.asset);
    const dur = el && isFinite(el.duration) ? el.duration : 0;
    const off = L ? (L.offset || 0) : (Motion.p.bg.start || 0);
    let vt = L ? t - L.start + off : t + off;
    const loop = L ? L.loop !== false : Motion.p.bg.loop !== false;
    if (dur) vt = loop ? ((vt % dur) + dur) % dur : Math.min(vt, dur - 0.04);
    return Math.max(0, vt);
  },
  videos(t) {
    const out = [];
    const P = Motion.p;
    if (P.bg.type === 'video' && P.bg.asset) out.push([Motion.mediaEl(P.bg.asset), Motion.videoTime(null, t)]);
    for (const L of P.layers) if (L.type === 'video' && L.asset && t >= L.start && t <= L.end) out.push([Motion.mediaEl(L.asset), Motion.videoTime(L, t)]);
    return out.filter(([el]) => el);
  },
  async seekAll(t) {
    await Promise.all(Motion.videos(t).map(([el, vt]) => new Promise(res => {
      if (Math.abs(el.currentTime - vt) < 0.001 && el.readyState >= 2) return res();
      const done = () => { el.removeEventListener('seeked', done); res(); };
      el.addEventListener('seeked', done);
      el.currentTime = vt;
      setTimeout(done, 3000);
    })));
  },

  // ================= интерфейс =================
  build() {
    Motion.p = Motion.p || Motion.newProject();
    const el = h('div', { class: 'motion' });
    const B = (label, title, fn, cls = 'pbt') => h('button', { class: cls, title, onclick: fn }, label);
    Motion.sizeSel = UI.sel([...Motion.SIZES, ['custom', 'Свой размер…']], '', v => Motion.setSize(v), 'Размер кадра', 190);
    Motion.fpsSel = UI.sel([12, 15, 24, 25, 30, 50, 60].map(f => [f, f + ' к/с']), 30, v => { Motion.p.fps = +v; Motion.commit(); }, 'Кадров в секунду', 80);
    Motion.durIn = h('input', { type: 'number', class: 'num', min: 0.5, max: 600, step: 0.5, title: 'Длительность, с', onchange: e => { Motion.p.duration = Math.max(0.5, +e.target.value || 1); Motion.p.layers.forEach(L => { if (L.end > Motion.p.duration || L.end === Motion.prevDur) L.end = Motion.p.duration; }); Motion.commit(); } });
    Motion.playBtn = B('▶', 'Воспроизвести (пробел)', () => Motion.toggle(), 'pbt play');
    Motion.timeLbl = h('span', { class: 'mo-time' }, '0:00.0');
    const bar = h('div', { class: 'wsbar' },
      B('Новый', 'Новый ролик', () => UI.confirm('Начать новый ролик? Несохранённые изменения пропадут.', () => Motion.load(Motion.newProject()))),
      B('Открыть', 'Открыть проект .vkm', () => Motion.openDialog()), B('Сохранить', 'Сохранить проект .vkm (с ресурсами)', () => Motion.save()),
      h('span', { class: 'sep' }), Motion.sizeSel, Motion.fpsSel, h('span', { class: 'fl' }, ' с:'), Motion.durIn,
      h('span', { class: 'sep' }),
      B('+ Картинки', 'Картинки и кадры с компьютера', () => Motion.addFiles('image')), B('+ Видео', 'Видео слоем', () => Motion.addFiles('video')),
      B('+ Текст', 'Текстовый слой', () => Motion.addLayer(Motion.mkLayer('text', { start: Motion.t, h: Motion.p.h * 0.12 }))),
      B('+ Фигура', 'Прямоугольник или плашка', () => Motion.addLayer(Motion.mkLayer('shape', { start: Motion.t, w: Motion.p.w * 0.5, h: Motion.p.h * 0.08 }))),
      B('Фон…', 'Цвет, фото или видео на фоне', () => Motion.bgDialog()), B('Музыка…', 'Звуковая дорожка', () => Motion.audioDialog()),
      h('span', { class: 'sep' }), Motion.playBtn, Motion.timeLbl,
      h('span', { class: 'grow' }),
      B('ИИ-видео…', 'Сгенерировать видео моделью Polza из кадра', () => Motion.aiVideoDialog()),
      B('Экспорт ▾', 'Сохранить ролик в MP4 или WebM', e => { const r = e.currentTarget.getBoundingClientRect(); UI.showMenuList([{ label: 'MP4 (H.264)', action: () => Motion.exportDialog('mp4') }, { label: 'WebM (VP9)', action: () => Motion.exportDialog('webm') }, { label: 'PNG текущего кадра', action: () => Motion.exportFrame() }], r.left, r.bottom); }, 'primary'));
    const canvas = h('canvas', { class: 'mo-canvas' });
    Motion.canvas = canvas; Motion.g = canvas.getContext('2d');
    const stage = h('div', { class: 'mo-stage' }, canvas);
    Motion.stage = stage;
    Motion.side = h('div', { class: 'mo-side' });
    Motion.tl = h('div', { class: 'mo-tl' });
    el.append(bar, h('div', { class: 'mo-main' }, stage, Motion.side), Motion.tl);
    Motion.bindCanvas();
    Motion.buildSide();
    new ResizeObserver(() => Motion.fit()).observe(stage);
    let tlw = 0;
    new ResizeObserver(() => { const w = Motion.tl.clientWidth; if (w !== tlw) { tlw = w; Motion.renderTimeline(); } }).observe(Motion.tl);
    window.addEventListener('keydown', e => {
      if (WS.current !== 'motion' || Events.typing() || UI.modalOpen()) return;
      if (e.code === 'Space') { e.preventDefault(); Motion.toggle(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && Motion.selKey) { e.preventDefault(); Motion.deleteKey(); }
      else if ((e.key === 'Delete') && Motion.sel) { e.preventDefault(); Motion.removeLayer(Motion.sel); }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? Motion.redo() : Motion.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); Motion.redo(); }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); Motion.save(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); Motion.seek(Motion.t + (e.key === 'ArrowLeft' ? -1 : 1) / Motion.p.fps * (e.shiftKey ? 10 : 1)); }
    });
    Motion.hist = []; Motion.hpos = -1;
    Motion.load(Motion.p, true);
    return el;
  },
  shown() { Motion.fit(); Motion.refresh(); },
  load(p, keepAssets) {
    Motion.pause();
    Motion.p = p; Motion.sel = null; Motion.selKey = null; Motion.t = 0;
    if (!keepAssets) { /* ресурсы старого проекта остаются в памяти до перезапуска — их могли использовать отмены */ }
    Motion.hist = []; Motion.hpos = -1; Motion.commit();
    Motion.fit();
  },
  setSize(v) {
    if (v === 'custom') {
      UI.prompt('Размер кадра, пикселей (ширина×высота)', Motion.p.w + '×' + Motion.p.h, s => { const m = s.match(/(\d+)\D+(\d+)/); if (m) Motion.resize(+m[1], +m[2]); });
      return;
    }
    const [w, hh] = v.split('x').map(Number);
    Motion.resize(w, hh);
  },
  resize(w, hh) {
    const P = Motion.p, kx = w / P.w, ky = hh / P.h, k = Math.min(kx, ky);
    for (const L of P.layers) {
      L.x *= kx; L.y *= ky; L.w *= k; L.h *= k; if (L.size) L.size *= k;
      if (L.keys.x) L.keys.x.forEach(q => { q.v *= kx; }); if (L.keys.y) L.keys.y.forEach(q => { q.v *= ky; });
    }
    P.w = Math.round(w); P.h = Math.round(hh);
    Motion.commit(); Motion.fit();
  },
  fit() {
    if (!Motion.canvas || !Motion.p) return;
    const P = Motion.p, c = Motion.canvas;
    if (c.width !== P.w || c.height !== P.h) { c.width = P.w; c.height = P.h; }
    const r = Motion.stage.getBoundingClientRect();
    const k = Math.min((r.width - 24) / P.w, (r.height - 24) / P.h);
    c.style.width = Math.max(10, P.w * k) + 'px'; c.style.height = Math.max(10, P.h * k) + 'px';
    Motion.viewK = k;
    Motion.draw();
  },
  // ---------- история ----------
  snapshot() { return JSON.stringify(Motion.p); },
  commit() {
    const s = Motion.snapshot();
    if (Motion.hist[Motion.hpos] === s) { Motion.refresh(); return; }
    Motion.hist = Motion.hist.slice(0, Motion.hpos + 1); Motion.hist.push(s);
    if (Motion.hist.length > 120) Motion.hist.shift();
    Motion.hpos = Motion.hist.length - 1;
    Motion.refresh();
  },
  undo() { if (Motion.hpos > 0) { Motion.hpos--; Motion.p = JSON.parse(Motion.hist[Motion.hpos]); Motion.refresh(); Motion.fit(); } },
  redo() { if (Motion.hpos < Motion.hist.length - 1) { Motion.hpos++; Motion.p = JSON.parse(Motion.hist[Motion.hpos]); Motion.refresh(); Motion.fit(); } },
  refresh() {
    if (!Motion.el && !Motion.canvas) return;
    const P = Motion.p;
    Motion.sizeSel.value = Motion.SIZES.some(s => s[0] === P.w + 'x' + P.h) ? P.w + 'x' + P.h : 'custom';
    Motion.fpsSel.value = P.fps; Motion.durIn.value = P.duration; Motion.prevDur = P.duration;
    if (Motion.sel && !Motion.layer(Motion.sel)) Motion.sel = null;
    Motion.renderTimeline(); Motion.renderProps(); Motion.draw();
  },
  draw() {
    if (!Motion.g) return;
    Motion.drawFrame(Motion.g, Motion.t);
    // рамка выделенного слоя
    const L = Motion.sel && Motion.layer(Motion.sel);
    if (L && !Motion.playing) {
      const g = Motion.g, t = Motion.t, v = p => Motion.val(L, p, t);
      g.save(); g.translate(v('x'), v('y')); g.rotate(v('rotation') * Math.PI / 180); const s = v('scale'); g.scale(s, s);
      g.strokeStyle = '#2f8fff'; g.lineWidth = 2 / s / (Motion.viewK || 1); g.setLineDash([8 / s, 6 / s]);
      g.strokeRect(-L.w / 2, -L.h / 2, L.w, L.h);
      g.setLineDash([]); g.fillStyle = '#2f8fff';
      const hs = 9 / s / (Motion.viewK || 1); g.fillRect(L.w / 2 - hs / 2, L.h / 2 - hs / 2, hs, hs);
      g.restore();
    }
    const m = Math.floor(Motion.t / 60), sec = (Motion.t % 60).toFixed(1).padStart(4, '0');
    Motion.timeLbl.textContent = `${m}:${sec} / ${Motion.p.duration.toFixed(1)} с`;
    if (Motion.playhead) Motion.playhead.style.left = Motion.tx(Motion.t) + 'px';
  },
  // ---------- воспроизведение ----------
  toggle() { Motion.playing ? Motion.pause() : Motion.play(); },
  play() {
    if (Motion.playing) return;
    if (Motion.t >= Motion.p.duration - 0.01) Motion.t = 0;
    Motion.playing = true; Motion.playBtn.textContent = '❚❚';
    const t0 = performance.now() - Motion.t * 1000;
    for (const [el, vt] of Motion.videos(Motion.t)) { el.currentTime = vt; el.play().catch(() => { }); }
    const bg = Motion.p.bg.type === 'video' && Motion.mediaEl(Motion.p.bg.asset);
    if (bg && Motion.p.bg.audio) bg.muted = false;
    const au = Motion.p.audio && Motion.mediaEl(Motion.p.audio.asset);
    if (au) { au.muted = false; au.volume = Motion.p.audio.volume ?? 1; au.currentTime = Motion.t + (Motion.p.audio.start || 0); au.play().catch(() => { }); }
    const step = () => {
      if (!Motion.playing) return;
      Motion.t = (performance.now() - t0) / 1000;
      if (Motion.t >= Motion.p.duration) { Motion.t = Motion.p.duration; Motion.pause(); Motion.draw(); return; }
      for (const [el, vt] of Motion.videos(Motion.t)) { if (el.paused) el.play().catch(() => { }); if (Math.abs(el.currentTime - vt) > 0.25) el.currentTime = vt; }
      Motion.draw();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  pause() {
    Motion.playing = false; if (Motion.playBtn) Motion.playBtn.textContent = '▶';
    for (const m of Object.values(Motion.media)) if (m.el && m.el.pause) { m.el.pause(); m.el.muted = true; }
    if (Motion.p) Motion.seek(Motion.t);
  },
  async seek(t) {
    Motion.t = Math.max(0, Math.min(Motion.p.duration, t));
    Motion.draw();
    if (!Motion.playing) { await Motion.seekAll(Motion.t); Motion.draw(); }
    Motion.renderProps(true);
  },
  // ---------- мышь на холсте ----------
  toCanvas(e) { const r = Motion.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * Motion.p.w, y: (e.clientY - r.top) / r.height * Motion.p.h }; },
  hit(pt) {
    const t = Motion.t;
    for (let i = Motion.p.layers.length - 1; i >= 0; i--) {
      const L = Motion.p.layers[i];
      if (!L.visible || t < L.start || t > L.end) continue;
      const v = p => Motion.val(L, p, t), a = -v('rotation') * Math.PI / 180, s = v('scale');
      const dx = pt.x - v('x'), dy = pt.y - v('y');
      const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / s, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / s;
      if (Math.abs(lx) <= L.w / 2 && Math.abs(ly) <= L.h / 2) return { L, lx, ly };
    }
    return null;
  },
  bindCanvas() {
    const c = Motion.canvas;
    c.addEventListener('pointerdown', e => {
      if (Motion.playing) Motion.pause();
      const pt = Motion.toCanvas(e);
      const sel = Motion.sel && Motion.layer(Motion.sel);
      let mode = 'move', L;
      if (sel) {
        const v = p => Motion.val(sel, p, Motion.t), s = v('scale'), a = -v('rotation') * Math.PI / 180;
        const dx = pt.x - v('x'), dy = pt.y - v('y');
        const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / s, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / s;
        const tol = 14 / s / Motion.viewK;
        if (Math.abs(lx - sel.w / 2) < tol && Math.abs(ly - sel.h / 2) < tol) { mode = 'resize'; L = sel; }
      }
      if (!L) { const hit = Motion.hit(pt); L = hit && hit.L; }
      Motion.sel = L ? L.id : null; Motion.selKey = null;
      Motion.renderTimeline(); Motion.renderProps(); Motion.draw();
      if (!L) return;
      c.setPointerCapture(e.pointerId);
      const start = { x: pt.x, y: pt.y, lx: Motion.val(L, 'x', Motion.t), ly: Motion.val(L, 'y', Motion.t), w: L.w, h: L.h, size: L.size };
      let moved = false;
      const mv = ev => {
        const q = Motion.toCanvas(ev); moved = true;
        if (mode === 'move') Motion.moveLayer(L, start.lx + q.x - start.x - Motion.val(L, 'x', Motion.t), start.ly + q.y - start.y - Motion.val(L, 'y', Motion.t));
        else {
          const v = p => Motion.val(L, p, Motion.t), s = v('scale');
          const dx = q.x - v('x'), dy = q.y - v('y'), a = -v('rotation') * Math.PI / 180;
          const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / s, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / s;
          const nw = Math.max(10, lx * 2), nh = Math.max(10, ly * 2);
          if (ev.shiftKey || L.type === 'image' || L.type === 'video') { const k = Math.max(nw / start.w, nh / start.h); L.w = start.w * k; L.h = start.h * k; if (L.size) L.size = start.size * k; }
          else { L.w = nw; L.h = nh; }
        }
        Motion.draw();
      };
      const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); if (moved) Motion.commit(); };
      c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up);
    });
  },
  // сдвиг слоя: вся траектория двигается вместе с ним
  moveLayer(L, dx, dy) {
    L.x += dx; L.y += dy;
    if (L.keys.x) L.keys.x.forEach(k => { k.v += dx; });
    if (L.keys.y) L.keys.y.forEach(k => { k.v += dy; });
  },
  // ---------- слои ----------
  addLayer(L, select = true) {
    Motion.p.layers.push(L);
    if (select) Motion.sel = L.id;
    Motion.commit();
    return L;
  },
  removeLayer(id) { Motion.p.layers = Motion.p.layers.filter(l => l.id !== id); if (Motion.sel === id) Motion.sel = null; Motion.commit(); },
  async addFiles(kind) {
    const files = await Host.pickFiles(kind === 'video' ? '.mp4,.mov,.webm,.m4v' : '.png,.jpg,.jpeg,.webp,.gif,.svg', true, kind === 'video' ? 'Видео' : 'Картинки и кадры');
    if (!files.length) return;
    UI.busy('Загружаю…');
    try {
      const items = [];
      for (const f of files) items.push(await Motion.assetFromEntry(f));
      await Motion.addAssetsAsLayers(items);
    } finally { UI.busy(null); }
  },
  // картинки (Blob) — слоями; несколько — по очереди, как кадры
  async addImages(items) {
    const assets = [];
    for (const it of items) assets.push(await Motion.addAsset({ name: it.name, blob: it.blob }));
    await Motion.addAssetsAsLayers(assets);
  },
  async addAssetsAsLayers(assets) {
    const P = Motion.p, n = assets.length;
    const seg = n > 1 ? P.duration / n : P.duration;
    let first = null;
    assets.forEach((a, i) => {
      const el = Motion.mediaEl(a.id);
      const sw = (el && (el.naturalWidth || el.videoWidth)) || P.w, sh = (el && (el.naturalHeight || el.videoHeight)) || P.h;
      const k = Math.min(P.w * 0.9 / sw, P.h * 0.9 / sh);
      const L = Motion.mkLayer(a.kind === 'video' ? 'video' : 'image', { asset: a.id, name: a.name.replace(/\.\w+$/, ''), w: sw * k, h: sh * k, start: n > 1 ? i * seg : 0, end: n > 1 ? (i + 1) * seg : P.duration });
      P.layers.push(L); if (!first) first = L;
    });
    Motion.sel = first && first.id;
    Motion.commit();
    UI.toast(n > 1 ? `Добавлено кадров: ${n} — по ${seg.toFixed(1)} с` : 'Слой добавлен');
  },
  deleteKey() {
    const k = Motion.selKey; if (!k) return;
    const L = Motion.layer(k.id); if (!L || !L.keys[k.prop]) return;
    L.keys[k.prop] = L.keys[k.prop].filter(q => Math.abs(q.t - k.t) > 1e-4);
    if (!L.keys[k.prop].length) delete L.keys[k.prop];
    Motion.selKey = null; Motion.commit();
  },
  // ---------- таймлайн ----------
  tlW() { return Math.max(200, (Motion.tl.clientWidth || 800) - 190); },
  tx(t) { return 190 + t / Motion.p.duration * Motion.tlW(); },
  fromX(x) { return (x - 190) / Motion.tlW() * Motion.p.duration; },
  renderTimeline() {
    const tl = Motion.tl; if (!tl) return;
    tl.innerHTML = '';
    const P = Motion.p, W = Motion.tlW();
    const ruler = h('div', { class: 'mo-ruler' });
    const step = P.duration > 60 ? 10 : P.duration > 20 ? 5 : P.duration > 8 ? 1 : 0.5;
    for (let t = 0; t <= P.duration + 1e-6; t += step) ruler.append(h('span', { class: 'mo-tick', style: { left: Motion.tx(t) + 'px' } }, (Math.round(t * 10) / 10) + 'с'));
    const scrub = e => { const r = tl.getBoundingClientRect(); Motion.seek(Motion.fromX(e.clientX - r.left + tl.scrollLeft)); };
    ruler.addEventListener('pointerdown', e => { if (Motion.playing) Motion.pause(); scrub(e); ruler.setPointerCapture(e.pointerId); const mv = ev => scrub(ev); ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', () => ruler.removeEventListener('pointermove', mv), { once: true }); });
    tl.append(ruler);
    const bgRow = h('div', { class: 'mo-row bg' }, h('div', { class: 'mo-name', onclick: () => Motion.bgDialog() }, '🖼 Фон: ' + (P.bg.type === 'color' ? P.bg.color : (Motion.assets[P.bg.asset] || {}).name || P.bg.type)));
    tl.append(bgRow);
    if (P.audio) tl.append(h('div', { class: 'mo-row bg' }, h('div', { class: 'mo-name', onclick: () => Motion.audioDialog() }, '♪ ' + ((Motion.assets[P.audio.asset] || {}).name || 'Музыка'))));
    [...P.layers].reverse().forEach(L => {
      const row = h('div', { class: 'mo-row' + (L.id === Motion.sel ? ' sel' : '') });
      const name = h('div', { class: 'mo-name', title: 'Щелчок — выбрать, двойной — переименовать' },
        h('button', { class: 'ib', title: 'Показать/скрыть', onclick: e => { e.stopPropagation(); L.visible = !L.visible; Motion.commit(); } }, L.visible ? '👁' : '—'),
        h('span', {}, ({ image: '▣ ', video: '▶ ', text: 'T ', shape: '■ ' })[L.type] + L.name),
        h('span', { class: 'grow' }),
        h('button', { class: 'ib', title: 'Выше', onclick: e => { e.stopPropagation(); Motion.reorder(L.id, 1); } }, '↑'),
        h('button', { class: 'ib', title: 'Ниже', onclick: e => { e.stopPropagation(); Motion.reorder(L.id, -1); } }, '↓'));
      name.onclick = () => { Motion.sel = L.id; Motion.selKey = null; Motion.refresh(); };
      name.ondblclick = () => UI.prompt('Имя слоя', L.name, v => { if (v) { L.name = v; Motion.commit(); } });
      const barEl = h('div', { class: 'mo-bar ' + L.type, style: { left: Motion.tx(L.start) + 'px', width: Math.max(4, (L.end - L.start) / P.duration * W) + 'px' } },
        h('span', { class: 'mo-h l' }), h('span', { class: 'mo-h r' }));
      barEl.addEventListener('pointerdown', e => {
        e.stopPropagation();
        Motion.sel = L.id; Motion.selKey = null;
        const edge = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm';
        const x0 = e.clientX, s0 = L.start, e0 = L.end, keys0 = JSON.stringify(L.keys);
        barEl.setPointerCapture(e.pointerId);
        let moved = false;
        const mv = ev => {
          moved = true;
          const dt = (ev.clientX - x0) / W * P.duration;
          const snap = v => Math.round(v * P.fps) / P.fps;
          if (edge === 'l') L.start = Math.min(snap(s0 + dt), L.end - 0.1);
          else if (edge === 'r') L.end = Math.max(snap(e0 + dt), L.start + 0.1);
          else {
            const d = snap(Math.max(-s0, Math.min(P.duration - e0, dt)));
            L.start = s0 + d; L.end = e0 + d;
            L.keys = JSON.parse(keys0); for (const p in L.keys) L.keys[p].forEach(k => { k.t = Math.round((k.t + d) * 1000) / 1000; });
          }
          barEl.style.left = Motion.tx(L.start) + 'px'; barEl.style.width = Math.max(4, (L.end - L.start) / P.duration * W) + 'px';
          Motion.draw();
        };
        const up = () => { barEl.removeEventListener('pointermove', mv); barEl.removeEventListener('pointerup', up); moved ? Motion.commit() : Motion.refresh(); };
        barEl.addEventListener('pointermove', mv); barEl.addEventListener('pointerup', up);
      });
      const lane = h('div', { class: 'mo-lane' }, barEl);
      // ключевые кадры (все свойства в одной строке)
      const times = new Map();
      for (const p of Object.keys(L.keys || {})) for (const k of L.keys[p]) { const key = k.t.toFixed(3); if (!times.has(key)) times.set(key, []); times.get(key).push(p); }
      for (const [tk, props] of times) {
        const t = +tk;
        const isSel = Motion.selKey && Motion.selKey.id === L.id && Math.abs(Motion.selKey.t - t) < 1e-4;
        const d = h('span', { class: 'mo-key' + (isSel ? ' sel' : ''), title: props.map(p => Motion.PROP_NAMES[p]).join(', ') + ' · ' + t.toFixed(2) + ' с', style: { left: Motion.tx(t) + 'px' } });
        d.addEventListener('pointerdown', e => {
          e.stopPropagation();
          Motion.sel = L.id; Motion.selKey = { id: L.id, t, prop: props[0], props };
          const x0 = e.clientX; d.setPointerCapture(e.pointerId); let moved = false;
          const mv = ev => { moved = true; d.style.left = (Motion.tx(t) + ev.clientX - x0) + 'px'; };
          const up = ev => {
            d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up);
            if (moved) {
              const nt = Math.round(Math.max(0, Math.min(P.duration, t + (ev.clientX - x0) / W * P.duration)) * P.fps) / P.fps;
              for (const p of props) { const k = L.keys[p].find(q => Math.abs(q.t - t) < 1e-4); if (k) k.t = Math.round(nt * 1000) / 1000; L.keys[p].sort((a, b) => a.t - b.t); }
              Motion.selKey.t = nt; Motion.commit();
            } else { Motion.seek(t); Motion.refresh(); }
          };
          d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up);
        });
        lane.append(d);
      }
      row.append(name, lane);
      tl.append(row);
    });
    if (!P.layers.length) tl.append(h('div', { class: 'mo-empty muted' }, 'Добавьте картинки или кадры (+ Картинки), текст и фон — или поручите ролик агенту справа.'));
    Motion.playhead = h('div', { class: 'mo-playhead', style: { left: Motion.tx(Motion.t) + 'px' } });
    tl.append(Motion.playhead);
  },
  reorder(id, dir) {
    const a = Motion.p.layers, i = a.findIndex(l => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; Motion.commit();
  },
  // ---------- боковая панель: агент и свойства ----------
  buildSide() {
    const tabs = h('div', { class: 'mo-tabs' });
    Motion.agentBox = Motion.buildAgent();
    Motion.propsBox = h('div', { class: 'mo-props' });
    const show = k => { Motion.sideTab = k; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); Motion.agentBox.style.display = k === 'agent' ? '' : 'none'; Motion.propsBox.style.display = k === 'props' ? '' : 'none'; };
    tabs.append(h('button', { 'data-k': 'agent', onclick: () => show('agent') }, '✦ Агент'), h('button', { 'data-k': 'props', onclick: () => show('props') }, 'Слой и анимация'));
    Motion.side.append(tabs, Motion.agentBox, Motion.propsBox);
    Motion.showSide = show;
    show('agent');
  },
  renderProps(onlyValues) {
    const box = Motion.propsBox; if (!box) return;
    const L = Motion.sel && Motion.layer(Motion.sel);
    if (onlyValues && box.dataset.layer === (L ? L.id : '') && box.dataset.t !== undefined) {
      box.querySelectorAll('[data-prop]').forEach(i => { if (document.activeElement !== i) i.value = G.round(Motion.val(L, i.dataset.prop, Motion.t), 2); });
      return;
    }
    box.innerHTML = ''; box.dataset.layer = L ? L.id : ''; box.dataset.t = '';
    if (!L) { box.append(h('p', { class: 'muted' }, 'Выберите слой на холсте или на таймлайне.')); return; }
    const row = (label, ...kids) => h('div', { class: 'mo-pr' }, h('span', { class: 'fl' }, label), ...kids);
    const num = (key, step = 1, onch) => h('input', { type: 'number', class: 'num', step, value: G.round(L[key], 2), onchange: e => { L[key] = +e.target.value; onch && onch(); Motion.commit(); } });
    box.append(h('div', { class: 'mo-pt' }, L.name),
      row('Время, с', num('start', 0.1), h('span', { class: 'fl' }, '—'), num('end', 0.1)),
      row('Размер', num('w', 1), h('span', { class: 'fl' }, '×'), num('h', 1)));
    if (L.type === 'text') {
      const ta = h('textarea', { rows: 3, class: 'wide', value: L.text, onchange: e => { L.text = e.target.value; Motion.commit(); } });
      ta.addEventListener('keydown', e => e.stopPropagation());
      const fonts = [...new Set(['Oswald', 'Bebas Neue', 'DINAMIKA', 'Arial', 'Georgia', 'Impact', ...Object.keys(Fonts.faces || {})])];
      box.append(row('Текст'), ta,
        row('Шрифт', UI.sel(fonts, L.font, v => { L.font = v; Motion.commit(); }, '', 150), num('size', 1)),
        row('Цвет', h('input', { type: 'color', value: L.color, onchange: e => { L.color = e.target.value; Motion.commit(); } }),
          UI.sel([['left', 'Влево'], ['center', 'По центру'], ['right', 'Вправо']], L.align, v => { L.align = v; Motion.commit(); }, '', 100)),
        row('Плашка', h('input', { type: 'checkbox', checked: !!L.bgColor, onchange: e => { L.bgColor = e.target.checked ? '#e30613' : null; Motion.commit(); } }),
          h('input', { type: 'color', value: L.bgColor || '#e30613', onchange: e => { L.bgColor = e.target.value; Motion.commit(); } }),
          h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!L.shadow, onchange: e => { L.shadow = e.target.checked; Motion.commit(); } }), ' тень')));
    }
    if (L.type === 'shape') box.append(row('Форма', UI.sel([['rect', 'Прямоугольник'], ['ellipse', 'Эллипс']], L.shape, v => { L.shape = v; Motion.commit(); }, '', 130), h('input', { type: 'color', value: L.fill, onchange: e => { L.fill = e.target.value; Motion.commit(); } })), row('Скругление', num('radius', 1)));
    if (L.type === 'image' || L.type === 'video') box.append(row('Вписать', UI.sel([['contain', 'Целиком'], ['cover', 'Заполнить'], ['stretch', 'Растянуть']], L.fit, v => { L.fit = v; Motion.commit(); }, '', 120), num('radius', 1)),
      row('', h('button', { class: 'pbt', onclick: () => Motion.aiLayer(L, 'bg') }, 'Удалить фон (ИИ)'), h('button', { class: 'pbt', onclick: () => Motion.aiLayer(L, 'upscale') }, 'Увеличить')));
    // свойства с ключами на текущем времени
    box.append(h('div', { class: 'mo-pt' }, 'Свойства на ' + Motion.t.toFixed(2) + ' с'), h('p', { class: 'muted small' }, '◆ — поставить ключ на текущем времени. Без ключей значение действует весь слой.'));
    for (const p of ['x', 'y', 'scale', 'rotation', 'opacity', 'blur', 'reveal', ...(L.type === 'text' ? ['chars'] : [])]) {
      const has = L.keys[p] && L.keys[p].length;
      const inp = h('input', { type: 'number', class: 'num', 'data-prop': p, step: ['scale', 'opacity', 'reveal', 'chars'].includes(p) ? 0.05 : 1, value: G.round(Motion.val(L, p, Motion.t), 2), onchange: e => {
        const v = +e.target.value;
        if (has) Motion.setKey(L, p, Motion.t, v); else L[p] = v;
        Motion.commit();
      } });
      box.append(row(Motion.PROP_NAMES[p], inp,
        h('button', { class: 'ib' + (has ? ' on' : ''), title: 'Ключ на текущем времени', onclick: () => { Motion.setKey(L, p, Motion.t, Motion.val(L, p, Motion.t)); Motion.commit(); } }, '◆'),
        has ? h('button', { class: 'ib', title: 'Убрать все ключи этого свойства', onclick: () => { L[p] = Motion.val(L, p, Motion.t); delete L.keys[p]; Motion.commit(); } }, '×') : ''));
    }
    // готовые анимации
    const preset = UI.sel(Object.entries(Motion.PRESETS), 'fadeIn', () => { }, '', 170);
    const dur = h('input', { type: 'number', class: 'num', value: 0.8, step: 0.1, min: 0.05 });
    const dir = UI.sel([['left', 'слева'], ['right', 'справа'], ['up', 'сверху'], ['down', 'снизу']], 'left', () => { }, '', 90);
    const ease = UI.sel([['', 'плавность'], ...Motion.EASES.map(e => [e, e])], '', () => { }, '', 100);
    box.append(h('div', { class: 'mo-pt' }, 'Анимация'), row('', preset), row('Длит., с', dur, dir), row('', ease,
      h('button', { class: 'pbt', onclick: () => { const t0 = preset.value.endsWith('Out') ? Math.max(L.start, Math.min(L.end, Motion.t)) : Math.max(L.start, Motion.t); Motion.applyPreset(L, preset.value, t0, +dur.value, { direction: dir.value, ease: ease.value || undefined }); Motion.commit(); } }, 'Применить с текущего времени')),
      h('button', { class: 'pbt', onclick: () => { L.keys = {}; Motion.commit(); } }, 'Убрать всю анимацию слоя'),
      h('button', { class: 'pbt', onclick: () => { const c = JSON.parse(JSON.stringify(L)); c.id = Motion.uid(); c.name += ' (копия)'; Motion.addLayer(c); } }, 'Дублировать слой'),
      h('button', { class: 'pbt danger', onclick: () => Motion.removeLayer(L.id) }, 'Удалить слой'));
    box.querySelectorAll('input,textarea').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
    box.dataset.t = String(Motion.t);
  },
  // ---------- диалоги ----------
  bgDialog() {
    const P = Motion.p, bg = P.bg;
    const col = h('input', { type: 'color', value: bg.color || '#000000' });
    const fit = UI.sel([['cover', 'Заполнить кадр'], ['contain', 'Целиком']], bg.fit || 'cover', () => { });
    const dim = h('input', { type: 'number', class: 'num', min: 0, max: 0.9, step: 0.05, value: bg.dim || 0 });
    const zoom = h('input', { type: 'number', class: 'num', min: 1, max: 1.5, step: 0.02, value: bg.zoom || 1 });
    const start = h('input', { type: 'number', class: 'num', min: 0, step: 0.1, value: bg.start || 0 });
    const audio = h('input', { type: 'checkbox', checked: bg.audio !== false });
    const cur = h('div', { class: 'muted' }, bg.type === 'color' ? 'Сейчас: цвет' : 'Сейчас: ' + ((Motion.assets[bg.asset] || {}).name || bg.type));
    const pick = async kind => {
      const [f] = await Host.pickFiles(kind === 'video' ? '.mp4,.mov,.webm,.m4v' : '.png,.jpg,.jpeg,.webp', false, kind === 'video' ? 'Видео для фона' : 'Фото для фона');
      if (!f) return;
      UI.busy('Загружаю…');
      try { const a = await Motion.assetFromEntry(f); bg.type = a.kind === 'video' ? 'video' : 'image'; bg.asset = a.id; cur.textContent = 'Сейчас: ' + a.name; if (a.kind === 'video') { const d = Motion.assetDuration(a.id); if (d && !Motion.p.layers.length) Motion.p.duration = Math.round(Math.min(d, 60) * 10) / 10; } Motion.commit(); } finally { UI.busy(null); }
    };
    UI.dialog('Фон ролика', h('div', { class: 'form' }, cur,
      h('div', { class: 'row' }, h('button', { class: 'pbt', onclick: () => pick('image') }, 'Фото с компьютера…'), h('button', { class: 'pbt', onclick: () => pick('video') }, 'Видео с компьютера…'), h('button', { class: 'pbt', onclick: () => { bg.type = 'color'; bg.asset = null; cur.textContent = 'Сейчас: цвет'; Motion.commit(); } }, 'Только цвет')),
      h('label', {}, 'Цвет фона', col), h('label', {}, 'Вписать', fit), h('label', {}, 'Затемнение (0…0.9)', dim), h('label', {}, 'Медленный наезд (1 — нет, 1.1 — +10%)', zoom),
      h('label', {}, 'Видео: начать с секунды', start), h('label', { class: 'row' }, audio, ' Звук видео-фона в ролике')),
    [{ label: 'Готово', primary: true, action: () => { Object.assign(bg, { color: col.value, fit: fit.value, dim: +dim.value || 0, zoom: +zoom.value || 1, start: +start.value || 0, audio: audio.checked }); Motion.commit(); } }]);
  },
  audioDialog() {
    const P = Motion.p;
    const vol = h('input', { type: 'number', class: 'num', min: 0, max: 1, step: 0.05, value: P.audio ? P.audio.volume ?? 1 : 1 });
    const start = h('input', { type: 'number', class: 'num', min: 0, step: 0.1, value: P.audio ? P.audio.start || 0 : 0 });
    UI.dialog('Музыка', h('div', { class: 'form' },
      h('button', { class: 'pbt', onclick: async () => { const [f] = await Host.pickFiles('.mp3,.wav,.m4a,.ogg,.aac', false, 'Звуковой файл'); if (!f) return; const a = await Motion.assetFromEntry(f); P.audio = { asset: a.id, volume: +vol.value, start: +start.value }; Motion.commit(); UI.toast('Музыка: ' + a.name); } }, 'Выбрать файл…'),
      h('label', {}, 'Громкость (0…1)', vol), h('label', {}, 'Начать с секунды', start),
      P.audio ? h('button', { class: 'pbt', onclick: () => { P.audio = null; Motion.commit(); UI.closeDialog(); } }, 'Убрать музыку') : ''),
    [{ label: 'Готово', primary: true, action: () => { if (P.audio) { P.audio.volume = +vol.value; P.audio.start = +start.value; Motion.commit(); } } }]);
  },
  async aiLayer(L, kind) {
    const a = Motion.assets[L.asset]; if (!a || a.kind !== 'image') return UI.toast('Это не картинка');
    await withBusy(kind === 'bg' ? 'Удаляю фон…' : 'Увеличиваю…', async onStatus => {
      const src = a.blob || await (await fetch(a.url)).blob();
      const out = kind === 'bg' ? await Polza.removeBackground(src, { onStatus }) : await Polza.upscale(src, { onStatus });
      const na = await Motion.addAsset({ name: a.name.replace(/\.\w+$/, '') + (kind === 'bg' ? '-без-фона.png' : '-апскейл.png'), blob: out });
      L.asset = na.id; Motion.commit();
    });
  },
  aiVideoDialog() {
    const prompt = h('textarea', { rows: 4, class: 'wide', placeholder: 'Что происходит в ролике: «камера медленно облетает продукт, мягкий свет, пар над чашкой»' });
    const from = UI.sel([['frame', 'Из текущего кадра'], ['layer', 'Из выделенной картинки'], ['text', 'Только по описанию']], 'frame', () => { });
    const as = UI.sel([['bg', 'Поставить фоном'], ['layer', 'Добавить слоем']], 'bg', () => { });
    const dur = h('input', { type: 'number', class: 'num', value: 5, min: 2, max: 15 });
    UI.dialog('ИИ-видео (Polza)', h('div', { class: 'form' }, h('label', {}, 'Описание движения', prompt), h('label', {}, 'Исходник', from), h('label', {}, 'Длительность, с', dur), h('label', {}, 'Результат', as),
      h('p', { class: 'muted' }, 'Модель видео — в «⚙ Polza». Генерация занимает минуты; заказ не пропадёт, даже если закрыть окно.')),
    [{ label: 'Отмена' }, { label: 'Сгенерировать', primary: true, action: () => {
      const p = prompt.value.trim(); if (!p) return false;
      Motion.aiVideo(p, { from: from.value, as: as.value, duration: +dur.value || 5 });
    } }]);
  },
  async aiVideo(prompt, { from = 'frame', as = 'bg', duration = 5, layerId } = {}) {
    return withBusy('Генерирую видео…', async onStatus => {
      let image = null;
      if (from === 'frame') image = await Motion.frameBlob(Motion.t);
      else if (from === 'layer') { const L = Motion.layer(layerId || Motion.sel); const a = L && Motion.assets[L.asset]; if (!a) throw new Error('Выделите слой-картинку'); image = a.blob || await (await fetch(a.url)).blob(); }
      const blob = await Polza.generateVideo(prompt, { image, params: { duration }, onStatus });
      const a = await Motion.addAsset({ name: 'ИИ-видео.mp4', blob, kind: 'video' });
      if (as === 'bg') { Motion.p.bg.type = 'video'; Motion.p.bg.asset = a.id; }
      else Motion.addLayer(Motion.mkLayer('video', { asset: a.id, name: 'ИИ-видео', fit: 'cover', w: Motion.p.w, h: Motion.p.h }));
      Motion.commit();
      return a;
    });
  },
  // ---------- кадры и экспорт ----------
  async frameCanvas(t, maxSide) {
    await Motion.seekAll(t);
    const P = Motion.p, c = document.createElement('canvas');
    const k = maxSide ? Math.min(1, maxSide / Math.max(P.w, P.h)) : 1;
    c.width = Math.round(P.w * k); c.height = Math.round(P.h * k);
    const g = c.getContext('2d'); g.scale(k, k);
    Motion.drawFrame(g, t);
    return c;
  },
  async frameBlob(t, type = 'image/png') { const c = await Motion.frameCanvas(t); return new Promise(r => c.toBlob(r, type, 0.92)); },
  async exportFrame() {
    const b = await Motion.frameBlob(Motion.t);
    await Host.saveFile((Motion.p.name || 'кадр') + '-' + Motion.t.toFixed(1) + 'с.png', b, 'image/png');
  },
  exportDialog(fmt) {
    const P = Motion.p;
    const scale = UI.sel([[1, `${P.w}×${P.h}`], [0.5, `${Math.round(P.w / 2)}×${Math.round(P.h / 2)} (быстрее)`]], 1, () => { });
    const q = UI.sel([['high', 'Высокое качество'], ['medium', 'Среднее'], ['low', 'Маленький файл']], 'high', () => { });
    UI.dialog('Экспорт ' + fmt.toUpperCase(), h('div', { class: 'form' }, h('label', {}, 'Размер', scale), h('label', {}, 'Качество', q),
      h('p', { class: 'muted' }, `${P.duration} с × ${P.fps} к/с = ${Math.round(P.duration * P.fps)} кадров. Звук — из видео-фона и музыки.`)),
    [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: () => { Motion.render(fmt, { scale: +scale.value, quality: q.value }).then(r => r && Motion.saveBlob(r.blob, r.name)); } }]);
  },
  async saveBlob(blob, name, folder) {
    if (folder) return Host.writeToFolder(folder, name, blob);
    return Host.saveFile(name, blob, blob.type);
  },
  async render(fmt = 'mp4', { scale = 1, quality = 'high', onProgress } = {}) {
    if (typeof VideoEncoder === 'undefined') { UI.toast('Кодирование видео недоступно в этом браузере — используйте настольную версию', true); return null; }
    Motion.pause();
    const P = Motion.p;
    const W = Math.round(P.w * scale / 2) * 2, H = Math.round(P.h * scale / 2) * 2;
    const fps = P.fps, frames = Math.max(1, Math.round(P.duration * fps));
    const bitrate = Math.round(W * H * fps * ({ high: 0.2, medium: 0.1, low: 0.05 }[quality] || 0.15));
    let vcodec, muxCodec, lib;
    if (fmt === 'mp4') {
      lib = await Host.lib('mp4');
      for (const c of ['avc1.640033', 'avc1.4d0033', 'avc1.42003e', 'avc1.42001f']) {
        const s = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: fps }).catch(() => ({}));
        if (s.supported) { vcodec = c; muxCodec = 'avc'; break; }
      }
      if (!vcodec) {
        const s = await VideoEncoder.isConfigSupported({ codec: 'vp09.00.40.08', width: W, height: H, bitrate, framerate: fps }).catch(() => ({}));
        if (s.supported) { vcodec = 'vp09.00.40.08'; muxCodec = 'vp9'; }
      }
    } else {
      lib = await Host.lib('webm');
      for (const c of ['vp09.00.40.08', 'vp8']) {
        const s = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: fps }).catch(() => ({}));
        if (s.supported) { vcodec = c; muxCodec = c === 'vp8' ? 'V_VP8' : 'V_VP9'; break; }
      }
    }
    if (!vcodec) { UI.toast('Нет подходящего видеокодека', true); return null; }
    // звук: видео-фон и музыка, сведённые заранее
    let audio = null;
    try { audio = await Motion.mixAudio(); } catch (e) { console.warn('звук', e); }
    let acodec = null;
    if (audio && typeof AudioEncoder !== 'undefined') {
      const cands = fmt === 'mp4' ? [['mp4a.40.2', 'aac'], ['opus', 'opus']] : [['opus', 'A_OPUS']];
      for (const [c, m] of cands) {
        const s = await AudioEncoder.isConfigSupported({ codec: c, sampleRate: audio.sampleRate, numberOfChannels: 2, bitrate: 192000 }).catch(() => ({}));
        if (s.supported) { acodec = [c, m]; break; }
      }
    }
    const target = fmt === 'mp4' ? new lib.ArrayBufferTarget() : new lib.ArrayBufferTarget();
    const muxer = fmt === 'mp4'
      ? new lib.Muxer({ target, fastStart: 'in-memory', video: { codec: muxCodec, width: W, height: H, frameRate: fps }, ...(acodec ? { audio: { codec: acodec[1], sampleRate: audio.sampleRate, numberOfChannels: 2 } } : {}), firstTimestampBehavior: 'offset' })
      : new lib.Muxer({ target, video: { codec: muxCodec, width: W, height: H, frameRate: fps }, ...(acodec ? { audio: { codec: acodec[1], sampleRate: audio.sampleRate, numberOfChannels: 2 } } : {}), firstTimestampBehavior: 'offset' });
    let encErr = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
    venc.configure({ codec: vcodec, width: W, height: H, bitrate, framerate: fps, ...(muxCodec === 'avc' ? { avc: { format: 'avc' } } : {}) });
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const cancel = { stop: false };
    const box = UI.busy && (UI.busy('Экспорт: 0%'), UI.$('#busy'));
    if (box) box.append(h('button', { class: 'pbt', style: { marginLeft: '10px' }, onclick: () => { cancel.stop = true; } }, 'Отмена'));
    try {
      for (let i = 0; i < frames; i++) {
        if (cancel.stop) throw new Error('Экспорт отменён');
        if (encErr) throw encErr;
        const t = i / fps;
        await Motion.seekAll(t);
        g.setTransform(scale, 0, 0, scale, 0, 0);
        Motion.drawFrame(g, t);
        const vf = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 5));
        if (i % 5 === 0) {
          const pct = Math.round(i / frames * 100);
          const el = UI.$('#busy'); if (el && el.firstChild) el.childNodes[1].textContent = 'Экспорт: ' + pct + '%';
          onProgress && onProgress(pct);
        }
      }
      await venc.flush();
      if (acodec) {
        const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { encErr = e; } });
        aenc.configure({ codec: acodec[0], sampleRate: audio.sampleRate, numberOfChannels: 2, bitrate: 192000 });
        const N = audio.length, CH = 2, block = 4096;
        const L0 = audio.getChannelData(0), R0 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L0;
        for (let off = 0; off < N; off += block) {
          const n = Math.min(block, N - off);
          const data = new Float32Array(n * CH);
          data.set(L0.subarray(off, off + n), 0); data.set(R0.subarray(off, off + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: CH, timestamp: Math.round(off / audio.sampleRate * 1e6), data });
          aenc.encode(ad); ad.close();
        }
        await aenc.flush();
      }
      if (encErr) throw encErr;
      muxer.finalize();
      const ext = fmt === 'mp4' ? 'mp4' : 'webm';
      const blob = new Blob([target.buffer], { type: fmt === 'mp4' ? 'video/mp4' : 'video/webm' });
      UI.toast(`Готово: ${blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(blob.size / 1024)) + ' КБ'}${acodec ? '' : audio ? ' (без звука: кодек недоступен)' : ''}`);
      return { blob, name: (P.name || 'ролик') + '.' + ext };
    } catch (e) {
      console.error(e); UI.toast('Экспорт: ' + (e.message || e), true);
      return null;
    } finally { try { venc.close(); } catch (e) { } UI.busy(null); Motion.seek(Motion.t); }
  },
  async decodeAudio(asset, ctx) {
    const a = Motion.assets[asset]; if (!a) return null;
    const buf = a.blob ? await a.blob.arrayBuffer() : await (await fetch(a.url)).arrayBuffer();
    return ctx.decodeAudioData(buf);
  },
  async mixAudio() {
    const P = Motion.p, sr = 48000;
    const srcs = [];
    if (P.bg.type === 'video' && P.bg.asset && P.bg.audio !== false) srcs.push({ asset: P.bg.asset, offset: P.bg.start || 0, at: 0, vol: 1, loop: P.bg.loop !== false });
    for (const L of P.layers) if (L.type === 'video' && L.audio) srcs.push({ asset: L.asset, offset: L.offset || 0, at: L.start, vol: L.volume ?? 1, loop: false, until: L.end });
    if (P.audio && P.audio.asset) srcs.push({ asset: P.audio.asset, offset: P.audio.start || 0, at: 0, vol: P.audio.volume ?? 1, loop: false, fade: true });
    if (!srcs.length) return null;
    const ctx = new OfflineAudioContext(2, Math.ceil(P.duration * sr), sr);
    let any = false;
    for (const s of srcs) {
      let buf; try { buf = await Motion.decodeAudio(s.asset, ctx); } catch (e) { continue; }
      if (!buf) continue;
      const node = ctx.createBufferSource(); node.buffer = buf; node.loop = s.loop;
      const gain = ctx.createGain(); gain.gain.value = s.vol;
      if (s.fade) { gain.gain.setValueAtTime(s.vol, Math.max(0, P.duration - 1.5)); gain.gain.linearRampToValueAtTime(0, P.duration); }
      node.connect(gain).connect(ctx.destination);
      node.start(s.at, Math.min(s.offset, Math.max(0, buf.duration - 0.01)));
      if (s.until) node.stop(s.until);
      any = true;
    }
    return any ? ctx.startRendering() : null;
  },
  // ---------- проект .vkm ----------
  async save(folder, name) {
    const P = Motion.p;
    const files = {}, used = new Set();
    if (P.bg.asset) used.add(P.bg.asset);
    if (P.audio && P.audio.asset) used.add(P.audio.asset);
    P.layers.forEach(L => L.asset && used.add(L.asset));
    const assets = {};
    for (const id of used) {
      const a = Motion.assets[id]; if (!a) continue;
      const ext = (a.name.match(/\.(\w+)$/) || [, a.kind === 'video' ? 'mp4' : 'png'])[1];
      if (a.path && !a.blob) { assets[id] = { name: a.name, kind: a.kind, path: a.path }; continue; }
      const blob = a.blob || await (await fetch(a.url)).blob();
      files['assets/' + id + '.' + ext] = new Uint8Array(await blob.arrayBuffer());
      assets[id] = { name: a.name, kind: a.kind, file: 'assets/' + id + '.' + ext, type: blob.type };
    }
    files['project.json'] = fflate.strToU8(JSON.stringify({ app: 'Вектор · Моушн', project: P, assets }, null, 1));
    const zip = fflate.zipSync(files, { level: 0 });
    const fname = (name || P.name || 'ролик') + '.vkm';
    const r = folder ? await Host.writeToFolder(folder, fname, zip) : await Host.saveFile(fname, zip, 'application/zip', 'vkm');
    if (r) UI.toast('Проект сохранён');
    return r;
  },
  async openDialog() {
    const [f] = await Host.pickFiles('.vkm', false, 'Открыть проект моушна');
    if (f) Motion.openBuffer(await f.read(), f.name);
  },
  async openBuffer(buf, name) {
    if (!Motion.el) WS.show('motion'); else if (WS.current !== 'motion') WS.show('motion');
    UI.busy('Открываю ' + name + '…');
    try {
      const files = fflate.unzipSync(new Uint8Array(buf));
      const js = JSON.parse(fflate.strFromU8(files['project.json']));
      const map = {};
      for (const [id, a] of Object.entries(js.assets || {})) {
        let na;
        if (a.file && files[a.file]) na = await Motion.addAsset({ name: a.name, blob: new Blob([files[a.file]], { type: a.type || Host.mimeOf(a.file) }), kind: a.kind });
        else if (a.path) na = await Motion.addAsset({ name: a.name, path: a.path, kind: a.kind });
        if (na) map[id] = na.id;
      }
      const P = js.project;
      const re = id => map[id] || id;
      if (P.bg.asset) P.bg.asset = re(P.bg.asset);
      if (P.audio && P.audio.asset) P.audio.asset = re(P.audio.asset);
      P.layers.forEach(L => { if (L.asset) L.asset = re(L.asset); });
      P.name = P.name || name.replace(/\.vkm$/i, '');
      Motion.load(P);
    } catch (e) { console.error(e); UI.toast('Не удалось открыть проект: ' + (e.message || e), true); }
    finally { UI.busy(null); }
  },

  // ================= ИИ-агент моушна =================
  buildAgent() {
    const wrap = h('div', { class: 'mo-agent' });
    const mats = h('div', { class: 'mo-mats' });
    const renderMats = () => {
      mats.innerHTML = '';
      mats.append(h('div', { class: 'row' }, h('b', {}, 'Материалы'), h('span', { class: 'grow' }),
        h('button', { class: 'pbt', onclick: async () => { await Agent.addFolder('sources'); renderMats(); } }, '+ Папка'),
        h('button', { class: 'pbt', onclick: async () => { await Agent.addFiles('sources'); renderMats(); } }, '+ Файлы'),
        h('button', { class: 'pbt', title: 'Папка, куда агент сохранит ролик', onclick: async () => { await Agent.addFolder('output'); renderMats(); } }, '+ Куда сохранить')));
      if (!Agent.materials.length) mats.append(h('div', { class: 'muted small' }, 'Кадры, фото, видео для фона, музыка, брендбук — всё с вашего компьютера.'));
      for (const m of Agent.materials) mats.append(h('span', { class: 'ag-chip role-' + m.role }, (m.kind === 'folder' ? '📁 ' + m.name + ' (' + m.folder.files.length + ')' : '📄 ' + m.name),
        h('button', { class: 'ib', onclick: () => { Agent.materials = Agent.materials.filter(x => x !== m); renderMats(); Agent.renderMaterials(); } }, '×')));
    };
    renderMats();
    Motion.renderMats = renderMats;
    Motion.history = [];
    const chat = ChatBox({
      placeholder: 'Задача: «сделай из этих кадров рекламный ролик 15 с для Reels на фоне видео из папки, с текстом и ценой»',
      empty: ['Агент сам составит план анимации, расставит кадры, текст и движение, при необходимости сгенерирует фон или видео в Polza и сохранит ролик.', 'Прикрепите папку с кадрами/фото/видео — или работайте с тем, что уже на таймлайне.'],
      quick: [
        ['Моушн из кадров', 'Сделай моушн-дизайн из слоёв и кадров, что уже есть: продумай план анимации (появления, переходы, акценты), длительность 10 с, и собери ролик.'],
        ['Под ключ на фоне видео', 'Сделай ролик под ключ: возьми мои кадры из материалов, поставь на фон видео из материалов, добавь текст и анимацию, проверь кадры и сохрани MP4 в папку для результата.'],
        ['Оживить картинку (ИИ)', 'Оживи выделенную картинку: сгенерируй видео из неё моделью Polza (лёгкое движение камеры) и поставь фоном, сверху — анимированный заголовок.'],
      ],
      onSend: (text, ui) => Polza.agent(text, {
        system: Motion.systemPrompt, tools: Motion.tools(), history: Motion.history,
        exec: (n, a) => Motion.exec(n, a), shouldStop: () => ui.stopFlag,
        onEvent: ui.event((n, a) => Motion.toolLabel(n, a)),
      }).then(() => { renderMats(); }),
    });
    wrap.append(mats, chat.el);
    Motion.chat = chat;
    return wrap;
  },
  systemPrompt() {
    const P = Motion.p;
    return `Ты — моушн-дизайнер и работаешь в редакторе «Моушн» программы «Вектор». Делаешь анимационные ролики из кадров, картинок и текста на фоне цвета, фото или видео с компьютера пользователя.
Холст: ${P.w}×${P.h} пикселей, ${P.fps} к/с, длительность ${P.duration} с. Координаты слоя x,y — ЦЕНТР слоя в пикселях от левого верхнего угла; w,h — размер слоя при масштабе 1. Время — в секундах.
Слои: image (картинка/кадр), video, text, shape. Анимация — ключевые кадры свойств x, y, scale, rotation (градусы), opacity (0..1), blur (px), reveal (0..1, шторка слева направо), chars (0..1, печать текста) или готовые анимации (animate): ${Object.entries(Motion.PRESETS).map(([k, v]) => k + ' — ' + v).join('; ')}. Плавности: ${Motion.EASES.join(', ')}.

Порядок работы:
1. Посмотри проект (get_project) и материалы (list_materials, view_file для кадров) — пойми, что за продукт/сообщение и какие есть кадры.
2. Сначала коротко напиши ПЛАН АНИМАЦИИ: сцены по секундам, что появляется, как движется, переходы, где текст. Затем сразу делай.
3. Собирай: размер и длительность (set_canvas), фон (set_background — фото/видео из материалов или цвет), слои (add_layer), анимации (animate, set_keyframes). Кадры из нескольких картинок — по очереди с переходами (появление/выезд/шторка), не все сразу.
4. Хороший моушн: каждое появление с движением и плавностью (easeOut/backOut), паузы для чтения текста (≥1.5 с), акцент на главном, финальный кадр с логотипом/призывом держится ≥1.5 с. Текст крупный и контрастный, не у самых краёв (поля ≥6% кадра).
5. Проверяй: view_frames на ключевых моментах — ничего не обрезано, текст читается, нет пустых кадров. Исправляй.
6. Если нужны новые картинки или видео — generate_image / generate_video (модели Polza, это стоит денег — только когда просят или без этого не обойтись). Вырезать фон у кадра — remove_background.
7. Когда готово и пользователь просил файл — render (MP4) и save_project. Файлы сохраняются в папку для результата, если она прикреплена.
В конце коротко по-русски: что сделано, план по секундам и что проверить.`;
  },
  tools() {
    const T = Polza.tool, num = d => ({ type: 'number', description: d }), str = d => ({ type: 'string', description: d }), bool = d => ({ type: 'boolean', description: d });
    const layerP = { name: str('Имя слоя'), x: num('Центр X, px'), y: num('Центр Y, px'), w: num('Ширина, px'), h: num('Высота, px'), start: num('Появляется с секунды'), end: num('Исчезает на секунде'),
      scale: num('Масштаб'), rotation: num('Поворот, градусы'), opacity: num('Непрозрачность 0..1'), fit: { type: 'string', enum: ['contain', 'cover', 'stretch'] }, radius: num('Скругление углов, px'),
      text: str('Текст (\\n — перенос)'), font: str('Шрифт: Oswald, Bebas Neue, DINAMIKA, Arial или подключённый'), size: num('Кегль, px'), color: str('Цвет текста #rrggbb'), weight: num('Насыщенность 100..900'),
      align: { type: 'string', enum: ['left', 'center', 'right'] }, bg_color: str('Плашка под текстом #rrggbb или none'), shadow: bool('Тень текста'), fill: str('Цвет фигуры #rrggbb'), shape: { type: 'string', enum: ['rect', 'ellipse'] } };
    return [
      T('list_materials', 'Список прикреплённых материалов (папки и файлы с ролями).', { role: str('Роль') }),
      T('search_files', 'Поиск файлов в материалах по части имени или расширению.', { query: str('Часть имени или «.mp4»') }, ['query']),
      T('view_file', 'Посмотреть картинку или страницу документа из материалов.', { path: str('Путь файла'), page: num('Страница') }, ['path']),
      T('read_file', 'Прочитать текстовый файл, таблицу, документ из материалов.', { path: str('Путь файла') }, ['path']),
      T('get_project', 'Проект: размер, длительность, фон, слои с id, временем, свойствами и ключами.'),
      T('set_canvas', 'Размер кадра, частота и длительность ролика.', { w: num('Ширина, px'), h: num('Высота, px'), fps: num('Кадров в секунду'), duration: num('Длительность, с'), name: str('Название ролика') }),
      T('set_background', 'Фон ролика: цвет или фото/видео из материалов.', { color: str('Цвет #rrggbb'), path: str('Файл фото/видео из материалов'), fit: { type: 'string', enum: ['cover', 'contain'] }, dim: num('Затемнение 0..0.9'), zoom: num('Медленный наезд за ролик, 1..1.3'), start: num('Видео: начать с секунды'), audio: bool('Оставить звук видео') }),
      T('set_music', 'Музыка из материалов.', { path: str('Аудиофайл'), volume: num('Громкость 0..1'), start: num('Начать с секунды файла') }, ['path']),
      T('add_layer', 'Добавить слой. Для image/video — path файла из материалов (или asset_id). Возвращает id.', Object.assign({ type: { type: 'string', enum: ['image', 'video', 'text', 'shape'] }, path: str('Файл из материалов'), asset_id: str('id ресурса проекта'), loop: bool('Видео: зациклить'), audio: bool('Видео: со звуком') }, layerP), ['type']),
      T('update_layer', 'Изменить свойства слоя (значения «в покое»; если у свойства есть ключи — используй set_keyframes).', Object.assign({ id: str('id слоя'), visible: bool('Видимость') }, layerP), ['id']),
      T('animate', 'Готовая анимация слоя с времени start длительностью duration. Для *Out — start = когда начать уход.', { id: str('id слоя'), preset: { type: 'string', enum: Object.keys(Motion.PRESETS) }, start: num('Начало, с'), duration: num('Длительность, с'), direction: { type: 'string', enum: ['left', 'right', 'up', 'down'] }, distance: num('Расстояние, px'), intensity: num('Сила 0.3..3'), ease: { type: 'string', enum: Motion.EASES } }, ['id', 'preset', 'start']),
      T('set_keyframes', 'Ключевые кадры одного свойства (заменяют ключи этого свойства на отрезке их времён).', { id: str('id слоя'), prop: { type: 'string', enum: Motion.PROPS }, keys: { type: 'array', items: { type: 'object', properties: { t: num('Время, с'), v: num('Значение'), ease: { type: 'string', enum: Motion.EASES } }, required: ['t', 'v'] } }, replace_all: bool('Удалить все прежние ключи свойства') }, ['id', 'prop', 'keys']),
      T('clear_animation', 'Убрать ключи слоя (всех или одного свойства).', { id: str('id слоя'), prop: str('Свойство (необязательно)') }, ['id']),
      T('remove_layer', 'Удалить слой.', { id: str('id слоя') }, ['id']),
      T('reorder_layer', 'Порядок: index 0 — самый нижний.', { id: str('id слоя'), index: num('Новый индекс') }, ['id', 'index']),
      T('view_frames', 'Посмотреть кадры ролика в заданные моменты (лист превью) — проверить результат.', { times: { type: 'array', items: { type: 'number' }, description: 'Секунды, до 8 штук' } }, ['times']),
      T('remove_background', 'Вырезать фон у слоя-картинки (Polza).', { id: str('id слоя') }, ['id']),
      T('generate_image', 'Сгенерировать картинку моделью Polza (по описанию и референсам) и добавить ресурсом/слоем.', { prompt: str('Описание (лучше на английском)'), refs: { type: 'array', items: { type: 'string' }, description: 'Пути референсов в материалах или id слоёв' }, as_layer: bool('Сразу добавить слоем'), as_background: bool('Поставить фоном') }, ['prompt']),
      T('generate_video', 'Сгенерировать видео моделью Polza (долго и платно): из кадра ролика, слоя-картинки или файла.', { prompt: str('Описание движения (лучше на английском)'), from_time: num('Взять кадр ролика на этой секунде'), layer_id: str('Или слой-картинку'), path: str('Или файл из материалов'), duration: num('Длительность, с'), as_background: bool('Поставить фоном (иначе слоем)') }, ['prompt']),
      T('render', 'Сохранить ролик видеофайлом (в папку для результата, если прикреплена).', { format: { type: 'string', enum: ['mp4', 'webm'] }, name: str('Имя файла без расширения'), half_size: bool('Половинный размер (быстрее)') }),
      T('save_project', 'Сохранить проект .vkm со всеми ресурсами.', { name: str('Имя файла') }),
    ];
  },
  toolLabel(n, a) {
    return ({ list_materials: 'Смотрю материалы', search_files: 'Ищу файлы ' + (a.query || ''), view_file: 'Смотрю ' + (a.path || ''), read_file: 'Читаю ' + (a.path || ''), get_project: 'Изучаю проект',
      set_canvas: 'Настраиваю кадр', set_background: 'Фон' + (a.path ? ': ' + a.path : ''), set_music: 'Музыка', add_layer: 'Слой ' + (a.name || a.type), update_layer: 'Правлю слой', animate: 'Анимация ' + (Motion.PRESETS[a.preset] || a.preset) + ' с ' + a.start + ' с',
      set_keyframes: 'Ключи ' + (Motion.PROP_NAMES[a.prop] || a.prop), clear_animation: 'Убираю анимацию', remove_layer: 'Удаляю слой', reorder_layer: 'Порядок слоёв', view_frames: 'Смотрю кадры ' + (a.times || []).join(', '),
      remove_background: 'Вырезаю фон', generate_image: 'Генерирую картинку', generate_video: 'Генерирую видео (несколько минут)', render: 'Сохраняю ' + String(a.format || 'mp4').toUpperCase(), save_project: 'Сохраняю проект' })[n] || n;
  },
  describe() {
    const P = Motion.p, r = v => Math.round(v * 100) / 100;
    return {
      w: P.w, h: P.h, fps: P.fps, duration: P.duration, name: P.name,
      background: P.bg.type === 'color' ? { color: P.bg.color } : { type: P.bg.type, file: (Motion.assets[P.bg.asset] || {}).name, fit: P.bg.fit, dim: P.bg.dim, zoom: P.bg.zoom },
      music: P.audio ? (Motion.assets[P.audio.asset] || {}).name : null,
      assets: Object.values(Motion.assets).map(a => ({ id: a.id, name: a.name, kind: a.kind })),
      layers: P.layers.map((L, i) => {
        const o = { index: i, id: L.id, type: L.type, name: L.name, start: r(L.start), end: r(L.end), x: r(L.x), y: r(L.y), w: r(L.w), h: r(L.h), scale: r(L.scale), rotation: r(L.rotation), opacity: r(L.opacity) };
        if (L.asset) o.asset = (Motion.assets[L.asset] || {}).name;
        if (L.type === 'text') Object.assign(o, { text: L.text, font: L.font, size: r(L.size), color: L.color, bg_color: L.bgColor || undefined });
        if (L.type === 'shape') Object.assign(o, { fill: L.fill, shape: L.shape });
        const keys = {}; for (const [p, ks] of Object.entries(L.keys || {})) if (ks.length) keys[p] = ks.map(k => [r(k.t), r(k.v)]);
        if (Object.keys(keys).length) o.keys = keys;
        return o;
      }),
    };
  },
  async entryAsset(path) {
    const f = Agent.findFile(path);
    if (!f) throw new Error('Нет такого файла в материалах: ' + path);
    return Motion.assetFromEntry(f.entry);
  },
  setLayerProps(L, a) {
    const map = { bg_color: 'bgColor' };
    for (const [k, v] of Object.entries(a)) {
      if (['id', 'type', 'path', 'asset_id'].includes(k) || v === undefined) continue;
      const key = map[k] || k;
      if (key === 'bgColor') { L.bgColor = v && v !== 'none' ? v : null; continue; }
      if (Motion.PROPS.includes(key) && L.keys[key] && L.keys[key].length) {
        // у свойства есть ключи: сдвигаем всю траекторию (x/y) или задаём значение «в покое»
        if (key === 'x' || key === 'y') { const d = +v - L[key]; L.keys[key].forEach(q => { q.v += d; }); }
      }
      L[key] = typeof L[key] === 'number' && typeof v !== 'number' && isFinite(+v) ? +v : v;
    }
  },
  async exec(n, a) {
    const P = Motion.p;
    const need = id => { const L = Motion.layer(id); if (!L) throw new Error('Нет слоя ' + id); return L; };
    switch (n) {
      case 'list_materials': case 'search_files': case 'view_file': case 'read_file': return Agent.exec(n, a);
      case 'get_project': return Motion.describe();
      case 'set_canvas': {
        if (a.w && a.h && (a.w !== P.w || a.h !== P.h)) Motion.resize(+a.w, +a.h);
        if (a.fps) P.fps = +a.fps;
        if (a.duration) { const old = P.duration; P.duration = +a.duration; P.layers.forEach(L => { if (L.end >= old - 1e-3 || L.end > P.duration) L.end = P.duration; }); }
        if (a.name) P.name = a.name;
        Motion.commit(); return { w: P.w, h: P.h, fps: P.fps, duration: P.duration };
      }
      case 'set_background': {
        if (a.path) { const as = await Motion.entryAsset(a.path); P.bg.type = as.kind === 'video' ? 'video' : 'image'; P.bg.asset = as.id; }
        else if (a.color && !a.path && a.fit === undefined && a.dim === undefined) { P.bg.type = 'color'; P.bg.asset = null; }
        for (const k of ['color', 'fit', 'dim', 'zoom', 'start', 'audio']) if (a[k] !== undefined) P.bg[k] = a[k];
        Motion.commit(); return { ok: true, background: Motion.describe().background, video_duration: P.bg.type === 'video' ? Motion.assetDuration(P.bg.asset) : undefined };
      }
      case 'set_music': { const as = await Motion.entryAsset(a.path); P.audio = { asset: as.id, volume: a.volume ?? 1, start: a.start || 0 }; Motion.commit(); return { ok: true }; }
      case 'add_layer': {
        let props = {};
        if (a.type === 'image' || a.type === 'video') {
          const as = a.asset_id ? Motion.assets[a.asset_id] : await Motion.entryAsset(a.path || '');
          if (!as) throw new Error('Укажи path файла или asset_id');
          const el = Motion.mediaEl(as.id);
          const sw = (el && (el.naturalWidth || el.videoWidth)) || P.w, sh = (el && (el.naturalHeight || el.videoHeight)) || P.h;
          let w = a.w, hh = a.h;
          if (!w && !hh) { const k = Math.min(P.w * 0.8 / sw, P.h * 0.8 / sh); w = sw * k; hh = sh * k; }
          else if (w && !hh) hh = w * sh / sw; else if (hh && !w) w = hh * sw / sh;
          props = { asset: as.id, name: as.name.replace(/\.\w+$/, ''), w, h: hh, loop: a.loop, audio: a.audio };
        }
        const L = Motion.mkLayer(a.type, props);
        Motion.setLayerProps(L, Object.assign({}, a, { w: props.w || a.w, h: props.h || a.h }));
        if (L.end > P.duration) L.end = P.duration;
        Motion.addLayer(L, false);
        return { id: L.id, name: L.name, x: L.x, y: L.y, w: Math.round(L.w), h: Math.round(L.h), start: L.start, end: L.end };
      }
      case 'update_layer': { const L = need(a.id); Motion.setLayerProps(L, a); Motion.commit(); return { id: L.id, ok: true }; }
      case 'animate': { const L = need(a.id); Motion.applyPreset(L, a.preset, a.start, a.duration, a); Motion.commit(); return { id: L.id, keys: Object.keys(L.keys) }; }
      case 'set_keyframes': {
        const L = need(a.id), ks = (a.keys || []).map(k => ({ t: +k.t, v: +k.v, ease: k.ease || 'easeInOut' })).sort((x, y) => x.t - y.t);
        if (!ks.length) throw new Error('Нет ключей');
        if (a.replace_all) delete L.keys[a.prop]; else Motion.clearKeys(L, a.prop, ks[0].t, ks[ks.length - 1].t);
        for (const k of ks) Motion.setKey(L, a.prop, k.t, k.v, k.ease);
        Motion.commit(); return { id: L.id, prop: a.prop, count: L.keys[a.prop].length };
      }
      case 'clear_animation': { const L = need(a.id); if (a.prop) delete L.keys[a.prop]; else L.keys = {}; Motion.commit(); return { ok: true }; }
      case 'remove_layer': need(a.id); Motion.removeLayer(a.id); return { ok: true };
      case 'reorder_layer': {
        const L = need(a.id), arr = P.layers.filter(x => x !== L);
        arr.splice(Math.max(0, Math.min(arr.length, +a.index)), 0, L); P.layers = arr; Motion.commit(); return { ok: true };
      }
      case 'view_frames': {
        const times = (a.times || [0]).slice(0, 8).map(t => Math.max(0, Math.min(P.duration, +t)));
        const cols = Math.min(4, times.length), rows = Math.ceil(times.length / cols);
        const cell = 360, k = cell / Math.max(P.w, P.h), cw = Math.round(P.w * k), ch = Math.round(P.h * k);
        const sheet = document.createElement('canvas'); sheet.width = cols * cw + (cols + 1) * 6; sheet.height = rows * (ch + 22) + 6;
        const g = sheet.getContext('2d'); g.fillStyle = '#333'; g.fillRect(0, 0, sheet.width, sheet.height);
        for (let i = 0; i < times.length; i++) {
          const c = await Motion.frameCanvas(times[i], cell);
          const x = 6 + (i % cols) * (cw + 6), y = 6 + Math.floor(i / cols) * (ch + 22);
          g.drawImage(c, x, y, cw, ch);
          g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.fillText(times[i].toFixed(2) + ' с', x + 2, y + ch + 16);
        }
        Motion.seek(Motion.t);
        return { frames: times.length, _image: sheet.toDataURL('image/jpeg', 0.82), _caption: 'кадры ролика на ' + times.join(', ') + ' с' };
      }
      case 'remove_background': {
        const L = need(a.id), as = Motion.assets[L.asset]; if (!as || as.kind !== 'image') throw new Error('Это не картинка');
        const src = as.blob || await (await fetch(as.url)).blob();
        const out = await Polza.removeBackground(src);
        const na = await Motion.addAsset({ name: as.name.replace(/\.\w+$/, '') + '-без-фона.png', blob: out });
        L.asset = na.id; Motion.commit(); return { ok: true, asset_id: na.id };
      }
      case 'generate_image': {
        const refs = [];
        for (const r of a.refs || []) {
          const L = Motion.layer(r);
          if (L && Motion.assets[L.asset]) { const as = Motion.assets[L.asset]; refs.push(as.blob || await (await fetch(as.url)).blob()); continue; }
          const f = Agent.findFile(r); if (f) refs.push(await Host.blobOf(f.entry));
        }
        const blob = await Polza.generateImage(a.prompt, { images: refs });
        const as = await Motion.addAsset({ name: 'генерация.png', blob });
        let id;
        if (a.as_background) { P.bg.type = 'image'; P.bg.asset = as.id; Motion.commit(); }
        else if (a.as_layer) id = (await Motion.exec('add_layer', { type: 'image', asset_id: as.id })).id;
        return { asset_id: as.id, layer_id: id, _image: await Polza.thumb(blob, 768), _caption: 'сгенерированная картинка' };
      }
      case 'generate_video': {
        let image = null;
        if (a.layer_id) { const L = need(a.layer_id), as = Motion.assets[L.asset]; image = as.blob || await (await fetch(as.url)).blob(); }
        else if (a.path) { const f = Agent.findFile(a.path); if (!f) throw new Error('Нет файла ' + a.path); image = await Host.blobOf(f.entry); }
        else if (a.from_time !== undefined) image = await Motion.frameBlob(+a.from_time);
        const blob = await Polza.generateVideo(a.prompt, { image, params: a.duration ? { duration: a.duration } : {} });
        const as = await Motion.addAsset({ name: 'ИИ-видео.mp4', blob, kind: 'video' });
        let id;
        if (a.as_background) { P.bg.type = 'video'; P.bg.asset = as.id; Motion.commit(); }
        else id = (await Motion.exec('add_layer', { type: 'video', asset_id: as.id, fit: 'cover', w: P.w, h: P.h })).id;
        return { asset_id: as.id, layer_id: id, video_duration: Motion.assetDuration(as.id) };
      }
      case 'render': {
        const r = await Motion.render(a.format || 'mp4', { scale: a.half_size ? 0.5 : 1 });
        if (!r) throw new Error('Экспорт не удался');
        const name = (a.name || P.name || 'ролик') + '.' + (a.format || 'mp4');
        const saved = await Motion.saveBlob(r.blob, name, Agent.outputFolder());
        return { saved, size_mb: +(r.blob.size / 1048576).toFixed(2) };
      }
      case 'save_project': return { saved: await Motion.save(Agent.outputFolder(), a.name) };
      default: throw new Error('Нет инструмента ' + n);
    }
  },
};
