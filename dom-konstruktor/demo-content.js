/* Демо-наполнение каталога: проекты, строительные компании и архитекторы с пометкой demo: true.
   Добавляется само при первом запуске сайта (выключить: DEMO_CONTENT=0), удаляется в CRM — по одной карточке или все сразу.
   Контактов у демо-компаний нет: «Связаться» ведёт в заявку на подбор, она приходит в CRM. */
'use strict';
const fs = require('fs'), path = require('path');

const ARCH = [
  { id: 'demo-a1', type: 'architect', name: 'Анна Белова', city: 'Пермь', since: 2012, about: 'Архитектор частных домов: планировки под семью, мансарды, дома на сложных участках. Доводит эскиз до рабочей документации.' },
  { id: 'demo-a2', type: 'bureau', name: 'Мастерская «Линия»', city: 'Екатеринбург', since: 2016, about: 'Архитектурное бюро: современные дома с плоской и вальмовой кровлей, разделы АР и КР, авторский надзор.' },
  { id: 'demo-a3', type: 'architect', name: 'Дмитрий Орлов', city: 'Пермь', since: 2009, about: 'Проектирую одноэтажные дома и дома с гаражом: экономичные конструкции, сметный расчёт под бюджет заказчика.' },
];
const BUILDERS = [
  { id: 'demo-c1', name: 'СК «Северный квартал»', city: 'Пермь', regions: ['Пермь', 'Пермский край'], materials: ['gas', 'brick'], classes: ['eco', 'comfort'], priceFrom: 33500, since: 2011, banks: ['Сбербанк', 'ВТБ', 'Дом.РФ'], escrow: true,
    about: 'Каменные дома из газобетона и кирпича под ключ: фундамент, стены, кровля, тёплый контур. Работаем по эскроу, аккредитованы в банках для ипотеки на ИЖС.' },
  { id: 'demo-c2', name: 'Тёплый контур', city: 'Пермский край', regions: ['Пермский край', 'Краснокамск', 'Добрянка'], materials: ['gas', 'ceramic'], classes: ['comfort', 'premium'], priceFrom: 41000, since: 2015, banks: ['Сбербанк', 'Альфа-Банк'], escrow: true,
    about: 'Энергоэффективные дома из газобетона и керамоблока: утепление, тёплые узлы, инженерные сети. Смета по техзаданию за 3 рабочих дня.' },
  { id: 'demo-c3', name: 'УралКаркас Строй', city: 'Екатеринбург', regions: ['Екатеринбург', 'Свердловская область'], materials: ['frame', 'timber'], classes: ['eco', 'comfort'], priceFrom: 29000, since: 2014, banks: ['Дом.РФ'], escrow: false,
    about: 'Каркасные дома и дома из клеёного бруса: быстрый монтаж, сухие материалы, готовый тёплый контур за 3–4 месяца.' },
  { id: 'demo-c4', name: 'СК «Прикамский дом»', city: 'Пермь', regions: ['Пермь', 'Пермский район', 'Кунгур'], materials: ['brick', 'monolith', 'gas'], classes: ['comfort', 'premium'], priceFrom: 45000, since: 2008, banks: ['Сбербанк', 'ВТБ', 'Газпромбанк', 'Т-Банк'], escrow: true,
    about: 'Кирпичные и монолитные дома для больших семей, дома с гаражом и цокольным этажом. Собственная бригада, гарантия на конструктив 10 лет.' },
];

module.exports = function demo(ctx) {
  const { readJSON, writeJSON, DATA, ROOT } = ctx;
  const USERS = path.join(DATA, 'users.json'), COMP = path.join(DATA, 'companies.json'), PROJ = path.join(DATA, 'projects'), STATE = path.join(DATA, 'demo-state.json');
  const SRC = path.join(ROOT, 'demo');
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();

  function seed() {
    const comps = readJSON(COMP, []).filter(c => !c.demo), users = readJSON(USERS, []).filter(u => !u.demo);
    BUILDERS.forEach((c, i) => comps.push(Object.assign({ type: 'builder', status: 'approved', demo: true, at: day(40 - i * 5), cities: c.regions, phone: '', email: '', site: '', rating: null, reviews: 0 }, c)));
    ARCH.forEach((a, i) => {
      comps.push(Object.assign({ status: 'approved', demo: true, at: day(35 - i * 6), regions: [a.city], materials: [], classes: [], phone: '', email: '', site: '', rating: null, reviews: 0 }, a));
      // автор проектов: учётная запись без возможности входа
      users.push({ id: a.id, demo: true, role: 'architect', archStatus: 'verified', name: a.name, email: a.id + '@demo.invalid', phone: '', city: a.city, about: a.about, salt: 'x', pass: 'x', at: day(35 - i * 6) });
    });
    writeJSON(COMP, comps); writeJSON(USERS, users);
    let n = 0;
    const list = readJSON(path.join(SRC, 'projects.json'), []);
    list.forEach((x, i) => {
      const dir = path.join(PROJ, x.id); fs.mkdirSync(dir, { recursive: true });
      x.files.forEach(f => { try { fs.copyFileSync(path.join(SRC, 'img', x.id, f), path.join(dir, f)); } catch (e) { /* нет картинки */ } });
      writeJSON(path.join(dir, 'project.json'), { id: x.id, demo: true, owner: 'demo-' + x.author, title: x.title, about: x.about, price: x.price, license: x.license, area: x.area, floors: x.floors, size: x.size,
        project: x.project, files: x.files, status: 'published', votes: {}, requests: [], at: day(30 - i * 3), updatedAt: day(30 - i * 3), quality: { score: x.quality.score, errs: x.quality.errs, warns: x.quality.warns } });
      n++;
    });
    writeJSON(STATE, { seeded: new Date().toISOString() });
    return counts();
  }
  function purge() {
    writeJSON(COMP, readJSON(COMP, []).filter(c => !c.demo));
    writeJSON(USERS, readJSON(USERS, []).filter(u => !u.demo));
    let n = 0;
    try { fs.readdirSync(PROJ).forEach(id => { const pr = readJSON(path.join(PROJ, id, 'project.json'), null); if (pr && pr.demo) { fs.rmSync(path.join(PROJ, id), { recursive: true, force: true }); n++; } }); } catch (e) { /* нет папки */ }
    writeJSON(STATE, { purged: new Date().toISOString() });
    return counts();
  }
  function counts() {
    const comps = readJSON(COMP, []).filter(c => c.demo);
    let projects = 0; try { fs.readdirSync(PROJ).forEach(id => { const pr = readJSON(path.join(PROJ, id, 'project.json'), null); if (pr && pr.demo) projects++; }); } catch (e) { /* нет папки */ }
    return { projects, builders: comps.filter(c => c.type === 'builder').length, architects: comps.filter(c => c.type !== 'builder').length, state: readJSON(STATE, {}) };
  }
  // первый запуск: наполняем, если демо ещё ни разу не добавляли и не удаляли
  function auto() { if (process.env.DEMO_CONTENT === '0' || fs.existsSync(STATE) || !fs.existsSync(path.join(SRC, 'projects.json'))) return; try { seed(); } catch (e) { console.error('demo seed', e); } }
  return { seed, purge, counts, auto };
};
