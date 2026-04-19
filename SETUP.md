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
| `LLM_API_KEY` | Ключ Polza.ai (для рилзов) |
| `LLM_BASE_URL` | (опц.) `https://polza.ai/api/v1` |
| `LLM_MODEL` | (опц.) `anthropic/claude-sonnet-4.6` |
| `PEXELS_API_KEY` | Ключ с pexels.com/api (для рилзов, бесплатно) |
| `MAX_BOT_TOKEN` | Access token бота Max (см. ниже) |
| `MAX_CHAT_ID` | (опц.) chat_id. Если не задан — скрипт возьмёт из последних сообщений боту. |

---

## 3. Reels-автоматизация (маркетинговое агентство)

Каждый день в **09:00 по Москве** запускается `generate_reels.py`:
1. Claude (через Polza.ai) генерирует 5–6 хуков по триггерам аудитории (предприниматели 25–55, РФ).
2. Для каждого хука подбирается вертикальный люкс-ролик с Pexels.
3. FFmpeg собирает рилз 1080×1920, 12 сек, с наложением текста в палитре
   `#FE3268`, `#00D4FF`, `#2A2A2A`, soft white.
4. Готовые MP4 отправляются вам в чат с ботом в мессенджере **Max**.

**Шрифты.** В репозитории уже лежат бесплатные аналоги с кириллицей:
Bebas Neue (вместо Bebas Neue Pro) и Dancing Script (вместо Martina Script).
Чтобы подставить лицензионные оригиналы — положите в папку `fonts/`:
- `fonts/BebasNeuePro-Bold.ttf`
- `fonts/MartinaScript.ttf`

**Как получить `MAX_BOT_TOKEN`:**
1. В мессенджере Max найдите бота **@MasterBot** и откройте чат.
2. Команда `/create` → задайте имя и @username бота.
3. MasterBot пришлёт access token — длинная строка, скопируйте её в секрет `MAX_BOT_TOKEN`.
4. Откройте чат с вашим ботом и напишите `/start` — это создаст чат и позволит скрипту найти `chat_id` автоматически.
5. (Опционально) заранее зафиксируйте `MAX_CHAT_ID`: откройте `https://botapi.max.ru/updates?access_token=ВАШ_ТОКЕН`
   в браузере после того, как написали боту, и скопируйте значение `recipient.chat_id`.

**Ручной запуск.** `Actions → Reels — ежедневная генерация → Run workflow`.
