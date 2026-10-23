/* Связка интерфейса: проект, история правок, виды, панели, анкета, каталог */
(function () {
'use strict';
const DK = window.DK, C = DK.CONFIG;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = DK.esc;
const KEY = 'dk-project-v1';

/* ---------- состояние ---------- */
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.v === 1 ? s : null; } catch (e) { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* приватный режим */ } }
let P = load() || DK.starter();
['b', 'f1', 'f2', 'f3'].forEach(f => { if (!P.levels[f]) P.levels[f] = DK.emptyLevel(); });
DK.normalize(P);
let override = null, fid = 'f1', view = 'plan', sel = null, wetIdx = 0;
const opts = { dimOpen: true, furn: true, cut: true };
const hist = [JSON.stringify(P)]; let hi = 0;

const app = {
  p: () => override || P,
  fid: () => fid,
  sel: () => sel,
  opt: (k) => opts[k],
  select(s) { sel = s; renderSel(); plan.render(); },
  commit(msg) {
    DK.normalize(P);
    const s = JSON.stringify(P);
    if (s !== hist[hi]) { hist.splice(hi + 1); hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1; }
    save(); refresh(); if (v3 && view !== 'plan') v3.rebuild();
  },
  live() { refreshInfo(); if (v3 && view !== 'plan') v3.rebuild(); },
  toast,
  setTool(t, arg) { plan.setTool(t, arg); $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t))); hint(); },
  pick3d(pk) { sel = pk ? { kind: pk.kind, id: pk.id } : null; renderSel(); },
};

const plan = DK.Plan2D($('#c2d'), app);
let v3 = null;

