# Платная реалистичная визуализация: расчёты, реализация, промпты

Пользователь делает в конструкторе снимок дома (снаружи или интерьер) и за деньги получает фотореалистичный рендер.
Цена — около 50 ₽ за штуку. На сайте нет формы оплаты: оплата идёт на странице банка, а сайт только начисляет «визуализации» на баланс.

## 1. Экономика одной визуализации (ориентировочно)

| Статья | ₽ |
|---|---|
| Цена для пользователя | 50 |
| Генерация по API (по вашему опыту) | 4 |
| Запас на неудачные попытки и бесплатную перегенерацию (в среднем ×1,5) | +2 |
| Эквайринг банка ~3,5 % | 1,75 |
| Налог УСН 6 % (если ИП на УСН «доходы») | 3 |
| Хранение и трафик | < 0,1 |
| **Остаётся** | **≈ 39 (≈ 78 %)** |

Пакеты (оплачивать по одной штуке неудобно и дорого по комиссии):

- **Пробная** — 1 визуализация бесплатно после регистрации (обходится в 4–6 ₽, хорошо продаёт).
- **Старт** — 3 за 150 ₽.
- **Проект** — 10 за 450 ₽ (45 ₽ за штуку).
- **Профи** — 30 за 1 200 ₽ (40 ₽ за штуку), для архитекторов и строительных компаний.

Цены — настройка в CRM, их можно менять.

## 2. Алгоритм взаиморасчётов

Всё держится на **журнале операций** у каждого пользователя: баланс = сумма операций.
Деньги не хранятся на сайте — только «визуализации» (кредиты).

### Покупка

1. В кабинете пользователь выбирает пакет → сервер создаёт заказ: номер, пакет, сумма, статус «ожидает оплаты».
2. Сервер просит у платёжного сервиса ссылку на оплату и отправляет пользователя на страницу банка.
   Карта или СБП вводятся там, а не на нашем сайте.
3. Банк присылает на сайт уведомление об оплате (webhook) → сервер перепроверяет статус платежа в банке
   (не верим одному уведомлению) → если оплачен и ещё не зачислен — в журнал пишется «+10, покупка, платёж №…».
4. Повторное уведомление по тому же платежу ничего не начисляет: зачисление делается один раз по номеру платежа.
5. Пользователь возвращается на сайт и видит баланс; чек ему присылает платёжный сервис (54-ФЗ — на их стороне).

### Генерация

1. Кнопка «Реалистичная визуализация» в конструкторе (вкладки «Снаружи» и «Интерьер 3D»): снимок 3D уходит на сервер.
2. Сервер **резервирует** 1 визуализацию (−1, «резерв»). Если баланс 0 — предлагает купить пакет.
3. Сервер вызывает API генерации; ключ API хранится только на сервере, в браузер не попадает.
4. Успех → резерв подтверждается, картинка сохраняется в кабинете («Мои визуализации»).
   Ошибка или таймаут → резерв возвращается (+1, «возврат»), пользователь ничего не теряет.
5. «Не похоже на мой дом» — одна бесплатная перегенерация на каждую оплаченную.
6. Лимиты: не больше 3 генераций одновременно и 30 в час на пользователя — защита от ошибок и злоупотреблений.

### Учёт в CRM

- Баланс и журнал операций каждого пользователя, ручное начисление (компенсация, акция, подарок).
- Отчёт за период: оплаты, генерации, возвраты, себестоимость API, выручка.
- Промокоды на N визуализаций (для блогеров, партнёров, компаний).

### Возврат денег

Неизрасходованные визуализации возвращаются по заявке за вычетом использованных — пропишем в договоре услуг (`/dokumenty/dogovor-uslug/`).

## 3. Как принимать оплату без платёжной системы на сайте

**Рекомендую: платёжный сервис со страницей оплаты на его стороне и уведомлениями.**
На нашем сайте нет формы карты; банк сам выдаёт чеки по 54-ФЗ.

| Сервис | Кому подходит | Чеки 54-ФЗ | Комиссия |
|---|---|---|---|
| ЮKassa | ИП, ООО, самозанятые | «Чеки от ЮKassa» | ~2,8–3,5 % |
| Т-Банк (интернет-эквайринг) | ИП, ООО со счётом в Т-Банке | «Т-Касса» | ~2,5–3,5 % |
| Продамус | ИП, самозанятые; есть платёжные ссылки | да | ~3,5–5 % |
| Робокасса | ИП, ООО, самозанятые | «Робочеки» | ~3,5–4 % |

Комиссии — ориентир на осень 2026 года, точные условия — у банка.

