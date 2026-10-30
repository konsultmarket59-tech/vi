/* Анкета подбора строителя, корректировка проекта под техзапрос, отправка заявки */
(function () {
'use strict';
const DK = window.DK;

DK.SLOPES = [
  { id: 'flat', n: 'Ровный', d: '0–3°', a: 2 },
  { id: 'small', n: 'Небольшой', d: '3–7°', a: 5 },
  { id: 'mid', n: 'Заметный', d: '7–15°', a: 11 },
  { id: 'steep', n: 'Крутой', d: 'больше 15°', a: 20 },
  { id: 'unknown', n: 'Не знаю', d: 'уточним на созвоне', a: null },
];
DK.TERMS = [
  { id: 'now', n: 'В этом сезоне' }, { id: 'y1', n: 'В течение года' }, { id: 'y2', n: 'Через 1–2 года' }, { id: 'look', n: 'Пока присматриваюсь' },
];
DK.CITIES = ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Нижний Новгород', 'Челябинск', 'Красноярск', 'Самара', 'Уфа',
  'Ростов-на-Дону', 'Омск', 'Краснодар', 'Воронеж', 'Пермь', 'Волгоград', 'Саратов', 'Тюмень', 'Ижевск', 'Барнаул', 'Иркутск', 'Хабаровск', 'Ярославль',
  'Владивосток', 'Махачкала', 'Томск', 'Оренбург', 'Кемерово', 'Новокузнецк', 'Рязань', 'Набережные Челны', 'Астрахань', 'Пенза', 'Киров', 'Липецк',
  'Чебоксары', 'Калининград', 'Тула', 'Курск', 'Сочи', 'Ставрополь', 'Улан-Удэ', 'Тверь', 'Магнитогорск', 'Белгород', 'Сургут', 'Владимир', 'Архангельск', 'Калуга', 'Смоленск'];

/* картинка уклона: участок, дом, угол */
DK.slopeSvg = function (a) {
  if (a == null) return '<svg viewBox="0 0 120 64" aria-hidden="true"><text x="60" y="40" text-anchor="middle" font-size="26" fill="currentColor" font-family="Manrope, sans-serif" font-weight="800">?</text></svg>';
  const r = a * Math.PI / 180, x0 = 6, x1 = 114, yb = 56, y1 = yb - (x1 - x0) * Math.tan(r) * 0.9;
  const gy = (x) => yb - (x - x0) * Math.tan(r) * 0.9, hx = 60, eave = gy(hx + 12) - 14;
  return `<svg viewBox="0 0 120 64" aria-hidden="true">
    <path d="M${x0} ${yb} L${x1} ${y1.toFixed(1)} L${x1} 62 L${x0} 62 Z" fill="currentColor" opacity=".16"/>
    <path d="M${x0} ${yb} L${x1} ${y1.toFixed(1)}" stroke="currentColor" stroke-width="2.2" fill="none"/>
    <path d="M${x0} ${yb} L${x1} ${yb}" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3" opacity=".6"/>
    <path d="M${hx - 12} ${gy(hx - 12).toFixed(1)} V${eave.toFixed(1)} L${hx} ${(eave - 10).toFixed(1)} L${hx + 12} ${eave.toFixed(1)} V${gy(hx + 12).toFixed(1)}" stroke="currentColor" stroke-width="1.6" fill="none"/>
    <path d="M${x0 + 26} ${yb} A26 26 0 0 0 ${(x0 + 26 * Math.cos(r)).toFixed(1)} ${(yb - 26 * Math.sin(r)).toFixed(1)}" stroke="currentColor" stroke-width="1.3" fill="none"/>
    <text x="${x0 + 30}" y="${yb - 3}" font-size="10" fill="currentColor" font-family="Manrope, sans-serif">${a}°</text>
  </svg>`;
};

/* корректировка проекта под ответы: возвращает новый проект и список изменений */
DK.applyBrief = function (src, a) {
  const p = JSON.parse(JSON.stringify(src)), ch = [], notes = [];
  if (a.material === 'brick' && p.wallMat !== 'brick') { p.wallMat = 'brick'; ch.push('Наружные стены — кирпич 510 мм вместо газобетона 400 мм; габариты пересчитаны'); }
  if (a.material === 'gas' && p.wallMat !== 'gas') { p.wallMat = 'gas'; ch.push('Наружные стены — газобетон 400 мм'); }
  const byClass = { eco: { clad: 'plaster', insul: 100 }, comfort: { clad: 'brick', insul: 50 }, premium: { clad: 'fibro', insul: 100 } }[a.cls];
  if (byClass && (p.clad !== byClass.clad || p.insul !== byClass.insul)) {
    p.clad = byClass.clad; p.insul = byClass.insul;
    ch.push(`Фасад под класс «${DK.CONFIG.prices[a.cls].n}»: ${DK.SPEC.clad[p.clad].n.toLowerCase()}, утеплитель ${p.insul} мм`);
  }
  if ((a.slope === 'mid' || a.slope === 'steep') && !p.basement) {
    p.basement = true;
    ch.push('Добавлен цокольный этаж: перепад участка используем под котельную, гараж или кладовые');
  }
  if (a.slope === 'small') notes.push('Уклон 3–7°: высокий цоколь или свайно-ростверковый фундамент, вертикальная планировка');
  if (a.slope === 'steep') notes.push('Уклон больше 15°: подпорные стены, обязательны геология и геодезия');
  if (a.slope === 'unknown') notes.push('Уклон не известен — уточним по топосъёмке');
  if (a.plot === 'no') notes.push('Участка пока нет — поможем оценить варианты под этот проект');
  DK.normalize(p);
  const errs = DK.checks(p).filter(c => c.lv === 'err');
  errs.forEach(c => notes.push('Проверить: ' + c.txt));
  const A = DK.areas(p), et = DK.estimateText(p, a.cls);
  const est = { area: A.total, from: Math.round(et.e.min / 1e5) / 10, to: Math.round(et.e.max / 1e5) / 10, range: et.range, perM2: et.perM2 };
  return { p, ch, notes, est };
};

/* краткое техописание проекта для заявки */
DK.brief = function (p) {
  const A = DK.areas(p), out = [];
  out.push(`Форма: ${p.poly.length === 4 ? 'прямоугольник' : 'сложный контур, ' + p.poly.length + ' углов'}`);
  out.push(`Габариты с облицовкой ${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м, по несущему слою ${DK.fmtM(p.W)} × ${DK.fmtM(p.D)} м`);
  out.push(`Этажи: ${DK.floorsOf(p).map(DK.floorName).join(', ')}; высота в чистоте ${p.hClear} мм`);
  out.push(`Наружные стены: ${DK.SPEC.outer[p.wallMat].n} + утеплитель ${p.insul} мм + ${DK.SPEC.clad[p.clad].n.toLowerCase()} (итого ${A.T} мм)`);
  out.push(`Внутренняя несущая стена: ${p.bearing.length ? DK.SPEC.bearing.n : 'нет'}; перегородки — ${DK.SPEC.part.n.toLowerCase()}`);
  out.push(`Кровля: ${DK.ROOFS[p.roof.type].n.toLowerCase()}${p.roof.type !== 'flat' ? ', ' + p.roof.pitch + '°' : ''}; фасад: ${p.facade ? 'своя отделка' : (DK.FACADES[p.style] || DK.FACADES.white).n.toLowerCase()}`);
  for (const f of A.per) {
    const rs = DK.rooms(p, f.fid).filter(r => r.type !== 'none').map(r => `${DK.ROOM[r.type].n.toLowerCase()} ${DK.fmtA(r.area)}`);
    const w = p.levels[f.fid].open.filter(o => o.kind === 'win');
    out.push(`${f.n} — ${DK.fmtA(f.area)} м²: ${rs.join(', ') || 'помещения не назначены'}; окон ${w.length}, из них панорамных ${w.filter(o => o.pano).length}`);
  }
  out.push(`Общая площадь помещений ${DK.fmtA(A.total)} м², площадь застройки ${DK.fmtA(A.footprint)} м²`);
  const F = DK.facadeOf(p), wm = (z) => z ? `${DK.WALL_MATS[z.m] || z.m} ${z.c}` : '';
  out.push(`Отделка: стены — ${wm(F.main)}${F.accentOn !== 'none' ? '; акцент (' + DK.ACCENT_ON[F.accentOn].toLowerCase() + ') — ' + wm(F.accent) : ''}; цоколь — ${wm(F.plinth)}; кровля — ${DK.ROOF_MATS[F.roof.m] || F.roof.m} ${F.roof.c}; рамы ${F.frame}`);
  DK.tzItems(p).forEach(t => out.push('ТЗ: ' + t));
  return out;
};

DK.sendLead = async function (payload) {
  const url = (DK.CONFIG.api || '') + '/api/lead';
  try {
    if (location.protocol === 'file:' || window.__PREVIEW) throw new Error('file');
    let g; try { g = await DK.guard.data(document.getElementById('leadForm')); } catch (er) { return { ok: false, error: er.message }; }
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, payload, g)) });
    if (r.status === 400 || r.status === 429) { const j = await r.json().catch(() => ({})); return { ok: false, error: j.error || 'Слишком много заявок, попробуйте позже' }; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    try { const box = JSON.parse(localStorage.getItem('dk-outbox') || '[]'); box.push({ at: Date.now(), payload: Object.assign({}, payload, { images: undefined }) }); localStorage.setItem('dk-outbox', JSON.stringify(box.slice(-5))); } catch (_) { /* хранилище недоступно */ }
    return { ok: false, offline: true };
  }
};
})();
