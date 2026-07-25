# ДИНАМИКА — Design System

Reconstructed from the brand brief. This document is the source of truth for
the motion-design pipeline: it defines colors, typography, graphic language,
photo treatment and voice used when the automation turns a raw talking-head
video into a branded motion infographic.

## Positioning

**ДИНАМИКА** — modern branding & SMM agency. Full-service: branding, SMM,
content marketing, content funnels, social-media strategy, content
production, personal branding, digital marketing and visual communications.

Positioning line — «Контент, которым работают. Брендинг, который запоминают.»
Content people act on. Branding people remember.

The system communicates: creativity, strategic thinking, modern marketing,
content that sells, intelligence, speed, visibility, influence, audience
growth, brand recognition.

Visual style — **50/50 blend of clean minimalism and modern pop-art energy**.
Think Pentagram × Spotify Design × contemporary editorial.
NOT childish comic, NOT retro-vintage pop-art, NOT chaotic.
Bold, clean, memorable, graphic, systematic, high-energy, premium.

---

## Content fundamentals

- **Language:** Russian (Cyrillic). Display copy — custom typeface, uppercase.
- **Tone:** confident, punchy, results-oriented. Short declarative statements
  that read like a manifesto. Brand sells outcomes (заявки, охваты,
  узнаваемость, рост), never features.
- **Address:** informal «ты» with the audience, «мы» for the agency.
  Direct, peer-to-peer, never corporate-stiff.
- **Casing:** display headlines ALL-CAPS. Body/subheads sentence case.
  Mono eyebrows uppercase with wide tracking.
- **Punctuation as energy:** a single accent-colored period or arrow closes
  a statement («БРЕНДИНГ**.**», «Получить аудит →»). Em-dashes structure
  thoughts. Hyphen-bracket framing («⌐ … ⌐») wraps callouts.
- **Emoji:** none. The «pop» comes from graphic marks (sparks, starbursts,
  marker highlights, arrows, scribbles).

**Example copy:**
- «Контент, который работает!»
- «Если клиент не листает — ты не продаёшь.»
- «5 шагов контент-стратегии»
- «Рост охватов +247%»
- «Подписывайся, чтобы клиенты приходили сами»

---

## Visual foundations

### Colors

Two pop accents over a neutral base.

| Role         | HEX        | Token             | Usage |
|---|---|---|---|
| Neon Pink    | `#FF2F6D`  | `--din-pink`      | Primary CTA / energy |
| Electric Cyan| `#00D9FF`  | `--din-cyan`      | Secondary spark / highlight |
| Ink          | `#0A0A0A`  | `--din-ink`       | Type & graphic blocks (structure) |
| White        | `#FFFFFF`  | `--din-white`     | Air, surfaces |
| Gray-50      | `#F4F5F7`  | `--din-gray-50`   | Neutral surface |
| Gray-200     | `#DDE3E8`  | `--din-gray-200`  | Hairline borders, dividers |

**Rule:** strict 70% neutral surface / 30% accent balance — accents
punctuate, never flood. Pink primary, cyan secondary. Machine-readable
version → `colors/palette.json`.

**Gradient (signature for motion covers):** duotone pink → purple → cyan.

### Typography

| Role | Family | File |
|---|---|---|
| Display (H1/H2, ALL-CAPS)       | **Dinamika Display** (custom) | `typography/fonts/DINAMIKA-extended.*` |
| Body, UI, subheads, paragraphs  | **Lato** (humanist sans)      | Google Fonts |
| Technical eyebrows, specs, labels | **JetBrains Mono**          | Google Fonts |

**Rules of thumb:**
- If it's not a big punchy headline — it's Lato.
- Display type opens tracking slightly (~+2) for breathing room.
- Oversized statements often span 2–3 lines.
- High-contrast sizing (huge display H1 next to small mono overline) is a
  signature.

The primary display face `DINAMIKA-extended.ttf/.woff/.woff2` already lives
in the repo root — it will be symlinked / copied into
`typography/fonts/` when the pipeline is wired up.

### Spacing (8px modular grid)

```
--space-2: 8px   --space-3: 16px   --space-4: 24px
--space-5: 32px  --space-6: 48px   --space-7: 64px   --space-8: 96px
```

Generous white space around dense graphic blocks — layout breathes even
when type is loud.

### Backgrounds

Mostly flat monochrome — white, gray-50, or full black.
Accent-colored solid blocks behind headlines (pink block / cyan underline).
Optional halftone dot patterns and the duotone gradient for hero / cover
moments. No photographic texture on UI surfaces; imagery lives inside
frames and device mockups.

### Radii & shadows

- Cards: `--radius-md` (12px) or `lg` (20px).
- Graphic statement blocks: square (`radius-none`).
- CTAs: pill (`radius-pill`).
- Cards = white surface + soft neutral shadow (`--shadow-sm/md`) +
  optional 1px `#DDE3E8` border. «Ink» cards invert to black with white type.
- Colored glow shadows (`--shadow-pink`, `--shadow-cyan`) — reserved for
  hover on accent CTAs and floating spark marks.

### Borders

- Hairline `1px #DDE3E8` — dividers/cards.
- `2px #0A0A0A` «ink» border — graphic emphasis and incorrect-usage diagrams.

### Motion

