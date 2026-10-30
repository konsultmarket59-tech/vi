# Логика Дома — Design System

**Логика Дома** («Logic of Home») is a technology platform for designing a house: choose a house project, configure it to your needs, and find verified contractors. Tagline: «Логика решений. Дом вашей мечты.» Positioning: «Технологичная платформа для выбора проектов, настройки и поиска проверенных подрядчиков.»

Single product surface: a **web platform** (desktop + mobile web) — catalog of house projects, project pages with configuration, contractor profiles. Secondary surfaces shown in the brand book: social covers, presentations, infographics, banners.

## Sources
- `uploads/ЛОГИКА ЛОГО ГОРИЗОНТ.svg|png`, `uploads/ЛОГИКА ЛОГО ВЕРТИКАЛЬНЫЙ.png` — logo files (→ `assets/`).
- Two brand-book boards (`uploads/magnific__…87075.png`, `…87076.png`, copied to `guidelines/source/brandbook-1.png`, `brandbook-2.png`): logo, colour system, grid & nodes, typography, graphic language, UI components, applications. Version 1.0, May 2024.
- `uploads/eskiznyj-proekt (1).pdf` — sample sketch project «Логика Дома» (12 A3 sheets, image-only; pages extracted to `guidelines/source/eskiz/`), `uploads/Мой-дом-ext (1).png`, `uploads/Мой-дом-f1-plan.png` — current site exports (→ `assets/images/site-*.png`).
- No codebase, Figma or production screens were provided. Components and the UI kit are reconstructed from the brand-book boards only.

## Index
- `styles.css` — entry point (imports only) → `tokens/fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`
- `fonts/` — Manrope + Inter woff2 (latin + cyrillic), self-hosted from Google Fonts
- `assets/` — `logo-horizontal.svg/png`, `logo-vertical.png`, `mark.png` (icon cropped from logo), `images/` (house photos, floor plans, architect portrait — cropped from the brand book, low-res)
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand) + `source/` brand book
- `components/` — React primitives (see below)
- `ui_kits/platform/` — click-through web platform (Home, Catalog, Project, Contractor)
- `guidelines/drawings-rules.md` — **rules for floor plans, sketch project (ЭП) and site screenshots**; cards in groups «Планировки», «Эскизный проект», «Скрины с сайта»; tokens `tokens/drawings.css`
- `SKILL.md` — agent skill entry

