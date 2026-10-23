/* Стартовый каталог. Новые компании и архитекторы приходят через форму регистрации (server.js → data/runtime/companies.json)
   и появляются после проверки. Сюда — только проверенные записи. */
window.DK = window.DK || {};
DK.CATALOG_SEED = [
  {
    id: 'individom', type: 'builder', name: 'СК «ИндивиДом»', city: 'Пермь', regions: ['Пермь', 'Пермский край'],
    address: 'г. Пермь, ул. Связистов, 24', phone: '+7 (342) 204-24-40', email: 'info@sk-individom.ru', site: 'https://sk-individom.ru',
    since: 1992, materials: ['gas', 'brick'], classes: ['eco', 'comfort', 'premium'], priceFrom: 32160,
    about: 'Каменные энергоэффективные дома полного цикла: проект (BIM, 3D, АР, КР за 45 дней), фундамент, стены «под кровлю», тёплый контур, инженерные сети. Строят круглый год.',
    rating: null, reviews: 0, verified: true,
  },
];
