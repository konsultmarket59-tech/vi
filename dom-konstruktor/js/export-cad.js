/* Экспорт эскиза для архитектора.
   IFC 2x3 — открытый BIM-формат: ArchiCAD открывает его как модель (стены, перекрытия, окна, двери, помещения с площадями)
   и сохраняет в свой .pln; так же читают Revit, Renga, nanoCAD BIM. Формат .pln закрытый — напрямую его пишет только ArchiCAD.
   DXF R12 — планы этажей по слоям, каждый на своём листе А3 со штампом и экспликацией: AutoCAD, nanoCAD, ArchiCAD (открыть как чертёж). */
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
  const app = E('IFCAPPLICATION', org, "'1.0'", istr('Конструктор дома ' + DK.CONFIG.brand), "'LogikaDoma'");
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
  pset(building, 'Логика Дома — эскиз', { 'Общая площадь, м²': Math.round(A.total * 10) / 10, 'Этажей': DK.floorsOf(p).length, 'Материал стен': wallMat, 'Кровля': (p.roof && p.roof.type) || '', 'Уклон кровли, °': (p.roof && p.roof.pitch) || 0, 'Высота этажа в чистоте, мм': p.hClear, 'Примечание': 'Кровлю, фундамент и узлы достройте в BIM-программе' });

  const d = new Date().toISOString().slice(0, 19);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME(${istr((opts.name || 'dom') + '.ifc')},'${d}',(${istr(DK.CONFIG.brand)}),(${istr(DK.CONFIG.brand)}),'LogikaDoma export','LogikaDoma','');\nFILE_SCHEMA(('IFC2X3'));\nENDSEC;\nDATA;\n` +
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
    else if (c === 0x2116) out[n++] = 0xB9; else if (c === 0xB2) out[n++] = 0x32; else if (c === 0xD7) out[n++] = 0x78; else if (c === 0xB0) out[n++] = 0xB0; else if (c === 0xB7) out[n++] = 0xB7;
    else if (c === 0x2014 || c === 0x2013) out[n++] = 0x2D; else out[n++] = 0x3F;
  }
  return out.slice(0, n);
}
/* Чертежи по слоям: каждый этаж — на своём листе А3 (рамка, штамп, экспликация) в пространстве модели, единицы — мм.
   opts.dimOuter / opts.dimInner — наружные и внутренние размеры (по умолчанию оба). */
DK.DXF_LAYERS = [['FRAME', 7, 'Рамка листа'], ['STAMP', 7, 'Штамп и надписи листа'], ['WALLS_OUTER', 7, 'Наружные стены'], ['INSULATION', 51, 'Утеплитель'],
  ['WALLS_BEARING', 1, 'Несущие стены'], ['PARTITIONS', 8, 'Перегородки'], ['WINDOWS', 5, 'Окна'], ['DOORS', 3, 'Двери и проёмы'], ['STAIRS', 6, 'Лестница'],
  ['ROOM_TAGS', 4, 'Марки помещений'], ['EXPLICATION', 7, 'Экспликация'], ['DIMS_OUTER', 140, 'Наружные размеры'], ['DIMS_INNER', 30, 'Внутренние размеры']];
DK.exportDXF = function (p, opts) {
  opts = Object.assign({ dimOuter: true, dimInner: true }, opts || {});
  const o = [], g = (c, v) => { o.push(String(c), String(v)); };
  const fl = DK.floorsOf(p), af = DK.atticOn(p) ? DK.atticFloor(p) : null, ex = DK.explication(p);
  const t = DK.ts(p), ext = DK.extT(p);
  let ox = 0, oy = 0; // сдвиг текущего листа/плана; ось Y в DXF смотрит вверх — переворачиваем
  const X = (x) => (ox + x).toFixed(1), Y = (y) => (-(oy + y)).toFixed(1);
  const line = (ly, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, ly); g(10, X(x1)); g(20, Y(y1)); g(30, 0); g(11, X(x2)); g(21, Y(y2)); g(31, 0); };
  const pline = (ly, pts) => { g(0, 'POLYLINE'); g(8, ly); g(66, 1); g(70, 1); pts.forEach(q => { g(0, 'VERTEX'); g(8, ly); g(10, X(q.x)); g(20, Y(q.y)); g(30, 0); }); g(0, 'SEQEND'); g(8, ly); };
  const rect = (ly, x0, y0, x1, y1) => pline(ly, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
  // align: 0 — слева, 1 — по центру, 2 — справа; rot — поворот, градусы
  const text = (ly, x, y, h, str, align, rot) => { g(0, 'TEXT'); g(8, ly); g(10, X(x)); g(20, Y(y)); g(30, 0); g(40, h.toFixed(1)); g(1, str); if (rot) g(50, rot); if (align) { g(72, align); g(11, X(x)); g(21, Y(y)); g(31, 0); } };
  const arc = (ly, cx, cy, r, a0, a1) => { g(0, 'ARC'); g(8, ly); g(10, X(cx)); g(20, Y(cy)); g(30, 0); g(40, r); g(50, a0); g(51, a1); };

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1); g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0.0); g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, DK.DXF_LAYERS.length);
  DK.DXF_LAYERS.forEach(([n, c]) => { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, 'CONTINUOUS'); });
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1); g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0.0); g(41, 1.0); g(50, 0.0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, ''); g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');

  // габарит плана с размерами — по нему выбираем масштаб листа
  const ol = DK.outline(p, ext), bx0 = Math.min(...ol.map(q => q.x)) - 2600, bx1 = Math.max(...ol.map(q => q.x)) + 2600, by0 = Math.min(...ol.map(q => q.y)) - 2600, by1 = Math.max(...ol.map(q => q.y)) + 2600;
  const AW = 280, AH = 227; // поле под план на листе (слева от экспликации, над штампом), мм бумаги
  const S = [100, 200, 400].find(k => (bx1 - bx0) / k <= AW && (by1 - by0) / k <= AH) || 400;
  const SW = 420 * S, SH = 297 * S, total = fl.length, today = new Date().toLocaleDateString('ru-RU');
  const title = opts.name || p.cloudTitle || p.name || 'Жилой дом';
  // линейный размер: линия, засечки 45°, выносные, текст над линией
  const tick = S * 1.5, th = S * 2.5;
  const hd = (ly, x0, x1, y, from, label) => {
    line(ly, x0 - tick, y, x1 + tick, y);
    for (const x of [x0, x1]) { line(ly, x - tick / 2, y + tick / 2, x + tick / 2, y - tick / 2); if (from != null) line(ly, x, from, x, y + Math.sign(y - from) * tick); }
    if (x1 - x0 > th * 2.2) text(ly, (x0 + x1) / 2, y - S * 0.8, th, String(label || Math.round(x1 - x0)), 1);
  };
  const vd = (ly, y0, y1, x, from, label) => {
    line(ly, x, y0 - tick, x, y1 + tick);
    for (const y of [y0, y1]) { line(ly, x - tick / 2, y + tick / 2, x + tick / 2, y - tick / 2); if (from != null) line(ly, from, y, x + Math.sign(x - from) * tick, y); }
    if (y1 - y0 > th * 2.2) text(ly, x - S * 0.8, (y0 + y1) / 2, th, String(label || Math.round(y1 - y0)), 1, 90);
  };

  fl.forEach((fid, i) => {
    const nm = fid === af ? 'Мансарда' : DK.floorName(fid), sheetName = fid === af ? 'План мансарды' : fid === 'b' ? 'План цокольного этажа' : `План ${fid[1]} этажа`;
    // ---- лист: рамка 20/5/5/5 мм и штамп 185 × 40 мм
    ox = i * (SW + 20 * S); oy = 0;
    rect('FRAME', 0, 0, SW, SH); rect('FRAME', 20 * S, 5 * S, SW - 5 * S, SH - 5 * S);
    const sx = SW - 5 * S - 185 * S, sy = SH - 5 * S - 40 * S, m = (v) => v * S;
    rect('STAMP', sx, sy, sx + m(185), sy + m(40));
    line('STAMP', sx + m(120), sy, sx + m(120), sy + m(40));
    line('STAMP', sx, sy + m(10), sx + m(185), sy + m(10)); line('STAMP', sx, sy + m(25), sx + m(120), sy + m(25));
    line('STAMP', sx + m(120), sy + m(25), sx + m(185), sy + m(25)); line('STAMP', sx + m(140), sy + m(10), sx + m(140), sy + m(40)); line('STAMP', sx + m(162), sy + m(10), sx + m(162), sy + m(40));
    text('STAMP', sx + m(4), sy + m(7), m(4), 'Логика Дома · Эскизный проект');
    text('STAMP', sx + m(124), sy + m(7), m(3), today);
    text('STAMP', sx + m(4), sy + m(19), m(3.5), title.slice(0, 48));
    text('STAMP', sx + m(4), sy + m(34), m(4), sheetName);
    text('STAMP', sx + m(130), sy + m(17), m(2.5), 'Стадия', 1); text('STAMP', sx + m(151), sy + m(17), m(2.5), 'Лист', 1); text('STAMP', sx + m(173.5), sy + m(17), m(2.5), 'Листов', 1);
    text('STAMP', sx + m(130), sy + m(33), m(3.5), 'ЭП', 1); text('STAMP', sx + m(151), sy + m(33), m(3.5), String(i + 1), 1); text('STAMP', sx + m(173.5), sy + m(33), m(3.5), String(total), 1);
    text('STAMP', 25 * S, 15 * S, m(5), `${sheetName} · М 1:${S}`);
    // ---- экспликация помещений: справа сверху
    const grp = ex.groups.find(q => q.fid === fid), ex0 = SW - 5 * S - m(95), ey0 = 10 * S, cw = [m(12), m(63), m(20)], rh = m(7);
    if (grp) {
      text('EXPLICATION', ex0 + m(47.5), ey0 + m(5), m(3.5), `Экспликация помещений · ${nm}`, 1);
      let y = ey0 + m(8);
      const row = (a, b, c, bold) => { rect('EXPLICATION', ex0, y, ex0 + m(95), y + rh); line('EXPLICATION', ex0 + cw[0], y, ex0 + cw[0], y + rh); line('EXPLICATION', ex0 + cw[0] + cw[1], y, ex0 + cw[0] + cw[1], y + rh);
        text('EXPLICATION', ex0 + cw[0] / 2, y + m(4.8), m(bold ? 3 : 2.8), a, 1); text('EXPLICATION', ex0 + cw[0] + m(2), y + m(4.8), m(bold ? 3 : 2.8), b); text('EXPLICATION', ex0 + m(95) - m(2), y + m(4.8), m(bold ? 3 : 2.8), c, 2); y += rh; };
      row('№', 'Наименование', 'Площадь, м²', true);
      grp.rooms.forEach(r => row(String(r.n), r.name, DK.fmtA(r.area)));
      row('', 'Итого', DK.fmtA(grp.total), true);
      text('EXPLICATION', ex0, y + m(8), m(2.5), 'Площади — в чистоте, без учёта отделки.');
    }
    // ---- план: по центру поля слева
    ox += 30 * S + ((AW * S) - (bx1 - bx0)) / 2 - bx0; oy = 22 * S + ((AH * S) - (by1 - by0)) / 2 - by0;
    pline('INSULATION', DK.outline(p, ext)); pline('WALLS_OUTER', DK.outline(p, 0)); pline('WALLS_OUTER', DK.outline(p, -t));
    const ws = DK.walls(p, fid), lv = p.levels[fid];
    ws.forEach(w => { if (w.kind === 'bearing') rect('WALLS_BEARING', w.x0, w.y0, w.x1, w.y1); else if (w.kind === 'part') rect('PARTITIONS', w.x0, w.y0, w.x1, w.y1); });
    DK.diagWalls(p, fid).forEach(d => { const l = Math.hypot(d.x2 - d.x1, d.y2 - d.y1), nx = -(d.y2 - d.y1) / l * d.t / 2, ny = (d.x2 - d.x1) / l * d.t / 2; pline(d.kind === 'part' ? 'PARTITIONS' : 'WALLS_OUTER', [{ x: d.x1 + nx, y: d.y1 + ny }, { x: d.x2 + nx, y: d.y2 + ny }, { x: d.x2 - nx, y: d.y2 - ny }, { x: d.x1 - nx, y: d.y1 - ny }]); });
    (lv.open || []).forEach(op => {
      const w = ws.find(v => v.id === op.wall); if (!w) return;
      const ly = op.kind === 'win' ? 'WINDOWS' : 'DOORS';
      const a0 = op.c - op.w / 2, a1 = op.c + op.w / 2, lo = w.axis === 'x' ? w.y0 : w.x0, hi = w.axis === 'x' ? w.y1 : w.x1;
      const L2 = (a, b, c, d) => w.axis === 'x' ? line(ly, a, b, c, d) : line(ly, b, a, d, c);
      L2(a0, lo, a0, hi); L2(a1, lo, a1, hi);
      if (op.kind === 'win') { const mm = (lo + hi) / 2; L2(a0, mm - 40, a1, mm - 40); L2(a0, mm + 40, a1, mm + 40); L2(a0, lo, a1, lo); L2(a0, hi, a1, hi); }
      else if (op.kind !== 'pass') {
        const sg = w.kind === 'outer' ? -w.out : 1, base = sg > 0 ? hi : lo;
        L2(a0, base, a0, base + sg * op.w);
        if (w.axis === 'x') arc(ly, a0, base, op.w, sg > 0 ? 270 : 0, sg > 0 ? 360 : 90);
        else arc(ly, base, a0, op.w, sg > 0 ? 180 : 0, sg > 0 ? 270 : 90);
      }
    });
    const sr = DK.stairRect(p); if (sr && fid !== 'b') { rect('STAIRS', sr.x0, sr.y0, sr.x1, sr.y1); line('STAIRS', sr.x0, sr.y0, sr.x1, sr.y1); }
    // марки помещений: номер в кружке, название, площадь
    const nums = DK.roomNumbers(p)[fid];
    DK.rooms(p, fid).filter(r => r.type !== 'void').forEach(r => {
      const R = DK.ROOM[r.type] || DK.ROOM.none, area = fid === af ? DK.atticArea(p, r) : r.area, n = nums ? nums.get(r.i) : '';
      g(0, 'CIRCLE'); g(8, 'ROOM_TAGS'); g(10, X(r.cx - m(9))); g(20, Y(r.cy)); g(30, 0); g(40, m(3));
      text('ROOM_TAGS', r.cx - m(9), r.cy + m(1.2), m(3), String(n), 1);
      text('ROOM_TAGS', r.cx - m(5), r.cy - m(0.5), m(3), r.type === 'none' ? 'Помещение' : R.n);
      text('ROOM_TAGS', r.cx - m(5), r.cy + m(4), m(2.8), DK.fmtA(area) + ' м²');
    });
    // наружные размеры: общие габариты, по несущему слою, длины стен, цепочки проёмов
    if (opts.dimOuter) {
      const o3 = ext + 1500, o2 = ext + 1050;
      hd('DIMS_OUTER', -ext, p.W + ext, -o3, -ext); vd('DIMS_OUTER', -ext, p.D + ext, -o3, -ext);
      hd('DIMS_OUTER', 0, p.W, -o2, null); vd('DIMS_OUTER', 0, p.D, -o2, null);
      for (const e of DK.edges(p)) {
        const off = e.line + e.out * (ext + 450);
        e.axis === 'x' ? hd('DIMS_OUTER', e.lo, e.hi, off, null) : vd('DIMS_OUTER', e.lo, e.hi, off, null);
        const ops = lv.open.filter(q => q.wall === e.id).sort((a, b) => a.c - b.c); if (!ops.length) continue;
        const pts = [e.lo].concat(...ops.map(q => [q.c - q.w / 2, q.c + q.w / 2]), [e.hi]), off2 = e.line + e.out * (ext + 800);
        for (let k = 0; k < pts.length - 1; k++) e.axis === 'x' ? hd('DIMS_OUTER', pts[k], pts[k + 1], off2, null) : vd('DIMS_OUTER', pts[k], pts[k + 1], off2, null);
      }
    }
    // внутренние размеры: ширина и глубина каждого помещения в чистоте
    if (opts.dimInner) DK.rooms(p, fid).filter(r => r.type !== 'void').forEach(r => {
      const b = r.rect ? [r.x0, r.y0, r.x1, r.y1] : r.big;
      if (b[2] - b[0] > 900) hd('DIMS_INNER', b[0], b[2], b[3] - 350, null);
      if (b[3] - b[1] > 900) vd('DIMS_INNER', b[1], b[3], b[0] + 350, null);
    });
  });
  g(0, 'ENDSEC'); g(0, 'EOF');
  return cp1251(o.join('\r\n') + '\r\n');
};
})();
