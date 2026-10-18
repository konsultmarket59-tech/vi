// Мост «Вектора» к встроенному редактору OpenPencil (рабочее пространство «Фигма»).
// Окно «Вектора» вызывает window.vkFigma: открыть файл, вставить SVG и картинки, отдать
// выделение картинкой или SVG и запустить плагин Figma (manifest.json + код + интерфейс).
import { exportFigFile, renderNodesToSVG } from '@open-pencil/core'

import { aiModelSettings } from '@/app/ai/models'
import { setAPIKey } from '@/app/ai/chat/storage'
import { aiSetupDialogOpen, closeAISetup } from '@/app/ai/models/settings/onboarding/dialog'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { executeWithDocumentUndo } from '@/app/automation/execution/editor'
import { pastePoint, pasteSVGText } from '@/app/editor/clipboard/paste/content'
import { openDesignFile } from '@/app/shell/menu/files'
import { browserCredentialsRemembered, setBrowserCredentialPersistence } from '@/app/settings/credentials/app'
import { allTabs, closeTab, createTab, getActiveStore, getActiveTabId, switchTab } from '@/app/tabs'

type AnyStore = any

type PluginSource = {
  name: string
  code: string
  html?: string
  uiFiles?: Record<string, string>
}

const store = (): AnyStore => {
  const s = getActiveStore() as AnyStore
  if (!s) throw new Error('Откройте или создайте документ')
  return s
}

function selectionIds(s: AnyStore): string[] {
  return [...s.state.selectedIds]
}

function pageChildren(s: AnyStore): string[] {
  const page = s.graph.getNode(s.state.currentPageId)
  return page?.childIds ? [...page.childIds] : []
}

