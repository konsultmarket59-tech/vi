import { useEffect, useMemo, useRef, useState } from "react";
import type { MontageCaptions, MontageCleanupStats, MontageStockItem, MontageText } from "../lib/types";
import { captionCss, endDrag, fileName, fmtTime, layout, mediaUrl, outputToSource, setDrag, uid } from "../lib/montage";
import { Field, Slider, type BinItem, type EditorCtx } from "./MontageControls";
import { FontFaces, FontPicker, PairCard, useFontData } from "./MontageFonts";

// ---------- медиа ----------

function BinCard({ item, ctx }: { item: BinItem; ctx: EditorCtx }) {
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    if (item.kind === "audio") return;
    window.api.montageThumbs(item.path, { count: 1, height: 90 }).then(setThumb).catch(() => {});
  }, [item.path, item.kind]);
  return (
    <div className="mt-bin-card" title={`${item.path}\nПеретащите на дорожку таймлайна — в нужное место и на нужную дорожку`} draggable onDragStart={(e) => setDrag(e, { type: "media", path: item.path, kind: item.kind, duration: item.duration })} onDragEnd={endDrag}>
      <div className="mt-bin-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} onClick={() => ctx.place(item, item.kind === "audio" ? "music" : "main")}>
        {item.kind === "audio" ? "♪" : !thumb ? "…" : ""}
        {item.duration > 0 && <i>{fmtTime(item.duration)}</i>}
      </div>
      <span>{fileName(item.path)}</span>
      <div className="mt-bin-actions">
        {item.kind === "audio" ? (
          <>
            <button onClick={() => ctx.place(item, "music")} title="Музыкой под ролик">♪</button>
            <button onClick={() => ctx.place(item, "sfx")} title="Звуковым эффектом под бегунок">✺</button>
            <button onClick={() => ctx.place(item, "voice")} title="Голосом / озвучкой">🎙</button>
          </>
        ) : (
          <>
            <button onClick={() => ctx.place(item, "main")} title="На главную дорожку">＋</button>
            <button onClick={() => ctx.place(item, "layer")} title="Слоем поверх — картинка в картинке">▣</button>
          </>
        )}
      </div>
    </div>
  );
}

export function MediaPanel({ ctx }: { ctx: EditorCtx }) {
  async function importMedia() {
    const picked = await window.api.montagePickMedia();
    if (!picked.length) return;
    const items: BinItem[] = [];
    for (const p of picked) {
      const probe = await window.api.montageProbe(p).catch(() => null);
      const kind = /\.(png|jpe?g|webp|gif|bmp)$/i.test(p) ? "image" : probe && !probe.hasVideo ? "audio" : "video";
      items.push({ path: p, kind, duration: probe?.duration || 0 });
    }
    ctx.addToBin(items);
  }
  return (
    <>
      <button className="btn btn-secondary btn-block" onClick={importMedia}>+ Импорт файлов</button>
      {!ctx.bin.length && <p className="mt-hint">Видео, картинки, стикеры и музыка этого проекта. ＋ — на главную дорожку, ▣ — слоем поверх кадра.</p>}
      <div className="mt-bin">
        {ctx.bin.map((b) => (
          <BinCard key={b.path} item={b} ctx={ctx} />
        ))}
      </div>
    </>
  );
}

// ---------- сток ----------

const STOCK_KINDS = [
  { id: "video", name: "Видео" },
  { id: "image", name: "Фото" },
  { id: "music", name: "Музыка" },
  { id: "sfx", name: "Звуки" },
] as const;

