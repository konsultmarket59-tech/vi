// Сборка рабочего пространства «Фигма» — открытого редактора OpenPencil (MIT) — в папку figma/.
// Нужны git и bun (https://bun.sh). Запуск: node tools/figma/build.mjs [--src путь-к-исходникам]
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/open-pencil/open-pencil.git'
const COMMIT = 'de913ce91ab83054637269479348c44ada3790aa' // проверенная версия; обновлять вместе с патчами ниже

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const argSrc = process.argv.indexOf('--src')
const src = argSrc > 0 ? path.resolve(process.argv[argSrc + 1]) : path.join(root, '.figma-src')
const out = path.join(root, 'figma')
const run = (cmd, cwd = src, env = {}) => {
  console.log('>', cmd)
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
}

if (!fs.existsSync(path.join(src, 'package.json'))) {
  run(`git clone --filter=blob:none ${REPO} "${src}"`, root)
}
if (argSrc < 0) {
  run('git fetch --depth=200 origin main || true')
  run(`git checkout --force ${COMMIT}`)
}

// ---------- правки для встраивания ----------
function patch(file, from, to) {
  const p = path.join(src, file)
  let s = fs.readFileSync(p, 'utf8')
  if (s.includes(to)) return
  if (!s.includes(from)) throw new Error(`Не нашёл место для правки в ${file}: ${from.slice(0, 60)}`)
  s = s.replace(from, to)
  fs.writeFileSync(p, s)
}
// адреса через # — редактор работает из любой папки и с диска
patch('src/router.ts', "import { createRouter, createWebHistory } from 'vue-router'", "import { createRouter, createWebHashHistory } from 'vue-router'")
patch('src/router.ts', 'history: createWebHistory(),', 'history: createWebHashHistory(),')
// без офлайн-кэша PWA: файлы и так лежат на компьютере
patch('vite.config.ts', 'cloudPortal ? cloudPortalBrandPlugin() : openPencilPwaPlugin()', 'cloudPortal ? cloudPortalBrandPlugin() : process.env.VK_EMBED ? undefined : openPencilPwaPlugin()')
patch('src/boot.ts', "  if (!IS_TAURI) {\n    void import('virtual:pwa-register')", "  void import('./vk-bridge').then((m) => m.installVektorBridge())\n  if (!IS_TAURI && !import.meta.env.VITE_VK_EMBED) {\n    void import('virtual:pwa-register')")
patch('src/app/shell/support/render.ts', "'/brand/app-icon.svg'", "'./brand/app-icon.svg'")
patch('src/app/demo/document.ts', "const DEMO_URL = '/demo.fig'", "const DEMO_URL = './demo.fig'")
// CanvasKit (wasm) ищем рядом со страницей, а не в корне сайта
patch('packages/core/src/canvaskit.ts', "const base = 'env' in import.meta ? import.meta.env.BASE_URL : '/'", "if (typeof document !== 'undefined') return new URL(file, document.baseURI).href\n    const base = 'env' in import.meta ? import.meta.env.BASE_URL : '/'")
patch('index.html', '<img src="/brand/app-icon.svg"', '<img src="./brand/app-icon.svg"')
fs.copyFileSync(path.join(here, 'vk-bridge.ts'), path.join(src, 'src', 'vk-bridge.ts'))
// virtual:pwa-register остаётся в коде, но не вызывается — заглушка для сборщика
const stubDir = path.join(src, 'src', 'vk-stub')
fs.mkdirSync(stubDir, { recursive: true })
fs.writeFileSync(path.join(stubDir, 'pwa-register.ts'), 'export function registerSW() { return () => Promise.resolve() }\n')
patch('vite.config.ts', 'alias: createOpenPencilAliases(__dirname, { cloud })', "alias: [...(process.env.VK_EMBED ? [{ find: 'virtual:pwa-register', replacement: resolve(__dirname, 'src/vk-stub/pwa-register.ts') }] : []), ...createOpenPencilAliases(__dirname, { cloud })]")

// ---------- сборка ----------
run('bun install')
run('bun run build:packages')
run('bunx vite build --base ./', src, { VK_EMBED: '1', VITE_VK_EMBED: '1', VITE_OPENPENCIL_CLOUD: 'off' })

fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(path.join(src, 'dist'), out, { recursive: true })
for (const f of ['sw.js', '_headers', '_redirects', 'manifest.webmanifest']) fs.rmSync(path.join(out, f), { force: true })
for (const f of fs.readdirSync(out)) if (/^workbox-.*\.js$/.test(f)) fs.rmSync(path.join(out, f))
fs.copyFileSync(path.join(here, 'vk-boot.js'), path.join(out, 'vk-boot.js'))
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(out, 'LICENSE.openpencil.txt'))
const indexPath = path.join(out, 'index.html')
let html = fs.readFileSync(indexPath, 'utf8')
html = html.replace(/<link rel="manifest"[^>]*>/, '').replace('<head>', '<head>\n    <script src="./vk-boot.js"></script>')
fs.writeFileSync(indexPath, html)
console.log('Готово:', out)
