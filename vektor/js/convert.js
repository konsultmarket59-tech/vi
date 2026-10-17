// Конвертер: один файл — в любой формат. Открывает CDR (любой версии), PDF, AI, SVG, FIG,
// PSD, PNG/JPG/WEBP, VKT и сохраняет в CDR нужной версии, PDF (CMYK для типографии или RGB),
// AI, SVG, PSD (объекты слоями), FIG (Figma), PNG, JPG, WEBP, VKT. Пакетно — для папки файлов.
'use strict';

const Convert = {
  OUT: [
    ['cdr', 'CDR — CorelDRAW (выбранная версия)'], ['pdfx', 'PDF для типографии (CMYK, вылеты, метки)'], ['pdfv', 'PDF векторный (RGB)'], ['ai', 'AI — Illustrator (PDF-совместимый)'],
    ['svg', 'SVG'], ['psd', 'PSD — Photoshop (объекты слоями)'], ['fig', 'FIG — Figma'], ['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP'], ['vkt', 'VKT — Вектор'],
  ],
  IN: '.cdr,.cdt,.pdf,.ai,.svg,.fig,.psd,.png,.jpg,.jpeg,.webp,.vkt',
  exportFormats() { return [['psd', 'PSD — Photoshop (объекты слоями)'], ['fig', 'FIG — Figma (через встроенную «Фигму»)'], ['webp', 'WEBP — растр, лёгкий']]; },
  handles(f) { return ['psd', 'fig', 'webp'].includes(f); },
  describe(f) {
    return { psd: 'Каждый объект верхнего уровня — отдельный слой с прозрачностью, на нужном месте; фон страницы — нижним слоем. Текст — растром.', fig: 'Страницы становятся кадрами в файле Figma — открывается в Figma и в «Фигме».', webp: 'Как PNG/JPG, но заметно легче.' }[f];
  },

  // ---------- документ → форматы ----------
  async psdBytes(page, dpi = 300) {
    const lib = await Host.lib('psd');
    const k = dpi / 25.4, W = Math.round(page.w * k), H = Math.round(page.h * k);
    const children = [];
    if (page.color) { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = page.color; g.fillRect(0, 0, W, H); children.push({ name: 'Фон', canvas: c }); }
    for (const L of page.layers) {
      if (!L.visible || L.noPrint) continue;
      for (const o of L.objects) {
        if (!o.visible) continue;
        const b = Model.worldBox(o); if (!G.boxValid(b)) continue;
        const x1 = Math.max(b.x1, -page.w), y1 = Math.max(b.y1, -page.h), x2 = Math.min(b.x2, page.w * 2), y2 = Math.min(b.y2, page.h * 2);
        if (x2 <= x1 || y2 <= y1) continue;
        const defs = [], body = Render.obj(o, defs, {});
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${x2 - x1}mm" height="${y2 - y1}mm" viewBox="${x1} ${y1} ${x2 - x1} ${y2 - y1}"><style>${Fonts.cssFor({ pages: [{ layers: [{ objects: [o] }] }] })}</style><defs>${defs.join('')}</defs>${body}</svg>`;
        const { blob } = await IO.rasterize(svg, x2 - x1, y2 - y1, dpi, 'png');
        const img = await Polza.loadImage(blob);
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
        children.push({ name: (o.name || Model.typeName(o)).slice(0, 60), canvas: c, left: Math.round(x1 * k), top: Math.round(y1 * k), opacity: 1 });
      }
    }
    const full = (await IO.rasterize(Render.exportSVG(page), page.w, page.h, dpi, 'png', page.color || '#ffffff'));
    const merged = await Polza.loadImage(full.blob); const mc = document.createElement('canvas'); mc.width = W; mc.height = H; mc.getContext('2d').drawImage(merged, 0, 0, W, H);
    return lib.writePsdUint8Array({ width: W, height: H, children, canvas: mc }, { generateThumbnail: true, psb: W > 30000 || H > 30000 });
  },
  async figBytes(doc, name) {
    const api = await FigmaWS.api();
    await api.newDocument();
    let x = 0;
    for (const P of doc.pages) {
      // в Figma единицы — пиксели (96 на дюйм): задаём размер в px, внутренняя сетка остаётся в мм
      const svg = Render.exportSVG(P, { frames: true }).replace(/width="([\d.]+)mm" height="([\d.]+)mm"/, (m, w, hh) => `width="${+w * 96 / 25.4}" height="${+hh * 96 / 25.4}"`);
      await api.importSVG(svg, x + P.w * 96 / 25.4 / 2, P.h * 96 / 25.4 / 2);
      x += P.w * 96 / 25.4 + 100;
    }
    return new Uint8Array(await api.exportFig(name));
  },
  async exportDoc(fmt, kind = 'page') {
    const base = IO.baseName(), dpi = IO.lastDpi || 300;
    try {
      if (fmt === 'psd') {
        const pages = kind === 'pages' ? App.doc.pages : [App.pg()];
        for (let i = 0; i < pages.length; i++) {
          UI.busy(`PSD: страница ${i + 1} из ${pages.length}…`);
          const bytes = await Convert.psdBytes(pages[i], dpi);
          UI.busy(null);
          await Host.saveFile(base + (pages.length > 1 ? '-' + (i + 1) : '') + '.psd', new Blob([bytes]), 'image/vnd.adobe.photoshop', 'psd');
        }
      } else if (fmt === 'fig') {
        UI.busy('Собираю файл Figma…');
        const bytes = await Convert.figBytes(App.doc, base);
        UI.busy(null); WS.show('vektor');
        await Host.saveFile(base + '.fig', new Blob([bytes]), 'application/octet-stream', 'fig');
      } else if (fmt === 'webp') {
        const r = IO.svgFor(kind === 'pages' ? 'page' : kind, false);
        const { blob } = await IO.rasterize(r.svg, r.w, r.h, dpi, 'png', App.pg().color || '#ffffff');
        const img = await Polza.loadImage(blob); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
        const w = await PhotoWS.smallest(c, 'image/webp');
        await Host.saveFile(base + '.webp', w.b, 'image/webp', 'webp');
      }
    } catch (e) { console.error(e); UI.toast('Не сохранилось: ' + (e.message || e), true); }
    finally { UI.busy(null); }
  },

  // ---------- любой файл → документ «Вектора» ----------
  async load(entry) {
    const ext = IO.ext(entry.name), buf = await entry.read();
    const doc = Model.newDoc(); doc.name = entry.name.replace(/\.\w+$/, '');
    const fromPages = pages => { doc.pages = pages.map((pg, i) => { const P = Model.newPage(pg.w, pg.h, i + 1); P.layers[0].objects = pg.objects; return P; }); return doc; };
    if (ext === 'vkt' || ext === 'json') { const d = Model.upgrade(JSON.parse(new TextDecoder().decode(buf))); return d; }
    if (ext === 'cdr' || ext === 'cdt') return fromPages(await IO.readCDR(buf, entry.path));
    if (ext === 'pdf' || ext === 'ai') return fromPages((await PDFImport.open(buf)).pages);
    if (ext === 'svg' || ext === 'fig') {
      let svgs;
      if (ext === 'svg') svgs = [{ svg: new TextDecoder().decode(buf), name: doc.name }];
      else { const api = await FigmaWS.api(); await api.open(buf, entry.name); await new Promise(r => setTimeout(r, 1500)); svgs = api.pagesSVG().filter(p => p.svg); }
      const keep = App.doc;
      const pages = [];
      try {
        for (const s of svgs) {
          const tmp = Model.newDoc(); App.doc = tmp;
          const sz = IO.importSVGText(s.svg, null, true);
          const P = tmp.pages[0]; if (sz) { P.w = sz.w; P.h = sz.h; }
          P.name = s.name || P.name;
          // содержимое — в начало страницы
          const objs = P.layers[0].objects; let bb = G.emptyBox(); objs.forEach(o => { bb = G.unionBox(bb, Model.worldBox(o)); });
          if (G.boxValid(bb) && ext === 'fig') { objs.forEach(o => Model.applyT(o, Mx.translate(-bb.x1, -bb.y1))); P.w = bb.x2 - bb.x1; P.h = bb.y2 - bb.y1; }
          pages.push(P);
        }
      } finally { App.doc = keep; }
      if (ext === 'fig') WS.show('vektor');
      doc.pages = pages.length ? pages : doc.pages;
      return doc;
    }
    if (ext === 'psd' || /^(png|jpe?g|webp|gif|bmp)$/.test(ext)) {
      // растр: страница по размеру картинки (300 dpi для PSD, 96 — для остальных); PSD — слоями-картинками
      const P = doc.pages[0];
      if (ext === 'psd') {
        const psd = (await Host.lib('psd')).readPsd(new Uint8Array(buf), { skipThumbnail: true });
        const k = 25.4 / 300; P.w = psd.width * k; P.h = psd.height * k;
        const add = (list) => { for (const l of list || []) { if (l.children) { add(l.children); continue; } if (!l.canvas || l.hidden) continue; const o = Model.make('image', { w: l.canvas.width * k, h: l.canvas.height * k, href: l.canvas.toDataURL('image/png'), name: l.name, m: Mx.translate((l.left || 0) * k, (l.top || 0) * k), opacity: l.opacity ?? 1 }); o.fill = { type: 'none' }; o.stroke.color = null; P.layers[0].objects.push(o); } };
        add(psd.children);
      } else {
        const blob = new Blob([buf], { type: Host.mimeOf(entry.name) });
        const img = await Polza.loadImage(blob); const k = 25.4 / 96;
        P.w = img.naturalWidth * k; P.h = img.naturalHeight * k;
        const o = Model.make('image', { w: P.w, h: P.h, href: await Polza.dataURL(blob), name: entry.name }); o.fill = { type: 'none' }; o.stroke.color = null;
        P.layers[0].objects.push(o);
      }
      return doc;
    }
    throw new Error('Не умею открывать .' + ext);
  },
  // документ → файл(ы) в папку
  async save(doc, fmt, folder, opt) {
    const keep = App.doc, keepFile = App.fileName;
    App.doc = doc; App.fileName = doc.name + '.vkt';
    const base = doc.name.replace(/[\\/:*?"<>|]+/g, ' ');
    try {
      Model.syncSeq(doc);
      if (fmt === 'vkt') return Host.writeToFolder(folder, base + '.vkt', JSON.stringify(doc));
      if (fmt === 'pdfx' || fmt === 'pdfv' || fmt === 'ai') {
        const bytes = await PDFWriter.build(doc.pages, { cmyk: fmt !== 'pdfv' && opt.cmyk !== false, bleed: fmt === 'pdfx' ? opt.bleed || 0 : 0, marks: fmt === 'pdfx' && opt.marks, title: doc.name, imageJpeg: true });
        return Host.writeToFolder(folder, base + (fmt === 'ai' ? '.ai' : '.pdf'), bytes);
      }
      if (fmt === 'cdr') {
        if (!folder.root) throw new Error('CDR сохраняется только в настольной версии с CorelDRAW');
        const sep = vkHost.platform === 'win32' ? '\\' : '/';
        return IO.exportCDR(opt.version || 17, { cmyk: opt.cmyk !== false, out: folder.root + sep + base + '.cdr' });
      }
      if (fmt === 'psd') { for (let i = 0; i < doc.pages.length; i++) await Host.writeToFolder(folder, base + (doc.pages.length > 1 ? '-' + (i + 1) : '') + '.psd', await Convert.psdBytes(doc.pages[i], opt.dpi || 300)); return; }
      if (fmt === 'fig') return Host.writeToFolder(folder, base + '.fig', await Convert.figBytes(doc, base));
      // svg / png / jpg / webp — по странице
      for (let i = 0; i < doc.pages.length; i++) {
        const P = doc.pages[i], suf = doc.pages.length > 1 ? '-' + String(i + 1).padStart(2, '0') : '';
        const r = IO.svgFor('page', false, P);
        if (fmt === 'svg') { await Host.writeToFolder(folder, base + suf + '.svg', r.svg); continue; }
        const { blob } = await IO.rasterize(r.svg, r.w, r.h, opt.dpi || 300, fmt === 'jpg' ? 'jpg' : 'png', fmt === 'png' ? null : P.color || '#ffffff');
        let out = blob;
        if (fmt === 'webp') { const img = await Polza.loadImage(blob); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); out = (await PhotoWS.smallest(c, 'image/webp')).b; }
        await Host.writeToFolder(folder, base + suf + '.' + fmt, out);
      }
    } finally { App.doc = keep; App.fileName = keepFile; }
  },
  dialog() {
    const fmt = UI.sel(Convert.OUT, Convert.last || 'pdfx', v => { Convert.last = v; upd(); }, '', 330);
    const ver = UI.sel(CDR_VERSIONS, 17, () => { }, '', 220);
    const dpi = h('input', { type: 'number', value: 300, min: 72, max: 1200 });
    const cmykC = h('input', { type: 'checkbox', checked: true }), marks = h('input', { type: 'checkbox', checked: true });
    const bleed = h('input', { type: 'number', value: 2, min: 0, step: 0.5 });
    const prep = UI.sel([['', 'Не подготавливать'], ...Prepress.profiles().map(p => [p.id, 'Подготовить: ' + p.name])], '', () => { }, '', 330);
    const verRow = h('label', {}, 'Версия CorelDRAW', ver), pdfRow = h('div', { class: 'row' }, h('label', { class: 'chk' }, cmykC, ' CMYK'), h('label', {}, 'Вылеты, мм', bleed), h('label', { class: 'chk' }, marks, ' Метки реза'));
    const upd = () => { verRow.style.display = fmt.value === 'cdr' ? '' : 'none'; pdfRow.style.display = ['pdfx', 'cdr', 'ai'].includes(fmt.value) ? '' : 'none'; };
    upd();
    UI.dialog('Конвертер файлов', h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'Откройте один или несколько файлов — CDR любой версии, PDF, AI, SVG, FIG, PSD, PNG, JPG, VKT — и сохраните в нужном формате в папку. Можно сразу подготовить к печати по требованиям типографии.'),
      h('label', {}, 'Сохранить как', fmt), verRow, pdfRow, h('label', {}, 'Разрешение для растра и PSD, dpi', dpi), h('label', {}, 'Подготовка к печати', prep)),
    [{ label: 'Отмена' }, { label: 'Выбрать файлы…', primary: true, action: () => { Convert.run(fmt.value, { version: +ver.value, dpi: +dpi.value, cmyk: cmykC.checked, marks: marks.checked, bleed: +bleed.value, prep: prep.value }); } }]);
  },
  async run(fmt, opt) {
    const files = await Host.pickFiles(Convert.IN, true, 'Файлы для конвертации');
    if (!files.length) return;
    const folder = await Host.pickFolder('Куда сохранить');
    if (!folder) return;
    const done = [], fail = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      UI.busy(`Конвертирую ${i + 1} из ${files.length}: ${f.name}`);
      try {
        const doc = await Convert.load(f);
        if (opt.prep) {
          const keep = App.doc; App.doc = doc;
          try { doc.print = { bleed: opt.bleed, safe: 3 }; await Prepress.measureImages(doc.pages); await Prepress.fixAll(Prepress.profile(opt.prep), doc.pages, true); } finally { App.doc = keep; }
        }
        await Convert.save(doc, fmt, folder, opt);
        done.push(f.name);
      } catch (e) { console.error(e); fail.push(f.name + ': ' + (e.message || e)); }
    }
    UI.busy(null); UI.refresh();
    UI.dialog('Конвертер', h('div', { class: 'form' }, h('p', {}, `Готово: ${done.length} из ${files.length}. Папка: ${folder.name}`), ...fail.map(t => h('p', { class: 'muted' }, '✕ ' + t))), [{ label: 'OK', primary: true }]);
  },
};
