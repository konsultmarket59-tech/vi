/* Реалистичные визуализации: баланс пользователя, журнал операций и коды активации.
   Деньги на сайте не принимаются: пакет оплачивают по ссылке банка, менеджер выдаёт код в CRM (код уходит покупателю письмом),
   пользователь вводит код в кабинете — визуализации начисляются. Баланс = сумма операций журнала.
   Те же коды открывают платные выгрузки проекта: kind 'ep' — эскизный проект PDF, 'cad' — файлы для ArchiCAD (код вводят у проекта в кабинете).
   Файлы: data/runtime/viz-codes.json, viz-ledger.json, viz-settings.json. */
'use strict';

module.exports = function credits(ctx) {
  const { readJSON, writeJSON, DATA, crypto } = ctx;
  const join = (f) => DATA.replace(/\/$/, '') + '/' + f;
  const CODES = join('viz-codes.json'), LEDGER = join('viz-ledger.json'), SET = join('viz-settings.json');
  const now = () => new Date().toISOString();
  // без похожих символов: нет 0/O, 1/I/L
  const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const rnd = (n) => { const b = crypto.randomBytes(n * 2); let s = ''; for (let i = 0; i < n; i++) s += ABC[(b[i * 2] * 256 + b[i * 2 + 1]) % ABC.length]; return s; };
  const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^LD/, '').replace(/O/g, '0');
  const fmt = (c) => 'LD-' + c.slice(0, 4) + '-' + c.slice(4, 8);
  const DEF = { packs: [{ n: 3, price: 150, url: '' }, { n: 10, price: 450, url: '' }, { n: 30, price: 1200, url: '' }], welcome: 0,
    unlock: { ep: { price: +process.env.SKETCH_PRICE || 3000, url: '' }, cad: { price: +process.env.CAD_PRICE || 3000, url: '' } } };
  const KINDS = { ep: 'эскизный проект PDF', cad: 'файлы для ArchiCAD' };

  const codes = () => readJSON(CODES, []), ledger = () => readJSON(LEDGER, []);
  const settings = () => { const s = Object.assign({}, DEF, readJSON(SET, {})); s.unlock = Object.assign({}, DEF.unlock, s.unlock || {}); return s; };
  function add(uid, delta, kind, ref, by, note) {
    const l = ledger(); const e = { id: 'v' + Date.now().toString(36) + rnd(3), at: now(), user: uid, delta, kind, ref: ref || '', by: by || '', note: note || '' };
    l.push(e); writeJSON(LEDGER, l); return e;
  }
  const balance = (uid) => ledger().filter(e => e.user === uid).reduce((a, e) => a + e.delta, 0);
  const history = (uid, n) => ledger().filter(e => e.user === uid).slice(-(n || 30)).reverse();

  // перебор кодов: не больше 10 неверных попыток в час на пользователя
  const fails = new Map();
  function redeem(uid, raw) {
    const f = fails.get(uid) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 3600e3) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 10) return { error: 'Слишком много неверных кодов. Попробуйте через час или напишите нам.' };
    const c = norm(raw), list = codes(), x = list.find(q => q.code === c);
    if (!x || x.void) { f.n++; fails.set(uid, f); return { error: 'Такого кода нет. Проверьте, нет ли опечатки.' }; }
    if (x.usedBy) return { error: x.usedBy === uid ? 'Этот код вы уже активировали.' : 'Код уже активирован.' };
    if (KINDS[x.kind]) return { error: `Это код на ${KINDS[x.kind]} — введите его у проекта, кнопкой «${x.kind === 'ep' ? 'Эскизный проект PDF' : 'Файлы для ArchiCAD'}».` };
    x.usedBy = uid; x.usedAt = now(); writeJSON(CODES, list);
    add(uid, x.n, 'code', fmt(c), '', `Код на ${x.n}`);
    return { ok: true, n: x.n, balance: balance(uid) };
  }
  // код выгрузки проекта: открывает ЭП или файлы для ArchiCAD у одного проекта
  function redeemUnlock(uid, raw, kind, project) {
    const f = fails.get(uid) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 3600e3) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 10) return { error: 'Слишком много неверных кодов. Попробуйте через час или напишите нам.' };
    const c = norm(raw), list = codes(), x = list.find(q => q.code === c);
    if (!x || x.void) { f.n++; fails.set(uid, f); return { error: 'Такого кода нет. Проверьте, нет ли опечатки.' }; }
    if (x.usedBy) return { error: 'Код уже активирован.' };
    if (x.kind !== kind) return { error: KINDS[x.kind] ? `Это код на ${KINDS[x.kind]}.` : 'Это код на визуализации — введите его в блоке «Реалистичные визуализации».' };
    x.usedBy = uid; x.usedAt = now(); x.project = project; writeJSON(CODES, list);
    return { ok: true, kind, code: fmt(c) };
  }
  function make(n, count, note, by, kind) {
    kind = KINDS[kind] ? kind : undefined;
    const list = codes(), have = new Set(list.map(q => q.code)), out = [], batch = 'b' + Date.now().toString(36);
    for (let i = 0; i < Math.min(500, Math.max(1, count | 0)); i++) {
      let c; do c = rnd(8); while (have.has(c)); have.add(c);
      const x = { code: c, n: kind ? 1 : Math.max(1, Math.min(1000, n | 0)), batch, note: String(note || '').slice(0, 200), at: now(), by: by || '' };
      if (kind) x.kind = kind;
      list.push(x); out.push(x);
    }
    writeJSON(CODES, list); return out.map(view);
  }
  // выдача покупателю: свободный код нужного пакета помечается выданным на почту
  function issue(n, email, by, note, kind) {
    kind = KINDS[kind] ? kind : undefined;
    const list = codes(), x = list.find(q => (kind ? q.kind === kind : !q.kind && q.n === n) && !q.usedBy && !q.issuedTo && !q.void);
    if (!x) return null;
    x.issuedTo = String(email).toLowerCase().slice(0, 120); x.issuedAt = now(); x.issuedBy = by || ''; if (note) x.note = String(note).slice(0, 200);
    writeJSON(CODES, list); return view(x);
  }
  function voidCode(raw) { const list = codes(), x = list.find(q => q.code === norm(raw)); if (!x || x.usedBy) return false; x.void = true; writeJSON(CODES, list); return true; }
  const view = (x) => Object.assign({}, x, { code: fmt(x.code) });
  function saveSettings(d) {
    const s = settings();
    if (Array.isArray(d.packs)) s.packs = d.packs.slice(0, 6).map(p => ({ n: Math.max(1, Math.min(1000, +p.n | 0)), price: Math.max(0, Math.round(+p.price || 0)), url: /^https:\/\//.test(p.url || '') ? String(p.url).slice(0, 500) : '' }));
    if (d.welcome != null) s.welcome = Math.max(0, Math.min(10, +d.welcome | 0));
    if (d.unlock && typeof d.unlock === 'object') for (const k of Object.keys(KINDS)) if (d.unlock[k]) s.unlock[k] = { price: Math.max(0, Math.round(+d.unlock[k].price || 0)), url: /^https:\/\//.test(d.unlock[k].url || '') ? String(d.unlock[k].url).slice(0, 500) : '' };
    writeJSON(SET, s); return s;
  }
  function report() {
    const l = ledger(), all = codes(), c = all.filter(q => !q.kind);
    const by = (k) => l.filter(e => e.kind === k).reduce((a, e) => a + e.delta, 0);
    return { codes: c.length, free: c.filter(q => !q.usedBy && !q.issuedTo && !q.void).length, issued: c.filter(q => q.issuedTo && !q.usedBy).length, used: c.filter(q => q.usedBy).length,
      activated: by('code'), granted: by('grant'), spent: -by('render'), refunded: by('refund'),
      unlocks: Object.fromEntries(Object.keys(KINDS).map(k => [k, { free: all.filter(q => q.kind === k && !q.usedBy && !q.issuedTo && !q.void).length, used: all.filter(q => q.kind === k && q.usedBy).length }])) };
  }
  function balances() { const m = {}; ledger().forEach(e => { m[e.user] = (m[e.user] || 0) + e.delta; }); return m; }
  return { KINDS, redeemUnlock, balance, history, add, redeem, make, issue, voidCode, codes: () => codes().map(view), settings, saveSettings, report, balances, fmt, norm };
};
