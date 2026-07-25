# Typography — ДИНАМИКА

| Role | Family | Source |
|---|---|---|
| Display (H1/H2, ALL-CAPS)       | Dinamika Display (custom) | `../../../DINAMIKA-extended.ttf` в корне репо |
| Body, UI, subheads, paragraphs  | Lato                      | Google Fonts |
| Technical eyebrows, specs, labels | JetBrains Mono          | Google Fonts |

## Правила

- Не хедлайн → Lato.
- Display: uppercase, tracking ~+2 для «дыхания», часто в 2–3 строки.
- Mono eyebrow-ы: uppercase + широкий трекинг.
- Высокий контраст размеров (огромный H1 + мелкий mono overline) — подпись стиля.

## Файлы в этой папке

- `fonts/` — сюда положить `.ttf/.otf/.woff2`, когда решим переносить
  `DINAMIKA-extended.*` из корня репо. Пока пайплайн читает шрифт напрямую
  из корня.
