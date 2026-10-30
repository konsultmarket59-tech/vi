/* Связка интерфейса: проект, история правок, виды, панели, анкета, каталог */
(function () {
'use strict';
const DK = window.DK, C = DK.CONFIG;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = DK.esc;
const KEY = 'dk-project-v2';

/* ---------- состояние ---------- */
function load() { try { return DK.migrate(JSON.parse(localStorage.getItem(KEY)) || JSON.parse(localStorage.getItem('dk-project-v1'))); } catch (e) { return null; } }
// просмотр эскиза заявки (?crm=номер — сотрудник, ?company=номер — компания): свой проект в браузере не трогаем
const VIEW = (() => { const q = new URLSearchParams(location.search); return q.get('crm') ? { kind: 'crm', id: q.get('crm') } : q.get('crmp') ? { kind: 'crmp', id: q.get('crmp') } : q.get('company') ? { kind: 'company', id: q.get('company') } : null; })();
function save() { if (VIEW) return; try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* приватный режим */ } }
let P = load() || DK.starter();
['b', 'f1', 'f2', 'f3'].forEach(f => { if (!P.levels[f]) P.levels[f] = DK.emptyLevel(); });
DK.normalize(P);
let override = null, fid = 'f1', view = 'plan', sel = null, wetIdx = 0, siteOn = false;
const opts = { dimOpen: true, furn: true, cut: true };
const hist = [JSON.stringify(P)]; let hi = 0;

const app = {
  p: () => override || P,
  fid: () => fid,
  sel: () => sel,
  opt: (k) => opts[k],
  select(s) { sel = s; hideRoomPop(); renderSel(); plan.render(); },
  roomPop(sx, sy) { roomPop(sx, sy); },
  commit(msg) {
    DK.normalize(P);
    const s = JSON.stringify(P);
    if (s !== hist[hi]) { hist.splice(hi + 1); hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1; }
    save(); refresh(); if (v3 && view !== 'plan') v3.rebuild();
    if (siteOn) { site.render(); renderSite(); }
  },
  siteSel() { renderSite(); },
  live() { refreshInfo(); if (v3 && view !== 'plan') v3.rebuild(); },
  toast,
  setTool(t, arg) { plan.setTool(t, arg); $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t))); hint(); },
  paint3d(key) {
    const F = facadeEdit(); F.paint = F.paint || {};
    const cur = F.paint[key] || null, order = [null, 'accent', 'plinth', 'main'];
    const nx = order[(order.indexOf(cur) + 1) % order.length];
    if (nx) F.paint[key] = nx; else delete F.paint[key];
    toast(nx ? `Участок: ${{ accent: 'акцент', plinth: 'как цоколь', main: 'основной' }[nx]}` : 'Участок: как задано по зонам');
    app.commit('Акцент');
  },
  pick3d(pk) { sel = pk ? { kind: pk.kind, id: pk.id } : null; renderSel(); },
  walkFloor(f) { fid = f; refreshFloors(); },
};

const plan = DK._plan = DK.Plan2D($('#c2d'), app);
const site = DK._site = DK.SitePlan($('#cSite'), app);
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
  $('#hClear').value = P.hClear; $('#basement').checked = P.basement;
  $('#attic').checked = !!P.attic; $('#attic').disabled = P.floors < 2; $('#kneeRow').hidden = !DK.atticOn(P); $('#knee').value = DK.knee(P);
  seg($('#floorsN'), P.floors, 'n'); seg($('#wallMat'), P.wallMat, 'k'); seg($('#insul'), P.insul, 'k');
  $('#clad').value = P.clad;
  seg($('#blind'), P.blind || 0, 'k'); $('#blindMat').value = P.blindMat || 'paving';
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
  refreshFloors();
  // фасад
  $('#roofs').innerHTML = Object.entries(DK.ROOFS).map(([k, r]) => `<button data-k="${k}" aria-pressed="${P.roof.type === k}">${roofIcon(k)}${esc(r.n)}</button>`).join('');
  $$('#roofs button').forEach(bt => bt.onclick = () => { P.roof.type = bt.dataset.k; P.roof.pitch = DK.ROOFS[bt.dataset.k].pitch || P.roof.pitch; app.commit('Кровля'); });
  $('#pitchRow').hidden = P.roof.type === 'flat'; $('#ridgeRow').hidden = ['flat', 'hip', 'pyramid'].includes(P.roof.type);
  $('#pitch').value = P.roof.pitch; $('#pitchV').textContent = P.roof.pitch + '°';
  seg($('#ridge'), P.roof.ridge, 'k');
  renderFacade();
  $('#stairType').value = P.stair ? P.stair.type : '';
  $('#tz').innerHTML = DK.tzItems(P).map(t => `<li>${esc(t)}</li>`).join('') || '<li>Усилений не требуется</li>';
  $$('#shapes button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  $('#undo').disabled = hi <= 0; $('#redo').disabled = hi >= hist.length - 1;
  refreshInfo(); renderSel(); plan.render();
}
function refreshFloors() {
  const fname = (f) => f === DK.atticFloor(P) ? 'Мансарда' : DK.FLOORS.find(x => x.id === f).n;
  $('#floorTabs').innerHTML = DK.floorsOf(P).map(f => `<button data-f="${f}" aria-pressed="${!siteOn && f === fid}">${fname(f)}</button>`).join('') + `<button data-f="site" aria-pressed="${siteOn}">Участок</button>`;
  $$('#floorTabs button').forEach(bt => bt.onclick = () => setFloor(bt.dataset.f));
  $('#walkFloors').innerHTML = DK.floorsOf(P).map(f => `<button class="btn sm" data-f="${f}" aria-pressed="${f === fid}">${fname(f)}</button>`).join('');
  $$('#walkFloors button').forEach(bt => bt.onclick = () => setFloor(bt.dataset.f));
}
/* фасад: готовые сочетания и материал/цвет каждой зоны */
function facadeEdit() { if (!P.facade) P.facade = JSON.parse(JSON.stringify(DK.facadeOf(P))); return P.facade; }
function renderFacade() {
  const F = DK.facadeOf(P);
  const sw = (f) => `linear-gradient(135deg,${f.main.c} 0 45%,${(f.accentOn !== 'none' ? f.accent : f.main).c} 45% 62%,${f.plinth.c} 62% 74%,${f.roof.c} 74%)`;
  $('#styles').innerHTML = Object.entries(DK.FACADES).map(([k, s]) => `<button data-k="${k}" aria-pressed="${!P.facade && DK.facadeOf(P) === s.f}"><i style="background:${sw(s.f)}"></i>${esc(s.n)}</button>`).join('');
  $$('#styles button').forEach(bt => bt.onclick = () => { P.style = bt.dataset.k; P.facade = null; if (bt.dataset.k === 'hitech' && P.roof.type !== 'flat') { P.roof.type = 'flat'; toast('Хай-тек — с плоской кровлей'); } app.commit('Фасад'); });
  const zoneRow = ([k, n]) => {
    const z = F[k] || (k === 'gable' ? null : F.main), opts2 = k === 'roof' ? DK.ROOF_MATS : DK.WALL_MATS;
    if (k === 'gable' && !z) return `<span>${n}</span><button type="button" class="lnk" data-gable>как стены — изменить</button>`;
    return `<span>${n}</span><span class="zrow"><select data-z="${k}">${Object.entries(opts2).map(([m, t]) => `<option value="${m}"${z.m === m ? ' selected' : ''}>${t}</option>`).join('')}</select><input type="color" data-zc="${k}" value="${z.c}"></span>`;
  };
  $('#zones').innerHTML = DK.FACADE_ZONES.map(zoneRow).join('') +
    DK.FACADE_COLORS.map(([k, n]) => `<span>${n}</span><span class="zrow"><input type="color" data-cc="${k}" value="${F[k]}"></span>`).join('');
  $('#accentOn').value = F.accentOn; $('#wainscot').value = String(F.wainscot || 0);
  $('#fSur').checked = !!F.surrounds; $('#fBelt').checked = !!F.belt; $('#fCorn').checked = !!F.corners;
  $$('#zones [data-z]').forEach(i => i.onchange = () => { const f2 = facadeEdit(); f2[i.dataset.z] = Object.assign({}, f2[i.dataset.z] || f2.main, { m: i.value }); app.commit('Фасад'); });
  $$('#zones [data-zc]').forEach(i => { i.oninput = () => { const f2 = facadeEdit(); f2[i.dataset.zc] = Object.assign({}, f2[i.dataset.zc] || f2.main, { c: i.value }); if (v3) v3.rebuild(); }; i.onchange = () => app.commit('Цвет'); });
  $$('#zones [data-cc]').forEach(i => { i.oninput = () => { facadeEdit()[i.dataset.cc] = i.value; if (v3) v3.rebuild(); }; i.onchange = () => app.commit('Цвет'); });
  const g = $('#zones [data-gable]'); if (g) g.onclick = () => { const f2 = facadeEdit(); f2.gable = Object.assign({}, f2.main); app.commit(); };
}
function shapeSvg(T) {
  // мини-модель: стены контура в изометрии, без кровли — как эскиз
  const pts = T.pts, H = 3200 * (T.floors > 1 ? 1.75 : 1), k = 0.0042;
  const iso = (x, y, z) => [(x - y) * 0.866 * k, (x + y) * 0.5 * k - z * k];
  const faces = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const out = a[1] === b[1] ? -Math.sign(b[0] - a[0]) : Math.sign(b[1] - a[1]);
    const visible = a[1] === b[1] ? out > 0 : out > 0;
    if (!visible) continue;
    faces.push({ d: (a[0] + b[0] + a[1] + b[1]) / 2, q: [iso(a[0], a[1], 0), iso(b[0], b[1], 0), iso(b[0], b[1], H), iso(a[0], a[1], H)], shade: a[1] === b[1] ? '#ffffff' : '#e7e8ea' });
  }
  faces.sort((m, n) => m.d - n.d);
  const top = pts.map(([x, y]) => iso(x, y, H));
  const all = faces.flatMap(f => f.q).concat(top), xs = all.map(q => q[0]), ys = all.map(q => q[1]);
  const x0 = Math.min(...xs) - 4, y0 = Math.min(...ys) - 4, w = Math.max(...xs) - x0 + 4, h = Math.max(...ys) - y0 + 4;
  const P = (q) => q.map(v => v[0].toFixed(1) + ',' + v[1].toFixed(1)).join(' ');
  return `<svg viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" aria-hidden="true">${faces.map(f => `<polygon points="${P(f.q)}" fill="${f.shade}" stroke="#19317B" stroke-width=".8"/>`).join('')}<polygon points="${P(top)}" fill="#d5d7da" stroke="#19317B" stroke-width=".8"/></svg>`;
}
function refreshInfo() {
  const A = DK.areas(app.p());
  $('#areas').innerHTML = A.per.map(f => `<div><span>${esc(f.n)}</span><span>${DK.fmtA(f.area)} м²</span></div>`).join('') +
    `<div class="tot"><span>Всего помещений</span><span>${DK.fmtA(A.total)} м²</span></div>${A.loggia ? `<div><span>Лоджии</span><span>${DK.fmtA(A.loggia)} м²</span></div>` : ''}${A.outdoor ? `<div><span>Террасы, крыльца, балконы</span><span>${DK.fmtA(A.outdoor)} м²</span></div>` : ''}${A.garage ? `<div><span>Гараж, навес</span><span>${DK.fmtA(A.garage)} м²</span></div>` : ''}<div><span>Площадь застройки</span><span>${DK.fmtA(A.footprint)} м²</span></div>`;
  const et = DK.estimateText(app.p());
  $('#est').innerHTML = `<small>Предварительная оценка стоимости строительства (тёплый контур)</small><b>${et.range}</b><small>${et.perM2} · ${esc(C.priceNote)}</small>`;
  $('#checks').innerHTML = DK.checks(app.p()).map(c => `<li class="${c.lv}">${esc(c.txt)}</li>`).join('');
}
function varIcon(v) {
  const s = v.walls.map(w => w.axis === 'h' ? `<path d="M3 ${3 + 18 * (w.pos / P.D)}h24" stroke="#b8644a" stroke-width="2.4"/>` : `<path d="M${3 + 24 * (w.pos / P.W)} 3v18" stroke="#b8644a" stroke-width="2.4"/>`).join('');
  return `<i><svg viewBox="0 0 30 24"><rect x="3" y="3" width="24" height="18" fill="none" stroke="#19317B" stroke-width="1.6"/>${s}</svg></i>`;
}
function roofIcon(k) {
  const d = { gable: 'M3 18 L12 6 L21 18', hip: 'M3 18 L8 8 H16 L21 18', mansard: 'M3 18 L5 11 L12 6 L19 11 L21 18', halfhip: 'M3 18 L7 11 V8 L12 5 L17 8 V11 L21 18', pyramid: 'M3 18 L12 5 L21 18 M12 5 V18', shed: 'M3 18 V10 L21 6 V18', flat: 'M3 18 V9 H21 V18' }[k];
  return `<i style="background:none;box-shadow:none"><svg viewBox="0 0 24 24" width="22" height="22"><path d="${d}" fill="none" stroke="#19317B" stroke-width="1.8"/><path d="M3 18H21" stroke="#19317B" stroke-width="1.8"/></svg></i>`;
}