/* ---------- утилиты ---------- */
let toastT = 0;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
function download(name, url) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function seg(el, val, attr) { $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val)))); }
function money(v) { return v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
function findOp(id) { for (const f of DK.floorsOf(P)) { const o = P.levels[f].open.find(q => q.id === id); if (o) return { o, f }; } return null; }

/* ---------- панели ---------- */
function refresh() {
  if (!DK.floorsOf(P).includes(fid)) fid = 'f1';
  $('#inW').value = P.W; $('#inD').value = P.D; $('#hClear').value = P.hClear; $('#basement').checked = P.basement;
  seg($('#floorsN'), P.floors, 'n'); seg($('#wallMat'), P.wallMat, 'k'); seg($('#insul'), P.insul, 'k');
  $('#clad').value = P.clad;
  // слои стены
  const cl = DK.SPEC.clad[P.clad], A = DK.areas(P);
  const L = [[DK.SPEC.outer[P.wallMat].n, DK.ts(P), '#dcdee1']];
  if (P.insul) L.push(['Утеплитель (минвата)', P.insul, '#f0e3a6']);
  if (cl.gap) L.push(['Вентзазор', cl.gap, '#ffffff']);
  L.push([cl.n, cl.t, { plaster: '#cbc5bb', brick: '#a9533b', fibro: '#878c93', planken: '#a77a52' }[P.clad]]);
  $('#layers').innerHTML = L.map(l => `<div><span><i style="background:${l[2]}"></i>${esc(l[0])}</span><span>${l[1]}</span></div>`).join('') + `<div><span>Наружная стена всего</span><span>${A.T} мм</span></div>`;
  $('#dims').innerHTML = `<dt>Внутри в чистоте</dt><dd>${A.inW} × ${A.inD}</dd><dt>По несущему слою</dt><dd>${P.W} × ${P.D}</dd><dt>С облицовкой</dt><dd>${A.outW} × ${A.outD}</dd>`;
  // несущая стена
  const vs = DK.bearingVariants(P), cur = JSON.stringify(P.bearing);
  $('#bvars').innerHTML = vs.map((v, i) => `<button class="var" data-i="${i}" aria-pressed="${JSON.stringify(v.walls) === cur}">${varIcon(v)}<b>${esc(v.n)}</b><span>${esc(v.note)}</span></button>`).join('')
    || '<div class="muted">Для таких размеров нужен расчёт конструктора — пролёты больше 6 м.</div>';
  $$('#bvars .var').forEach(b => b.onclick = () => { P.bearing = vs[+b.dataset.i].walls.map(w => Object.assign({}, w)); app.commit('Несущая стена'); });
  const b = P.bearing[0];
  $('#bposRow').hidden = P.bearing.length !== 1;
  if (P.bearing.length === 1) {
    const t = DK.ts(P), lim = b.axis === 'h' ? P.D : P.W, half = DK.SPEC.bearing.t / 2;
    const lo = Math.max(t + half + DK.SPEC.slabMin, lim - t - half - DK.SPEC.slabMax), hi2 = Math.min(lim - t - half - DK.SPEC.slabMin, t + half + DK.SPEC.slabMax);
    const r = $('#bpos'); r.min = Math.ceil(lo / 50) * 50; r.max = Math.floor(hi2 / 50) * 50; r.value = b.pos;
    $('#bposV').textContent = b.pos;
  }
  // этажи
  $('#floorTabs').innerHTML = DK.floorsOf(P).map(f => `<button data-f="${f}" aria-pressed="${f === fid}">${DK.FLOORS.find(x => x.id === f).n}</button>`).join('');
  $$('#floorTabs button').forEach(bt => bt.onclick = () => setFloor(bt.dataset.f));
  $('#walkFloors').innerHTML = DK.floorsOf(P).map(f => `<button class="btn sm" data-f="${f}" aria-pressed="${f === fid}">${DK.floorName(f)}</button>`).join('');
  $$('#walkFloors button').forEach(bt => bt.onclick = () => setFloor(bt.dataset.f));
  // фасад
  $('#roofs').innerHTML = Object.entries(DK.ROOFS).map(([k, r]) => `<button data-k="${k}" aria-pressed="${P.roof.type === k}">${roofIcon(k)}${esc(r.n)}</button>`).join('');
  $$('#roofs button').forEach(bt => bt.onclick = () => { P.roof.type = bt.dataset.k; P.roof.pitch = DK.ROOFS[bt.dataset.k].pitch || P.roof.pitch; app.commit('Кровля'); });
  $('#pitchRow').hidden = P.roof.type === 'flat'; $('#ridgeRow').hidden = P.roof.type === 'flat' || P.roof.type === 'hip';
  $('#pitch').value = P.roof.pitch; $('#pitchV').textContent = P.roof.pitch + '°';
  seg($('#ridge'), P.roof.ridge, 'k');
  $('#styles').innerHTML = Object.entries(DK.STYLES).map(([k, s]) => `<button data-k="${k}" aria-pressed="${P.style === k}"><i style="background:linear-gradient(135deg,${(s.upper || s.wall).c} 0 50%,${(s.lower || s.wall).c} 50% 72%,${s.roof.c} 72%)"></i>${esc(s.n)}</button>`).join('');
  $$('#styles button').forEach(bt => bt.onclick = () => { P.style = bt.dataset.k; if (bt.dataset.k === 'hitech' && P.roof.type !== 'flat') { P.roof.type = 'flat'; toast('Хай-тек — с плоской кровлей'); } app.commit('Стиль'); });
  $('#undo').disabled = hi <= 0; $('#redo').disabled = hi >= hist.length - 1;
  refreshInfo(); renderSel(); plan.render();
}
function refreshInfo() {
  const A = DK.areas(app.p());
  $('#areas').innerHTML = A.per.map(f => `<div><span>${esc(f.n)}</span><span>${DK.fmtA(f.area)} м²</span></div>`).join('') +
    `<div class="tot"><span>Всего помещений</span><span>${DK.fmtA(A.total)} м²</span></div><div><span>Площадь застройки</span><span>${DK.fmtA(A.footprint)} м²</span></div>`;
  const pr = C.prices, lo = A.total * pr.eco.from / 1e6, hi2 = A.total * pr.premium.to / 1e6;
  $('#est').innerHTML = `<small>Ориентир под чистовую отделку</small><b>${money(Math.round(lo * 10) / 10)}–${money(Math.round(hi2 * 10) / 10)} млн ₽</b><small>${esc(C.priceNote)}</small>`;
  $('#checks').innerHTML = DK.checks(app.p()).map(c => `<li class="${c.lv}">${esc(c.txt)}</li>`).join('');
}
function varIcon(v) {
  const s = v.walls.map(w => w.axis === 'h' ? `<path d="M3 ${3 + 18 * (w.pos / P.D)}h24" stroke="#b8644a" stroke-width="2.4"/>` : `<path d="M${3 + 24 * (w.pos / P.W)} 3v18" stroke="#b8644a" stroke-width="2.4"/>`).join('');
  return `<i><svg viewBox="0 0 30 24"><rect x="3" y="3" width="24" height="18" fill="none" stroke="#2f3237" stroke-width="1.6"/>${s}</svg></i>`;
}
function roofIcon(k) {
  const d = { gable: 'M3 18 L12 6 L21 18', hip: 'M3 18 L8 8 H16 L21 18', mansard: 'M3 18 L5 11 L12 6 L19 11 L21 18', shed: 'M3 18 V10 L21 6 V18', flat: 'M3 18 V9 H21 V18' }[k];
  return `<i style="background:none;box-shadow:none"><svg viewBox="0 0 24 24" width="22" height="22"><path d="${d}" fill="none" stroke="#2f3237" stroke-width="1.8"/><path d="M3 18H21" stroke="#2f3237" stroke-width="1.8"/></svg></i>`;
}

/* ---------- выделение ---------- */
function renderSel() {
  const box = $('#selBox');
  if (!sel) { box.hidden = true; return; }
  let h = '';
  if (sel.kind === 'open') {
    const r = findOp(sel.id); if (!r) { box.hidden = true; return; }
    const o = r.o, nm = o.kind === 'win' ? (o.pano ? 'Панорамное окно' : 'Окно') : o.kind === 'entry' ? 'Входная дверь' : 'Дверь';
    h = `<h3>${nm} <small>${esc(DK.floorName(r.f))}</small></h3>
      <div class="row2"><label class="fld">Ширина, мм<input type="number" id="sW" step="50" min="400" max="6000" value="${o.w}"></label>
      <label class="fld">Сдвиг<span class="row"><button type="button" class="btn sm" id="sL">← 100</button><button type="button" class="btn sm" id="sR">100 →</button></span></label></div>`;
    if (o.kind === 'win') {
      const sz = DK.opSize(P, o);
      h += `<div class="seg" id="sPano"><button data-k="0" aria-pressed="${!o.pano}">Обычное</button><button data-k="1" aria-pressed="${!!o.pano}">Панорамное</button></div>
        <label class="fld">Створок<div class="seg" id="sSash">${[1, 2, 3, 4].map(n => `<button data-k="${n}" aria-pressed="${(o.sash || (o.w >= 1300 ? 2 : 1)) === n}">${n}</button>`).join('')}</div></label>
        ${o.pano ? '' : `<div class="row2"><label class="fld">Низ окна от пола<input type="number" id="sSill" step="50" min="300" max="1800" value="${sz.sill}"></label><label class="fld">Высота окна<input type="number" id="sH" step="50" min="400" max="${P.hClear - 300}" value="${sz.h}"></label></div>`}`;
    }
    h += `<button type="button" class="btn sm ghost" id="sDel">Удалить</button>`;
  } else if (sel.kind === 'part') {
    const q = P.levels[fid].parts.find(w => w.id === sel.id); if (!q) { box.hidden = true; return; }
    h = `<h3>Перегородка <small>кирпич 120 мм</small></h3><div class="muted">Длина ${Math.abs(q.x2 - q.x1) + Math.abs(q.y2 - q.y1)} мм. Тяните, чтобы сдвинуть; размеры помещений пересчитаются.</div><button type="button" class="btn sm ghost" id="sDel">Удалить</button>`;
  } else if (sel.kind === 'furn') {
    const f = P.levels[fid].furn.find(q => q.id === sel.id); if (!f) { box.hidden = true; return; }
    const F = DK.FURN[f.type];
    h = `<h3>${esc(F.n)} <small>${F.w} × ${F.d}</small></h3><div class="row"><button type="button" class="btn sm" id="sRot">Повернуть (R)</button><button type="button" class="btn sm ghost" id="sDel">Удалить</button></div>`;
  } else if (sel.kind === 'room') {
    const r = DK.rooms(P, fid).at(sel.x, sel.y); if (!r) { box.hidden = true; return; }
    h = `<h3>Помещение <small>${DK.fmtA(r.area)} м²${r.rect ? ' · ' + Math.round(r.x1 - r.x0) + ' × ' + Math.round(r.y1 - r.y0) : ''}</small></h3>
      <label class="fld">Назначение<select id="sType">${Object.entries(DK.ROOM).map(([k, v]) => `<option value="${k}"${r.type === k ? ' selected' : ''}>${esc(v.n)}</option>`).join('')}</select></label>`;
    if (r.type === 'boiler') h += `<div class="muted">Котельная: объём от ${DK.BOILER.vol} м³, высота от 2,5 м, у наружной стены с окном (0,03 м² остекления на 1 м³), дверь от 800 мм.</div>`;
  } else if (sel.kind === 'stair') {
    h = `<h3>Лестница <small>${P.stair.w} × ${P.stair.l}</small></h3><div class="muted">Одномаршевая, на всех этажах в одном месте; в перекрытии — проём.</div>
      <div class="row"><button type="button" class="btn sm" id="sRot">Повернуть (R)</button><button type="button" class="btn sm ghost" id="sDel">Удалить</button></div>`;
  } else if (sel.kind === 'bearing') {
    h = `<h3>Несущая стена</h3><div class="muted">Кирпич 380 мм, опора плит перекрытия. Положение выбирается из допустимых вариантов слева и совпадает на всех этажах.</div>`;
  }
  box.innerHTML = h; box.hidden = !h;
  const on = (id, ev, fn) => { const e = $('#' + id, box); if (e) e.addEventListener(ev, fn); };
  if (sel.kind === 'open') {
    const r = findOp(sel.id), o = r.o, ws = DK.walls(P, r.f), w = ws.find(v => v.id === o.wall);
    const clampC = () => { o.c = Math.max(w.a0 + o.w / 2, Math.min(o.c, w.a1 - o.w / 2)); };
    on('sW', 'change', (e) => { o.w = Math.max(400, Math.min(+e.target.value || o.w, w.a1 - w.a0)); clampC(); app.commit(); });
    on('sL', 'click', () => { o.c -= 100; clampC(); app.commit(); });
    on('sR', 'click', () => { o.c += 100; clampC(); app.commit(); });
    $$('#sPano button', box).forEach(b => b.onclick = () => { o.pano = b.dataset.k === '1'; if (o.pano && o.w < 1500) { o.w = 2000; clampC(); } app.commit(); });
    $$('#sSash button', box).forEach(b => b.onclick = () => { o.sash = +b.dataset.k; app.commit(); });
    on('sSill', 'change', (e) => { o.sill = Math.max(0, +e.target.value); app.commit(); });
    on('sH', 'change', (e) => { o.h = Math.max(400, +e.target.value); app.commit(); });
    on('sDel', 'click', () => { P.levels[r.f].open = P.levels[r.f].open.filter(q => q !== o); sel = null; app.commit(); });
  }
  if (sel.kind === 'part') on('sDel', 'click', () => delSel());
  if (sel.kind === 'furn') { on('sRot', 'click', () => rotSel()); on('sDel', 'click', () => delSel()); }
  if (sel.kind === 'stair') { on('sRot', 'click', () => rotSel()); on('sDel', 'click', () => delSel()); }
  if (sel.kind === 'room') on('sType', 'change', (e) => {
    const regs = DK.rooms(P, fid), r = regs.at(sel.x, sel.y), lv = P.levels[fid];
    lv.names = lv.names.filter(n => regs.at(n.x, n.y) !== r);
    if (e.target.value !== 'none') lv.names.push({ x: Math.round(sel.x), y: Math.round(sel.y), type: e.target.value });
    app.commit();
  });
}
function delSel() {
  if (!sel) return;
  const lv = P.levels[fid];
  if (sel.kind === 'part') { lv.parts = lv.parts.filter(q => q.id !== sel.id); lv.open = lv.open.filter(o => o.wall !== sel.id); }
  else if (sel.kind === 'furn') lv.furn = lv.furn.filter(q => q.id !== sel.id);
  else if (sel.kind === 'open') { const r = findOp(sel.id); if (r) P.levels[r.f].open = P.levels[r.f].open.filter(q => q !== r.o); }
  else if (sel.kind === 'stair') P.stair = null;
  else return;
  sel = null; app.commit();
}
function rotSel() {
  if (!sel) return;
  if (sel.kind === 'furn') { const f = P.levels[fid].furn.find(q => q.id === sel.id); if (f) { f.rot = (f.rot + 1) % 4; app.commit(); } }
  if (sel.kind === 'stair' && P.stair) { P.stair.rot = (P.stair.rot + 1) % 4; app.commit(); }
}

/* ---------- виды ---------- */
function hint() {
  const t = plan.tool();
  const H = {
    plan: { select: 'Нажмите на помещение, чтобы назначить его; тяните мебель, проёмы и перегородки. Колёсико — масштаб, тяните пустое место — сдвиг.',
            wall: 'Тяните от стены до стены — перегородка в полкирпича прилипает к граням стен.', door: 'Нажмите на стену — дверь 800 мм, на наружной — входная 1000 мм.',
            win: 'Нажмите на наружную стену — окно 1500 мм.', erase: 'Нажмите на перегородку, проём или мебель, чтобы удалить.', furn: 'Нажмите на план, чтобы поставить предмет.',
            wet: 'Тяните зону или её края. Зона общая для всех этажей.' }[t],
    int: 'Тяните — поворот, правая кнопка или Shift — сдвиг, колёсико — масштаб.',
    walk: 'Нажмите на сцену и идите: W A S D, мышь — взгляд. Сквозь стены не пройти — только через двери.',
    ext: 'Тяните окно — сдвиг по горизонтали; нажмите — панорамное, створки, ширина.',
  };
  $('#hint').textContent = view === 'plan' ? H.plan : H[view];
  $('#toolHint').textContent = view === 'plan' ? H.plan : '';
}
function setView(v) {
  view = v;
  document.body.className = 'v-' + v;
  seg($('#views'), v, 'view');
  $$('#side [data-v]').forEach(g => { g.hidden = !g.dataset.v.split(' ').includes(v); });
  $('#c2d').hidden = v !== 'plan'; $('#c3d').hidden = v === 'plan';
  $('#floorTabs').hidden = v === 'ext';
  $('#hud').hidden = v === 'walk';
  if (v === 'plan') { if (v3) v3.stop(); plan.size(); }
  else {
    $('#loading').hidden = false;
    DK.loadThree().then(() => {
      $('#loading').hidden = true;
      if (!v3) v3 = DK.View3D($('#c3d'), app);
      v3.show(v === 'int' ? 'interior' : v === 'walk' ? 'walk' : 'exterior', fid, { cut: opts.cut, furn: opts.furn, refit: true });
    }).catch(() => { $('#loading').textContent = 'Не удалось загрузить 3D — проверьте интернет'; });
  }
  hint();
}
function setFloor(f) {
  fid = f; sel = null;
  if (v3 && view === 'walk') v3.walkFloor(f);
  else if (v3 && view !== 'plan') v3.show(view === 'int' ? 'interior' : 'exterior', fid, { cut: opts.cut, furn: opts.furn, refit: true });
  refresh();
}

/* ---------- обработчики ---------- */
function bind() {
  $('#brandName').textContent = C.brand; $('#tagline').textContent = C.tagline; document.title = C.brand + ' — ' + C.tagline;
  $('#clad').innerHTML = Object.entries(DK.SPEC.clad).map(([k, v]) => `<option value="${k}">${esc(v.n)}</option>`).join('');
  $('#inW').addEventListener('change', (e) => { P.W = clampDim(e.target.value); app.commit('Ширина'); plan.fit(); });
  $('#inD').addEventListener('change', (e) => { P.D = clampDim(e.target.value); app.commit('Глубина'); plan.fit(); });
  $('#hClear').addEventListener('change', (e) => { P.hClear = +e.target.value; app.commit(); });
  $('#basement').addEventListener('change', (e) => { P.basement = e.target.checked; if (P.basement) fid = 'b'; app.commit(); });
  $$('#floorsN button').forEach(b => b.onclick = () => { P.floors = +b.dataset.n; app.commit(); });
  $$('#wallMat button').forEach(b => b.onclick = () => { P.wallMat = b.dataset.k; app.commit('Материал стен'); });
  $$('#insul button').forEach(b => b.onclick = () => { P.insul = +b.dataset.k; app.commit(); });
  $('#clad').addEventListener('change', (e) => { P.clad = e.target.value; app.commit(); });
  $('#bpos').addEventListener('input', (e) => { P.bearing[0].pos = +e.target.value; $('#bposV').textContent = e.target.value; app.live(); plan.render(); });
  $('#bpos').addEventListener('change', () => app.commit());
  $('#wetNext').onclick = () => { const vs = DK.wetVariants(P); wetIdx = (wetIdx + 1) % vs.length; P.wet = vs[wetIdx]; app.commit('Мокрая зона'); };
  $$('[data-tool]').forEach(b => b.onclick = () => { if (view !== 'plan') setView('plan'); app.setTool(b.dataset.tool); });
  $('#addStair').onclick = () => {
    if (DK.floorsOf(P).length < 2) { toast('Лестница нужна, если этажей больше одного'); return; }
    const t = DK.ts(P);
    P.stair = P.stair || { x: t + 200, y: t + 200, w: 1000, l: 3600, rot: 0 }; app.commit('Лестница'); app.select({ kind: 'stair' });
  };
  $('#optDimOpen').addEventListener('change', (e) => { opts.dimOpen = e.target.checked; plan.render(); });
  // палитра мебели
  $('#furnPal').innerHTML = DK.FURN_GROUPS.map(g => `<details${g === 'Гостиная' ? ' open' : ''}><summary>${esc(g)}</summary><div class="row">${Object.entries(DK.FURN).filter(([, f]) => f.g === g).map(([k, f]) => `<button class="btn sm" data-furn="${k}">${esc(f.n)}</button>`).join('')}</div></details>`).join('');
  $$('[data-furn]').forEach(b => b.onclick = () => { if (view !== 'plan') setView('plan'); app.setTool('furn', b.dataset.furn); toast('Нажмите на план: ' + DK.FURN[b.dataset.furn].n); });
  // интерьер
  $('#tCut').onclick = (e) => { opts.cut = !opts.cut; e.currentTarget.setAttribute('aria-pressed', opts.cut); if (v3) v3.show('interior', fid, { cut: opts.cut, furn: opts.furn }); };
  $('#tFurn').onclick = (e) => { opts.furn = !opts.furn; e.currentTarget.setAttribute('aria-pressed', opts.furn); if (v3) v3.show('interior', fid, { cut: opts.cut, furn: opts.furn }); plan.render(); };
  $('#pitch').addEventListener('input', (e) => { P.roof.pitch = +e.target.value; $('#pitchV').textContent = e.target.value + '°'; if (v3) v3.rebuild(); });
  $('#pitch').addEventListener('change', () => app.commit());
  $$('#ridge button').forEach(b => b.onclick = () => { P.roof.ridge = b.dataset.k; app.commit(); });
  // виды
  $$('#views button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#zIn').onclick = () => view === 'plan' ? zoomPlan(1.25) : v3 && v3.zoom(0.8);
  $('#zOut').onclick = () => view === 'plan' ? zoomPlan(0.8) : v3 && v3.zoom(1.25);
  $('#fit').onclick = () => view === 'plan' ? plan.fit() : v3 && v3.fit();
  $('#undo').onclick = undo; $('#redo').onclick = redo;
  $('#shot').onclick = () => {
    const name = (P.name || 'dom').replace(/\s+/g, '-');
    if (view === 'plan') download(`${name}-${fid}-plan.png`, plan.toImage(fid));
    else if (v3) download(`${name}-${view}.png`, v3.shot());
  };
  // файл
  $('#saveFile').onclick = () => download('proekt-doma.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(P, null, 1)));
  $('#openFile').onclick = () => $('#fileIn').click();
  $('#fileIn').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.v !== 1 || !d.levels) throw new Error('format');
      P = d; ['b', 'f1', 'f2', 'f3'].forEach(k => { if (!P.levels[k]) P.levels[k] = DK.emptyLevel(); });
      sel = null; app.commit('Проект открыт'); plan.fit(); toast('Проект открыт');
    } catch (err) { toast('Это не файл проекта'); }
    e.target.value = '';
  });
  $('#resetProj').onclick = () => { if (confirm('Начать с типового проекта? Текущий будет заменён.')) { P = DK.starter(); sel = null; fid = 'f1'; app.commit(); plan.fit(); } };
  // клавиши
  window.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || $('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (view === 'walk') return;
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); delSel(); }
    if (e.code === 'KeyR') rotSel();
    if (e.code === 'Escape') { app.setTool('select'); app.select(null); }
  });
  // страницы
  $$('nav.main button').forEach(b => b.onclick = () => page(b.dataset.page));
  $$('[data-act="lead"]').forEach(b => b.onclick = openLead);
  $$('[data-act="join"]').forEach(b => b.onclick = () => $('#joinDlg').showModal());
  window.addEventListener('hashchange', () => page(location.hash.slice(1) || 'project', true));
  const s = C.service;
  $('#svcClient').textContent = s.client; $('#svcClientPrice').textContent = s.clientPrice ? 'Стоимость: ' + s.clientPrice : 'Стоимость — по договорённости';
  $('#svcCompany').textContent = s.company; $('#svcCompanyPrice').textContent = s.companyPrice ? 'Стоимость: ' + s.companyPrice : 'Стоимость лида — по договору';
  $('#ownerLine').textContent = [C.owner.phone, C.owner.email].filter(Boolean).join(' · ');
  $('#cityList').innerHTML = DK.CITIES.map(c => `<option value="${esc(c)}">`).join('');
  bindLead(); bindCatalog();
}
function clampDim(v) { return Math.max(6000, Math.min(24000, Math.round((+v || 10000) / 100) * 100)); }
function zoomPlan(f) { const c = $('#c2d').getBoundingClientRect(); $('#c2d').dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(f) / 0.0015, clientX: c.left + c.width / 2, clientY: c.top + c.height / 2 })); }
function undo() { if (hi > 0) { hi--; P = JSON.parse(hist[hi]); sel = null; save(); refresh(); if (v3 && view !== 'plan') v3.rebuild(); } }
function redo() { if (hi < hist.length - 1) { hi++; P = JSON.parse(hist[hi]); sel = null; save(); refresh(); if (v3 && view !== 'plan') v3.rebuild(); } }

