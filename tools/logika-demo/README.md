# Демо-просмотры «Логики Дома» (HTML-страницы без сервера)

Скрипты собирают одностраничные демо: сайт с конструктором и работающими кабинетами (заказчик, архитектор, компания)
и CRM со всеми ролями. Серверный код (`market.js`, `crm-api.js`, `credits.js`, `pages.js`) выполняется прямо в браузере
поверх вымышленных данных `demo-data.json`; правки живут до перезагрузки страницы.

```sh
OUT=/tmp/demo && mkdir -p $OUT && cp tools/logika-demo/* $OUT/
python3 $OUT/build-preview.py $OUT     # → $OUT/konstruktor-doma.html (сайт + кабинеты)
python3 $OUT/build-crm-demo.py $OUT    # → $OUT/crm-demo.html (CRM)
```

Скрипты ждут проект в `/home/user/vi/dom-konstruktor` (переменная `ROOT` в начале файлов) и Node.js для `render-pages.js`.
Ссылка на конкретный вход: в начало страницы добавляется `<script>window.__DEMO_AS='client'</script>`
(`client`, `arch`, `company`), для CRM — `window.__DEMO_AS_CRM='manager'` (`estimator`, `marketer`).

- `site-shim.js`, `demo-shim.js` — подмена `fetch('/api/…')` настоящими обработчиками сервера в браузере.
- `demo-bar.js` — панель переключения ролей в CRM; `demo-seed.js` — как были созданы демо-данные.
