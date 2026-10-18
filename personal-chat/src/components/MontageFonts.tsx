import { useEffect, useMemo, useRef, useState } from "react";
import type { MontageFont, MontageFontPair } from "../lib/types";
import { fileName, mediaUrl } from "../lib/montage";

// Шрифты в окне: встроенная библиотека, дизайн-система, система, свой файл.
// В окне шрифт подключается по пути к файлу (@font-face через схему плеера),
// поэтому предпросмотр набирает тем же файлом, что уйдёт в сборку.

type FontData = { library: MontageFont[]; pairs: MontageFontPair[]; categories: Record<string, string> };
let fontData: Promise<FontData> | null = null;
export function loadFonts() {
  if (!fontData) fontData = window.api.montageFonts().catch(() => ({ library: [], pairs: [], categories: {} }));
  return fontData;
}
let systemData: Promise<MontageFont[]> | null = null;
function loadSystemFonts() {
  if (!systemData) systemData = window.api.montageSystemFonts().catch(() => []);
  return systemData;
}

export function useFontData(): FontData {
  const [d, setD] = useState<FontData>({ library: [], pairs: [], categories: {} });
  useEffect(() => {
    let alive = true;
    void loadFonts().then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}

/** Имя семейства в окне для файла шрифта — своё у каждого пути. */
export function cssFamily(path?: string) {
  if (!path) return "";
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return `mtf-${(h >>> 0).toString(36)}`;
}

/** @font-face для набора файлов: грузятся лениво, только когда шрифт виден. */
export function FontFaces({ paths, scheme }: { paths: string[]; scheme: string }) {
  const css = useMemo(
    () =>
      [...new Set(paths.filter(Boolean))]
        .map((p) => `@font-face{font-family:"${cssFamily(p)}";src:url("${mediaUrl(scheme, p)}");font-weight:100 900;font-display:swap}`)
        .join("\n"),
    [paths, scheme]
  );
  return css ? <style>{css}</style> : null;
}

/**
 * Выбор шрифта: список, где каждое имя набрано своим шрифтом. Встроенные (с
 * кириллицей), дизайн-системы, установленные в системе и свой файл.
 */
export function FontPicker({ value, onChange, designFonts = [], label = "Шрифт", allowDefault = true, sample = "Ёлка 2026" }: {
  value: string;
  onChange: (path: string, family: string) => void;
  designFonts?: MontageFont[];
  label?: string;
  allowDefault?: boolean;
  sample?: string;
}) {
  const data = useFontData();
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<MontageFont[]>([]);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void loadSystemFonts().then(setSystem);
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const all = [...data.library, ...designFonts, ...system];
  const current = all.find((f) => f.path === value);
  const match = (f: MontageFont) => !q || f.family.toLowerCase().includes(q.toLowerCase());
  const groups: [string, MontageFont[]][] = [
    ...(designFonts.length ? ([["Дизайн-система", designFonts]] as [string, MontageFont[]][]) : []),
    ...Object.entries(data.categories).map(([id, name]) => [name, data.library.filter((f) => f.category === id)] as [string, MontageFont[]]),
    ["Установлены в системе", system],
  ];
  const item = (f: MontageFont, sys = false) => (
    <button
      key={f.path}
      className={`mt-font-item ${f.path === value ? "on" : ""}`}
      onClick={() => {
        onChange(f.path, f.family);
        setOpen(false);
      }}
      title={f.family}
    >
      <b style={{ fontFamily: sys ? `"${f.family}"` : `"${cssFamily(f.path)}"` }}>{sample}</b>
      <small>{f.family}</small>
    </button>
  );
  return (
    <div className="mt-field mt-font-picker" ref={box}>
      <span>{label}</span>
      <button className="mt-font-current" onClick={() => setOpen((v) => !v)}>
        <b style={{ fontFamily: value ? `"${cssFamily(value)}"` : undefined }}>{current ? current.family : value ? fileName(value) : "как в стиле"}</b>
        <i>▾</i>
      </button>
      {open && (
        <div className="mt-font-pop">
          <FontFaces paths={[...data.library, ...designFonts].map((f) => f.path)} scheme="montage-media" />
          <input autoFocus placeholder="Найти шрифт…" value={q} onChange={(e) => setQ(e.target.value)} />
          {allowDefault && (
            <button className={`mt-font-item ${!value ? "on" : ""}`} onClick={() => { onChange("", ""); setOpen(false); }}>
              <b>Как в стиле</b>
            </button>
          )}
          {groups.map(([name, list]) => {
            const shown = list.filter(match);
            if (!shown.length) return null;
            return (
              <div key={name}>
                <h5>{name}</h5>
                {shown.slice(0, name.startsWith("Установлены") ? 300 : 100).map((f) => item(f, name.startsWith("Установлены")))}
              </div>
            );
          })}
          <button
            className="mt-font-item"
            onClick={async () => {
              const f = await window.api.montagePickFile("font");
              if (f) {
                onChange(f, fileName(f).replace(/\.[^.]+$/, ""));
                setOpen(false);
              }
            }}
          >
            <b>📁 Свой файл шрифта…</b>
          </button>
        </div>
      )}
    </div>
  );
}

/** Карточка шрифтовой пары: пример набран самой парой. */
export function PairCard({ pair, onPick, on, accent = "#F5E27A" }: { pair: MontageFontPair; onPick: () => void; on?: boolean; accent?: string }) {
  const parts = pair.sample.split(/\*([^*]+)\*/);
  return (
    <button className={`mt-pair ${on ? "on" : ""}`} onClick={onPick} title={pair.name}>
      <div className="mt-pair-demo" style={{ letterSpacing: pair.spacing ? `${pair.spacing}em` : undefined }}>
        {parts.map((seg, i) =>
          i % 2 ? (
            <span key={i} style={{ fontFamily: `"${cssFamily(pair.accent.path)}"`, color: accent, fontSize: pair.accent.category === "script" ? "1.3em" : undefined, letterSpacing: 0, textShadow: pair.glow ? `0 0 10px ${accent}` : undefined }}>
              {seg}
            </span>
          ) : (
            <span key={i} style={{ fontFamily: `"${cssFamily(pair.head.path)}"`, textTransform: pair.upper ? "uppercase" : undefined, textShadow: pair.glow ? `0 0 10px ${accent}` : undefined }}>
              {seg}
            </span>
          )
        )}
      </div>
      <small>{pair.name}</small>
    </button>
  );
}
