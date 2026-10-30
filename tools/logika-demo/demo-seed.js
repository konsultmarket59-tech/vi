const { chromium } = require('/opt/node-tools/node_modules/playwright');
const B = 'http://localhost:8095'; let ipn = 1;
const j = async (path, data, tok, method) => { const r = await fetch(B + path, { method: method || (data ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.' + (ipn++) }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: data ? JSON.stringify(data) : undefined }); const t = await r.json().catch(() => ({})); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(t)); return t; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => console.log('ERR', e.message)); await pg.route(/fonts\./, r => r.abort()); await pg.route(/three\.min/, r => r.fulfill({ path: process.cwd() + '/three/package/build/three.min.js', contentType: 'text/javascript' }));
  await pg.goto(B + '/'); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await pg.waitForTimeout(600);
  const L = [
    { a: { city: 'Пермь', plot: 'yes', slope: 'flat', term: 'now', cls: 'comfort', material: 'gas', name: 'Иван Петров', phone: '+7 912 345-67-80', time: 'после 18:00', note: 'Хотим сауну и гараж на 2 машины' }, mod: 'garage' },
    { a: { city: 'Краснокамск', plot: 'yes', slope: 'small', term: 'season', cls: 'comfort', material: 'gas', name: 'Ольга Смирнова', phone: '+7 902 111-22-33' }, mod: 'attic' },
    { a: { city: 'Пермский район, д. Кондратово', plot: 'search', slope: 'flat', term: 'year', cls: 'eco', material: 'brick', name: 'Алексей Кузнецов', phone: '+7 950 444-55-66', note: 'Пока выбираем участок' }, mod: 'eco' },
    { a: { city: 'Пермь, Голованово', plot: 'yes', slope: 'flat', term: 'now', cls: 'premium', material: 'gas', name: 'Марина Волкова', phone: '+7 919 777-88-99' }, mod: 'chamfer' },
  ];
  const ids = [];
  for (const x of L) {
    const id = await pg.evaluate(async (x) => {
      const p = JSON.parse(JSON.stringify(DK.appApi.project()));
      if (x.mod === 'attic') { p.attic = true; p.knee = 1200; }
      if (x.mod === 'chamfer') { const v = p.poly; if (v && v[1] && v[1].id) { p.chamfers = {}; p.chamfers[v[1].id] = 1500; } }
      const np = DK.normalize ? DK.normalize(p) || p : p;
      const A = DK.areas(np), et = DK.estimateText(np, x.a.cls);
      const plans = DK.floorsOf(np).map(f => DK._plan.toImage(f, { width: 760 }));
      const r = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.' + Math.floor(Math.random()*200) + '.1' }, body: JSON.stringify({ answers: x.a, brief: DK.brief(np), changes: [], notes: [], estimate: { area: A.total, from: Math.round(et.e.min / 1e5) / 10, to: Math.round(et.e.max / 1e5) / 10 }, project: np, images: { plans } }) });
      return (await r.json()).id;
    }, x);
    ids.push(id); await new Promise(r => setTimeout(r, 30));
  }
  console.log('leads', ids);
  const mk = (name, city, email, inn, cities, banks, escrow) => j('/api/company/register', { name, contact: 'Директор', inn, city, cities, banks, escrow, email, phone: '+7 342 200-' + Math.floor(10 + Math.random() * 89) + '-' + Math.floor(10 + Math.random() * 89), password: 'company123', materials: ['gas', 'brick'], site: '' });
  const c1 = await mk('СК «Уральский дом»', 'Пермь', 'info@uraldom.example', '5904000001', ['Пермь', 'Пермский край'], ['Сбербанк', 'ВТБ', 'Дом.РФ'], true);
  const c2 = await mk('ГазоБлок Строй', 'Пермь', 'zakaz@gazoblok.example', '5904000002', ['Пермь', 'Пермский район', 'Краснокамск'], ['Сбербанк'], false);
  const c3 = await mk('ООО «Прикамье Девелопмент»', 'Березники', 'office@prikamie.example', '5911000003', ['Березники', 'Соликамск'], [], false);
  const c4 = await mk('Екатеринбург Хаус', 'Екатеринбург', 'hello@ekbhouse.example', '6600000004', ['Екатеринбург'], ['Альфа-Банк', 'Газпромбанк'], true);
  const adm = await j('/api/crm/login', { email: 'demo@svoydom.ru', password: 'demo12345' });
  await j('/api/crm/staff', { name: 'Елена Сметова', email: 'smeta@svoydom.ru', password: 'demo12345', staffRole: 'estimator' }, adm.token);
  await j('/api/crm/staff', { name: 'Дмитрий Менеджеров', email: 'manager@svoydom.ru', password: 'demo12345', staffRole: 'manager' }, adm.token);
  await j('/api/crm/company/' + c1.user.companyId, { status: 'approved', rating: 4.8 }, adm.token);
  await j('/api/crm/company/' + c2.user.companyId, { status: 'approved', rating: 4.5 }, adm.token);
  await j('/api/crm/company/' + c4.user.companyId, { status: 'approved', rating: 4.2 }, adm.token);
  await j('/api/crm/staff', { name: 'Мария Контентова', email: 'marketing@svoydom.ru', password: 'demo12345', staffRole: 'marketer' }, adm.token);
  // лид 1 — горячий, разослан, два расчёта
  await j('/api/crm/lead/' + ids[0], { status: 'call', manager: 'Дмитрий Менеджеров', client: { email: 'petrov@mail.example', address: 'Пермь, ул. Сосновая, уч. 14', plotNo: '59:01:4410123:45', source: 'Конструктор на сайте' }, qual: { plot: true, now: true, cash: true, price: true, meet: true }, agreed: 9800000, note: 'Созвонились: участок 12 соток в собственности, деньги есть, предварительную цену 9,8 млн согласовал. Встреча в субботу в 11:00.' }, adm.token);
  const l0 = await j('/api/crm/lead/' + ids[0], null, adm.token);
  await j('/api/crm/lead/' + ids[0] + '/rfq', { companies: [c1.user.companyId, c2.user.companyId], message: 'Клиент горячий, просим расчёт до пятницы', tz: (l0.brief || []).slice(0, 12) }, adm.token);
  await j('/api/company/lead/' + ids[0] + '/bid', { rows: { found: 1350000, walls: 2700000, slabs: 1050000, roof: 1250000, windows: 820000, facade: 610000, ext: 950000, other: 420000 }, term: 7, comment: 'Монолитная плита, газобетон D500 400 мм, металлочерепица. Отмостка и вывоз мусора включены. Оплата поэтапно.' }, c1.token);
  await j('/api/company/lead/' + ids[0] + '/bid', { rows: { found: 1180000, walls: 2950000, slabs: 980000, roof: 1100000, windows: 760000, facade: 540000, ext: 1020000, other: 300000 }, term: 6, comment: 'Сваи + ростверк, газобетон 375 мм. Без отмостки.' }, c2.token);
  await j('/api/crm/lead/' + ids[0], { deal: [c1.user.companyId], shareWith: [c1.user.companyId], note: 'Клиент выбрал «Уральский дом»: аккредитация в Сбербанке, работают по эскроу.' }, adm.token);
  // проекты пользователей: сохранены через сайт с фильтром качества
  const users = [['Анна Соколова', 'anna@mail.example'], ['Пётр Иванов, архитектор', 'petr@arch.example'], ['Тест Тестов', 'test@spam.example']];
  const toks = []; for (const [n, e] of users) toks.push((await j('/api/auth/register', { name: n, email: e, phone: '+7 900 000-00-0' + toks.length, password: 'user12345' })).token);
  const projs = [[0, 'Дом 192 м² с сауной и гаражом', 'garage', 'published', 0], [1, 'Мансардный дом для семьи с детьми', 'attic', 'published', 1500], [1, 'Дом со срезанным углом гостиной', 'chamfer', 'private', 0], [2, 'тест 123', '', 'published', 0]];
  const pids = [];
  for (const [ui, title, mod, vis, price] of projs) {
    await pg.evaluate((t) => { localStorage.setItem('dk-token', t); }, toks[ui]);
    const r = await pg.evaluate(async ([title, mod, vis, price, tok]) => {
      const p = JSON.parse(JSON.stringify(DK.appApi.project())); delete p.cloudId;
      if (mod === 'attic') { p.attic = true; p.knee = 1200; }
      if (mod === 'chamfer') { p.chamfers = {}; p.chamfers[p.poly[1].id] = 1500; }
      DK.appApi.load(p); const q = DK.appApi.project(), A = DK.areas(q), imgs = await DK.appApi.images();
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ title, about: title === 'тест 123' ? 'аааа' : 'Удобная планировка: мокрые зоны друг над другом, котельная у наружной стены, кухня-гостиная на юг.', price, license: price ? 'build' : 'view', visibility: vis, project: q, images: imgs, area: Math.round(A.total * 10) / 10, floors: DK.floorsOf(q).length, size: `${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м` }) });
      return res.json();
    }, [title, mod, vis, price, toks[ui]]);
    pids.push(r.id);
  }
  await j('/api/crm/project/' + pids[1], { boost: true }, adm.token);
  await j('/api/crm/project/' + pids[3], { status: 'blocked', reason: 'Тестовый проект, не планировка дома' }, adm.token);
  await j('/api/projects/' + pids[0] + '/rate', { stars: 5 }, toks[1]); await j('/api/projects/' + pids[1] + '/rate', { stars: 5 }, toks[0]);
  // лид 2 — тёплый, разослан
  await j('/api/crm/lead/' + ids[1], { status: 'tz', manager: 'Дмитрий Менеджеров', qual: { plot: true, now: false, cash: true, price: false, meet: true }, note: 'Ипотека одобрена, хочет мансарду. Нужно уточнить уклон участка.' }, adm.token);
  await j('/api/crm/lead/' + ids[1] + '/rfq', { companies: [c1.user.companyId], message: '' }, adm.token);
  // лид 4 — премиум, встреча
  await j('/api/crm/lead/' + ids[3], { status: 'meeting', manager: 'Демо Администратор', qual: { plot: true, now: true, cash: true, price: false, meet: true }, note: 'Хочет панорамные окна и срезанный угол гостиной. Встреча в офисе во вторник.' }, adm.token);
  await j('/api/crm/lead/' + ids[2], { note: 'Перезвонить через месяц — ещё выбирают участок.' }, adm.token);
  // расчёт сметчика по лиду 1
  await pg.goto(B + '/crm.html'); await pg.fill('[name=email]', 'smeta@svoydom.ru'); await pg.fill('[name=password]', 'demo12345'); await pg.click('#loginForm button'); await pg.waitForTimeout(800);
  await pg.click(`tr[data-id="${ids[0]}"]`); await pg.waitForTimeout(600); await pg.click('.tabs [data-t="calc"]'); await pg.waitForTimeout(500);
  await pg.fill('tr[data-id^="window:"] input[data-f="m"]', '16000'); await pg.press('tr[data-id^="window:"] input[data-f="m"]', 'Tab'); await pg.waitForTimeout(300);
  await pg.click('#saveCalc'); await pg.waitForTimeout(600);
  console.log('done'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
