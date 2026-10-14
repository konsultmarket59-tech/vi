// Готовит код для Тильды: сжимает tilda-block.html и делит его на несколько блоков T123,
// потому что один блок Тильды не принимает столько текста.
// Каждая часть кладёт свой кусок скрипта в window.__nlParts; когда на странице собраны все части,
// скрипт склеивается и запускается. Порядок блоков на странице не важен.
// Запуск (нужен Node.js): npm i --no-save html-minifier-terser@7.2.0 terser@5.31.6 && node minify.cjs
const fs = require('fs');
const path = require('path');
const { minify: minifyHtml } = require('html-minifier-terser');
const { minify: minifyJs } = require('terser');

const PARTS = 3;
const here = __dirname;
const src = fs.readFileSync(path.join(here, 'tilda-block.html'), 'utf8');
const a = src.indexOf('<script>'), b = src.lastIndexOf('</script>');
const markup = src.slice(0, a), code = src.slice(a + 8, b);

(async () => {
  const html = await minifyHtml(markup, { collapseWhitespace: true, conservativeCollapse: true, removeComments: true, minifyCSS: { level: 1 } });
  const js = (await minifyJs(code, { compress: { passes: 2 }, mangle: true, format: { comments: false, quote_style: 1 } })).code;
  // делим так, чтобы блоки были примерно равны: в первом ещё разметка и стили
  const per = Math.ceil((html.length + js.length) / PARTS), cuts = [0];
  for (let i = 1; i < PARTS; i++) cuts.push(Math.min(js.length, i * per - html.length));
  cuts.push(js.length);
  const loader = (i, chunk) => '<script>(function(i,n,s){var w=window,q=w.__nlParts=w.__nlParts||{};q[i]=s;for(var k=0;k<n;k++)if(q[k]==null)return;if(q.done)return;q.done=1;'
    + 'var go=function(){var t="";for(var k=0;k<n;k++)t+=q[k];var e=document.createElement("script");e.text=t;document.body.appendChild(e)};'
    + 'document.getElementById("nl-plan")?go():document.addEventListener("DOMContentLoaded",go)})(' + i + ',' + PARTS + ','
    + JSON.stringify(chunk).replace(/<\//g, '<\\/') + ');</script>';
  const dir = path.join(here, 'tilda');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < PARTS; i++) {
    const head = `<!-- Новая Земля · примерка планировки · блок ${i + 1} из ${PARTS}. Вставьте в отдельный блок T123. Нужны все ${PARTS} блока на одной странице. -->\n`;
    const out = head + (i === 0 ? html : '') + loader(i, js.slice(cuts[i], cuts[i + 1]));
    fs.writeFileSync(path.join(dir, `block-${i + 1}.html`), out);
    console.log(`tilda/block-${i + 1}.html: ${out.length} символов`);
  }
})();
