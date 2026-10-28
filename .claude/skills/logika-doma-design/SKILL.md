---
name: logika-doma-design
description: Use this skill to generate well-branded interfaces and assets for Логика Дома (Logika Doma) — the house-project and contractor platform — for production code or throwaway prototypes, plus floor plans, sketch-project (ЭП) sheets and site screenshots. Contains colors, type, fonts, spacing, logo rules, components, UI kit screens and drawing rules.
user-invocable: true
---

Read `logika-doma/DESIGN_SYSTEM.md` first: it is the full specification (in Russian) with every token value, component spec, screen layout and drawing rule. Machine-readable tokens are in `logika-doma/tokens.json`.

Source files live in `logika-doma/project/` (paths below are relative to `logika-doma/`):
- `project/styles.css` → `project/tokens/*.css` (CSS custom properties), `project/fonts/` (Manrope + Inter).
- `project/assets/` — real logos (`logo-horizontal.svg`, `logo-vertical.png`, `mark.png`) and imagery. Never redraw the logo.
- `project/components/<group>/<Name>.jsx|.d.ts|.prompt.md` — React primitives; `project/_ds_bundle.js` exposes them as `window.DesignSystem_94a3e6`.
- `project/ui_kits/platform/` — reference screens (Home, Catalog, ProjectPage, ContractorPage).
- `project/guidelines/drawings-rules.md` — rules for floor plans, ЭП and site screenshots.

Hard rules: Russian copy on «вы», no emoji, no exclamation marks; Navy `#19317B` for brand/primary actions; accents (Cyan, Blue, Orange, Coral, Cool Gray) only as dots, chips and thin lines; Manrope for headings and numbers, Inter for text; tabular numerals, prices «от 4 250 000 ₽»; small radii (4/6/8/12/16); navy-tinted soft shadows; grid-and-nodes motif.

For visual artifacts (mocks, slides, prototypes), copy assets and write static HTML that links `project/styles.css`. For production code, port tokens and components and follow the exact numbers in `DESIGN_SYSTEM.md`.
If invoked without guidance, ask the user what they want to build, then act as an expert designer for this brand.