function page(id, fromHash) {
  if (!['project', 'builders', 'arch', 'how'].includes(id)) id = 'project';
  $$('main.page').forEach(m => { m.hidden = m.id !== 'page-' + id; });
  $$('nav.main button').forEach(b => b.setAttribute('aria-current', b.dataset.page === id ? 'page' : 'false'));
  if (!fromHash) history.replaceState(null, '', id === 'project' ? location.pathname : '#' + id);
  if (id === 'project') { if (view === 'plan') plan.size(); else setView(view); }
  else { if (v3) v3.stop(); renderLists(); }
}

/* ---------- каталог ---------- */
const filt = { builders: {}, arch: {} };
function bindCatalog() {
  $$('.filters').forEach(el => {
    const k = el.dataset.for;
    el.innerHTML = `<label class="fld">Город<input data-f="city" list="cityList" placeholder="Любой"></label>
      <label class="fld">Материал<select data-f="mat"><option value="">Любой</option>${Object.entries(DK.MATS).map(([m, n]) => `<option value="${m}">${n}</option>`).join('')}</select></label>
      ${k === 'builders' ? `<label class="fld">Класс<select data-f="cls"><option value="">Любой</option>${Object.entries(C.prices).map(([c, v]) => `<option value="${c}">${v.n}</option>`).join('')}</select></label>` : ''}
      <label class="fld">Поиск<input data-f="q" placeholder="Название, услуга"></label>`;
    $$('[data-f]', el).forEach(i => i.addEventListener('input', () => { filt[k][i.dataset.f] = i.value; renderLists(); }));
  });
  $('#joinMats').innerHTML = Object.entries(DK.MATS).map(([m, n]) => `<label class="chk"><input type="checkbox" name="mat" value="${m}">${n}</label>`).join('');
  $('[data-close]', $('#joinDlg')).onclick = () => $('#joinDlg').close();
  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f), d = Object.fromEntries(fd.entries());
    d.materials = fd.getAll('mat'); delete d.mat;
    d.regions = (d.regions || '').split(',').map(s => s.trim()).filter(Boolean);
    const miss = ['name', 'city', 'phone', 'email'].filter(k => !String(d[k] || '').trim());
    if (miss.length) { $('#jErr').textContent = 'Заполните название, город, телефон и почту'; return; }
    if (d.inn && !/^\d{10}(\d{2})?$/.test(d.inn)) { $('#jErr').textContent = 'ИНН — 10 или 12 цифр'; return; }
    if (!f.agree.checked) { $('#jErr').textContent = 'Подтвердите согласие с условиями'; return; }
    $('#jErr').textContent = ''; delete d.agree;
    const r = await DK.registerOrg(d);
    if (r.ok) { $('#jMsg').textContent = 'Спасибо! Проверим данные и опубликуем карточку.'; f.reset(); setTimeout(() => $('#joinDlg').close(), 2200); }
    else if (r.offline) {
      $('#jMsg').innerHTML = 'Сервер недоступен — анкета сохранена файлом, отправьте её нам' + (C.owner.email ? ` на <a href="mailto:${esc(C.owner.email)}">${esc(C.owner.email)}</a>` : '') + '.';
      download('registraciya.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(d, null, 1)));
    } else $('#jErr').textContent = 'Не получилось отправить, попробуйте позже';
  });
}
let catalogLoaded = false;
async function renderLists() {
  if (!catalogLoaded) { catalogLoaded = true; await DK.loadCatalog(); }
  DK.renderCatalog($('#list-builders'), 'builders', filt.builders);
  DK.renderCatalog($('#list-arch'), 'arch', filt.arch);
}

