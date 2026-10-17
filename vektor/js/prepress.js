// Подготовка к печати: требования типографий (профили), вылеты и безопасные поля, проверка
// макета (CMYK, 100% чёрный, сумма красок, разрешение картинок, тонкие линии, текст в кривых,
// вылеты) с исправлением в один щелчок и выдача файла: PDF в CMYK с метками или CDR нужной версии.
// Здесь же — изменение формата документа и сжатие картинок.
'use strict';

const Prepress = {
  BUILTIN: [
    { id: 'offset', name: 'Офсетная типография (стандарт)', colorMode: 'CMYK', bleed: 2, safe: 3, minDpi: 300, tac: 300, black: 'text', richBlack: true, curves: true, minLine: 0.1, marks: true, format: 'pdf' },
    { id: 'digital', name: 'Цифровая печать', colorMode: 'CMYK', bleed: 2, safe: 3, minDpi: 300, tac: 320, black: 'text', richBlack: false, curves: true, minLine: 0.1, marks: true, format: 'pdf' },
    { id: 'cards', name: 'Визитки', colorMode: 'CMYK', bleed: 2, safe: 4, minDpi: 300, tac: 300, black: 'text', richBlack: false, curves: true, minLine: 0.15, marks: true, format: 'pdf' },
    { id: 'wide', name: 'Широкоформатная печать (баннеры)', colorMode: 'CMYK', bleed: 0, safe: 30, minDpi: 72, tac: 340, black: 'none', richBlack: true, curves: true, minLine: 1, marks: false, format: 'pdf' },
    { id: 'souvenir', name: 'Сувенирка: УФ, сублимация, шелкография', colorMode: 'CMYK', bleed: 0, safe: 2, minDpi: 300, tac: 300, black: 'all', richBlack: false, curves: true, minLine: 0.2, marks: false, format: 'cdr', cdrVersion: 17 },
    { id: 'corel', name: 'Типография принимает только CDR (X7)', colorMode: 'CMYK', bleed: 2, safe: 3, minDpi: 300, tac: 300, black: 'text', richBlack: false, curves: true, minLine: 0.1, marks: false, format: 'cdr', cdrVersion: 17 },
  ],
  BLACK: [['none', 'Не трогать чёрный'], ['text', 'Текст и тонкие линии — 100% K (C0 M0 Y0 K100)'], ['all', 'Весь чёрный — 100% K']],

  // ---------- профили ----------
  custom() { try { return JSON.parse(localStorage.getItem('vektor.printProfiles') || '[]'); } catch (e) { return []; } },
  saveCustom(list) { localStorage.setItem('vektor.printProfiles', JSON.stringify(list)); },
  profiles() { return [...Prepress.BUILTIN, ...Prepress.custom()]; },
  profile(id) { return Prepress.profiles().find(p => p.id === id) || Prepress.BUILTIN[0]; },
  // параметры печати страницы: документ + свои у страницы (из фрейма)
  pp(page = App.pg()) { return Object.assign({ bleed: 0, safe: 0 }, App.doc.print || {}, page.print || {}); },

  // ---------- вылеты, поля, фальцы на экране ----------
  renderMarks() {
    const g = document.getElementById('printMarks'); if (!g) return;
    const P = App.pg(), pp = Prepress.pp(P), z = App.zoom, out = [];
    const sw = 1 / z, dash = `${4 / z} ${3 / z}`;
    if (pp.bleed > 0) out.push(`<rect x="${-pp.bleed}" y="${-pp.bleed}" width="${P.w + pp.bleed * 2}" height="${P.h + pp.bleed * 2}" fill="none" stroke="#e5484d" stroke-width="${sw}" stroke-dasharray="${dash}"><title>Вылеты ${pp.bleed} мм</title></rect>`);
    if (pp.safe > 0 && P.w > pp.safe * 2 && P.h > pp.safe * 2) out.push(`<rect x="${pp.safe}" y="${pp.safe}" width="${P.w - pp.safe * 2}" height="${P.h - pp.safe * 2}" fill="none" stroke="#2f80ed" stroke-width="${sw}" stroke-dasharray="${dash}"><title>Безопасное поле ${pp.safe} мм</title></rect>`);
    for (const fd of P.folds || []) {
      if (fd.axis === 'v') out.push(`<line x1="${fd.pos}" y1="${-pp.bleed - 3}" x2="${fd.pos}" y2="${P.h + pp.bleed + 3}" stroke="#16a34a" stroke-width="${sw}" stroke-dasharray="${8 / z} ${3 / z} ${1 / z} ${3 / z}"><title>${fd.name || 'Фальц'}</title></line>`);
      else out.push(`<line x1="${-pp.bleed - 3}" y1="${fd.pos}" x2="${P.w + pp.bleed + 3}" y2="${fd.pos}" stroke="#16a34a" stroke-width="${sw}" stroke-dasharray="${8 / z} ${3 / z} ${1 / z} ${3 / z}"><title>${fd.name || 'Фальц'}</title></line>`);
    }
    for (const c of P.cuts || []) out.push(`<path d="${c}" fill="none" stroke="#d946ef" stroke-width="${sw}" stroke-dasharray="${dash}"><title>Контур реза</title></path>`);
    g.innerHTML = out.join('');
  },
  settingsDialog() {
    const d = App.doc.print || {}, P = App.pg();
    const prof = UI.sel(Prepress.profiles().map(p => [p.id, p.name]), d.profile || 'offset', v => { const p = Prepress.profile(v); bleed.value = p.bleed; safe.value = p.safe; }, '', 330);
    const bleed = h('input', { type: 'number', min: 0, max: 100, step: 0.5, value: d.bleed ?? 0 });
    const safe = h('input', { type: 'number', min: 0, max: 200, step: 0.5, value: d.safe ?? 0 });
    const mode = UI.sel([['RGB', 'RGB (экран, веб)'], ['CMYK', 'CMYK (печать)']], d.colorMode || 'RGB', () => { }, '', 200);
    const own = h('input', { type: 'checkbox', checked: !!P.print });
    UI.dialog('Параметры печати', h('div', { class: 'form' },
      h('label', {}, 'Требования типографии', prof),
      h('label', {}, 'Вылеты под обрез, мм (красная рамка)', bleed), h('label', {}, 'Безопасное поле от края, мм (синяя рамка)', safe),
      h('label', {}, 'Цветовой режим документа', mode),
      h('label', { class: 'chk' }, own, ' Свои вылеты и поля только у этой страницы'),
      h('p', { class: 'muted' }, 'Красная рамка — до куда тянуть фон. Синяя — ближе к краю не ставить текст и важное. Зелёные линии — фальцы.')),
    [{ label: 'Отмена' }, { label: 'Готово', primary: true, action: () => {
      const vals = { bleed: +bleed.value || 0, safe: +safe.value || 0 };
      if (own.checked) P.print = vals; else { delete P.print; App.doc.print = Object.assign({}, App.doc.print, vals); }
      App.doc.print = Object.assign({}, App.doc.print, { profile: prof.value, colorMode: mode.value });
      if (mode.value === 'CMYK' && (d.colorMode || 'RGB') !== 'CMYK') Prepress.fixCMYK(App.doc.pages);
      App.commit('Параметры печати'); UI.refresh();
    } }]);
  },

  // ---------- проверка ----------
  leaves(page) {
    const out = [];
    const walk = (o, pm, inClip) => {
      if (!o.visible) return;
      const m = Mx.mul(pm, o.m || Mx.id());
      if (o.type === 'group' || o.type === 'blend') { o.children.forEach(c => walk(c, m)); return; }
      if (o.type === 'powerclip') { out.push({ o: o.container, pm: m }); o.children.forEach(c => walk(c, m, true)); return; }
      out.push({ o, pm, inClip });
    };
    for (const L of page.layers) if (L.visible && !L.noPrint) L.objects.forEach(o => walk(o, Mx.id()));
    return out;
  },
  isBlack(hex) { const v = CMYK.of(hex); const { r, g, b } = Color.hexToRgb(hex); return (r + g + b) / 3 < 40 || v[3] > 85 && v[0] + v[1] + v[2] > 40 || v[3] > 95; },
  isK100(hex) { const v = CMYK.of(hex); return v[0] < 0.5 && v[1] < 0.5 && v[2] < 0.5 && v[3] > 99.5; },
  tacOf(hex) { const v = CMYK.of(hex); return v[0] + v[1] + v[2] + v[3]; },
  thin(o) { const b = Model.localBox(o); return Math.min(b.x2 - b.x1, b.y2 - b.y1) < 1.5; },
  scaleOf(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; },
  check(prof, pages = App.doc.pages) {
    const issues = [];
    const add = (id, level, text, fix, objs = []) => { let it = issues.find(x => x.id === id); if (!it) issues.push(it = { id, level, text, fix, count: 0, objs: [] }); it.count++; it.objs.push(...objs); };
    pages.forEach((P, pi) => {
      const pp = Object.assign({}, prof, { bleed: Prepress.pp(P).bleed || prof.bleed, safe: Prepress.pp(P).safe || prof.safe });
      for (const { o, pm, inClip } of Prepress.leaves(P)) {
        const wm = Mx.mul(pm, o.m || Mx.id());
        const b = Model.worldBox(o, pm);
        // цвет
        CMYK.paints(o, (paint, key) => {
          const hex = paint[key];
          if (prof.colorMode === 'CMYK' && !CMYK.exact(hex)) add('rgb', 'warn', 'Цвета заданы в RGB — будут переведены в CMYK', 'cmyk', [o]);
          if (prof.black !== 'none' && Prepress.isBlack(hex) && !Prepress.isK100(hex) && (prof.black === 'all' || o.type === 'text' || paint === o.stroke || Prepress.thin(o))) add('black', 'error', prof.black === 'all' ? 'Чёрный не 100% K' : 'Чёрный текст и тонкие линии не 100% K — на печати дадут «бахрому»', 'black', [o]);
          if (prof.tac && Prepress.tacOf(hex) > prof.tac + 0.5) add('tac', 'error', `Сумма красок больше ${prof.tac}% — краска не высохнет`, 'tac', [o]);
        });
        // картинки: эффективное разрешение
        if (o.type === 'image' && o.natW) {
          const wmm = o.w * Prepress.scaleOf(wm), dpi = o.natW / (wmm / 25.4);
          if (dpi < prof.minDpi - 1) add('dpi', dpi < prof.minDpi * 0.6 ? 'error' : 'warn', `Картинки с разрешением ниже ${prof.minDpi} dpi (есть ${Math.round(dpi)})`, null, [o]);
        }
        if (o.type === 'text' && prof.curves) add('text', 'warn', 'Текст не в кривых — типография может подставить другой шрифт', 'curves', [o]);
        if (o.stroke && o.stroke.color && o.stroke.width > 0 && o.stroke.width * Prepress.scaleOf(wm) < prof.minLine - 1e-6) add('line', 'warn', `Линии тоньше ${prof.minLine} мм могут не пропечататься`, 'line', [o]);
        if (o.shadow) add('shadow', 'info', 'Тени в PDF для печати не попадают — переведите их в картинку или уберите', null, [o]);
        if (!G.boxValid(b)) continue;
        // вылеты: фон у края должен заходить за обрез
        if (pp.bleed > 0 && !inClip && o.fill && o.fill.type !== 'none') {
          const tol = 0.6, need = pp.bleed - 0.05;
          const touches = [b.x1 <= tol && b.x1 > -need, b.y1 <= tol && b.y1 > -need, b.x2 >= P.w - tol && b.x2 < P.w + need, b.y2 >= P.h - tol && b.y2 < P.h + need];
          if (touches.some(Boolean) && (b.x2 - b.x1 > P.w * 0.3 || b.y2 - b.y1 > P.h * 0.3)) add('bleed', 'error', `Фон у края не заходит на вылеты ${pp.bleed} мм — после реза останется белая полоса`, 'bleed', [o]);
        }
        // безопасное поле: текст у края
        if (pp.safe > 0 && (o.type === 'text' || (b.x2 - b.x1 < P.w * 0.5 && b.y2 - b.y1 < P.h * 0.5 && o.type !== 'image'))) {
          const s = pp.safe, inside = b.x1 >= 0 && b.y1 >= 0 && b.x2 <= P.w && b.y2 <= P.h;
          if (inside && (b.x1 < s - 0.05 || b.y1 < s - 0.05 || b.x2 > P.w - s + 0.05 || b.y2 > P.h - s + 0.05)) add('safe', 'warn', `Текст или элементы ближе ${s} мм к краю — могут срезаться`, null, [o]);
        }
      }
      if (P.color && P.color.toLowerCase() !== '#ffffff') CMYK.paints({ fill: { type: 'solid', color: P.color } }, (p, k) => { if (prof.colorMode === 'CMYK' && !CMYK.exact(p[k])) add('rgb', 'warn', 'Цвета заданы в RGB — будут переведены в CMYK', 'cmyk'); });
      if (pp.bleed > 0 && P.color && P.color.toLowerCase() !== '#ffffff') { /* фон страницы сам уходит на вылеты при выводе */ }
    });
    return issues;
  },
  // размеры картинок (нужны для разрешения) — из href
  async measureImages(pages) {
    const imgs = [];
    for (const P of pages) Model.walkDoc({ pages: [P] }, o => { if (o.type === 'image' && !o.natW) imgs.push(o); });
    for (const o of imgs) { try { const im = await Polza.loadImage(o.href); o.natW = im.naturalWidth; o.natH = im.naturalHeight; } catch (e) { } }
  },

  // ---------- исправления ----------
  eachPaint(pages, cb) {
    for (const P of pages) Model.walkDoc({ pages: [P] }, o => {
      if (o.type === 'powerclip' && o.container) CMYK.paints(o.container, (p, k) => cb(p, k, o.container));
      CMYK.paints(o, (p, k) => cb(p, k, o));
    });
  },
  setCmyk(paint, key, v) { const hex = Color.fromCmyk(...v); paint[key] = hex; },
  fixCMYK(pages = App.doc.pages) {
    let n = 0;
    Prepress.eachPaint(pages, (p, k) => { if (!CMYK.exact(p[k])) { Prepress.setCmyk(p, k, CMYK.of(p[k])); n++; } });
    for (const P of pages) if (P.color && !CMYK.exact(P.color)) { P.color = Color.fromCmyk(...CMYK.of(P.color)); n++; }
    return n;
  },
  fixBlack(prof, pages = App.doc.pages) {
    let n = 0;
    Prepress.eachPaint(pages, (p, k, o) => {
      const hex = p[k];
      if (!Prepress.isBlack(hex) || Prepress.isK100(hex)) return;
      if (prof.black === 'all' || o.type === 'text' || p === o.stroke || Prepress.thin(o)) { Prepress.setCmyk(p, k, [0, 0, 0, 100]); n++; }
      else if (prof.richBlack && o.fill === p) { Prepress.setCmyk(p, k, [60, 40, 40, 100]); n++; } // крупные чёрные плашки — глубокий составной
    });
    return n;
  },
  fixTAC(limit, pages = App.doc.pages) {
    let n = 0;
    Prepress.eachPaint(pages, (p, k) => {
      const v = CMYK.of(p[k]), sum = v[0] + v[1] + v[2] + v[3];
      if (sum <= limit + 0.5) return;
      const cmy = v[0] + v[1] + v[2], keep = Math.max(0, limit - v[3]), s = cmy > 0 ? keep / cmy : 0;
      Prepress.setCmyk(p, k, [v[0] * s, v[1] * s, v[2] * s, v[3]].map(x => Math.floor(x))); n++;
    });
    return n;
  },
  fixLines(min, pages = App.doc.pages) {
    let n = 0;
    for (const P of pages) for (const { o, pm } of Prepress.leaves(P)) {
      const s = o.stroke; if (!s || !s.color || !(s.width > 0)) continue;
      const k = Prepress.scaleOf(Mx.mul(pm, o.m || Mx.id()));
      if (s.width * k < min) { s.width = min / k; n++; }
    }
    return n;
  },
  async fixCurves(pages = App.doc.pages) {
    let n = 0;
    const texts = [];
    for (const P of pages) Model.walkDoc({ pages: [P] }, o => { if (o.type === 'text') texts.push(o); });
    for (const t of texts) { try { await Fonts.otf(t.font, t.bold, t.italic); } catch (e) { } }
    const conv = list => list.forEach((o, i) => {
      if (o.type === 'text') { const c = Model.toCurves(o); if (c) { list[i] = c; n++; } }
      else if (o.children) conv(o.children);
    });
    for (const P of pages) for (const L of P.layers) conv(L.objects);
    return n;
  },
  // фон у края — дотянуть до вылетов
  fixBleed(pages = App.doc.pages) {
    let n = 0;
    for (const P of pages) {
      const bl = Prepress.pp(P).bleed; if (!(bl > 0)) continue;
      for (const L of P.layers) for (const o of L.objects) {
        if (!o.visible || o.locked) continue;
        const b = Model.worldBox(o); if (!G.boxValid(b)) continue;
        if (!(b.x2 - b.x1 > P.w * 0.3 || b.y2 - b.y1 > P.h * 0.3)) continue;
        const tol = 0.6;
        const ext = { l: b.x1 <= tol && b.x1 > -bl, t: b.y1 <= tol && b.y1 > -bl, r: b.x2 >= P.w - tol && b.x2 < P.w + bl, b: b.y2 >= P.h - tol && b.y2 < P.h + bl };
        if (!Object.values(ext).some(Boolean)) continue;
        const nb = { x1: ext.l ? -bl : b.x1, y1: ext.t ? -bl : b.y1, x2: ext.r ? P.w + bl : b.x2, y2: ext.b ? P.h + bl : b.y2 };
        const axisAligned = Math.abs(o.m[1]) < 1e-6 && Math.abs(o.m[2]) < 1e-6;
        if ((o.type === 'rect' || o.type === 'path' || o.type === 'polygon' || o.type === 'ellipse' || o.type === 'group' || o.type === 'powerclip') && axisAligned) {
          // растягиваем по осям только в сторону вылетов
          const sx = (nb.x2 - nb.x1) / (b.x2 - b.x1), sy = (nb.y2 - nb.y1) / (b.y2 - b.y1);
          Model.applyT(o, Mx.mul(Mx.translate(nb.x1, nb.y1), Mx.mul(Mx.scale(sx, sy), Mx.translate(-b.x1, -b.y1))));
          n++;
        } else if (o.type === 'image') {
          // фото — пропорционально, чтобы не исказить
          const s = Math.max((nb.x2 - nb.x1) / (b.x2 - b.x1), (nb.y2 - nb.y1) / (b.y2 - b.y1));
          const cx = (ext.l && !ext.r) ? b.x2 : (ext.r && !ext.l) ? b.x1 : (b.x1 + b.x2) / 2, cy = (ext.t && !ext.b) ? b.y2 : (ext.b && !ext.t) ? b.y1 : (b.y1 + b.y2) / 2;
          Model.applyT(o, Mx.mul(Mx.translate(cx, cy), Mx.mul(Mx.scale(s, s), Mx.translate(-cx, -cy))));
          n++;
        }
      }
    }
    return n;
  },
  async fix(kind, prof, pages = App.doc.pages) {
    switch (kind) {
      case 'cmyk': return Prepress.fixCMYK(pages);
      case 'black': return Prepress.fixBlack(prof, pages);
      case 'tac': return Prepress.fixTAC(prof.tac, pages);
      case 'line': return Prepress.fixLines(prof.minLine, pages);
      case 'curves': return Prepress.fixCurves(pages);
      case 'bleed': return Prepress.fixBleed(pages);
    }
    return 0;
  },

  // ---------- окно «Подготовка к печати» ----------
  async dialog() {
    const doc = App.doc;
    let prof = Prepress.profile((doc.print || {}).profile);
    const box = h('div', { class: 'form pp-dlg' });
    const profSel = UI.sel(Prepress.profiles().map(p => [p.id, p.name]), prof.id, v => { prof = Prepress.profile(v); render(); }, '', 360);
    const scope = UI.sel([['all', 'Все страницы'], ['page', 'Текущая страница']], 'all', () => render(), '', 160);
    const list = h('div', { class: 'pp-list' });
    const summary = h('div', { class: 'pp-sum' });
    const pages = () => scope.value === 'page' ? [App.pg()] : doc.pages;
    const render = async () => {
      await Prepress.measureImages(pages());
      const issues = Prepress.check(prof, pages());
      list.innerHTML = '';
      const icon = { error: '⛔', warn: '⚠', info: 'ℹ' };
      if (!issues.length) list.append(h('div', { class: 'pp-ok' }, '✓ Макет соответствует требованиям «' + prof.name + '»'));
      for (const it of issues) {
        list.append(h('div', { class: 'pp-it ' + it.level }, h('span', {}, icon[it.level]), h('span', { class: 'grow' }, it.text, h('span', { class: 'muted' }, ` (${it.count})`)),
          h('button', { class: 'pbt', title: 'Выделить эти объекты', onclick: () => { const ids = [...new Set(it.objs.map(o => o.id))].filter(id => Model.get(id)); if (ids.length) { App.sel = ids; UI.refresh(); } } }, 'Показать'),
          it.fix ? h('button', { class: 'pbt', onclick: async () => { const n = await Prepress.fix(it.fix, prof, pages()); App.commit('Подготовка: ' + it.id); UI.refresh(); UI.toast('Исправлено: ' + n); render(); } }, 'Исправить') : ''));
      }
      const pp = Prepress.pp();
      summary.textContent = `Цвет: ${prof.colorMode} · вылеты ${pp.bleed || prof.bleed} мм · поле ${pp.safe || prof.safe} мм · картинки от ${prof.minDpi} dpi · сумма красок до ${prof.tac}% · ${Prepress.BLACK.find(b => b[0] === prof.black)[1]}`;
    };
    UI.dialog('Подготовка к печати', h('div', {},
      h('div', { class: 'row' }, h('span', {}, 'Требования:'), profSel, scope,
        h('button', { class: 'pbt', onclick: () => Prepress.profileDialog(prof, p => { prof = p; profSel.replaceWith(Prepress.profileSelect(p.id, v => { prof = Prepress.profile(v); render(); })); render(); }) }, 'Свои требования…')),
      summary, list,
      h('p', { class: 'muted' }, 'Красная рамка на странице — вылеты, синяя — безопасное поле (Макет → Параметры печати).')),
    [{ label: 'Закрыть' },
      { label: 'Исправить всё', action: () => { Prepress.fixAll(prof, pages()).then(() => render()); return false; } },
      { label: 'Подготовить и сохранить…', primary: true, action: () => { Prepress.prepareAndSave(prof); } }]);
    render();
  },
  profileSelect(val, set) { return UI.sel(Prepress.profiles().map(p => [p.id, p.name]), val, set, '', 360); },
  async fixAll(prof, pages = App.doc.pages, silent = false) {
    const log = [];
    if (prof.colorMode === 'CMYK') log.push(['CMYK', Prepress.fixCMYK(pages)]);
    if (prof.curves) log.push(['кривые', await Prepress.fixCurves(pages)]);
    if (prof.black !== 'none') log.push(['чёрный', Prepress.fixBlack(prof, pages)]);
    if (prof.tac) log.push(['сумма красок', Prepress.fixTAC(prof.tac, pages)]);
    log.push(['линии', Prepress.fixLines(prof.minLine, pages)]);
    // вылеты из профиля, если в документе не заданы
    if (!(App.doc.print && App.doc.print.bleed > 0) && prof.bleed > 0) App.doc.print = Object.assign({}, App.doc.print, { bleed: prof.bleed, safe: prof.safe });
    log.push(['вылеты', Prepress.fixBleed(pages)]);
    App.doc.print = Object.assign({}, App.doc.print, { profile: prof.id, colorMode: prof.colorMode });
    if (silent) return log;
    App.commit('Подготовка к печати'); UI.refresh();
    UI.toast('Исправлено: ' + log.filter(x => x[1]).map(x => `${x[0]} ${x[1]}`).join(', ') || 'нечего');
    return log;
  },
  async prepareAndSave(prof) {
    await Prepress.measureImages(App.doc.pages);
    await Prepress.fixAll(prof);
    if (prof.format === 'cdr') return IO.exportCDR(prof.cdrVersion || 17, { cmyk: prof.colorMode === 'CMYK' });
    return Prepress.exportPDF({ cmyk: prof.colorMode === 'CMYK', marks: prof.marks, bleed: Prepress.pp().bleed || prof.bleed });
  },
  async exportPDF(opt = {}, pages = App.doc.pages, folder) {
    UI.busy('Собираю PDF…');
    try {
      const bytes = await PDFWriter.build(pages, Object.assign({ title: App.doc.name, overprintBlack: true }, opt));
      const name = IO.baseName() + (opt.cmyk ? '-CMYK' : '') + '.pdf';
      UI.busy(null);
      const r = folder ? await Host.writeToFolder(folder, name, bytes) : await Host.saveFile(name, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf');
      if (r) UI.toast('PDF готов: ' + (opt.cmyk ? 'CMYK' : 'RGB') + (opt.bleed ? `, вылеты ${opt.bleed} мм` : '') + (opt.marks ? ', метки реза' : ''));
      return r;
    } catch (e) { console.error(e); UI.toast('PDF не собран: ' + (e.message || e), true); }
    finally { UI.busy(null); }
  },
  profileDialog(base, done) {
    const p = Object.assign({}, base, { id: base.builtin === false ? base.id : 'u' + Date.now().toString(36), name: base.id.startsWith('u') ? base.name : base.name + ' (копия)' });
    const F = {};
    const num = (k, l, step = 1) => h('label', {}, l, F[k] = h('input', { type: 'number', step, value: p[k] }));
    F.name = h('input', { type: 'text', class: 'wide', value: p.name });
    F.colorMode = UI.sel([['CMYK', 'CMYK'], ['RGB', 'RGB']], p.colorMode, () => { });
    F.black = UI.sel(Prepress.BLACK, p.black, () => { }, '', 360);
    F.richBlack = h('input', { type: 'checkbox', checked: p.richBlack });
    F.curves = h('input', { type: 'checkbox', checked: p.curves });
    F.marks = h('input', { type: 'checkbox', checked: p.marks });
    F.format = UI.sel([['pdf', 'PDF'], ['cdr', 'CDR (CorelDRAW)']], p.format, () => { });
    F.cdrVersion = UI.sel(CDR_VERSIONS, p.cdrVersion || 17, () => { }, '', 220);
    UI.dialog('Требования типографии', h('div', { class: 'form' },
      h('label', {}, 'Название (например, «Типография Принт-Экспресс»)', F.name), h('label', {}, 'Цвет', F.colorMode),
      num('bleed', 'Вылеты, мм', 0.5), num('safe', 'Безопасное поле, мм', 0.5), num('minDpi', 'Минимальное разрешение картинок, dpi'), num('tac', 'Сумма красок не более, %'),
      h('label', {}, 'Чёрный', F.black), h('label', { class: 'chk' }, F.richBlack, ' Крупные чёрные плашки — глубокий составной (C60 M40 Y40 K100)'),
      h('label', { class: 'chk' }, F.curves, ' Текст переводить в кривые'), num('minLine', 'Минимальная толщина линии, мм', 0.05),
      h('label', {}, 'Формат файла', F.format), h('label', {}, 'Версия CorelDRAW', F.cdrVersion), h('label', { class: 'chk' }, F.marks, ' Метки реза в PDF')),
    [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: () => {
      const q = { id: p.id, name: F.name.value.trim() || 'Мои требования', colorMode: F.colorMode.value, black: F.black.value, richBlack: F.richBlack.checked, curves: F.curves.checked, marks: F.marks.checked, format: F.format.value, cdrVersion: +F.cdrVersion.value };
      for (const k of ['bleed', 'safe', 'minDpi', 'tac', 'minLine']) q[k] = +F[k].value || 0;
      const list = Prepress.custom().filter(x => x.id !== q.id); list.push(q); Prepress.saveCustom(list);
      App.doc.print = Object.assign({}, App.doc.print, { profile: q.id });
      done && done(q);
    } }]);
  },

  // ---------- формат документа: увеличить, расширить, сменить ----------
  resizeDialog() {
    const P = App.pg();
    const w = h('input', { type: 'number', step: 'any', value: P.w }), hh = h('input', { type: 'number', step: 'any', value: P.h });
    const preset = UI.sel([['', '— формат —'], ...PAGE_SIZES.map(s => [s[0], `${s[0]} (${s[1]}×${s[2]} мм)`])], '', v => { const s = PAGE_SIZES.find(x => x[0] === v); if (s) { w.value = s[1]; hh.value = s[2]; } }, '', 260);
    const mode = UI.sel([['scale', 'Масштабировать содержимое (A4 → A3 и т. п.)'], ['fit', 'Вписать содержимое, сохранив пропорции'], ['extend', 'Расширить холст, содержимое не трогать']], 'scale', () => { }, '', 360);
    const anchor = UI.sel([['c', 'по центру'], ['tl', 'от левого верхнего угла'], ['t', 'сверху'], ['b', 'снизу'], ['l', 'слева'], ['r', 'справа']], 'c', () => { }, '', 200);
    const all = h('input', { type: 'checkbox', checked: App.doc.pages.length > 1 });
    const pct = h('input', { type: 'number', value: 100, min: 1, step: 'any', oninput: () => { w.value = G.round(P.w * pct.value / 100, 2); hh.value = G.round(P.h * pct.value / 100, 2); } });
    UI.dialog('Изменить размер макета', h('div', { class: 'form' },
      preset, h('div', { class: 'row' }, h('label', {}, 'Ширина, мм', w), h('label', {}, 'Высота, мм', hh), h('label', {}, 'или %', pct)),
      h('label', {}, 'Что делать с содержимым', mode), h('label', {}, 'Привязка при расширении', anchor),
      h('label', { class: 'chk' }, all, ' Для всех страниц'),
      h('p', { class: 'muted' }, 'Масштаб увеличивает или уменьшает весь макет вместе с текстом, линиями и вылетами. Для фото, которым не хватает разрешения, используйте ИИ → Увеличить.')),
    [{ label: 'Отмена' }, { label: 'Применить', primary: true, action: () => {
      const W2 = +w.value, H2 = +hh.value; if (!(W2 > 0 && H2 > 0)) return false;
      for (const pg of all.checked ? App.doc.pages : [P]) Prepress.resizePage(pg, W2, H2, mode.value, anchor.value);
      App.commit('Размер макета'); App.zoomPage(); UI.refresh();
    } }]);
  },
  resizePage(P, W2, H2, mode, anchor = 'c') {
    let T;
    if (mode === 'extend') {
      const dx = { c: (W2 - P.w) / 2, tl: 0, t: (W2 - P.w) / 2, b: (W2 - P.w) / 2, l: 0, r: W2 - P.w }[anchor];
      const dy = { c: (H2 - P.h) / 2, tl: 0, t: 0, b: H2 - P.h, l: (H2 - P.h) / 2, r: (H2 - P.h) / 2 }[anchor];
      T = Mx.translate(dx, dy);
    } else if (mode === 'fit') {
      const k = Math.min(W2 / P.w, H2 / P.h);
      T = Mx.mul(Mx.translate((W2 - P.w * k) / 2, (H2 - P.h * k) / 2), Mx.scale(k, k));
    } else {
      // масштаб содержимого; при разных пропорциях — по меньшей стороне и центрирование
      const k = Math.min(W2 / P.w, H2 / P.h);
      T = Mx.mul(Mx.translate((W2 - P.w * k) / 2, (H2 - P.h * k) / 2), Mx.scale(k, k));
    }
    const k = Prepress.scaleOf(T);
    const scaleExtra = o => {
      // толщины линий, кегль и скругления масштабируются вместе с макетом
      if (mode === 'extend') return;
      for (const l of Model.leaves(o)) { if (l.stroke && l.stroke.width) l.stroke.width *= k; }
    };
    for (const L of P.layers) for (const o of L.objects) { Model.applyT(o, T); scaleExtra(o); }
    for (const f of P.folds || []) f.pos = f.axis === 'v' ? f.pos * (mode === 'extend' ? 1 : k) + T[4] : f.pos * (mode === 'extend' ? 1 : k) + T[5];
    P.w = W2; P.h = H2;
  },

  // ---------- сжатие картинок ----------
  compressDialog() {
    const dpi = UI.sel([[300, '300 dpi — печать (рекомендуется)'], [200, '200 dpi — крупная печать, плакаты'], [150, '150 dpi — презентации, PDF для экрана'], [96, '96 dpi — веб, почта'], [72, '72 dpi — минимум']], 300, () => { }, '', 300);
    const q = UI.sel([[0.92, 'Качество высокое (JPEG 92)'], [0.85, 'Качество хорошее (JPEG 85) — незаметно глазу'], [0.75, 'Компактно (JPEG 75)']], 0.85, () => { }, '', 300);
    const crop = h('input', { type: 'checkbox', checked: true });
    const scope = UI.sel([['all', 'Все страницы'], ['page', 'Текущая страница'], ['sel', 'Выделенные картинки']], App.sel.length ? 'sel' : 'all', () => { }, '', 200);
    UI.dialog('Сжать картинки', h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'Картинки уменьшаются до нужного разрешения при их размере в макете и пересохраняются с качеством, на котором разницы не видно. Прозрачные остаются PNG. Увеличивать картинки сжатие не будет.'),
      h('label', {}, 'Разрешение', dpi), h('label', {}, 'Качество', q), h('label', {}, 'Где', scope), h('label', { class: 'chk' }, crop, ' Обрезать невидимые части фото в PowerClip')),
    [{ label: 'Отмена' }, { label: 'Сжать', primary: true, action: () => { Prepress.compress({ dpi: +dpi.value, quality: +q.value, scope: scope.value, crop: crop.checked }); } }]);
  },
  async compress({ dpi = 300, quality = 0.85, scope = 'all', crop = true } = {}) {
    const jobs = [];
    const pages = scope === 'page' ? [App.pg()] : App.doc.pages;
    const sel = new Set(App.sel);
    const walk = (o, pm, clip, top) => {
      const m = Mx.mul(pm, o.m || Mx.id());
      if (o.type === 'group' || o.type === 'blend') o.children.forEach(c => walk(c, m, clip, top));
      else if (o.type === 'powerclip') { const cb = Model.worldBox(o.container, m); o.children.forEach(c => walk(c, m, crop ? cb : clip, top)); }
      else if (o.type === 'image' && (scope !== 'sel' || sel.has(top.id) || sel.has(o.id))) jobs.push({ o, wm: m, clip });
    };
    for (const P of pages) for (const L of P.layers) for (const o of L.objects) walk(o, Mx.id(), null, o);
    if (!jobs.length) return UI.toast('Картинок нет');
    let before = 0, after = 0, done = 0;
    UI.busy('Сжимаю картинки…');
    try {
      for (const { o, wm, clip } of jobs) {
        UI.busy(`Сжимаю картинки… ${++done} из ${jobs.length}`);
        const img = await Polza.loadImage(o.href);
        const W0 = img.naturalWidth, H0 = img.naturalHeight;
        before += o.href.length * 0.75;
        // видимая часть (для PowerClip) в долях картинки
        let fx1 = 0, fy1 = 0, fx2 = 1, fy2 = 1;
        if (clip) {
          const inv = Mx.inv(wm);
          const pts = [[clip.x1, clip.y1], [clip.x2, clip.y1], [clip.x1, clip.y2], [clip.x2, clip.y2]].map(([x, y]) => Mx.apply(inv, x, y));
          fx1 = Math.max(0, Math.min(...pts.map(p => p.x)) / o.w); fx2 = Math.min(1, Math.max(...pts.map(p => p.x)) / o.w);
          fy1 = Math.max(0, Math.min(...pts.map(p => p.y)) / o.h); fy2 = Math.min(1, Math.max(...pts.map(p => p.y)) / o.h);
          if (fx2 <= fx1 || fy2 <= fy1) { fx1 = fy1 = 0; fx2 = fy2 = 1; }
        }
        const sc = Prepress.scaleOf(wm);
        const wmm = o.w * sc * (fx2 - fx1), hmm = o.h * sc * (fy2 - fy1);
        const tw = Math.min(W0 * (fx2 - fx1), Math.round(wmm / 25.4 * dpi)), th = Math.min(H0 * (fy2 - fy1), Math.round(hmm / 25.4 * dpi));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(tw)); c.height = Math.max(1, Math.round(th));
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(img, fx1 * W0, fy1 * H0, (fx2 - fx1) * W0, (fy2 - fy1) * H0, 0, 0, c.width, c.height);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        let alpha = false; for (let i = 3; i < px.length; i += 16) if (px[i] < 250) { alpha = true; break; }
        const url = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality);
        if (url.length < o.href.length) {
          // кадрирование меняет размеры и положение картинки
          if (fx1 > 0 || fy1 > 0 || fx2 < 1 || fy2 < 1) { o.m = Mx.mul(o.m, Mx.translate(fx1 * o.w, fy1 * o.h)); o.w *= fx2 - fx1; o.h *= fy2 - fy1; }
          o.href = url; o.natW = c.width; o.natH = c.height;
        }
        after += o.href.length * 0.75;
      }
    } finally { UI.busy(null); }
    App.commit('Сжатие картинок'); UI.refresh();
    const mb = v => (v / 1048576).toFixed(1) + ' МБ';
    UI.toast(`Картинки: ${mb(before)} → ${mb(after)} (−${Math.max(0, Math.round((1 - after / Math.max(1, before)) * 100))}%)`, true);
    return { before, after };
  },
};
