import { useState } from "react";
import type { MontageLayer } from "../lib/types";
import { LAYOUTS, layerDuration, layoutCells, newLayer, type MontageLayout } from "../lib/montage";
import { Slider, type EditorCtx } from "./MontageControls";

function LayoutIcon({ l, aspect }: { l: MontageLayout; aspect: number }) {
  const W = 40;
  const H = Math.round(W / aspect);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="3" fill="none" stroke="currentColor" opacity="0.35" />
      {layoutCells(l, 0.04).map((c, i) => (
        <rect key={i} x={c.x * W} y={c.y * H} width={c.w * W} height={c.h * H} rx="2" fill="currentColor" opacity={0.55 + (i % 2) * 0.2} />
      ))}
    </svg>
  );
}

/**
 * Раскладки экрана: несколько видео в кадре — сплит, сетка, окно в углу,
 * карточка. Ячейки получают видео с дорожек над главной в этот момент.
 */
export function LayoutPanel({ ctx }: { ctx: EditorCtx }) {
  const { project, time } = ctx;
  const [gap, setGap] = useState(0.012);
  const [rounded, setRounded] = useState(true);
  const aspect = project.canvas.width / project.canvas.height;
  const here = project.layers.filter((l) => time >= l.start && time < l.start + layerDuration(l)).sort((a, b) => a.track - b.track);

  const apply = async (l: MontageLayout) => {
    const cells = layoutCells(l, l.cells.length === 1 && l.id !== "card" ? 0 : gap);
    const assign = (list: MontageLayer[]) => {
      const ids = list.map((x) => x.id);
      ctx.commit((p) => ({
        ...p,
        layers: p.layers.map((x) => {
          const i = ids.indexOf(x.id);
          return i >= 0 && i < cells.length ? { ...x, cell: cells[i], mask: rounded ? "rounded" : x.mask === "rounded" ? "none" : x.mask } : x;
        }),
      }));
    };
    if (here.length >= cells.length) {
      assign(here);
      ctx.notify(`Раскладка «${l.name}»: ${cells.length} ячеек. Что видно в ячейке — справа, «Кадрирование в ячейке».`);
      return;
    }
    // Ячеек больше, чем видео поверх, — предлагаем выбрать файлы для пустых.
    const missing = cells.length - here.length;
    const files = await window.api.montagePickMedia();
    const picked = files.slice(0, missing);
    const created: MontageLayer[] = [];
    let track = Math.max(0, ...project.layers.map((x) => x.track));
    for (const f of picked) {
      const probe = await window.api.montageProbe(f).catch(() => null);
      const kind = /\.(png|jpe?g|webp|gif|bmp)$/i.test(f) ? "image" : "video";
      const span = Math.max(3, (ctx.duration || 5) - time);
      track = Math.min(8, track + 1);
      created.push({ ...newLayer(f, kind, kind === "image" ? span : probe?.duration || span, time), track });
    }
    if (!here.length && !created.length) {
      ctx.notify("Для раскладки нужны видео поверх главного: перетащите файлы на дорожки «Видео 2», «Видео 3»… или выберите их.");
      return;
    }
    const all = [...here, ...created];
    ctx.commit((p) => ({ ...p, layers: [...p.layers, ...created] }));
    assign(all);
    ctx.addToBin(created.map((c) => ({ path: c.src, kind: c.kind, duration: c.out })));
    ctx.notify(`Раскладка «${l.name}»: заполнено ${Math.min(all.length, cells.length)} из ${cells.length} ячеек.`);
  };

  return (
    <div>
      <h3 className="mt-panel-title">Раскладка и коллаж</h3>
      <p className="mt-hint">
        Несколько видео в кадре: положите их на дорожки «Видео 2», «Видео 3»… (перетаскиванием из «Медиа») и выберите раскладку — ячейки заполнятся по порядку дорожек.
        Сейчас под бегунком видео поверх: {here.length}.
      </p>
      <Slider label="Зазор между ячейками" value={gap} min={0} max={0.04} step={0.002} fmt={(v) => `${Math.round(v * 1000) / 10}%`} onChange={setGap} />
      <label className="mt-check">
        <input type="checkbox" checked={rounded} onChange={(e) => setRounded(e.target.checked)} /> Скруглённые углы
      </label>
      <div className="mt-layout-grid">
        {LAYOUTS.map((l) => (
          <button key={l.id} className="mt-layout" onClick={() => void apply(l)} title={l.name}>
            <LayoutIcon l={l} aspect={aspect} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
      {here.some((l) => l.cell) && (
        <button className="btn btn-secondary btn-block" onClick={() => ctx.commit((p) => ({ ...p, layers: p.layers.map((x) => (here.some((h) => h.id === x.id) ? { ...x, cell: null } : x)) }))}>
          Убрать раскладку под бегунком
        </button>
      )}
      <p className="mt-hint">Главное видео остаётся фоном за ячейками. Готовые коллажи из фото — во вкладке «Титры», группа «Коллажи».</p>
    </div>
  );
}
