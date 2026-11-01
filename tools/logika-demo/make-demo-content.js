/* Генерация демо-проектов для каталога «Логики Дома»: рендер фасада и планов в конструкторе, файл проекта.
   Запуск: node make-demo-content.js http://localhost:8094 /home/user/vi/dom-konstruktor/demo
   Нужен запущенный server.js и Playwright с Chromium. */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const [B, OUT] = [process.argv[2] || 'http://localhost:8094', process.argv[3] || path.join(__dirname, '../../dom-konstruktor/demo')];
// tpl — номер шаблона формы: 0 прямоугольный, 1 с выступом, 2 Г, 3 Т, 4 П, 5 одноэтажный с эркером
const P = [
  { id: 'demo-skandi', tpl: 0, title: 'Скандинавия', floors: 1, roof: 'gable', pitch: 30, style: 'scandi', terrace: 'back', author: 'a1', price: 0,
    about: 'Одноэтажный дом для семьи из трёх-четырёх человек: просторная кухня-гостиная с выходом на террасу, отдельные спальни, котельная у наружной стены. Простая двускатная кровля без лишних узлов — экономичная стройка.' },
  { id: 'demo-ural', tpl: 0, title: 'Уральский с гаражом', floors: 2, roof: 'hip', pitch: 25, style: 'brick', garage: 2, author: 'a2', price: 2500,
    about: 'Двухэтажный кирпичный дом с гаражом на две машины и входом в дом прямо из гаража. Спальни на втором этаже, кабинет и гостевая на первом. Вальмовая кровля, облицовочный кирпич.' },
  { id: 'demo-sosny', tpl: 0, title: 'Сосны — мансардный', floors: 2, attic: true, roof: 'gable', pitch: 40, style: 'chalet', terrace: 'back', author: 'a1', price: 1500,
    about: 'Дом с мансардой: на первом этаже — кухня-гостиная, санузел и спальня для родителей, в мансарде — детские и гардеробная. Мансарда дешевле полноценного второго этажа на площадь стен и фасада.' },
  { id: 'demo-riviera', tpl: 2, title: 'Ривьера — Г-образный', floors: 2, roof: 'hip', pitch: 25, style: 'american', author: 'a3', price: 3000,
    about: 'Г-образный дом закрывает двор от улицы. В одном крыле — общая зона с кухней и гостиной, в другом — спальни и кабинет. Удобен на широком участке.' },
  { id: 'demo-semeyny', tpl: 3, title: 'Семейный — Т-образный', floors: 2, roof: 'gable', pitch: 30, style: 'twotone', terrace: 'back', author: 'a2', price: 0,
    parts: [['f1', 4900, 6100, 10100, 6100, 6200], ['f2', 4900, 6100, 10100, 6100, 6200]],
    about: 'Большой семейный дом: спальни на втором этаже, общая зона и гостевая на первом. Выступающее крыло делит участок на парадную и садовую части.' },
  { id: 'demo-patio', tpl: 4, title: 'Патио — П-образный', floors: 1, roof: 'hip', pitch: 22, style: 'modern', author: 'a3', price: 3500,
    about: 'Одноэтажный дом вокруг внутреннего двора-патио: все комнаты смотрят во двор, нет лестниц. Подходит для семей с детьми и пожилыми родителями.' },
  { id: 'demo-layt', tpl: 5, title: 'Лайт — одноэтажный с эркером', floors: 1, roof: 'hip', pitch: 25, style: 'beige', garage: 1, gtype: 'carport', author: 'a1', price: 0,
    about: 'Компактный одноэтажный дом с эркером в гостиной и навесом для машины. Всё на одном уровне, минимум коридоров, светлая гостиная с панорамными окнами.' },
  { id: 'demo-modern', tpl: 1, title: 'Модерн с плоской кровлей', floors: 2, roof: 'flat', style: 'hitech', author: 'a2', price: 2000,
    about: 'Современный двухэтажный дом с плоской кровлей и выступом входной группы. Строгие объёмы, большие окна, тёмные рамы. Плоскую кровлю можно сделать эксплуатируемой.' },
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 } }); pg.on('pageerror', e => console.log('ERR', e.message));
  await pg.goto(B + '/'); await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('ld-how-seen', '1'); localStorage.setItem('ld-social', JSON.stringify({ until: Date.now() + 1e10 })); }); await pg.reload(); await pg.waitForTimeout(2500);
  const out = [];
  for (const c of P) {
    await pg.evaluate(() => document.querySelector('.work').scrollIntoView());
    await pg.click('[data-view="plan"]'); await pg.waitForTimeout(300);
    await pg.click(`#shapes button >> nth=${c.tpl}`); await pg.waitForTimeout(300); if (await pg.isVisible('#shapeYes')) await pg.click('#shapeYes'); await pg.waitForTimeout(400);
    const r = await pg.evaluate(async (c) => {
      const p = JSON.parse(JSON.stringify(DK.appApi.project()));
      p.floors = c.floors; p.attic = !!c.attic; p.style = c.style; p.roof.type = c.roof; if (c.pitch) p.roof.pitch = c.pitch; p.name = c.title;
      DK.appApi.load(p);
      const q = JSON.parse(JSON.stringify(DK.appApi.project())), E = DK.edges(q);
      const pick = (f) => E.filter(f).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0];
      q.ext = q.ext || [];
      if (c.garage) { const e = pick(e => e.axis === 'y' && e.out > 0 && e.hi - e.lo >= 6000) || pick(e => e.axis === 'y'); if (e) q.ext.push({ id: 'g1', kind: 'garage', wall: e.id, c: (e.lo + e.hi) / 2, w: c.garage === 2 ? 6500 : 4000, d: 6500, cars: c.garage, gtype: c.gtype || 'attached', gate: 'far' }); }
      if (c.terrace) {
        const e = pick(e => e.axis === 'x' && e.out < 0);
        if (e) {
          const t = { id: 't1', kind: 'terrace', wall: e.id, c: (e.lo + e.hi) / 2, w: Math.min(6000, e.hi - e.lo - 600), d: 2500, roof: 'covered' }; q.ext.push(t);
          // выход на террасу: самое широкое окно на этой стене — панорамное
          const ws = q.levels.f1.open.filter(o => o.kind === 'win' && o.wall === e.id && o.c > t.c - t.w / 2 && o.c < t.c + t.w / 2).sort((a, b) => b.w - a.w);
          if (ws[0]) { ws[0].pano = true; ws[0].w = Math.max(ws[0].w, 1800); delete ws[0].sill; delete ws[0].h; }
        }
      }
      DK.appApi.load(q);
      // большие помещения делим перегородками с дверью: кухня-гостиная больше 55 м², остальные больше 32 м²;
      // разрез, который даёт ошибку проверки или проходит через лестницу, отменяется
      { const pp = JSON.parse(JSON.stringify(DK.appApi.project())), sr = DK.stairRect(pp), skip = new Set();
        // заданные вручную перегородки: [этаж, x1, y1, x2, y2, центр двери]
        (c.parts || []).forEach(([f, x1, y1, x2, y2, dc], k) => { if (!pp.levels[f]) return; const pid = 'mp' + f + k; pp.levels[f].parts.push({ id: pid, x1, y1, x2, y2 }); pp.levels[f].open.push({ id: pid + 'd', wall: pid, c: dc, w: 800, kind: 'door' }); });
        const crossStair = (ax, c, lo, hi) => sr && (ax === 'x' ? c > sr.x0 - 300 && c < sr.x1 + 300 && lo < sr.y1 && hi > sr.y0 : c > sr.y0 - 300 && c < sr.y1 + 300 && lo < sr.x1 && hi > sr.x0);
        const errs0 = () => DK.quality(DK.normalize(JSON.parse(JSON.stringify(pp)))).errs.length;
        for (const f of DK.floorsOf(pp)) for (let it = 0; it < 8; it++) {
          const lv = pp.levels[f], regs = DK.rooms(pp, f), key = (r) => f + ':' + Math.round(r.x0) + ':' + Math.round(r.y0) + ':' + Math.round(r.area);
          const r = regs.find(r => r.type !== 'void' && r.area > (r.type === 'kl' ? 55 : 32) && !skip.has(key(r)));
          if (!r) break;
          skip.add(key(r));
          const cand = [];
          for (const ax of ['x', 'y']) {
            const a0 = ax === 'x' ? 0 : 1, a1 = a0 + 2, b0 = 1 - a0, b1 = b0 + 2;
            const lo = ax === 'x' ? r.x0 : r.y0, hi = ax === 'x' ? r.x1 : r.y1;
            const cuts = new Set(r.cells.map(q => q[a0]).concat(r.cells.map(q => q[a1])));
            for (let t = 0.35; t <= 0.66; t += 0.05) cuts.add(Math.round((lo + (hi - lo) * t) / 100) * 100);
            for (const c of cuts) {
              if (c <= lo + 2400 || c >= hi - 2400) continue;
              // клетки, которые линия режет пополам, делим
              const cells = []; r.cells.forEach(q => { if (q[a0] < c && q[a1] > c) { const L = q.slice(), R = q.slice(); L[a1] = c; R[a0] = c; cells.push(L, R); } else cells.push(q); });
              const L = cells.filter(q => q[a1] <= c), R = cells.filter(q => q[a0] >= c);
              const area = (Q) => Q.reduce((s2, q) => s2 + (q[2] - q[0]) * (q[3] - q[1]), 0) / 1e6, aL = area(L), aR = area(R);
              if (aL < 10 || aR < 10) continue;
              const seg = []; L.filter(q => q[a1] === c).forEach(q => R.filter(w => w[a0] === c).forEach(w => { const s0 = Math.max(q[b0], w[b0]), s1 = Math.min(q[b1], w[b1]); if (s1 - s0 > 50) seg.push([s0, s1]); }));
              if (!seg.length) continue;
              seg.sort((m, n) => m[0] - n[0]); const ms = [seg[0].slice()]; seg.slice(1).forEach(g => { const tt = ms[ms.length - 1]; if (g[0] <= tt[1] + 1) tt[1] = Math.max(tt[1], g[1]); else ms.push(g.slice()); });
              if (ms.length > 2 || ms.some(g => crossStair(ax, c, g[0], g[1])) || ms.every(g => g[1] - g[0] < 1600)) continue;
              const want = r.type === 'kl' ? 0.62 : 0.5, score = Math.abs(Math.max(aL, aR) / (aL + aR) - Math.max(want, 1 - want));
              cand.push({ score, ax, c, ms });
            }
          }
          // пробуем разрезы от лучшего к худшему, пока не найдётся без новых ошибок
          cand.sort((m, n) => m.score - n.score);
          for (const best of cand.slice(0, 12)) {
            const before = errs0(), snap = JSON.stringify(pp.levels[f]), lv2 = pp.levels[f];
            best.ms.forEach((g, k) => { const pid = 'dp' + f + it + 's' + k;
              lv2.parts.push(best.ax === 'x' ? { id: pid, x1: best.c, y1: g[0], x2: best.c, y2: g[1] } : { id: pid, x1: g[0], y1: best.c, x2: g[1], y2: best.c });
              if (g[1] - g[0] >= 1600) lv2.open.push({ id: pid + 'd', wall: pid, c: Math.round((g[0] + Math.min(g[1] - g[0] - 600, 1300)) / 10) * 10, w: 800, kind: 'door' }); });
            if (errs0() > before) { pp.levels[f] = JSON.parse(snap); continue; }
            if (r.type !== 'kl') pp.levels[f].names = pp.levels[f].names.filter(n => !r.cells.some(q => n.x >= q[0] && n.x <= q[2] && n.y >= q[1] && n.y <= q[3]));
            break;
          }
        }
        DK.appApi.load(pp); }
      // неподписанные помещения — по площади и форме: так проект проходит проверку качества
      { const pp = JSON.parse(JSON.stringify(DK.appApi.project()));
        for (const f of DK.floorsOf(pp)) {
          const regs = DK.rooms(pp, f).filter(r => r.type !== 'void'), has = (t) => regs.some(r => r.type === t);
          let office = has('office');
          regs.filter(r => r.type === 'none').sort((a, b) => b.area - a.area).forEach(r => {
            const w = r.x1 - r.x0, h = r.y1 - r.y0, thin = Math.max(w, h) / Math.max(1, Math.min(w, h)) > 2.3;
            let t = 'store';
            const st = DK.stairRect(pp), withStair = st && r.cells.some(q => (st.x0 + st.x1) / 2 > q[0] && (st.x0 + st.x1) / 2 < q[2] && (st.y0 + st.y1) / 2 > q[1] && (st.y0 + st.y1) / 2 < q[3]);
            if (withStair) t = 'hall';
            else if (f === 'f1' && !has('kl') && !has('kitchen') && !has('living') && r.area >= 18) t = 'kl';
            else if (thin && r.area < 10) t = 'corr';
            else if (r.area >= 12 && f === 'f1' && !office && pp.floors > 1) { t = 'office'; office = true; }
            else if (r.area >= 12) t = 'bed';
            else if (r.area >= 8) { t = office ? 'kids' : 'office'; office = true; }
            else if (!has('bath') && r.area >= 3.5) t = 'bath';
            else if (r.area >= 4) t = 'dress';
            r.type = t; pp.levels[f].names.push({ x: Math.round(r.cx), y: Math.round(r.cy), type: t });
          });
        }
        DK.appApi.load(pp); }
      await DK.loadThree(); if (!DK._view) DK._view = DK.View3D(document.getElementById('c3d'), null);
      document.querySelector('[data-view="ext"]').click(); await new Promise(r => setTimeout(r, 1500));
      const ext = DK._view.exteriorShot(1200, 900);
      const toJpg = (url) => new Promise(res => { const i = new Image(); i.onload = () => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(i, 0, 0); res(cv.toDataURL('image/jpeg', 0.82)); }; i.src = url; });
      const fl = DK.floorsOf(DK.appApi.project()), nums = DK.roomNumbers(DK.appApi.project()), plans = [];
      for (const f of fl) plans.push(await toJpg(DK._plan.toImage(f, { width: 1400, numbers: nums })));
      const P2 = DK.appApi.project(), A = DK.areas(P2), q2 = DK.quality(P2);
      const all = [].concat(...DK.floorsOf(P2).map(f => DK.rooms(P2, f))), cnt = (t) => all.filter(r => t.includes(r.type)).length, kl = all.find(r => r.type === 'kl');
      const pl = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;
      const beds = cnt(['bed', 'kids']), baths = cnt(['bath']);
      const summary = `${beds} ${pl(beds, 'спальня', 'спальни', 'спален')}, ${baths} ${pl(baths, 'санузел', 'санузла', 'санузлов')}${kl ? `, кухня-гостиная ${DK.fmtA(kl.area)} м²` : ''}${cnt(['office']) ? ', кабинет' : ''}${cnt(['dress']) ? ', гардеробная' : ''}.`;
      return { summary, project: P2, ext, plans, area: Math.round(A.total * 10) / 10, floors: fl.length, size: `${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м`, quality: { score: q2.score, errs: q2.errs.length, warns: q2.warns.length, ok: q2.ok } };
    }, c);
    const dir = path.join(OUT, 'img', c.id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'exterior.jpg'), Buffer.from(r.ext.split(',')[1], 'base64'));
    const files = ['exterior.jpg'];
    r.plans.forEach((u, i) => { const fn = `plan-${i + 1}.jpg`; fs.writeFileSync(path.join(dir, fn), Buffer.from(u.split(',')[1], 'base64')); files.push(fn); });
    console.log(c.id, r.area, r.floors, JSON.stringify(r.quality), r.summary);
    out.push({ id: c.id, title: `${c.title} ${Math.round(r.area)} м²`, about: c.about + ' В проекте: ' + r.summary, author: c.author, price: c.price, license: 'view', area: r.area, floors: r.floors, size: r.size, files, project: r.project, quality: r.quality });
  }
  fs.writeFileSync(path.join(OUT, 'projects.json'), JSON.stringify(out));
  await b.close();
})();
