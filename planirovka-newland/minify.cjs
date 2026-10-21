// Готовит код для Тильды: сжимает tilda-block.html (КЛАССИК) и tilda-block-smart.html (СМАРТ)
// и делит каждый на блоки T123 не больше LIMIT символов — один блок Тильды столько текста не принимает.
// Каждая часть кладёт свой кусок скрипта в window[ключ серии]; когда на странице собраны все части,
// скрипт склеивается и запускается. Порядок блоков на странице не важен.
// Запуск (нужен Node.js): npm i --no-save html-minifier-terser@7.2.0 terser@5.31.6 && node minify.cjs
const fs = require('fs');
const path = require('path');
const { minify: minifyHtml } = require('html-minifier-terser');
const { minify: minifyJs } = require('terser');

const LIMIT = 30000;
const here = __dirname;
const SERIES = [
  { src: 'tilda-block.html', dir: 'tilda', key: '__nlPartsClassic', name: 'КЛАССИК' },
  { src: 'tilda-block-smart.html', dir: 'tilda-smart', key: '__nlPartsSmart', name: 'СМАРТ' },
];

(async () => {
  for (const S of SERIES) {
    const src = fs.readFileSync(path.join(here, S.src), 'utf8');
    const a = src.indexOf('<script>'), b = src.lastIndexOf('</script>');
    const html = await minifyHtml(src.slice(0, a), { collapseWhitespace: true, conservativeCollapse: true, removeComments: true, minifyCSS: { level: 1 } });
    const js = (await minifyJs(src.slice(a + 8, b), { compress: { passes: 2 }, mangle: true, format: { comments: false, quote_style: 1 } })).code;
    // строка с куском кода растёт из-за экранирования — берём запас
    const esc = JSON.stringify(js).length / js.length, budget = Math.floor((LIMIT - 900) / esc);
    const parts = Math.max(2, Math.ceil((html.length / esc + js.length) / budget));
    const per = Math.ceil((html.length / esc + js.length) / parts), cuts = [0];
    for (let i = 1; i < parts; i++) cuts.push(Math.max(0, Math.min(js.length, Math.round(i * per - html.length / esc))));
    cuts.push(js.length);
    const loader = (i, chunk) => '<script>(function(i,n,s){var w=window,q=w.' + S.key + '=w.' + S.key + '||{};q[i]=s;for(var k=0;k<n;k++)if(q[k]==null)return;if(q.done)return;q.done=1;'
      + 'var go=function(){var t="";for(var k=0;k<n;k++)t+=q[k];var e=document.createElement("script");e.text=t;document.body.appendChild(e)};'
      + 'document.getElementById("nl-plan")?go():document.addEventListener("DOMContentLoaded",go)})(' + i + ',' + parts + ','
      + JSON.stringify(chunk).replace(/<\//g, '<\\/') + ');</script>';
    const dir = path.join(here, S.dir);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < parts; i++) {
      const head = `<!-- Новая Земля · примерка ${S.name} · блок ${i + 1} из ${parts}. Вставьте в отдельный блок T123. Нужны все ${parts} блока на одной странице. -->\n`;
      const out = head + (i === 0 ? html : '') + loader(i, js.slice(cuts[i], cuts[i + 1]));
      fs.writeFileSync(path.join(dir, `block-${i + 1}.html`), out);
      console.log(`${S.dir}/block-${i + 1}.html: ${out.length} символов`);
    }
  }
})();
