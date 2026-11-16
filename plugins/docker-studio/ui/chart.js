// The studio's figures in SVG, coloured only by theme tokens: an area chart with a crosshair and
// a tooltip (resource use over time, one axis), a sparkline for a table cell, a meter, and a thin
// segmented bar (disk use, one whole split into parts). Marks are thin: 2 px lines, a 10 % wash
// under them, hairline grid, an end dot with a ring of the surface.

import { h, svg } from "./dom.js";

/**
 * @typedef {{ name: string, values: number[], color: string }} Series
 * @typedef {{ series: Series[], max?: number, format(value: number): string, points?: number,
 *   height?: number, grid?: number, floor?: number, step?: number, label: string }} AreaSpec
 */

/** The largest value, rounded up to a clean step so the grid reads 0 / 25 / 50 / 100. */
export function niceMax(/** @type {number} */ value) {
  if (!(value > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.25, 2, 2.5, 5, 10]) if (value <= step * exp) return step * exp;
  return 10 * exp;
}

/**
 * An area chart that keeps its element and redraws at its real width when it grows or the data
 * changes. `update(spec)` takes new values.
 * @param {AreaSpec} first
 */
export function areaChart(first) {
  let spec = first;
  const height = first.height ?? 120;
  const plot = svg("svg", { class: "area-svg", height, role: "img", "aria-label": first.label });
  const tip = h("div.chart-tip", { role: "presentation", hidden: true });
  const host = h("div.area-chart", { style: { "--chart-h": `${height}px` } }, plot, tip);
  let width = 0;
  /** @type {number | null} */
  let hover = null;

  const draw = () => {
    width = host.clientWidth || width || 320;
    plot.setAttribute("width", String(width));
    plot.setAttribute("viewBox", `0 0 ${width} ${height}`);
    plot.replaceChildren();
    const points = spec.points ?? Math.max(2, ...spec.series.map((s) => s.values.length));
    const top = Math.max(0, ...spec.series.flatMap((s) => s.values));
    // Headroom over the highest point, and never a scale so small that noise fills it.
    const max = spec.max ?? niceMax(Math.max(top * 1.2, spec.floor ?? 0));
    const pad = { t: 8, b: 4, l: 0, r: 6 };
    const x = (/** @type {number} */ i, /** @type {number} */ n) =>
      pad.l + (width - pad.l - pad.r) * ((points - n + i) / Math.max(1, points - 1));
    const y = (/** @type {number} */ v) =>
      pad.t + (height - pad.t - pad.b) * (1 - Math.min(1, Math.max(0, v / max)));
    for (let g = 0; g <= (spec.grid ?? 2); g++) {
      const gy = pad.t + ((height - pad.t - pad.b) * g) / (spec.grid ?? 2);
      plot.append(svg("line", { class: "grid", x1: 0, x2: width, y1: gy, y2: gy }));
    }
    for (const s of spec.series) {
      const n = s.values.length;
      if (n === 0) continue;
      const line = s.values
        .map((v, i) => `${i ? "L" : "M"}${x(i, n).toFixed(1)},${y(v).toFixed(1)}`)
        .join("");
      const area = `${line}L${x(n - 1, n).toFixed(1)},${height - pad.b}L${x(0, n).toFixed(1)},${height - pad.b}Z`;
      const style = `--series: var(${s.color})`;
      plot.append(svg("path", { class: "wash", d: area, style }));
      plot.append(svg("path", { class: "line", d: line, style }));
      const last = s.values[n - 1] ?? 0;
      plot.append(svg("circle", { class: "end", cx: x(n - 1, n), cy: y(last), r: 4, style }));
    }
    if (hover !== null) {
      const n = Math.max(...spec.series.map((s) => s.values.length));
      const i = Math.min(n - 1, Math.max(0, hover));
      const cx = x(i, n);
      plot.append(svg("line", { class: "cross", x1: cx, x2: cx, y1: pad.t, y2: height - pad.b }));
      tip.replaceChildren(
        ...spec.series.map((s) =>
          h(
            "div.tip-row",
            null,
            h("span.key", { style: { "--series": `var(${s.color})` } }),
            h("span", null, s.name),
            h("b", null, spec.format(s.values[i - (n - s.values.length)] ?? 0)),
          ),
        ),
        h(
          "div.tip-when",
          null,
          i === n - 1 ? "now" : `${Math.round((n - 1 - i) * (spec.step ?? 1.5))} s ago`,
        ),
      );
      tip.hidden = false;
      tip.style.left = `${Math.min(width - 150, Math.max(0, cx + 10))}px`;
    } else tip.hidden = true;
  };

  plot.addEventListener("pointermove", (event) => {
    const n = Math.max(0, ...spec.series.map((s) => s.values.length));
    if (n < 2) return;
    const rect = plot.getBoundingClientRect();
    const points = spec.points ?? n;
    const at = ((event.clientX - rect.left) / Math.max(1, rect.width)) * (points - 1);
    hover = Math.round(at - (points - n));
    draw();
  });
  plot.addEventListener("pointerleave", () => {
    hover = null;
    draw();
  });
  if (typeof ResizeObserver === "function")
    new ResizeObserver(() => {
      if (host.clientWidth !== width) draw();
    }).observe(host);
  queueMicrotask(draw);

  return {
    element: host,
    /** @param {Partial<AreaSpec>} next */
    update(next) {
      spec = { ...spec, ...next };
      draw();
    },
  };
}

