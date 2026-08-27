import { marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { renderChartSvg, type ChartSpec } from "./chartRender";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const SVG_TAGS = ["svg", "rect", "circle", "line", "path", "text", "g", "polyline", "polygon", "tspan"];
const SVG_ATTR = [
  "viewbox",
  "width",
  "height",
  "d",
  "cx",
  "cy",
  "r",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "font-size",
  "text-anchor",
  "rx",
];

/**
 * Renders markdown to sanitized HTML. Fenced ```chart blocks (JSON: {type, title, labels, series})
 * are rendered as inline SVG bar/line/pie charts instead of a code block — this is the one
 * "widened" affordance beyond plain markdown, documented to the model via CHART_SYNTAX_HINT.
 */
export function renderMarkdown(text: string, accentColor = "#ff2f6d"): string {
  const renderer = new marked.Renderer();
  renderer.code = ({ text: code, lang }: Tokens.Code) => {
    if (lang === "chart") {
      try {
        const spec = JSON.parse(code) as ChartSpec;
        return renderChartSvg(spec, accentColor);
      } catch {
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
    }
    return `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(code)}</code></pre>`;
  };

  const raw = marked.parse(text || "", { async: false, breaks: true, renderer }) as string;
  return DOMPurify.sanitize(raw, { ADD_TAGS: SVG_TAGS, ADD_ATTR: SVG_ATTR });
}

export const CHART_SYNTAX_HINT = `Для визуализации данных (сравнение цифр, динамика, доли) используй блок кода с языком "chart" —
он отрисовывается как настоящий график, а не текст:

\`\`\`chart
{"type": "bar", "title": "Выручка по клиентам", "labels": ["Клиент А", "Клиент Б"], "series": [{"name": "Выручка", "data": [120000, 90500]}]}
\`\`\`

type: "bar" | "line" | "pie". Для нескольких рядов данных — несколько объектов в series (у каждого своё name и data
той же длины, что labels). Для pie используется только первый ряд series. Значения — только числа, без пробелов и
знаков валюты внутри JSON.`;
