import { useEffect, useRef, useState } from "react";
import type { MontageClip, MontageErase } from "../lib/types";
import { fmtTime } from "../lib/montage";

/**
 * Удаление водяного знака: на кадре исходника обводится знак, программа
 * заменяет его фоном из того же кадра. «До/после» — настоящий кадр из
 * ffmpeg тем же графом, что пойдёт в сборку, а не приближение.
 */
export default function EraseDialog({ clip, at, onSave, onClose }: { clip: MontageClip; at: number; onSave: (erase: MontageErase[]) => void; onClose: () => void }) {
  const [list, setList] = useState<MontageErase[]>(clip.erase || []);
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [showAfter, setShowAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api
      .montageEraseFrame(clip.src, at, [])
      .then((r) => setBefore(r.uri))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [clip.src, at]);

  const refresh = async (l: MontageErase[]) => {
    if (!l.length) {
      setAfter("");
      return;
    }
    setBusy(true);
    try {
      setAfter((await window.api.montageEraseFrame(clip.src, at, l)).uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const update = (l: MontageErase[]) => {
    setList(l);
    void refresh(l);
  };

  const pos = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  return (
    <div className="mt-overlay" onMouseDown={onClose}>
      <div className="mt-overlay-card mt-erase" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mt-row">
          <h3 className="mt-panel-title">Убрать водяной знак</h3>
          <div className="mt-spacer" />
          <button className="btn btn-primary" onClick={() => { onSave(list); onClose(); }}>Готово</button>
          <button className="link-btn" onClick={onClose}>отмена</button>
        </div>
        <p className="mt-hint">
          Обведите знак мышью — можно несколько. Он заменится фоном из того же кадра: текстура берётся с соседнего участка, цвет и свет — по краям знака, поэтому
          не остаётся ни мыльного пятна, ни контура. Кадр {fmtTime(at, true)}; знак должен стоять на месте весь кусок.
        </p>
        {error && <div className="mt-error-inline">{error}</div>}
        <div
          ref={box}
          className="mt-erase-frame"
          onMouseDown={(e) => {
            if (showAfter) return;
            const p = pos(e);
            setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          }}
          onMouseMove={(e) => {
            if (!draft) return;
            const p = pos(e);
            setDraft({ ...draft, x1: p.x, y1: p.y });
          }}
          onMouseUp={() => {
            if (!draft) return;
            const r = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
            setDraft(null);
            if (r.w > 0.01 && r.h > 0.01) {
              update([...list, { ...r, mode: "clone", from: "auto" }]);
              setShowAfter(true);
            }
          }}
        >
          {before ? <img src={showAfter && after ? after : before} alt="" draggable={false} /> : <div className="mt-hint">Загружаю кадр…</div>}
          {!showAfter &&
            list.map((r, i) => (
              <div key={i} className="mt-erase-rect" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
                <b>{i + 1}</b>
              </div>
            ))}
          {draft && (
            <div
              className="mt-erase-rect draft"
              style={{ left: `${Math.min(draft.x0, draft.x1) * 100}%`, top: `${Math.min(draft.y0, draft.y1) * 100}%`, width: `${Math.abs(draft.x1 - draft.x0) * 100}%`, height: `${Math.abs(draft.y1 - draft.y0) * 100}%` }}
            />
          )}
          {busy && <div className="mt-erase-busy"><i className="mt-spinner" /></div>}
        </div>
        <div className="mt-row">
          <button className={`btn ${!showAfter ? "btn-primary" : "btn-secondary"}`} onClick={() => setShowAfter(false)}>До (обвести)</button>
          <button className={`btn ${showAfter ? "btn-primary" : "btn-secondary"}`} disabled={!list.length} onClick={() => setShowAfter(true)}>После</button>
        </div>
        {list.map((r, i) => (
          <div key={i} className="mt-row mt-erase-item">
            <b>{i + 1}</b>
            <select value={r.mode} onChange={(e) => update(list.map((x, j) => (j === i ? { ...x, mode: e.target.value as MontageErase["mode"] } : x)))}>
              <option value="clone">Заменить фоном (текстура)</option>
              <option value="smooth">Сгладить по краям (ровный фон)</option>
            </select>
            {r.mode === "clone" && (
              <select value={r.from} onChange={(e) => update(list.map((x, j) => (j === i ? { ...x, from: e.target.value as MontageErase["from"] } : x)))} title="Откуда брать фон">
                <option value="auto">фон: авто</option>
                <option value="left">фон слева</option>
                <option value="right">фон справа</option>
                <option value="up">фон сверху</option>
                <option value="down">фон снизу</option>
              </select>
            )}
            <button className="link-btn" onClick={() => update(list.filter((_, j) => j !== i))}>убрать</button>
          </div>
        ))}
        <p className="mt-hint">Если в «После» видна повторённая деталь — смените, откуда брать фон. Для знака на однотонном фоне подходит «Сгладить по краям».</p>
      </div>
    </div>
  );
}
