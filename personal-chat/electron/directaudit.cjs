/**
 * Разбор рекламных кампаний: где слабое место и что с ним делать.
 *
 * Зачем считать это кодом, а не спрашивать у модели. Модель хорошо объясняет и
 * плохо считает: попросив её «найти слабые места», получаешь правдоподобный
 * текст, в котором цифры взяты примерно. А решения здесь денежные — отключить
 * кампанию, снизить ставку, — и ошибка в числе стоит настоящих денег.
 *
 * Поэтому арифметика живёт здесь: пороги, доли, CPA считаются по настоящим
 * данным и всегда одинаково. Модель подключается уже поверх — объяснить,
 * расставить приоритеты, предложить формулировки. Каждая находка несёт с собой
 * ЧИСЛА, по которым её сделали: вывод, который нельзя проверить, не стоит
 * доверия, а перепроверять за приложением человек не обязан.
 */

/**
 * Пороги разбора.
 *
 * Цифры не выдуманные «на глаз», но и не универсальные: в разных нишах норма
 * разная. Поэтому они вынесены в одно место и передаются снаружи — чтобы их
 * можно было подкрутить под свою нишу, а не спорить с приложением.
 */
const LIMITS = {
  /** CTR в поиске ниже этого — объявление не отвечает запросу. */
  lowCtr: 3,
  /** Показов меньше — статистика ещё ничего не значит. */
  minImpressions: 300,
  /** Кликов меньше — про конверсии говорить рано. */
  minClicks: 30,
  /** Расход без единой конверсии, после которого это уже трата, а не проверка. */
  wasteCost: 3000,
  /** Доля расхода одной кампании, после которой она решает судьбу всего аккаунта. */
  concentration: 0.5,
  /** Во сколько раз CPA кампании может превышать средний по аккаунту. */
  cpaFactor: 2,
};

function num(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/**
 * Свести статистику по кампаниям в один список с посчитанными показателями.
 *
 * Статистика приходит строками отчёта, кампании — отдельным списком; без
 * сведения нельзя сказать ни «эта кампания выключена, но тратила», ни «эта
 * работает, но не показывается».
 */
function merge(campaigns, stats) {
  const byId = new Map();
  for (const c of campaigns || []) {
    byId.set(String(c.id), {
      id: c.id,
      name: c.name,
      type: c.type || "",
      state: c.state || "",
      status: c.status || "",
      statusPayment: c.statusPayment || "",
      dailyBudget: num(c.dailyBudget),
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      ctr: 0,
      avgCpc: 0,
      hasStats: false,
    });
  }
  for (const row of stats || []) {
    const id = String(row.CampaignId ?? "");
    const item = byId.get(id) || {
      id: row.CampaignId,
      name: row.CampaignName || `#${id}`,
      type: "",
      state: "",
      status: "",
      statusPayment: "",
      dailyBudget: 0,
    };
    item.impressions = num(row.Impressions);
    item.clicks = num(row.Clicks);
    item.cost = num(row.Cost);
    item.conversions = num(row.Conversions);
    item.ctr = num(row.Ctr);
    item.avgCpc = num(row.AvgCpc);
    item.hasStats = true;
    byId.set(id, item);
  }
  return [...byId.values()];
}

/** Итоги по аккаунту: то, от чего считаются доли и средние. */
function totalsOf(rows) {
  const t = rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      cost: acc.cost + r.cost,
      conversions: acc.conversions + r.conversions,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
  );
  return {
    ...t,
    ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
    avgCpc: t.clicks ? t.cost / t.clicks : 0,
    cpa: t.conversions ? t.cost / t.conversions : 0,
  };
}

/**
 * Найти слабые места.
 *
 * Каждая находка — это `{ уровень, что, почему, что делать }`, и «почему»
 * всегда содержит числа. Уровень нужен, чтобы человек начинал с денег, а не с
 * мелочей: «деньги уходят впустую» и «кампания на паузе, а бюджет размечен» —
 * разного веса вещи.
 */
