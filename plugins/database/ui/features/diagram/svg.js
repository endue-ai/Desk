// The ER diagram as SVG text (PG-55): its lines, each end marked with its cardinality in crow's
// feet (one: two bars; zero or one: a bar and a ring; zero or many: a ring and a foot), a drawn
// relation dashed, then its tables as boxes with a head and a row per column shown (PK and FK tags,
// the name, the type and "null"), comments on hover. The panel draws `sceneOf` inside its own SVG
// and moves it; `documentOf` is the export: the diagram alone, sized to its bounds, with the
// theme's colours and font given as values. Pure.

import { HEAD, LINE, PAD, tagOf, typeText } from "./layout.js";

/**
 * @typedef {import("./layout.js").Layout} Layout
 * @typedef {import("./layout.js").Box} Box
 * @typedef {import("./layout.js").Line} Line
 * @typedef {import("./model.js").End} End
 * @typedef {{
 *   background: string, card: string, border: string, head: string, text: string, key: string,
 *   muted: string, line: string, font: string, size: string,
 * }} Palette The theme's colours and font as values (image.js resolves them).
 */

const CHAR = 7.2;
export const MARGIN = 24;

/** Text made safe inside an element or an attribute. */
export const esc = (/** @type {string} */ text) =>
  text.replace(
    /[&<>"']/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** A text cut to a width, with an ellipsis. */
const cut = (/** @type {string} */ text, /** @type {number} */ width) => {
  const most = Math.max(1, Math.floor(width / CHAR));
  return text.length > most ? `${text.slice(0, most - 1)}…` : text;
};
const n = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/** The marks at one end of a line: `at` is the end, `toward` the next point along it. */
export function endMark(
  /** @type {[number, number]} */ at,
  /** @type {[number, number]} */ toward,
  /** @type {End} */ end,
) {
  const dx = Math.sign(toward[0] - at[0]);
  const dy = Math.sign(toward[1] - at[1]);
  const along = (/** @type {number} */ d, /** @type {number} */ side) =>
    `${n(at[0] + dx * d - dy * side)} ${n(at[1] + dy * d + dx * side)}`;
  const bar = (/** @type {number} */ d) => `M ${along(d, -6)} L ${along(d, 6)}`;
  const ring = (/** @type {number} */ d) => {
    const [cx, cy] = [at[0] + dx * d, at[1] + dy * d];
    return `M ${n(cx - 3.5)} ${n(cy)} a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0`;
  };
  if (end === "one") return { lines: `${bar(7)} ${bar(11)}`, rings: "" };
  if (end === "zero-one") return { lines: bar(7), rings: ring(15) };
  return {
    lines: `M ${along(0, -6)} L ${along(12, 0)} L ${along(0, 6)} M ${along(0, 0)} L ${along(12, 0)}`,
    rings: ring(16),
  };
}

/** One line's markup. */
function lineOf(/** @type {Line} */ line, /** @type {number} */ i, /** @type {boolean} */ live) {
  const p = line.points;
  if (p.length < 2) return "";
  const first = /** @type {[number, number]} */ (p[0]);
  const last = /** @type {[number, number]} */ (p[p.length - 1]);
  const a = endMark(first, /** @type {[number, number]} */ (p[1]), line.ends.from);
  const b = endMark(last, /** @type {[number, number]} */ (p[p.length - 2]), line.ends.to);
  const cls = line.drawn ? "er-link er-drawn" : "er-link";
  const rings = `${a.rings} ${b.rings}`.trim();
  return (
    `<g class="${cls}"${live ? ` data-l="${i}"` : ""}><title>${esc(line.title)}</title>` +
    `<polyline class="er-wire" points="${p.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}"/>` +
    `<path class="er-end" d="${a.lines} ${b.lines}"/>` +
    (rings ? `<path class="er-ring" d="${rings}"/>` : "") +
    "</g>"
  );
}

/** One table's markup. */
function boxOf(/** @type {Box} */ box, /** @type {number} */ i, /** @type {boolean} */ live) {
  const title = box.comment ? `${box.label}: ${box.comment}` : box.label;
  const attrs = live
    ? ` data-b="${i}" tabindex="0" role="button" aria-label="${esc(`${box.label}: ${box.rows.length + box.more} columns shown. Enter opens its rows.`)}"`
    : "";
  const tagged = tagOf(box.rows);
  const rows = box.rows.map((c, r) => {
    const y = HEAD + 4 + r * LINE + 13;
    const tag = [c.primary ? "PK" : "", c.foreign ? "FK" : ""].filter(Boolean).join(" ");
    const type = typeText(c);
    const room = box.w - 2 * PAD - tagged - 8;
    const nameRoom = Math.max(4 * CHAR, room - type.length * CHAR);
    const note = `${c.name}: ${c.type}, ${c.nullable ? "nullable" : "not null"}${c.primary ? ", primary key" : ""}${c.foreign ? ", foreign key" : ""}${c.comment ? `. ${c.comment}` : ""}`;
    return (
      `<g class="er-row"><title>${esc(note)}</title>` +
      (tag ? `<text class="er-tag" x="${PAD}" y="${y}">${tag}</text>` : "") +
      `<text class="${c.primary ? "er-column er-key" : "er-column"}" x="${PAD + tagged}" y="${y}">${esc(cut(c.name, nameRoom))}</text>` +
      `<text class="er-type" x="${box.w - PAD}" y="${y}" text-anchor="end">${esc(cut(type, Math.max(4 * CHAR, room - nameRoom + 4 * CHAR)))}</text></g>`
    );
  });
  if (box.more > 0)
    rows.push(
      `<text class="er-type" x="${PAD}" y="${HEAD + 4 + box.rows.length * LINE + 13}">… ${box.more} more</text>`,
    );
  return (
    `<g class="er-table"${attrs} transform="translate(${box.x},${box.y})"><title>${esc(title)}</title>` +
    `<rect class="er-box" width="${box.w}" height="${box.h}" rx="6"/>` +
    `<rect class="er-head" width="${box.w}" height="${HEAD}" rx="6"/>` +
    `<text class="er-name" x="${PAD}" y="17">${esc(cut(box.label, box.w - 2 * PAD))}</text>` +
    (rows.length ? `<g class="er-rows">${rows.join("")}</g>` : "") +
    "</g>"
  );
}

/** A box's markup alone (the panel draws one again after a column change). */
export const tableMarkup = (/** @type {Box} */ box, /** @type {number} */ i) => boxOf(box, i, true);
/** A line's markup alone (the panel draws one again after a move). */
export const lineMarkup = (/** @type {Line} */ line, /** @type {number} */ i) =>
  lineOf(line, i, true);

/**
 * The lines, then the tables, as the panel's scene; `live` adds what the panel needs to find and
 * focus them (never in an export).
 */
export function sceneOf(/** @type {Layout} */ layout, live = true) {
  return (
    `<g class="er-links">${layout.lines.map((l, i) => lineOf(l, i, live)).join("")}</g>` +
    `<g class="er-tables">${layout.boxes.map((b, i) => boxOf(b, i, live)).join("")}</g>`
  );
}

/** The export's size: the bounds and a margin round them. */
export function sizeOfDocument(/** @type {Layout} */ layout) {
  const { x, y, w, h } = layout.bounds;
  const drawn = layout.lines.some((l) => l.drawn) ? LINE + 8 : 0;
  return {
    x: x - MARGIN,
    y: y - MARGIN,
    w: Math.ceil(w + 2 * MARGIN),
    h: Math.ceil(h + 2 * MARGIN + drawn),
  };
}

/**
 * The diagram alone as an SVG document: its colours and font as values, a background, a key for
 * drawn relations when there are any, and nothing of the panel.
 * @param {Layout} layout
 * @param {Palette} palette
 * @param {string} title
 */
export function documentOf(layout, palette, title) {
  const { x, y, w, h } = sizeOfDocument(layout);
  const p = palette;
  const style =
    `.er{font-family:${p.font};font-size:${p.size}}` +
    `.er-box{fill:${p.card};stroke:${p.border}}.er-head{fill:${p.head}}` +
    `.er-name{fill:${p.text};font-weight:600}.er-column{fill:${p.text}}` +
    `.er-key{fill:${p.key};font-weight:600}.er-tag{fill:${p.key};font-size:0.85em}` +
    `.er-type{fill:${p.muted}}.er-wire,.er-end{fill:none;stroke:${p.line};stroke-width:1.5}` +
    `.er-ring{fill:${p.card};stroke:${p.line};stroke-width:1.5}` +
    ".er-drawn .er-wire{stroke-dasharray:6 4}";
  const key = layout.lines.some((l) => l.drawn)
    ? `<g class="er-link er-drawn"><polyline class="er-wire" points="${x + MARGIN},${y + h - 14} ${x + MARGIN + 28},${y + h - 14}"/></g>` +
      `<text class="er-type" x="${x + MARGIN + 36}" y="${y + h - 10}">Dashed: not in the database</text>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="er" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">` +
    `<title>${esc(title)}</title><style>${esc(style)}</style>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(p.background)}"/>` +
    sceneOf(layout, false) +
    key +
    "</svg>"
  );
}
