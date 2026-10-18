import { useEffect, useState } from "react";
import type { MontageAdjust, MontageAudio, MontageClip, MontageEffect, MontageKeyframe, MontageLayer, MontageOptions, MontageText, MontageTransform } from "../lib/types";
import { MOTION_PRESETS, addKeyframe, clamp, fileName, fmtTime, layerDuration, layout, motionPreset, sampleTransform, setTransformAt, uid } from "../lib/montage";
import { Field, NumberField, Section, Slider, type EditorCtx } from "./MontageControls";

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
  return (
    <div className="mt-inspector">
      <h4 title={clip.src}>{clip.kind === "image" ? "🖼" : "🎬"} {fileName(clip.src)}</h4>
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
      <h4 title={layer.src}>▣ Слой: {fileName(layer.src)}</h4>
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
          <select value={layer.mask} onChange={(e) => patch({ mask: e.target.value as MontageLayer["mask"] })}>
            <option value="none">Без маски</option>
            <option value="circle">Круг (голова в кружке)</option>
            <option value="rounded">Скруглённые углы</option>
          </select>
        </Field>
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
    </div>
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
