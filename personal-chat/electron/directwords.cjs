/**
 * Разбор поисковых запросов и площадок: что отминусовать и что отключить.
 *
 * Считается здесь, а не моделью, по той же причине, что и остальной разбор:
 * «отминусуй вот это слово» — решение, после которого часть трафика исчезает
 * навсегда, и оно должно опираться на сложенный по всем запросам расход, а не
 * на впечатление. Модель подключается поверх — объяснить и сформулировать.
 *
 * Важно, чего здесь НЕ делается: ничего не отключается само. Приложение
 * показывает список и цену вопроса, решение остаётся за человеком.
 */

const LIMITS = {
  /** Расход по слову, после которого это уже потеря, а не проверка гипотезы. */
  wasteCost: 500,
  /** Кликов по площадке меньше — это шум, а не вывод. */
  minPlacementClicks: 10,
  /** Расход по площадке без конверсий, после которого её стоит смотреть. */
  placementCost: 1000,
  /** Слова короче — предлоги и обрывки, минусовать их опасно. */
  minWordLength: 3,
};

/**
 * Слова, которые почти всегда означают не того человека.
 *
 * Список — подсказка, а не приговор: «отзывы» мусор для продажи и не мусор для
 * репутационной кампании. Поэтому такие слова помечаются, а не вычёркиваются.
 */
const JUNK_MARKERS = [
  "бесплатно",
  "бесплатный",
  "своими руками",
  "самому",
  "самостоятельно",
  "отзывы",
  "вакансии",
  "работа",
  "зарплата",
  "б/у",
  "бу",
  "аренда",
  "скачать",
  "фото",
  "чертеж",
  "чертёж",
  "форум",
  "авито",
  "своими",
  "реферат",
  "курсовая",
  "википедия",
  "что такое",
];

/** Служебные слова: минусовать их нельзя, они есть почти в каждом запросе. */
const STOP_WORDS = new Set([
  "и", "в", "во", "не", "на", "с", "со", "по", "для", "от", "до", "из", "за", "к", "у", "о", "об",
  "как", "или", "а", "но", "то", "же", "ли", "бы", "это", "под", "над", "при", "без",
]);

function num(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function words(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[^0-9a-zа-яё\s-]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= LIMITS.minWordLength && !STOP_WORDS.has(w));
}

/**
 * Кандидаты в минус-слова.
 *
 * Считается не по одному запросу, а по слову целиком: одно «бесплатно» может
 * быть размазано по тридцати запросам по сорок рублей, и поодиночке ни один из
 * них не выглядит проблемой. Именно поэтому расход складывается по слову.
 */
function minusCandidates(queries, limits = LIMITS) {
  const пороги = { ...LIMITS, ...limits };
  const пословно = new Map();

  for (const строка of queries || []) {
    const запрос = String(строка.Query || строка.query || "");
    const cost = num(строка.Cost);
    const clicks = num(строка.Clicks);
    const impressions = num(строка.Impressions);
    const conversions = num(строка.Conversions);
    for (const слово of new Set(words(запрос))) {
      const прежнее = пословно.get(слово) || {
        word: слово,
        cost: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        queries: [],
      };
      прежнее.cost += cost;
      прежнее.clicks += clicks;
      прежнее.impressions += impressions;
      прежнее.conversions += conversions;
      if (прежнее.queries.length < 8) прежнее.queries.push(запрос);
      пословно.set(слово, прежнее);
    }
  }

  const итог = [];
  for (const запись of пословно.values()) {
    // Слово с конверсиями не трогаем ни при каком расходе: оно приносит.
    if (запись.conversions > 0) continue;
    const помечено = JUNK_MARKERS.some((m) => запись.word === m || запись.word.startsWith(m));
    if (!помечено && запись.cost < пороги.wasteCost) continue;
    if (!помечено && запись.clicks < 3) continue;
    итог.push({
      ...запись,
      known: помечено,
      why: помечено
        ? `Слово «${запись.word}» почти всегда означает не покупателя. По нему ${запись.clicks} кликов на ${money(
            запись.cost
          )} ₽ и ни одной конверсии.`
        : `По слову «${запись.word}» набралось ${запись.clicks} кликов на ${money(
            запись.cost
          )} ₽ без единой конверсии.`,
      fix: `Добавьте «${запись.word}» в минус-слова на уровне кампании и проверьте, что оно не встречается в нужных запросах.`,
    });
  }
  return итог.sort((a, b) => b.cost - a.cost);
}