/** A sparkline for a table cell: one series, its last value marked. */
export function sparkline(
  /** @type {number[]} */ values,
  { width = 72, height = 22, max = 0, color = "--desk-chart-1" } = {},
) {
  const el = svg("svg", {
    class: "spark",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    "aria-hidden": "true",
  });
  if (values.length < 2) return el;
  const top = max || niceMax(Math.max(...values));
  const n = values.length;
  const x = (/** @type {number} */ i) => 1 + ((width - 6) * i) / (n - 1);
  const y = (/** @type {number} */ v) => 2 + (height - 5) * (1 - Math.min(1, v / top));
  const line = values
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join("");
  const style = `--series: var(${color})`;
  el.append(
    svg("path", { class: "wash", d: `${line}L${x(n - 1)},${height}L${x(0)},${height}Z`, style }),
    svg("path", { class: "line", d: line, style }),
    svg("circle", { class: "end", cx: x(n - 1), cy: y(values[n - 1] ?? 0), r: 2.5, style }),
  );
  return el;
}

/** A meter: how full, coloured by severity past 70 % and 90 %. */
export function meter(/** @type {number} */ fraction, /** @type {string} */ label) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const level = f >= 0.9 ? "danger" : f >= 0.7 ? "warning" : "ok";
  return h(
    `span.meter.${level}`,
    {
      role: "meter",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": Math.round(f * 100),
      "aria-label": label,
    },
    h("span.meter-fill", { style: { width: `${(f * 100).toFixed(1)}%` } }),
  );
}

/**
 * A thin segmented bar of one whole and its parts, with the legend under it.
 * @param {Array<{ name: string, value: number, color: string, note?: string }>} parts
 * @param {(value: number) => string} format
 * @param {string} label
 */
export function segments(parts, format, label) {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  const bar = h("div.segments", { role: "img", "aria-label": label });
  for (const part of parts) {
    if (!(part.value > 0) || total === 0) continue;
    bar.append(
      h("span.segment-part", {
        style: { "flex-grow": String(part.value / total), "--series": `var(${part.color})` },
        title: `${part.name}: ${format(part.value)} (${Math.round((part.value / total) * 100)}%)`,
      }),
    );
  }
  const legend = h(
    "ul.legend",
    null,
    parts.map((part) =>
      h(
        "li",
        null,
        h("span.key", { style: { "--series": `var(${part.color})` } }),
        h("span.legend-name", null, part.name),
        h("b", null, format(part.value)),
        part.note ? h("small", null, part.note) : null,
      ),
    ),
  );
  return h("div.segmented", null, bar, legend);
}