/* ---------- выделение ---------- */
function renderSel() {
  const box = $('#selBox');
  if (!sel) { box.hidden = true; return; }
  let h = '';
  if (sel.kind === 'open') {
    const r = findOp(sel.id); if (!r) { box.hidden = true; return; }
    const o = r.o, nm = o.kind === 'win' ? (o.pano ? 'Панорамное окно' : 'Окно') : o.kind === 'entry' ? 'Входная дверь' : o.kind === 'pass' ? 'Проём без двери' : 'Дверь';
    const wl = DK.walls(P, r.f).find(v => v.id === o.wall);
    h = `<h3>${nm} <small>${esc(DK.floorName(r.f))}</small></h3>`;
    if (o.kind === 'door' || o.kind === 'pass') h += `<div class="seg" id="sKind"><button data-k="door" aria-pressed="${o.kind === 'door'}">С дверью</button><button data-k="pass" aria-pressed="${o.kind === 'pass'}">Без двери</button></div>`;
    if (wl && wl.kind === 'bearing' && o.kind !== 'win') h += `<div class="muted">В несущей стене: ${o.w > DK.PASS.lintel ? 'усиленная перемычка по расчёту' : 'перемычка'} — добавлено в ТЗ. Ширина без двери до ${DK.PASS.maxBearing} мм.</div>`;
    else if (o.kind === 'door') h += `<div class="muted">Открывание ставится само: из котельной и санузлов — наружу, в комнату — из коридора.</div>`;
    const lim = DK.opLimits(P, wl, o);
    h += `<label class="fld">Ширина, мм · допустимо ${lim.min}–${lim.max}<span class="row"><button type="button" class="btn sm" id="sWm">− 100</button><input type="number" id="sW" step="50" min="${lim.min}" max="${lim.max}" value="${o.w}" style="width:76px"><button type="button" class="btn sm" id="sWp">+ 100</button></span></label>
      <div class="row2"><label class="fld">Сдвиг<span class="row"><button type="button" class="btn sm" id="sL">← 100</button><button type="button" class="btn sm" id="sR">100 →</button></span></label></div>`;
    if (o.kind === 'win') {
      const sz = DK.opSize(P, o);
      h += `<div class="seg" id="sPano"><button data-k="0" aria-pressed="${!o.pano}">Обычное</button><button data-k="1" aria-pressed="${!!o.pano}">Панорамное</button></div>
        <label class="fld">Створок<div class="seg" id="sSash">${[1, 2, 3, 4].map(n => `<button data-k="${n}" aria-pressed="${(o.sash || (o.w >= 1300 ? 2 : 1)) === n}">${n}</button>`).join('')}</div></label>
        ${o.pano ? '' : `<div class="row2"><label class="fld">Низ окна от пола<input type="number" id="sSill" step="50" min="300" max="1800" value="${sz.sill}"></label><label class="fld">Высота окна<input type="number" id="sH" step="50" min="400" max="${P.hClear - 300}" value="${sz.h}"></label></div>`}`;
    }
    h += `<button type="button" class="btn sm ghost" id="sDel">Удалить</button>`;
  } else if (sel.kind === 'part') {
    const q = P.levels[fid].parts.find(w => w.id === sel.id); if (!q) { box.hidden = true; return; }
    h = `<h3>${q.rail ? 'Ограждение' : 'Перегородка'} <small>${q.rail ? 'стекло и металл, 1,0 м' : 'кирпич 120 мм'}</small></h3><div class="muted">${q.x1 !== q.x2 && q.y1 !== q.y2 ? `Косая, длина ${Math.round(Math.hypot(q.x2 - q.x1, q.y2 - q.y1))} мм, угол ${(Math.round(Math.atan2(q.y2 - q.y1, q.x2 - q.x1) * 180 / Math.PI) % 180 + 180) % 180}°.` : `Длина ${Math.abs(q.x2 - q.x1) + Math.abs(q.y2 - q.y1)} мм.`} Тяните стену — сдвиг, тяните концы — длина.</div>
      <div class="seg" id="sRail"><button data-k="0" aria-pressed="${!q.rail}">Стена</button><button data-k="1" aria-pressed="${!!q.rail}">Ограждение</button></div>
      <button type="button" class="btn sm ghost" id="sDel">Удалить</button>`;
  } else if (sel.kind === 'ext') {
    const x = (P.ext || []).find(q => q.id === sel.id); if (!x) { box.hidden = true; return; }
    const D = DK.EXT[x.kind], cant = x.kind === 'balcony' && x.d > DK.BALCONY_CANT;
    if (x.kind === 'garage') h = `<h3>${DK.garageName(x)} <small>${DK.fmtA(x.w * x.d / 1e6)} м²</small></h3>
      <label class="fld">Машин<div class="seg" id="gCars">${[1, 2, 3].map(n => `<button data-k="${n}" aria-pressed="${(x.cars || 1) === n}">${n}</button>`).join('')}</div></label>
      <label class="fld">Как стоит<div class="seg" id="gType">${Object.entries(DK.GARAGE_TYPES).map(([k, n]) => `<button data-k="${k}" aria-pressed="${(x.gtype || 'attached') === k}">${n.replace('Пристрой к дому', 'Пристрой').replace('Отдельно у дома', 'Отдельно')}</button>`).join('')}</div></label>
      <div class="row2"><label class="fld">Ширина, мм<input type="number" id="xW" step="100" value="${x.w}"></label><label class="fld">Глубина, мм<input type="number" id="xD" step="100" value="${x.d}"></label></div>
      ${x.gtype !== 'carport' ? `<label class="fld">Кровля<div class="seg wrap" id="gRoof">${Object.entries(DK.GARAGE_ROOFS).map(([k, n]) => `<button data-k="${k}" aria-pressed="${(x.groof || 'auto') === k}">${n}</button>`).join('')}</div></label>` : ''}
      ${x.gtype === 'detached' ? `<label class="fld">От дома, мм<input type="number" id="gGap" step="100" value="${x.gap || DK.GARAGE.gap}"></label>` : ''}
      <div class="muted">${x.gtype === 'carport' ? 'Навес на стойках, кровля с уклоном от дома.' : x.gtype === 'detached' ? 'Отдельный гараж в стиле дома: те же стены и кровля.' : 'Пристроен к стене дома; общая стена противопожарная, дверь в дом EI 30.'} Ворота по 2,5 м на машину — ${{ far: 'со стороны, дальней от дома', near: 'со стороны дома', left: 'с левого торца', right: 'с правого торца' }[DK.garageGate(x)]}; «Повернуть» переносит их на другую сторону.</div>
      <div class="row"><button type="button" class="btn sm" id="gRot">Повернуть (R)</button><button type="button" class="btn sm ghost" id="sDel">Удалить</button></div>`;
    else h = `<h3>${D.n} <small>${DK.fmtA(x.w * x.d / 1e6)} м²</small></h3>
      <div class="row2"><label class="fld">Ширина, мм<input type="number" id="xW" step="100" value="${x.w}"></label><label class="fld">Глубина, мм<input type="number" id="xD" step="100" value="${x.d}"></label></div>
      ${x.kind !== 'balcony' ? `<div class="seg" id="xRoof">${Object.entries(DK.EXT_ROOF).map(([k, n]) => `<button data-k="${k}" aria-pressed="${(x.roof || 'open') === k}">${n.split(' ')[0]}</button>`).join('')}</div>` : ''}
      ${x.kind !== 'balcony' && (x.roof || 'open') !== 'open' ? `<label class="fld">Навес<div class="seg" id="xShape"><button data-k="shed" aria-pressed="${x.shape !== 'gable'}">Односкатный</button><button data-k="gable" aria-pressed="${x.shape === 'gable'}">Двускатный</button></div></label>` : ''}
      <div class="muted">${x.kind === 'balcony' ? (cant ? `Вылет больше ${DK.fmtM(DK.BALCONY_CANT)} м — плита опирается на колонны до земли.` : `Консольная плита с терморазрывом, вылет до ${DK.fmtM(DK.BALCONY_CANT)} м.`) : 'Тяните террасу вдоль стены, квадратики — ширина и глубина. Мебель для улицы — в разделе «Терраса».'}${DK.extExit(P, x) || x.kind === 'porch' ? '' : ' <b>Нужен выход: дверь или панорамное окно.</b>'}</div>
      ${x.kind !== 'balcony' ? `<details class="more"><summary>Крыша, колонны, остекление</summary><b>Открытая</b> — настил с ограждением. <b>Крытая</b> — навес над террасой, колонны встают сами: по углам у края и не реже чем через 3 м. <b>Застеклённая</b> — крытая терраса с остеклением по свободным сторонам. Поставьте террасы вплотную в ряд — ограждение и навес станут общими, между ними ограждения нет, колонна на стыке одна.${(() => { const j = DK.extJoin(P, x); return j.lo || j.hi ? ' <b>Эта терраса стоит в ряду с соседней.</b>' : ''; })()}</details>` : ''}
      <button type="button" class="btn sm ghost" id="sDel">Удалить</button>`;
  } else if (sel.kind === 'edge') {
    const e = DK.edges(P).find(x => x.id === sel.id); if (!e) { box.hidden = true; return; }
    h = `<h3>Наружная стена <small>фасад ${DK.sideName(e.side)}</small></h3><div class="muted">Длина ${e.hi - e.lo} мм. Тяните стену на плане — дом станет шире или уже, выступ глубже или меньше. Уберите выступ в ноль — он исчезнет.</div>
      <div class="row"><button type="button" class="btn sm" id="eIn">− 300 внутрь</button><button type="button" class="btn sm" id="eOut">+ 300 наружу</button></div>`;
  } else if (sel.kind === 'furn') {
    const f = P.levels[fid].furn.find(q => q.id === sel.id); if (!f) { box.hidden = true; return; }
    const F = DK.FURN[f.type];
    const Z = DK.furnSize(f), own = f.w || f.d || f.h;
    h = `<h3>${esc(F.n)} <small>${Z.w} × ${Z.d} × ${Z.h} · ${DK.furnAngle(f)}°</small></h3><div class="muted">Крутите за кружок над предметом (шаг 15°, с Alt — 1°) или нажмите R — 90°. Двигать можно и в 3D: в интерьере и на прогулке — тащите предмет мышью.</div>
      <div class="row2" style="grid-template-columns:1fr 1fr 1fr"><label class="fld">Ширина<input type="number" id="fW" step="50" value="${Z.w}"></label><label class="fld">Глубина<input type="number" id="fD" step="50" value="${Z.d}"></label><label class="fld">Высота<input type="number" id="fH" step="50" value="${Z.h}"></label></div>
      <div class="row"><button type="button" class="btn sm" id="fM">− 10 %</button><button type="button" class="btn sm" id="fP">+ 10 %</button>${own ? '<button type="button" class="btn sm ghost" id="f0">Как в каталоге</button>' : ''}</div>
      ${DK.furnStretch(f) ? `<div class="muted">${fronts(f)} Тяните синие ручки на торцах — длина меняется, фасады раскладываются сами.</div>` : ''}
      ${DK.KITCHENS.includes(f.type) ? `<label class="fld">Верхние шкафы<div class="seg" id="fUp"><button data-k="1" aria-pressed="${f.upper !== false}">С верхом</button><button data-k="0" aria-pressed="${f.upper === false}">Без верха</button></div></label>` : ''}
      <div class="row"><button type="button" class="btn sm" id="sRot">Повернуть на 90°</button><button type="button" class="btn sm ghost" id="sDel">Удалить</button></div>`;
  } else if (sel.kind === 'room') {
    const r = DK.rooms(P, fid).at(sel.x, sel.y); if (!r) { box.hidden = true; return; }
    h = `<h3>Помещение <small>${DK.fmtA(r.area)} м²${r.rect ? ' · ' + Math.round(r.x1 - r.x0) + ' × ' + Math.round(r.y1 - r.y0) : ''}</small></h3>
      <label class="fld">Назначение<select id="sType">${Object.entries(DK.ROOM).filter(([k, v]) => !v.upper || DK.floorsOf(P).indexOf(fid) > 0 && fid !== 'b').map(([k, v]) => `<option value="${k}"${r.type === k ? ' selected' : ''}>${esc(v.n)}</option>`).join('')}</select></label>`;
    if (r.type === 'void') h += `<div class="muted">Над помещением нижнего этажа нет перекрытия — двойная высота. Отделите второй свет ограждением, а не стеной. Усиление проёма — в ТЗ.</div>`;
    if (DK.lightAbove(P, fid) && r.type !== 'void') { const v2 = DK.secondLightOn(P, fid, r); h += `<label class="fld">Второй свет<div class="seg" id="sV2"><button data-k="0" aria-pressed="${!v2}">Нет</button><button data-k="1" aria-pressed="${v2}">Над помещением</button></div></label><details class="more"><summary>Что это</summary>Над помещением убирается перекрытие — потолок на высоте двух этажей, большие окна в два света. На этаже выше появляется ограждение по краю проёма. Удобно для гостиной или холла с лестницей.</details>`; }
    if (r.type === 'boiler') h += `<div class="muted">Котельная: объём от ${DK.BOILER.vol} м³, высота от 2,5 м, у наружной стены с окном (0,03 м² остекления на 1 м³), дверь от 800 мм.</div>`;
  } else if (sel.kind === 'stair') {
    h = `<h3>Лестница <small>${P.stair.w} × ${P.stair.l}</small></h3><div class="muted">${esc(DK.STAIRS[P.stair.type].n)}; на всех этажах в одном месте, в перекрытии — проём. Тип меняется в «Инструментах».</div>
      <div class="row"><button type="button" class="btn sm" id="sRot">Повернуть (R)</button><button type="button" class="btn sm ghost" id="sDel">Удалить</button></div>`;
  } else if (sel.kind === 'bearing') {
    h = `<h3>Несущая стена</h3><div class="muted">Кирпич 380 мм, опора плит перекрытия. Положение выбирается из допустимых вариантов слева и совпадает на всех этажах.</div>`;
  }
  box.innerHTML = h; box.hidden = !h;
  const on = (id, ev, fn) => { const e = $('#' + id, box); if (e) e.addEventListener(ev, fn); };
  if (sel.kind === 'open') {
    const r = findOp(sel.id), o = r.o, ws = DK.walls(P, r.f), w = ws.find(v => v.id === o.wall);
    const clampC = () => { o.c = Math.max(w.a0 + o.w / 2, Math.min(o.c, w.a1 - o.w / 2)); };
    const setW = (v) => { const lim = DK.opLimits(P, w, o); const nw = Math.max(lim.min, Math.min(v, lim.max)); if (nw !== v) toast(`Допустимо ${lim.min}–${lim.max} мм`); o.w = nw; clampC(); app.commit(); };
    on('sW', 'change', (e) => setW(+e.target.value || o.w));
    on('sWm', 'click', () => setW(o.w - 100)); on('sWp', 'click', () => setW(o.w + 100));
    on('sL', 'click', () => { o.c -= 100; clampC(); app.commit(); });
    on('sR', 'click', () => { o.c += 100; clampC(); app.commit(); });
    $$('#sPano button', box).forEach(b => b.onclick = () => { o.pano = b.dataset.k === '1'; if (o.pano && o.w < 1500) { o.w = 2000; clampC(); } app.commit(); });
    $$('#sSash button', box).forEach(b => b.onclick = () => { o.sash = +b.dataset.k; app.commit(); });
    on('sSill', 'change', (e) => { o.sill = Math.max(0, +e.target.value); app.commit(); });
    on('sH', 'change', (e) => { o.h = Math.max(400, +e.target.value); app.commit(); });
    on('sDel', 'click', () => { P.levels[r.f].open = P.levels[r.f].open.filter(q => q !== o); sel = null; app.commit(); });
    $$('#sKind button', box).forEach(b => b.onclick = () => { o.kind = b.dataset.k; if (o.kind === 'pass' && o.w < 900) o.w = 1200; if (o.kind === 'door' && o.w > 1000) o.w = 900; clampC(); app.commit(); });
  }
  if (sel.kind === 'part') { on('sDel', 'click', () => delSel()); $$('#sRail button', box).forEach(b => b.onclick = () => { const q = P.levels[fid].parts.find(w => w.id === sel.id); q.rail = b.dataset.k === '1'; P.levels[fid].open = P.levels[fid].open.filter(o => !(q.rail && o.wall === q.id)); app.commit(); }); }
  if (sel.kind === 'ext') {
    const x = (P.ext || []).find(q => q.id === sel.id);
    on('xW', 'change', (e) => { x.w = +e.target.value || x.w; app.commit(); });
    on('xD', 'change', (e) => { x.d = +e.target.value || x.d; app.commit(); });
    $$('#xRoof button', box).forEach(b => b.onclick = () => { x.roof = b.dataset.k; app.commit(); });
    $$('#gCars button', box).forEach(b => b.onclick = () => { x.cars = +b.dataset.k; const sideG = DK.garageGate(x) === 'left' || DK.garageGate(x) === 'right'; if (sideG) x.d = DK.GARAGE.w[x.cars]; else x.w = DK.GARAGE.w[x.cars]; app.commit(DK.garageName(x)); });
    on('gRot', 'click', () => { DK.garageRotate(x); app.commit('Гараж повёрнут'); });
    $$('#gRoof button', box).forEach(b => b.onclick = () => { x.groof = b.dataset.k; app.commit('Кровля гаража'); });
    $$('#gType button', box).forEach(b => b.onclick = () => { x.gtype = b.dataset.k; app.commit(DK.GARAGE_TYPES[x.gtype]); });
    on('gGap', 'change', (e) => { x.gap = Math.max(1000, Math.min(15000, +e.target.value || DK.GARAGE.gap)); app.commit(); });
    $$('#xShape button', box).forEach(b => b.onclick = () => { x.shape = b.dataset.k; app.commit(); });
    on('sDel', 'click', () => { P.ext = P.ext.filter(q => q !== x); sel = null; app.commit(); });
  }
  if (sel.kind === 'edge') { const mv = (d) => { const e = DK.edges(P).find(x => x.id === sel.id); if (!DK.moveEdge(P, sel.id, d * e.out)) { toast('Так стену не сдвинуть'); return; } const mx = Math.min(...P.poly.map(v => v.x)), my = Math.min(...P.poly.map(v => v.y)); app.commit('Стена'); plan.view.ox += mx * plan.view.k; plan.view.oy += my * plan.view.k; plan.render(); };
    on('eIn', 'click', () => mv(-300)); on('eOut', 'click', () => mv(300)); }
  if (sel.kind === 'furn') {
    on('sRot', 'click', () => rotSel()); on('sDel', 'click', () => delSel());
    const f = P.levels[fid].furn.find(q => q.id === sel.id), F = DK.FURN[f.type];
    // свой размер храним, только если он отличается от каталожного
    const clampK = (k, v) => k === 'w' ? DK.furnClampW(f, v) : DK.furnClamp(F[k], v);
    const setDim = (k, v) => { const nv = clampK(k, v); if (nv !== Math.round(v / 10) * 10) toast(`Допустимо ${clampK(k, 0)}–${clampK(k, 1e9)} мм`); if (nv === F[k]) delete f[k]; else f[k] = nv; };
    for (const [id, k] of [['fW', 'w'], ['fD', 'd'], ['fH', 'h']]) on(id, 'change', (e) => { setDim(k, +e.target.value || F[k]); app.commit('Размер предмета'); });
    const scale = (m) => { const Z = DK.furnSize(f); for (const k of ['w', 'd', 'h']) setDim(k, Z[k] * m); app.commit('Размер предмета'); };
    on('fM', 'click', () => scale(0.9)); on('fP', 'click', () => scale(1.1));
    on('f0', 'click', () => { delete f.w; delete f.d; delete f.h; app.commit('Размер как в каталоге'); });
    $$('#fUp button', box).forEach(b => b.onclick = () => { if (b.dataset.k === '1') delete f.upper; else f.upper = false; app.commit(b.dataset.k === '1' ? 'Кухня с верхними шкафами' : 'Кухня без верха'); });
  }
  if (sel.kind === 'stair') { on('sRot', 'click', () => rotSel()); on('sDel', 'click', () => delSel()); }
  if (sel.kind === 'room') {
    on('sType', 'change', (e) => setRoomType(sel.x, sel.y, e.target.value));
    $$('#sV2 button', box).forEach(b => b.onclick = () => { const r = DK.rooms(P, fid).at(sel.x, sel.y), msg = DK.secondLight(P, fid, r, b.dataset.k === '1'); app.commit(b.dataset.k === '1' ? 'Второй свет' : 'Перекрытие над помещением'); if (msg) toast(msg); });
  }
}
/* сколько фасадов получилось у корпусной мебели */
function fronts(f) {
  const F = DK.FURN[f.type], b = F.base || f.type, Z = DK.furnSize(f), n = (len, st) => DK.fronts(len, st).n;
  if (b === 'kitchen') return `Нижний ряд — модулей: ${n(Z.w, 600)} (ящики, створки, духовка)${f.upper !== false ? `; верхний ряд — створок: ${n(Z.w, 450)}` : '; без верхнего ряда'}.`;
  if (b === 'kitchenL') return `Нижние модули: ${n(Z.w - 600, 600) + n(Z.d - 600, 600)}${f.upper !== false ? `, верхние створки: ${n(Z.w - 350, 450) + n(Z.d - 350, 450)}` : ', без верхнего ряда'}.`;
  if (b === 'kitchenU') return `Нижние модули: ${n(Z.w - 1200, 600) + 2 * n(Z.d - 600, 600)}${f.upper !== false ? `, верхние створки: ${n(Z.w, 450)}` : ', без верхнего ряда'}.`;
  if (b === 'island') return `Модулей: ${n(Z.w, 600)}.`;
  if (b === 'wardrobe') return /купе/i.test(F.n) ? `Полотен купе: ${n(Z.w, 900)}.` : `Створок: ${n(Z.w, 450)}${Z.h > 2250 ? ', сверху антресоль' : ''}.`;
  if (b === 'dresser') return `Ящиков: ${n(Z.w, 800) * Math.max(2, Math.round((Z.h - 80) / 250))}.`;
  return '';
}
/* назначение помещения; котельная в доме одна — при переносе старая снимается */
function setRoomType(x, y, type) {
  const regs = DK.rooms(P, fid), r = regs.at(x, y), lv = P.levels[fid];
  if (!r) return;
  lv.names = lv.names.filter(n => regs.at(n.x, n.y) !== r);
  if (type === 'boiler') {
    let moved = false;
    for (const f of DK.floorsOf(P)) { const rs = DK.rooms(P, f); P.levels[f].names = P.levels[f].names.filter(n => { const q = rs.at(n.x, n.y); const old = n.type === 'boiler' && !(f === fid && q === r); if (old) moved = true; return !old; }); }
    if (moved) toast('Котельная перенесена сюда');
  }
  if (type !== 'none') lv.names.push({ x: Math.round(x), y: Math.round(y), type });
  // сауна сразу с полком и печью, если их там ещё нет
  if (type === 'sauna' && !lv.furn.some(it => /^sauna/.test(it.type) && regs.at(it.x, it.y) === r)) lv.furn.push(...DK.saunaFill(r));
  hideRoomPop(); app.commit();
}
// назначение помещений группами; цвет группы — акцент дизайн-системы
const POP_GROUPS = [
  ['Жилые', 'blue', ['kl', 'living', 'kitchen']], ['Спальни и кабинет', 'green', ['bed', 'kids', 'office']],
  ['Мокрые зоны', 'cyan', ['bath', 'laundry', 'sauna']], ['Проходные', 'navy', ['hall', 'corr', 'tamb']],
  ['Техника и хранение', 'orange', ['boiler', 'dress', 'store', 'garage']], ['Другое', 'coral', ['loggia', 'void', 'none']]];
