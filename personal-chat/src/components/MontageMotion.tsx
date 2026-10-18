import { useEffect, useMemo, useRef, useState } from "react";
import type { MontageClip, MontageConfig, MontageLayer, MontageMotion, MontageMotionProgress, MontageTemplate } from "../lib/types";
import { fileName, fmtTime, layerDuration, mediaUrl, motionOf, newMotionClip, newMotionLayer, outputToSource, projectDuration, round3 } from "../lib/montage";
import { Field, Section, type EditorCtx } from "./MontageControls";
import { listModels, type ModelInfo } from "../lib/api";
import { CURATED_CHAT_MODELS, mergeModelLists } from "../lib/curatedModels";
import { useFontData } from "./MontageFonts";

/** Шрифты ролика или титра: дизайн-системы, заготовки или любая шрифтовая пара. */
export function PairSelect({ value, onChange, hasDesignFonts, defaultLabel }: { value: string; onChange: (id: string) => void; hasDesignFonts: boolean; defaultLabel: string }) {
  const fonts = useFontData();
  return (
    <Field label="Шрифты">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{defaultLabel}</option>
        {hasDesignFonts && <option value="ds">шрифты дизайн-системы</option>}
        <optgroup label="Шрифтовые пары">
          {fonts.pairs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </optgroup>
      </select>
    </Field>
  );
}

/**
 * Модель для моушна — выбором из списка Polza, по вкусу. Пусто — та же, что в
 * настройках. Ключ берётся из настроек (а если в «Монтаже» его нет — из
 * «Личного чата»).
 */
export function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [models, setModels] = useState<ModelInfo[]>(CURATED_CHAT_MODELS);
  const [base, setBase] = useState("");
  const [hasKey, setHasKey] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await window.api.getSettings();
      if (!alive) return;
      setBase(s.model || "");
      setHasKey(!!s.apiKey);
      if (!s.apiKey) return;
      try {
        const list = await listModels(s.baseUrl, s.apiKey);
        if (alive) setModels(mergeModelLists(CURATED_CHAT_MODELS, list));
      } catch {
        // список не загрузился — остаются проверенные модели
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const known = models.some((m) => m.id === value);
  return (
    <Field label="Модель">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">как в настройках{base ? ` — ${base}` : ""}</option>
        <optgroup label="Проверенные">
          {CURATED_CHAT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </optgroup>
        {models.length > CURATED_CHAT_MODELS.length && (
          <optgroup label="Все модели Polza">
            {models.slice(CURATED_CHAT_MODELS.length).map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.id}</option>
            ))}
          </optgroup>
        )}
        {value && !known && <option value={value}>{value}</option>}
      </select>
      {!hasKey && <small className="mt-error-inline">Нет ключа Polza — ⚙ справа сверху.</small>}
    </Field>
  );
}

const DURATIONS = [10, 15, 20, 30, 45, 60];

/** Куда вставить кусок: за кусок под бегунком или в конец. */
function insertClip(ctx: EditorCtx, clip: MontageClip) {
  ctx.commit((p) => {
    const total = projectDuration(p);
    const hit = outputToSource(p.clips, ctx.time);
    const at = hit && ctx.time < total - 0.05 && ctx.time > 0.01 ? hit.index + 1 : ctx.time <= 0.01 && p.clips.length ? 0 : p.clips.length;
    return { ...p, clips: [...p.clips.slice(0, at), clip, ...p.clips.slice(at)] };
  });
  ctx.setSelection({ kind: "clip", id: clip.id });
}

/** Слой поверх — на свободную дорожку в этот момент. */
function insertLayer(ctx: EditorCtx, motion: MontageMotion) {
  ctx.commit((p) => {
    const start = ctx.time;
    let track = 1;
    while (track < 8 && p.layers.some((l) => l.track === track && l.start < start + motion.duration && l.start + layerDuration(l) > start)) track++;
    const l = newMotionLayer(motion, start, track);
    ctx.setSelection({ kind: "layer", id: l.id });
    return { ...p, layers: [...p.layers, l] };
  });
  // Бегунок — туда, где титр уже появился: сразу видно, что добавилось.
  ctx.seek(round3(ctx.time + Math.min(motion.duration * 0.45, 1.8)));
}

