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

  const url = settings.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
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
    }),
    signal,
  });

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
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }

  return full;
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
