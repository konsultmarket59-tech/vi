import { useEffect, useState } from "react";
import type { MontageBg, MontageClip, MontageLayer } from "../lib/types";
import { bgKey, bgPreviewKey, fileName } from "../lib/montage";
import { Field, Section, Slider, type EditorCtx } from "./MontageControls";

const DEFAULT_BG: MontageBg = { enabled: true, model: "person", quality: "good", replace: "blur", color: "#00B140", image: "", soft: 0.5, cache: null };

/**
 * Удаление фона нейросетью: у слоя фон становится прозрачным (человек поверх
 * другого видео), у главного видео — меняется на размытие, цвет или картинку.
 * Маска считается один раз и хранится на диске; при экспорте — из кэша.
 */
export function BgSection({ ctx, item, which }: { ctx: EditorCtx; item: MontageClip | MontageLayer; which: "clip" | "layer" }) {
  const b = item.bgRemove;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress?: number } | null>(null);
  const patch = (bg: MontageBg | null) =>
    ctx.commit((p) =>
      which === "clip" ? { ...p, clips: p.clips.map((c) => (c.id === item.id ? { ...c, bgRemove: bg } : c)) } : { ...p, layers: p.layers.map((l) => (l.id === item.id ? { ...l, bgRemove: bg } : l)) }
    );
  useEffect(() => window.api.onMontageBg((d) => d.id === item.id && setProgress(d)), [item.id]);

  const run = async (bg: MontageBg) => {
    setBusy(true);
    setProgress({ stage: "model", progress: 0 });
    try {
      const r = await window.api.montageBgPrepare({ ...item, bgRemove: bg }, which);
      patch({ ...bg, cache: { key: r.key, mask: r.mask, preview: r.preview, pkey: bgPreviewKey(bg) } });
      ctx.notify("Фон удалён. В кадре — готовый результат; в сборку маска пойдёт из кэша.");
    } catch (e) {
      if (!/останов/i.test(String(e))) ctx.fail(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Сменились только вид замены (цвет, картинка, мягкость) — маска та же,
  // пересобирается лишь предпросмотр, за секунды.
  const stalePreview = !!(b && b.cache && b.cache.key === bgKey(item) && b.cache.pkey !== bgPreviewKey(b));
  useEffect(() => {
    if (stalePreview && b && !busy) void run(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stalePreview]);

  const ready = !!(b && b.cache && b.cache.key === bgKey(item));
  const set = (p: Partial<MontageBg>) => b && patch({ ...b, ...p });
  const stageName = (s: string) => (s === "download" ? "скачиваю модель (один раз)" : s === "model" ? "загружаю модель" : s === "mask" ? "нейросеть отделяет объект" : s === "preview" ? "готовлю предпросмотр" : "");
  return (
    <Section title="Удалить фон (ИИ)" open={!!b}>
      {!b ? (
        <>
          <p className="mt-hint">Нейросеть отделит человека или предмет от фона — без хромакея. {which === "layer" ? "Фон слоя станет прозрачным: человек поверх другого видео." : "Фон главного видео заменится на размытие, цвет или картинку."}</p>
          <button className="btn btn-primary btn-block" onClick={() => { const bg = { ...DEFAULT_BG, replace: which === "layer" ? ("transparent" as const) : ("blur" as const) }; patch(bg); void run(bg); }}>
            ✂ Удалить фон
          </button>
        </>
      ) : (
        <>
          <Field label="Что оставить">
            <select value={b.model} onChange={(e) => set({ model: e.target.value as MontageBg["model"] })}>
              <option value="person">Человека (быстро, MODNet)</option>
              <option value="object">Любой объект (точнее, медленнее, BiRefNet)</option>
            </select>
          </Field>
          <Field label="Качество маски">
            <select value={b.quality} onChange={(e) => set({ quality: e.target.value as MontageBg["quality"] })}>
              <option value="fast">Быстро</option>
              <option value="good">Хорошо</option>
              <option value="best">Лучше (медленно)</option>
            </select>
          </Field>
          {which === "clip" && (
            <Field label="Вместо фона">
              <select value={b.replace} onChange={(e) => set({ replace: e.target.value as MontageBg["replace"] })}>
                <option value="blur">Размытие</option>
                <option value="color">Цвет</option>
                <option value="image">Картинка</option>
              </select>
            </Field>
          )}
          {which === "clip" && b.replace === "color" && (
            <Field label="Цвет фона">
              <input type="color" value={b.color} onChange={(e) => set({ color: e.target.value })} />
            </Field>
          )}
          {which === "clip" && b.replace === "image" && (
            <button className="btn btn-secondary btn-block" onClick={async () => { const f = await window.api.montagePickFile("image"); if (f) set({ image: f }); }}>
              {b.image ? `Фон: ${fileName(b.image)}` : "Выбрать картинку фона"}
            </button>
          )}
          <Slider label="Мягкость края" value={b.soft} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ soft: v })} />
          {busy ? (
            <div className="mt-motion-progress">
              <div className="mt-spinner" />
              <span>{stageName(progress?.stage || "")} {progress?.progress ? `${Math.round(progress.progress * 100)}%` : ""}</span>
              <button className="link-btn" onClick={() => window.api.montageBgStop()}>стоп</button>
            </div>
          ) : (
            <div className="mt-row">
              <button className="btn btn-primary" onClick={() => run(b)}>{ready ? "Пересчитать" : "Обработать"}</button>
              <button className="link-btn" onClick={() => patch(null)}>вернуть фон</button>
            </div>
          )}
          {!ready && !busy && <p className="mt-hint">Маска не посчитана для этих границ куска — нажмите «Обработать» (или она посчитается при экспорте).</p>}
          <p className="mt-hint">Модель скачивается с Hugging Face при первом использовании (MODNet ~25 МБ, BiRefNet ~100 МБ) и дальше работает без сети.</p>
        </>
      )}
    </Section>
  );
}