function stageText(p: MontageMotionProgress | null) {
  if (!p) return "";
  if (p.stage === "write") return `Модель пишет ролик… ${p.chars ? `${Math.round(p.chars / 100) / 10} тыс. знаков` : ""}`;
  if (p.stage === "repair-write") return `Исправляет… ${p.chars ? `${Math.round(p.chars / 100) / 10} тыс. знаков` : ""}`;
  if (p.stage === "review-write") return "Арт-директор правит кадры…";
  return p.message || "";
}

/**
 * ✨ Моушн — как в Claude Design: дизайн-система + текст → готовый ролик.
 *
 * Полей минимум: текст (или файл со статьёй), по желанию фото и пожелание.
 * Сцены, текст каждой, логотип, раскладку и движение модель решает сама,
 * программа проверяет код и показывает результат прямо на таймлайне.
 */
export function MotionPanel({ ctx, config, onConfig }: { ctx: EditorCtx; config: MontageConfig; onConfig: (patch: Partial<MontageConfig>) => void }) {
  const { project } = ctx;
  const designDir = project.design?.dir || config.designDir || "";
  const [text, setText] = useState("");
  const [brief, setBrief] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [duration, setDuration] = useState(20);
  const [asTitle, setAsTitle] = useState(false);
  const [pair, setPair] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MontageMotionProgress | null>(null);
  const [storyboard, setStoryboard] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(
    () =>
      window.api.onMontageMotion((p) => {
        setProgress(p);
        if (p.storyboard?.length) setStoryboard(p.storyboard);
      }),
    []
  );

  async function pickDesign() {
    const dir = await window.api.montagePickFolder("Папка дизайн-системы");
    if (!dir) return;
    ctx.commit((p) => ({ ...p, design: { dir } }));
    onConfig({ designDir: dir });
  }

  async function run() {
    setRunning(true);
    setProblems([]);
    setStoryboard([]);
    setProgress({ stage: "write", message: "Готовлю задание…" });
    try {
      const r = await window.api.montageMotionGenerate({
        designDir,
        text,
        brief,
        photos,
        width: project.canvas.width,
        height: project.canvas.height,
        duration,
        transparent: asTitle,
        pair,
        review: config.motionReview !== false,
        model: config.motionModel || undefined,
      });
      const title = (r.storyboard?.[0] || text.split(/\n/)[0] || "Моушн").replace(/^\s*(\d+[.)]|[-•—])\s*/, "").slice(0, 48);
      const motion = motionOf({ html: r.html, duration: Math.max(1, r.duration), designDir, title, storyboard: r.storyboard || [], assets: r.assets, transparent: asTitle, pair: r.pair || pair });
      if (asTitle) insertLayer(ctx, motion);
      else insertClip(ctx, newMotionClip(motion));
      setProblems(r.problems);
      ctx.notify(`Моушн готов: ${fmtTime(r.duration)} — на таймлайне. Правки словами — справа, в инспекторе.`);
    } catch (e) {
      if (!/abort|останов/i.test(String(e))) ctx.fail(e);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="mt-motion-panel">
      <h3 className="mt-panel-title">✨ Моушн-дизайн</h3>
      <p className="mt-hint">Дайте дизайн-систему и текст — ИИ сам придумает сцены, напишет текст каждого слайда, расставит логотип и анимацию. Ролик встанет на таймлайн.</p>

      <div className={`mt-ds-card ${designDir ? "" : "empty"}`}>
        {designDir ? (
          <>
            <div className="mt-swatches small">
              {(ctx.design?.colours || []).slice(0, 8).map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </div>
            <div className="mt-ds-name">
              <b>{fileName(designDir)}</b>
              <small>{ctx.design ? `${ctx.design.fontFiles.length} шрифт. · ${ctx.design.logoFiles?.length || 0} логотип.` : "читаю…"}</small>
            </div>
            <button className="link-btn" onClick={pickDesign}>сменить</button>
          </>
        ) : (
          <button className="btn btn-secondary btn-block" onClick={pickDesign}>🎨 Подключить папку дизайн-системы</button>
        )}
      </div>

      <Field label="Текст, статья или пост">
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Вставьте текст — модель сама разобьёт его на сцены и сократит до заголовков. Можно просто тему: «3 причины купить дом в посёлке»." />
      </Field>
      <div className="mt-row">
        <button
          className="btn btn-secondary"
          onClick={async () => {
            const f = await window.api.montagePickText();
            if (!f) return;
            try {
              const t = await window.api.montageReadText(f);
              setText((prev) => (prev ? prev + "\n\n" : "") + t);
            } catch (e) {
              ctx.fail(e);
            }
          }}
        >
          📄 Из файла
        </button>
        <button
          className="btn btn-secondary"
          onClick={async () => {
            const list = await window.api.montagePickImages();
            if (list.length) setPhotos((p) => [...new Set([...p, ...list])].slice(0, 8));
          }}
        >
          🖼 Фото {photos.length ? `(${photos.length})` : ""}
        </button>
      </div>
      {photos.length > 0 && (
        <div className="mt-photo-chips">
          {photos.map((p) => (
            <span key={p} style={{ backgroundImage: `url("${mediaUrl(ctx.scheme, p)}")` }} title={fileName(p)} onClick={() => setPhotos((x) => x.filter((y) => y !== p))}>×</span>
          ))}
        </div>
      )}
      <Field label="Пожелание (необязательно)">
        <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="энергично, для Reels, акцент на цене" />
      </Field>
      <div className="mt-row">
        <Field label="Длина">
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>≈ {d} с</option>
            ))}
          </select>
        </Field>
        <Field label="Куда">
          <select value={asTitle ? "layer" : "main"} onChange={(e) => setAsTitle(e.target.value === "layer")}>
            <option value="main">отдельный ролик</option>
            <option value="layer">титр поверх видео</option>
          </select>
        </Field>
      </div>
      <PairSelect value={pair} onChange={setPair} hasDesignFonts={!!ctx.design?.fontFiles.length} defaultLabel={ctx.design?.fontFiles.length ? "авто: шрифты дизайн-системы" : "авто: шрифты подберутся"} />
      <ModelPicker value={config.motionModel || ""} onChange={(id) => onConfig({ motionModel: id })} />
      <p className="mt-dim">Кадр {project.canvas.width}×{project.canvas.height} — как у проекта.</p>

      {!running ? (
        <button className="btn btn-primary btn-block mt-big" disabled={!text.trim() && !brief.trim()} onClick={run}>✨ Создать моушн</button>
      ) : (
        <div className="mt-motion-progress">
          <div className="mt-spinner" />
          <span>{stageText(progress)}</span>
          <button className="link-btn" onClick={() => window.api.montageMotionStop()}>остановить</button>
        </div>
      )}
      {storyboard.length > 0 && (
        <ol className="mt-storyboard">
          {storyboard.map((s, i) => (
            <li key={i}>{s.replace(/^\s*(\d+[.)]|[-•—])\s*/, "")}</li>
          ))}
        </ol>
      )}
      {problems.length > 0 && <p className="mt-hint">Осталось после проверки: {problems.slice(0, 3).join("; ")}</p>}

      <Section title="Настройки моушна" open={false}>
        <label className="mt-check">
          <input type="checkbox" checked={config.motionReview !== false} onChange={(e) => onConfig({ motionReview: e.target.checked })} />
          Самопроверка по кадрам — модель смотрит на свой ролик и правит (дольше, чище)
        </label>
        <p className="mt-hint">Лучше всего моушн пишут сильные модели (Claude Sonnet/Opus, GPT-5): ролик — это 15–30 тысяч знаков кода.</p>
      </Section>
    </div>
  );
}

