// «Управляемая» сборка: ключ доступа к моделям предустановлен автором, а не
// вводится пользователем.
//
// На этапе тестирования это нужно, чтобы тестировщику не приходилось заводить
// свой аккаунт Polza, и чтобы расход шёл с одного баланса, который видно.
// Вместо поля с ключом в настройках показывается статистика: какие модели
// использованы за день/неделю/месяц и во сколько это обошлось.
//
// Честно про безопасность: ключ лежит внутри приложения на компьютере
// тестировщика. Скрытие поля в настройках — это про удобство и про то, чтобы
// ключ не утёк случайно (не скопировали, не показали на скриншоте), а не про
// стойкость: тот, кто умеет распаковывать установщик, ключ достанет. Поэтому
// для тестовой группы нужен ОТДЕЛЬНЫЙ ключ Polza с небольшим балансом, который
// не жалко отозвать, — это и есть настоящая защита.

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

function candidatePaths() {
  const paths = [path.join(__dirname, "..", "managed-config.json")];
  if (app?.isPackaged) {
    paths.unshift(path.join(process.resourcesPath, "managed-config.json"));
    paths.unshift(path.join(process.resourcesPath, "app", "managed-config.json"));
  }
  return paths;
}

/**
 * Returns null when the build is not managed — the ordinary case, where the
 * person enters their own key and everything behaves as before.
 */
function config() {
  for (const file of candidatePaths()) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.apiKey) return null;
      return {
        apiKey: String(parsed.apiKey),
        baseUrl: parsed.baseUrl ? String(parsed.baseUrl) : "",
        model: parsed.model ? String(parsed.model) : "",
        // Цены за 1 000 000 токенов. Модель без цены показывается с токенами, но
        // без суммы — придумывать стоимость нельзя.
        prices: parsed.prices && typeof parsed.prices === "object" ? parsed.prices : {},
        currency: parsed.currency ? String(parsed.currency) : "₽",
      };
    } catch (e) {
      console.error("managed-config.json не разобран:", e.message);
      return null;
    }
  }
  return null;
}

/**
 * Overlays the managed values onto saved settings. The key stays in the object
 * because the chat window makes the API calls itself; what changes is that the
 * interface hides it and offers usage figures instead.
 */
function apply(settings) {
  const managed = config();
  if (!managed) return { ...settings, managed: false };
  return {
    ...settings,
    apiKey: managed.apiKey,
    baseUrl: managed.baseUrl || settings.baseUrl,
    // Модель предустановлена только как начальная: выбор модели — часть базовой
    // функциональности, отбирать его у тестировщика не нужно.
    model: settings.model || managed.model || "",
    managed: true,
  };
}

function prices() {
  const managed = config();
  return { prices: managed?.prices || {}, currency: managed?.currency || "₽" };
}

module.exports = { config, apply, prices };
