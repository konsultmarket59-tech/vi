// Доступ к файлам и сети: в настольной версии — через главный процесс Electron,
// в браузере — через File System Access API (Chrome, Edge) или обычное скачивание.
'use strict';

const Host = {
  desktop: !!window.vkHost,

  extOf: name => (String(name).match(/\.([^.\/\\]+)$/) || [, ''])[1].toLowerCase(),

  // папка: { name, root?, handle?, files: [{ rel, name, size, read() }] }
  async pickFolder(title = 'Выберите папку') {
    if (Host.desktop) {
      const root = await vkHost.pickFolder(title);
      if (!root) return null;
      return Host.openFolderPath(root);
    }
    if (!window.showDirectoryPicker) { UI.toast('Выбор папок работает в Chrome, Edge или настольной версии'); return null; }
    try {
      const handle = await showDirectoryPicker({ mode: 'readwrite' });
      return { name: handle.name, handle, files: await Host.walkHandle(handle) };
    } catch (e) { return null; }
  },
  async openFolderPath(root) {
    const list = await vkHost.list(root);
    return {
      name: root.split(/[\\/]/).filter(Boolean).pop(), root,
      files: list.map(f => ({ rel: f.rel, name: f.name, size: f.size, path: f.path, read: () => vkHost.read(f.path) })),
    };
  },
  async walkHandle(dir, prefix = '', out = [], depth = 0) {
    if (depth > 6 || out.length > 3000) return out;
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') await Host.walkHandle(h, prefix + name + '/', out, depth + 1);
      else {
        let size = 0;
        try { size = (await h.getFile()).size; } catch (e) { }
        out.push({ rel: prefix + name, name, size, handle: h, read: async () => (await h.getFile()).arrayBuffer() });
      }
    }
    return out;
  },
  // отдельные файлы
  async pickFiles(accept = '', multiple = true, title) {
    if (Host.desktop) {
      const exts = accept.split(',').map(s => s.trim().replace(/^\./, '')).filter(s => s && !s.includes('/'));
      const paths = await vkHost.pickFiles({ title, multiple, filters: exts.length ? [{ name: 'Файлы', extensions: exts }, { name: 'Все файлы', extensions: ['*'] }] : undefined });
      return paths.map(p => ({ rel: p.split(/[\\/]/).pop(), name: p.split(/[\\/]/).pop(), path: p, read: () => vkHost.read(p) }));
    }
    return new Promise(res => {
      const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
      inp.addEventListener('change', () => { res([...inp.files].map(f => ({ rel: f.name, name: f.name, size: f.size, file: f, read: () => f.arrayBuffer() }))); inp.remove(); });
      document.body.append(inp); inp.click();
    });
  },
  // сохранить файл, спросив место (data: Blob | string | ArrayBuffer)
  async saveFile(name, data, mime = 'application/octet-stream', ext) {
    ext = ext || Host.extOf(name);
    if (Host.desktop) {
      const p = await vkHost.saveDialog({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
      if (!p) return null;
      await vkHost.write(p, await Host.toBuffer(data));
      return p;
    }
    if (window.showSaveFilePicker) {
      try {
        const hd = await showSaveFilePicker({ suggestedName: name, types: ext ? [{ description: ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }] : undefined });
        const w = await hd.createWritable(); await w.write(data instanceof Blob ? data : new Blob([data], { type: mime })); await w.close();
        return hd.name;
      } catch (e) { if (e.name === 'AbortError') return null; }
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return name;
  },
  // записать файл в выбранную папку (для пакетного вывода агента)
  async writeToFolder(folder, rel, data) {
    if (folder.root && Host.desktop) {
      const sep = Host.desktop && vkHost.platform === 'win32' ? '\\' : '/';
      const p = folder.root + sep + rel.split('/').join(sep);
      await vkHost.write(p, await Host.toBuffer(data));
      return p;
    }
    if (folder.handle) {
      const parts = rel.split('/');
      let dir = folder.handle;
      for (const d of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(d, { create: true });
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable(); await w.write(data instanceof Blob ? data : new Blob([data])); await w.close();
      return folder.name + '/' + rel;
    }
    await Host.saveFile(rel.split('/').pop(), data);
    return rel;
  },
  async toBuffer(data) {
    if (data instanceof ArrayBuffer) return data;
    if (data instanceof Blob) return data.arrayBuffer();
    if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new TextEncoder().encode(String(data)).buffer;
  },
  // HTTP-запрос: в настольной версии — без ограничений CORS
  async fetch(url, opts = {}) {
    if (Host.desktop) {
      const r = await vkHost.fetch({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body });
      return { ok: r.ok, status: r.status, statusText: r.statusText, text: async () => r.body, json: async () => JSON.parse(r.body) };
    }
    return fetch(url, opts);
  },
  // адрес для fetch: в настольной версии внешние запросы идут через главный процесс
  // (vk://app/__net/…) — без CORS, с потоками и двоичными данными
  net(url) { return location.protocol === 'vk:' && /^https?:\/\//.test(url) ? location.origin + '/__net/' + url.replace('://', '/') : url; },
  // локальный файл как адрес (видео и большие картинки без копирования в память)
  fileURL(p) { return location.protocol === 'vk:' ? location.origin + '/__file/?p=' + encodeURIComponent(p) : null; },
  // прочитать файл/запись как Blob
  async blobOf(entry, type) {
    if (entry.file) return entry.file;
    const buf = await entry.read();
    return new Blob([buf], { type: type || Host.mimeOf(entry.name) });
  },
  mimeOf(name) {
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
      json: 'application/json', html: 'text/html', txt: 'text/plain' }[Host.extOf(name)] || 'application/octet-stream';
  },
  // загрузка тяжёлых библиотек по требованию
  _libs: {},
  loadScript(src) {
    if (Host._libs[src]) return Host._libs[src];
    Host._libs[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
      document.head.append(s);
    });
    return Host._libs[src];
  },
  async lib(name) {
    if (name === 'xlsx') { await Host.loadScript('vendor/xlsx.full.min.js'); return window.XLSX; }
    if (name === 'mammoth') { await Host.loadScript('vendor/mammoth.browser.min.js'); return window.mammoth; }
    if (name === 'pdf') {
      // воркер подключается обычным скриптом: так pdf.js работает и с диска (file://)
      await Host.loadScript('vendor/pdf.worker.min.js');
      await Host.loadScript('vendor/pdf.min.js');
      const lib = window.pdfjsLib;
      try { lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; } catch (e) { }
      return lib;
    }
    if (name === 'tracer') { await Host.loadScript('vendor/imagetracer.js'); return window.ImageTracer; }
    if (name === 'psd') { await Host.loadScript('vendor/ag-psd.js'); return window.agPsd; }
    if (name === 'mp4') { await Host.loadScript('vendor/mp4-muxer.js'); return window.Mp4Muxer; }
    if (name === 'webm') { await Host.loadScript('vendor/webm-muxer.js'); return window.WebMMuxer; }
    throw new Error('Нет библиотеки ' + name);
  },
};
