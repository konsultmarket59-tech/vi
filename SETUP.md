# Болдино LIFE — автоматизация постов

Каждое утро в **10:00 по Москве** GitHub Actions запускает скрипт, который:
1. Берёт первую невыполненную задачу из Google Sheets
2. Пишет пост с помощью Claude (ВК / Telegram / Блог)
3. Сохраняет готовый пост в Google Doc в вашей папке Drive
4. Ставит галочку ✓ в контент-плане и вставляет ссылку на документ

---

## 1. Структура контент-плана (Google Sheets)

Первая строка — заголовки:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Дата | Тема | Платформа | Бриф | Тон | Статус | Ссылка |

- **Дата** — формат `YYYY-MM-DD`, например `2026-04-20`
- **Платформа** — любая комбинация: `ВК`, `TG`, `Блог` (через запятую)
- **Статус** и **Ссылка** — оставьте пустыми, скрипт заполнит сам

---

## 2. GitHub Secrets

`Settings → Secrets and variables → Actions → New repository secret`

| Имя | Значение |
|---|---|
| `ANTHROPIC_API_KEY` | Ключ с console.anthropic.com |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Весь JSON сервисного аккаунта |
| `GOOGLE_SHEET_ID` | `1cT_62X_MF03pj9v2xIJNoKwC6hGpoMKdpjmxEBgYnL4` |
| `GOOGLE_DRIVE_FOLDER_ID` | ID папки из Drive |
| `PEXELS_API_KEY` | Ключ с pexels.com/api (для рилзов, бесплатно) |
| `GOOGLE_DRIVE_REELS_FOLDER_ID` | ID папки для рилзов |
| `GOOGLE_SERVICE_ACCOUNT_JSON_REELS` | (опц.) отдельный сервисный аккаунт для рилзов. Если не задан — используется `GOOGLE_SERVICE_ACCOUNT_JSON`. |

---

## 3. Reels-автоматизация (маркетинговое агентство)

Каждый день в **09:00 по Москве** запускается `generate_reels.py`:
1. Claude генерирует 5–6 хуков по триггерам аудитории (предприниматели 25–55, РФ).
2. Для каждого хука подбирается вертикальный люкс-ролик с Pexels.
3. FFmpeg собирает рилз 1080×1920, 12 сек, с наложением текста в палитре
   `#FE3268`, `#00D4FF`, `#2A2A2A`, soft white.
4. Готовые MP4 заливаются в папку Drive.

**Шрифты.** По умолчанию workflow подтягивает бесплатные аналоги с поддержкой кириллицы:
Bebas Neue (вместо Bebas Neue Pro) и Dancing Script Bold (вместо Martina Script).
Чтобы использовать лицензионные оригиналы — положите файлы в папку `fonts/`:
- `fonts/BebasNeuePro-Bold.ttf`
- `fonts/MartinaScript.ttf`

**Доступ к папке Drive.** Добавьте e-mail сервисного аккаунта (из
`GOOGLE_SERVICE_ACCOUNT_JSON`, поле `client_email`) как редактора к папке
рилзов, иначе загрузка упадёт.

**Ручной запуск.** `Actions → Reels — ежедневная генерация → Run workflow`.
