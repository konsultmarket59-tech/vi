/* Экспорт эскиза для архитектора.
   IFC 2x3 — открытый BIM-формат: ArchiCAD открывает его как модель (стены, перекрытия, окна, двери, помещения с площадями)
   и сохраняет в свой .pln; так же читают Revit, Renga, nanoCAD BIM. Формат .pln закрытый — напрямую его пишет только ArchiCAD.
   DXF R12 — планы этажей по слоям для AutoCAD, nanoCAD и импорта в ArchiCAD как подложка. */
(function () {
'use strict';
const DK = window.DK;

DK.download = function (data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

/* ---------- IFC ---------- */
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
const guid = () => { let s = B64[Math.floor(Math.random() * 4)]; for (let i = 0; i < 21; i++) s += B64[Math.floor(Math.random() * 64)]; return s; };
// строки IFC: латиница как есть, остальное — \X2\hhhh\X0\ (ISO 10303-21)
const istr = (v) => {
  if (v == null) return '$';
  let out = '', run = '';
  for (const ch of String(v)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127 && ch !== "'" && ch !== '\\') { if (run) { out += '\\X2\\' + run + '\\X0\\'; run = ''; } out += ch; }
    else if (ch === "'") { if (run) { out += '\\X2\\' + run + '\\X0\\'; run = ''; } out += "''"; }
    else run += c.toString(16).toUpperCase().padStart(4, '0');
  }
  if (run) out += '\\X2\\' + run + '\\X0\\';
  return "'" + out + "'";
};
const num = (v) => { const s = (Math.round(v * 1000) / 1000).toString(); return s.includes('.') || s.includes('e') ? s : s + '.'; };

DK.exportIFC = function (p, opts) {
  opts = opts || {};
  const L = [], ref = (s) => { L.push(s); return '#' + L.length; }, E = (t, ...a) => ref(`${t}(${a.join(',')})`);
  const pt = (x, y, z) => E('IFCCARTESIANPOINT', `(${num(x)},${num(y)}${z != null ? ',' + num(z) : ''})`);
  const P0 = pt(0, 0, 0), DZ = E('IFCDIRECTION', '(0.,0.,1.)'), DX = E('IFCDIRECTION', '(1.,0.,0.)');
  const AX0 = E('IFCAXIS2PLACEMENT3D', P0, DZ, DX);
  const now = Math.floor(Date.now() / 1000);
  const person = E('IFCPERSON', '$', '$', istr(DK.CONFIG.brand), '$', '$', '$', '$', '$');
  const org = E('IFCORGANIZATION', '$', istr(DK.CONFIG.brand), '$', '$', '$');
  const po = E('IFCPERSONANDORGANIZATION', person, org, '$');
  const app = E('IFCAPPLICATION', org, "'1.0'", istr('Конструктор дома ' + DK.CONFIG.brand), "'SvoyDom'");
  const OH = E('IFCOWNERHISTORY', po, app, '$', '.ADDED.', '$', po, app, String(now));
  const CTX = E('IFCGEOMETRICREPRESENTATIONCONTEXT', '$', "'Model'", '3', '1.E-05', AX0, '$');
  const units = E('IFCUNITASSIGNMENT', `(${[E('IFCSIUNIT', '*', '.LENGTHUNIT.', '.MILLI.', '.METRE.'), E('IFCSIUNIT', '*', '.AREAUNIT.', '$', '.SQUARE_METRE.'), E('IFCSIUNIT', '*', '.VOLUMEUNIT.', '$', '.CUBIC_METRE.'), E('IFCSIUNIT', '*', '.PLANEANGLEUNIT.', '$', '.RADIAN.')].join(',')})`);
  const project = E('IFCPROJECT', istr(guid()), OH, istr(opts.name || p.name || 'Дом'), istr('Эскиз из конструктора ' + DK.CONFIG.brand), '$', '$', '$', `(${CTX})`, units);
  const sitePl = E('IFCLOCALPLACEMENT', '$', AX0);
  const site = E('IFCSITE', istr(guid()), OH, istr('Участок'), '$', '$', sitePl, '$', '$', '.ELEMENT.', '$', '$', '$', '$', '$');
  const bPl = E('IFCLOCALPLACEMENT', sitePl, AX0);
  const building = E('IFCBUILDING', istr(guid()), OH, istr(opts.name || p.name || 'Дом'), '$', '$', bPl, '$', '$', '.ELEMENT.', '$', '$', '$');
  E('IFCRELAGGREGATES', istr(guid()), OH, '$', '$', project, `(${site})`);
  E('IFCRELAGGREGATES', istr(guid()), OH, '$', '$', site, `(${building})`);

  // геометрия: X = x, Y = −y (на плане y вниз), Z вверх; всё в мм
  const body = (items) => E('IFCPRODUCTDEFINITIONSHAPE', '$', '$', `(${E('IFCSHAPEREPRESENTATION', CTX, "'Body'", "'SweptSolid'", `(${items.join(',')})`)})`);
  const box = (x0, y0, x1, y1, z0, h) => {
    const w = x1 - x0, d = y1 - y0;
    const prof = E('IFCRECTANGLEPROFILEDEF', '.AREA.', '$', E('IFCAXIS2PLACEMENT2D', pt((x0 + x1) / 2, -(y0 + y1) / 2), '$'), num(w), num(d));
    return E('IFCEXTRUDEDAREASOLID', prof, E('IFCAXIS2PLACEMENT3D', pt(0, 0, z0), '$', '$'), DZ, num(h));
  };
  const seg = (x1, y1, x2, y2, t, z0, h) => {
    const len = Math.hypot(x2 - x1, y2 - y1), dir = E('IFCDIRECTION', `(${num((x2 - x1) / len)},${num(-(y2 - y1) / len)})`);
    const prof = E('IFCRECTANGLEPROFILEDEF', '.AREA.', '$', E('IFCAXIS2PLACEMENT2D', pt((x1 + x2) / 2, -(y1 + y2) / 2), dir), num(len), num(t));
    return E('IFCEXTRUDEDAREASOLID', prof, E('IFCAXIS2PLACEMENT3D', pt(0, 0, z0), '$', '$'), DZ, num(h));
  };
  const poly = (pts, z0, h) => {
    const pl = E('IFCPOLYLINE', `(${pts.concat([pts[0]]).map(q => pt(q.x, -q.y)).join(',')})`);
    return E('IFCEXTRUDEDAREASOLID', E('IFCARBITRARYCLOSEDPROFILEDEF', '.AREA.', '$', pl), E('IFCAXIS2PLACEMENT3D', pt(0, 0, z0), '$', '$'), DZ, num(h));
  };
  const qto = (obj, list) => { const q = E('IFCELEMENTQUANTITY', istr(guid()), OH, "'BaseQuantities'", '$', '$', `(${list.join(',')})`); E('IFCRELDEFINESBYPROPERTIES', istr(guid()), OH, '$', '$', `(${obj})`, q); };
  const pset = (obj, name, props) => {
    const ps = Object.entries(props).filter(([, v]) => v != null && v !== '').map(([k, v]) => E('IFCPROPERTYSINGLEVALUE', istr(k), '$', typeof v === 'number' ? `IFCREAL(${num(v)})` : typeof v === 'boolean' ? `IFCBOOLEAN(.${v ? 'T' : 'F'}.)` : `IFCLABEL(${istr(v)})`, '$'));
    if (ps.length) E('IFCRELDEFINESBYPROPERTIES', istr(guid()), OH, '$', '$', `(${obj})`, E('IFCPROPERTYSET', istr(guid()), OH, istr(name), '$', `(${ps.join(',')})`));
  };

  const t = DK.ts(p), ext = DK.extT(p), H = DK.storey(p), storeys = [];
  const wallMat = { gas: 'Газобетон', brick: 'Кирпич', ceramic: 'Керамический блок', frame: 'Каркас' }[p.wallMat] || p.wallMat;
  const af = DK.atticOn(p) ? DK.atticFloor(p) : null;
  DK.floorsOf(p).forEach(fid => {
    const z = DK.elev(p, fid), stPl = E('IFCLOCALPLACEMENT', bPl, E('IFCAXIS2PLACEMENT3D', pt(0, 0, z), DZ, DX));
    const nm = fid === af ? 'Мансарда' : DK.floorName(fid);
    const st = E('IFCBUILDINGSTOREY', istr(guid()), OH, istr(nm), '$', '$', stPl, '$', '$', '.ELEMENT.', num(z));
    storeys.push(st);
    const els = [], spaces = [], elPl = () => E('IFCLOCALPLACEMENT', stPl, AX0);
    const hWall = fid === af ? DK.knee(p) : H, hPart = fid === af ? Math.min(p.hClear, 2500) : p.hClear;
    const ws = DK.walls(p, fid), lv = p.levels[fid];
    const wallOf = {};
    ws.forEach(w => {
      if (w.rail) return;
      let { x0, y0, x1, y1 } = w;
      if (w.kind === 'outer') {
        // наружная стена целиком: несущий слой + утеплитель и облицовка наружу
        const e = w.edge;
        if (w.axis === 'x') { if (w.out < 0) y0 -= ext; else y1 += ext; } else { if (w.out < 0) x0 -= ext; else x1 += ext; }
        // на выпуклых углах стена продлевается на толщину утеплителя, чтобы угол был закрыт
        const sLo = e.dir > 0, cs = DK.chamferOf(p, e.id), ce = DK.chamferOf(p, p.poly[(e.i + 1) % p.poly.length].id);
        const lo = (e.convexA && !cs && sLo) || (e.convexB && !ce && !sLo), hi = (e.convexA && !cs && !sLo) || (e.convexB && !ce && sLo);
        if (w.axis === 'x') { if (lo) x0 -= ext; if (hi) x1 += ext; } else { if (lo) y0 -= ext; if (hi) y1 += ext; }
      }
      const name = { outer: `Наружная стена, ${wallMat} ${t} мм + утепление и облицовка ${ext} мм`, bearing: 'Несущая стена 380 мм', part: 'Перегородка 120 мм' }[w.kind];
      const el = E('IFCWALL', istr(guid()), OH, istr(name), '$', istr(w.kind === 'outer' ? 'Наружная' : w.kind === 'bearing' ? 'Несущая' : 'Перегородка'), elPl(), body([box(x0, y0, x1, y1, 0, w.kind === 'part' ? hPart : hWall)]), '$');
      pset(el, 'Pset_WallCommon', { IsExternal: w.kind === 'outer', LoadBearing: w.kind !== 'part' });
      wallOf[w.id] = { el, w, x0, y0, x1, y1 }; els.push(el);
    });
    DK.diagWalls(p, fid).forEach(d => {
      if (d.rail) return;
      const name = d.kind === 'outer' ? `Наружная стена (срез угла), ${wallMat}` : 'Перегородка 120 мм (косая)';
      const tt = d.kind === 'outer' ? t + ext : d.t;
      let { x1, y1, x2, y2 } = d;
      if (d.kind === 'outer') { x1 -= d.out.x * ext / 2; x2 -= d.out.x * ext / 2; y1 -= d.out.y * ext / 2; y2 -= d.out.y * ext / 2; }
      els.push(E('IFCWALL', istr(guid()), OH, istr(name), '$', '$', elPl(), body([seg(x1, y1, x2, y2, tt, 0, d.kind === 'outer' ? hWall : hPart)]), '$'));
    });
    // проёмы: вырез в стене + окно или дверь
    (lv.open || []).forEach(o => {
      const W = wallOf[o.wall]; if (!W) return;
      const sz = DK.opSize(p, o), w = W.w, a0 = o.c - o.w / 2, a1 = o.c + o.w / 2;
      const r = w.axis === 'x' ? [a0, W.y0 - 10, a1, W.y1 + 10] : [W.x0 - 10, a0, W.x1 + 10, a1];
      const op = E('IFCOPENINGELEMENT', istr(guid()), OH, istr('Проём'), '$', "'Opening'", elPl(), body([box(r[0], r[1], r[2], r[3], sz.sill, sz.h)]), '$');
      E('IFCRELVOIDSELEMENT', istr(guid()), OH, '$', '$', W.el, op);
      const m = w.axis === 'x' ? (W.y0 + W.y1) / 2 : (W.x0 + W.x1) / 2, ft = 80;
      const fr = w.axis === 'x' ? [a0, m - ft / 2, a1, m + ft / 2] : [m - ft / 2, a0, m + ft / 2, a1];
      const isWin = o.kind === 'win';
      const nm2 = isWin ? (o.pano ? 'Панорамное окно' : 'Окно') + ` ${o.w}×${sz.h}` : o.kind === 'entry' ? `Входная дверь ${o.w}×${sz.h}` : o.kind === 'pass' ? `Проём без двери ${o.w}` : `Дверь ${o.w}×${sz.h}`;
      if (o.kind === 'pass') return;
      const fill = isWin ? E('IFCWINDOW', istr(guid()), OH, istr(nm2), '$', '$', elPl(), body([box(fr[0], fr[1], fr[2], fr[3], sz.sill, sz.h)]), '$', num(sz.h), num(o.w))
        : E('IFCDOOR', istr(guid()), OH, istr(nm2), '$', '$', elPl(), body([box(fr[0], fr[1], fr[2], fr[3], 0, sz.h)]), '$', num(sz.h), num(o.w));
      E('IFCRELFILLSELEMENT', istr(guid()), OH, '$', '$', op, fill); els.push(fill);
    });
    // перекрытие под этажом и чердачное над верхним
    const ol = DK.outline(p, -t), slab = E('IFCSLAB', istr(guid()), OH, istr(fid === 'f1' ? 'Цокольное перекрытие' : fid === 'b' ? 'Плита пола цоколя' : 'Перекрытие'), '$', '$', elPl(), body([poly(ol, -p.slab, p.slab)]), '$', fid === 'f1' || fid === 'b' ? '.BASESLAB.' : '.FLOOR.');
    els.push(slab);
    if (fid === DK.floorsOf(p).slice(-1)[0] && fid !== af) els.push(E('IFCSLAB', istr(guid()), OH, istr('Чердачное перекрытие'), '$', '$', elPl(), body([poly(ol, p.hClear, p.slab)]), '$', '.ROOF.'));
    // лестница — габарит марша
    const sr = DK.stairRect(p);
    if (sr && fid !== DK.floorsOf(p).slice(-1)[0] && fid !== 'b') els.push(E('IFCSTAIR', istr(guid()), OH, istr('Лестница (габарит)'), '$', '$', elPl(), body([box(sr.x0, sr.y0, sr.x1, sr.y1, 0, H)]), '$', '.NOTDEFINED.'));
    // помещения с площадями
    DK.rooms(p, fid).forEach((r, i) => {
      const R = DK.ROOM[r.type] || DK.ROOM.none, area = fid === af ? DK.atticArea(p, r) : r.area;
      const sp = E('IFCSPACE', istr(guid()), OH, istr(String(i + 1)), '$', '$', elPl(), body(r.cells.map(c => box(c[0], c[1], c[2], c[3], 0, fid === af ? Math.min(p.hClear, 2500) : p.hClear))), istr(R.n), '.ELEMENT.', '.INTERNAL.', '$');
      qto(sp, [E('IFCQUANTITYAREA', "'NetFloorArea'", '$', '$', num(area))]);
      spaces.push(sp);
    });
    if (els.length) E('IFCRELCONTAINEDINSPATIALSTRUCTURE', istr(guid()), OH, '$', '$', `(${els.join(',')})`, st);
    if (spaces.length) E('IFCRELAGGREGATES', istr(guid()), OH, '$', '$', st, `(${spaces.join(',')})`);
  });
  E('IFCRELAGGREGATES', istr(guid()), OH, '$', '$', building, `(${storeys.join(',')})`);
  const A = DK.areas(p);
  pset(building, 'Свой Дом — эскиз', { 'Общая площадь, м²': Math.round(A.total * 10) / 10, 'Этажей': DK.floorsOf(p).length, 'Материал стен': wallMat, 'Кровля': (p.roof && p.roof.type) || '', 'Уклон кровли, °': (p.roof && p.roof.pitch) || 0, 'Высота этажа в чистоте, мм': p.hClear, 'Примечание': 'Кровлю, фундамент и узлы достройте в BIM-программе' });

  const d = new Date().toISOString().slice(0, 19);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME(${istr((opts.name || 'dom') + '.ifc')},'${d}',(${istr(DK.CONFIG.brand)}),(${istr(DK.CONFIG.brand)}),'SvoyDom export','SvoyDom','');\nFILE_SCHEMA(('IFC2X3'));\nENDSEC;\nDATA;\n` +
    L.map((s, i) => `#${i + 1}=${s};`).join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
};

/* ---------- DXF R12 (кодировка Windows-1251) ---------- */
function cp1251(s) {
  const out = new Uint8Array(s.length); let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 128) out[n++] = c;
    else if (c >= 0x410 && c <= 0x44F) out[n++] = c - 0x350;
    else if (c === 0x401) out[n++] = 0xA8; else if (c === 0x451) out[n++] = 0xB8;
    else if (c === 0x2116) out[n++] = 0xB9; else if (c === 0xB2) out[n++] = 0x32; else if (c === 0xD7) out[n++] = 0x78; else if (c === 0xB0) out[n++] = 0xB0;
    else if (c === 0x2014 || c === 0x2013) out[n++] = 0x2D; else out[n++] = 0x3F;
  }
  return out.slice(0, n);
}
DK.exportDXF = function (p) {
  const o = [], g = (c, v) => { o.push(String(c), String(v)); };
  const fl = DK.floorsOf(p), gap = 5000, af = DK.atticOn(p) ? DK.atticFloor(p) : null;
  let ox = 0;
  const line = (ly, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, ly); g(10, (ox + x1).toFixed(1)); g(20, (-y1).toFixed(1)); g(30, 0); g(11, (ox + x2).toFixed(1)); g(21, (-y2).toFixed(1)); g(31, 0); };
  const pline = (ly, pts) => { g(0, 'POLYLINE'); g(8, ly); g(66, 1); g(70, 1); pts.forEach(q => { g(0, 'VERTEX'); g(8, ly); g(10, (ox + q.x).toFixed(1)); g(20, (-q.y).toFixed(1)); g(30, 0); }); g(0, 'SEQEND'); g(8, ly); };
  const rect = (ly, x0, y0, x1, y1) => pline(ly, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
  const text = (ly, x, y, h, s, center) => { g(0, 'TEXT'); g(8, ly); g(10, (ox + x).toFixed(1)); g(20, (-y).toFixed(1)); g(30, 0); g(40, h); g(1, s); if (center) { g(72, 1); g(11, (ox + x).toFixed(1)); g(21, (-y).toFixed(1)); g(31, 0); } };
  const arc = (ly, cx, cy, r, a0, a1) => { g(0, 'ARC'); g(8, ly); g(10, (ox + cx).toFixed(1)); g(20, (-cy).toFixed(1)); g(30, 0); g(40, r); g(50, a0); g(51, a1); };
  const LAYERS = [['WALLS_OUTER', 7], ['WALLS_BEARING', 1], ['PARTITIONS', 8], ['INSULATION', 3], ['OPENINGS', 5], ['ROOMS', 2], ['DIMS', 4], ['STAIRS', 6], ['TITLE', 7]];
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length);
  LAYERS.forEach(([n, c]) => { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, 'CONTINUOUS'); });
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const t = DK.ts(p), ext = DK.extT(p);
  fl.forEach(fid => {
    const nm = fid === af ? 'Мансарда' : DK.floorName(fid);
    text('TITLE', p.W / 2, -2200, 400, `${nm} — план, мм`, true);
    pline('INSULATION', DK.outline(p, ext)); pline('WALLS_OUTER', DK.outline(p, 0)); pline('WALLS_OUTER', DK.outline(p, -t));
    const ws = DK.walls(p, fid), lv = p.levels[fid];
    ws.forEach(w => { if (w.kind === 'bearing') rect('WALLS_BEARING', w.x0, w.y0, w.x1, w.y1); else if (w.kind === 'part') rect('PARTITIONS', w.x0, w.y0, w.x1, w.y1); });
    DK.diagWalls(p, fid).forEach(d => { if (d.kind === 'part') { const l = Math.hypot(d.x2 - d.x1, d.y2 - d.y1), nx = -(d.y2 - d.y1) / l * d.t / 2, ny = (d.x2 - d.x1) / l * d.t / 2; pline('PARTITIONS', [{ x: d.x1 + nx, y: d.y1 + ny }, { x: d.x2 + nx, y: d.y2 + ny }, { x: d.x2 - nx, y: d.y2 - ny }, { x: d.x1 - nx, y: d.y1 - ny }]); } });
    (lv.open || []).forEach(op => {
      const w = ws.find(v => v.id === op.wall); if (!w) return;
      const a0 = op.c - op.w / 2, a1 = op.c + op.w / 2, lo = w.axis === 'x' ? w.y0 : w.x0, hi = w.axis === 'x' ? w.y1 : w.x1;
      const L2 = (a, b, c, d) => w.axis === 'x' ? line('OPENINGS', a, b, c, d) : line('OPENINGS', b, a, d, c);
      L2(a0, lo, a0, hi); L2(a1, lo, a1, hi);
      if (op.kind === 'win') { const m = (lo + hi) / 2; L2(a0, m - 40, a1, m - 40); L2(a0, m + 40, a1, m + 40); }
      else if (op.kind !== 'pass') {
        // дверь: полотно и дуга открывания внутрь помещения
        const s = w.kind === 'outer' ? -w.out : 1, base = s > 0 ? hi : lo;
        L2(a0, base, a0, base + s * op.w);
        if (w.axis === 'x') arc('OPENINGS', a0, base, op.w, s > 0 ? 270 : 0, s > 0 ? 360 : 90);
        else arc('OPENINGS', base, a0, op.w, s > 0 ? 180 : 0, s > 0 ? 270 : 90);
      }
    });
    const sr = DK.stairRect(p); if (sr && fid !== 'b') { rect('STAIRS', sr.x0, sr.y0, sr.x1, sr.y1); line('STAIRS', sr.x0, sr.y0, sr.x1, sr.y1); }
    DK.rooms(p, fid).forEach((r, i) => {
      const R = DK.ROOM[r.type] || DK.ROOM.none, area = fid === af ? DK.atticArea(p, r) : r.area;
      text('ROOMS', r.cx, r.cy - 120, 220, `${i + 1}. ${R.n}`, true); text('ROOMS', r.cx, r.cy + 260, 200, `${DK.fmtA(area)} м²`, true);
    });
    // габаритные размеры
    const xs = DK.outline(p, ext).map(q => q.x), ys = DK.outline(p, ext).map(q => q.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    line('DIMS', x0, y1 + 900, x1, y1 + 900); line('DIMS', x0, y1 + 700, x0, y1 + 1100); line('DIMS', x1, y1 + 700, x1, y1 + 1100); text('DIMS', (x0 + x1) / 2, y1 + 800, 220, String(Math.round(x1 - x0)), true);
    line('DIMS', x1 + 900, y0, x1 + 900, y1); line('DIMS', x1 + 700, y0, x1 + 1100, y0); line('DIMS', x1 + 700, y1, x1 + 1100, y1); text('DIMS', x1 + 1100, (y0 + y1) / 2, 220, String(Math.round(y1 - y0)));
    ox += p.W + gap + 2 * ext;
  });
  g(0, 'ENDSEC'); g(0, 'EOF');
  return cp1251(o.join('\r\n') + '\r\n');
};
})();