function roomPop(sx, sy) {
  const r = DK.rooms(P, fid).at(sel.x, sel.y); if (!r) return;
  const upper = DK.floorsOf(P).indexOf(fid) > 0 && fid !== 'b';
  const pop = $('#roomPop'), ok = (k) => DK.ROOM[k] && (!DK.ROOM[k].upper || upper);
  pop.innerHTML = `<b>${DK.fmtA(r.area)} м² — назначение</b>` + POP_GROUPS.map(([g, tone, ks]) => ks.filter(ok).length ? `<div class="rgrp tone-${tone}"><small>${g}</small><div>${ks.filter(ok).map(k => `<button type="button" data-rt="${k}" aria-pressed="${r.type === k}">${DK.icon ? DK.icon(DK.ROOM_ICON[k] || 'square-dashed-bottom', 14) : ''}${esc(DK.ROOM[k].n)}</button>`).join('')}</div></div>` : '').join('');
  pop.hidden = false;
  const st = $('#stage').getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(sx + 12, st.width - pw - 8)) + 'px'; pop.style.top = Math.max(56, Math.min(sy + 12, st.height - ph - 8)) + 'px';
  $$('[data-rt]', pop).forEach(b => b.onclick = () => setRoomType(sel.x, sel.y, b.dataset.rt));
}
function hideRoomPop() { const p = $('#roomPop'); if (p) p.hidden = true; }
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
  if (sel.kind === 'furn') { const f = P.levels[fid].furn.find(q => q.id === sel.id); if (f) { f.a = (DK.furnAngle(f) + 90) % 360; delete f.rot; app.commit(); } }
  if (sel.kind === 'stair' && P.stair) { P.stair.rot = (P.stair.rot + 1) % 4; app.commit(); }
  if (sel.kind === 'ext') { const x = (P.ext || []).find(q => q.id === sel.id); if (x && x.kind === 'garage') { DK.garageRotate(x); app.commit('Гараж повёрнут'); } }
}

