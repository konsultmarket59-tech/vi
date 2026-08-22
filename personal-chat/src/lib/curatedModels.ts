import type { ModelInfo } from "./api";

// A hand-picked shortlist that always shows up in the model pickers, even before
// (or if) the live GET /models fetch from Polza.ai completes. IDs follow Polza's
// own "provider/model-name" convention; if Polza renames or retires one, the API
// call will just return a clear error and it can be corrected here or typed in
// by hand — the field always accepts any ID, this list is just a shortcut.

export const CURATED_CHAT_MODELS: ModelInfo[] = [
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5 (Anthropic)" },
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5 (Anthropic)" },
  { id: "anthropic/claude-fable-5", name: "Claude Fable 5 (Anthropic)" },
  { id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite (Google)" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3 (MoonshotAI)" },
];

export const CURATED_IMAGE_MODELS: ModelInfo[] = [
  { id: "google/gemini-3.1-flash-lite-image", name: "Gemini 3.1 Flash-Lite Image (Google)" },
  { id: "google/gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image Preview (Google)" },
];

export const CURATED_VIDEO_MODELS: ModelInfo[] = [
  { id: "seedance-2-mini", name: "Seedance 2 Mini" },
  { id: "seedance-2", name: "Seedance 2" },
  { id: "kling/v3-motion-control", name: "Kling v3 Motion Control" },
  { id: "topaz/video-upscale", name: "Topaz Video Upscale" },
];

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