**Самый быстрый старт без доработок — коды активации.**
CRM выпускает коды на 3/10/30 визуализаций, вы продаёте их по платёжной ссылке банка, а код уходит покупателю письмом.
Пользователь вводит код в кабинете — визуализации начисляются.
Минус: выдача кода руками или через рассылку банка. Хорошо для первого месяца; потом — автоматическое зачисление по уведомлению.

## 4. Что сделать на сайте (план работ)

1. Журнал операций, баланс и «Мои визуализации» в кабинете; промокоды и коды активации в CRM.
2. Кнопка «Реалистичная визуализация» в конструкторе с выбором «снаружи / интерьер», предпросмотр снимка и баланс.
3. Серверный модуль генерации: адрес API, ключ и модель — в настройках сервера (`.env`), можно сменить провайдера без переделки сайта.
4. Подключение выбранного платёжного сервиса: создание платежа, страница «Спасибо», приём уведомлений, перепроверка статуса.
5. Раздел в CRM «Визуализации»: баланс пользователей, начисления, отчёт.
6. Пункт в договоре услуг и в согласии на обработку данных (снимки проекта передаются сервису генерации).

## 5. Важно проверить до запуска

- **Условия сервиса генерации.** Разрешает ли «Польза» (или другой поставщик API) перепродавать генерации на своём сайте;
  есть ли у них API с договором и закрывающими документами для ИП/ООО.
- **Персональные данные.** Снимки дома — не персональные данные, но если сервер генерации за рубежом — указать это в согласии.
- **Модерация.** В промпте запрещены люди, надписи и логотипы; пользователь загружает только снимки из конструктора, чужие фото — нет.

## 6. Промпты

Короткие промпты модели выполняют точнее длинных: главное — сохранить дом и задать свет.
В запрос передаётся снимок из конструктора (исходник) и, по желанию, фото-референс настроения.

### Экстерьер — золотой час, контровой свет

```json
{
  "task": "photorealistic architectural visualization from a 3D massing render",
  "preserve_exactly": [
    "house shape, dimensions, number of floors, roof shape, pitch, color and material",
    "every window and door: position, size, frame color",
    "facade materials, colors, brick and siding pattern",
    "terraces, steps, railings, pool, paths and paving: geometry, width, direction",
    "camera position, lens, perspective, crop"
  ],
  "lighting": {
    "time": "golden hour, about 30 minutes before sunset",
    "sun": "low sun behind or side-behind the house and trees (backlight, contre-jour), partly hidden by foliage",
    "effect": "warm golden rim light on tree crowns, roof edges and railings; long soft shadows toward the camera; gentle haze in the air",
    "sky": "clear sky, warm gold near the horizon fading to soft blue above, a few thin natural clouds",
    "windows": "soft warm interior light 2700–3000 K, low intensity, not glowing",
    "glass": "realistic reflections of the sky and surrounding trees, interior still partly visible"
  },
  "environment": "mature deciduous trees with natural foliage, well-kept lawn, low shrubs and ornamental grasses, restrained planting that never covers the house or paths",
  "style": "professional real-estate architectural photography, natural contrast and saturation, crisp edges, photorealistic, not illustration",
  "forbidden": [
    "people, animals, cars",
    "any text, letters, numbers, signs, logos, watermarks",
    "changes to architecture, materials or colors of the house",
    "new windows, chimneys, extensions or balconies",
    "neon glow, overexposed windows, heavy HDR, orange cast over the whole image, lens flares, wet surfaces"
  ],
  "if_architecture_changed": "regenerate keeping the source geometry stricter"
}
```

### Интерьер — естественный свет

```json
{
  "task": "photorealistic interior visualization from a 3D room render",
  "preserve_exactly": [
    "room shape and dimensions, ceiling height",
    "windows, doors and openings: position and size",
    "furniture layout, sizes and placement as in the source",
    "camera position, lens, perspective, crop"
  ],
  "lighting": {
    "time": "late afternoon, golden hour",
    "sun": "low warm sunlight entering through the existing windows (backlight toward the camera where windows are in view), soft light beams, gentle bounce light",
    "artificial_light": "warm 2700–3000 K lamps on at low intensity",
    "exposure": "balanced, windows bright but not blown out, no crushed shadows"
  },
  "materials": "realistic wood, fabric, stone, tile and paint textures in the colors of the source; neutral whites",
  "styling": "tidy lived-in look: a few books, plants, textiles; no clutter",
  "style": "professional interior photography for real-estate listings, photorealistic, not illustration",
  "forbidden": [
    "people, pets",
    "any text, letters, numbers, posters with writing, logos, watermarks",
    "moving walls, windows, doors or furniture",
    "neon light, heavy HDR, oversaturated colors, lens flares"
  ]
}
```