/* ---------- виды ---------- */
function hint() {
  const t = plan.tool();
  const H = {
    plan: { select: 'Нажмите на помещение, чтобы назначить его; тяните мебель, проёмы и перегородки. Колёсико — масштаб, тяните пустое место — сдвиг.',
            wall: 'Тяните от стены до стены — перегородка в полкирпича прилипает к граням стен.', door: 'Нажмите на стену — дверь 800 мм, на наружной — входная 1000 мм.',
            win: 'Нажмите на наружную стену — окно 1500 мм.', pass: 'Нажмите на внутреннюю стену — проём без двери 1200 мм. В несущей стене в ТЗ добавится перемычка.',
            terrace: 'Нажмите на наружную стену 1 этажа — терраса встанет у ближайшего панорамного окна или двери.', porch: 'Нажмите на наружную стену у входной двери.',
            wallD: 'Тяните от стены до стены — перегородка под любым углом с шагом 15°, длина с шагом 50 мм. Двери в косых перегородках не ставятся.',
            chamfer: 'Нажмите у выпуклого наружного угла — срез 1,5 м под 45°, ещё раз — 2 м, 1 м, без среза. Эркерный срез уменьшает комнату, кровля остаётся над углом.',
            measure: 'Тяните от точки до точки — длина в мм; концы прилипают к граням стен, с Shift — строго по горизонтали или вертикали.',
            garage: 'Нажмите на наружную стену 1 этажа — встанет гараж на 1 машину. Число машин, пристрой, отдельный гараж или навес — в карточке справа.',
            balcony: 'На плане 2 этажа нажмите на наружную стену — балкон встанет у двери или панорамного окна.',
            bump: 'Нажмите на наружную стену — появится выступ 3 × 1,2 м. Потом тяните его стены.', erase: 'Нажмите на перегородку, проём или мебель, чтобы удалить.', furn: 'Нажмите на план, чтобы поставить предмет.',
            wet: 'Тяните зону или её края. Зона общая для всех этажей.' }[t],
    int: 'Тяните — поворот, правая кнопка или Shift — сдвиг, колёсико — масштаб.',
    walk: 'Нажмите на сцену и идите: W A S D, мышь — взгляд. Сквозь стены не пройти — только через двери.',
    ext: 'Тяните окно — сдвиг по горизонтали; нажмите — панорамное, створки, ширина.',
  };
  const att = view === 'plan' && fid === DK.atticFloor(P) && t === 'select' ? ` Мансарда: пунктир — высота ${DK.fmtM(DK.atticH0(P))} м, ниже площадь считается ×0,7; окна в скатах — мансардные.` : '';
  $('#hint').textContent = view === 'plan' ? H.plan + att : H[view];
  $('#toolHint').textContent = view === 'plan' ? H.plan : '';
}
function setView(v) {
  if (siteOn && v === 'int') v = 'ext';
  view = v;
  const key = v === 'plan' && siteOn ? 'site' : v;
  document.body.className = 'v-' + key;
  seg($('#views'), v, 'view');
  $$('#side [data-v]').forEach(g => { g.hidden = !g.dataset.v.split(' ').includes(key); });
  $('#c2d').hidden = key !== 'plan'; $('#cSite').hidden = key !== 'site'; $('#c3d').hidden = v === 'plan';
  $('#floorTabs').hidden = v === 'ext' && !P.site;
  if (key === 'site') { site.size(); site.fit(); renderSite(); }
  $('#hud').hidden = v === 'walk';
  if (v === 'plan') { if (v3) v3.stop(); plan.size(); }
  else {
    $('#loading').hidden = false;
    DK.loadThree().then(() => {
      $('#loading').hidden = true;
      if (!v3) v3 = DK._view = DK.View3D($('#c3d'), app);
      v3.show(v === 'int' ? 'interior' : v === 'walk' ? 'walk' : 'exterior', fid, { cut: opts.cut, furn: opts.furn, refit: true });
    }).catch(() => { $('#loading').textContent = 'Не удалось загрузить 3D — проверьте интернет'; });
  }
  hint();
}
function setFloor(f) {
  if (f === 'site') {
    // участок: создаём по умолчанию, план участка вместо плана этажа
    if (!P.site) { DK.siteDefault(P); app.commit('Участок'); }
    siteOn = true; sel = null; refreshFloors(); setView(view === 'int' ? 'ext' : view); return;
  }
  const was = siteOn; siteOn = false;
  if (was) { fid = f; sel = null; refreshFloors(); setView(view); refresh(); return; }
  fid = f; sel = null;
  if (v3 && view === 'walk') v3.walkFloor(f);
  else if (v3 && view !== 'plan') v3.show(view === 'int' ? 'interior' : 'exterior', fid, { cut: opts.cut, furn: opts.furn, refit: true });
  refresh();
}

