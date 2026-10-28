/* Экспликация на снимках и листы эскизного проекта (А3, альбомная): титул, планы, разрез, фасады, 3D-виды, ТЗ */
(function () {
'use strict';
const DK = window.DK;
const SW = 1754, SH = 1240; // А3 при ~106 dpi
const MM = SW / 420; // пикселей в миллиметре листа
// палитра и шрифты «Логики Дома» (logika-doma/DESIGN_SYSTEM.md, §12)
const INK = '#242832', MUTED = '#5B6272', CUT = '#A3A9B7', LINE = '#E4E8EF', BORDER = '#D9DEE8', NAVY = '#19317B', CYAN = '#26C6C8', BLUE = '#2784EB', CORAL = '#F05C78', GREEN = '#2FB35A';
const FD = (w, sz) => `${w} ${sz}px Manrope, system-ui, sans-serif`, FB = (w, sz, it) => `${it ? 'italic ' : ''}${w} ${sz}px Inter, system-ui, sans-serif`;
const FRAME = { l: 20 * MM, t: 5 * MM, r: 5 * MM, b: 5 * MM }; // рамка: слева 20 мм под подшивку, остальные 5 мм
const COLR = 95 * MM; // правая колонка листа плана
const BRAND = { logo: "brand/logo-horizontal.svg", mark: "brand/mark.png" };
const imgCache = {};
const asset = (u) => imgCache[u] || (imgCache[u] = loadImg(u).catch(() => null));
/* иконка Lucide для холста: SVG → картинка */
const iconImg = (name, color, size) => { const k = name + color + size; if (!imgCache[k]) { const b = (DK.ICONS && DK.ICONS[name]) || '';
  imgCache[k] = loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`)).catch(() => null); } return imgCache[k]; };
const fontsReady = () => document.fonts ? Promise.all(['700 20px Manrope', '600 20px Manrope', '400 20px Inter', '500 20px Inter', '600 20px Inter'].map(f => document.fonts.load(f).catch(() => null))) : Promise.resolve();
const rr = (g, x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
const ym = () => { const d = new Date(); return String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); };

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
  const ex = DK.explication(p), rows = [];
  ex.groups.filter(g => fids.includes(g.fid)).forEach(g => { rows.push({ head: g.title }); g.rooms.forEach(r => rows.push(r)); });
  return rows;
};
/* панель «Экспликация помещений»: белая, граница Technical Gray, номера-узлы, итог Navy; возвращает высоту */
async function drawTable(c, x, y, w, rows, title, scale, opt) {
  opt = opt || {};
  const s = scale || 1, rh = 24 * s, pad = 16 * s, items = rows.filter(r => !r.total);
  const tot = rows.find(r => r.total), h = pad * 1.6 + 26 * s + items.reduce((a, r) => a + (r.head ? 26 * s : rh), 0) + (tot ? 34 * s : 0);
  c.save();
  c.fillStyle = '#fff'; c.strokeStyle = BORDER; c.lineWidth = 1 * s;
  rr(c, x, y, w, h, opt.sheet ? 0 : 8 * s); c.fill(); c.stroke();
  c.fillStyle = NAVY; c.font = FD(700, 15 * s); c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText(title || 'Экспликация помещений', x + pad, y + pad + 6 * s);
  let yy = y + pad + 22 * s;
  for (const r of items) {
    if (r.head) { c.font = FB(600, 11 * s); c.fillStyle = '#7A8193'; c.fillText(r.head.toUpperCase(), x + pad, yy + 15 * s); yy += 26 * s; continue; }
    const cyy = yy + rh / 2;
    c.fillStyle = r.wet ? '#E9F2FD' : '#EEF1F9'; c.beginPath(); c.arc(x + pad + 10 * s, cyy, 10 * s, 0, 7); c.fill();
    c.fillStyle = NAVY; c.font = FD(600, 11 * s); c.textAlign = 'center'; c.fillText(String(r.n), x + pad + 10 * s, cyy + 0.5); c.textAlign = 'left';
    let tx = x + pad + 28 * s;
    if (opt.icons && r.icon) { const ic = await iconImg(r.icon, '#7A8193', Math.round(32 * s)); if (ic) c.drawImage(ic, tx, cyy - 7 * s, 14 * s, 14 * s); tx += 20 * s; }
    c.fillStyle = INK; c.font = FB(400, 13 * s); c.fillText(r.name, tx, cyy);
    c.font = FB(500, 13 * s); c.textAlign = 'right'; c.fillText(DK.fmtA(r.area), x + w - pad, cyy); c.textAlign = 'left';
    c.strokeStyle = LINE; c.lineWidth = 1 * s; c.beginPath(); c.moveTo(x + pad, yy + rh); c.lineTo(x + w - pad, yy + rh); c.stroke();
    yy += rh;
  }
  if (tot) { c.fillStyle = NAVY; c.font = FD(600, 13 * s); c.fillText('Всего помещений', x + pad, yy + 18 * s); c.textAlign = 'right'; c.fillText(DK.fmtA(tot.area) + ' м²', x + w - pad, yy + 18 * s); }
  c.restore();
  return h;
}
/* «Преимущества планировки»: иконка в плашке Navy-50, заголовок Manrope, пояснение Inter; возвращает высоту */
async function drawPerks(c, x, y, w, perks, scale, title) {
  const s = scale || 1, pad = 16 * s, rowH = 46 * s;
  if (!perks.length) return 0;
  const h = pad * 2 + 26 * s + perks.length * rowH;
  c.save(); c.fillStyle = '#fff'; c.strokeStyle = BORDER; c.lineWidth = 1 * s; rr(c, x, y, w, h, 8 * s); c.fill(); c.stroke();
  c.fillStyle = NAVY; c.font = FD(700, 15 * s); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(title || 'Преимущества планировки', x + pad, y + pad + 6 * s);
  let yy = y + pad + 28 * s;
  for (const k of perks) {
    c.fillStyle = '#EEF1F9'; rr(c, x + pad, yy, 32 * s, 32 * s, 8 * s); c.fill();
    const ic = await iconImg(k.icon, NAVY, Math.round(40 * s)); if (ic) c.drawImage(ic, x + pad + 6 * s, yy + 6 * s, 20 * s, 20 * s);
    c.fillStyle = NAVY; c.font = FD(600, 13 * s); c.fillText(k.title, x + pad + 42 * s, yy + 9 * s, w - pad * 2 - 42 * s);
    c.fillStyle = MUTED; c.font = FB(400, 11 * s); c.fillText(k.text, x + pad + 42 * s, yy + 25 * s, w - pad * 2 - 42 * s);
    yy += rowH;
  }
  c.restore(); return h;
}
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }

/* снимок с сайта по правилам: план или 3D, справа колонка с экспликацией и преимуществами, слева снизу — плашка с логотипом */
DK.shotWithExplication = async function (url, p, fids, side) {
  await fontsReady();
  const img = await loadImg(url), c = document.createElement('canvas');
  const s = Math.max(1, img.width / 1400), colW = 340 * s, extra = side ? colW + 48 * s : 0;
  const ex = DK.explication(p), groups = ex.groups.filter(g => fids.includes(g.fid)), rows = [];
  groups.forEach(g => { if (groups.length > 1 || fids.length > 1) rows.push({ head: g.title }); g.rooms.forEach(r => rows.push(r)); });
  rows.push({ total: true, area: groups.reduce((a, g) => a + g.total, 0) });
  const perks = side ? DK.planPerks(p).slice(0, 5) : [];
  c.width = img.width + extra; c.height = Math.max(img.height, side ? 60 * s + rows.length * 25 * s + perks.length * 46 * s + 160 * s : 0);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  const x = side ? img.width + 24 * s : c.width - colW - c.width * 0.025;
  const h1 = await drawTable(g, x, 24 * s, colW, rows, 'Экспликация помещений', s, { icons: true });
  if (side && perks.length) await drawPerks(g, x, 24 * s + h1 + 16 * s, colW, perks, s);
  // плашка: логотип · площадь · этажность
  const logo = await asset(BRAND.logo), A = DK.areas(p), nf = DK.floorsOf(p).filter(f => f !== 'b').length;
  const txt = `${DK.fmtA(A.total)} м² · ${nf} ${nf === 1 ? 'этаж' : nf < 5 ? 'этажа' : 'этажей'}`;
  g.font = FD(600, 15 * s); const lh = 30 * s, lw = logo ? logo.width / logo.height * lh : 0, pw = lw + g.measureText(txt).width + 44 * s, ph = lh + 20 * s, py = c.height - ph - 20 * s;
  g.fillStyle = 'rgba(255,255,255,.92)'; rr(g, 20 * s, py, pw, ph, 8 * s); g.fill();
  if (logo) g.drawImage(logo, 30 * s, py + 10 * s, lw, lh);
  g.fillStyle = NAVY; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(txt, 30 * s + lw + 14 * s, py + ph / 2);
  return c.toDataURL('image/png');
};

/* ---------- листы ---------- */
/* лист А3: рамка 1,5 px Graphite (слева 20 мм, остальные 5), заголовок листа слева сверху, штамп 185 × 27 мм справа снизу */
function sheet(title, num, total, opt) {
  opt = opt || {};
  const c = document.createElement('canvas'); c.width = SW; c.height = SH;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, SW, SH);
  g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(FRAME.l, FRAME.t, SW - FRAME.l - FRAME.r, SH - FRAME.t - FRAME.b);
  // штамп: знак | «Логика Дома · Эскизный проект» / название листа и дата | «Лист N / всего»
  const bw = 185 * MM, bh = 27 * MM, bx = SW - FRAME.r - bw, by = SH - FRAME.b - bh, c1 = 64 / 440 * bw, c3 = 92 / 440 * bw;
  g.fillStyle = '#fff'; g.fillRect(bx, by, bw, bh); g.lineWidth = 2; g.strokeRect(bx, by, bw, bh);
  g.beginPath(); g.moveTo(bx + c1, by); g.lineTo(bx + c1, by + bh); g.moveTo(bx + bw - c3, by); g.lineTo(bx + bw - c3, by + bh); g.moveTo(bx + c1, by + bh / 2); g.lineTo(bx + bw - c3, by + bh / 2); g.stroke();
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillStyle = NAVY; g.font = FD(700, 21); g.fillText('Логика Дома · Эскизный проект', bx + c1 + 14, by + bh / 4, bw - c1 - c3 - 28);
  g.fillStyle = INK; g.font = FB(500, 19); g.fillText(title, bx + c1 + 14, by + bh * 3 / 4, bw - c1 - c3 - 110);
  g.fillStyle = '#7A8193'; g.font = FB(400, 15); g.textAlign = 'right'; g.fillText(ym(), bx + bw - c3 - 14, by + bh * 3 / 4); g.textAlign = 'center';
  g.fillText('Лист', bx + bw - c3 / 2, by + bh * 0.3); g.fillStyle = INK; g.font = FD(600, 28); g.fillText(num + ' / ' + total, bx + bw - c3 / 2, by + bh * 0.66);
  const markP = asset(BRAND.mark).then(m => { if (m) { const h = 70, w = m.width / m.height * h; g.drawImage(m, bx + (c1 - w) / 2, by + (bh - h) / 2, w, h); } });
  if (!opt.noTitle) { g.fillStyle = NAVY; g.font = FD(700, 22); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(title, FRAME.l + 34, FRAME.t + 30); }
  return { c, g, ready: markP };
}
function fitImg(g, img, x, y, w, h) { const k = Math.min(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k; g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, k }; }
function levelMark(g, x, y, text, left) {
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.2;
  g.font = FB(500, 15);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x - 9, y - 12); g.lineTo(x + 9, y - 12); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x - (left ? 90 : 12), y); g.lineTo(x + (left ? 12 : 90), y); g.stroke();
  g.textAlign = left ? 'right' : 'left'; g.textBaseline = 'bottom';
  g.fillText(text, x + (left ? -14 : 14), y - 4);
}
const lvl = (m) => (m >= 0 ? '+' : '−') + Math.abs(m).toFixed(3).replace('.', ',');
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
  g.fillStyle = '#F5F6F8'; g.fillRect(0, Y(gy), c.width, c.height - Y(gy));
  g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(40, Y(gy)); g.lineTo(c.width - 40, Y(gy)); g.stroke();
  g.save(); g.beginPath(); g.rect(0, Y(gy), c.width, c.height); g.clip(); g.strokeStyle = 'rgba(0,0,0,.08)';
  for (let x = -c.height; x < c.width; x += 14) { g.beginPath(); g.moveTo(x, c.height); g.lineTo(x + c.height, 0); g.stroke(); }
  g.restore();
  // фундамент
  R(sp[0] - ext - 100, sp[0] + t + 100, bottom + 400, 0, '#A3A9B7'); R(sp[1] - t - 100, sp[1] + ext + 100, bottom + 400, 0, '#A3A9B7');
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
      const col = w.kind === 'part' ? '#E2A593' : CUT;
      const hw = w.kind === 'outer' && f === af ? DK.knee(p) : hAt((u0 + u1) / 2);
      if (op && !DK.slopeWin(p, f, op)) { const sz = DK.opSize(p, op); R(u0, u1, e, e + sz.sill, col); R(u0, u1, e + sz.sill + sz.h, e + hw, col);
        if (op.kind === 'win') { g.fillStyle = '#9CC3F0'; g.fillRect(X(u0) + (u1 - u0) * k * 0.4, Y(e + sz.sill + sz.h), (u1 - u0) * k * 0.2, sz.h * k); } }
      else R(u0, u1, e, e + hw, col);
      if (w.kind === 'outer') { const o2 = w.out < 0 ? [u0 - ext, u0] : [u1, u1 + ext]; R(o2[0], o2[1], e, e + (f === af ? DK.knee(p) : hc + sl), '#F3E4A6'); }
    }
    // перекрытие над этажом
    const holes = [];
    const sr = DK.stairRect(p); if (sr && fl.indexOf(f) < fl.length - 1 && (alongX ? sr.x0 < cut && sr.x1 > cut : sr.y0 < cut && sr.y1 > cut)) holes.push(alongX ? [sr.y0, sr.y1] : [sr.x0, sr.x1]);
    const up = fl[fl.indexOf(f) + 1];
    if (up) DK.rooms(p, up).filter(r => r.type === 'void').forEach(r => r.cells.forEach(q => { if (alongX ? q[0] < cut && q[2] > cut : q[1] < cut && q[3] > cut) holes.push(alongX ? [q[1], q[3]] : [q[0], q[2]]); }));
    let a = sp[0];
    if (f !== af) { holes.sort((m, n) => m[0] - n[0]).forEach(hh => { R(a, hh[0], e + hc, e + hc + sl, CUT); a = hh[1]; }); R(a, sp[1], e + hc, e + hc + sl, CUT); }
    // названия помещений
    g.fillStyle = INK; g.font = FB(500, 15); g.textAlign = 'center'; g.textBaseline = 'middle';
    regs.filter(r => r.type !== 'none' && r.type !== 'void' && r.cells.some(q => alongX ? q[0] < cut && q[2] > cut : q[1] < cut && q[3] > cut)).forEach(r => {
      const cs = r.cells.filter(q => alongX ? q[0] < cut && q[2] > cut : q[1] < cut && q[3] > cut), u0 = Math.min(...cs.map(q => alongX ? q[1] : q[0])), u1 = Math.max(...cs.map(q => alongX ? q[3] : q[2]));
      if ((u1 - u0) * k > 60) g.fillText(DK.ROOM[r.type].n, X((u0 + u1) / 2), Y(e + hc / 2));
    });
    // лестница в разрезе — диагональ марша
    if (sr && fl.indexOf(f) < fl.length - 1 && (alongX ? sr.x0 < cut && sr.x1 > cut : sr.y0 < cut && sr.y1 > cut)) {
      g.strokeStyle = '#19317B'; g.lineWidth = 3; const u0 = alongX ? sr.y0 : sr.x0, u1 = alongX ? sr.y1 : sr.x1;
      g.beginPath(); g.moveTo(X(u0), Y(e)); g.lineTo(X(u1), Y(e + H)); g.stroke();
    }
  }
  // кровля
  const u0 = sp[0] - ext - ov, u1 = sp[1] + ext + ov, uc = (sp[0] + sp[1]) / 2, yE = yt - ov * Math.tan(pitch);
  g.fillStyle = '#C7CDDA'; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath();
  if (p.roof.type === 'flat') { R(sp[0] - ext, sp[1] + ext, yt, yt + 600, '#C7CDDA'); }
  else if (ridgeAcross) { g.moveTo(X(u0), Y(yE)); g.lineTo(X(uc), Y(yR)); g.lineTo(X(u1), Y(yE)); g.lineTo(X(u1), Y(yE - 250)); g.lineTo(X(uc), Y(yR - 250)); g.lineTo(X(u0), Y(yE - 250)); g.closePath(); g.fill(); g.stroke(); }
  else { g.moveTo(X(u0), Y(yE)); g.lineTo(X(u0 + (yR - yE) / Math.tan(pitch)), Y(yR)); g.lineTo(X(u1 - (yR - yE) / Math.tan(pitch)), Y(yR)); g.lineTo(X(u1), Y(yE)); g.closePath(); g.fill(); g.stroke(); }
  // отметки
  const marks = [[0, '±0,000'], [gy, lvl(gy / 1000)], [yt, lvl(yt / 1000)], [yR, lvl(yR / 1000)]];
  fl.forEach(f => { const e = DK.elev(p, f); if (e) marks.push([e, lvl(e / 1000)]); marks.push([e + hc, lvl((e + hc) / 1000)]); });
  const seen = new Set();
  marks.sort((a2, b2) => a2[0] - b2[0]).forEach(([z, txt]) => { const key = Math.round(z / 50); if (seen.has(key)) return; seen.add(key); levelMark(g, c.width - 150, Y(z), txt, false); });
    return c;
}

/* сборка всех листов; plan — редактор плана (снимки этажей), view — 3D (снимки фасадов) */
DK.makeSketch = async function (p, plan, view, onStep) {
  const step = (t) => onStep && onStep(t);
  await fontsReady();
  const fl = DK.floorsOf(p), A = DK.areas(p), nums = DK.roomNumbers(p), C = DK.CONFIG, ex = DK.explication(p);
  step('Снимки фасадов и 3D-видов…');
  let shots = [];
  if (view) shots = view.shots([{ type: 'persp', az: -0.62, el: 0.2 }, { type: 'elev', side: 'S' }, { type: 'elev', side: 'N' }, { type: 'elev', side: 'E' }, { type: 'elev', side: 'W' },
    { type: 'persp', az: 0.62, el: 0.24 }, { type: 'persp', az: 2.5, el: 0.24 }, { type: 'persp', az: -2.5, el: 0.24 }, { type: 'persp', az: -0.62, el: 0.75, r: 0.9 }], 1500, 940);
  const plans = fl.map(f => plan.toImage(f, { width: 1500, numbers: nums, noTitle: true }));
  const siteImg = p.site && DK._site ? DK._site.toImage(1500) : null;
  const total = 1 + fl.length + (siteImg ? 1 : 0) + 1 + (shots.length ? 4 + 2 : 0) + 1;
  const pages = []; let n = 1;
  const push = async (s) => { await s.ready; pages.push(s.c); };
  // поле листа: под заголовком и над штампом; правая колонка — 95 мм
  const X0 = FRAME.l + 34, Y0 = FRAME.t + 80, XR = SW - FRAME.r - 24, YB = SH - FRAME.b - 27 * MM - 24;
  const colX = XR - COLR + 10, colW = COLR - 10;
  const nf = fl.filter(f => f !== 'b').length;
  // 1. титул: логотип слева сверху, цветной 3D-вид, три ключевые цифры
  step('Титульный лист…');
  {
    const s = sheet('Титульный лист', n++, total, { noTitle: true }), g = s.g;
    const logo = await asset(BRAND.logo);
    if (logo) { const h = 75; g.drawImage(logo, X0, FRAME.t + 34, logo.width / logo.height * h, h); }
    const mat = p.wallMat === 'brick' ? 'кирпича' : 'газобетонных блоков';
    const fls = { 1: 'одноэтажного', 2: 'двухэтажного', 3: 'трёхэтажного' }[p.floors] || '';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = NAVY; g.font = FD(700, 40); g.fillText(`Эскизный проект ${fls} жилого дома`, X0, FRAME.t + 150);
    g.fillStyle = MUTED; g.font = FB(400, 22); g.fillText(`из ${mat} · ${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м`, X0, FRAME.t + 204);
    g.fillStyle = CYAN; g.fillRect(X0, FRAME.t + 244, 64, 3);
    const iy = FRAME.t + 272, ih = YB - 150 - iy;
    if (shots[0]) {
      const img = await loadImg(shots[0].url), k = Math.min((XR - X0) / img.width, ih / img.height), w = img.width * k, h = img.height * k, x = X0 + (XR - X0 - w) / 2;
      g.save(); rr(g, x, iy, w, h, 17); g.clip(); g.drawImage(img, x, iy, w, h); g.restore();
      g.strokeStyle = BORDER; g.lineWidth = 1; rr(g, x, iy, w, h, 17); g.stroke();
    }
    const keys = [[DK.fmtA(A.total + A.loggia * 0.5) + ' м²', 'общая площадь'], [DK.fmtA(A.footprint) + ' м²', 'площадь застройки'], [String(nf), nf === 1 ? 'этаж' : nf < 5 ? 'этажа' : 'этажей']];
    keys.forEach(([v, t], i) => { const x = X0 + i * 300, y = YB - 110;
      g.fillStyle = NAVY; g.font = FD(700, 44); g.fillText(v, x, y);
      g.fillStyle = MUTED; g.font = FB(400, 18); g.fillText(t, x, y + 58); });
    const cont = [C.owner && C.owner.phone, C.owner && C.owner.email].filter(Boolean).join(' · ');
    if (cont) { g.fillStyle = MUTED; g.font = FB(400, 16); g.fillText(cont, X0, SH - FRAME.b - 40); }
    await push(s);
  }
  // 2. планы: слева чертёж, справа экспликация, ключевые цифры, площади, преимущества, условные обозначения
  const perksAll = DK.planPerks(p), summary = DK.planSummary(p);
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i];
    step(`План: ${DK.floorName(f)}…`);
    const s = sheet(`План ${DK.floorName(f).toLowerCase()}`, n++, total), g = s.g;
    const img = await loadImg(plans[i]); fitImg(g, img, X0, Y0, colX - 30 - X0, YB - Y0);
    const grp = ex.groups.find(q => q.fid === f), rows = grp ? grp.rooms.slice() : [];
    rows.push({ total: true, area: grp ? grp.total : 0 });
    let y = Y0 - 40;
    y += await drawTable(g, colX, y, colW, rows, 'Экспликация помещений', 1.05, { icons: true, sheet: true }) + 22;
    // ключевые цифры дома
    if (summary.length) {
      const cw = colW / summary.length; g.textAlign = 'left'; g.textBaseline = 'top';
      summary.forEach((it, j) => { g.fillStyle = NAVY; g.font = FD(700, 40); g.fillText(String(it.n), colX + j * cw, y);
        g.fillStyle = MUTED; g.font = FB(400, 15); g.fillText(it.t, colX + j * cw, y + 50, cw - 8); });
      y += 84;
    }
    g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath(); g.moveTo(colX, y); g.lineTo(colX + colW, y); g.stroke(); y += 12;
    const ar = [[`Площадь этажа`, A.per[i].area], ['Общая площадь', A.total]]; if (A.outdoor) ar.push(['Террасы, балконы', A.outdoor]);
    g.textBaseline = 'middle';
    for (const [t, v] of ar) { g.fillStyle = INK; g.font = FB(400, 15); g.textAlign = 'left'; g.fillText(t, colX, y + 12);
      g.fillStyle = NAVY; g.font = FD(600, 16); g.textAlign = 'right'; g.fillText(DK.fmtA(v) + ' м²', colX + colW, y + 12); y += 26; }
    y += 16;
    // условные обозначения — внизу колонки, преимущества — сколько поместится между
    const legH = 74, room = YB - legH - 16 - y, fit = Math.max(0, Math.min(perksAll.length, Math.floor((room - 60) / 46)));
    if (fit) y += await drawPerks(g, colX, y, colW, perksAll.slice(0, fit), 1, 'Преимущества планировки') + 16;
    const leg = [['#D9DEE8', '#A3A9B7', 'Наружная стена'], ['#C9735E', '#A65440', 'Несущая'], ['#E2A593', null, 'Перегородка'], ['#E9F2FD', '#9CC3F0', 'Мокрая зона']];
    let ly = YB - legH; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = FB(400, 13);
    leg.forEach(([fc, sc, t], j) => { const lx = colX + (j % 2) * (colW / 2), yy = ly + Math.floor(j / 2) * 30;
      g.fillStyle = fc; g.fillRect(lx, yy, 26, 14); if (sc) { g.strokeStyle = sc; g.lineWidth = 1; g.strokeRect(lx + 0.5, yy + 0.5, 25, 13); }
      g.fillStyle = INK; g.fillText(t, lx + 34, yy + 7); });
    await push(s);
  }
  // схема участка: дом в отступах, постройки, проверки норм — сначала нарушения
  if (siteImg) {
    step('Схема участка…');
    const s = sheet('Схема участка', n++, total), g = s.g;
    const img = await loadImg(siteImg); fitImg(g, img, X0, Y0, colX - 30 - X0, YB - Y0);
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = NAVY; g.font = FD(700, 20); g.fillText('Отступы по нормам', colX, Y0 - 30);
    let y = Y0 + 10; g.font = FB(400, 15);
    const checks = DK.siteChecks(p).slice().sort((a2, b2) => (b2.lv === 'err') - (a2.lv === 'err'));
    for (const ch of checks) {
      const bad = ch.lv === 'err';
      g.fillStyle = bad ? CORAL : GREEN; g.font = FB(600, 16); g.fillText(bad ? '✕' : '✓', colX, y);
      g.fillStyle = INK; g.font = FB(400, 15);
      let line = '';
      for (const w of ch.txt.split(' ')) { const t2 = line ? line + ' ' + w : w; if (g.measureText(t2).width > colW - 26) { g.fillText(line, colX + 26, y); y += 21; line = w; } else line = t2; }
      g.fillText(line, colX + 26, y); y += 30;
      if (y > YB - 30) break;
    }
    await push(s);
  }
  // 3. разрез
  step('Разрез…');
  { const s = sheet('Разрез 1–1', n++, total); fitImg(s.g, section(p), X0, Y0, XR - X0, YB - Y0); await push(s); }
  // 4. фасады с отметками
  const names = { S: 'Фасад со стороны юга', N: 'Фасад со стороны севера', E: 'Фасад со стороны востока', W: 'Фасад со стороны запада' };
  for (let i = 1; i <= 4 && shots[i]; i++) {
    const side = ['S', 'N', 'E', 'W'][i - 1], sh = shots[i];
    step(names[side] + '…');
    const s = sheet(names[side], n++, total), g = s.g;
    const img = await loadImg(sh.url), box = fitImg(g, img, X0, Y0, XR - X0 - 220, YB - Y0);
    const Yp = (m) => box.y + sh.yPx(m) * box.k, xm = box.x + img.width * box.k + 30;
    const marks = [[0, '±0,000'], [sh.levels.gy, lvl(sh.levels.gy)], [sh.levels.yt, lvl(sh.levels.yt)], [sh.levels.ridge, lvl(sh.levels.ridge)]];
    fl.forEach(f => { const e = DK.elev(p, f) / 1000; if (e) marks.push([e, lvl(e)]); });
    const seen = new Set();
    marks.sort((a, b) => a[0] - b[0]).forEach(([m, t]) => { const key = Math.round(m * 20); if (seen.has(key)) return; seen.add(key); levelMark(g, xm, Yp(m), t, false); });
    await push(s);
  }
  // 5. 3D-виды по два на листе, цветные, со скруглением
  const persp = [shots[5], shots[6], shots[7], shots[8]].filter(Boolean);
  for (let i = 0; i < persp.length; i += 2) {
    step('3D-виды…');
    const s = sheet('Виды', n++, total), g = s.g, w = (XR - X0 - 30) / 2;
    for (let j = 0; j < 2 && persp[i + j]; j++) {
      const img = await loadImg(persp[i + j].url), k = Math.min(w / img.width, (YB - Y0) / img.height), iw = img.width * k, ih = img.height * k, x = X0 + j * (w + 30) + (w - iw) / 2, y = Y0 + (YB - Y0 - ih) / 2;
      g.save(); rr(g, x, y, iw, ih, 12); g.clip(); g.drawImage(img, x, y, iw, ih); g.restore();
    }
    await push(s);
  }
  // 6. характеристики и ТЗ
  step('Техзадание…');
  {
    const s = sheet('Характеристики и техзадание', n++, total), g = s.g;
    g.textAlign = 'left'; g.textBaseline = 'top';
    let y = Y0;
    const wrap = (txt, x, maxW, lh) => { const words = txt.split(' '); let line = ''; for (const w of words) { const t2 = line ? line + ' ' + w : w; if (g.measureText(t2).width > maxW) { g.fillText(line, x, y); y += lh; line = w; } else line = t2; } if (line) { g.fillText(line, x, y); y += lh; } };
    const h2 = (t) => { g.fillStyle = NAVY; g.font = FD(700, 26); g.fillText(t, X0, y); y += 36; g.fillStyle = CYAN; g.fillRect(X0, y, 48, 3); y += 18; g.fillStyle = INK; g.font = FB(400, 18); };
    h2('Характеристики дома');
    for (const t of DK.brief(p).filter(s2 => !s2.startsWith('ТЗ:'))) { wrap('— ' + t, X0, XR - X0, 26); y += 4; }
    y += 20; h2('В техзадание на расчёт');
    for (const t of DK.tzItems(p)) { wrap('— ' + t, X0, XR - X0, 26); y += 4; if (y > YB - 60) break; }
    g.font = FB(400, 14, true); g.fillStyle = MUTED;
    g.fillText('Эскизный проект не является рабочей документацией. Конструктивные решения подтверждаются расчётом.', X0, YB - 10);
    await push(s);
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
