import { useEffect, useState } from "react";
import type { MontageExportOptions, MontageOptions, MontageProject } from "../lib/types";
import { fileName } from "../lib/montage";

interface Props {
  options: MontageOptions;
  project: MontageProject;
  onClose: () => void;
  onDone: (paths: string[]) => void;
}

const KEY = "монтаж-экспорт";

/**
 * Экспорт. Можно отметить несколько форматов сразу — «mp4 для Reels, GIF для
 * сайта, mp3 для подкаста» — и они соберутся один за другим. Выбор
 * запоминается: обычно человек экспортирует одно и то же.
 */
export default function MontageExport({ options, project, onClose, onDone }: Props) {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  })();
  const [formats, setFormats] = useState<string[]>(saved?.formats || ["mp4"]);
  const [size, setSize] = useState<string>(saved?.size || "source");
  const [fps, setFps] = useState<number>(saved?.fps || project.canvas.fps);
  const [quality, setQuality] = useState<MontageExportOptions["quality"]>(saved?.quality || "normal");
  const [gifWidth, setGifWidth] = useState<number>(saved?.gifWidth || 480);
  const [gifFps, setGifFps] = useState<number>(saved?.gifFps || 15);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress?: number; index: number; total: number } | null>(null);
  const [results, setResults] = useState<{ name: string; path?: string; error?: string }[]>([]);

  useEffect(() => window.api.onMontageRender((p) => setProgress(p)), []);

  const toggle = (id: string) => setFormats((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const short = Math.min(project.canvas.width, project.canvas.height);

  async function run() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ formats, size, fps, quality, gifWidth, gifFps }));
    } catch {
      // без хранилища выбор просто не запомнится
    }
    setBusy(true);
    setResults([]);
    const targets: MontageExportOptions[] = formats.map((format) => ({ format, size, fps, quality, gifWidth, gifFps }));
    try {
      const r = await window.api.montageExportMany(project, targets);
      const list = r.map((x) => ({ name: options.exportFormats.find((f) => f.id === x.target.format)?.name || x.target.format, path: x.path, error: x.error }));
      setResults(list);
      onDone(list.filter((x) => x.path).map((x) => x.path!));
    } catch (e) {
      setResults([{ name: "Экспорт", error: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const stageName: Record<string, string> = { pieces: "куски", join: "склейка", encode: "кодирование", convert: "перевод в формат", done: "готово" };

  return (
    <div className="mt-modal" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="mt-modal-box">
        <h3>Экспорт «{project.title}»</h3>
        <div className="mt-export-grid">
          <div>
            <h4>Формат (можно несколько)</h4>
            {options.exportFormats.map((f) => (
              <label key={f.id} className="mt-check">
                <input type="checkbox" checked={formats.includes(f.id)} onChange={() => toggle(f.id)} disabled={busy} /> {f.name}
              </label>
            ))}
          </div>
          <div>
            <h4>Размер кадра</h4>
            <select value={size} onChange={(e) => setSize(e.target.value)} disabled={busy}>
              {options.exportSizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.short ? ` → ${Math.round((project.canvas.width * s.short) / short / 2) * 2}×${Math.round((project.canvas.height * s.short) / short / 2) * 2}` : ` (${project.canvas.width}×${project.canvas.height})`}
                </option>
              ))}
            </select>
            <h4>Кадров в секунду</h4>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={busy}>
              {[24, 25, 30, 50, 60].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <h4>Качество</h4>
            <select value={quality} onChange={(e) => setQuality(e.target.value as MontageExportOptions["quality"])} disabled={busy}>
              <option value="high">Высокое (файл больше)</option>
              <option value="normal">Обычное</option>
              <option value="small">Компактное (для мессенджеров)</option>
            </select>
            {formats.includes("gif") && (
              <>
                <h4>GIF</h4>
                <div className="mt-row">
                  <label className="mt-field mt-num"><span>Ширина</span><input type="number" value={gifWidth} onChange={(e) => setGifWidth(Number(e.target.value) || 480)} /></label>
                  <label className="mt-field mt-num"><span>Кадров/с</span><input type="number" value={gifFps} onChange={(e) => setGifFps(Number(e.target.value) || 15)} /></label>
                </div>
                <p className="mt-hint">GIF тяжёлый: 10 секунд при 480 точках — несколько мегабайт.</p>
              </>
            )}
          </div>
        </div>
        {progress && (
          <div className="mt-progress-bar">
            <div style={{ width: `${Math.round((((progress.index || 0) + (progress.stage === "encode" ? progress.progress || 0 : progress.stage === "done" ? 1 : 0.1)) / (progress.total || 1)) * 100)}%` }} />
            <span>
              {progress.total > 1 ? `Формат ${progress.index + 1} из ${progress.total}: ` : ""}
              {stageName[progress.stage] || progress.stage}
              {progress.progress !== undefined && progress.stage === "encode" ? ` ${Math.round(progress.progress * 100)}%` : ""}
            </span>
          </div>
        )}
        {results.map((r, i) => (
          <div key={i} className={r.error ? "mt-error-inline" : "mt-ok"}>
            {r.name}: {r.error ? r.error : fileName(r.path || "")}
            {r.path && (
              <>
                <button className="link-btn" onClick={() => window.api.montageShowItem(r.path!)}>показать в папке</button>
                <button className="link-btn" onClick={() => window.api.montageOpenPath(r.path!)}>открыть</button>
              </>
            )}
          </div>
        ))}
        <div className="mt-row mt-modal-actions">
          {busy ? (
            <button className="btn btn-danger" onClick={() => window.api.montageStop()}>Остановить</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
              <button className="btn btn-primary" disabled={!formats.length} onClick={run}>⬇ Экспортировать {formats.length > 1 ? `(${formats.length})` : ""}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