/* ---------- обработчики ---------- */
/* панель участка */
function renderSite() {
  const s = P.site; if (!s) return;
  $('#siteW').value = s.W / 1000; $('#siteD').value = s.D / 1000; seg($('#siteStreet'), s.street || 'S', 'k');
  $('#siteNorth').value = s.north || 0; $('#siteNorthV').textContent = (s.north || 0) + '°';
  $('#siteArea').textContent = DK.fmtA(DK.siteArea(s) / 1e8) + ' сот.' + (s.poly ? ` · ${s.poly.length} углов` : '');
  $('#siteWl').textContent = s.poly ? 'Габарит по ширине, м' : 'Ширина, м'; $('#siteDl').textContent = s.poly ? 'Габарит по длине, м' : 'Длина, м';
  const ed = site.editing(); $('#sitePolyEdit').setAttribute('aria-pressed', String(ed)); $('#sitePolyEdit').textContent = ed ? 'Готово' : 'Править контур';
  $('#sitePolyHint').hidden = !ed; $('#sitePolyReset').hidden = !s.poly;
  $('#siteChecks').innerHTML = DK.siteChecks(P).map(c => `<li class="${c.lv}">${esc(c.txt)}</li>`).join('');
  const id = site.sel(), q = s.objs.find(o => o.id === id), box = $('#siteSelBox');
  box.hidden = !q && id !== 'house';
  if (id === 'house') box.innerHTML = `<h3>Дом</h3><div class="muted">Тяните дом по участку. Кнопка «Дом по нормам» ставит его в 5 м от улицы по центру.</div>`;
  else if (q) {
    const T = DK.SITE_OBJ[q.type];
    box.innerHTML = `<h3>${esc(T.n)} <small>${DK.fmtM(q.w || T.w)} × ${DK.fmtM(q.d || T.d)} м</small></h3><div class="muted">Нормы: ${esc(T.rule)}.</div>
      ${T.g === 'tree' || q.type === 'tennis' ? '' : `<div class="row2"><label class="fld">Ширина, м<input type="number" id="soW" step="0.5" value="${(q.w || T.w) / 1000}"></label><label class="fld">Длина, м<input type="number" id="soD" step="0.5" value="${(q.d || T.d) / 1000}"></label></div>`}
      <div class="row"><button class="btn sm" id="soAuto">По нормам</button><button class="btn sm" id="soRot">Повернуть (R)</button><button class="btn sm ghost" id="soDel">Удалить</button></div>`;
    const dimO = (k, v) => { const val = Math.max(1000, Math.min(60000, Math.round(v * 2) * 500)); if (val === T[k]) delete q[k]; else q[k] = val; app.commit(T.n); };
    if ($('#soW')) { $('#soW').onchange = (e) => dimO('w', +e.target.value || T.w / 1000); $('#soD').onchange = (e) => dimO('d', +e.target.value || T.d / 1000); }
    $('#soAuto').onclick = () => { if (!DK.siteAuto(P, q)) toast('Места по нормам нет — увеличьте участок'); app.commit(T.n); };
    $('#soRot').onclick = () => { q.a = ((q.a || 0) + 90) % 180; app.commit('Поворот'); };
    $('#soDel').onclick = () => { s.objs = s.objs.filter(o => o !== q); site.select(null); app.commit('Удалено'); };
  }
}
function bind() {
  $('#attic').onchange = (e) => { P.attic = e.target.checked; if (P.attic && P.roof.type === 'flat') { P.roof.type = 'gable'; toast('Мансарда — под скатной кровлей: поставил двускатную'); } if (P.attic && (P.roof.pitch || 30) < 35) P.roof.pitch = 40; app.commit(P.attic ? 'Мансардный этаж' : 'Полноценный этаж'); refreshFloors(); };
  $('#knee').onchange = (e) => { P.knee = +e.target.value; app.commit('Колено мансарды'); };
  $('#sitePal').innerHTML = Object.entries(DK.SITE_OBJ).map(([k, o]) => `<button class="btn sm" data-site="${k}">+ ${esc(o.n)}</button>`).join('');
  $$('[data-site]').forEach(b => b.onclick = () => { const r = DK.siteAdd(P, b.dataset.site); site.select(r.o.id); if (!r.ok) toast('По нормам места не нашлось — поставил в центр, передвиньте или увеличьте участок'); app.commit(DK.SITE_OBJ[b.dataset.site].n); });
  const dimSite = (k, v) => {
    const s = P.site, nv = Math.max(8000, Math.min(200000, Math.round(v * 2) * 500));
    // у сложного контура габарит меняем растяжением по этой оси
    if (s.poly) { const f = nv / s[k]; s.poly = s.poly.map(q => k === 'W' ? { x: Math.round(q.x * f), y: q.y } : { x: q.x, y: Math.round(q.y * f) }); }
    s[k] = nv; DK.sitePlaceHouse(P); app.commit('Участок'); site.fit();
  };
  $('#sitePolyEdit').onclick = () => { site.edit(!site.editing()); if (!site.editing()) { DK.sitePlaceHouse(P); app.commit('Контур участка'); } renderSite(); };
  $('#sitePolyReset').onclick = () => { delete P.site.poly; DK.sitePlaceHouse(P); app.commit('Прямоугольный участок'); site.fit(); };
  $('#siteW').onchange = (e) => dimSite('W', +e.target.value || 20); $('#siteD').onchange = (e) => dimSite('D', +e.target.value || 30);
  $$('#siteStreet button').forEach(b => b.onclick = () => { P.site.street = b.dataset.k; DK.siteRearrange(P); app.commit('Улица'); site.fit(); });
  $('#siteNorth').oninput = (e) => { P.site.north = +e.target.value; $('#siteNorthV').textContent = P.site.north + '°'; site.render(); };
  $('#siteNorth').onchange = () => app.commit('Север');
  $('#siteHouse').onclick = () => { DK.sitePlaceHouse(P); app.commit('Дом по нормам'); };
  $('#siteAll').onclick = () => { DK.siteRearrange(P); app.commit('Расстановка по нормам'); };
  $$('#blind button').forEach(b => b.onclick = () => { P.blind = +b.dataset.k; app.commit(P.blind ? 'Отмостка ' + DK.fmtM(P.blind) + ' м' : 'Без отмостки'); });
  $('#blindMat').onchange = (e) => { P.blindMat = e.target.value; app.commit('Отмостка'); };
  if (!document.title) document.title = C.brand + ' — ' + C.tagline;
  $('#clad').innerHTML = Object.entries(DK.SPEC.clad).map(([k, v]) => `<option value="${k}">${esc(v.n)}</option>`).join('');
  $('#shapes').innerHTML = DK.TEMPLATES.map(T => `<button type="button" data-t="${T.id}" title="${esc(T.d)}">${shapeSvg(T)}<b>${esc(T.n)}</b><small>${esc(T.d)}</small></button>`).join('');
  $$('#shapes button').forEach(b => b.onclick = () => { const T = DK.TEMPLATES.find(x => x.id === b.dataset.t); $('#shapeAsk').hidden = false; $('#shapeAskT').textContent = `Начать с формы «${T.n}»? Текущая планировка будет заменена.`; $('#shapeYes').dataset.t = T.id; seg($('#shapes'), T.id, 't'); });
  $('#shapeNo').onclick = () => { $('#shapeAsk').hidden = true; seg($('#shapes'), '', 't'); };
  $('#shapeYes').onclick = (e) => { P = DK.fromTemplate(e.currentTarget.dataset.t); sel = null; fid = 'f1'; $('#shapeAsk').hidden = true; app.commit('Форма дома'); plan.fit(); if (v3 && view !== 'plan') setView(view); };
  $('#stairType').innerHTML = '<option value="">Без лестницы</option>' + Object.entries(DK.STAIRS).map(([k, s]) => `<option value="${k}">${esc(s.n)}</option>`).join('');
  $('#stairType').addEventListener('change', (e) => {
    const k = e.target.value;
    if (!k) { P.stair = null; app.commit(); return; }
    if (DK.floorsOf(P).length < 2) { toast('Лестница нужна, если этажей больше одного'); e.target.value = ''; return; }
    const S = DK.STAIRS[k], t = DK.ts(P), o = P.stair || { x: t + 200, y: t + 200, rot: 0 };
    P.stair = { type: k, x: o.x, y: o.y, w: S.w, l: S.l, rot: o.rot }; app.commit('Лестница'); app.select({ kind: 'stair' });
  });
  $('#accentOn').innerHTML = Object.entries(DK.ACCENT_ON).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('#accentOn').addEventListener('change', (e) => { facadeEdit().accentOn = e.target.value; app.commit(); });
  $('#wainscot').addEventListener('change', (e) => { facadeEdit().wainscot = +e.target.value; app.commit(); });
  $('#fPaint').onclick = (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); if (v3) v3.setPaint(on); toast(on ? 'Нажимайте на участки фасада: акцент → цоколь → основной → как по зонам' : 'Кисть выключена'); };
  $('#fPaintReset').onclick = () => { const F = facadeEdit(); delete F.paint; app.commit('Акценты сброшены'); };
  [['fSur', 'surrounds'], ['fBelt', 'belt'], ['fCorn', 'corners']].forEach(([i, k]) => $('#' + i).addEventListener('change', (e) => { facadeEdit()[k] = e.target.checked; app.commit(); }));
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
  $('#optDimOpen').addEventListener('change', (e) => { opts.dimOpen = e.target.checked; plan.render(); });
  // палитра мебели
  $('#furnPal').innerHTML = DK.FURN_GROUPS.map(g => `<details${g === 'Гостиная' ? ' open' : ''}><summary>${esc(g)}</summary><div class="row">${Object.entries(DK.FURN).filter(([, f]) => f.g === g).map(([k, f]) => `<button class="btn sm" data-furn="${k}">${esc(f.n)}</button>`).join('')}</div></details>`).join('');
  $$('[data-furn]').forEach(b => b.onclick = () => { if (view !== 'plan') setView('plan'); app.setTool('furn', b.dataset.furn); toast('Нажмите на план: ' + DK.FURN[b.dataset.furn].n); });
  // интерьер
  $('#tCut').onclick = (e) => { opts.cut = !opts.cut; e.currentTarget.setAttribute('aria-pressed', opts.cut); if (v3) v3.show('interior', fid, { cut: opts.cut, furn: opts.furn }); };
  $('#tFurn').onclick = (e) => { opts.furn = !opts.furn; e.currentTarget.setAttribute('aria-pressed', opts.furn); if (v3) v3.show('interior', fid, { cut: opts.cut, furn: opts.furn }); plan.render(); };
  let lights = false;
  $$('[data-light]').forEach(b => b.onclick = () => { lights = !lights; $$('[data-light]').forEach(x => { x.setAttribute('aria-pressed', lights); x.textContent = lights ? 'Выключить свет' : 'Включить свет'; }); if (v3) v3.setLights(lights); });
  $$('[data-lamps]').forEach(b => b.onclick = () => {
    let n = 0;
    for (const f of DK.floorsOf(P)) {
      const lv = P.levels[f];
      DK.rooms(P, f).filter(r => r.type !== 'void' && r.area > 2.5).forEach(r => {
        if (lv.furn.some(it => DK.FURN[it.type] && DK.FURN[it.type].ceil && r.cells.some(c => it.x >= c[0] && it.x <= c[2] && it.y >= c[1] && it.y <= c[3]))) return;
        lv.furn.push({ id: DK.id('f'), type: 'lampCeil', x: Math.round(r.cx), y: Math.round(r.cy), a: 0 }); n++;
      });
    }
    app.commit('Люстры'); toast(n ? `Добавлено люстр: ${n}` : 'Во всех комнатах уже есть свет');
  });
  $('#pitch').addEventListener('input', (e) => { P.roof.pitch = +e.target.value; $('#pitchV').textContent = e.target.value + '°'; if (v3) v3.rebuild(); });
  $('#pitch').addEventListener('change', () => app.commit());
  $$('#ridge button').forEach(b => b.onclick = () => { P.roof.ridge = b.dataset.k; app.commit(); });
  // виды
  $$('#views button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#zIn').onclick = () => view === 'plan' ? (siteOn ? site.zoom(1.25) : zoomPlan(1.25)) : v3 && v3.zoom(0.8);
  $('#zOut').onclick = () => view === 'plan' ? (siteOn ? site.zoom(0.8) : zoomPlan(0.8)) : v3 && v3.zoom(1.25);
  $('#fit').onclick = () => view === 'plan' ? (siteOn ? site.fit() : plan.fit()) : v3 && v3.fit();
  $('#undo').onclick = undo; $('#redo').onclick = redo;
  $('#shot').onclick = async () => {
    const name = (P.name || 'dom').replace(/\s+/g, '-');
    if (view === 'plan') download(`${name}-${fid}-plan.png`, await DK.shotWithExplication(plan.toImage(fid, { numbers: DK.roomNumbers(P) }), P, [fid], true));
    else if (v3) download(`${name}-${view}.png`, await DK.shotWithExplication(v3.shot(), P, view === 'ext' ? DK.floorsOf(P) : [fid]));
  };
  let skPages = [], skLock = null;
  $('[data-close]', $('#sketchDlg')).onclick = () => $('#sketchDlg').close();
  // эскизный проект в PDF — для сохранённых на платформе проектов
  const openSketch = async () => {
    $('#sketchDlg').showModal(); $('#skSheets').innerHTML = ''; $('#skPdf').disabled = true; $('#skStep').textContent = 'Загружаю 3D…';
    try {
      await DK.loadThree();
      if (!v3) v3 = DK._view = DK.View3D($('#c3d'), app);
      skPages = await DK.makeSketch(P, plan, v3, (t) => { $('#skStep').textContent = t; });
      // выгрузка PDF платная: пока не оплачена — листы с отметкой «Образец», кнопка ведёт к оплате
      const pid = (DK.Market.sketchId && DK.Market.sketchId()) || P.cloudId, lk = await DK.Market.unlocked(pid, 'ep');
      skLock = lk && !lk.ok ? lk.x : null; if (!lk) skLock = { none: true };
      const mark = (c) => { if (!skLock) return c.toDataURL('image/jpeg', 0.85); const t = document.createElement('canvas'); t.width = 1200; t.height = Math.round(1200 * c.height / c.width); const g = t.getContext('2d'); g.drawImage(c, 0, 0, t.width, t.height);
        g.save(); g.translate(t.width / 2, t.height / 2); g.rotate(-0.5); g.font = '700 110px Manrope, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(25,49,123,.16)'; g.fillText('ОБРАЗЕЦ', 0, 0); g.font = '600 34px Manrope, sans-serif'; g.fillText('Логика Дома · выгрузка после оплаты', 0, 60); g.restore(); return t.toDataURL('image/jpeg', 0.8); };
      $('#skSheets').innerHTML = skPages.map((c, i) => `<img src="${mark(c)}" alt="Лист ${i + 1}">`).join('');
      $$('#skSheets img').forEach(im => im.onclick = () => im.classList.toggle('big'));
      $('#skStep').textContent = `Готово: ${skPages.length} листов` + (skLock ? (skLock.none ? ' — образец; выгрузка PDF — из личного кабинета у сохранённого проекта' : ' — образец; PDF откроется после оплаты') : '');
      $('#skPdf').textContent = skLock && !skLock.none ? 'Скачать PDF — ' + Number(C.sketchPrice || 3000).toLocaleString('ru-RU') + ' ₽' : 'Скачать PDF'; $('#skPdf').disabled = !!(skLock && skLock.none);
    } catch (err) { $('#skStep').textContent = 'Не получилось собрать листы: ' + err.message; }
  };
  app.sketch = openSketch;
  $('#sketchBtn').onclick = () => {
    DK.Market.resetSketchId();
    if (P.cloudId) return openSketch();
    toast('Эскизный проект в PDF доступен после сохранения проекта на платформе'); DK.Market.openPublish('private');
  };
  $('#skPdf').onclick = async () => {
    if (skLock && !skLock.none) { $('#sketchDlg').close(); DK.Market.openPay('ep', skLock, () => openSketch()); return; }
    $('#skPdf').disabled = true; try { await DK.sketchPdf(skPages, 'eskiznyj-proekt.pdf'); } catch (e) { toast('PDF не собрался — проверьте интернет'); } $('#skPdf').disabled = false; };
  $('#resetProj').onclick = () => { $('#shapes').scrollIntoView({ block: 'nearest' }); toast('Выберите форму дома — планировка начнётся заново'); };
  // клавиши
  window.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || $('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (view === 'walk') return;
    if (siteOn && view === 'plan') {
      const id = site.sel(), q = P.site && P.site.objs.find(o => o.id === id);
      if (q && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); P.site.objs = P.site.objs.filter(o => o !== q); site.select(null); app.commit('Удалено'); }
      if (q && e.code === 'KeyR') { q.a = ((q.a || 0) + 90) % 180; app.commit('Поворот'); }
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); delSel(); }
    if (e.code === 'KeyR') rotSel();
    if (e.code === 'Escape') { app.setTool('select'); app.select(null); }
  });
  // страницы
  $$('nav.main button').forEach(b => b.onclick = () => page(b.dataset.page));
  $$('[data-act="lead"]').forEach(b => b.onclick = openLead);
  $$('[data-act="join"]').forEach(b => b.onclick = () => $('#joinDlg').showModal());
  window.addEventListener('hashchange', () => location.hash ? hashRoute() : page('project', true));
  $('#ownerLine').textContent = [C.owner.phone, C.owner.email, C.owner.city || 'Пермь, работаем по России'].filter(Boolean).join(' · ');
  $('#cityList').innerHTML = DK.CITIES.map(c => `<option value="${esc(c)}">`).join('');
  bindLead(); bindCatalog();
}
function clampDim(v) { return Math.max(6000, Math.min(24000, Math.round((+v || 10000) / 100) * 100)); }
function zoomPlan(f) { const c = $('#c2d').getBoundingClientRect(); $('#c2d').dispatchEvent(new WheelEvent('wheel', { deltaY: -Math.log(f) / 0.0015, clientX: c.left + c.width / 2, clientY: c.top + c.height / 2 })); }
function undo() { if (hi > 0) { hi--; P = JSON.parse(hist[hi]); sel = null; save(); refresh(); if (v3 && view !== 'plan') v3.rebuild(); } }
function redo() { if (hi < hist.length - 1) { hi++; P = JSON.parse(hist[hi]); sel = null; save(); refresh(); if (v3 && view !== 'plan') v3.rebuild(); } }