Confident and snappy — `--ease-out` for entrances, `--ease-in-out` for
moves. Kinetic typography (words snap/slide in), content reveals, carousel
slides, funnel fills. **No playful bounce** on UI; energy comes from speed
and pop accents. Respect `prefers-reduced-motion`.

- **Hover:** accent CTAs lift with colored glow + `translateY(-2px)`;
  ghost buttons fill with tint.
- **Press:** scale 0.97, deepen to `--din-pink-600` / `--din-cyan-600`.
- **Focus:** 2px cyan ring.

---

## Logo system

Two lockups — **never combined**.

1. **Horizontal wordmark «ДИНАМИКА»** pairs with the spark / star only.
   No other mark sits beside the word. Use color version on light surfaces,
   inverted (white) on black.
2. **Circular marks** — badge with star + words (`avatar-circle`), and the
   star-only circle. Standalone only — never placed next to a separate
   «динамика» wordmark (that would double the name).

Files (once uploaded to `assets/logos/`):
- `avatar-circle.png` — round badge with mark
- `wordmark-color.svg` — horizontal color lockup
- `wordmark-inverted.svg` — horizontal white-on-black

---

## Graphic language

- Starburst «spark» marks (pink & cyan) — the brand's signature glyph
- Halftone dot fields
- Bold typographic arrows (↗ →) — accent color, inside running copy
- Circles, speech bubbles
- Marker-style highlights (color swipe behind text)
- Hand-drawn scribble loops (used sparingly)
- Editorial underlines
- Dynamic angled frames
- Abstract motion lines

Modern & premium — **never comic-book**.

**RETIRED:** hand-drawn marker arrows. Too rough for the brand.
Directional cues are typographic only: the word «листай» in carousel
footers, or a `→` / `↗` glyph inside running copy.

---

## Photo treatment (signature)

People are rendered **black-and-white**; energy comes from bright brand
graphics AROUND them (pop blocks, halftone, sparks).

Three working recipes:

1. **Рамка** — B&W photo inside a black graphic block over a pop-art
   halftone field. No cutout needed.
2. **Дуотон** — `filter: grayscale(1)` + a pink layer at
   `mix-blend-mode: multiply`. Dramatic, no cutout.
3. **Вырез** — subject floats on the graphic. Needs a clean cutout
   (even/contrasting backdrop, or pre-cut transparent PNG). Auto-removing
   a busy background leaves rough edges — frame it (recipe 1 or 2) instead.

Imagery vibe: real photography of creators, phones, dashboards, workshops
— bright, modern, slightly cool. Often masked into device frames or
angled editorial crops. Pop accents and sparks overlay the imagery.

---

## Iconography

No bespoke icon font. Line icons, ~1.75px stroke, rounded joins — matched
to **Lucide** (`https://unpkg.com/lucide@latest`).

- Spark / starburst is the brand's signature glyph — **not** a generic icon.
  Use PNG marks in `assets/graphics/` for hero spark, list bullets,
  accent moments.
- Functional UI icons (heart, comment, share, chart, check, arrow,
  settings) → Lucide.
- Chunky `↗` / `→` glyphs at accent color are fine inside running copy /
  CTAs.
- **No emoji, ever.** No unicode pictographs as UI icons except the
  directional arrows used decoratively in display copy.

---

## What the motion pipeline uses

When automation renders a video, it pulls from this system:

| Pipeline step | Reads from |
|---|---|
| Circle avatar mask around face | `assets/logos/avatar-circle.png` — matches the brand's circular badge style |
| Background for infographic layer | Flat white / gray-50 / ink, optional duotone gradient (pink→purple→cyan) for cover frames |
| Infographic node colors | `colors/palette.json` — pink primary, cyan secondary, ink for structure |
| Step titles (ALL-CAPS) | Dinamika Display, tracking +2 |
| Step body / sublabels | Lato |
| Tech eyebrows («ШАГ 01», «REEL», «CASE») | JetBrains Mono, uppercase, wide tracking |
| Spark decoration next to key numbers | `assets/graphics/spark-pink.png`, `spark-cyan.png` |
| Directional cue between infographic steps | Typographic `→` in accent color (no drawn arrows) |
| Optional watermark | `assets/logos/avatar-circle.png` bottom-right |

---

## Physical assets still to add

The brand doc is loaded. To finish wiring the pipeline, drop these files
into `design-system/` (any of the three transports from earlier — chat,
Yandex.Disk link, or reduced ZIP):

- [ ] `assets/logos/avatar-circle.png` — round badge
- [ ] `assets/logos/wordmark-color.svg` (or PNG)
- [ ] `assets/logos/wordmark-inverted.svg` (or PNG)
- [ ] `assets/graphics/spark-pink.png`
- [ ] `assets/graphics/spark-cyan.png`
- [ ] `assets/graphics/halftone-tile.png` — for background pattern (optional)
- [ ] `assets/graphics/hero-banner.png` (optional)
- [ ] `assets/backgrounds/gradient-duotone.png` — pink→purple→cyan
  (optional — pipeline can generate on the fly if missing)

`DINAMIKA-extended.ttf/.woff/.woff2` — уже в корне репо, скрипт
подхватит оттуда.

Reference screenshots from the brand doc (color card, radii/shadows,
process flow, reel covers, service card) — при желании перезалей в
`../reference-frames/` для быстрого визуального сравнения.
