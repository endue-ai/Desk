// The graph on a canvas: a scene (nodes with positions, sizes, colours and labels; edges), a
// viewport that pans and zooms, drawing with the theme's colours, and finding the node under the
// pointer. Colours and the font come from --desk-* tokens, so every theme reaches the graph.

import { AGENT_TOKENS, KINDS } from "./kinds.js";

/**
 * @typedef {{ ids: string[], kinds: string[], labels: string[], tokens: string[],
 *   x: Float32Array, y: Float32Array, r: Float32Array, edges: Int32Array, spawned: Uint8Array,
 *   index: Map<string, number> }} Scene
 * @typedef {{ x: number, y: number, k: number }} Viewport
 * @typedef {{ background: string, edge: string, accent: string, mark: string, text: string,
 *   font: string, colors: Map<string, string> }} Palette
 */

/** Labels shown without a focus: the biggest things. */
const LABELS = 8;

/** The token a node is drawn in: its agent's for a session, its kind's otherwise. */
export function tokenOf(/** @type {string} */ kind, /** @type {string | undefined} */ agent) {
  if (kind === "session")
    return AGENT_TOKENS[/** @type {keyof typeof AGENT_TOKENS} */ (agent)] ?? "--desk-text-muted";
  return KINDS[kind]?.token ?? "--desk-text-muted";
}

/** The theme's colours and font as `element` computes them. */
export function palette(/** @type {Element} */ element) {
  const style = getComputedStyle(element);
  const read = (/** @type {string} */ name) => style.getPropertyValue(name).trim();
  /** @type {Map<string, string>} */
  const colors = new Map();
  const tokens = new Set([
    ...Object.values(AGENT_TOKENS),
    ...Object.values(KINDS).map((k) => k.token),
  ]);
  for (const token of tokens) colors.set(token, read(token) || read("--desk-text"));
  return {
    background: read("--desk-background"),
    edge: read("--desk-text-muted"),
    accent: read("--desk-primary"),
    mark: read("--desk-warning"),
    text: read("--desk-text"),
    font: `${read("--desk-text-xs") || "12px"} ${read("--desk-font-sans") || "sans-serif"}`,
    colors,
  };
}

/** The viewport that shows every node of `scene` (or of `only`) in a `w` × `h` canvas. */
export function viewOf(
  /** @type {Scene} */ scene,
  /** @type {number} */ w,
  /** @type {number} */ h,
  /** @type {Set<number> | undefined} */ only,
) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < scene.ids.length; i++) {
    if (only && !only.has(i)) continue;
    x0 = Math.min(x0, scene.x[i]);
    y0 = Math.min(y0, scene.y[i]);
    x1 = Math.max(x1, scene.x[i]);
    y1 = Math.max(y1, scene.y[i]);
  }
  if (!Number.isFinite(x0)) return { x: w / 2, y: h / 2, k: 1 };
  const pad = 40;
  const k = Math.max(
    0.05,
    Math.min(4, (w - 2 * pad) / Math.max(1, x1 - x0), (h - 2 * pad) / Math.max(1, y1 - y0)),
  );
  return { x: w / 2 - (k * (x0 + x1)) / 2, y: h / 2 - (k * (y0 + y1)) / 2, k };
}

/** The viewport zoomed by `factor` about the canvas point (px, py). */
export function zoomAt(
  /** @type {Viewport} */ v,
  /** @type {number} */ px,
  /** @type {number} */ py,
  /** @type {number} */ factor,
) {
  const k = Math.max(0.05, Math.min(12, v.k * factor));
  const f = k / v.k;
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
}

