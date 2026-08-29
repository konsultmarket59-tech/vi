export interface ChartSeries {
  name: string;
  data: number[];
}

export interface ChartSpec {
  type: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  series: ChartSeries[];
}

/*
 * Серии графика в фирменной палитре.
 *
 * Порядок — не украшение, а условие читаемости: он проверен так, чтобы соседние
 * серии различались и в обычном зрении, и при дальтонизме (протанопия/дейтеранопия/
 * тританопия), и чтобы каждый цвет был виден на всех трёх фонах приложения
 * (#F7F6F3, #F7ECE7, белый) с контрастом не ниже 3:1. Поэтому цвета взяты не прямо
 * из брендовой рампы: чистый #00D9FF на светлом фоне имеет контраст 1.6:1 — его не
 * видно, поэтому здесь он затемнён до #0095B0. Охра #8A6A00 в рампу бренда не входит,
 * но без неё четвёртая серия сливается с остальными: рампа «розовый → фиолетовый →
 * циан» аналоговая, и шести различимых цветов из неё не выходит.
 *
 * Первые четыре цвета различимы между собой в любых сочетаниях; с пятого
 * различимость гарантирована только для соседних пар, поэтому легенда с подписями
 * обязательна — она и рисуется всегда.
 */
const DEFAULT_PALETTE = ["#ff2f6d", "#7b3fd4", "#0095b0", "#8a6a00", "#b23cc4", "#0e8c7a", "#c4004a"];

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function palette(accent: string): string[] {
  return [accent, ...DEFAULT_PALETTE.filter((c) => c.toLowerCase() !== accent.toLowerCase())];
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function formatNum(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n * 100) / 100);
}

