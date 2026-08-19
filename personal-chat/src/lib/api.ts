import type { Settings } from "./types";

export interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
