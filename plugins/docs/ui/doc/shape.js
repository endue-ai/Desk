// From Word 97 properties to the document model: a character run's look, a paragraph's alignment,
// indents, spacing and outline level, field instructions (HYPERLINK, PAGE), and the comments whose
// ranges cover a position.
import { pt, twips } from "../model.js";
import { ICO } from "./props.js";

/**
 * @typedef {import("./props.js").Chp} Chp
 * @typedef {import("./props.js").Pap} Pap
 * @typedef {Omit<import("../model.js").TextRun, "type" | "text">} RunLook
 */

/** @type {WeakMap<Chp, RunLook>} */
const looks = new WeakMap();
/** One object per distinct look, so runs that look the same join. */
/** @type {Map<string, RunLook>} */
const distinct = new Map();

/**
 * How text with these character properties looks.
 * @param {Chp} chp
 * @param {string[]} fonts the font table
 * @returns {RunLook}
 */
export function lookOf(chp, fonts) {
  const done = looks.get(chp);
  if (done) return done;
  /** @type {RunLook} */
  const out = { size: pt(chp.hps / 2) };
  const font = [...new Set([fonts[chp.ftc0], fonts[chp.ftc2], fonts[chp.ftc1]])]
    .filter((f) => typeof f === "string" && f !== "")
    .join(", ");
  if (font) out.font = font;
  if (chp.bold) out.bold = true;
  if (chp.italic) out.italic = true;
  if (chp.kul) out.underline = true;
  if (chp.strike) out.strike = true;
  const colour = chp.cv ?? ICO[chp.ico];
  if (colour) out.color = colour;
  const highlight = ICO[chp.highlight] ?? chp.shd;
  if (highlight) out.highlight = highlight;
  if (chp.iss === 1) out.script = "super";
  else if (chp.iss === 2) out.script = "sub";
  if (chp.caps) out.caps = true;
  const key = JSON.stringify(out);
  const shared = distinct.get(key) ?? out;
  if (shared === out && distinct.size < 4096) distinct.set(key, out);
  looks.set(chp, shared);
  return shared;
}

const ALIGN = /** @type {const} */ (["left", "center", "right"]);

/**
 * A paragraph's shape in the model.
 * @param {Pap} pap
 * @param {{ name: string, sti: number }} style
 * @returns {Partial<import("../model.js").Paragraph>}
 */
export function paragraphShape(pap, style) {
  /** @type {Partial<import("../model.js").Paragraph>} */
  const shape = {};
  if (style.sti !== 0 && style.name) shape.style = style.name;
  // The built-in headings (sti 1 to 9) are their level; other paragraphs have sprmPOutLvl.
  const level =
    style.sti >= 1 && style.sti <= 9 ? style.sti : pap.outline < 9 ? pap.outline + 1 : 0;
  if (level >= 1 && level <= 6) shape.level = level;
  if (pap.jc !== undefined) shape.align = ALIGN[pap.jc] ?? "justify";
  /** @type {import("../model.js").Indent} */
  const indent = {};
  if (pap.left !== undefined) indent.left = twips(pap.left);
  if (pap.right !== undefined) indent.right = twips(pap.right);
  if (pap.first !== undefined) indent.first = twips(pap.first);
  if (Object.keys(indent).length) shape.indent = indent;
  /** @type {import("../model.js").Spacing} */
  const spacing = {};
  if (pap.beforeAuto) spacing.before = 14;
  else if (pap.before !== undefined) spacing.before = twips(pap.before);
  if (pap.afterAuto) spacing.after = 14;
  else if (pap.after !== undefined) spacing.after = twips(pap.after);
  if (pap.line !== undefined && pap.line !== 0) {
    if (pap.lineMult && pap.line > 0) spacing.line = Math.round((pap.line / 240) * 100) / 100;
    else Object.assign(spacing, { line: twips(Math.abs(pap.line)), exact: true });
  }
  if (Object.keys(spacing).length) shape.spacing = spacing;
  if (pap.bidi) shape.rtl = true;
  return shape;
}

/** What a field's instruction makes of its result: a page number, a link, or plain text. */
export function fieldOf(/** @type {string} */ instr) {
  const word = /^\s*([A-Za-z]+)/.exec(instr)?.[1]?.toUpperCase() ?? "";
  if (word === "PAGE") return { page: /** @type {const} */ ("page") };
  if (word === "NUMPAGES" || word === "SECTIONPAGES")
    return { page: /** @type {const} */ ("pages") };
  if (word !== "HYPERLINK") return {};
  const quoted = /HYPERLINK\s+((?:\\[a-z]\s+)*)"([^"]*)"/i.exec(instr);
  const bare = /HYPERLINK\s+([^\s"\\]\S*)/i.exec(instr);
  if (quoted && !/\\l/i.test(quoted[1] ?? "")) return { link: safe(quoted[2]) };
  return { link: safe(bare?.[1]) };
}

const safe = (/** @type {string | undefined} */ url) =>
  url && /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : undefined;

/**
 * The comments covering a position, for positions that only grow (one walk over a story).
 * @param {Array<{ id: string, start: number, end: number }>} ranges
 */
export function commentTracker(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  /** @type {Array<{ id: string, start: number, end: number }>} */
  let active = [];
  /** @type {string[] | undefined} */
  let current;
  let next = 0;
  return (/** @type {number} */ cp) => {
    let changed = false;
    while (next < sorted.length && (sorted[next]?.start ?? 0) <= cp) {
      active.push(/** @type {{ id: string, start: number, end: number }} */ (sorted[next]));
      next++;
      changed = true;
    }
    const kept = active.filter((r) => r.end > cp);
    if (kept.length !== active.length) changed = true;
    active = kept;
    if (changed) current = active.length ? active.map((r) => r.id) : undefined;
    return current;
  };
}
