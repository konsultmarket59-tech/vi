import type { Settings } from "./types";

/**
 * OpenAI-compatible multimodal content. A plain string is the ordinary text case;
 * the array form is what carries attached images alongside the text, and is only
 * understood by vision-capable models.
 */
export type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string | ApiContentPart[];
}

export class ApiError extends Error {}

/**
 * Ключ уходит в HTTP-заголовок, а заголовки не принимают ничего, кроме latin-1.
 * Ключ с кириллицей (обычно — случайно скопированный лишний символ) иначе даёт
 * невнятное «String contains non ISO-8859-1 code point» из глубины fetch.
 */
function checkKey(apiKey: string): void {
  // eslint-disable-next-line no-control-regex
  if (/[^\u0000-\u00ff]/.test(apiKey)) {
    throw new ApiError(
      "В API-ключе есть символы, недопустимые для заголовка запроса (например, кириллица). " +
        "Скопируйте ключ заново — вероятно, в него попал лишний символ."
    );
  }
}

// Помнит на время сеанса, принимает ли шлюз stream_options.include_usage.
// undefined — ещё не пробовали, false — не принимает, пересылать не нужно.
let usageFieldWorks: boolean | undefined;

/**
 * Streams a chat completion from an OpenAI-compatible endpoint (Polza.ai and
 * most LLM aggregators use this exact wire format for /chat/completions).
 */
export async function streamChat(
  settings: Settings,
  messages: ApiMessage[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (!settings.apiKey) {
    throw new ApiError("Не задан API-ключ. Откройте настройки и вставьте ключ Polza.ai.");
  }
  if (!settings.model) {
    throw new ApiError("Не задана модель в настройках.");
  }
  checkKey(settings.apiKey);

  const url = settings.baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const send = (withUsage: boolean) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: true,
        // Просим сервис прислать реальный расход токенов. Поле нестандартное для
        // части шлюзов, поэтому при отказе повторяем запрос без него и считаем
        // расход оценкой — см. askedForUsage ниже.
        ...(withUsage ? { stream_options: { include_usage: true } } : {}),
      }),
      signal,
    });

  let res = await send(usageFieldWorks !== false);
  if (!res.ok && res.status === 400 && usageFieldWorks !== false) {
    // Шлюз не понял stream_options — запомним и больше не будем его слать.
    usageFieldWorks = false;
    res = await send(false);
  }

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      `Ошибка API (${res.status} ${res.statusText}). ${detail.slice(0, 500)}`
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let reportedUsage: ReportedUsage | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
        if (parsed?.usage) reportedUsage = parsed.usage;
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }

  recordUsage(settings, messages, full, reportedUsage);
  return full;
}

interface ReportedUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Записывает расход. Точный — если сервис прислал usage; иначе оценка по длине
 * текста, явно помеченная как оценка. Ошибка учёта не должна ронять ответ,
 * который человек уже видит на экране, поэтому всё внутри catch.
 */
function recordUsage(
  settings: Settings,
  messages: ApiMessage[],
  answer: string,
  reported: ReportedUsage | null
): void {
  try {
    const textOf = (content: ApiMessage["content"]): string =>
      typeof content === "string"
        ? content
        : content.map((part) => (part.type === "text" ? part.text : "")).join(" ");
    const exact = Boolean(reported?.prompt_tokens || reported?.completion_tokens);
    void window.api?.recordUsage({
      model: settings.model,
      promptTokens: exact
        ? reported?.prompt_tokens
        : Math.ceil(messages.map((m) => textOf(m.content)).join("\n").length / 3),
      completionTokens: exact ? reported?.completion_tokens : Math.ceil(answer.length / 3),
      exact,
      source: "чат",
    });
  } catch {
    // учёт — вспомогательная вещь, из-за неё ничего ломаться не должно
  }
}

export interface ModelInfo {
  id: string;
  name: string;
}

/**
 * Lists models available on the configured OpenAI-compatible endpoint. For
 * Polza.ai this is the full catalog (GET /models needs no auth there), not a
 * per-account "activated" list — the point is to make every model you can
 * use easy to find and paste in, not to restrict the model field to a fixed
 * set.
 */
export async function listModels(baseUrl: string, apiKey: string, type?: string): Promise<ModelInfo[]> {
  checkKey(apiKey);
  const url = baseUrl.replace(/\/+$/, "") + "/models" + (type ? `?type=${encodeURIComponent(type)}` : "");
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(`Не удалось получить список моделей (${res.status} ${res.statusText}).`);
  }
  const body = await res.json();
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return list
    .map((m: { id?: string; name?: string }) => ({ id: m.id ?? "", name: m.name ?? m.id ?? "" }))
    .filter((m: ModelInfo) => m.id);
}