/* ---------- анкета ---------- */
const A = {};
let step = 0, result = null;
const STEPS = ['Город и участок', 'Уклон участка', 'Сроки, бюджет, материал', 'Контакты', 'Проверьте заявку', 'Готово'];
function bindLead() {
  $('#lSlope').innerHTML = DK.SLOPES.map(s => `<button type="button" class="opt" data-k="${s.id}">${DK.slopeSvg(s.a)}${esc(s.n)}<small>${esc(s.d)}</small></button>`).join('');
  $('#lTerm').innerHTML = DK.TERMS.map(t => `<button type="button" class="opt" data-k="${t.id}">${esc(t.n)}</button>`).join('');
  const pick = (el, key) => $$('.opt', el).forEach(b => b.onclick = () => { A[key] = b.dataset.k; seg(el, A[key], 'k'); $('#lErr').textContent = ''; });
  pick($('#lPlot'), 'plot'); pick($('#lSlope'), 'slope'); pick($('#lTerm'), 'term'); pick($('#lCls'), 'cls'); pick($('#lMat'), 'material');
  $('#lNext').onclick = next; $('#lBack').onclick = () => go(step - 1);
}
function openLead() {
  if (location.hash.slice(1) !== '' && location.hash !== '#project') page('project');
  go(0); $('#leadDlg').showModal();
}
function go(s) {
  step = Math.max(0, Math.min(5, s));
  $$('#leadForm [data-step]').forEach(x => { x.hidden = +x.dataset.step !== step; });
  $('#leadProg').innerHTML = STEPS.slice(0, 5).map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('');
  $('#leadStepT').textContent = (step < 5 ? `Шаг ${step + 1} из 5 · ` : '') + STEPS[step];
  $('#lBack').hidden = step === 0 || step === 5;
  $('#lNext').textContent = step === 4 ? 'Отправить заявку' : step === 5 ? 'Закрыть' : 'Дальше';
  $('#lNext').disabled = false;
  $('#lErr').textContent = '';
}
async function next() {
  const err = (m) => { $('#lErr').textContent = m; };
  if (step === 0) { A.city = $('#lCity').value.trim(); if (!A.city) return err('Укажите город'); if (!A.plot) return err('Есть ли участок?'); }
  if (step === 1 && !A.slope) return err('Выберите уклон или «Не знаю»');
  if (step === 2 && (!A.term || !A.cls || !A.material)) return err('Выберите срок, бюджет и материал');
  if (step === 3) {
    A.name = $('#lName').value.trim(); A.phone = $('#lPhone').value.trim(); A.time = $('#lTime').value.trim(); A.note = $('#lNote').value.trim();
    if (!A.name) return err('Как к вам обращаться?');
    if (A.phone.replace(/\D/g, '').length < 10) return err('Проверьте телефон');
    if (!$('#lAgree').checked) return err('Нужно согласие на обработку данных');
    preview(); return go(4);
  }
  if (step === 4) return submit();
  if (step === 5) { $('#leadDlg').close(); return; }
  go(step + 1);
}
function preview() {
  result = DK.applyBrief(P, A);
  $('#lChanges').innerHTML = (result.ch.length ? result.ch : ['Проект подходит без изменений']).map(t => `<li>${esc(t)}</li>`).join('');
  $('#lNotes').innerHTML = result.notes.map(t => `<li>${esc(t)}</li>`).join(''); $('#lNotesBox').hidden = !result.notes.length;
  const e = result.est;
  $('#lEst').innerHTML = `<small>${esc(C.prices[A.cls].n)}: ориентир под чистовую отделку, ${DK.fmtA(e.area)} м²</small><b>${money(e.from)}–${money(e.to)} млн ₽</b><small>${esc(C.priceNote)}</small>`;
  override = result.p;
  const imgs = DK.floorsOf(result.p).map(f => plan.toImage(f, { width: 1400 }));
  override = null;
  result.images = { plans: imgs };
  $('#lThumbs').innerHTML = imgs.map(u => `<img src="${u}" alt="План этажа">`).join('');
  DK.loadThree().then(() => {
    if (!v3) v3 = DK.View3D($('#c3d'), app);
    override = result.p; result.images.exterior = v3.exteriorShot(1400, 900); override = null; v3.rebuild();
    $('#lThumbs').insertAdjacentHTML('beforeend', `<img src="${result.images.exterior}" alt="Вид снаружи">`);
  }).catch(() => { /* без 3D — только планы */ });
}
async function submit() {
  $('#lNext').disabled = true; $('#lNext').textContent = 'Отправляю…';
  const ans = Object.assign({}, A);
  const payload = {
    answers: ans, brief: DK.brief(result.p), changes: result.ch, notes: result.notes, estimate: result.est,
    project: result.p, images: result.images, page: location.href, at: new Date().toISOString(),
  };
  const r = await DK.sendLead(payload);
  if ($('#lApply').checked) { P = result.p; sel = null; app.commit('Проект скорректирован'); plan.fit(); }
  const box = $('#lDone');
  if (r.ok) box.innerHTML = `<b>Заявка № ${esc(r.id)} принята</b><p>Перезвоним${A.time ? ' (' + esc(A.time) + ')' : ' в рабочее время'}, уточним детали и подготовим техзадание на расчёт. Проект сохранён — можно продолжать править.</p>`;
  else {
    box.innerHTML = `<b>Сервер заявок недоступен</b><p>Заявка с планами сохранена файлом — отправьте его нам${C.owner.phone ? ' или позвоните: ' + esc(C.owner.phone) : ''}${C.owner.email ? ', почта: <a href="mailto:' + esc(C.owner.email) + '">' + esc(C.owner.email) + '</a>' : ''}.</p>`;
    download('zayavka-dom.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload)));
  }
  go(5);
}

/* ---------- запуск ---------- */
bind();
setView('plan');
refresh();
requestAnimationFrame(() => { plan.size(); plan.fit(); app.setTool('select'); });
if (location.hash) page(location.hash.slice(1), true);
})();