function findIssues({ campaigns = [], stats = [], keywords = [], balance = null, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const rows = merge(campaigns, stats);
  const totals = totalsOf(rows);
  const issues = [];

  const add = (level, what, why, fix) => issues.push({ level, what, why, fix });

  // --- деньги ---
  if (balance && balance.amount <= 0) {
    add(
      "высокий",
      "На счёте нет денег",
      `Баланс ${money(balance.amount)} ${balance.currency}${balance.debt ? `, долг ${money(balance.debt)}` : ""}.`,
      "Пополните счёт — при нулевом балансе показы останавливаются целиком, независимо от настроек кампаний."
    );
  } else if (balance && totals.cost > 0) {
    // Дней хватит по среднему расходу за период, а не по «обычному»: обычного
    // не существует, а средний считается из тех же цифр, что уже есть.
    const perDay = totals.cost / 30;
    const daysLeft = perDay > 0 ? balance.amount / perDay : Infinity;
    if (daysLeft < 7) {
      add(
        "высокий",
        "Денег осталось меньше чем на неделю",
        `Баланс ${money(balance.amount)} ${balance.currency}, расход около ${money(perDay)} в день — хватит примерно на ${daysLeft.toFixed(1)} дн.`,
        "Пополните счёт заранее: остановка показов на середине недели сбивает обучение автостратегий."
      );
    }
  }

  for (const r of rows) {
    const share = totals.cost ? r.cost / totals.cost : 0;

    // Расход без конверсий — самая дорогая из ошибок.
    if (r.cost >= L.wasteCost && r.conversions === 0 && r.clicks >= L.minClicks) {
      add(
        "высокий",
        `«${r.name}»: расход без единой конверсии`,
        `Потрачено ${money(r.cost)}, кликов ${r.clicks}, конверсий 0.`,
        "Проверьте, передаются ли цели в Метрику: чаще всего дело в этом, а не в кампании. Если цели идут — " +
          "остановите кампанию и разберите запросы: платить за клики без заявок дальше незачем."
      );
    }

    // CPA заметно выше среднего — деньги есть, но эта кампания дороже прочих.
    if (r.conversions > 0 && totals.cpa > 0) {
      const cpa = r.cost / r.conversions;
      if (cpa > totals.cpa * L.cpaFactor && r.cost >= L.wasteCost) {
        add(
          "средний",
          `«${r.name}»: заявка дороже средней по аккаунту`,
          `CPA ${money(cpa)} против ${money(totals.cpa)} в среднем — в ${(cpa / totals.cpa).toFixed(1)} раза.`,
          "Снизьте ставки или переведите кампанию на оплату за конверсии с целевым CPA на уровне среднего."
        );
      }
    }

    // Низкий CTR в поиске — объявление не отвечает запросу.
    if (r.impressions >= L.minImpressions && r.ctr > 0 && r.ctr < L.lowCtr && /TEXT|SEARCH/i.test(r.type || "")) {
      add(
        "средний",
        `«${r.name}»: низкий CTR`,
        `CTR ${r.ctr.toFixed(2)}% при ${r.impressions} показах.`,
        "Объявление не отвечает запросу: добавьте ключевую фразу в заголовок, уточните текст и выкиньте " +
          "нецелевые запросы минус-словами. Низкий CTR ещё и поднимает цену клика."
      );
    }

    // Показов нет вовсе, хотя кампания включена.
    if (r.state === "ON" && r.hasStats && r.impressions === 0) {
      add(
        "средний",
        `«${r.name}»: включена, но не показывается`,
        `Кампания #${r.id}: за период 0 показов при расходе ${money(r.cost)}.`,
        "Смотрите статус модерации, ставки и охват: включённая кампания без показов обычно упирается в " +
          "отклонённые объявления, слишком низкую ставку или узкий таргетинг."
      );
    }

    // Одна кампания решает судьбу всего аккаунта.
    if (share > L.concentration && rows.length > 2) {
      add(
        "низкий",
        `«${r.name}»: на неё приходится ${(share * 100).toFixed(0)}% расхода`,
        `${money(r.cost)} из ${money(totals.cost)} по аккаунту.`,
        "Это не ошибка, но риск: любое изменение в одной кампании двигает весь результат. " +
          "Стоит проверить, не задавила ли она остальные по бюджету."
      );
    }

    // Проблема с оплатой видна в статусе — её легко не заметить.
    if (r.statusPayment && r.statusPayment !== "ALLOWED" && r.state === "ON") {
      add(
        "высокий",
        `«${r.name}»: показы запрещены по оплате`,
        `Кампания #${r.id}: статус оплаты ${r.statusPayment} при включённом состоянии.`,
        "Кампания включена, но показываться не будет. Проверьте счёт и способ оплаты."
      );
    }
  }

  // --- фразы ---
  const активные = (keywords || []).filter((k) => k.state === "ON");
  const дубли = new Map();
  for (const k of активные) {
    const ключ = String(k.keyword || "").trim().toLowerCase();
    if (!ключ) continue;
    дубли.set(ключ, (дубли.get(ключ) || 0) + 1);
  }
  const повторы = [...дубли.entries()].filter(([, n]) => n > 1);
  if (повторы.length) {
    add(
      "средний",
      "Одинаковые фразы в разных группах",
      `Повторяется фраз: ${повторы.length}. Например: ${повторы.slice(0, 3).map(([k]) => `«${k}»`).join(", ")}.`,
      "Одинаковые фразы конкурируют между собой за один и тот же показ и поднимают цену клика. " +
        "Оставьте фразу в одной группе, из остальных уберите."
    );
  }
  const безСтавки = активные.filter((k) => !k.bid);
  if (безСтавки.length) {
    add(
      "низкий",
      "Фразы без своей ставки",
      `Таких фраз ${безСтавки.length} из ${активные.length}.`,
      "Они идут по ставке группы. Если фраза важная или дорогая — задайте ставку отдельно."
    );
  }

  // --- аккаунт целиком ---
  if (rows.length && rows.every((r) => r.state !== "ON")) {
    add("высокий", "Ни одной работающей кампании", `Кампаний ${rows.length}, все на паузе или остановлены.`,
      "Если это не сделано намеренно — включите нужные: сейчас аккаунт не показывается вовсе.");
  }
  if (totals.clicks < L.minClicks && totals.impressions > 0) {
    add(
      "низкий",
      "Данных мало — выводы пока ненадёжны",
      `За период ${totals.impressions} показов и ${totals.clicks} кликов.`,
      "Возьмите период подлиннее: на таких числах разница между кампаниями — это шум, а не результат."
    );
  }

  const вес = { высокий: 0, средний: 1, низкий: 2 };
  issues.sort((a, b) => вес[a.level] - вес[b.level]);
  return { issues, totals, rows };
}

/** Текстом — для отчёта и для агента. */
function describe({ issues, totals }) {
  const parts = [
    `Итого за период: показов ${totals.impressions}, кликов ${totals.clicks}, ` +
      `CTR ${totals.ctr.toFixed(2)}%, расход ${money(totals.cost)}, конверсий ${totals.conversions}` +
      (totals.cpa ? `, цена конверсии ${money(totals.cpa)}` : ""),
    "",
  ];
  if (!issues.length) {
    parts.push("Слабых мест по этим данным не нашлось.");
    return parts.join("\n");
  }
  for (const i of issues) {
    parts.push(`[${i.level}] ${i.what}\n  Почему: ${i.why}\n  Что делать: ${i.fix}`);
  }
  return parts.join("\n");
}

module.exports = { LIMITS, merge, totalsOf, findIssues, describe };
