import { useEffect, useState } from "react";
import type { MontageAdjust, MontageAudio, MontageClip, MontageEffect, MontageKeyframe, MontageLayer, MontageOptions, MontageText, MontageTransform } from "../lib/types";
import { MASK_SHAPES, MOTION_PRESETS, addKeyframe, clamp, fileName, fmtTime, itemLabel, maskCss, layerDuration, layout, motionPreset, sampleTransform, setTransformAt, uid } from "../lib/montage";
import { Field, NumberField, Section, Slider, type EditorCtx } from "./MontageControls";
import { FontPicker, useFontData } from "./MontageFonts";
import EraseDialog from "./MontageErase";
import { BgSection } from "./MontageBg";

type Animated = { transform: MontageTransform; keyframes: MontageKeyframe[] };

/**
 * Положение, масштаб, поворот, прозрачность и ключевые точки.
 * Правка в момент бегунка: пока точек нет — меняется само значение; если
 * есть — ставится или двигается точка в этот момент (как в CapCut).
 */
function TransformSection<T extends Animated>({ item, local, dur, isLayer, patch, seek, eases }: {
  item: T;
  local: number;
  dur: number;
  isLayer: boolean;
  patch: (next: T) => void;
  seek: (local: number) => void;
  eases: { id: string; name: string }[];
}) {
  const cur = sampleTransform(item.transform, item.keyframes, local);
  const set = (p: Partial<MontageTransform>) => patch(setTransformAt(item, local, p));
  const onKf = item.keyframes.findIndex((k) => Math.abs(k.t - local) < 0.04);
  return (
    <Section title={`Положение и движение${item.keyframes.length ? ` · ◆ ${item.keyframes.length}` : ""}`}>
      <div className="mt-row">
        <button className={`btn ${onKf >= 0 ? "btn-primary" : "btn-secondary"}`} onClick={() => patch(onKf >= 0 ? { ...item, keyframes: item.keyframes.filter((_, i) => i !== onKf) } : addKeyframe(item, local))} title="Ключевая точка в момент бегунка">
          ◆ {onKf >= 0 ? "Убрать точку" : "Ключевая точка"}
        </button>
        {item.keyframes.length > 0 && <button className="link-btn" onClick={() => patch({ ...item, keyframes: [], transform: cur })}>убрать все</button>}
      </div>
      <Field label="Готовое движение">
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            patch({ ...item, keyframes: motionPreset(e.target.value, dur, item.keyframes.length ? sampleTransform(item.transform, item.keyframes, 0) : item.transform) });
          }}
        >
          <option value="">— выбрать —</option>
          {MOTION_PRESETS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </Field>
      <Slider label="По горизонтали" value={Math.round(cur.x * 1000) / 1000} min={isLayer ? -0.3 : -0.5} max={isLayer ? 1.3 : 1.5} step={0.005} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ x: v })} />
      <Slider label="По вертикали" value={Math.round(cur.y * 1000) / 1000} min={isLayer ? -0.3 : -0.5} max={isLayer ? 1.3 : 1.5} step={0.005} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ y: v })} />
      <Slider label={isLayer ? "Ширина" : "Масштаб"} value={Math.round(cur.scale * 1000) / 1000} min={0.05} max={isLayer ? 1.5 : 3} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ scale: v })} />
      <Slider label="Поворот" value={Math.round(cur.rotation)} min={-180} max={180} step={1} fmt={(v) => `${v}°`} onChange={(v) => set({ rotation: v })} />
      <Slider label="Непрозрачность" value={Math.round(cur.opacity * 100) / 100} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ opacity: v })} />
      {item.keyframes.length > 0 && (
        <div className="mt-kf-list">
          {item.keyframes.map((k, i) => (
            <div key={i} className={`mt-kf-row ${i === onKf ? "on" : ""}`}>
              <button className="link-btn" onClick={() => seek(k.t)} title="Перейти к точке">◆ {fmtTime(k.t, true)}</button>
              <select
                value={k.ease}
                title="Как идти к следующей точке"
                onChange={(e) => patch({ ...item, keyframes: item.keyframes.map((x, j) => (j === i ? { ...x, ease: e.target.value } : x)) })}
              >
                {eases.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
              <button className="link-btn" onClick={() => patch({ ...item, keyframes: item.keyframes.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

const GRADE_KEYS = ["exposure", "temperature", "tint", "vibrance", "highlights", "shadows", "sharpness", "clarity", "vignette", "denoise", "grain"] as const;

/**
 * Профессиональная коррекция: свет, цвет, детали. «Авто» мерит кадр и
 * выставляет экспозицию, света и тени, сочность, чёткость и резкость.
 */
function GradeSection({ adjust, source, onChange, notify }: { adjust: MontageAdjust; source?: { src: string; from: number; to: number }; onChange: (a: MontageAdjust) => void; notify: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const v = (k: (typeof GRADE_KEYS)[number]) => adjust[k] ?? 0;
  const set = (k: (typeof GRADE_KEYS)[number], val: number) => onChange({ ...adjust, [k]: val });
  const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}`;
  const touched = GRADE_KEYS.some((k) => Math.abs(v(k)) > 0.001);
  return (
    <Section title="Коррекция изображения" open={touched}>
      <div className="mt-row">
        {source && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await window.api.montageAutoEnhance(source.src, { from: source.from, to: source.to });
                const { measured: _m, ...patch } = r;
                onChange({ ...adjust, ...patch });
                notify("Кадр улучшен автоматически: экспозиция, света и тени, сочность, чёткость и резкость. Подправьте ползунками, если нужно.");
              } catch (e) {
                notify(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Измеряю кадр…" : "✨ Авто-улучшение"}
          </button>
        )}
        {touched && (
          <button className="link-btn" onClick={() => onChange({ ...adjust, ...Object.fromEntries(GRADE_KEYS.map((k) => [k, 0])) })}>
            сбросить
          </button>
        )}
      </div>
      <h5 className="mt-sub">Свет</h5>
      <Slider label="Экспозиция" value={v("exposure")} min={-2} max={2} step={0.05} fmt={(x) => `${x > 0 ? "+" : ""}${x.toFixed(2)} EV`} onChange={(x) => set("exposure", x)} />
      <Slider label="Света" value={v("highlights")} min={-1} max={1} step={0.05} fmt={pct} onChange={(x) => set("highlights", x)} />
      <Slider label="Тени" value={v("shadows")} min={-1} max={1} step={0.05} fmt={pct} onChange={(x) => set("shadows", x)} />
      <h5 className="mt-sub">Цвет</h5>
      <Slider label="Температура (холоднее ↔ теплее)" value={v("temperature")} min={-1} max={1} step={0.05} fmt={pct} onChange={(x) => set("temperature", x)} />
      <Slider label="Оттенок (зелёный ↔ пурпурный)" value={v("tint")} min={-1} max={1} step={0.05} fmt={pct} onChange={(x) => set("tint", x)} />
      <Slider label="Сочность" value={v("vibrance")} min={-1} max={1} step={0.05} fmt={pct} onChange={(x) => set("vibrance", x)} />
      <h5 className="mt-sub">Детали</h5>
      <Slider label="Чёткость" value={v("clarity")} min={0} max={1} step={0.05} fmt={pct} onChange={(x) => set("clarity", x)} />
      <Slider label="Резкость" value={v("sharpness")} min={0} max={1} step={0.05} fmt={pct} onChange={(x) => set("sharpness", x)} />
      <Slider label="Шумоподавление" value={v("denoise")} min={0} max={1} step={0.05} fmt={pct} onChange={(x) => set("denoise", x)} />
      <h5 className="mt-sub">Эффекты</h5>
      <Slider label="Виньетка" value={v("vignette")} min={0} max={1} step={0.05} fmt={pct} onChange={(x) => set("vignette", x)} />
      <Slider label="Зерно" value={v("grain")} min={0} max={1} step={0.05} fmt={pct} onChange={(x) => set("grain", x)} />
      <p className="mt-hint">Резкость, чёткость и шумоподавление точно видны в собранном ролике; предпросмотр показывает их приближённо.</p>
    </Section>
  );
}

function LookSection({ adjust, options, onChange }: { adjust: MontageAdjust; options: MontageOptions; onChange: (a: MontageAdjust) => void }) {
  return (
    <Section title="Цвет и фильтр" open={false}>
      <Field label="Фильтр">
        <select value={adjust.filter} onChange={(e) => onChange({ ...adjust, filter: e.target.value })}>
          {options.filters.map((f) => (
            <option key={f.id} value={f.id}>{f.group ? `${f.group}: ` : ""}{f.name}</option>
          ))}
        </select>
      </Field>
      {(adjust.filter !== "none" || adjust.lut) && (
        <Slider label="Сила фильтра" value={adjust.filterAmount} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ ...adjust, filterAmount: v })} />
      )}
      <Field label="LUT (.cube)">
        <div className="mt-row">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const f = await window.api.montagePickFile("lut");
              if (f) onChange({ ...adjust, lut: f });
            }}
          >
            {adjust.lut ? fileName(adjust.lut) : "Загрузить LUT…"}
          </button>
          {adjust.lut && <button className="link-btn" onClick={() => onChange({ ...adjust, lut: "" })}>убрать</button>}
        </div>
      </Field>
      {adjust.lut && <p className="mt-hint">LUT виден в собранном ролике; предпросмотр показывает его без цвета.</p>}
      <Slider label="Яркость" value={adjust.brightness} min={-0.5} max={0.5} step={0.01} onChange={(v) => onChange({ ...adjust, brightness: v })} />
      <Slider label="Контраст" value={adjust.contrast} min={0.5} max={2} step={0.01} onChange={(v) => onChange({ ...adjust, contrast: v })} />
      <Slider label="Насыщенность" value={adjust.saturation} min={0} max={3} step={0.01} onChange={(v) => onChange({ ...adjust, saturation: v })} />
    </Section>
  );
}

function EffectsSection({ effects, options, onChange }: { effects: MontageEffect[]; options: MontageOptions; onChange: (e: MontageEffect[]) => void }) {
  return (
    <Section title={`Эффекты${effects.length ? ` · ${effects.length}` : ""}`} open={effects.length > 0}>
      {effects.map((e) => {
        const def = options.effects.find((d) => d.id === e.kind);
        return (
          <div key={e.id} className="mt-fx-row">
            <Slider label={def?.name || e.kind} value={e.amount} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange(effects.map((x) => (x.id === e.id ? { ...x, amount: v } : x)))} />
            <button className="link-btn" onClick={() => onChange(effects.filter((x) => x.id !== e.id))}>✕</button>
          </div>
        );
      })}
      <select
        value=""
        onChange={(ev) => {
          if (ev.target.value) onChange([...effects, { id: uid("fx"), kind: ev.target.value, amount: 0.5 }]);
        }}
      >
        <option value="">+ добавить эффект</option>
        {options.effects.map((d) => (
          <option key={d.id} value={d.id}>{d.group}: {d.name}</option>
        ))}
      </select>
    </Section>
  );
}

export function ClipInspector({ ctx, clip }: { ctx: EditorCtx; clip: MontageClip }) {
  const { options, project, time } = ctx;
  const idx = project.clips.findIndex((c) => c.id === clip.id);
  const item = layout(project.clips).items[idx];
  const dur = (clip.out - clip.in) / clip.speed;
  const local = clamp(time - (item?.start || 0), 0, dur);
  const patch = (p: Partial<MontageClip>) => ctx.commit((pr) => ({ ...pr, clips: pr.clips.map((c) => (c.id === clip.id ? { ...c, ...p } : c)) }));
  const transcribed = !!ctx.transcripts[clip.src];
  const [erasing, setErasing] = useState(false);
  return (
    <div className="mt-inspector">
      <h4 title={clip.src}>{clip.kind === "image" ? "🖼" : clip.kind === "motion" ? "✨" : "🎬"} {itemLabel(clip)}</h4>
      {(clip.kind === "video" || clip.kind === "image") && (
        <button className="btn btn-secondary btn-block" onClick={() => setErasing(true)} title="Обвести водяной знак — он заменится фоном">
          🩹 Убрать водяной знак{clip.erase?.length ? ` · ${clip.erase.length}` : ""}
        </button>
      )}
      {erasing && (
        <EraseDialog
          clip={clip}
          at={clip.kind === "image" ? 0 : clip.in + local * clip.speed}
          onSave={(erase) => patch({ erase })}
          onClose={() => setErasing(false)}
        />
      )}
      <Section title="Основное">
        <div className="mt-row">
          <NumberField label="С (сек исходника)" value={clip.in} min={0} max={clip.out - 0.05} onChange={(v) => patch({ in: v })} />
          <NumberField label="По" value={clip.out} min={clip.in + 0.05} onChange={(v) => patch({ out: v })} />
        </div>
        <Slider label="Скорость" value={clip.speed} min={0.25} max={4} step={0.05} fmt={(v) => `×${v}`} onChange={(v) => patch({ speed: v })} />
        {clip.kind !== "image" && (
          <label className="mt-check">
            <input type="checkbox" checked={clip.reverse} onChange={(e) => patch({ reverse: e.target.checked })} /> Реверс (задом наперёд)
          </label>
        )}
        <div className="mt-row">
          <NumberField label="Появление, с" value={clip.fadeIn} min={0} max={5} onChange={(v) => patch({ fadeIn: v })} />
          <NumberField label="Затухание, с" value={clip.fadeOut} min={0} max={5} onChange={(v) => patch({ fadeOut: v })} />
        </div>
      </Section>
      {clip.kind !== "image" && (
        <Section title="Звук" open={false}>
          <Slider label="Громкость" value={clip.volume} min={0} max={3} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />
          <label className="mt-check">
            <input type="checkbox" checked={clip.muted} onChange={(e) => patch({ muted: e.target.checked })} /> Без звука
          </label>
          <Field label="Голос">
            <select value={clip.audioEffect} onChange={(e) => patch({ audioEffect: e.target.value })}>
              {options.audioFx.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        </Section>
      )}
      <Section title="Переход в этот кусок" open={idx > 0}>
        <div className="mt-row">
          <select value={clip.transition.kind} onChange={(e) => patch({ transition: { ...clip.transition, kind: e.target.value } })} disabled={idx === 0}>
            {options.transitions.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {clip.transition.kind !== "none" && <NumberField label="с" value={clip.transition.duration} min={0.1} max={2} onChange={(v) => patch({ transition: { ...clip.transition, duration: v } })} />}
        </div>
      </Section>
      <Section title="Кадрирование" open={false}>
        <Field label="Вписать">
          <select value={clip.fit} onChange={(e) => patch({ fit: e.target.value })}>
            <option value="">как у проекта</option>
            {options.fits.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </Field>
        <Slider label="Приближение" value={clip.zoom} min={1} max={2.5} step={0.02} fmt={(v) => `×${v.toFixed(2)}`} onChange={(v) => patch({ zoom: v })} />
        <Slider label="Центр по горизонтали" value={clip.focusX} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ focusX: v })} />
        <Slider label="Центр по вертикали" value={clip.focusY} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ focusY: v })} />
      </Section>
      <TransformSection item={clip} local={local} dur={dur} isLayer={false} eases={options.eases} patch={(n) => patch({ transform: n.transform, keyframes: n.keyframes })} seek={() => {}} />
      {(clip.kind === "video" || clip.kind === "image") && <BgSection ctx={ctx} item={clip} which="clip" />}
      <GradeSection adjust={clip.adjust} source={clip.kind === "video" || clip.kind === "image" ? { src: clip.src, from: clip.in, to: clip.out } : undefined} onChange={(a) => patch({ adjust: a })} notify={ctx.notify} />
      <LookSection adjust={clip.adjust} options={options} onChange={(a) => patch({ adjust: a })} />
      <EffectsSection effects={clip.effects} options={options} onChange={(e) => patch({ effects: e })} />
      {clip.kind === "video" && (
        <button className="btn btn-secondary btn-block" disabled={!transcribed} onClick={() => ctx.cleanup(true)} title={transcribed ? "" : "Сначала расшифруйте запись"}>
          🧹 Убрать паузы в этом куске
        </button>
      )}
    </div>
  );
}

export function LayerInspector({ ctx, layer, seek }: { ctx: EditorCtx; layer: MontageLayer; seek: (t: number) => void }) {
  const { options, time } = ctx;
  const dur = layerDuration(layer);
  const local = clamp(time - layer.start, 0, dur);
  const patch = (p: Partial<MontageLayer>) => ctx.commit((pr) => ({ ...pr, layers: pr.layers.map((l) => (l.id === layer.id ? { ...l, ...p } : l)) }));
  return (
    <div className="mt-inspector">
      <h4 title={layer.src}>▣ Слой: {itemLabel(layer)}</h4>
      {layer.cell && (
        <Section title="Кадрирование в ячейке">
          <p className="mt-hint">Слой в ячейке раскладки: заполняет её с обрезкой. Ползунки — какая часть кадра видна.</p>
          <Slider label="По горизонтали" value={layer.focusX ?? 0.5} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ctx.commit((p) => ({ ...p, layers: p.layers.map((x) => (x.id === layer.id ? { ...x, focusX: v } : x)) }))} />
          <Slider label="По вертикали" value={layer.focusY ?? 0.5} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ctx.commit((p) => ({ ...p, layers: p.layers.map((x) => (x.id === layer.id ? { ...x, focusY: v } : x)) }))} />
          <button className="link-btn" onClick={() => ctx.commit((p) => ({ ...p, layers: p.layers.map((x) => (x.id === layer.id ? { ...x, cell: null } : x)) }))}>убрать из раскладки</button>
        </Section>
      )}
      <Section title="Основное">
        <div className="mt-row">
          <NumberField label="Начало в ролике" value={layer.start} min={0} onChange={(v) => patch({ start: v })} />
          <NumberField label="Дорожка" value={layer.track} step={1} min={1} max={8} onChange={(v) => patch({ track: Math.round(v) })} />
        </div>
        <div className="mt-row">
          <NumberField label="С (в файле)" value={layer.in} min={0} max={layer.out - 0.1} onChange={(v) => patch({ in: v })} />
          <NumberField label="По" value={layer.out} min={layer.in + 0.1} onChange={(v) => patch({ out: v })} />
        </div>
        {layer.kind !== "image" && <Slider label="Скорость" value={layer.speed} min={0.25} max={4} step={0.05} fmt={(v) => `×${v}`} onChange={(v) => patch({ speed: v })} />}
        <div className="mt-row">
          <NumberField label="Появление, с" value={layer.fadeIn} min={0} max={5} onChange={(v) => patch({ fadeIn: v })} />
          <NumberField label="Затухание, с" value={layer.fadeOut} min={0} max={5} onChange={(v) => patch({ fadeOut: v })} />
        </div>
        {layer.kind !== "image" && (
          <>
            <label className="mt-check">
              <input type="checkbox" checked={!layer.muted} onChange={(e) => patch({ muted: !e.target.checked })} /> Со звуком
            </label>
            {!layer.muted && <Slider label="Громкость" value={layer.volume} min={0} max={3} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />}
          </>
        )}
      </Section>
      <Section title="Форма и фон">
        <Field label="Маска">
          <div className="mt-mask-grid">
            {MASK_SHAPES.map((m) => (
              <button
                key={m.id}
                className={`mt-mask ${layer.mask === m.id ? "on" : ""}`}
                title={m.name}
                onClick={() => patch({ mask: m.id })}
                style={m.file ? maskCss(m.id, ctx.options.masksDir, ctx.scheme) : { borderRadius: m.id === "rounded" ? 8 : m.id === "rect" ? 2 : undefined, opacity: m.id === "none" ? 0.25 : undefined }}
              />
            ))}
          </div>
        </Field>
        {layer.mask !== "none" && (
          <>
            <Slider label="Мягкость края" value={layer.maskFeather ?? 0} min={0} max={0.15} step={0.005} fmt={(v) => (v ? `${Math.round(v * 1000) / 10}%` : "чёткий")} onChange={(v) => patch({ maskFeather: v })} />
            <Slider label="Обводка" value={layer.maskStroke ?? 0} min={0} max={30} step={1} fmt={(v) => (v ? `${v}` : "нет")} onChange={(v) => patch({ maskStroke: v })} />
            {(layer.maskStroke ?? 0) > 0 && (
              <Field label="Цвет обводки">
                <input type="color" value={layer.maskStrokeColor || "#ffffff"} onChange={(e) => patch({ maskStrokeColor: e.target.value })} />
              </Field>
            )}
          </>
        )}
        <label className="mt-check">
          <input type="checkbox" checked={layer.chroma.enabled} onChange={(e) => patch({ chroma: { ...layer.chroma, enabled: e.target.checked } })} /> Хромакей — убрать фон цвета
        </label>
        {layer.chroma.enabled && (
          <>
            <div className="mt-row">
              <Field label="Цвет фона">
                <input type="color" value={layer.chroma.color} onChange={(e) => patch({ chroma: { ...layer.chroma, color: e.target.value } })} />
              </Field>
              <button className="link-btn" onClick={() => patch({ chroma: { ...layer.chroma, color: "#00FF00" } })}>зелёный</button>
              <button className="link-btn" onClick={() => patch({ chroma: { ...layer.chroma, color: "#0047BB" } })}>синий</button>
            </div>
            <Slider label="Допуск" value={layer.chroma.similarity} min={0.02} max={0.5} step={0.01} onChange={(v) => patch({ chroma: { ...layer.chroma, similarity: v } })} />
            <Slider label="Мягкость края" value={layer.chroma.blend} min={0} max={0.4} step={0.01} onChange={(v) => patch({ chroma: { ...layer.chroma, blend: v } })} />
            <p className="mt-hint">Хромакей виден в собранном ролике; в предпросмотре фон пока остаётся.</p>
          </>
        )}
      </Section>
      <TransformSection item={layer} local={local} dur={dur} isLayer eases={options.eases} patch={(n) => patch({ transform: n.transform, keyframes: n.keyframes })} seek={(t) => seek(layer.start + t)} />
      {(layer.kind === "video" || layer.kind === "image") && <BgSection ctx={ctx} item={layer} which="layer" />}
      <GradeSection adjust={layer.adjust} source={layer.kind === "video" || layer.kind === "image" ? { src: layer.src, from: layer.in, to: layer.out } : undefined} onChange={(a) => patch({ adjust: a })} notify={ctx.notify} />
      <LookSection adjust={layer.adjust} options={options} onChange={(a) => patch({ adjust: a })} />
      <EffectsSection effects={layer.effects} options={options} onChange={(e) => patch({ effects: e })} />
    </div>
  );
}

export function TextInspector({ ctx, text }: { ctx: EditorCtx; text: MontageText }) {
  const { options } = ctx;
  const patch = (p: Partial<MontageText>) => ctx.commit((pr) => ({ ...pr, texts: pr.texts.map((t) => (t.id === text.id ? { ...t, ...p } : t)) }));
  const [draft, setDraft] = useState(text.text);
  useEffect(() => setDraft(text.text), [text.id, text.text]);
  return (
    <div className="mt-inspector">
      <h4>Надпись</h4>
      <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== text.text && patch({ text: draft })} />
      <div className="mt-row">
        <NumberField label="С, сек" value={text.start} min={0} max={text.end - 0.1} onChange={(v) => patch({ start: v })} />
        <NumberField label="По" value={text.end} min={text.start + 0.1} onChange={(v) => patch({ end: v })} />
      </div>
      <Field label="Стиль">
        <select value={text.style} onChange={(e) => patch({ style: e.target.value })}>
          {options.textStyles.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Анимация">
        <select value={text.animation} onChange={(e) => patch({ animation: e.target.value })}>
          {options.textAnimations.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      {text.x !== null ? (
        <p className="mt-hint">
          Место выбрано мышью в кадре. <button className="link-btn" onClick={() => patch({ x: null, y: null })}>вернуть по стилю</button>
        </p>
      ) : (
        <Field label="Где">
          <select value={text.position} onChange={(e) => patch({ position: e.target.value as MontageText["position"] })}>
            <option value="">по стилю</option>
            <option value="top">сверху</option>
            <option value="center">по центру</option>
            <option value="bottom">снизу</option>
          </select>
        </Field>
      )}
      <p className="mt-hint">Надпись можно перетащить мышью прямо в кадре.</p>
      <Slider label="Размер" value={text.size || 0} min={0} max={220} step={2} fmt={(v) => (v ? String(v) : "по стилю")} onChange={(v) => patch({ size: v })} />
      <div className="mt-row">
        <Field label="Цвет букв">
          <input type="color" value={text.color || "#ffffff"} onChange={(e) => patch({ color: e.target.value })} />
        </Field>
        <Field label="Подложка">
          <input type="color" value={text.bg || "#000000"} onChange={(e) => patch({ bg: e.target.value })} />
        </Field>
        {(text.color || text.bg) && <button className="link-btn" onClick={() => patch({ color: "", bg: "" })}>как в стиле</button>}
      </div>
      <label className="mt-check">
        <input type="checkbox" checked={text.upper} onChange={(e) => patch({ upper: e.target.checked })} /> ЗАГЛАВНЫМИ
      </label>
      <TextLook ctx={ctx} text={text} patch={patch} />
      <TextFonts ctx={ctx} text={text} patch={patch} />
    </div>
  );
}

/** Интервал, выравнивание, обводка и тень; разгруппировка пары на отдельные надписи. */
function TextLook({ ctx, text, patch }: { ctx: EditorCtx; text: MontageText; patch: (p: Partial<MontageText>) => void }) {
  const W = ctx.project.canvas.width;
  const H = ctx.project.canvas.height;
  const canUngroup = /\n/.test(text.text) || /\*[^*]+\*/.test(text.text);
  const ungroup = () => {
    // Каждая строка — своя надпись; в строке рукописный акцент — тоже отдельно.
    // Ставятся стопкой на месте исходной, дальше их двигают мышью куда нужно.
    const base = { x: text.x ?? 0.5, y: text.y ?? 0.5 };
    const sizePx = (text.size || 104) * (Math.min(W, H) / 1080);
    const step = (sizePx * 1.2 * (text.lineHeight || 1)) / H;
    const lines = text.text.split(/\r?\n/);
    const pieces: MontageText[] = [];
    lines.forEach((line, i) => {
      const y = base.y + (i - (lines.length - 1) / 2) * step;
      const segs = line.split(/\*([^*]+)\*/).map((t, k) => ({ t: t.trim(), accent: k % 2 === 1 })).filter((x) => x.t);
      segs.forEach((sg, k) => {
        const dx = segs.length > 1 ? (k - (segs.length - 1) / 2) * 0.22 : 0;
        pieces.push({
          ...text,
          id: uid("text"),
          text: sg.t,
          x: Math.min(0.95, Math.max(0.05, base.x + dx)),
          y: Math.min(0.97, Math.max(0.03, y)),
          fontPath: sg.accent ? text.accentFontPath || text.fontPath : text.fontPath,
          accentFontPath: "",
          color: sg.accent ? text.accentColor || ctx.project.captions.highlight : text.color,
          size: sg.accent ? Math.round((text.size || 104) * (text.accentScale || 1)) : text.size,
          upper: sg.accent ? false : text.upper,
          spacing: sg.accent ? 0 : text.spacing,
        });
      });
    });
    ctx.commit((p) => ({ ...p, texts: p.texts.flatMap((t) => (t.id === text.id ? pieces : [t])) }));
    if (pieces[0]) ctx.setSelection({ kind: "text", id: pieces[0].id });
    ctx.notify(`Разгруппировано на ${pieces.length} надписи — двигайте каждую мышью в кадре.`);
  };
  return (
    <Section title="Интервал, обводка, тень">
      <Field label="Выравнивание">
        <div className="mt-seg">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={(text.align || "center") === a ? "on" : ""} onClick={() => patch({ align: a })} title={a === "left" ? "По левому краю" : a === "right" ? "По правому краю" : "По центру"}>
              {a === "left" ? "⟸" : a === "right" ? "⟹" : "⇔"}
            </button>
          ))}
        </div>
      </Field>
      <Slider label="Межстрочный интервал" value={text.lineHeight ?? 1} min={0.5} max={2} step={0.02} fmt={(v) => `×${v.toFixed(2)}`} onChange={(v) => patch({ lineHeight: v })} />
      <Slider label="Обводка" value={text.outline ?? 0} min={0} max={20} step={0.5} fmt={(v) => (v ? `${v}` : "нет")} onChange={(v) => patch({ outline: v })} />
      {(text.outline ?? 0) > 0 && (
        <Field label="Цвет обводки">
          <input type="color" value={text.outlineColor || "#000000"} onChange={(e) => patch({ outlineColor: e.target.value })} />
        </Field>
      )}
      <Slider label="Тень" value={text.shadow ?? 0} min={0} max={30} step={0.5} fmt={(v) => (v ? `${v}` : "нет")} onChange={(v) => patch({ shadow: v })} />
      {(text.shadow ?? 0) > 0 && (
        <div className="mt-row">
          <Field label="Цвет тени">
            <input type="color" value={text.shadowColor || "#000000"} onChange={(e) => patch({ shadowColor: e.target.value })} />
          </Field>
          <Slider label="Мягкость" value={text.shadowBlur ?? 0} min={0} max={20} step={0.5} onChange={(v) => patch({ shadowBlur: v })} />
        </div>
      )}
      {canUngroup && (
        <button className="btn btn-secondary btn-block" onClick={ungroup} title="Каждая строка и рукописное слово — отдельной надписью">
          ✂ Разгруппировать на отдельные надписи
        </button>
      )}
    </Section>
  );
}

/** Шрифты надписи: основной, пара для *акцента*, разрядка и свечение. */
function TextFonts({ ctx, text, patch }: { ctx: EditorCtx; text: MontageText; patch: (p: Partial<MontageText>) => void }) {
  const fonts = useFontData();
  const designFonts = ctx.design?.fontFiles || [];
  return (
    <Section title="Шрифт и пара">
      <Field label="Пара целиком">
        <select
          value=""
          onChange={(e) => {
            const p = fonts.pairs.find((x) => x.id === e.target.value);
            if (p) patch({ fontPath: p.head.path, accentFontPath: p.accent.path, accentScale: p.accent.category === "script" ? 1.3 : 1, spacing: p.spacing || 0, glow: !!p.glow, upper: p.upper });
          }}
        >
          <option value="">выбрать шрифтовую пару…</option>
          {fonts.pairs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <FontPicker label="Шрифт" value={text.fontPath || ""} designFonts={designFonts} onChange={(path) => patch({ fontPath: path })} />
      <FontPicker label="Шрифт *акцента*" value={text.accentFontPath || ""} designFonts={designFonts} sample="акцент" onChange={(path) => patch({ accentFontPath: path })} />
      <p className="mt-hint">Слова в *звёздочках* набираются шрифтом акцента и акцентным цветом. В паре заглавными пишется только основной шрифт.</p>
      <Slider label="Размер акцента" value={text.accentScale ?? 1} min={0.6} max={2} step={0.05} fmt={(v) => `×${v.toFixed(2)}`} onChange={(v) => patch({ accentScale: v })} />
      <Slider label="Разрядка" value={text.spacing ?? 0} min={-0.05} max={0.5} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ spacing: v })} />
      <div className="mt-row">
        <Field label="Цвет акцента">
          <input type="color" value={text.accentColor || ctx.project.captions.highlight || "#ffd400"} onChange={(e) => patch({ accentColor: e.target.value })} />
        </Field>
        <label className="mt-check">
          <input type="checkbox" checked={!!text.glow} onChange={(e) => patch({ glow: e.target.checked })} /> Свечение
        </label>
      </div>
    </Section>
  );
}

export function AudioInspector({ ctx, audio }: { ctx: EditorCtx; audio: MontageAudio }) {
  const patch = (p: Partial<MontageAudio>) => ctx.commit((pr) => ({ ...pr, audio: pr.audio.map((a) => (a.id === audio.id ? { ...a, ...p } : a)) }));
  return (
    <div className="mt-inspector">
      <h4>{audio.kind === "sfx" ? "✺" : "♪"} {fileName(audio.src)}</h4>
      <Field label="Что это">
        <select value={audio.kind} onChange={(e) => patch({ kind: e.target.value as MontageAudio["kind"] })}>
          <option value="music">Музыка (фоном)</option>
          <option value="sfx">Звуковой эффект</option>
          <option value="voice">Голос / озвучка</option>
        </select>
      </Field>
      <div className="mt-row">
        <NumberField label="Старт в ролике" value={audio.start} min={0} onChange={(v) => patch({ start: v })} />
        <NumberField label="С (в файле)" value={audio.in} min={0} max={audio.out - 0.1} onChange={(v) => patch({ in: v })} />
        <NumberField label="По" value={audio.out} min={audio.in + 0.1} onChange={(v) => patch({ out: v })} />
      </div>
      <Slider label="Громкость" value={audio.volume} min={0} max={3} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />
      <div className="mt-row">
        <NumberField label="Появление, с" value={audio.fadeIn} min={0} max={10} onChange={(v) => patch({ fadeIn: v })} />
        <NumberField label="Затухание, с" value={audio.fadeOut} min={0} max={10} onChange={(v) => patch({ fadeOut: v })} />
      </div>
      <Field label="Эффект">
        <select value={audio.effect} onChange={(e) => patch({ effect: e.target.value })}>
          {ctx.options.audioFx.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Field>
      <label className="mt-check">
        <input type="checkbox" checked={audio.duck} onChange={(e) => patch({ duck: e.target.checked })} /> Приглушать под голос
      </label>
      <label className="mt-check">
        <input type="checkbox" checked={audio.loop} onChange={(e) => patch({ loop: e.target.checked })} /> Повторять по кругу
      </label>
    </div>
  );
}
