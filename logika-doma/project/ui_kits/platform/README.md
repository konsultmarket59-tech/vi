# Платформа «Логика Дома» — UI kit
Web platform recreation based on the brand book mockups (sections 06–07: «Главная страница», «Страница проекта», «Страница подрядчика»). No production code was supplied, so layouts follow the brand-book thumbnails; details not visible there are composed from the system's components.

Screens (click-through in `index.html`, route persisted in localStorage):
- **Home** — hero with grid/node pattern, quick filter bar, 5-step path, popular projects, contractors, navy CTA banner.
- **Catalog** — sticky filter sidebar (Select, RangeSlider, Radio, Checkbox) + project grid; price filter is live.
- **Project page** — gallery with plan thumbnails, spec tiles, configurator with live price, contractor list.
- **Contractor page** — profile header, stats (95 / 14 лет / 320+), tabs: О компании / Проекты / Отзывы.

Files: `Shared.jsx` (container, grid pattern, footer), `Home.jsx`, `Catalog.jsx`, `ProjectPage.jsx`, `ContractorPage.jsx`, `data.js`.