/** The node under the canvas point (px, py), or -1. */
export function hit(
  /** @type {Scene} */ scene,
  /** @type {Viewport} */ v,
  /** @type {number} */ px,
  /** @type {number} */ py,
  /** @type {Set<number> | undefined} */ only,
) {
  const wx = (px - v.x) / v.k;
  const wy = (py - v.y) / v.k;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < scene.ids.length; i++) {
    if (only && !only.has(i)) continue;
    const d = Math.hypot(scene.x[i] - wx, scene.y[i] - wy);
    if (d < scene.r[i] + 5 / v.k && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** The nodes next to `i`, and `i`. */
export function neighbours(/** @type {Scene} */ scene, /** @type {number} */ i) {
  const found = new Set([i]);
  for (let e = 0; e < scene.edges.length; e += 2) {
    if (scene.edges[e] === i) found.add(scene.edges[e + 1]);
    else if (scene.edges[e + 1] === i) found.add(scene.edges[e]);
  }
  return found;
}

/**
 * Draw the scene. `hover` dims everything but its neighbours; `selected` lights its edges and is
 * ringed; `marked` (search hits) are ringed in the mark colour; `only` limits what is drawn.
 */
export function draw(
  /** @type {CanvasRenderingContext2D} */ c,
  /** @type {Scene} */ scene,
  /** @type {Viewport} */ v,
  /** @type {Palette} */ p,
  /** @type {{ width: number, height: number, ratio: number, hover: number, selected: number,
   *   marked?: Set<number>, only?: Set<number> }} */ o,
) {
  c.setTransform(o.ratio, 0, 0, o.ratio, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = p.background;
  c.fillRect(0, 0, o.width, o.height);
  const shown = (/** @type {number} */ i) => !o.only || o.only.has(i);
  const focus = o.hover >= 0 ? neighbours(scene, o.hover) : undefined;
  const lit = o.hover >= 0 ? o.hover : o.selected;
  c.save();
  c.translate(v.x, v.y);
  c.scale(v.k, v.k);
  c.lineWidth = 0.7 / v.k;
  for (let e = 0; e < scene.edges.length; e += 2) {
    const a = scene.edges[e];
    const b = scene.edges[e + 1];
    if (!shown(a) || !shown(b)) continue;
    const hot = lit >= 0 && (a === lit || b === lit);
    c.globalAlpha = hot ? 0.85 : focus ? 0.04 : scene.spawned[e / 2] ? 0.35 : 0.16;
    c.strokeStyle = hot ? p.accent : p.edge;
    c.beginPath();
    c.moveTo(scene.x[a], scene.y[a]);
    c.lineTo(scene.x[b], scene.y[b]);
    c.stroke();
  }
  for (let i = 0; i < scene.ids.length; i++) {
    if (!shown(i)) continue;
    const dim = (focus && !focus.has(i)) || (o.marked && o.marked.size > 0 && !o.marked.has(i));
    c.globalAlpha = dim ? 0.15 : 1;
    c.fillStyle = p.colors.get(scene.tokens[i]) ?? p.text;
    c.beginPath();
    c.arc(scene.x[i], scene.y[i], scene.r[i], 0, Math.PI * 2);
    c.fill();
    if (i === o.selected || o.marked?.has(i)) {
      c.globalAlpha = 1;
      c.strokeStyle = i === o.selected ? p.accent : p.mark;
      c.lineWidth = 1.6 / v.k;
      c.beginPath();
      c.arc(scene.x[i], scene.y[i], scene.r[i] + 3 / v.k, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 0.7 / v.k;
    }
  }
  c.restore();
  labels(c, scene, v, p, o, focus);
}

/** Labels in screen space, the focus and the biggest first, none over another. */
function labels(
  /** @type {CanvasRenderingContext2D} */ c,
  /** @type {Scene} */ scene,
  /** @type {Viewport} */ v,
  /** @type {Palette} */ p,
  /** @type {{ width: number, height: number, hover: number, selected: number, marked?: Set<number>, only?: Set<number> }} */ o,
  /** @type {Set<number> | undefined} */ focus,
) {
  const shown = (/** @type {number} */ i) => !o.only || o.only.has(i);
  const order = [];
  for (const i of [o.hover, o.selected]) if (i >= 0) order.push(i);
  for (const i of focus ?? []) if (scene.kinds[i] !== "session") order.push(i);
  for (const i of o.marked ?? []) order.push(i);
  const big = [...scene.ids.keys()]
    .filter((i) => shown(i) && scene.kinds[i] !== "session")
    .sort((a, b) => scene.r[b] - scene.r[a])
    .slice(0, o.only ? LABELS * 2 : LABELS);
  order.push(...big);
  c.globalAlpha = 1;
  c.font = p.font;
  c.textBaseline = "middle";
  c.lineJoin = "round";
  /** @type {number[][]} */
  const placed = [];
  const done = new Set();
  for (const i of order) {
    if (done.has(i) || !shown(i)) continue;
    done.add(i);
    const x = scene.x[i] * v.k + v.x + scene.r[i] * v.k + 5;
    const y = scene.y[i] * v.k + v.y;
    if (x < -40 || x > o.width + 40 || y < -10 || y > o.height + 10) continue;
    const text = scene.labels[i];
    const w = c.measureText(text).width;
    const box = [x - 2, y - 8, x + w + 2, y + 8];
    if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]))
      continue;
    placed.push(box);
    c.lineWidth = 3.5;
    c.strokeStyle = p.background;
    c.strokeText(text, x, y);
    c.fillStyle = p.text;
    c.fillText(text, x, y);
  }
}
