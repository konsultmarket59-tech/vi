// Дизайн-системы с компьютера пользователя. Папка подключается один раз и не копируется: агенты
// («Вектор», «Моушн», «Make», «Ноды», «Фигма») читают её прямо с диска и следуют правилам — цвета,
// типографика, шрифты, логотипы, тон текстов. Шрифты из папки сразу подключаются в программе.
// Источником может быть и текущий файл «Фигмы»: цвета, шрифты и снимок макета.
'use strict';

const DS = {
  list: [],           // [{ id, name, root?, handle?, active, kind: 'folder'|'figma', brief, files? }]
  _files: {},         // id → [файлы] на время сеанса
  FONT: /\.(ttf|otf|woff)$/i,
  LOGO: /(logo|лого|знак|эмблем|brand|бренд|mark|icon|иконк)/i,
  DOC: /\.(md|txt|pdf|docx|html?|json|css|scss|less|ya?ml|tokens|ase)$/i,
  IMG: /\.(svg|png|jpe?g|webp)$/i,
  CTXDOC: /\.(md|txt|pdf|docx?|rtf|html?|json|csv|xlsx?|ods|odt|pptx)$/i,
  isCtx(d) { return d.role === 'context'; },
  label(d) { return (DS.isCtx(d) ? 'Контекст ' : 'ДС ') + d.name; },

  async init() {
    const saved = (await Docs.get('designSystems')) || [];
    DS.list = saved;
    if (Host.desktop && vkHost.dsFolders) {
      const roots = await vkHost.dsFolders().catch(() => []);
      // папки, к которым доступ сохранён в главном процессе, но которых нет в списке (или наоборот)
      for (const r of roots) if (!DS.list.some(d => d.root === r)) DS.list.push({ id: 'ds' + Date.now() + Math.random().toString(36).slice(2, 5), name: r.split(/[\\/]/).filter(Boolean).pop(), root: r, kind: 'folder', active: false });
      DS.list = DS.list.filter(d => d.kind !== 'folder' || !d.root || roots.includes(d.root));
    }
    // шрифты активных систем подключаются при запуске
    for (const d of DS.list.filter(x => x.active && x.kind === 'folder' && !DS.isCtx(x))) DS.loadFonts(d).catch(() => { });
    DS.renderChips();
  },
  async save() {
    const rows = DS.list.map(d => { const c = Object.assign({}, d); delete c.files; return c; });
    // доступ к папке браузера (handle) хранится, если браузер это умеет; иначе — без него (спросит папку заново)
    try { await Docs.put('designSystems', rows); }
    catch (e) { await Docs.put('designSystems', rows.map(c => { const x = Object.assign({}, c); delete x.handle; return x; })).catch(() => { }); }
  },
  active() { return DS.list.filter(d => d.active); },

  async add(role = 'ds') {
    let d;
    if (Host.desktop && vkHost.dsAdd) {
      const root = await vkHost.dsAdd(role === 'context' ? 'Папка с контекстом проекта' : 'Папка дизайн-системы');
      if (!root) return null;
      d = { id: 'ds' + Date.now(), name: root.split(/[\\/]/).filter(Boolean).pop(), root, kind: 'folder', role, active: true };
    } else {
      if (!window.showDirectoryPicker) { UI.toast('Папки подключаются в настольной версии, Chrome или Edge'); return null; }
      let handle; try { handle = await showDirectoryPicker({ mode: 'read' }); } catch (e) { return null; }
      d = { id: 'ds' + Date.now(), name: handle.name, handle, kind: 'folder', role, active: true };
    }
    DS.list = DS.list.filter(x => !(x.root && x.root === d.root));
    DS.list.push(d);
    await withBusy((role === 'context' ? 'Читаю контекст «' : 'Читаю дизайн-систему «') + d.name + '»…', () => DS.scan(d));
    await DS.save();
    return d;
  },
  async remove(d) {
    DS.list = DS.list.filter(x => x !== d);
    if (d.root && Host.desktop && vkHost.dsRemove) vkHost.dsRemove(d.root);
    delete DS._files[d.id]; DS._css = null;
    await DS.save();
  },
  async files(d) {
    if (DS._files[d.id]) return DS._files[d.id];
    let files = [];
    if (d.root && Host.desktop) files = (await Host.openFolderPath(d.root)).files;
    else if (d.handle) {
      try { if ((await d.handle.queryPermission({ mode: 'read' })) !== 'granted') await d.handle.requestPermission({ mode: 'read' }); } catch (e) { }
      files = await Host.walkHandle(d.handle);
    }
    DS._files[d.id] = files;
    return files;
  },

  // ---------- разбор папки: правила, цвета, шрифты, логотипы ----------
  async scan(d) {
    if (DS.isCtx(d)) return DS.scanContext(d);
    const files = await DS.files(d);
    const fonts = files.filter(f => DS.FONT.test(f.name));
    const logos = files.filter(f => DS.IMG.test(f.name) && DS.LOGO.test(f.rel)).slice(0, 40);
    const images = files.filter(f => DS.IMG.test(f.name) && !DS.LOGO.test(f.rel)).slice(0, 60);
    // документы-правила: сначала «руководство», «гайд», «типографика», README
    const prio = f => (/(guide|гайд|руковод|brand ?book|брендбук|стандарт|правил|typograph|типограф|readme|tokens|токен|colors?|цвет|palette|палитр)/i.test(f.rel) ? 0 : 1) + (/\.pdf$/i.test(f.name) ? 0.5 : 0);
    const docs = files.filter(f => DS.DOC.test(f.name)).sort((a, b) => prio(a) - prio(b)).slice(0, 12);
    let text = '', colors = new Map();
    for (const f of docs) {
      if (text.length > 14000) break;
      try {
        const r = await Agent.readFileText({ path: d.name + '/' + f.rel, entry: f }, { max_rows: 80 });
        const t = typeof r === 'string' ? r : (r.text || r.content || JSON.stringify(r).slice(0, 8000));
        text += `\n--- ${f.rel} ---\n` + String(t).slice(0, 6000);
        // цвета: #hex с подписью слева (имя переменной, «Основной», «Primary»…)
        for (const m of String(t).matchAll(/([A-Za-zА-Яа-яЁё0-9_\-. ]{0,30})[:=\s"']*#([0-9a-f]{6})\b/gi)) {
          const hex = '#' + m[2].toLowerCase(), label = m[1].trim().replace(/[-_]+/g, ' ').slice(-24);
          const c = colors.get(hex) || { hex, n: 0, label: '' }; c.n++; if (!c.label && label) c.label = label; colors.set(hex, c);
        }
      } catch (e) { console.warn('ДС', f.rel, e); }
    }
    // шрифты: семейства по файлам
    const families = new Set();
    for (const f of fonts.slice(0, 40)) {
      try { const otf = opentype.parse(await Agent.readEntry({ entry: f })); const fam = otf.names.fontFamily && (otf.names.fontFamily.en || Object.values(otf.names.fontFamily)[0]); if (fam) families.add(fam); } catch (e) { }
    }
    d.brief = {
      at: Date.now(), files: files.length,
      colors: [...colors.values()].sort((a, b) => b.n - a.n).slice(0, 24).map(c => c.hex + (c.label ? ' ' + c.label : '')),
      fonts: [...families], fontFiles: fonts.map(f => f.rel).slice(0, 40),
      logos: logos.map(f => f.rel), images: images.map(f => f.rel).slice(0, 30),
      docs: docs.map(f => f.rel), rules: text.trim().slice(0, 14000),
    };
    await DS.loadFonts(d);
    return d.brief;
  },
  // контекст проекта: о компании, аудитория, прайс, условия, отзывы — выдержки для агентов
  async scanContext(d) {
    const files = await DS.files(d);
    const prio = f => (/(бриф|brief|компан|о нас|about|ца|аудитор|audience|персон|прайс|price|цен|услов|оффер|offer|преимущ|faq|вопрос|отзыв|кейс|контакт)/i.test(f.rel) ? 0 : 1);
    const docs = files.filter(f => DS.CTXDOC.test(f.name)).sort((a, b) => prio(a) - prio(b)).slice(0, 30);
    let text = '';
    for (const f of docs) {
      if (text.length > 30000) break;
      try {
        const r = await Agent.readFileText({ path: DS.label(d) + '/' + f.rel, entry: f }, { max_rows: 200 });
        const t = typeof r === 'string' ? r : (r.text || r.content || JSON.stringify(r).slice(0, 12000));
        text += `\n--- ${f.rel} ---\n` + String(t).slice(0, 9000);
      } catch (e) { console.warn('Контекст', f.rel, e); }
    }
    d.brief = { at: Date.now(), files: files.length, docs: docs.map(f => f.rel), images: files.filter(f => DS.IMG.test(f.name)).map(f => f.rel).slice(0, 60), rules: text.trim().slice(0, 30000) };
    return d.brief;
  },
  async loadFonts(d) {
    const files = (await DS.files(d)).filter(f => DS.FONT.test(f.name)).slice(0, 40);
    for (const f of files) { try { await Fonts.addFontFile(f.name, await Agent.readEntry({ entry: f }), false); } catch (e) { } }
    DS._css = null;
  },
  // @font-face для просмотра «Make» (шрифты дизайн-систем внутри страницы)
  fontCSS() {
    if (!DS._css) DS._css = DS._fontCSS();
    return DS._css;
  },
  async _fontCSS() {
    let css = '';
    for (const d of DS.active().filter(x => x.kind === 'folder' && !DS.isCtx(x))) {
      for (const f of (await DS.files(d)).filter(x => DS.FONT.test(x.name)).slice(0, 24)) {
        try {
          const buf = await Agent.readEntry({ entry: f });
          const otf = opentype.parse(buf);
          const fam = otf.names.fontFamily && (otf.names.fontFamily.en || Object.values(otf.names.fontFamily)[0]);
          const sub = String(otf.names.fontSubfamily && (otf.names.fontSubfamily.en || Object.values(otf.names.fontSubfamily)[0]) || '');
          const url = await Polza.dataURL(new Blob([buf], { type: 'font/' + Host.extOf(f.name) }));
          css += `@font-face{font-family:"${fam}";src:url(${url});font-weight:${/bold|black|heavy/i.test(sub) ? 700 : /medium|semi/i.test(sub) ? 500 : /light|thin/i.test(sub) ? 300 : 400};font-style:${/italic|oblique/i.test(sub) ? 'italic' : 'normal'}}\n`;
        } catch (e) { }
      }
    }
    return css;
  },

  // ---------- для агентов ----------
  // папки активных систем — как материалы с ролью «брендбук»
  materials() {
    const out = DS.active().filter(d => d.kind === 'folder' && DS._files[d.id]).map(d => ({ id: 'ds-' + d.id, role: DS.isCtx(d) ? 'data' : 'brand', kind: 'folder', name: DS.label(d), folder: { name: d.name, files: DS._files[d.id] }, ds: true }));
    for (const d of DS.active().filter(x => x.kind === 'figma' && x.brief && x.brief.image)) {
      const url = d.brief.image, name = 'ДС-Фигма ' + d.name + '.jpg';
      out.push({ id: 'ds-' + d.id, role: 'brand', kind: 'file', name, ds: true, file: { name, size: url.length * 0.75, read: async () => (await (await fetch(url)).blob()).arrayBuffer() } });
    }
    return out;
  },
  async ready() { for (const d of DS.active().filter(x => x.kind === 'folder')) { try { await DS.files(d); } catch (e) { } } },
  prompt() {
    const ctx = DS.active().filter(DS.isCtx), act = DS.active().filter(d => !DS.isCtx(d));
    let out = '';
    if (ctx.length) out += '\n\nКОНТЕКСТ ПРОЕКТА — папки пользователя с данными о компании, целевой аудитории, прайсом, условиями. Это главный источник фактов: тексты, цены, условия, преимущества, отзывы и контакты бери ОТСЮДА, ничего не выдумывай. Пиши для этой аудитории её языком.\n' + ctx.map(d => {
      const b = d.brief || {};
      return [`«${d.name}» — в материалах как «${DS.label(d)}/…» (роль data). Полные файлы — read_file по этим путям (таблицы и прайсы читай целиком).`,
        b.docs && b.docs.length ? 'Файлы: ' + b.docs.map(x => `${DS.label(d)}/${x}`).join(', ') : '',
        b.images && b.images.length ? 'Фото и картинки (можно использовать): ' + b.images.slice(0, 30).map(x => `${DS.label(d)}/${x}`).join(', ') : '',
        b.rules ? 'Выдержка:\n' + b.rules.slice(0, 16000) : ''].filter(Boolean).join('\n');
    }).join('\n\n') + '\nПрежде чем делать макет, страницу или ролик: прочитай контекст (read_file), выпиши для себя аудиторию, её боли и выгоды, оффер, цены и условия — и только потом создавай контент и дизайн.';
    if (!act.length) return out;
    return out + '\n\nДИЗАЙН-СИСТЕМА — СЛЕДУЙ ЕЙ СТРОГО (она важнее твоих вкусовых решений):\n' + act.map(d => {
      const b = d.brief || {};
      if (d.kind === 'figma') return `«${d.name}» (из «Фигмы»): цвета ${(b.colors || []).join(', ') || '—'}; шрифты ${(b.fonts || []).join(', ') || '—'}.${b.rules ? '\nЗаметки: ' + b.rules.slice(0, 3000) : ''}${b.image ? '\nСнимок макета можно посмотреть: view_file «ДС-Фигма ' + d.name + '».' : ''}`;
      return [`«${d.name}» — папка на компьютере пользователя, в материалах как «ДС ${d.name}/…» (роль brand). Подробности — read_file / view_file по этим путям.`,
        b.colors && b.colors.length ? 'Цвета (используй только их): ' + b.colors.join('; ') : '',
        b.fonts && b.fonts.length ? 'Шрифты (подключены в программе, используй только их): ' + b.fonts.join(', ') : '',
        b.logos && b.logos.length ? 'Логотипы и знаки — бери готовые файлы, не перерисовывай: ' + b.logos.map(x => `ДС ${d.name}/${x}`).join(', ') : '',
        b.docs && b.docs.length ? 'Документы с правилами: ' + b.docs.map(x => `ДС ${d.name}/${x}`).join(', ') : '',
        b.rules ? 'Выдержка из правил:\n' + b.rules.slice(0, 7000) : ''].filter(Boolean).join('\n');
    }).join('\n\n') + '\nПеред работой открой нужные документы дизайн-системы (read_file) и посмотри логотип и примеры (view_file). Соблюдай отступы, сетку, кегли, начертания, тон текстов из правил.';
  },

  // ---------- дизайн-система из текущего файла «Фигмы» ----------
  async fromFigma() {
    const api = await FigmaWS.api();
    const svg = api.pagesSVG ? api.pagesSVG().map(p => p.svg || '').join('\n') : api.exportSVG && api.exportSVG();
    if (!svg) return UI.toast('В «Фигме» пустая страница');
    const colors = new Map(), fonts = new Set();
    for (const m of svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{6})"/g)) colors.set(m[1].toLowerCase(), (colors.get(m[1].toLowerCase()) || 0) + 1);
    for (const m of svg.matchAll(/font-family="([^"]+)"/g)) fonts.add(m[1].split(',')[0].replace(/['"]/g, '').trim());
    let image = null; try { const buf = await api.exportPNG(1); if (buf) image = await Polza.thumb(new Blob([buf], { type: 'image/png' }), 1200); } catch (e) { }
    const name = (FigmaWS.docName && FigmaWS.docName()) || 'Макет «Фигмы»';
    const d = { id: 'dsf' + Date.now(), name, kind: 'figma', active: true, brief: { colors: [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(x => x[0]), fonts: [...fonts], image, rules: '' } };
    DS.list.push(d); await DS.save();
    UI.toast(`Дизайн-система из «Фигмы»: цветов ${d.brief.colors.length}, шрифтов ${d.brief.fonts.length}`);
    return d;
  },

  // ---------- окно ----------
  dialog() {
    const box = h('div', { class: 'ds-list' });
    const draw = () => {
      box.innerHTML = '';
      if (!DS.list.length) box.append(h('p', { class: 'muted' }, 'Подключите папку с дизайн-системой (брендбук, гайд, токены цветов, шрифты, логотипы) и папку с контекстом проекта (о компании, целевая аудитория, прайс, условия, отзывы — Word, PDF, Excel, тексты). Файлы не копируются: агенты читают их с вашего компьютера.'));
      for (const d of DS.list) {
        const b = d.brief || {};
        box.append(h('div', { class: 'ds-row' + (d.active ? ' on' : '') },
          h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: d.active, onchange: async e => { d.active = e.target.checked; if (d.active && d.kind === 'folder') { if (!d.brief) await withBusy('Читаю…', () => DS.scan(d)); else if (!DS.isCtx(d)) DS.loadFonts(d); } DS._css = null; await DS.save(); draw(); DS.renderChips(); } }),
            h('b', {}, (d.kind === 'figma' ? '◆ ' : DS.isCtx(d) ? '📋 ' : '📁 ') + d.name), h('span', { class: 'muted small' }, DS.isCtx(d) ? ' — контекст проекта' : ' — дизайн-система')),
          h('div', { class: 'muted small' }, d.kind === 'figma' ? 'из «Фигмы»' : (d.root || 'папка браузера') + (b.files ? ` · файлов ${b.files}` : '')),
          b.colors && b.colors.length ? h('div', { class: 'ds-sw' }, ...b.colors.slice(0, 16).map(c => h('span', { title: c, style: { background: c.split(' ')[0] } }))) : null,
          h('div', { class: 'small' }, [b.fonts && b.fonts.length ? 'Шрифты: ' + b.fonts.join(', ') : '', b.logos && b.logos.length ? 'Логотипов: ' + b.logos.length : '', b.docs && b.docs.length ? (DS.isCtx(d) ? 'Файлов с данными: ' : 'Документов с правилами: ') + b.docs.length : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'row' },
            d.kind === 'folder' ? h('button', { class: 'pbt', onclick: async () => { delete DS._files[d.id]; await withBusy('Перечитываю…', () => DS.scan(d)); await DS.save(); draw(); } }, 'Перечитать') : null,
            h('button', { class: 'pbt', onclick: () => setTimeout(() => UI.dialog('Что видят агенты', h('pre', { class: 'ds-pre' }, DS.promptFor(d)), [{ label: 'Назад', primary: true }], { onClose: () => setTimeout(() => DS.dialog(), 0) }), 0) }, 'Что видят агенты'),
            h('button', { class: 'pbt', onclick: async () => { await DS.remove(d); draw(); DS.renderChips(); } }, 'Отключить'))));
      }
    };
    draw();
    UI.dialog('Дизайн-системы и контекст проекта', h('div', { class: 'form' }, box,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: async () => { if (await DS.add()) { draw(); DS.renderChips(); } } }, '+ Папка дизайн-системы'),
        h('button', { class: 'primary', onclick: async () => { if (await DS.add('context')) { draw(); DS.renderChips(); } } }, '+ Контекст: компания, ЦА, прайс'),
        h('button', { class: 'pbt', onclick: async () => { if (await DS.fromFigma()) { draw(); DS.renderChips(); } } }, 'Из текущего файла «Фигмы»'))),
      [{ label: 'Готово', primary: true }]);
  },
  promptFor(d) { const keep = DS.list; DS.list = [Object.assign({}, d, { active: true })]; try { return DS.prompt(); } finally { DS.list = keep; } },
  // строка «Дизайн-система: …» в панелях агентов
  chip() {
    const el = h('button', { class: 'ds-chip', title: 'Дизайн-системы, которым следуют агенты', onclick: () => DS.dialog() });
    el.dataset.dsChip = '1';
    DS.fillChip(el);
    return el;
  },
  fillChip(el) {
    const a = DS.active(), ds = a.filter(d => !DS.isCtx(d)), cx = a.filter(DS.isCtx);
    const parts = [ds.length ? 'Дизайн-система: ' + ds.map(d => d.name).join(', ') : '', cx.length ? 'Контекст: ' + cx.map(d => d.name).join(', ') : ''].filter(Boolean);
    el.textContent = '◆ ' + (parts.length ? parts.join(' · ') : 'Дизайн-система и контекст');
    el.title = 'Дизайн-системы и контекст проекта (компания, ЦА, прайс), которым следуют агенты';
    el.classList.toggle('on', !!a.length);
  },
  renderChips() {
    document.querySelectorAll('[data-ds-chip]').forEach(DS.fillChip);
    if (typeof Make !== 'undefined' && Make.frame) Make.preview();
  },
};
