// A chart as an SVG document (PG-44): bars grouped by category, lines and areas over the categories,
// a scatter's dots and a pie's slices, with axes, ticks, labels and a legend, from a chart's data
// (aggregate.js) and a palette. The page draws it with the theme's tokens as `var(--desk-*)` values,
// so a theme change reaches it; an export with the same tokens resolved to colours. Every label is
// escaped: the text comes from the database. No DOM.

import { parseDecimal, toNumber } from "./decimal.js";
import { chartTitle } from "./model.js";
import { cut, place, ticks, tickText } from "./scale.js";

/**
 * @typedef {import("./aggregate.js").ChartData} ChartData
 * @typedef {import("./aggregate.js").Settings} Settings
 * @typedef {{ series: string[], text: string, muted: string, grid: string, background: string, font: string, size: string }} Palette
 * @typedef {{ width: number, height: number }} Size
 */

/**
 * The chart tokens a series is drawn in, in order: those that reach 3:1 on every neutral surface in
 * the light and dark schemes (chart-2, chart-3, chart-7 and chart-9 fall under it on one of them).
 */
export const SERIES = /** @type {const} */ ([
  "--desk-chart-1",
  "--desk-chart-4",
  "--desk-chart-5",
  "--desk-chart-6",
  "--desk-chart-8",
  "--desk-chart-10",
]);

/** The page's palette: the theme's tokens themselves. @returns {Palette} */
export const tokenPalette = () => ({
  series: SERIES.map((t) => `var(${t})`),
  text: "var(--desk-text)",
  muted: "var(--desk-text-muted)",
  grid: "var(--desk-border)",
  background: "var(--desk-background)",
  font: "var(--desk-font-sans)",
  size: "var(--desk-text-xs)",
});

const ESCAPES = /** @type {Record<string, string>} */ ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});
export const escapeXml = (/** @type {string} */ s) =>
  s.replace(/[&<>"']/gu, (c) => ESCAPES[c] ?? c);
const px = (/** @type {number} */ n) => String(Math.round(n * 10) / 10);
const num = (/** @type {string | null} */ v) => {
  const d = v === null ? null : parseDecimal(v);
  return d ? toNumber(d) : Number.NaN;
};
const colour = (/** @type {Palette} */ p, /** @type {number} */ i) =>
  p.series[i % p.series.length] ?? p.text;

/**
 * The chart's SVG document.
 * @param {ChartData} data @param {Settings} settings @param {Size} size @param {Palette} palette
 */
export function drawChart(data, settings, size, palette) {
  const { width: w, height: h } = size;
  const title = chartTitle(settings);
  const out = [];
  const text = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {string} */ body,
    /** @type {string} */ anchor,
    /** @type {string} */ cls,
  ) =>
    out.push(
      `<text class="${cls}" x="${px(x)}" y="${px(y)}" text-anchor="${anchor}" fill="${palette.muted}">${escapeXml(body)}</text>`,
    );
  const legendNames =
    settings.type === "pie"
      ? data.categories
      : data.series.length > 1
        ? data.series.map((s) => s.name)
        : [];
  let lx = 8;
  legendNames.forEach((name, i) => {
    out.push(
      `<rect class="chart-key" x="${px(lx)}" y="6" width="10" height="10" fill="${colour(palette, i)}"/>`,
    );
    const label = cut(name, 24);
    text(lx + 14, 15, label, "start", "chart-legend");
    lx += 14 + label.length * 7 + 12;
  });
  const top = legendNames.length ? 28 : 12;
  if (settings.type === "pie") drawPie(out, data, { w, h, top }, palette);
  else drawAxes(out, data, settings, { w, h, top }, palette, text);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `role="img" aria-label="${escapeXml(title)}" font-family="${palette.font}" font-size="${palette.size}">` +
    `<title>${escapeXml(title)}</title>${out.join("")}</svg>`
  );
}

/** The pie: a slice per category, from the top clockwise; values at or below zero are left out. */
function drawPie(
  /** @type {string[]} */ out,
  /** @type {ChartData} */ data,
  /** @type {{ w: number, h: number, top: number }} */ box,
  /** @type {Palette} */ palette,
) {
  const values = (data.series[0]?.values ?? []).map(num);
  const total = values.reduce((sum, v) => (v > 0 ? sum + v : sum), 0);
  if (!(total > 0)) return;
  const r = Math.max(8, Math.min(box.w, box.h - box.top) / 2 - 12);
  const cx = box.w / 2;
  const cy = box.top + (box.h - box.top) / 2;
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    if (!(v > 0)) return;
    const sweep = (v / total) * Math.PI * 2;
    const end = angle + Math.min(sweep, Math.PI * 2 - 1e-6);
    const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    const [x2, y2] = [cx + r * Math.cos(end), cy + r * Math.sin(end)];
    const large = sweep > Math.PI ? 1 : 0;
    out.push(
      `<path class="chart-slice" d="M${px(cx)} ${px(cy)}L${px(x1)} ${px(y1)}A${px(r)} ${px(r)} 0 ${large} 1 ${px(x2)} ${px(y2)}Z" fill="${colour(palette, i)}" stroke="${palette.background}"/>`,
    );
    angle += sweep;
  });
}

