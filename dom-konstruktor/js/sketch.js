/* Экспликация на снимках и листы эскизного проекта (А3, альбомная): титул, планы, разрез, фасады, 3D-виды, ТЗ */
(function () {
'use strict';
const DK = window.DK;
const SW = 1754, SH = 1240; // А3 при ~106 dpi
const INK = '#2b2e33', MUTED = '#6b7078', CUT = '#8e9aa5', LINE = '#c9ccd1';

/* номера помещений: по этажам, внутри этажа — сверху вниз, слева направо */
DK.roomNumbers = function (p) {
  const out = {}; let n = 1;
  for (const f of DK.floorsOf(p)) {
    const m = new Map();
    DK.rooms(p, f).filter(r => r.type !== 'void').sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx)).forEach(r => m.set(r.i, n++));
    out[f] = m;
  }
  return out;
};
DK.explicationRows = function (p, fids) {
  const nums = DK.roomNumbers(p), rows = [];
  for (const f of fids) {
    const regs = DK.rooms(p, f).filter(r => r.type !== 'void');
    rows.push({ head: DK.floorName(f) });
    regs.slice().sort((a, b) => nums[f].get(a.i) - nums[f].get(b.i)).forEach(r => rows.push({ n: nums[f].get(r.i), name: (DK.ROOM[r.type] || DK.ROOM.none).n, area: r.area }));
  }
  return rows;
};
/* таблица экспликации; возвращает высоту */
function drawTable(c, x, y, w, rows, title, scale) {
  const s = scale || 1, rh = 22 * s, pad = 10 * s;
  const h = (rows.length + 1) * rh + pad * 2 + 6 * s;
  c.save();
  c.fillStyle = 'rgba(255,255,255,.94)'; c.strokeStyle = INK; c.lineWidth = 1.2 * s;
  c.fillRect(x, y, w, h); c.strokeRect(x, y, w, h);
  c.fillStyle = INK; c.font = `700 ${15 * s}px Raleway, sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText(title || 'Экспликация помещений', x + pad, y + pad + rh / 2);
  let yy = y + pad + rh + 4 * s;
  for (const r of rows) {
    if (r.head) { c.font = `700 ${12.5 * s}px Raleway, sans-serif`; c.fillStyle = MUTED; c.fillText(r.head, x + pad, yy + rh / 2); }
    else {
      c.font = `500 ${12.5 * s}px "JetBrains Mono", monospace`; c.fillStyle = INK; c.textAlign = 'left';
      c.fillText(String(r.n).padStart(2, ' '), x + pad, yy + rh / 2);
      c.font = `500 ${13 * s}px Raleway, sans-serif`; c.fillText(r.name, x + pad + 34 * s, yy + rh / 2);
      c.font = `500 ${12.5 * s}px "JetBrains Mono", monospace`; c.textAlign = 'right'; c.fillText(DK.fmtA(r.area), x + w - pad, yy + rh / 2); c.textAlign = 'left';
      c.strokeStyle = LINE; c.lineWidth = 0.6 * s; c.beginPath(); c.moveTo(x + pad, yy + rh); c.lineTo(x + w - pad, yy + rh); c.stroke();
    }
    yy += rh;
  }
  c.restore();
  return h;
}
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }

/* снимок с экспликацией в правом верхнем углу */
DK.shotWithExplication = async function (url, p, fids, side) {
  const img = await loadImg(url), c = document.createElement('canvas');
  const s = Math.max(1, img.width / 1400), extra = side ? 360 * s : 0;
  c.width = img.width + extra; c.height = img.height;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  const rows = DK.explicationRows(p, fids), A = DK.areas(p);
  rows.push({ head: `Всего помещений ${DK.fmtA(fids.length === DK.floorsOf(p).length ? A.total : A.per.filter(f => fids.includes(f.fid)).reduce((a, f) => a + f.area, 0))} м²` });
  const w = 330 * s;
  drawTable(g, c.width - w - 16 * s, 16 * s, w, rows, 'Экспликация помещений', s);
  return c.toDataURL('image/png');
};

/* ---------- листы ---------- */
function sheet(title, num, total) {
  const c = document.createElement('canvas'); c.width = SW; c.height = SH;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, SW, SH);
  g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(70, 24, SW - 94, SH - 48);
  // штамп
  const C = DK.CONFIG, bw = 560, bh = 70, bx = SW - 24 - bw, by = SH - 24 - bh;
  g.lineWidth = 1.5; g.strokeRect(bx, by, bw, bh);
  g.beginPath(); g.moveTo(bx + 380, by); g.lineTo(bx + 380, by + bh); g.moveTo(bx, by + 34); g.lineTo(bx + 380, by + 34); g.stroke();
  g.fillStyle = INK; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = '800 22px "Alumni Sans", Raleway, sans-serif'; g.fillText((C.brand || '').toUpperCase() + ' · ЭСКИЗНЫЙ ПРОЕКТ', bx + 12, by + 17);
  g.font = '600 15px Raleway, sans-serif'; g.fillText(title, bx + 12, by + 52);
  g.textAlign = 'center'; g.font = '500 13px Raleway, sans-serif'; g.fillStyle = MUTED; g.fillText('Лист', bx + 470, by + 20);
  g.fillStyle = INK; g.font = '700 22px "JetBrains Mono", monospace'; g.fillText(num + ' / ' + total, bx + 470, by + 46);
  return { c, g };
}
function fitImg(g, img, x, y, w, h) { const k = Math.min(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k; g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, k }; }
/* рендер → эскиз карандашом: контуры по перепадам яркости и лёгкая штриховка */
function pencil(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data, W = c.width, H = c.height, L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.3 * a[i * 4] + 0.59 * a[i * 4 + 1] + 0.11 * a[i * 4 + 2];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = -L[i - W - 1] - 2 * L[i - 1] - L[i + W - 1] + L[i - W + 1] + 2 * L[i + 1] + L[i + W + 1];
    const gy = -L[i - W - 1] - 2 * L[i - W] - L[i - W + 1] + L[i + W - 1] + 2 * L[i + W] + L[i + W + 1];
    const e = Math.min(255, Math.hypot(gx, gy) * 1.6), shade = 255 - (255 - L[i]) * 0.28 - ((x + y) % 7 === 0 && L[i] < 120 ? 25 : 0);
    const v = Math.max(0, Math.min(255, shade - e));
    a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}
function levelMark(g, x, y, text, left) {
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x - 9, y - 12); g.lineTo(x + 9, y - 12); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x - (left ? 90 : 12), y); g.lineTo(x + (left ? 12 : 90), y); g.stroke();
  g.font = '600 15px "JetBrains Mono", monospace'; g.textAlign = left ? 'right' : 'left'; g.textBaseline = 'bottom';
  g.fillText(text, x + (left ? -14 : 14), y - 4);
}
const lvl = (m) => (m >= 0 ? '+' : '−') + Math.abs(m).toFixed(3).replace('.', ',');
function counts(p) {
  let bed = 0, bath = 0, dress = 0;
  for (const f of DK.floorsOf(p)) DK.rooms(p, f).forEach(r => { if (['bed', 'kids'].includes(r.type)) bed++; if (r.type === 'bath') bath++; if (r.type === 'dress') dress++; });
  return { bed, bath, dress };
}

/* разрез 1-1 по середине основного объёма, поперёк длинной стороны */
DK.section = section;
function section(p) {
  const c = document.createElement('canvas'); c.width = 1500; c.height = 980;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  const M = DK.mainRect(p), alongX = (M.x1 - M.x0) >= (M.y1 - M.y0);
  // режем поперёк длинной стороны: линия x = середина, смотрим вдоль X
  const cut = alongX ? (M.x0 + M.x1) / 2 : (M.y0 + M.y1) / 2, ax = alongX ? 'v' : 'h';
  const sp = DK.lineSpan(p, ax, cut) || (alongX ? [M.y0, M.y1] : [M.x0, M.x1]);
  const t = DK.ts(p), ext = DK.extT(p), fl = DK.floorsOf(p), H = DK.storey(p), hc = p.hClear, sl = p.slab;
  const af = DK.atticFloor(p), yt = af ? DK.elev(p, af) + DK.knee(p) : DK.elev(p, fl[fl.length - 1]) + hc + sl, span = sp[1] - sp[0];
  const pitch = (p.roof.pitch || 30) * Math.PI / 180, ov = 550;
  const ridgeAcross = p.roof.type !== 'flat' && ((p.roof.ridge === 'short') ? !alongX : alongX);
  const yR = p.roof.type === 'flat' ? yt + 600 : ridgeAcross ? yt + (span / 2 + ext) * Math.tan(pitch) : yt + (Math.min(M.x1 - M.x0, M.y1 - M.y0) / 2 + ext) * Math.tan(pitch);
  const gy = p.basement ? DK.elev(p, 'b') + 1400 : -600, bottom = (p.basement ? DK.elev(p, 'b') : 0) - 1200;
  const k = Math.min((c.width - 380) / (span + 2 * ext + 2 * ov + 1000), (c.height - 120) / (yR - bottom + 800));
  const X = (u) => 190 + (u - sp[0] + ext + ov + 500) * k, Y = (z) => c.height - 60 - (z - bottom) * k;
  const R = (u0, u1, z0, z1, col) => { g.fillStyle = col; g.fillRect(X(u0), Y(z1), (u1 - u0) * k, (z1 - z0) * k); };
  // грунт
  g.fillStyle = '#eef0ea'; g.fillRect(0, Y(gy), c.width, c.height - Y(gy));
  g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(40, Y(gy)); g.lineTo(c.width - 40, Y(gy)); g.stroke();
  g.save(); g.beginPath(); g.rect(0, Y(gy), c.width, c.height); g.clip(); g.strokeStyle = 'rgba(0,0,0,.08)';
  for (let x = -c.height; x < c.width; x += 14) { g.beginPath(); g.moveTo(x, c.height); g.lineTo(x + c.height, 0); g.stroke(); }
  g.restore();
  // фундамент
  R(sp[0] - ext - 100, sp[0] + t + 100, bottom + 400, 0, '#a7adb4'); R(sp[1] - t - 100, sp[1] + ext + 100, bottom + 400, 0, '#a7adb4');
  R(sp[0], sp[1], -120, 0, CUT);
  for (const f of fl) {
    const e = DK.elev(p, f), ws = DK.walls(p, f), regs = DK.rooms(p, f);
    // мансарда: стены по высоте под скатом в линии разреза
    const hAt = (u) => f === af ? Math.min(hc, DK.atticH(p, alongX ? cut : u, alongX ? u : cut)) : hc;
    // стены в разрезе
    for (const w of ws) {
      const crosses = alongX ? (w.axis === 'x' && w.x0 < cut && w.x1 > cut) : (w.axis === 'y' && w.y0 < cut && w.y1 > cut);
      if (!crosses) continue;
      const u0 = alongX ? w.y0 : w.x0, u1 = alongX ? w.y1 : w.x1;
      const op = p.levels[f].open.find(o => o.wall === w.id && Math.abs(o.c - cut) < o.w / 2);
      const col = w.kind === 'part' ? '#b9c2ca' : CUT;
      const hw = w.kind === 'outer' && f === af ? DK.knee(p) : hAt((u0 + u1) / 2);
      if (op && !DK.slopeWin(p, f, op)) { const sz = DK.opSize(p, op); R(u0, u1, e, e + sz.sill, col); R(u0, u1, e + sz.sill + sz.h, e + hw, col);
        if (op.kind === 'win') { g.fillStyle = '#cfe0ea'; g.fillRect(X(u0) + (u1 - u0) * k * 0.4, Y(e + sz.sill + sz.h), (u1 - u0) * k * 0.2, sz.h * k); } }
      else R(u0, u1, e, e + hw, col);
      if (w.kind === 'outer') { const o2 = w.out < 0 ? [u0 - ext, u0] : [u1, u1 + ext]; R(o2[0], o2[1], e, e + (f === af ? DK.knee(p) : hc + sl), '#c9b9a5'); }
    }
    // перекрытие над этажом
    const holes = [];
    const sr = DK.stairRect(p); if (sr && fl.indexOf(f) < fl.length - 1 && (alongX ? sr.x0 < cut && sr.x1 > cut : sr.y0 < cut && sr.y1 > cut)) holes.push(alongX ? [sr.y0, sr.y1] : [sr.x0, sr.x1]);
    const up = fl[fl.indexOf(f) + 1];
    if (up) DK.rooms(p, up).filter(r => r.type === 'void').forEach(r => r.cells.forEach(q => { if (alongX ? q[0] < cut && q[2] > cut : q[1] < cut && q[3] > cut) holes.push(alongX ? [q[1], q[3]] : [q[0], q[2]]); }));
    let a = sp[0];
    if (f !== af) { holes.sort((m, n) => m[0] - n[0]).forEach(hh => { R(a, hh[0], e + hc, e + hc + sl, CUT); a = hh[1]; }); R(a, sp[1], e + hc, e + hc + sl, CUT); }
    // названия помещений
    g.fillStyle = INK; g.font = '600 15px Raleway, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    regs.filter(r => r.type !== 'none' && r.type !== 'void' && r.cells.some(q => alongX ? q[0] < cut && q[2] > cut : q[1] < cut && q[3] > cut)).forEach(r => {
      const cs = r.cells.filter(q => alongX ? q[0] < cut && q[2] > cut : q[1] < cut && q[3] > cut), u0 = Math.min(...cs.map(q => alongX ? q[1] : q[0])), u1 = Math.max(...cs.map(q => alongX ? q[3] : q[2]));
      if ((u1 - u0) * k > 60) g.fillText(DK.ROOM[r.type].n, X((u0 + u1) / 2), Y(e + hc / 2));
    });
    // лестница в разрезе — диагональ марша
    if (sr && fl.indexOf(f) < fl.length - 1 && (alongX ? sr.x0 < cut && sr.x1 > cut : sr.y0 < cut && sr.y1 > cut)) {
      g.strokeStyle = '#7b5a3e'; g.lineWidth = 3; const u0 = alongX ? sr.y0 : sr.x0, u1 = alongX ? sr.y1 : sr.x1;
      g.beginPath(); g.moveTo(X(u0), Y(e)); g.lineTo(X(u1), Y(e + H)); g.stroke();
    }
  }
  // кровля
  const u0 = sp[0] - ext - ov, u1 = sp[1] + ext + ov, uc = (sp[0] + sp[1]) / 2, yE = yt - ov * Math.tan(pitch);
  g.fillStyle = '#b5bcc3'; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath();
  if (p.roof.type === 'flat') { R(sp[0] - ext, sp[1] + ext, yt, yt + 600, '#b5bcc3'); }
  else if (ridgeAcross) { g.moveTo(X(u0), Y(yE)); g.lineTo(X(uc), Y(yR)); g.lineTo(X(u1), Y(yE)); g.lineTo(X(u1), Y(yE - 250)); g.lineTo(X(uc), Y(yR - 250)); g.lineTo(X(u0), Y(yE - 250)); g.closePath(); g.fill(); g.stroke(); }
  else { g.moveTo(X(u0), Y(yE)); g.lineTo(X(u0 + (yR - yE) / Math.tan(pitch)), Y(yR)); g.lineTo(X(u1 - (yR - yE) / Math.tan(pitch)), Y(yR)); g.lineTo(X(u1), Y(yE)); g.closePath(); g.fill(); g.stroke(); }
  // отметки
  const marks = [[0, '±0,000'], [gy, lvl(gy / 1000)], [yt, lvl(yt / 1000)], [yR, lvl(yR / 1000)]];
  fl.forEach(f => { const e = DK.elev(p, f); if (e) marks.push([e, lvl(e / 1000)]); marks.push([e + hc, lvl((e + hc) / 1000)]); });
  const seen = new Set();
  marks.sort((a2, b2) => a2[0] - b2[0]).forEach(([z, txt]) => { const key = Math.round(z / 50); if (seen.has(key)) return; seen.add(key); levelMark(g, c.width - 150, Y(z), txt, false); });
  g.fillStyle = INK; g.font = '700 26px Raleway, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('Разрез 1–1', 40, 24);
  return c;
}

/* сборка всех листов; plan — редактор плана (снимки этажей), view — 3D (снимки фасадов) */
DK.makeSketch = async function (p, plan, view, onStep) {
  const step = (t) => onStep && onStep(t);
  const fl = DK.floorsOf(p), A = DK.areas(p), nums = DK.roomNumbers(p), C = DK.CONFIG, cnt = counts(p);
  step('Снимки фасадов и 3D-видов…');
  let shots = [];
  if (view) shots = view.shots([{ type: 'persp', az: -0.62, el: 0.2 }, { type: 'elev', side: 'S' }, { type: 'elev', side: 'N' }, { type: 'elev', side: 'E' }, { type: 'elev', side: 'W' },
    { type: 'persp', az: 0.62, el: 0.24 }, { type: 'persp', az: 2.5, el: 0.24 }, { type: 'persp', az: -2.5, el: 0.24 }, { type: 'persp', az: -0.62, el: 0.75, r: 0.9 }], 1500, 940);
  const plans = fl.map(f => plan.toImage(f, { width: 1500, numbers: nums, noTitle: true }));
  const siteImg = p.site && DK._site ? DK._site.toImage(1500) : null;
  const total = 1 + fl.length + (siteImg ? 1 : 0) + 1 + (shots.length ? 4 + 2 : 0) + 1;
  const pages = []; let n = 1;
  // 1. титул
  step('Титульный лист…');
  {
    const { c, g } = sheet('Титульный лист', n++, total);
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = '800 54px "Alumni Sans", Raleway, sans-serif'; g.fillText((C.brand || '').toUpperCase(), SW / 2, 70);
    const mat = p.wallMat === 'brick' ? 'кирпича' : 'газобетонных блоков';
    const fls = { 1: 'одноэтажного', 2: 'двухэтажного', 3: 'трёхэтажного' }[p.floors] || '';
    g.font = '500 36px Raleway, sans-serif'; g.fillText(`Эскизный проект ${fls} жилого дома`, SW / 2, 150); g.fillText(`из ${mat}`, SW / 2, 196);
    if (shots[0]) { const img = await loadImg(shots[0].url); fitImg(g, pencil(img), 160, 260, SW - 320, 800); }
    g.font = '500 20px "JetBrains Mono", monospace'; g.textAlign = 'left'; g.fillText(`S общая — ${DK.fmtA(A.total + A.loggia * 0.5)} м²   S застройки — ${DK.fmtA(A.footprint)} м²   ${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м`, 110, SH - 150);
    g.fillText([C.owner && C.owner.phone, C.owner && C.owner.email].filter(Boolean).join('   '), 110, SH - 110);
    pages.push(c);
  }
  // 2. планы
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i];
    step(`План: ${DK.floorName(f)}…`);
    const { c, g } = sheet(`План ${DK.floorName(f).toLowerCase()}`, n++, total);
    const img = await loadImg(plans[i]); fitImg(g, img, 90, 40, 1180, SH - 90);
    const rows = DK.explicationRows(p, [f]).filter(r => !r.head);
    const h = drawTable(g, 1290, 60, 420, rows, `Экспликация · ${DK.floorName(f)}`, 1.05);
    let y = 60 + h + 40;
    g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'top';
    const pic = [['Спальни', cnt.bed], ['Санузлы', cnt.bath], ['Гардеробные', cnt.dress]];
    for (const [t, v] of pic) { g.font = '800 54px "Alumni Sans", Raleway, sans-serif'; g.fillStyle = '#6f8aa0'; g.fillText(String(v), 1300, y); g.font = '600 20px Raleway, sans-serif'; g.fillStyle = INK; g.fillText(t, 1360, y + 18); y += 70; }
    g.font = '500 19px "JetBrains Mono", monospace'; g.fillStyle = '#6f8aa0';
    g.fillText(`S этажа — ${DK.fmtA(A.per[i].area)} м²`, 1300, y + 10); g.fillText(`S общая — ${DK.fmtA(A.total)} м²`, 1300, y + 40);
    if (A.outdoor) g.fillText(`Террасы, балконы — ${DK.fmtA(A.outdoor)} м²`, 1300, y + 70);
    pages.push(c);
  }
  // схема участка: дом в отступах, постройки, проверки норм
  if (siteImg) {
    step('Схема участка…');
    const { c, g } = sheet('Схема участка', n++, total);
    const img = await loadImg(siteImg); fitImg(g, img, 90, 40, 1180, SH - 90);
    g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'top'; g.font = '700 22px Raleway, sans-serif'; g.fillText('Отступы по нормам', 1300, 60);
    let y = 100; g.font = '500 17px Raleway, sans-serif';
    for (const ch of DK.siteChecks(p)) {
      const words = (ch.lv === 'err' ? '✗ ' : '✓ ') + ch.txt; let lineTxt = '';
      for (const w of words.split(' ')) { if (g.measureText(lineTxt + w).width > 400) { g.fillStyle = ch.lv === 'err' ? '#b23a2e' : INK; g.fillText(lineTxt, 1300, y); y += 22; lineTxt = ''; } lineTxt += w + ' '; }
      g.fillStyle = ch.lv === 'err' ? '#b23a2e' : INK; g.fillText(lineTxt, 1300, y); y += 30;
    }
    pages.push(c);
  }
  // 3. разрез
  step('Разрез…');
  { const { c, g } = sheet('Разрез 1–1', n++, total); fitImg(g, section(p), 90, 40, SW - 140, SH - 140); pages.push(c); }
  // 4. фасады с отметками
  const names = { S: 'Фасад со стороны юга', N: 'Фасад со стороны севера', E: 'Фасад со стороны востока', W: 'Фасад со стороны запада' };
  for (let i = 1; i <= 4 && shots[i]; i++) {
    const side = ['S', 'N', 'E', 'W'][i - 1], s = shots[i];
    step(names[side] + '…');
    const { c, g } = sheet(names[side], n++, total);
    const img = await loadImg(s.url), box = fitImg(g, img, 90, 60, SW - 330, SH - 170);
    const Yp = (m) => box.y + s.yPx(m) * box.k, xm = box.x + img.width * box.k + 30;
    const fl2 = DK.floorsOf(p), marks = [[0, '±0,000'], [s.levels.gy, lvl(s.levels.gy)], [s.levels.yt, lvl(s.levels.yt)], [s.levels.ridge, lvl(s.levels.ridge)]];
    fl2.forEach(f => { const e = DK.elev(p, f) / 1000; if (e) marks.push([e, lvl(e)]); });
    const seen = new Set();
    marks.sort((a, b) => a[0] - b[0]).forEach(([m, t]) => { const key = Math.round(m * 20); if (seen.has(key)) return; seen.add(key); levelMark(g, xm, Yp(m), t, false); });
    g.fillStyle = INK; g.font = '700 26px Raleway, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(names[side], 110, 50);
    pages.push(c);
  }
  // 5. 3D-виды по два на листе
  const persp = [shots[5], shots[6], shots[7], shots[8]].filter(Boolean);
  for (let i = 0; i < persp.length; i += 2) {
    step('3D-виды…');
    const { c, g } = sheet('Виды', n++, total);
    for (let j = 0; j < 2 && persp[i + j]; j++) { const img = await loadImg(persp[i + j].url); fitImg(g, img, 100 + j * 820, 120, 790, 900); }
    pages.push(c);
  }
  // 6. характеристики и ТЗ
  step('Техзадание…');
  {
    const { c, g } = sheet('Характеристики и техзадание', n++, total);
    g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = '700 30px Raleway, sans-serif'; g.fillText('Характеристики дома', 110, 60);
    let y = 115;
    const wrap = (txt, x, maxW, lh) => { const words = txt.split(' '); let line = ''; for (const w of words) { const t2 = line ? line + ' ' + w : w; if (g.measureText(t2).width > maxW) { g.fillText(line, x, y); y += lh; line = w; } else line = t2; } if (line) { g.fillText(line, x, y); y += lh; } };
    g.font = '500 19px Raleway, sans-serif';
    for (const t of DK.brief(p).filter(s2 => !s2.startsWith('ТЗ:'))) { wrap('— ' + t, 110, 1500, 27); y += 4; }
    y += 18; g.font = '700 30px Raleway, sans-serif'; g.fillText('В техзадание на расчёт', 110, y); y += 52;
    g.font = '500 19px Raleway, sans-serif';
    for (const t of DK.tzItems(p)) { wrap('— ' + t, 110, 1500, 27); y += 4; if (y > SH - 160) break; }
    g.font = 'italic 500 15px Raleway, sans-serif'; g.fillStyle = MUTED;
    g.fillText('Эскизный проект не является рабочей документацией. Конструктивные решения подтверждаются расчётом.', 110, SH - 120);
    pages.push(c);
  }
  return pages;
};

let pdfLib = null;
DK.sketchPdf = async function (pages, name) {
  if (!window.jspdf) {
    // своя копия на сервере, без сервера — CDN
    const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    pdfLib = pdfLib || (location.protocol === 'file:' ? Promise.reject(new Error('file')) : load('vendor/jspdf.umd.min.js')).catch(() => load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'));
    await pdfLib;
  }
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  pages.forEach((c, i) => { if (i) doc.addPage('a3', 'landscape'); doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 420, 297); });
  doc.save(name || 'eskiznyj-proekt.pdf');
};
})();