/** Запросы, по которым просто потратили и ничего не получили. */
function wastefulQueries(queries, limits = LIMITS) {
  const пороги = { ...LIMITS, ...limits };
  return (queries || [])
    .map((строка) => ({
      query: String(строка.Query || строка.query || ""),
      campaign: String(строка.CampaignName || ""),
      criterion: String(строка.Criterion || ""),
      cost: num(строка.Cost),
      clicks: num(строка.Clicks),
      conversions: num(строка.Conversions),
    }))
    .filter((r) => r.conversions === 0 && r.cost >= пороги.wasteCost)
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Площадки сети, на которые уходят деньги без отдачи.
 *
 * Отдельно помечаются мобильные приложения: клик там чаще всего случайный, и
 * это первое, что отключают, когда расход в сети не окупается.
 */
function badPlacements(rows, limits = LIMITS) {
  const пороги = { ...LIMITS, ...limits };
  return (rows || [])
    .map((строка) => {
      const name = String(строка.Placement || строка.placement || "");
      const clicks = num(строка.Clicks);
      const cost = num(строка.Cost);
      const conversions = num(строка.Conversions);
      const impressions = num(строка.Impressions);
      return {
        placement: name,
        campaign: String(строка.CampaignName || ""),
        network: String(строка.AdNetworkType || ""),
        impressions,
        clicks,
        cost,
        conversions,
        ctr: impressions ? (clicks / impressions) * 100 : null,
        // Приложения в отчёте выглядят как имя пакета, а не как сайт.
        app: /^[a-z]+(\.[a-z0-9_]+){2,}$/i.test(name) || /^id\d+$/i.test(name),
      };
    })
    .filter((r) => r.conversions === 0 && r.clicks >= пороги.minPlacementClicks && r.cost >= пороги.placementCost)
    .map((r) => ({
      ...r,
      why: r.app
        ? `Мобильное приложение: ${r.clicks} кликов на ${money(r.cost)} ₽ и ни одной конверсии. В приложениях клик чаще всего случайный.`
        : `Площадка ${r.placement}: ${r.clicks} кликов на ${money(r.cost)} ₽ без конверсий.`,
      fix: `Добавьте ${r.placement} в запрещённые площадки кампании. Если площадка крупная, сначала посмотрите её отдельно по неделям — она могла работать раньше.`,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/** Сколько денег стоит бездействие — одно число, ради которого всё считалось. */
function wasteTotal({ minus = [], placements = [] }) {
  const поСловам = minus.reduce((acc, m) => acc + m.cost, 0);
  const поПлощадкам = placements.reduce((acc, p) => acc + p.cost, 0);
  return { words: поСловам, placements: поПлощадкам };
}

function describe({ minus = [], queries = [], placements = [] }) {
  const части = [];
  const итог = wasteTotal({ minus, placements });
  if (!minus.length && !placements.length && !queries.length) {
    return "По этим данным лишних трат не видно. Это может значить и что их нет, и что данных пока мало.";
  }
  if (minus.length) {
    части.push(
      `Кандидаты в минус-слова (${minus.length}), всего ${money(итог.words)} ₽ без конверсий:\n` +
        minus
          .slice(0, 15)
          .map((m) => `  • ${m.word} — ${money(m.cost)} ₽, ${m.clicks} кликов. ${m.why}`)
          .join("\n")
    );
  }
  if (queries.length) {
    части.push(
      `Запросы с расходом без конверсий (${queries.length}):\n` +
        queries
          .slice(0, 15)
          .map((q) => `  • «${q.query}» — ${money(q.cost)} ₽, ${q.clicks} кликов (${q.campaign})`)
          .join("\n")
    );
  }
  if (placements.length) {
    части.push(
      `Площадки под отключение (${placements.length}), всего ${money(итог.placements)} ₽:\n` +
        placements
          .slice(0, 15)
          .map((p) => `  • ${p.placement} — ${money(p.cost)} ₽, ${p.clicks} кликов${p.app ? " (приложение)" : ""}`)
          .join("\n")
    );
  }
  части.push(
    "Ничего из этого приложение не отключает само: минус-слова и запрещённые площадки добавляются в Директе, и решение остаётся за вами."
  );
  return части.join("\n\n");
}

module.exports = {
  LIMITS,
  JUNK_MARKERS,
  words,
  minusCandidates,
  wastefulQueries,
  badPlacements,
  wasteTotal,
  describe,
};
