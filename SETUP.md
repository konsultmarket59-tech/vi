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