/** Bars, lines, areas or dots over a value axis, with the categories (or X's values) below. */
function drawAxes(
  /** @type {string[]} */ out,
  /** @type {ChartData} */ data,
  /** @type {Settings} */ settings,
  /** @type {{ w: number, h: number, top: number }} */ box,
  /** @type {Palette} */ palette,
  /** @type {(x: number, y: number, body: string, anchor: string, cls: string) => void} */ text,
) {
  const left = 56;
  const right = box.w - 16;
  const bottom = box.h - 28;
  const scatter = settings.type === "scatter";
  const ys = scatter
    ? data.points.map((p) => num(p.y))
    : data.series.flatMap((s) => s.values.map(num));
  const finite = ys.filter(Number.isFinite);
  const yt = ticks(Math.min(0, ...finite), Math.max(0, ...finite));
  const yAt = (/** @type {number} */ v) => place(v, yt.low, yt.high, bottom, box.top);
  for (const v of yt.values) {
    const y = yAt(v);
    out.push(
      `<line class="chart-grid" x1="${left}" x2="${px(right)}" y1="${px(y)}" y2="${px(y)}" stroke="${palette.grid}"/>`,
    );
    text(left - 6, y + 4, tickText(v), "end", "chart-tick");
  }
  out.push(
    `<line class="chart-axis" x1="${left}" x2="${px(right)}" y1="${px(yAt(0))}" y2="${px(yAt(0))}" stroke="${palette.muted}"/>`,
  );
  if (scatter) {
    const xs = data.points.map((p) => num(p.x));
    const xt = ticks(
      Math.min(...xs.filter(Number.isFinite)),
      Math.max(...xs.filter(Number.isFinite)),
    );
    for (const v of xt.values)
      text(
        place(v, xt.low, xt.high, left, right),
        bottom + 16,
        tickText(v),
        "middle",
        "chart-tick",
      );
    data.points.forEach((p, i) => {
      const x = place(xs[i] ?? 0, xt.low, xt.high, left, right);
      out.push(
        `<circle class="chart-dot" cx="${px(x)}" cy="${px(yAt(num(p.y)))}" r="3" fill="${colour(palette, p.series)}"/>`,
      );
    });
    return;
  }
  const n = Math.max(1, data.categories.length);
  const band = (right - left) / n;
  const every = Math.max(1, Math.ceil(56 / band));
  data.categories.forEach((name, i) => {
    if (i % every) return;
    text(
      left + band * (i + 0.5),
      bottom + 16,
      cut(name, Math.max(3, Math.floor((band * every) / 7))),
      "middle",
      "chart-category",
    );
  });
  if (settings.type === "bar") {
    const inner = (band * 0.8) / Math.max(1, data.series.length);
    data.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const value = num(v);
        if (!Number.isFinite(value)) return;
        const [y0, y1] = [yAt(0), yAt(value)];
        const x = left + band * i + band * 0.1 + inner * si;
        out.push(
          `<rect class="chart-bar" x="${px(x)}" y="${px(Math.min(y0, y1))}" width="${px(Math.max(1, inner - 1))}" height="${px(Math.max(1, Math.abs(y0 - y1)))}" fill="${colour(palette, si)}"/>`,
        );
      });
    });
    return;
  }
  data.series.forEach((s, si) => {
    /** @type {[number, number][]} */
    const at = [];
    let d = "";
    let open = false;
    s.values.forEach((v, i) => {
      const value = num(v);
      if (!Number.isFinite(value)) {
        open = false;
        return;
      }
      const point = /** @type {[number, number]} */ ([left + band * (i + 0.5), yAt(value)]);
      at.push(point);
      d += `${open ? "L" : "M"}${px(point[0])} ${px(point[1])}`;
      open = true;
    });
    if (!d) return;
    const ink = colour(palette, si);
    if (settings.type === "line") {
      out.push(`<path class="chart-line" d="${d}" fill="none" stroke="${ink}" stroke-width="2"/>`);
      return;
    }
    // One area over the values in order, closed down to the axis at its ends.
    const y0 = px(yAt(0));
    const line = at.map(([x, y]) => `L${px(x)} ${px(y)}`).join("");
    const area = `M${px(at[0]?.[0] ?? left)} ${y0}${line}L${px(at.at(-1)?.[0] ?? left)} ${y0}Z`;
    out.push(
      `<path class="chart-area" d="${area}" fill="${ink}" fill-opacity="0.25" stroke="${ink}" stroke-width="2"/>`,
    );
  });
}
