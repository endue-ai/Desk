// desk-universal-view's chart, stat and detail as DOM (ADR 0103), and every presentation's label for
// the switcher. A chart is SVG in the theme's tokens: bars, a line, or a sparkline without labels.
import type { UniversalType } from "@endue-ai/bridge";
import type { ChartModel, DetailModel, StatModel } from "../universal";
import { element } from "./base";
import type { Drawing } from "./universal-draw";

/** What the switcher calls each presentation. */
export const LABELS: Record<UniversalType, string> = {
  timeline: "Timeline",
  calendar: "Calendar",
  kanban: "Board",
  list: "List",
  text: "Text",
  chat: "Chat",
  agent: "Agent",
  chart: "Chart",
  stat: "Stat",
  detail: "Detail",
};

const SVG = "http://www.w3.org/2000/svg";
const W = 600;
const H = 200;

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** Bars, a line or a sparkline over the points, with each point's label and value for readers. */
export function drawChart(model: ChartModel): HTMLElement {
  const root = element("figure", { class: "chart", "data-chart": model.kind });
  const span = model.max - model.min || 1;
  const y = (value: number) => H - ((value - model.min) / span) * H;
  const plot = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": model.points.map((p) => `${p.label}: ${p.value}`).join(", "),
  });
  const n = model.points.length;
  if (model.kind === "bar") {
    const step = W / Math.max(n, 1);
    model.points.forEach((point, i) => {
      const top = y(Math.max(point.value, 0));
      const height = Math.abs(y(point.value) - y(0)) || 1;
      plot.append(
        svg("rect", {
          class: "bar",
          x: i * step + step * 0.15,
          y: point.value >= 0 ? top : y(0),
          width: step * 0.7,
          height,
          "data-key": point.key,
        }),
      );
    });
  } else if (n > 0) {
    const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const line = model.points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    plot.append(svg("polyline", { class: "line", points: line.join(" "), fill: "none" }));
  }
  root.append(plot);
  if (model.kind !== "sparkline" && n > 0) {
    const labels = element("div", { class: "chart-labels" });
    for (const point of model.points) {
      const label = element("span", {
        class: "chart-label",
        title: `${point.label}: ${point.value}`,
      });
      label.textContent = point.label;
      labels.append(label);
    }
    root.append(labels);
  }
  return root;
}

/** One number, large, or the view's empty text when there is nothing to show. */
export function drawStat(model: StatModel, empty: string | undefined): HTMLElement {
  const root = element("div", { class: "stat", "data-aggregate": model.aggregate });
  const value = element("span", { class: "stat-value" });
  value.textContent = model.value === null ? "—" : model.value.toLocaleString();
  root.append(value);
  if ((model.value === null || model.value === 0) && empty) {
    const note = element("span", { class: "stat-note" });
    note.textContent = empty;
    root.append(note);
  }
  return root;
}

/** One entry: its title, then a label and a value per field. */
export function drawDetail(model: DetailModel, d: Drawing): HTMLElement {
  const root = element("div", { class: "detail" });
  if (!model.row) return root;
  const head = d.make(model.row, "div");
  head.setAttribute("class", "entry detail-head");
  const title = element("span", { class: "entry-title" });
  title.textContent = model.row.title || model.row.id || "Untitled";
  head.append(title);
  const list = element("dl", { class: "detail-fields" });
  for (const field of model.fields) {
    const term = element("dt");
    term.textContent = field.label;
    const value = element("dd");
    value.textContent = field.value;
    list.append(term, value);
  }
  root.append(head, list);
  return root;
}
