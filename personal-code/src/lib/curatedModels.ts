import type { ModelInfo } from "./types";

/**
 * Короткий список моделей, который виден в выборе всегда — ещё до того, как
 * ответит живой каталог Polza.ai (а если ключ не введён, он и не ответит).
 *
 * Тот же список, что в «Личном чате»: одни и те же имена в двух приложениях.
 * Поле принимает любой идентификатор, так что список — это подсказка, а не
 * ограничение: переименовали модель на стороне Polza — можно вписать руками.
 */
export const CURATED_MODELS: ModelInfo[] = [
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5 — самая сильная, для сложных правок" },
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5 — быстрее и дешевле, по умолчанию" },
  { id: "anthropic/claude-fable-5", name: "Claude Fable 5 (Anthropic)" },
  { id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite — дешёвая, для мелочей" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3 (MoonshotAI)" },
];

/** Живой каталог поверх короткого списка, без повторов и с сохранением порядка. */
export function mergeModelLists(curated: ModelInfo[], fetched: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const merged: ModelInfo[] = [];
  for (const m of [...curated, ...fetched]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    merged.push(m);
  }
  return merged;
}