// Картинки заготовок рендерятся по одной: каждая — невидимое окно браузера.
let thumbQueue: Promise<unknown> = Promise.resolve();
const thumbCache = new Map<string, Promise<string>>();
function templateThumb(id: string, designDir: string, pair = "") {
  const key = `${id}|${designDir}|${pair}`;
  if (!thumbCache.has(key)) {
    const p = thumbQueue.then(() => window.api.montageTemplateThumb(id, designDir, pair)).catch(() => "");
    thumbQueue = p;
    thumbCache.set(key, p);
  }
  return thumbCache.get(key)!;
}

function TemplateCard({ t, designDir, pair, scheme, onAdd }: { t: MontageTemplate; designDir: string; pair: string; scheme: string; onAdd: () => void }) {
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    let alive = true;
    setThumb("");
    void templateThumb(t.id, designDir, pair).then((f) => alive && setThumb(f));
    return () => {
      alive = false;
    };
  }, [t.id, designDir, pair]);
  return (
    <button className="mt-tpl" onClick={onAdd} title={`${t.name} · ${t.duration} с — добавить под бегунок`}>
      <div className="mt-tpl-img" style={thumb ? { backgroundImage: `url("${mediaUrl(scheme, thumb)}")` } : undefined}>{!thumb && <i className="mt-spinner" />}</div>
      <span>{t.name}</span>
    </button>
  );
}

