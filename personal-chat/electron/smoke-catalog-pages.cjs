// Страницы домов: микроразметка, содержимое в коде, формы Тильды, размеры.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-catalog-pages.cjs
//
// Данные здесь выдуманные, но той же формы, что настоящая выгрузка: посёлок,
// улица, кадастровый номер, описание со списками. Настоящие адреса и цены в
// тестах не нужны и в репозитории им не место.
//
// Главное, что здесь проверяется, — что разметка описывает ровно то, что видно
// на странице. Расхождение между разметкой и текстом (цена, наличие) — самая
// частая причина, по которой поисковик молча перестаёт учитывать разметку, и
// поймать это можно только сверив одно с другим.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const pages = require("./catalogpage.cjs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "catpage-ud-"));
app.setPath("userData", userData);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const ОПИСАНИЕ =
  "<p><strong>Дом под ключ с участком.</strong></p>" +
  "<ul><li><strong>Облицовка.</strong> кирпич</li><li><strong>Отделка.</strong> под ключ</li></ul>" +
  "<p><strong>Конструктив</strong></p><ul><li><strong>Фундамент.</strong> монолитная лента</li></ul>" +
  "<p><strong>Комплектации и цены</strong></p><ul><li><strong>Тёплый контур — 4 200 000 ₽ без отделки.</strong> Окна и двери установлены.</li></ul>" +
  "<p><strong>Условия покупки</strong></p><ul><li><strong>Ипотека.</strong> семейная и сельская</li></ul>";

const ДОМ = {
  Title: "Ромашково, Сосновая улица, 12",
  SKU: "59:00:0000000:001",
  "External ID": "house-001",
  Mark: "готов",
  Description: "Готовый дом с отделкой.",
  Text: ОПИСАНИЕ,
  Photo: "https://static.example.ru/a.jpg https://static.example.ru/b.jpg",
  Price: "8500000.00",
  "Characteristics:площадь дома": "120",
  "Characteristics:Площадь участка": "8.5",
  "SEO title": "Дом 120 м² — Ромашково | 8 500 000 ₽",
  "SEO descr": "Купить дом 120 м² в посёлке Ромашково.",
};

const СТРОЙКА = { ...ДОМ, SKU: "59:00:0000000:002", "External ID": "house-002", Mark: "стройка", Title: "Ромашково, Сосновая улица, 14" };
const УЧАСТОК = {
  Title: "Ромашково, Сосновая улица, 16",
  SKU: "59:00:0000000:003",
  "External ID": "plot-003",
  Mark: "",
  Text: "",
  Photo: "",
  Price: "1200000.00",
  "Characteristics:площадь дома": "",
  "Characteristics:Площадь участка": "10",
};

const НАСТРОЙКИ = {
  site: "https://example.ru",
  pageUrl: "https://example.ru/house/{id}",
  organization: "Тестовая компания",
  phone: "+7 000 000 00 00",
  region: "Пермский край",
  bookingPopup: "#popup:zapis",
  mortgage: { rate: 6, termYears: 30, downPercent: 20 },
};