function page(id, fromHash) {
  if (!['project', 'builders', 'arch', 'how', 'projects', 'cab', 'company'].includes(id)) id = 'project';
  $$('dialog[open]').forEach(d => { if (d.id !== 'leadDlg') d.close(); });
  $$('main.page').forEach(m => { m.hidden = m.id !== 'page-' + id; });
  $$('nav.main button').forEach(b => b.setAttribute('aria-current', b.dataset.page === id ? 'page' : 'false'));
  if (!fromHash) history.replaceState(null, '', id === 'project' ? location.pathname : '#' + id);
  if (id === 'project') { if (view === 'plan') plan.size(); else setView(view); }
  else { if (v3) v3.stop(); if (id === 'projects') DK.Market.renderProjects(); else if (id === 'cab') DK.Market.renderCab(); else if (id === 'company') DK.Company.render(); else renderLists(); }
}

/* ---------- каталог ---------- */
const filt = { builders: {}, arch: {} };
function bindCatalog() {
  $$('.filters[data-for]').forEach(el => {
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
    d.materials = fd.getAll('mat'); delete d.mat; delete d.website; delete d['smart-token'];
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
    } else $('#jErr').textContent = r.error || 'Не получилось отправить, попробуйте позже';
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
  pick($('#lPlot'), 'plot'); pick($('#lSlope'), 'slope'); pick($('#lTerm'), 'term'); pick($('#lCls'), 'cls'); pick($('#lMat'), 'material'); pick($('#lSvc'), 'service');
  const rub = (v) => Number(v).toLocaleString('ru-RU') + ' ₽';
  $('#lSvcR').textContent = 'Проект — компаниям вашего города, вам — отчёт о предложениях. ' + rub(C.reportPrice || 1500);
  $('#lSvcF').textContent = 'Выбор компании, сравнение стоимости и технологий, график, договор. Данные закрыты до встречи. ' + rub(C.fullPrice || 14900) + ', компания вернёт при договоре';
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
    if (!A.service) return err('Выберите, как работаем с компаниями');
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
  $('#lEst').innerHTML = `<small>Предварительная оценка стоимости строительства (тёплый контур), класс «${esc(C.prices[A.cls].n)}», ${DK.fmtA(e.area)} м²</small><b>${e.range}</b><small>${e.perM2} · ${esc(C.priceNote)}</small>`;
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
  const lbl = $('#lNext').textContent; $('#lNext').disabled = true; $('#lNext').textContent = 'Отправляю…';
  const ans = Object.assign({}, A);
  const payload = {
    answers: ans, brief: DK.brief(result.p), changes: result.ch, notes: result.notes, estimate: result.est,
    project: result.p, images: result.images, page: location.href, at: new Date().toISOString(),
  };
  const r = await DK.sendLead(payload);
  // отказ проверки (капча, лимит) — остаёмся на шаге, человек может отправить ещё раз
  if (r.error) { toast(r.error); $('#lNext').disabled = false; $('#lNext').textContent = lbl; return; }
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
DK.goPage = (id) => page(id);
DK.toast = toast;
DK.appApi = {
  project: () => P,
  view: () => view,
  // снимок текущего 3D-вида для визуализации: JPEG до 1600 px по ширине
  shot3d() { if (!v3 || view === 'plan') return null; const src = $('#c3d'), k = Math.min(1, 1600 / src.width), c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k); v3.shot(); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return { data: c.toDataURL('image/jpeg', 0.88), kind: view === 'ext' ? 'ext' : 'int', w: c.width, h: c.height }; },
  sketch: () => app.sketch(),
  floor: (f) => { if (DK.floorsOf(P).includes(f)) { siteOn = false; setFloor(f); } },
  setCloud(id, title) { if (id) { P.cloudId = id; if (title) P.cloudTitle = title; } else { delete P.cloudId; delete P.cloudTitle; } save(); },
  load(d) { P = DK.normalize(DK.migrate(JSON.parse(JSON.stringify(d)))); ['b', 'f1', 'f2', 'f3'].forEach(k => { if (!P.levels[k]) P.levels[k] = DK.emptyLevel(); }); sel = null; fid = 'f1'; app.commit('Проект открыт'); plan.fit(); },
  async images() {
    const nums = DK.roomNumbers(P), out = { plans: DK.floorsOf(P).map(f => plan.toImage(f, { width: 1400, numbers: nums })) };
    try { await DK.loadThree(); if (!v3) v3 = DK._view = DK.View3D($('#c3d'), app); out.exterior = v3.exteriorShot(1400, 900); v3.rebuild(); } catch (e) { /* без 3D — только планы */ }
    return out;
  },
};
bind();
DK.Market.init();
DK.howInit && DK.howInit();
DK.loadPrices && DK.loadPrices().then(() => refreshInfo());
if (VIEW) (async () => {
  const tk = VIEW.kind === 'company' ? localStorage.getItem('dk-token') : localStorage.getItem('crm-token');
  try {
    const r = await fetch(({ crm: '/api/crm/lead/', crmp: '/api/crm/project/', company: '/api/company/lead/' })[VIEW.kind] + encodeURIComponent(VIEW.id), { headers: { Authorization: 'Bearer ' + tk } });
    const l = await r.json(); if (!r.ok || !l.project) throw new Error(l.error || 'Эскиз недоступен');
    P = DK.normalize(DK.migrate(l.project)); ['b', 'f1', 'f2', 'f3'].forEach(f => { if (!P.levels[f]) P.levels[f] = DK.emptyLevel(); });
    hist.length = 0; hist.push(JSON.stringify(P)); hi = 0; sel = null; fid = 'f1'; refresh(); plan.fit();
    const bar = document.createElement('div'); bar.className = 'viewbar';
    // верификация: архитектор платформы правит проект автора и сохраняет исправления
    const fix = VIEW.kind === 'crmp' && new URLSearchParams(location.search).get('fix') && l.verify && ['paid', 'in_work'].includes(l.verify.status);
    bar.innerHTML = `${VIEW.kind === 'crmp' ? 'Проект пользователя «' + esc(l.title || VIEW.id) + '»' : 'Эскиз заявки № ' + esc(VIEW.id)} — ${fix ? 'верификация: исправьте проект и сохраните.' : 'просмотр: размеры, 3D, рулетка. Изменения не сохраняются.'} <button class="btn sm" id="vbMeasure">Рулетка</button>${fix ? ' <button class="btn sm primary" id="vbSave">Сохранить исправления</button>' : ''}`;
    document.body.prepend(bar); $('#vbMeasure').onclick = () => { setView('plan'); app.setTool('measure'); };
    if (fix) $('#vbSave').onclick = async () => {
      const q = DK.quality(P); if (!q.ok) { toast('Сначала исправьте ошибки: ' + (q.errs[0] ? q.errs[0].txt : 'много замечаний')); return; }
      try {
        const r2 = await fetch('/api/crm/project/' + encodeURIComponent(VIEW.id), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ project: P }) });
        const d2 = await r2.json().catch(() => ({})); if (!r2.ok) throw new Error(d2.error || 'Не сохранилось');
        toast('Исправления сохранены в проект автора');
      } catch (er) { toast(er.message); }
    };
  } catch (e) { toast(e.message); }
})();
setView('plan');
refresh();
requestAnimationFrame(() => { plan.size(); plan.fit(); app.setTool('select'); });
// ссылки с публичных страниц: #lead — анкета подбора, #join — регистрация исполнителя, #company — кабинет компании
function hashRoute() {
  const h = location.hash.slice(1);
  if (h === 'lead') { history.replaceState(null, '', location.pathname); openLead(); }
  else if (h === 'join') { history.replaceState(null, '', location.pathname); $('#joinDlg').showModal(); }
  else if (h === 'company') DK.Market.openCabinet('company');
  else if (h.startsWith('project=')) { page('projects', true); DK.Market.openProject(h.slice(8)); }
  else if (h) page(h, true);
}
if (location.hash) hashRoute();
})();