## Components
- **core/**: Icon, Button, IconButton
- **forms/**: Input, Select, Checkbox, Radio, RangeSlider
- **feedback/**: Badge, StatusDot, Rating
- **navigation/**: Header (+ Wordmark), Breadcrumbs, StepPath
- **cards/**: ProjectCard, ContractorCard
- **drawings/**: Explication, RoomTag, TitleBlock — for plans, ЭП sheets and screenshots

All defined by section 06 «UI компоненты» of the brand book (navigation, buttons, project cards, contractor cards, forms & filters, statuses & labels) and 05 «Линейный путь» (StepPath).

### Intentional additions
- **Icon** — wrapper over Lucide line icons (brand book shows thin line icons but supplies no set).

## CONTENT FUNDAMENTALS
- **Language:** Russian. Formal-polite **«вы»** («Технологии для вашего дома», «Найдите подрядчика»); the brand speaks as **«мы»** («Мы создаём инструменты, которые помогают…»).
- **Tone:** calm, precise, rational, trustworthy. Brand values: Логично · Точно · Прозрачно · Надёжно · Интеллектуально · Гибко · Человекоцентрично. No hype, no exclamation marks.
- **Headlines:** short imperative triplets with periods — «Выберите дом. Продумайте детали. Найдите подрядчика.», «Логика. Проекты. Подрядчики.» Sentence case for headings and buttons; ALL CAPS only for small section labels (e.g. «КАК ЭТО РАБОТАЕТ», value names).
- **Buttons:** verb-first, 1–3 words — «Выбрать проект», «Связаться», «Подробнее →», «Показать 125 проектов», «Подобрать проект».
- **Data:** concrete and tabular — «120 м² · 4 комнаты · 2 санузла», «от 4 250 000 ₽», «4.8 ★ 32 отзыва», «Опыт 12 лет». Prices always «от …₽» with space-grouped thousands.
- **Labels:** Популярный, Новинка, Акция, Премиум. Statuses: Черновик, На согласовании, В работе, Завершён. Trust markers: Проверен, Договор.
- **Emoji:** never.

## VISUAL FOUNDATIONS
- **Colour:** Logic Navy `#19317B` is the brand and primary action colour; White and Soft Background `#F5F6F8` are surfaces; Graphite `#242832` is text; Technical Gray `#D9DEE8` borders. Accent «узлы» — Cyan `#26C6C8` (interactive/links between things), Electric Blue `#2784EB` (active, links), Signal Orange `#F49A38` (secondary accents, data, stars), Signal Coral `#F05C78` (notifications, special markers), Cool Gray `#C7CDDA` (neutral/inactive). Accents appear as small dots, chips and highlights — never as large fills or gradients.
- **Type:** Manrope SemiBold/Bold for headings (geometric, technological), Inter Regular/Medium for body. Display 48–64, H1 36–48, H2 28–36, H3 22–28, H4 18–22, Body 16–18, Secondary 14, Caption 12, Buttons 14–16. Tabular numerals for prices/areas/dates. No extra tracking on Cyrillic. Max two families.
- **Grid & nodes (core motif):** a sparse thin-line square grid (8px base module) with coloured dots at intersections; connected nodes (thin cyan/gray lines between dots); floor plans with highlighted modules (cyan/coral tinted rooms with numbers 01/03); the linear path 01→05 (Идея → Проект → Настройка → Подрядчик → Дом); a feature matrix of dots. Use these as backgrounds on white or navy.
- **Lines:** основная связь = solid cyan; вторичная = dashed navy; вспомогательная = dashed gray; конструкция = hairline grid gray.
- **Backgrounds:** mostly white / soft gray. Hero = white→soft vertical fade over the node grid. Dark banners = solid navy with faint white grid + accent nodes. No photos as full-bleed hero texture except product imagery; no busy gradients.
- **Imagery:** realistic modern two-storey houses (gray/white façades with wood accents, dark roofs), daylight or warm dusk lighting, green lawns, cool blue skies; clean black-line floor plans on white. Portraits: friendly professionals, white background (architect in hard hat).
- **Corner radii:** precise and small — 4px badges/checkboxes, 6px buttons & inputs, 8px thumbnails, 12px cards, 16px banners/hero images. Circles only for nodes, avatars, step numbers.
- **Cards:** white, 1px Technical Gray border, 12px radius, very soft navy-tinted shadow; image on top (4:3), 16–20px padding. Hover: lift 2px + deeper shadow.
- **Shadows:** low, navy-tinted (`rgba(25,49,123,.06)`); borders carry structure, shadows only hint at elevation.
- **Buttons:** primary solid navy, secondary white with 1px navy outline, tertiary blue text link with arrow. Hover = darker navy / navy-50 tint; press = darker + scale .98. Disabled = flat gray. Loading = outlined with small blue spinner.
- **Focus:** blue border + 3px soft blue ring.
- **Active nav:** navy semibold + 2px cyan underline.
- **Animation:** restrained — 120–200ms ease-out fades/lifts; no bounces, no parallax.
- **Transparency/blur:** only white 92% circles over photos (favourite button). No glassmorphism.
- **Layout:** 1200px container, 72px sticky white header with bottom hairline; generous whitespace; 3-up card grids; sticky filter sidebar on catalog.
- **Logo rules:** don't distort, recolour, add effects, rotate, or recompose; clear space = height of «Д»; min 120px on screen, 16px favicon. On navy use white reverse.

## ICONOGRAPHY
- Brand book shows **thin, rounded line icons** (≈1.5px stroke, outline only): grid, crosshair, eye, shield-check, brain, nodes, user, house, plan, chevron, arrows, search, heart, share, download, map-pin.
- No icon files were provided → **substituted with Lucide** (CDN `lucide-static@0.460.0`, 2px stroke) via the `Icon` component (CSS mask, inherits colour). ⚠ Flagged substitution — Lucide is slightly heavier than the brand's line icons.
- Icons are navy or graphite; cyan for location/verified trust markers; never filled, never emoji. Unicode used only for ₽, м², →, ★ in copy.
- Logo mark `assets/mark.png` doubles as favicon/app icon.