app.whenReady().then(async () => {
  try {
    const шаблон = await pages.readTemplate();

    console.log("описание каталога разбирается на разделы");
    const дом = pages.houseFromRow(ДОМ);
    check("посёлок и адрес разделены", дом.village === "Ромашково" && дом.address === "Сосновая улица, 12", дом.address);
    check("вступление найдено", дом.intro.lead === "Дом под ключ с участком.", дом.intro.lead);
    check("пункты вступления разобраны на ключ и значение",
      дом.intro.items.length === 2 && дом.intro.items[0].k === "Облицовка", JSON.stringify(дом.intro.items[0]));
    check("раздел «Конструктив» отделён", дом.sections.length === 1 && дом.sections[0].title === "Конструктив");
    check("условия покупки отделены", дом.terms.length === 1);
    // Готовый дом продаётся в конкретном виде: предлагать выбор комплектаций
    // значит обещать то, чего уже не будет.
    check("у готового дома комплектаций нет", дом.packages.length === 0);
    check("у строящегося комплектации остаются", pages.houseFromRow(СТРОЙКА).packages.length === 1);

    console.log("\nмикроразметка описывает то, что видно на странице");
    const { html } = pages.renderPage(дом, НАСТРОЙКИ, шаблон);
    const блок = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    check("разметка есть в коде страницы", !!блок);
    let ld = null;
    try {
      ld = JSON.parse(блок[1]);
    } catch (e) {
      check("разметка — валидный JSON", false, e.message);
    }
    if (ld) {
      check("разметка — валидный JSON", true);
      const product = ld["@graph"].find((n) => n["@type"] === "Product");
      const жильё = ld["@graph"].find((n) => n["@type"] === "SingleFamilyResidence");
      const крошки = ld["@graph"].find((n) => n["@type"] === "BreadcrumbList");
      check("контекст schema.org", ld["@context"] === "https://schema.org");
      check("есть товар с ценой и валютой",
        product && product.offers.price === "8500000" && product.offers.priceCurrency === "RUB",
        JSON.stringify(product && product.offers));
      // Цена в разметке и цена на странице — одно и то же число. Расхождение
      // между ними поисковик считает обманом и перестаёт доверять разметке.
      check("цена в разметке совпадает с ценой на странице",
        html.includes("8 500 000 ₽") || html.includes("8 500 000 ₽"));
      check("кадастровый номер — артикул", product.sku === "59:00:0000000:001");
      check("фото каталога попали в разметку", product.image.length === 2, JSON.stringify(product.image));
      check("площадь и готовность вынесены свойствами",
        product.additionalProperty.some((x) => x.name === "Площадь дома" && x.value === "120") &&
          product.additionalProperty.some((x) => x.name === "Готовность"));
      check("адрес дома разобран по полям",
        жильё.address.addressLocality === "Ромашково" && жильё.address.streetAddress === "Сосновая улица, 12",
        JSON.stringify(жильё.address));
      check("хлебные крошки собраны", крошки && крошки.itemListElement.length === 3);
      // Отзывов на странице дома не показывают. Размеченный рейтинг, которого
      // человек не видит, — прямой способ лишить доверия разметку всего сайта.
      check("выдуманных отзывов и рейтинга нет",
        !/AggregateRating|"Review"|ratingValue/.test(блок[1]));
      check("название товара без цены — она живёт в предложении",
        !/₽/.test(product.name), product.name);
    }

    console.log("\nналичие соответствует готовности дома");
    check("готовый дом — в наличии", pages.availabilityOf("готов").endsWith("InStock"));
    check("строящийся — предзаказ, а не «в наличии»", pages.availabilityOf("стройка").endsWith("PreOrder"));
    const стройкаLd = pages.jsonLd(pages.houseFromRow(СТРОЙКА), НАСТРОЙКИ);
    check("и это доезжает до разметки",
      стройкаLd["@graph"][0].offers.availability.endsWith("PreOrder"));

    console.log("\nтекст страницы есть в коде, а не только в скрипте");
    // Робот Яндекса выполняет скрипты не всегда: страница, которую рисует
    // только браузер, выглядит для него пустой.
    const разметкаБезСкриптов = html.slice(0, html.indexOf("<script>"));
    check("заголовок дома в коде", /id="nzhTitle">Дом 120 м²</.test(разметкаБезСкриптов));
    check("адрес в коде", /Ромашково · Сосновая улица, 12/.test(разметкаБезСкриптов));
    check("цена в коде", /id="nzhPrice">8/.test(разметкаБезСкриптов));
    check("характеристики в коде", /Кадастровый номер/.test(разметкаБезСкриптов));
    check("описание в коде", /Дом под ключ с участком/.test(разметкаБезСкриптов));
    check("фото настоящими картинками с подписями",
      (разметкаБезСкриптов.match(/<img loading="lazy"/g) || []).length === 2 &&
        /alt="Ромашково, Сосновая улица, 12, фото 1"/.test(разметкаБезСкриптов));

    console.log("\nформы и настройки Тильды на месте");
    check("кнопки записи ведут в попап Тильды", html.includes('bookingPopup: "#popup:zapis"'));
    check("телефон подставлен", html.includes('phone: "+7 000 000 00 00"'));
    check("ставка ипотеки подставлена", /mortgage: \{ rate: 6, termYears: 30, downPercent: 20 \}/.test(html));
    check("в коде не осталось незаполненных мест", !/__[A-Z_]+__/.test(html));

    console.log("\nчего нет в данных — того нет и в разметке");
    const безСайта = pages.jsonLd(дом, { organization: "", site: "", pageUrl: "" });
    check("без адреса сайта ссылки не выдумываются",
      !JSON.stringify(безСайта).includes("http") || !безСайта["@graph"][0].url,
      JSON.stringify(безСайта["@graph"][0].url));
    check("без адреса сайта нет и хлебных крошек",
      !безСайта["@graph"].some((n) => n["@type"] === "BreadcrumbList"));
    check("без названия компании нет продавца", !безСайта["@graph"][0].offers.seller);
    const замечания = pages.checkHouse(дом, { site: "", pageUrl: "", organization: "" });
    check("и про это сказано человеку",
      замечания.some((p) => /адрес страниц/.test(p)) && замечания.some((p) => /название компании/.test(p)),
      замечания.join(" | "));

    console.log("\nстраница открывается и работает в браузере");
    // Содержимое стоит в коде и его же рисует скрипт. Если скрипт не очистит
    // то, что уже нарисовано, галерея удвоится — человек увидит каждое фото
    // дважды. Проверяется это только настоящим запуском страницы.
    const окно = new BrowserWindow({ show: false, width: 1200, height: 900 });
    const ошибки = [];
    окно.webContents.on("console-message", (событие) => {
      const текст = String(событие?.message ?? "");
      // Предупреждение самого Electron про политику безопасности относится к
      // тестовому окну, а не к странице: в Тильде такой страницы не будет.
      if (событие?.level === "error" && !/Electron Security Warning/.test(текст)) ошибки.push(текст);
    });
    await окно.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 800));
    const вид = await окно.webContents.executeJavaScript(`({
      фото: document.querySelectorAll("#nzhGallery .nzh-g").length,
      заголовок: document.getElementById("nzhTitle").textContent,
      цена: document.getElementById("nzhPrice").textContent,
      характеристик: document.querySelectorAll("#nzhSpecs div").length,
      разметка: document.querySelectorAll('script[type="application/ld+json"]').length
    })`);
    check("фото не удвоились после отрисовки", вид.фото === 2, вид.фото);
    check("заголовок на месте", вид.заголовок === "Дом 120 м²", вид.заголовок);
    check("цена на месте", /8/.test(вид.цена), вид.цена);
    check("характеристики на месте", вид.характеристик >= 5, вид.характеристик);
    check("блок разметки ровно один", вид.разметка === 1, вид.разметка);
    check("скрипт страницы не ругается", ошибки.length === 0, ошибки.join(" | "));
    окно.destroy();

    console.log("\nсборка по всему каталогу");
    const собрано = pages.buildPages([ДОМ, СТРОЙКА, УЧАСТОК], НАСТРОЙКИ, шаблон);
    check("участок страницы дома не получает", собрано.pages.length === 2, собрано.pages.length);
    check("имена файлов по External ID",
      собрано.pages.map((p) => p.file).join(",") === "house-001.html,house-002.html",
      собрано.pages.map((p) => p.file).join(","));

    const дубль = pages.buildPages([ДОМ, { ...СТРОЙКА, "External ID": "house-001" }], НАСТРОЙКИ, шаблон);
    check("одинаковые имена файлов разводятся, а не затирают друг друга",
      дубль.pages[1].file === "house-001-2.html", дубль.pages[1].file);
    check("и об этом сказано", дубль.problems.some((p) => /одинаковое имя файла/.test(p)));

    console.log("\nкод помещается в ячейку таблицы");
    const целиком = pages.buildPages([ДОМ], НАСТРОЙКИ, шаблон);
    check("страница целиком в ячейку не влезает — и об этом сказано",
      !целиком.pages[0].fits && целиком.problems.some((p) => /общий стиль отдельно/.test(p)),
      целиком.pages[0].bytes);
    const раздельно = pages.buildPages([ДОМ], { ...НАСТРОЙКИ, sharedStyles: true }, шаблон);
    check("с общим стилем отдельно — влезает",
      раздельно.pages[0].fits && раздельно.pages[0].bytes < pages.CELL_LIMIT, раздельно.pages[0].bytes);
    check("общий стиль вынимается из страницы", !раздельно.pages[0].html.includes("<style>"));
    check("и он не пустой", pages.sharedStyles(шаблон).length > 5000);

    const таблица = pages.pagesTable(раздельно.pages);
    check("в таблице адрес и код рядом",
      таблица[0]["Адрес"] === "Ромашково, Сосновая улица, 12" && таблица[0]["Код HTML"].includes("<div class=\"nzh\""),
      Object.keys(таблица[0]).join(", "));
    const длинная = pages.pagesTable(целиком.pages);
    check("длинный код в ячейку не суют — в ней имя файла",
      /см\. файл house-001\.html/.test(длинная[0]["Код HTML"]), длинная[0]["Код HTML"].slice(0, 80));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(userData, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
