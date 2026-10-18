// Проекты «Фигмы», как в Figma: папка на компьютере — проект, в ней файлы .fig.
// Слева — список файлов с миниатюрами; файл открывается во вкладке редактора, изменения
// сами сохраняются обратно в папку проекта. Отдельные файлы открываются как раньше.
'use strict';

const FigProject = {
  list: [],          // [{ id, name, root?, handle? }]
  cur: null,         // id текущего проекта
  files: [],         // файлы текущего проекта
  tabs: {},          // id вкладки редактора → rel файла в проекте
  thumbs: {},        // rel → dataURL
  el: null, open: true,

  async init() {
    FigProject.list = (await Docs.get('figProjects')) || [];
    if (Host.desktop && vkHost.projFolders) {
      const roots = await vkHost.projFolders().catch(() => []);
      for (const r of roots) if (!FigProject.list.some(p => p.root === r)) FigProject.list.push({ id: 'fp' + Date.now() + Math.random().toString(36).slice(2, 5), name: r.split(/[\\/]/).filter(Boolean).pop(), root: r });
      FigProject.list = FigProject.list.filter(p => !p.root || roots.includes(p.root));
    }
    FigProject.cur = (await Docs.get('figProjectCur')) || (FigProject.list[0] && FigProject.list[0].id) || null;
    FigProject.open = localStorage.getItem('vektor.figProjOpen') !== '0';
    await FigProject.refresh().catch(() => { });
    setInterval(() => FigProject.autosave().catch(e => console.warn('Автосохранение проекта', e)), 15000);
  },
  async save() {
    const rows = FigProject.list.map(p => Object.assign({}, p));
    try { await Docs.put('figProjects', rows); } catch (e) { await Docs.put('figProjects', rows.map(p => { const x = Object.assign({}, p); delete x.handle; return x; })).catch(() => { }); }
    await Docs.put('figProjectCur', FigProject.cur);
  },
  project() { return FigProject.list.find(p => p.id === FigProject.cur) || null; },
  folder(p = FigProject.project()) { return p && (p.root ? { name: p.name, root: p.root } : { name: p.name, handle: p.handle }); },

  async add() {
    let p;
    if (Host.desktop && vkHost.projAdd) {
      const root = await vkHost.projAdd('Папка проекта (можно создать новую)');
      if (!root) return;
      p = { id: 'fp' + Date.now(), name: root.split(/[\\/]/).filter(Boolean).pop(), root };
    } else {
      if (!window.showDirectoryPicker) return UI.toast('Проекты работают в настольной версии, Chrome или Edge');
      let handle; try { handle = await showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { return; }
      p = { id: 'fp' + Date.now(), name: handle.name, handle };
    }
    FigProject.list = FigProject.list.filter(x => !(x.root && x.root === p.root));
    FigProject.list.push(p); FigProject.cur = p.id;
    await FigProject.save(); await FigProject.refresh();
    UI.toast('Проект «' + p.name + '» подключён');
  },
  async remove() {
    const p = FigProject.project(); if (!p) return;
    UI.confirm(`Убрать проект «${p.name}» из списка? Файлы на диске останутся.`, async () => {
      FigProject.list = FigProject.list.filter(x => x !== p);
      if (p.root && vkHost.projRemove) vkHost.projRemove(p.root);
      FigProject.cur = FigProject.list[0] ? FigProject.list[0].id : null;
      await FigProject.save(); await FigProject.refresh();
    });
  },
  async refresh() {
    const p = FigProject.project();
    FigProject.files = [];
    if (p) {
      try {
        let files = [];
        if (p.root && Host.desktop) files = (await Host.openFolderPath(p.root)).files;
        else if (p.handle) {
          try { if ((await p.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') await p.handle.requestPermission({ mode: 'readwrite' }); } catch (e) { }
          files = await Host.walkHandle(p.handle);
        }
        FigProject.files = files.filter(f => /\.(fig|pen)$/i.test(f.name) && f.rel.split('/').length <= 2).sort((a, b) => a.rel.localeCompare(b.rel, 'ru'));
        for (const f of FigProject.files) if (!FigProject.thumbs[f.rel]) FigProject.thumbs[f.rel] = await Docs.get('figthumb:' + p.id + '/' + f.rel);
      } catch (e) { console.warn(e); UI.toast('Нет доступа к папке проекта — выберите её заново', true); }
    }
    FigProject.render();
  },

  // ---------- панель ----------
  build() {
    FigProject.el = h('div', { class: 'fp-side' + (FigProject.open ? '' : ' closed') });
    FigProject.render();
    return FigProject.el;
  },
  toggle() {
    FigProject.open = !FigProject.open;
    localStorage.setItem('vektor.figProjOpen', FigProject.open ? '1' : '0');
    FigProject.el.classList.toggle('closed', !FigProject.open);
  },
  render() {
    const el = FigProject.el; if (!el) return;
    el.innerHTML = '';
    const p = FigProject.project();
    const sel = h('select', { class: 'fp-sel', onchange: async e => { if (e.target.value === '+') { e.target.value = FigProject.cur || ''; return FigProject.add(); } FigProject.cur = e.target.value; await FigProject.save(); FigProject.refresh(); } },
      ...FigProject.list.map(x => h('option', { value: x.id, selected: x.id === FigProject.cur }, x.name)),
      h('option', { value: '+' }, '+ Подключить папку проекта…'));
    el.append(h('div', { class: 'fp-head' }, h('b', {}, 'Проект'), h('span', { class: 'grow' }),
      h('button', { class: 'ib', title: 'Скрыть панель', onclick: () => FigProject.toggle() }, '‹')));
    if (!FigProject.list.length) {
      el.append(h('p', { class: 'muted small' }, 'Проект — папка на компьютере, в которой лежат все файлы макетов. Файлы открываются вкладками и сами сохраняются обратно.'),
        h('button', { class: 'primary', onclick: () => FigProject.add() }, '+ Папка проекта'));
      return;
    }
    el.append(sel,
      h('div', { class: 'fp-acts' },
        h('button', { class: 'pbt', title: 'Новый файл в проекте', onclick: () => FigProject.newFile() }, '+ Файл'),
        h('button', { class: 'pbt', title: 'Сохранить открытую вкладку в проект', onclick: () => FigProject.saveActive(true) }, 'Сохранить'),
        h('button', { class: 'ib', title: 'Обновить список', onclick: () => FigProject.refresh() }, '↻'),
        h('button', { class: 'ib', title: 'Убрать проект из списка', onclick: () => FigProject.remove() }, '×')));
    const list = h('div', { class: 'fp-list' });
    if (!FigProject.files.length) list.append(h('p', { class: 'muted small' }, 'В проекте пока нет файлов. «+ Файл» — новый макет, или откройте файл и нажмите «Сохранить».'));
    const openRels = new Set(Object.values(FigProject.tabs));
    for (const f of FigProject.files) {
      const th = FigProject.thumbs[f.rel];
      list.append(h('div', { class: 'fp-file' + (openRels.has(f.rel) ? ' open' : ''), title: f.rel, onclick: () => FigProject.openFile(f) },
        th ? h('img', { src: th }) : h('div', { class: 'fp-noth' }, f.name.split('.').pop().toUpperCase()),
        h('span', {}, f.name.replace(/\.(fig|pen)$/i, ''))));
    }
    el.append(list, h('p', { class: 'muted small fp-hint' }, 'Изменения сохраняются в папку проекта автоматически каждые 15 с.'));
  },

  // ---------- файлы ----------
  async openFile(f) {
    const api = await FigmaWS.api();
    const tabs = api.tabs ? api.tabs() : [];
    const had = Object.entries(FigProject.tabs).find(([id, rel]) => rel === f.rel && tabs.some(t => t.id === id));
    if (had && api.switchTab) { api.switchTab(had[0]); return; }
    try {
      const buf = await f.read();
      const id = api.openTab ? await api.openTab(buf, f.name) : (await api.open(buf, f.name), null);
      if (id) FigProject.tabs[id] = f.rel;
      FigProject.render();
    } catch (e) { UI.toast('Не удалось открыть ' + f.name + ': ' + (e.message || e), true); }
  },
  async newFile() {
    const p = FigProject.project(); if (!p) return FigProject.add();
    UI.prompt('Название файла', 'Без названия', async name => {
      name = (name || 'Без названия').replace(/[\\/:*?"<>|]+/g, '-').trim();
      let rel = name + '.fig', k = 2;
      while (FigProject.files.some(f => f.rel.toLowerCase() === rel.toLowerCase())) rel = `${name} ${k++}.fig`;
      const api = await FigmaWS.api();
      await api.newDocument();
      FigProject.tabs[api.activeTab()] = rel;
      await FigProject.saveActive(false, rel);
    });
  },
  // сохранить активную вкладку: если она из проекта — в её файл, иначе (ask) — новым файлом проекта
  async saveActive(ask, relForce) {
    const p = FigProject.project(); if (!p) return FigProject.add();
    const api = await FigmaWS.api();
    const tab = api.activeTab ? api.activeTab() : null;
    let rel = relForce || FigProject.tabs[tab];
    if (!rel) {
      if (!ask) return;
      const t = (api.tabs ? api.tabs() : []).find(x => x.id === tab);
      const base = String((t && t.name) || 'Макет').replace(/\.(fig|pen)$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
      rel = base + '.fig'; let k = 2;
      while (FigProject.files.some(f => f.rel.toLowerCase() === rel.toLowerCase())) rel = `${base} ${k++}.fig`;
      FigProject.tabs[tab] = rel;
    }
    if (/\.pen$/i.test(rel)) rel = rel.replace(/\.pen$/i, '.fig');
    const buf = await api.exportFig(rel.replace(/\.fig$/i, ''));
    await Host.writeToFolder(FigProject.folder(p), rel, new Uint8Array(buf));
    if (api.markSaved) api.markSaved();
    try {
      const png = await api.exportPNG(0.25);
      if (png) { const th = await Polza.thumb(new Blob([png], { type: 'image/png' }), 240, 'image/png'); FigProject.thumbs[rel] = th; await Docs.put('figthumb:' + p.id + '/' + rel, th); }
    } catch (e) { }
    if (!FigProject.files.some(f => f.rel === rel)) await FigProject.refresh(); else FigProject.render();
    if (ask) UI.toast('Сохранено в проект: ' + rel);
  },
  async autosave() {
    if (!FigProject.project() || !FigmaWS.frame) return;
    let api; try { api = await Promise.race([FigmaWS.ready, new Promise(r => setTimeout(() => r(null), 50))]); } catch (e) { return; }
    if (!api || !api.activeTab) return;
    const tab = api.activeTab();
    if (FigProject.tabs[tab] && api.isDirty()) await FigProject.saveActive(false);
  },
};
