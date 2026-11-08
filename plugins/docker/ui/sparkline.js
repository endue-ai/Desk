// Sparklines and the detail's bigger charts: a series of numbers as SVG polyline points in a box,
// the newest at the right edge, scaled to the series' own peak (or a fixed top, like 100 % CPU).
// The colours are the stylesheet's (`.spark.cpu` …), never the script's.

const SVG = "http://www.w3.org/2000/svg";

/**
 * The points of a series in a `width` × `height` box: x spaced so `slots` points fill the width,
 * the last at the right; y from the bottom, the top at `max` (the series' peak when absent).
 * @param {number[]} values
 * @param {{ width: number, height: number, max?: number, slots?: number }} box
 * @returns {string} "x,y x,y …", one decimal at most.
 */
export function sparkPoints(values, { width, height, max, slots }) {
  if (values.length === 0) return "";
  const n = Math.max(slots ?? values.length, values.length, 2);
  const top = Math.max(max ?? 0, ...values, Number.EPSILON);
  const step = width / (n - 1);
  const start = n - values.length;
  const round = (/** @type {number} */ v) => Math.round(v * 10) / 10;
  // A line one pixel above the bottom stays visible at zero.
  const usable = height - 1;
  return values
    .map((v, i) => {
      const x = round((start + i) * step);
      const y = round(usable - (Math.max(0, v) / top) * (usable - 1));
      return `${x},${y}`;
    })
    .join(" ");
}

/**
 * An SVG sparkline: the line and, under it, its area. `label` names it for screen readers.
 * @param {Document} doc
 * @param {number[]} values
 * @param {{ kind: string, label: string, width?: number, height?: number, max?: number,
 *   slots?: number }} options
 */
export function sparkline(doc, values, options) {
  const width = options.width ?? 60;
  const height = options.height ?? 16;
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", `spark ${options.kind}`);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", options.label);
  const points = sparkPoints(values, {
    width,
    height,
    ...(options.max !== undefined ? { max: options.max } : {}),
    ...(options.slots !== undefined ? { slots: options.slots } : {}),
  });
  if (points !== "") {
    const first = points.split(" ")[0]?.split(",")[0] ?? "0";
    const area = doc.createElementNS(SVG, "polygon");
    area.setAttribute("class", "area");
    area.setAttribute("points", `${first},${height} ${points} ${width},${height}`);
    const line = doc.createElementNS(SVG, "polyline");
    line.setAttribute("class", "line");
    line.setAttribute("points", points);
    svg.append(area, line);
  }
  return svg;
}

/**
 * Fill a row's metric cells from a container's snapshot: a sparkline and the value beside it. CPU
 * keeps a 5 % floor so an idle container reads flat; memory sits under its peak; the network keeps
 * a 1 kB/s floor.
 * @param {Document} doc
 * @param {{ cpu: HTMLElement, mem: HTMLElement, net: HTMLElement }} cells
 * @param {import("./stats.js").Snapshot | undefined} snap
 * @param {{ width?: number, height?: number }} [size]
 */
export function fillMetrics(doc, cells, snap, size = {}) {
  if (!snap) return;
  const value = (/** @type {string} */ text) => {
    const node = doc.createElement("span");
    node.className = "value";
    node.textContent = text;
    return node;
  };
  const cpu = cpuText(snap.latest.cpu);
  const mem = snap.latest.memText.split("/")[0]?.trim() ?? "";
  const net = rateText(snap.rate);
  const box = {
    ...(size.width ? { width: size.width } : {}),
    ...(size.height ? { height: size.height } : {}),
    slots: 60,
  };
  cells.cpu.replaceChildren(
    sparkline(doc, snap.cpu, { kind: "cpu", label: `CPU ${cpu}`, max: 5, ...box }),
    value(cpu),
  );
  cells.mem.replaceChildren(
    sparkline(doc, snap.mem, {
      kind: "mem",
      label: `Memory ${mem}`,
      max: Math.max(...snap.mem, 1) * 1.25,
      ...box,
    }),
    value(mem),
  );
  cells.net.replaceChildren(
    sparkline(doc, snap.net, { kind: "net", label: `Network ${net}`, max: 1000, ...box }),
    value(net),
  );
}

/** CPU as people read it: "12.4%", "0.2%", "—" without a sample. */
export const cpuText = (/** @type {number | undefined} */ n) =>
  n === undefined ? "—" : `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;

/** A rate in bytes per second: "1.2 MB/s". */
export function rateText(/** @type {number} */ n) {
  if (!Number.isFinite(n) || n < 1) return "0 B/s";
  const units = ["B/s", "kB/s", "MB/s", "GB/s"];
  let value = n;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
