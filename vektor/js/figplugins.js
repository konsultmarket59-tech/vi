// Встроенные плагины «Фигмы» — аналоги самых популярных плагинов Figma, установлены сразу:
// текст-рыба, наполнение контентом (Content Reel), стоковые фото (Unsplash), стрелки между экранами (Autoflow),
// переименование слоёв (Rename It), выделить похожие (Similayer), найти и заменить, проверка контраста (Stark),
// палитра из картинки, расстановка сеткой (Tidy up), чистка и пиксель-перфект, диаграммы (Chart).
// Работают через Plugin API редактора (FigTools.plug), всё отменяется Ctrl+Z.
'use strict';

const FigPlugins = {
  LOREM: 'Лучшие решения рождаются там где встречаются опыт и смелость Мы проектируем удобные сервисы продумываем каждую деталь и проверяем гипотезы на реальных людях Дизайн помогает бизнесу расти а людям быстрее находить нужное Простота ясность и забота о пользователе остаются главными принципами работы команды'.split(' '),
  DATA: {
    'Имена': ['Анна Смирнова', 'Иван Петров', 'Мария Кузнецова', 'Дмитрий Соколов', 'Елена Попова', 'Алексей Волков', 'Ольга Лебедева', 'Сергей Козлов', 'Наталья Новикова', 'Андрей Морозов', 'Татьяна Павлова', 'Михаил Фёдоров'],
    'Телефоны': ['+7 912 345-67-89', '+7 903 128-44-10', '+7 921 555-12-34', '+7 985 700-20-30', '+7 916 404-04-04', '+7 950 333-21-12'],
    'E-mail': ['anna@example.ru', 'ivan.petrov@mail.ru', 'maria.k@yandex.ru', 'info@company.ru', 'hello@studio.ru', 'sales@shop.ru'],
    'Города': ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Нижний Новгород', 'Пермь', 'Самара', 'Краснодар', 'Сочи'],
    'Адреса': ['ул. Ленина, 12', 'пр. Мира, 45, кв. 8', 'ул. Пушкина, 3', 'Садовая ул., 21', 'ул. Гагарина, 7/2', 'наб. Реки Мойки, 40'],
    'Цены': ['1 290 ₽', '4 990 ₽', '12 500 ₽', '790 ₽', '2 450 ₽', '35 000 ₽', '9 900 ₽'],
    'Даты': ['12 марта 2026', '1 апреля', '25.05.2026', 'вчера, 18:40', '3 дня назад', '15 июня, 10:00'],
    'Компании': ['ООО «Северный ветер»', 'Студия «Линия»', 'ТД «Горизонт»', 'АО «Технопарк»', 'Кофейня «Зерно»', 'ИП Соколов'],
    'Должности': ['Дизайнер', 'Менеджер проектов', 'Маркетолог', 'Разработчик', 'Руководитель отдела', 'Аналитик'],
    'Товары': ['Кроссовки беговые', 'Рюкзак городской', 'Кофе в зёрнах 1 кг', 'Наушники беспроводные', 'Термокружка', 'Футболка базовая'],
  },
  list() {
    const P = FigPlugins;
    return [
      ['Текст-рыба (Lorem ipsum по-русски)', P.lorem],
      ['Наполнить контентом (имена, телефоны, цены…)', P.content],
      ['Стоковые фото в выделенные фигуры', P.stock],
      ['Стрелки между экранами (Autoflow)', P.autoflow],
      ['Переименовать слои', P.rename],
      ['Выделить похожие слои', P.similar],
      ['Найти и заменить текст', P.replace],
      ['Проверить контраст текста (WCAG)', P.contrast],
      ['Палитра из картинки', P.palette],
      ['Расставить сеткой', P.tidy],
      ['Чистка: пиксели, скрытые слои', P.clean],
      ['Диаграмма из чисел', P.chart],
    ];
  },
  menuItems() { return FigPlugins.list().map(([l, fn]) => ({ label: '◆ ' + l, action: FigTools.wrap(fn) })); },
  async select(ids) { const api = await FigmaWS.api(); if (api.select && ids && ids.length) api.select(ids); },
  // общий кусок: тексты в выделении (с вложенными)
  TEXTS: `const texts = []; const walk = n => { if (n.type === 'TEXT') texts.push(n); else if (n.children) n.children.forEach(walk); }; figma.currentPage.selection.forEach(walk);
    if (!texts.length) throw new Error('Выделите текстовые слои (или рамки с ними)');
    const setText = async (t, s) => { try { await figma.loadFontAsync(t.fontName); } catch (e) { } t.characters = s; };`,

  async lorem() {
    UI.prompt('Сколько слов в каждом тексте', '12', async n => {
      const words = FigPlugins.LOREM, k = Math.max(1, +n || 12);
      await FigTools.plug('Текст-рыба', FigPlugins.TEXTS + `
        let i = 0; for (const t of texts) { const w = []; for (let j = 0; j < a.k; j++) w.push(a.words[(i++) % a.words.length]); let s = w.join(' '); s = s[0].toUpperCase() + s.slice(1).toLowerCase() + '.'; await setText(t, s); }
        io.out = texts.length;`, { words, k });
      UI.toast('Заполнено');
    });
  },
  async content() {
    const sel = h('select', {}, ...Object.keys(FigPlugins.DATA).map(k => h('option', { value: k }, k)));
    const shuffle = h('input', { type: 'checkbox' });
    UI.dialog('Наполнить контентом', h('div', { class: 'form' }, h('label', {}, 'Что подставить', sel), h('label', { class: 'row' }, shuffle, ' вперемешку'), h('p', { class: 'muted small' }, 'Выделите текстовые слои или карточки — тексты заполнятся по очереди.')),
      [{ label: 'Отмена' }, { label: 'Заполнить', primary: true, action: () => {
        let data = FigPlugins.DATA[sel.value].slice();
        if (shuffle.checked) data.sort(() => Math.random() - 0.5);
        FigTools.wrap(async () => { const n = await FigTools.plug('Наполнить контентом', FigPlugins.TEXTS + `let i = 0; for (const t of texts) await setText(t, a.data[(i++) % a.data.length]); io.out = texts.length;`, { data }); UI.toast('Заполнено текстов: ' + n); })();
      } }]);
  },
  async stock() {
    UI.prompt('Тема фото (по-английски: coffee, city, nature…) — пусто: случайные', '', async q => {
      const shapes = await FigTools.plug('Стоковые фото: выделение', `const s = figma.currentPage.selection.filter(n => 'fills' in n && n.type !== 'TEXT'); if (!s.length) throw new Error('Выделите фигуры или рамки'); io.out = s.map(n => ({ id: n.id, w: Math.round(n.width), h: Math.round(n.height) }));`);
      await withBusy('Загружаю фото…', async () => {
        const items = [];
        let i = 0;
        for (const s of shapes) {
          const w = Math.min(1600, Math.max(64, s.w * 2)), hh = Math.min(1600, Math.max(64, s.h * 2));
          const urls = (q ? [`https://loremflickr.com/${w}/${hh}/${encodeURIComponent(q)}?lock=${Date.now() % 1000 + i}`] : []).concat([`https://picsum.photos/${w}/${hh}?random=${Date.now() + i}`]);
          i++;
          let buf = null;
          for (const u of urls) { try { const r = await fetch(u); if (r.ok) { buf = await r.arrayBuffer(); break; } } catch (e) { } }
          if (!buf) throw new Error('Не удалось загрузить фото — нужен интернет');
          items.push({ id: s.id, bytes: Array.from(new Uint8Array(buf)) });
        }
        await FigTools.plug('Стоковые фото', `for (const it of a.items) { const n = figma.getNodeById(it.id); const img = figma.createImage(new Uint8Array(it.bytes)); n.fills = [{ type: 'IMAGE', imageHash: img.hash, imageScaleMode: 'FILL', opacity: 1, visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }]; }`, { items });
      });
    });
  },
  async autoflow() {
    const style = h('select', {}, h('option', { value: 'elbow' }, 'Уголком'), h('option', { value: 'straight' }, 'Прямо'), h('option', { value: 'curve' }, 'Плавной кривой'));
    const color = h('input', { type: 'color', value: '#1e88ff' });
    UI.dialog('Стрелки между экранами', h('div', { class: 'form' }, h('p', { class: 'muted small' }, 'Выделите 2 и больше экранов — стрелки пойдут от каждого к следующему (слева направо, сверху вниз).'), h('label', {}, 'Форма', style), h('label', {}, 'Цвет ', color)),
      [{ label: 'Отмена' }, { label: 'Соединить', primary: true, action: () => FigTools.wrap(async () => {
        const n = await FigTools.plug('Стрелки между экранами', `
          const sel = figma.currentPage.selection.slice(); if (sel.length < 2) throw new Error('Выделите хотя бы два экрана');
          const box = n => { const b = n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height }; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
          sel.sort((p, q) => { const A = box(p), B = box(q); return Math.abs(A.y - B.y) > Math.min(A.h, B.h) / 2 ? A.y - B.y : A.x - B.x; });
          let cnt = 0;
          for (let i = 0; i < sel.length - 1; i++) {
            const A = box(sel[i]), B = box(sel[i + 1]);
            const horiz = B.x >= A.x + A.w - 1;
            const x1 = horiz ? A.x + A.w : A.x + A.w / 2, y1 = horiz ? A.y + A.h / 2 : A.y + A.h, x2 = horiz ? B.x : B.x + B.w / 2, y2 = horiz ? B.y + B.h / 2 : B.y;
            const pad = 12, mx = Math.min(x1, x2) - pad, my = Math.min(y1, y2) - pad;
            const p = (x, y) => (x - mx).toFixed(1) + ' ' + (y - my).toFixed(1);
            let d;
            if (a.style === 'straight') d = 'M' + p(x1, y1) + ' L' + p(x2, y2);
            else if (a.style === 'curve') d = horiz ? 'M' + p(x1, y1) + ' C' + p((x1 + x2) / 2, y1) + ' ' + p((x1 + x2) / 2, y2) + ' ' + p(x2, y2) : 'M' + p(x1, y1) + ' C' + p(x1, (y1 + y2) / 2) + ' ' + p(x2, (y1 + y2) / 2) + ' ' + p(x2, y2);
            else d = horiz ? 'M' + p(x1, y1) + ' H' + ((x1 + x2) / 2 - mx).toFixed(1) + ' V' + (y2 - my).toFixed(1) + ' H' + (x2 - mx).toFixed(1) : 'M' + p(x1, y1) + ' V' + ((y1 + y2) / 2 - my).toFixed(1) + ' H' + (x2 - mx).toFixed(1) + ' V' + (y2 - my).toFixed(1);
            const ah = horiz ? 'M' + p(x2 - 10, y2 - 6) + ' L' + p(x2, y2) + ' L' + p(x2 - 10, y2 + 6) + ' Z' : 'M' + p(x2 - 6, y2 - 10) + ' L' + p(x2, y2) + ' L' + p(x2 + 6, y2 - 10) + ' Z';
            const W = Math.abs(x2 - x1) + pad * 2, H = Math.abs(y2 - y1) + pad * 2;
            const f = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><path d="' + d + '" fill="none" stroke="' + a.color + '" stroke-width="2"/><path d="' + ah + '" fill="' + a.color + '"/></svg>');
            f.name = 'Связь: ' + sel[i].name + ' → ' + sel[i + 1].name; f.x = mx; f.y = my; try { f.fills = []; } catch (e) { }
            cnt++;
          }
          io.out = cnt;`, { style: style.value, color: color.value });
        UI.toast('Стрелок: ' + n);
      })() }]);
  },
  async rename() {
    UI.prompt('Новое имя: $n — номер, $name — старое имя, $type — тип, $w×$h — размер', 'Карточка $n', async pat => {
      if (!pat) return;
      const n = await FigTools.plug('Переименовать слои', `const s = figma.currentPage.selection; if (!s.length) throw new Error('Выделите слои');
        s.forEach((n, i) => { n.name = a.pat.replace(/\\$n/g, String(i + 1)).replace(/\\$name/g, n.name).replace(/\\$type/g, n.type).replace(/\\$w/g, Math.round(n.width)).replace(/\\$h/g, Math.round(n.height)); });
        io.out = s.length;`, { pat });
      UI.toast('Переименовано: ' + n);
    });
  },
  async similar() {
    const ids = await FigTools.plug('Выделить похожие', `const s = figma.currentPage.selection[0]; if (!s) throw new Error('Выделите образец');
      const key = n => { const f = Array.isArray(n.fills) && n.fills[0]; const c = f && f.color ? [f.type, Math.round(f.color.r * 255), Math.round(f.color.g * 255), Math.round(f.color.b * 255)].join(',') : (f ? f.type : '-'); return [n.type, c, n.type === 'TEXT' ? n.fontSize : Math.round(n.width) + 'x' + Math.round(n.height)].join('|'); };
      const k = key(s); io.out = figma.currentPage.findAll(n => n.type === s.type && key(n) === k).map(n => n.id);`);
    await FigPlugins.select(ids);
    UI.toast('Похожих слоёв: ' + ids.length);
  },
  async replace() {
    const find = h('input', { type: 'text', class: 'wide' }), repl = h('input', { type: 'text', class: 'wide' });
    UI.dialog('Найти и заменить текст', h('div', { class: 'form' }, h('label', {}, 'Найти', find), h('label', {}, 'Заменить на', repl), h('p', { class: 'muted small' }, 'Во всех текстах текущей страницы.')),
      [{ label: 'Отмена' }, { label: 'Заменить', primary: true, action: () => FigTools.wrap(async () => {
        if (!find.value) return;
        const n = await FigTools.plug('Найти и заменить', `let c = 0; for (const t of figma.currentPage.findAll(n => n.type === 'TEXT')) { const s = t.characters; if (s.includes(a.f)) { try { await figma.loadFontAsync(t.fontName); } catch (e) { } t.characters = s.split(a.f).join(a.r); c++; } } io.out = c;`, { f: find.value, r: repl.value });
        UI.toast('Заменено в текстах: ' + n);
      })() }]);
  },
  async contrast() {
    const rows = await FigTools.plug('Контраст', FigPlugins.TEXTS + `
      const col = n => { const f = Array.isArray(n.fills) && n.fills.find(x => x.type === 'SOLID' && x.visible !== false); return f ? f.color : null; };
      io.out = texts.map(t => { let p = t.parent, bg = null; while (p && !bg) { bg = col(p); p = p.parent; } return { name: t.name, text: String(t.characters).slice(0, 30), size: t.fontSize, fg: col(t), bg: bg || { r: 1, g: 1, b: 1 } }; });`);
    const L = c => { const f = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    const tbl = h('table', { class: 'fx-table' }, h('tr', {}, h('th', {}, 'Текст'), h('th', {}, 'Цвета'), h('th', {}, 'Контраст'), h('th', {}, 'Итог')));
    for (const r of rows) {
      if (!r.fg) continue;
      const a = L(r.fg), b = L(r.bg), k = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const big = (+r.size || 16) >= 24;
      const v = k >= (big ? 4.5 : 7) ? 'AAA' : k >= (big ? 3 : 4.5) ? 'AA' : 'Мало';
      tbl.append(h('tr', {}, h('td', {}, r.text), h('td', {}, h('span', { class: 'fx-sw', style: { background: hex(r.fg) } }), ' на ', h('span', { class: 'fx-sw', style: { background: hex(r.bg) } })), h('td', {}, k.toFixed(2) + ':1'), h('td', { style: { color: v === 'Мало' ? '#d33' : '#2e8b38', fontWeight: 600 } }, v)));
    }
    UI.dialog('Контраст текста (WCAG 2.1)', h('div', { class: 'form' }, tbl, h('p', { class: 'muted small' }, 'AA: 4.5:1 для обычного текста и 3:1 для крупного (от 24 px); AAA: 7:1 и 4.5:1.')), [{ label: 'Закрыть', primary: true }]);
  },
  async palette() {
    const s = await FigTools.source();
    const c = document.createElement('canvas'), k = Math.min(1, 120 / Math.max(s.img.naturalWidth || s.img.width, s.img.naturalHeight || s.img.height));
    c.width = Math.max(1, Math.round((s.img.naturalWidth || s.img.width) * k)); c.height = Math.max(1, Math.round((s.img.naturalHeight || s.img.height) * k));
    const g = c.getContext('2d'); g.drawImage(s.img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data, px = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
    // k-средних на 6 цветов
    let C = Array.from({ length: 6 }, (_, i) => px[Math.floor(i * px.length / 6)] || [0, 0, 0]);
    for (let it = 0; it < 10; it++) {
      const sum = C.map(() => [0, 0, 0, 0]);
      for (const p of px) { let bi = 0, bd = 1e9; C.forEach((q, j) => { const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); const t = sum[bi]; t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; t[3]++; }
      C = sum.map((t, j) => t[3] ? [t[0] / t[3], t[1] / t[3], t[2] / t[3], t[3]] : C[j]);
    }
    C.sort((a, b) => (b[3] || 0) - (a[3] || 0));
    const cols = C.map(q => '#' + q.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
    await FigTools.plug('Палитра из картинки', `
      const x0 = a.rb.x + a.rb.w + 40, y0 = a.rb.y;
      try { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); } catch (e) { }
      a.cols.forEach((c, i) => {
        const r = figma.createEllipse(); r.resize(64, 64); r.x = x0; r.y = y0 + i * 84; r.name = c;
        const v = parseInt(c.slice(1), 16); r.fills = [{ type: 'SOLID', color: { r: (v >> 16) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 }, opacity: 1, visible: true }];
        try { const t = figma.createText(); t.characters = c.toUpperCase(); t.fontSize = 16; t.x = x0 + 80; t.y = y0 + i * 84 + 22; } catch (e) { }
      });`, { cols, rb: s.rb });
    UI.toast('Палитра: ' + cols.join(' '));
  },
  async tidy() {
    const colsIn = h('input', { type: 'number', min: 1, value: 3, style: { width: '70px' } }), gap = h('input', { type: 'number', min: 0, value: 40, style: { width: '70px' } });
    UI.dialog('Расставить сеткой', h('div', { class: 'form' }, h('label', {}, 'Колонок ', colsIn), h('label', {}, 'Отступ, px ', gap)),
      [{ label: 'Отмена' }, { label: 'Расставить', primary: true, action: () => FigTools.wrap(() => FigTools.plug('Расставить сеткой', `
        const s = figma.currentPage.selection.slice(); if (s.length < 2) throw new Error('Выделите несколько слоёв');
        s.sort((p, q) => Math.abs(p.y - q.y) > 20 ? p.y - q.y : p.x - q.x);
        const cw = Math.max(...s.map(n => n.width)), ch = Math.max(...s.map(n => n.height)), x0 = Math.min(...s.map(n => n.x)), y0 = Math.min(...s.map(n => n.y));
        s.forEach((n, i) => { n.x = x0 + (i % a.cols) * (cw + a.gap); n.y = y0 + Math.floor(i / a.cols) * (ch + a.gap); });`, { cols: Math.max(1, +colsIn.value || 3), gap: +gap.value || 0 }))() }]);
  },
  async clean() {
    const hidden = h('input', { type: 'checkbox', checked: true }), pix = h('input', { type: 'checkbox', checked: true });
    UI.dialog('Чистка макета', h('div', { class: 'form' }, h('label', { class: 'row' }, pix, ' округлить положение и размеры до целых пикселей'), h('label', { class: 'row' }, hidden, ' удалить скрытые слои'), h('p', { class: 'muted small' }, 'Выделение — или вся страница, если ничего не выделено.')),
      [{ label: 'Отмена' }, { label: 'Почистить', primary: true, action: () => FigTools.wrap(async () => {
        const r = await FigTools.plug('Чистка макета', `
          const roots = figma.currentPage.selection.length ? figma.currentPage.selection.slice() : figma.currentPage.children.slice();
          const all = []; const walk = n => { all.push(n); if (n.children) n.children.forEach(walk); }; roots.forEach(walk);
          let del = 0, fix = 0;
          if (a.hidden) for (const n of all.slice().reverse()) if (n.visible === false) { try { n.remove(); del++; } catch (e) { } }
          if (a.pix) for (const n of all) { try { if (n.removed) continue; const x = Math.round(n.x), y = Math.round(n.y); if (x !== n.x || y !== n.y) { n.x = x; n.y = y; fix++; } if (n.type !== 'TEXT' && n.type !== 'LINE' && (Math.round(n.width) !== n.width || Math.round(n.height) !== n.height)) { n.resize(Math.max(1, Math.round(n.width)), Math.max(1, Math.round(n.height))); fix++; } } catch (e) { } }
          io.out = { del, fix };`, { hidden: hidden.checked, pix: pix.checked });
        UI.toast(`Удалено скрытых: ${r.del}, выровнено: ${r.fix}`);
      })() }]);
  },
  async chart() {
    const data = h('textarea', { rows: 6, class: 'wide' }, 'Янв 120\nФев 180\nМар 150\nАпр 240\nМай 210');
    const color = h('input', { type: 'color', value: '#2e8b38' });
    UI.dialog('Диаграмма', h('div', { class: 'form' }, h('label', {}, 'Данные: подпись и число в строке', data), h('label', {}, 'Цвет ', color)),
      [{ label: 'Отмена' }, { label: 'Построить', primary: true, action: () => FigTools.wrap(async () => {
        const rows = data.value.split('\n').map(s => s.trim().match(/^(.*?)[\s;:,]+(-?[\d.,]+)$/)).filter(Boolean).map(m => ({ l: m[1], v: parseFloat(m[2].replace(',', '.')) }));
        if (!rows.length) return UI.toast('Нет данных', true);
        const max = Math.max(...rows.map(r => r.v)), W = 80 * rows.length + 40, H = 320, bw = 48;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>`;
        rows.forEach((r, i) => {
          const hh = Math.max(2, r.v / max * (H - 90)), x = 30 + i * 80, y = H - 40 - hh;
          svg += `<rect x="${x}" y="${y}" width="${bw}" height="${hh}" rx="6" fill="${color.value}"/><text x="${x + bw / 2}" y="${H - 16}" font-size="14" text-anchor="middle" fill="#444" font-family="Inter">${Render.esc(r.l)}</text><text x="${x + bw / 2}" y="${y - 8}" font-size="14" text-anchor="middle" fill="#111" font-family="Inter">${r.v}</text>`;
        });
        svg += `<line x1="20" y1="${H - 40}" x2="${W - 10}" y2="${H - 40}" stroke="#ccc"/></svg>`;
        const api = await FigmaWS.api(); await api.pasteSVG(svg);
        UI.toast('Диаграмма добавлена');
      })() }]);
  },
};