// ---------- окно плагина ----------
function pluginWindow(title: string, onClose: () => void) {
  const box = document.createElement('div')
  box.style.cssText =
    'position:fixed;right:300px;top:80px;z-index:99999;background:#2c2c2c;border:1px solid #444;' +
    'border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto'
  const head = document.createElement('div')
  head.style.cssText =
    'height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 8px;' +
    'color:#eee;font:12px sans-serif;cursor:move;background:#383838;user-select:none'
  const t = document.createElement('span')
  t.textContent = title
  const x = document.createElement('button')
  x.textContent = '✕'
  x.style.cssText = 'background:none;border:0;color:#ccc;cursor:pointer;font-size:13px'
  x.onclick = () => onClose()
  head.append(t, x)
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals allow-downloads')
  frame.style.cssText = 'border:0;background:#fff;display:block'
  box.append(head, frame)
  head.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    const move = (ev: PointerEvent) => {
      box.style.left = ev.clientX - dx + 'px'
      box.style.top = ev.clientY - dy + 'px'
      box.style.right = 'auto'
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
  document.body.append(box)
  return { box, frame }
}

const runningPlugins = new Set<() => void>()

async function runPlugin(src: PluginSource): Promise<void> {
  const s = store()
  const pageId = s.state.currentPageId
  const figma = makeFigmaFromStore(s, pageId) as AnyStore
  let win: ReturnType<typeof pluginWindow> | null = null
  let closed = false
  const handlers: Record<string, Set<(...a: unknown[]) => unknown>> = {}
  const emit = (ev: string, ...a: unknown[]) => handlers[ev]?.forEach((f) => f(...a))
  const withUndo = <T>(fn: () => Promise<T> | T) =>
    executeWithDocumentUndo(s, pageId, `Плагин: ${src.name}`, async () => {
      const r = await fn()
      s.requestRender()
      return r
    })

  const ui: AnyStore = {
    onmessage: null as null | ((msg: unknown, props?: unknown) => unknown),
    postMessage(msg: unknown) {
      win?.frame.contentWindow?.postMessage({ pluginMessage: msg, pluginId: src.name }, '*')
    },
    on(ev: string, f: (...a: unknown[]) => unknown) {
      ;(handlers['ui:' + ev] ??= new Set()).add(f)
    },
    once(ev: string, f: (...a: unknown[]) => unknown) {
      const w = (...a: unknown[]) => {
        handlers['ui:' + ev]?.delete(w)
        return f(...a)
      }
      ui.on(ev, w)
    },
    off(ev: string, f: (...a: unknown[]) => unknown) {
      handlers['ui:' + ev]?.delete(f)
    },
    show() {
      if (win) win.box.style.display = 'flex'
    },
    hide() {
      if (win) win.box.style.display = 'none'
    },
    resize(w: number, h: number) {
      if (win) {
        win.frame.style.width = w + 'px'
        win.frame.style.height = h + 'px'
      }
    },
    close() {
      close()
    }
  }

  const onWindowMessage = (e: MessageEvent) => {
    if (!win || e.source !== win.frame.contentWindow) return
    const msg = (e.data && e.data.pluginMessage) ?? undefined
    if (msg === undefined) return
    void withUndo(async () => {
      if (typeof ui.onmessage === 'function') await ui.onmessage(msg, { origin: 'vektor' })
      for (const f of handlers['ui:message'] ?? []) await f(msg, { origin: 'vektor' })
    }).catch((err) => console.error('[plugin]', err))
  }
  window.addEventListener('message', onWindowMessage)

  function close() {
    if (closed) return
    closed = true
    emit('close')
    window.removeEventListener('message', onWindowMessage)
    win?.box.remove()
    runningPlugins.delete(close)
  }
  runningPlugins.add(close)

  const storageKey = (k: string) => `vk-plugin:${src.name}:${k}`
  const extras: Record<string, unknown> = {
    ui,
    showUI(html: string, opts: { width?: number; height?: number; visible?: boolean; title?: string } = {}) {
      win = pluginWindow(opts.title || src.name, close)
      win.frame.srcdoc = html
      ui.resize(opts.width ?? 300, opts.height ?? 200)
      if (opts.visible === false) ui.hide()
    },
    closePlugin(message?: string) {
      if (message) extras.notify && (extras.notify as (m: string) => void)(message)
      close()
    },
    notify(message: string) {
      const n = document.createElement('div')
      n.textContent = message
      n.style.cssText =
        'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#111;color:#fff;' +
        'padding:8px 14px;border-radius:6px;font:13px sans-serif;z-index:100000'
      document.body.append(n)
      setTimeout(() => n.remove(), 3000)
      return { cancel: () => n.remove() }
    },
    on(ev: string, f: (...a: unknown[]) => unknown) {
      ;(handlers[ev] ??= new Set()).add(f)
    },
    once(ev: string, f: (...a: unknown[]) => unknown) {
      ;(handlers[ev] ??= new Set()).add(f)
    },
    off(ev: string, f: (...a: unknown[]) => unknown) {
      handlers[ev]?.delete(f)
    },
    clientStorage: {
      async getAsync(k: string) {
        const v = localStorage.getItem(storageKey(k))
        return v == null ? undefined : JSON.parse(v)
      },
      async setAsync(k: string, v: unknown) {
        localStorage.setItem(storageKey(k), JSON.stringify(v))
      },
      async deleteAsync(k: string) {
        localStorage.removeItem(storageKey(k))
      },
      async keysAsync() {
        const pre = storageKey('')
        return Object.keys(localStorage)
          .filter((k) => k.startsWith(pre))
          .map((k) => k.slice(pre.length))
      }
    },
    editorType: 'figma',
    mode: 'default',
    pluginId: src.name,
    command: '',
    apiVersion: '1.0.0',
    skipInvisibleInstanceChildren: false,
    async loadAllPagesAsync() {}
  }
  // недостающее в API OpenPencil сообщаем в консоль, а не роняем плагин
  const proxy = new Proxy(figma, {
    get(target, key: string) {
      if (key in extras) return extras[key]
      const v = target[key]
      if (v === undefined && typeof key === 'string' && !key.startsWith('__'))
        console.warn(`[plugin ${src.name}] figma.${key} пока не поддерживается`)
      return typeof v === 'function' ? v.bind(target) : v
    },
    set(target, key: string, value) {
      if (key in extras) extras[key] = value
      else target[key] = value
      return true
    }
  })

  const html = src.html ?? ''
  const run = new Function('figma', '__html__', '__uiFiles__', 'console', src.code)
  await withUndo(async () => {
    const r = run(proxy, html, src.uiFiles ?? {}, console)
    if (r && typeof r.then === 'function') await r
  })
}

// ---------- ИИ только через Polza: подключение из настроек агента «Вектора» ----------
// Окно «Вектора» и редактор живут в одном источнике, поэтому настройки читаются напрямую.
async function configurePolza(): Promise<boolean> {
  let cfg: { baseUrl?: string; apiKey?: string; model?: string } = {}
  try {
    cfg = JSON.parse(localStorage.getItem('vektor.agent') || '{}')
  } catch {}
  if (!cfg.apiKey) return false
  let base = (cfg.baseUrl || 'https://polza.ai/api/v1').replace(/\/+$/, '')
  // в настольной версии запросы идут через главный процесс (без ограничений CORS)
  if (location.protocol === 'vk:') base = `${location.origin}/__net/${base.replace('://', '/')}`
  const model = cfg.model || 'anthropic/claude-sonnet-5'
  const sig = [base, model, cfg.apiKey].join('|')
  const settings = aiModelSettings.value as AnyStore
  const has = settings.connections.some((c: AnyStore) => c.id === 'connection-polza')
  if (has && localStorage.getItem('vk:polza-sig') === sig) return true
  aiModelSettings.value = {
    version: 1,
    connections: [
      {
        id: 'connection-polza',
        providerID: 'openai-compatible',
        customBaseURL: base,
        customAPIType: 'completions',
        credentialProfileId: 'polza'
      },
      ...settings.connections.filter((c: AnyStore) => c.id !== 'connection-polza')
    ],
    models: [
      {
        id: 'model-polza',
        name: `Polza · ${model}`,
        connectionId: 'connection-polza',
        modelID: model,
        customModelID: model,
        maxOutputTokens: 16000,
        thinkingLevel: 'default',
        capabilities: ['tools', 'vision']
      },
      ...settings.models.filter((m: AnyStore) => m.id !== 'model-polza')
    ],
    assignments: { ...settings.assignments, design: 'model-polza', vision: 'design' }
  } as AnyStore
  if (!browserCredentialsRemembered.value) await setBrowserCredentialPersistence(true, [])
  await setAPIKey(cfg.apiKey)
  localStorage.setItem('vk:polza-sig', sig)
  return true
}

// ---------- API для окна «Вектора» ----------
const api = {
  ready: true,
  async open(bytes: ArrayBuffer, name: string) {
    await openDesignFile(new File([bytes], name))
  },
  async pasteSVG(svg: string) {
    const s = store()
    return pasteSVGText(s, svg)
  },
  async placeImages(items: { bytes: ArrayBuffer; name: string; type: string }[]) {
    const s = store()
    const files = items.map((i) => new File([i.bytes], i.name, { type: i.type }))
    const { x, y } = pastePoint(s)
    await s.placeFiles(files, x, y)
  },
  selection() {
    const s = store()
    return selectionIds(s).map((id) => {
      const n = s.graph.getNode(id)
      return { id, name: n?.name, type: n?.type, width: n?.width, height: n?.height }
    })
  },
  // картинка выделения (или всей страницы) в PNG
  async exportPNG(scale = 2, ids?: string[]) {
    const s = store()
    const list = ids?.length ? ids : selectionIds(s).length ? selectionIds(s) : pageChildren(s)
    if (!list.length) return null
    const data = await s.renderExportImage(list, scale, 'PNG', s.state.currentPageId)
    return data ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null
  },
  exportSVG(ids?: string[]) {
    const s = store()
    const list = ids?.length ? ids : selectionIds(s).length ? selectionIds(s) : pageChildren(s)
    if (!list.length) return null
    return renderNodesToSVG(s.graph, s.state.currentPageId, list)
  },
  // кадры текущей страницы — для моушн-дизайна
  frames() {
    const s = store()
    return pageChildren(s).map((id) => {
      const n = s.graph.getNode(id)
      return { id, name: n?.name, type: n?.type, width: n?.width, height: n?.height }
    })
  },
  // ---------- конвертер: документ «Вектора» ↔ .fig ----------
  async newDocument() {
    createTab()
    await new Promise((r) => setTimeout(r, 400))
  },
  // ---------- вкладки: для проектов «Вектора» (папка с файлами .fig на компьютере) ----------
  tabs() {
    return allTabs.value.map((t) => ({ id: t.id, name: t.name, dirty: t.isDirty, active: t.isActive, home: t.isHome }))
  },
  activeTab() {
    return getActiveTabId()
  },
  switchTab(id: string) {
    return switchTab(id)
  },
  async closeTab(id: string, unsaved: 'save' | 'discard' = 'discard') {
    await closeTab(id, unsaved)
  },
  // открыть файл и вернуть id его вкладки
  async openTab(bytes: ArrayBuffer, name: string) {
    await openDesignFile(new File([bytes], name))
    await new Promise((r) => setTimeout(r, 50))
    return getActiveTabId()
  },
  isDirty() {
    return !!store().hasUnsavedChanges?.()
  },
  markSaved() {
    store().markDocumentSaved?.()
  },
  select(ids: string[]) {
    const s = store()
    s.select(ids)
    s.requestRender?.()
  },
  async importSVG(svg: string, x = 0, y = 0) {
    const s = store()
    return s.pasteSVG(svg, x, y)
  },
  async exportFig(name?: string): Promise<ArrayBuffer> {
    const s = store()
    const bytes = await exportFigFile(s.graph, { ck: s.renderer?.ck, renderer: s.renderer, documentName: name })
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  },
  // все страницы открытого файла — SVG для «Вектора»
  pagesSVG() {
    const s = store()
    return s.graph.getPages().map((page: AnyStore) => {
      const ids = s.graph.getChildren(page.id).filter((n: AnyStore) => !n.internalOnly).map((n: AnyStore) => n.id)
      return { name: page.name, svg: ids.length ? renderNodesToSVG(s.graph, page.id, ids) : null }
    })
  },
  runPlugin,
  configurePolza,
  closePlugins() {
    for (const c of [...runningPlugins]) c()
  }
}

export function installVektorBridge(): void {
  ;(window as any).vkFigma = api
  void configurePolza().catch((e) => console.warn('[vektor] Polza', e))
  // ИИ здесь настраивается в «Векторе» (Polza) — приветствие с выбором провайдера не нужно
  const hideWelcome = () => { if (aiSetupDialogOpen.value) closeAISetup() }
  hideWelcome()
  setTimeout(hideWelcome, 500)
  setTimeout(hideWelcome, 2000)
  window.dispatchEvent(new Event('vk-figma-ready'))
}