function truncateLabel(label: string, max = 14): string {
  const s = String(label);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function wrapError(message: string): string {
  return `<p style="color:#b3261e;font-style:italic;">Не удалось построить график: ${esc(message)}</p>`;
}

export function renderChartSvg(spec: ChartSpec, accentColor = "#ff2f6d"): string {
  if (!spec || typeof spec !== "object") return wrapError("пустые данные");
  if (!Array.isArray(spec.labels) || spec.labels.length === 0) return wrapError("не указаны подписи (labels)");
  if (!Array.isArray(spec.series) || spec.series.length === 0) return wrapError("не указаны данные (series)");

  const colors = palette(accentColor);
  try {
    if (spec.type === "pie") return renderPie(spec, colors);
    if (spec.type === "line") return renderCartesian(spec, colors, "line");
    return renderCartesian(spec, colors, "bar");
  } catch (e) {
    return wrapError(e instanceof Error ? e.message : String(e));
  }
}

function chartWrapper(title: string | undefined, svgBody: string, width: number, height: number, legend: string): string {
  return `<div class="pc-chart">${title ? `<div class="pc-chart-title">${esc(title)}</div>` : ""}<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;height:auto;font-family:Arial,sans-serif;">${svgBody}</svg>${legend}</div>`;
}

function renderLegend(items: { color: string; label: string }[]): string {
  if (items.length <= 1) return "";
  return `<div class="pc-chart-legend">${items
    .map((i) => `<span class="pc-legend-item"><span class="pc-legend-dot" style="background:${i.color}"></span>${esc(i.label)}</span>`)
    .join("")}</div>`;
}

function renderCartesian(spec: ChartSpec, colors: string[], kind: "bar" | "line"): string {
  const width = 640;
  const height = 360;
  const margin = { top: 30, right: 20, bottom: 50, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const allValues = spec.series.flatMap((s) => s.data);
  const maxVal = niceMax(Math.max(0, ...allValues));
  const minVal = Math.min(0, ...allValues);
  const yFor = (v: number) => margin.top + plotH - ((v - minVal) / (maxVal - minVal || 1)) * plotH;
  const n = spec.labels.length;
  const xStep = plotW / n;

  const gridLines: string[] = [];
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const v = minVal + ((maxVal - minVal) * i) / yTicks;
    const y = yFor(v);
    gridLines.push(
      `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e2e2e2" stroke-width="1" />`
    );
    gridLines.push(
      `<text x="${margin.left - 8}" y="${y + 4}" font-size="11" fill="#888" text-anchor="end">${esc(formatNum(v))}</text>`
    );
  }

  const xLabels = spec.labels
    .map((label, i) => {
      const x = margin.left + xStep * i + xStep / 2;
      return `<text x="${x}" y="${height - margin.bottom + 18}" font-size="11" fill="#666" text-anchor="middle">${esc(
        truncateLabel(label)
      )}</text>`;
    })
    .join("");

  let body = "";
  if (kind === "bar") {
    const groupPad = xStep * 0.15;
    const barGroupW = xStep - groupPad * 2;
    const barW = barGroupW / spec.series.length;
    spec.series.forEach((series, si) => {
      series.data.forEach((v, i) => {
        const x = margin.left + xStep * i + groupPad + barW * si;
        const y = yFor(Math.max(v, 0));
        const zeroY = yFor(0);
        const h = Math.abs(zeroY - y);
        body += `<rect x="${x}" y="${Math.min(y, zeroY)}" width="${Math.max(barW - 2, 1)}" height="${Math.max(h, 0.5)}" fill="${colors[si % colors.length]}" rx="2" />`;
      });
    });
  } else {
    spec.series.forEach((series, si) => {
      const points = series.data
        .map((v, i) => `${margin.left + xStep * i + xStep / 2},${yFor(v)}`)
        .join(" ");
      body += `<polyline points="${points}" fill="none" stroke="${colors[si % colors.length]}" stroke-width="2.5" />`;
      series.data.forEach((v, i) => {
        const x = margin.left + xStep * i + xStep / 2;
        body += `<circle cx="${x}" cy="${yFor(v)}" r="3.5" fill="${colors[si % colors.length]}" />`;
      });
    });
  }

  const axisLine = `<line x1="${margin.left}" y1="${yFor(0)}" x2="${width - margin.right}" y2="${yFor(0)}" stroke="#999" stroke-width="1" />`;

  const svgBody = gridLines.join("") + body + axisLine + xLabels;
  const legend = renderLegend(spec.series.map((s, i) => ({ color: colors[i % colors.length], label: s.name })));
  return chartWrapper(spec.title, svgBody, width, height, legend);
}

function renderPie(spec: ChartSpec, colors: string[]): string {
  const width = 480;
  const height = 320;
  const cx = 160;
  const cy = height / 2;
  const r = 110;

  const series = spec.series[0];
  const data = series?.data ?? [];
  const total = data.reduce((a, b) => a + Math.max(b, 0), 0) || 1;

  let angle = -Math.PI / 2;
  let paths = "";
  data.forEach((v, i) => {
    const frac = Math.max(v, 0) / total;
    const nextAngle = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(nextAngle);
    const y2 = cy + r * Math.sin(nextAngle);
    const largeArc = nextAngle - angle > Math.PI ? 1 : 0;
    if (frac > 0) {
      paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="1.5" />`;
    }
    angle = nextAngle;
  });

  const legendItems = spec.labels.map((label, i) => ({
    color: colors[i % colors.length],
    label: `${truncateLabel(label, 24)} — ${formatNum(((data[i] ?? 0) / total) * 100)}%`,
  }));
  const legendHtml = `<div class="pc-chart-legend pc-chart-legend-vertical">${legendItems
    .map((i) => `<span class="pc-legend-item"><span class="pc-legend-dot" style="background:${i.color}"></span>${esc(i.label)}</span>`)
    .join("")}</div>`;

  const svgBody = paths;
  return `<div class="pc-chart pc-chart-pie">${spec.title ? `<div class="pc-chart-title">${esc(spec.title)}</div>` : ""}<div class="pc-chart-pie-row"><svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;height:auto;">${svgBody}</svg>${legendHtml}</div></div>`;
}
