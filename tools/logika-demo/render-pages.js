// рендер всех опубликованных страниц CMS в JSON для HTML-просмотра
const path = require('path'), fs = require('fs');
const ROOT = '/home/user/vi/dom-konstruktor';
const h = require(ROOT + '/pages.js')({ send() {}, PUBLIC_URL: 'https://logikadoma.ru', ROOT, DATA: process.argv[2] });
const css = fs.readFileSync(ROOT + '/css/pages.css', 'utf8');
const ld = fs.readFileSync(ROOT + '/brand/ld.css', 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '');
const logo = 'data:image/svg+xml;base64,' + fs.readFileSync(ROOT + '/brand/logo-horizontal.svg').toString('base64');
const req = { headers: {} }, out = {};
h.store.all().filter(r => r.status === 'published' && r.path !== '/').forEach(r => {
  out[r.path] = h.preview(req, r).replace('<link rel="stylesheet" href="/css/pages.css">', '<style>' + css + '</style>').replace('<link rel="stylesheet" href="/brand/ld.css">', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap"><style>' + ld + '</style>').split('/brand/logo-horizontal.svg').join(logo).replace(/\/brand\/(favicon-32|apple-touch-icon)\.png/g, 'data:,');
});
process.stdout.write(JSON.stringify(out));