/**
 * Титры — анимированные заготовки в цветах и шрифтах дизайн-системы проекта.
 * Щелчок — титр под бегунком; текст правится справа.
 */
export function TitlesPanel({ ctx, config }: { ctx: EditorCtx; config: MontageConfig }) {
  const [list, setList] = useState<MontageTemplate[]>([]);
  const [pair, setPair] = useState("");
  const designDir = ctx.project.design?.dir || config.designDir || "";
  useEffect(() => {
    window.api.montageTemplates().then(setList).catch(ctx.fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const groups = useMemo(() => [...new Set(list.map((t) => t.group))], [list]);
  return (
    <div>
      <h3 className="mt-panel-title">Титры</h3>
      <p className="mt-hint">{designDir ? `В стиле «${fileName(designDir)}».` : "Подключите дизайн-систему во вкладке «Дизайн» — титры возьмут её цвета и шрифты."} Щелчок — титр под бегунком, текст — справа.</p>
      <PairSelect value={pair} onChange={setPair} hasDesignFonts={!!ctx.design?.fontFiles.length} defaultLabel="у каждой заготовки свои" />
      {groups.map((g) => (
        <div key={g}>
          <h4>{g}</h4>
          <div className="mt-tpl-grid">
            {list
              .filter((t) => t.group === g)
              .map((t) => (
                <TemplateCard
                  key={t.id}
                  t={t}
                  pair={pair}
                  designDir={designDir}
                  scheme={ctx.scheme}
                  onAdd={() => {
                    const fields: Record<string, string> = Object.fromEntries(t.fields.map((f) => [f.key, f.value]));
                    if (pair) fields.__pair = pair;
                    insertLayer(ctx, motionOf({ template: t.id, fields, duration: t.duration, designDir, title: t.name, transparent: true }));
                    ctx.notify(`Титр «${t.name}» добавлен. Текст — справа, в инспекторе.`);
                  }}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Инспектор моушна: поля заготовки или правка словами для ролика ИИ. */
export function MotionInspector({ ctx, item, layer }: { ctx: EditorCtx; item: MontageClip | MontageLayer; layer: boolean }) {
  const m = item.motion!;
  const [templates, setTemplates] = useState<MontageTemplate[]>([]);
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MontageMotionProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const tpl = templates.find((t) => t.id === m.template);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (m.template) window.api.montageTemplates().then(setTemplates).catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [m.template]);
  useEffect(() => window.api.onMontageMotion(setProgress), []);

  const update = (patch: Partial<MontageMotion>) =>
    ctx.commit((p) => {
      const fix = <T extends MontageClip | MontageLayer>(x: T): T => (x.id === item.id ? { ...x, motion: { ...x.motion!, ...patch }, ...(patch.duration ? { out: round3(x.in + patch.duration) } : {}) } : x);
      return layer ? { ...p, layers: p.layers.map(fix) } : { ...p, clips: p.clips.map(fix) };
    });

  async function applyEdit() {
    if (!instruction.trim()) return;
    setRunning(true);
    try {
      const r = await window.api.montageMotionEdit({ motion: m, instruction, width: ctx.project.canvas.width, height: ctx.project.canvas.height });
      update({ html: r.html, duration: Math.max(1, r.duration) });
      setInstruction("");
      ctx.notify(r.problems.length ? `Правка внесена. Осталось: ${r.problems[0]}` : "Правка внесена.");
    } catch (e) {
      if (!/abort|останов/i.test(String(e))) ctx.fail(e);
    } finally {
      if (alive.current) {
        setRunning(false);
        setProgress(null);
      }
    }
  }

  return (
    <div className="mt-insp mt-motion-insp">
      <h4>✨ {m.title || (layer ? "Титр" : "Моушн")}</h4>
      {m.template && tpl && (
        <>
          {tpl.fields.map((f) => (
            <TemplateFieldInput key={f.key} label={f.label} value={m.fields[f.key] ?? f.value} multiline={f.multiline || (m.fields[f.key] ?? f.value).length > 40} onChange={(v) => update({ fields: { ...m.fields, [f.key]: v } })} />
          ))}
          <p className="mt-hint">*слово* в звёздочках — акцентом (цветом и вторым шрифтом пары); «/» — перенос строки.</p>
          <PairSelect value={m.fields.__pair || ""} onChange={(id) => update({ fields: { ...m.fields, __pair: id } })} hasDesignFonts={!!ctx.design?.fontFiles.length} defaultLabel="как в заготовке" />
        </>
      )}
      {!m.template && (
        <>
          {m.storyboard.length > 0 && (
            <details className="mt-sec">
              <summary>Сцены ({m.storyboard.length})</summary>
              <ol className="mt-storyboard">
                {m.storyboard.map((s, i) => (
                  <li key={i}>{s.replace(/^\s*(\d+[.)]|[-•—])\s*/, "")}</li>
                ))}
              </ol>
            </details>
          )}
          <Field label="Правка словами">
            <textarea rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="финал длиннее, логотип крупнее, третью сцену — списком с иконками" />
          </Field>
          {!running ? (
            <button className="btn btn-primary btn-block" disabled={!instruction.trim()} onClick={applyEdit}>Применить правку</button>
          ) : (
            <div className="mt-motion-progress">
              <div className="mt-spinner" />
              <span>{stageText(progress)}</span>
              <button className="link-btn" onClick={() => window.api.montageMotionStop()}>стоп</button>
            </div>
          )}
        </>
      )}
      <p className="mt-dim">Длина {fmtTime(m.duration, true)}{layer ? " · прозрачный фон" : ""}</p>
      <button
        className="btn btn-secondary btn-block"
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            const r = await window.api.montageMotionExport(layer ? { ...m, transparent: true } : m, { width: ctx.project.canvas.width, height: ctx.project.canvas.height, fps: ctx.project.canvas.fps });
            await window.api.montageShowItem(r.path);
          } catch (e) {
            ctx.fail(e);
          } finally {
            setExporting(false);
          }
        }}
      >
        {exporting ? "Сохраняю…" : layer ? "💾 Сохранить титр (MOV с прозрачностью)" : "💾 Сохранить отдельным видео"}
      </button>
    </div>
  );
}

function TemplateFieldInput({ label, value, multiline, onChange }: { label: string; value: string; multiline: boolean; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const done = () => draft !== value && onChange(draft);
  return (
    <Field label={label}>
      {multiline ? (
        <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={done} />
      ) : (
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === "Enter" && done()} />
      )}
    </Field>
  );
}