export function StockPanel({ ctx }: { ctx: EditorCtx }) {
  const [kind, setKind] = useState<(typeof STOCK_KINDS)[number]["id"]>("video");
  const providers = ctx.options.stockProviders.filter((p) => p.kinds.includes(kind));
  const [provider, setProvider] = useState(providers[0]?.id || "");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MontageStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!providers.some((p) => p.id === provider)) setProvider(providers[0]?.id || "");
  }, [kind, provider, providers]);
  useEffect(() => window.api.onMontageStock((d) => setProgress((p) => ({ ...p, [`${d.provider}:${d.id}`]: d.progress }))), []);

  const prov = ctx.options.stockProviders.find((p) => p.id === provider);
  const orientation = ctx.project.canvas.height > ctx.project.canvas.width ? "portrait" : ctx.project.canvas.width > ctx.project.canvas.height ? "landscape" : "square";

  async function search() {
    setErr("");
    setLoading(true);
    try {
      setItems(await window.api.montageStockSearch({ provider, kind, query, orientation: kind === "video" || kind === "image" ? orientation : undefined }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function take(item: MontageStockItem, where: "main" | "layer" | "music" | "sfx") {
    setErr("");
    try {
      const path = await window.api.montageStockDownload(item);
      const bin: BinItem = { path, kind: item.kind === "music" || item.kind === "sfx" ? "audio" : item.kind, duration: item.duration || (item.kind === "image" ? 3 : 0) };
      if (!bin.duration && bin.kind !== "image") bin.duration = (await window.api.montageProbe(path).catch(() => ({ duration: 5 }))).duration;
      ctx.addToBin([bin]);
      ctx.place(bin, where);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="mt-tabs small">
        {STOCK_KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => { setKind(k.id); setItems([]); }}>{k.name}</button>
        ))}
      </div>
      <select value={provider} onChange={(e) => { setProvider(e.target.value); setItems([]); }}>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {prov?.key && (
        <div className="mt-row">
          <input type="password" placeholder={`ключ ${prov.name}`} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
          <button className="btn btn-secondary" disabled={!keyDraft} onClick={async () => { await window.api.montageSaveAvatarKeys({ [prov.key]: keyDraft }); setKeyDraft(""); ctx.notify(`Ключ ${prov.name} сохранён.`); }}>ОК</button>
        </div>
      )}
      {prov?.key && <p className="mt-hint">Ключ бесплатный: <a href={prov.keyUrl} target="_blank" rel="noreferrer">{prov.keyUrl}</a>. Если уже вводили — поле можно не трогать.</p>}
      <form className="mt-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input placeholder={kind === "sfx" ? "whoosh, click, applause…" : kind === "music" ? "upbeat, lofi, corporate…" : "город, офис, природа…"} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-primary" disabled={!query.trim() || loading}>{loading ? "…" : "Найти"}</button>
      </form>
      {(kind === "music" || kind === "sfx") && <p className="mt-hint">Сток ищет лучше по-английски. Openverse работает без ключа.</p>}
      {err && <div className="mt-error-inline">{err}</div>}
      <audio ref={audioRef} />
      <div className={kind === "video" || kind === "image" ? "mt-stock-grid" : "mt-stock-list"}>
        {items.map((it) => {
          const p = progress[`${it.provider}:${it.id}`];
          return kind === "video" || kind === "image" ? (
            <div key={it.id} className="mt-stock-card" title={`${it.title}\n${it.author} · ${it.license}`}>
              <div className="mt-bin-thumb" style={{ backgroundImage: `url(${it.thumb})` }}>
                {it.duration > 0 && <i>{fmtTime(it.duration)}</i>}
                {p !== undefined && p < 1 && <b className="mt-dl">{Math.round(p * 100)}%</b>}
              </div>
              <div className="mt-bin-actions">
                <button onClick={() => take(it, "main")} title="Скачать и на главную дорожку">＋</button>
                <button onClick={() => take(it, "layer")} title="Скачать и слоем поверх">▣</button>
              </div>
            </div>
          ) : (
            <div key={it.id} className="mt-stock-row">
              <button className="link-btn" title="Послушать" onClick={() => { const a = audioRef.current; if (!a) return; if (a.src === it.url && !a.paused) a.pause(); else { a.src = it.url; void a.play(); } }}>▶</button>
              <span title={`${it.author} · ${it.license}`}>{it.title} <small>{fmtTime(it.duration)} · {it.license}</small></span>
              <button className="btn btn-secondary" onClick={() => take(it, kind === "sfx" ? "sfx" : "music")}>{p !== undefined && p < 1 ? `${Math.round(p * 100)}%` : "＋"}</button>
            </div>
          );
        })}
      </div>
      {!items.length && !loading && !err && <p className="mt-hint">Скачанное ложится в папку проекта «сток», с записью об авторе и лицензии. Если лицензия просит подпись автора, она попадёт в описание рядом с роликом.</p>}
    </>
  );
}

// ---------- звуки ----------

export function AudioPanel({ ctx }: { ctx: EditorCtx }) {
  const [playingId, setPlayingId] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const groups = useMemo(() => [...new Set(ctx.options.sfx.map((s) => s.group))], [ctx.options.sfx]);
  const { project } = ctx;

  async function preview(id: string) {
    const path = await window.api.montageSfx(id);
    const a = audioRef.current;
    if (!a) return;
    a.src = mediaUrl(ctx.scheme, path);
    setPlayingId(id);
    void a.play();
  }
  async function add(id: string, at = ctx.time) {
    const path = await window.api.montageSfx(id);
    const d = (await window.api.montageProbe(path).catch(() => ({ duration: 1 }))).duration || 1;
    ctx.place({ path, kind: "audio", duration: d }, "sfx");
    void at;
  }

  /**
   * Звуки по монтажу одним нажатием: «вжух» на каждый переход и «поп» на
   * каждую надпись. Так делают монтажёры коротких роликов вручную.
   */
  async function autoSfx() {
    const whoosh = await window.api.montageSfx("swoosh");
    const pop = await window.api.montageSfx("pop");
    const { items } = layout(project.clips);
    const add: typeof project.audio = [];
    project.clips.forEach((c, i) => {
      if (i > 0 && c.transition.kind !== "none") add.push({ id: uid("audio"), kind: "sfx", effect: "none", src: whoosh, start: Math.max(0, items[i].start - 0.15), in: 0, out: 0.4, volume: 0.8, fadeIn: 0, fadeOut: 0.05, duck: false, loop: false });
    });
    for (const t of project.texts) add.push({ id: uid("audio"), kind: "sfx", effect: "none", src: pop, start: t.start, in: 0, out: 0.15, volume: 0.9, fadeIn: 0, fadeOut: 0.02, duck: false, loop: false });
    if (!add.length) return ctx.notify("Нет ни переходов, ни надписей — звуку не на что встать.");
    ctx.commit((p) => ({ ...p, audio: [...p.audio, ...add] }));
    ctx.notify(`Добавлено звуков: ${add.length}.`);
  }

  return (
    <>
      <button className="btn btn-primary btn-block" onClick={autoSfx}>✨ Звуки на переходы и надписи</button>
      <button
        className="btn btn-secondary btn-block"
        onClick={async () => {
          const f = await window.api.montagePickFile("audio");
          if (!f) return;
          const d = (await window.api.montageProbe(f).catch(() => ({ duration: 30 }))).duration || 30;
          ctx.addToBin([{ path: f, kind: "audio", duration: d }]);
          ctx.place({ path: f, kind: "audio", duration: d }, "music");
        }}
      >
        + Своя музыка
      </button>
      <audio ref={audioRef} onEnded={() => setPlayingId("")} />
      {groups.map((g) => (
        <div key={g}>
          <h4>{g}</h4>
          {ctx.options.sfx.filter((s) => s.group === g).map((s) => (
            <div key={s.id} className="mt-stock-row">
              <button className="link-btn" onClick={() => preview(s.id)}>{playingId === s.id ? "♫" : "▶"}</button>
              <span>{s.name}</span>
              <button className="btn btn-secondary" onClick={() => add(s.id)} title="Под бегунок">＋</button>
            </div>
          ))}
        </div>
      ))}
      <h4>Звук ролика</h4>
      <label className="mt-check">
        <input type="checkbox" checked={project.audioFx.loudnorm} onChange={(e) => ctx.commit((p) => ({ ...p, audioFx: { ...p.audioFx, loudnorm: e.target.checked } }))} />
        Громкость под соцсети (−14 LUFS)
      </label>
      <label className="mt-check">
        <input type="checkbox" checked={project.audioFx.denoise} onChange={(e) => ctx.commit((p) => ({ ...p, audioFx: { ...p.audioFx, denoise: e.target.checked } }))} />
        Убрать шум (гул, шипение)
      </label>
      <p className="mt-hint">Звуки собираются самим приложением — без интернета и без вопросов с правами. Больше — во вкладке «Сток».</p>
    </>
  );
}

// ---------- текст ----------

export function TextPanel({ ctx }: { ctx: EditorCtx }) {
  const fonts = useFontData();
  const add = (style: string, text: string, extra: Partial<MontageText> = {}) => {
    const t: MontageText = { id: uid("text"), text, start: Math.round(ctx.time * 1000) / 1000, end: Math.round((ctx.time + 2.5) * 1000) / 1000, style, animation: style === "lower" ? "slide" : "pop", position: "", size: 0, color: "", bg: "", upper: true, x: null, y: null, ...extra };
    ctx.commit((p) => ({ ...p, texts: [...p.texts, t] }));
    ctx.setSelection({ kind: "text", id: t.id });
  };
  return (
    <>
      <p className="mt-hint">Надпись встаёт под бегунок. Её можно перетащить мышью прямо в кадре.</p>
      <h4>Шрифтовые пары</h4>
      <p className="mt-hint">Крупный шрифт и рукописный акцент. *Слово в звёздочках* — вторым шрифтом.</p>
      <FontFaces paths={fonts.pairs.flatMap((p) => [p.head.path, p.accent.path])} scheme={ctx.scheme} />
      <div className="mt-pair-grid">
        {fonts.pairs.map((p) => (
          <PairCard
            key={p.id}
            pair={p}
            accent={ctx.project.captions.highlight}
            onPick={() =>
              add("title", p.sample, {
                fontPath: p.head.path,
                accentFontPath: p.accent.path,
                accentScale: p.accent.category === "script" ? 1.3 : 1,
                spacing: p.spacing || 0,
                glow: !!p.glow,
                upper: p.upper,
                size: 96,
                animation: "fade",
              })
            }
          />
        ))}
      </div>
      <h4>Простые надписи</h4>
      {ctx.options.textStyles.map((s) => (
        <button key={s.id} className={`mt-text-preset s-${s.id}`} onClick={() => add(s.id, s.id === "hook" ? "Хук ролика" : s.id === "lower" ? "Имя · должность" : s.name)}>
          {s.name}
        </button>
      ))}
    </>
  );
}

// ---------- субтитры ----------

export function CaptionsPanel({ ctx }: { ctx: EditorCtx }) {
  const cap = ctx.project.captions;
  const set = (patch: Partial<MontageCaptions>) => ctx.setCaptions(patch);
  const transcribed = ctx.sources.filter((s) => ctx.transcripts[s]).length;
  return (
    <>
      <label className="mt-check">
        <input type="checkbox" checked={cap.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Субтитры по словам
      </label>
      {ctx.sources.length > transcribed && (
        <>
          <p className="mt-hint">Расшифровано записей: {transcribed} из {ctx.sources.length}. Субтитры берутся из расшифровки.</p>
          <button className="btn btn-secondary btn-block" disabled={!!ctx.busy} onClick={ctx.transcribeSources}>Расшифровать</button>
        </>
      )}
      <div className="mt-cap-styles">
        {ctx.options.captionStyles.map((s) => {
          const css = captionCss(s, { ...cap, size: 150 });
          return (
            <button key={s.id} className={`mt-cap-style ${cap.style === s.id ? "on" : ""}`} onClick={() => set({ style: s.id, enabled: true })} title={s.hint}>
              <b className="demo" style={{ ...css.base, fontSize: 13, WebkitTextStroke: css.base.WebkitTextStroke ? "0.6px #000" : undefined }}>
                {s.reveal === "word" ? <span style={css.active}>СЛОВО</span> : <>это<span style={{ ...css.active, display: "inline-block", marginLeft: "0.3em" }}>слово</span></>}
              </b>
              <small>{s.name}</small>
            </button>
          );
        })}
      </div>
      <FontPicker
        label="Шрифт субтитров"
        value={cap.fontPath || ""}
        designFonts={ctx.design?.fontFiles || []}
        sample="Субтитры"
        onChange={(path, family) => set({ fontPath: path, font: family })}
      />
      <Slider label="Размер" value={cap.size} min={36} max={160} step={2} onChange={(v) => set({ size: v })} />
      <div className="mt-row">
        <Field label="Цвет"><input type="color" value={cap.color} onChange={(e) => set({ color: e.target.value })} /></Field>
        <Field label="Акцент"><input type="color" value={cap.highlight} onChange={(e) => set({ highlight: e.target.value })} /></Field>
      </div>
      <Field label="Где">
        <select value={cap.position} onChange={(e) => set({ position: e.target.value as MontageCaptions["position"] })}>
          <option value="bottom">снизу</option>
          <option value="center">по центру</option>
          <option value="top">сверху</option>
        </select>
      </Field>
      <Slider label="Слов в строке (не больше)" value={cap.wordsPerLine} min={1} max={8} step={1} onChange={(v) => set({ wordsPerLine: v })} />
      <label className="mt-check">
        <input type="checkbox" checked={cap.upper} onChange={(e) => set({ upper: e.target.checked })} />
        ЗАГЛАВНЫМИ
      </label>
    </>
  );
}

// ---------- эффекты, фильтры, переходы ----------

/** Куда применить: к выбранному куску или слою; если ничего не выбрано — к куску под бегунком. */
function useTarget(ctx: EditorCtx) {
  const { selection, project, time } = ctx;
  if (selection?.kind === "layer") {
    const l = project.layers.find((x) => x.id === selection.id);
    if (l) return { kind: "layer" as const, id: l.id, name: `слой «${fileName(l.src)}»` };
  }
  const id = selection?.kind === "clip" ? selection.id : outputToSource(project.clips, time)?.clip.id;
  const c = project.clips.find((x) => x.id === id);
  return c ? { kind: "clip" as const, id: c.id, name: `кусок «${fileName(c.src)}»`, src: c.src, at: c.in } : null;
}

export function EffectsPanel({ ctx }: { ctx: EditorCtx }) {
  const target = useTarget(ctx);
  const groups = [...new Set(ctx.options.effects.map((e) => e.group))];
  const apply = (kind: string, all = false) => {
    const fx = { id: uid("fx"), kind, amount: 0.5 };
    ctx.commit((p) => ({
      ...p,
      clips: p.clips.map((c) => ((all || (target?.kind === "clip" && c.id === target.id)) ? { ...c, effects: [...c.effects, { ...fx, id: uid("fx") }] } : c)),
      layers: p.layers.map((l) => (!all && target?.kind === "layer" && l.id === target.id ? { ...l, effects: [...l.effects, fx] } : l)),
    }));
    ctx.notify(all ? "Эффект добавлен ко всем кускам. Сила — в настройках куска справа." : `Эффект добавлен: ${target?.name}. Сила — справа.`);
  };
  return (
    <>
      <p className="mt-hint">Перетащите эффект на кусок или слой на таймлайне — или прямо в кадр. Щелчок — к выбранному{target ? ` (${target.name})` : ""}, Alt+щелчок — ко всем. Силу меняют справа.</p>
      {groups.map((g) => (
        <div key={g}>
          <h4>{g}</h4>
          <div className="mt-chip-grid">
            {ctx.options.effects.filter((e) => e.group === g).map((e) => (
              <button key={e.id} className="mt-fx-chip" draggable onDragStart={(ev) => setDrag(ev, { type: "effect", id: e.id, name: e.name })} onDragEnd={endDrag} onClick={(ev) => target && apply(e.id, ev.altKey)} title="Перетащите на кусок на таймлайне или в кадр. Щелчок — к выбранному, Alt+щелчок — ко всем кускам">
                <span className="mt-fx-swatch" style={{ filter: e.css.filter || undefined }} />
                {e.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function FiltersPanel({ ctx }: { ctx: EditorCtx }) {
  const target = useTarget(ctx);
  const [thumb, setThumb] = useState("");
  const src = target?.kind === "clip" ? target.src : target?.kind === "layer" ? ctx.project.layers.find((l) => l.id === target.id)?.src : "";
  const at = target?.kind === "clip" ? target.at : 0;
  useEffect(() => {
    if (!src) {
      setThumb("");
      return;
    }
    window.api.montageThumbs(src, { count: 1, height: 120, from: at }).then(setThumb).catch(() => {});
  }, [src, at]);
  const current = target?.kind === "clip" ? ctx.project.clips.find((c) => c.id === target.id)?.adjust.filter : target?.kind === "layer" ? ctx.project.layers.find((l) => l.id === target.id)?.adjust.filter : "";
  const apply = (filter: string, all = false) => {
    ctx.commit((p) => ({
      ...p,
      clips: p.clips.map((c) => (all || (target?.kind === "clip" && c.id === target.id) ? { ...c, adjust: { ...c.adjust, filter } } : c)),
      layers: p.layers.map((l) => (!all && target?.kind === "layer" && l.id === target.id ? { ...l, adjust: { ...l.adjust, filter } } : l)),
    }));
  };
  const groups = [...new Set(ctx.options.filters.map((f) => f.group))];
  return (
    <>
      <p className="mt-hint">Перетащите фильтр на кусок на таймлайне или в кадр. Щелчок — к выбранному{target ? ` (${target.name})` : ""}, Alt+щелчок — ко всему ролику. Сила и свой LUT — справа.</p>
      {groups.map((g) => (
        <div key={g || "none"}>
          {g && <h4>{g}</h4>}
          <div className="mt-filter-grid">
            {ctx.options.filters.filter((f) => f.group === g).map((f) => (
              <button key={f.id} className={`mt-filter ${current === f.id ? "on" : ""}`} draggable onDragStart={(ev) => setDrag(ev, { type: "filter", id: f.id, name: f.name })} onDragEnd={endDrag} onClick={(e) => target && apply(f.id, e.altKey)}>
                <span style={{ backgroundImage: thumb ? `url(${thumb})` : undefined, filter: f.css || undefined }} />
                <small>{f.name}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function TransitionsPanel({ ctx }: { ctx: EditorCtx }) {
  const { project, time } = ctx;
  const [dur, setDur] = useState(0.4);
  // Стык под бегунком: переход ставится на кусок, который начинается ближе всего.
  const { items } = layout(project.clips);
  let joint = -1;
  let best = Infinity;
  items.forEach((it, i) => {
    if (i === 0) return;
    const d = Math.abs(it.start - time);
    if (d < best) {
      best = d;
      joint = i;
    }
  });
  if (ctx.selection?.kind === "clip") {
    const i = project.clips.findIndex((c) => c.id === ctx.selection!.id);
    if (i > 0) joint = i;
  }
  const apply = (kind: string, all = false) =>
    ctx.commit((p) => ({ ...p, clips: p.clips.map((c, i) => (i > 0 && (all || i === joint) ? { ...c, transition: { kind, duration: dur } } : c)) }));
  const cur = joint > 0 ? project.clips[joint].transition.kind : "";
  return (
    <>
      <p className="mt-hint">Перетащите переход на кусок — он встанет на стык перед ним. Щелчок — {joint > 0 ? `на стык перед куском ${joint + 1} (${fmtTime(items[joint].start, true)})` : "нужно хотя бы два куска"}, Alt+щелчок — на все стыки.</p>
      <Slider label="Длительность" value={dur} min={0.1} max={2} step={0.05} fmt={(v) => `${v} с`} onChange={setDur} />
      <div className="mt-chip-grid">
        {ctx.options.transitions.map((t) => (
          <button key={t.id} className={`mt-fx-chip ${cur === t.id ? "on" : ""}`} draggable onDragStart={(ev) => setDrag(ev, { type: "transition", id: t.id, name: t.name })} onDragEnd={endDrag} onClick={(e) => joint > 0 && apply(t.id, e.altKey)} title="Перетащите на кусок — переход встанет на его начало">
            <span className={`mt-tr-demo t-${t.css}`} />
            {t.name}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------- дизайн и ИИ ----------

export function DesignPanel({ ctx }: { ctx: EditorCtx }) {
  const { project, design } = ctx;
  return (
    <>
      <button
        className="btn btn-secondary btn-block"
        onClick={async () => {
          const dir = await window.api.montagePickFolder("Папка дизайн-системы");
          if (dir) ctx.commit((p) => ({ ...p, design: { dir } }));
        }}
      >
        {project.design ? "Сменить дизайн-систему" : "Подключить дизайн-систему"}
      </button>
      {design && (
        <>
          <div className="mt-swatches">
            {design.colours.slice(0, 12).map((c) => (
              <span key={c} style={{ background: c }} title={`${c} — сделать акцентом субтитров и надписей`} onClick={() => ctx.setCaptions({ highlight: c })} />
            ))}
          </div>
          <p className="mt-hint">
            {design.fontFiles.length ? `Шрифты: ${design.fontFiles.map((f) => f.family).join(", ")}` : "Файлов шрифтов в системе нет."}
            {design.logoFiles?.length ? ` Логотипы: ${design.logoFiles.map((l) => l.name).join(", ")}.` : ""}
          </p>
          <button className="btn btn-primary btn-block" onClick={() => ctx.applyDesign(design)}>Применить к ролику</button>
        </>
      )}
      <h4>Логотип</h4>
      <div className="mt-row">
        <button
          className="btn btn-secondary"
          onClick={async () => {
            const f = await window.api.montagePickFile("image");
            if (f) ctx.commit((p) => ({ ...p, logo: { path: f, corner: p.logo?.corner || "top-right", size: p.logo?.size || 0.14, opacity: 1 } }));
          }}
        >
          {project.logo ? "Другой файл" : "Выбрать файл"}
        </button>
        {project.logo && <button className="link-btn" onClick={() => ctx.commit((p) => ({ ...p, logo: null }))}>убрать</button>}
      </div>
      {project.logo && (
        <>
          <Field label="Угол">
            <select value={project.logo.corner} onChange={(e) => ctx.commit((p) => ({ ...p, logo: { ...p.logo!, corner: e.target.value } }))}>
              <option value="top-left">сверху слева</option>
              <option value="top-right">сверху справа</option>
              <option value="bottom-left">снизу слева</option>
              <option value="bottom-right">снизу справа</option>
            </select>
          </Field>
          <Slider label="Размер" value={project.logo.size} min={0.04} max={0.4} step={0.01} fmt={(v) => `${Math.round(v * 100)}% ширины`} onChange={(v) => ctx.commit((p) => ({ ...p, logo: { ...p.logo!, size: v } }))} />
          <Slider label="Непрозрачность" value={project.logo.opacity} min={0.1} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ctx.commit((p) => ({ ...p, logo: { ...p.logo!, opacity: v } }))} />
        </>
      )}
      <h4>Фон кадра</h4>
      <input type="color" value={project.canvas.background} onChange={(e) => ctx.commit((p) => ({ ...p, canvas: { ...p.canvas, background: e.target.value } }))} />
    </>
  );
}

export function AIPanel({ ctx, onMotion }: { ctx: EditorCtx; onMotion: () => void }) {
  const [stats, setStats] = useState<MontageCleanupStats | null>(null);
  const { project, transcripts } = ctx;
  useEffect(() => {
    if (!project.clips.length) return;
    window.api.montageCleanupStats({ clips: project.clips }).then(setStats).catch(() => setStats(null));
  }, [project.clips, transcripts]);
  return (
    <>
      <h4>Паузы и паразиты</h4>
      {stats && (
        <p className="mt-hint">
          Сейчас {fmtTime(stats.before)} → станет {fmtTime(stats.after)}. Звуков «э-э»: {stats.removedSounds}, паразитов: {stats.removedWords}, запинок: {stats.removedRepeats}.
          {stats.untranscribed ? ` Без расшифровки кусков: ${stats.untranscribed} — их чистка не тронет.` : ""}
        </p>
      )}
      {ctx.sources.some((s) => !transcripts[s]) && (
        <button className="btn btn-secondary btn-block" disabled={!!ctx.busy} onClick={ctx.transcribeSources}>Расшифровать записи проекта</button>
      )}
      <button className="btn btn-primary btn-block" disabled={!!ctx.busy} onClick={() => ctx.cleanup(false)}>🧹 Почистить весь ролик</button>
      <button className="btn btn-secondary btn-block" disabled={!!ctx.busy || ctx.selection?.kind !== "clip"} onClick={() => ctx.cleanup(true)}>Только выбранный кусок</button>
      <p className="mt-hint">
        Режется по словам: «э-э» и «м-м» всегда, паузы — до короткого вдоха, запинки «я я», паразиты — по настройке во вкладке «ИИ-монтажёр».
        Каждый второй кусок слегка приближается, чтобы рез не выглядел прыжком.
      </p>
      <h4>Моушн-дизайн</h4>
      <p className="mt-hint">Плашки, инфографика и сцены со швами — в «Видео-сторис», поверх собранного ролика, с текстом и дизайн-системой проекта.</p>
      <button className="btn btn-secondary btn-block" onClick={onMotion}>✨ Собрать и отправить в «Видео-сторис»</button>
    </>
  );
}
