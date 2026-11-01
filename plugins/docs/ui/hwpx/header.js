// HWPX (OWPML) header.xml: font faces per language, character shapes, paragraph shapes (align,
// margins, line spacing, heading kind), numberings and bullets, border fills. HWPUNIT is 1/7200
// inch: a hundredth of a point.
import { color, pt } from "../model.js";
import { formatNumber } from "../numbers.js";
import { attr, find, findAll, kid, num } from "../xml.js";

/**
 * @typedef {import("../ooxml/styles.js").RunProps} RunProps
 * @typedef {{ align?: import("../model.js").Align, indent?: import("../model.js").Indent, spacing?: import("../model.js").Spacing, heading?: { type: string, id: string, level: number }, breakBefore?: boolean }} ParaShape
 * @typedef {{ format: string, text: string, start: number }} Head
 */

const ALIGN = /** @type {Record<string, import("../model.js").Align>} */ ({
  LEFT: "left",
  CENTER: "center",
  RIGHT: "right",
  JUSTIFY: "justify",
  DISTRIBUTE: "justify",
  DISTRIBUTE_SPACE: "justify",
});

/** OWPML number formats as the shared formatter names them. */
const FORMATS = /** @type {Record<string, string>} */ ({
  DIGIT: "decimal",
  CIRCLED_DIGIT: "decimalEnclosedCircle",
  ROMAN_CAPITAL: "upperRoman",
  ROMAN_SMALL: "lowerRoman",
  LATIN_CAPITAL: "upperLetter",
  LATIN_SMALL: "lowerLetter",
  HANGUL_SYLLABLE: "ganada",
  HANGUL_JAMO: "chosung",
  IDEOGRAPH: "ideographDigital",
});

const unit = (/** @type {number | undefined} */ v) => (v === undefined ? undefined : pt(v / 100));

/** @param {Document | undefined} doc */
export function readHeader(doc) {
  /** @type {Map<string, Map<string, string>>} */
  const faces = new Map();
  for (const group of findAll(doc, "fontface")) {
    const lang = attr(group, "lang") ?? "";
    faces.set(
      lang,
      new Map(findAll(group, "font").map((f) => [attr(f, "id") ?? "", attr(f, "face") ?? ""])),
    );
  }
  /** @type {Map<string, RunProps>} */
  const chars = new Map();
  for (const el of findAll(doc, "charPr")) {
    /** @type {RunProps} */
    const out = {};
    const height = num(el, "height");
    if (height) out.size = pt(height / 100);
    const fg = color(attr(el, "textColor"));
    if (fg && fg !== "#000000") out.color = fg;
    const shade = color(attr(el, "shadeColor"));
    if (shade && shade !== "#FFFFFF") out.highlight = shade;
    if (kid(el, "bold")) out.bold = true;
    if (kid(el, "italic")) out.italic = true;
    const underline = attr(kid(el, "underline"), "type");
    if (underline && underline !== "NONE") out.underline = true;
    const strike = attr(kid(el, "strikeout"), "shape");
    if (strike && strike !== "NONE" && strike !== "3D") out.strike = true;
    if (kid(el, "supscript")) out.script = "super";
    if (kid(el, "subscript")) out.script = "sub";
    const ref = kid(el, "fontRef");
    const names = [
      faces.get("LATIN")?.get(attr(ref, "latin") ?? ""),
      faces.get("HANGUL")?.get(attr(ref, "hangul") ?? ""),
    ].filter((n) => n);
    if (names.length) out.font = [...new Set(names)].join(", ");
    chars.set(attr(el, "id") ?? "", out);
  }
  /** @type {Map<string, ParaShape>} */
  const paras = new Map();
  for (const el of findAll(doc, "paraPr")) {
    /** @type {ParaShape} */
    const out = {};
    const align = ALIGN[attr(kid(el, "align"), "horizontal") ?? ""];
    if (align) out.align = align;
    const margin = find(el, "margin");
    const value = (/** @type {string} */ local) => unit(num(kid(margin, local), "value"));
    const left = value("left");
    const right = value("right");
    const first = value("intent");
    if (left || right || first) out.indent = { left, right, first };
    const before = value("prev");
    const after = value("next");
    const line = find(el, "lineSpacing");
    /** @type {import("../model.js").Spacing} */
    const spacing = {};
    if (before) spacing.before = before;
    if (after) spacing.after = after;
    const lineValue = num(line, "value");
    if (lineValue && attr(line, "type") === "PERCENT") spacing.line = lineValue / 100;
    else if (lineValue && attr(line, "type") === "FIXED")
      Object.assign(spacing, { line: unit(lineValue), exact: true });
    if (Object.keys(spacing).length) out.spacing = spacing;
    const heading = kid(el, "heading");
    const type = attr(heading, "type") ?? "NONE";
    if (type !== "NONE")
      out.heading = { type, id: attr(heading, "idRef") ?? "0", level: num(heading, "level") ?? 0 };
    if (attr(kid(el, "breakSetting"), "pageBreakBefore") === "1") out.breakBefore = true;
    paras.set(attr(el, "id") ?? "", out);
  }
  /** @type {Map<string, Map<number, Head>>} */
  const numberings = new Map();
  for (const el of findAll(doc, "numbering")) {
    /** @type {Map<number, Head>} */
    const levels = new Map();
    for (const head of findAll(el, "paraHead"))
      levels.set(num(head, "level") ?? 1, {
        format: FORMATS[attr(head, "numFormat") ?? "DIGIT"] ?? "decimal",
        text: head.textContent ?? "",
        start: num(head, "start") ?? 1,
      });
    numberings.set(attr(el, "id") ?? "", levels);
  }
  /** @type {Map<string, string>} */
  const bullets = new Map(
    findAll(doc, "bullet").map((b) => [attr(b, "id") ?? "", attr(b, "char") ?? "•"]),
  );
  /** @type {Map<string, { border: boolean, fill?: string }>} */
  const fills = new Map();
  for (const el of findAll(doc, "borderFill")) {
    const sides = ["leftBorder", "rightBorder", "topBorder", "bottomBorder"].map((s) =>
      attr(kid(el, s), "type"),
    );
    const face = color(attr(find(el, "winBrush"), "faceColor"));
    fills.set(attr(el, "id") ?? "", {
      border: sides.some((t) => t && t !== "NONE"),
      fill: face && face !== "#FFFFFF" ? face : undefined,
    });
  }
  /** @type {Map<string, { name: string, para: string, char: string }>} */
  const styles = new Map(
    findAll(doc, "style").map((s) => [
      attr(s, "id") ?? "",
      {
        name: attr(s, "name") ?? "",
        para: attr(s, "paraPrIDRef") ?? "",
        char: attr(s, "charPrIDRef") ?? "",
      },
    ]),
  );

  /** Counters per numbering, by level. */
  /** @type {Map<string, number[]>} */
  const counters = new Map();
  /**
   * The marker of the next paragraph numbered by `id` at `level` (1-based).
   * @param {string} id
   * @param {number} level
   */
  const number = (id, level) => {
    const levels = numberings.get(id);
    const head = levels?.get(level);
    if (!levels || !head) return undefined;
    const counts = counters.get(id) ?? [];
    counters.set(id, counts);
    counts[level - 1] = (counts[level - 1] ?? head.start - 1) + 1;
    counts.length = level;
    return head.text.replace(/\^(\d)/g, (_, d) => {
      const i = Number(d);
      return formatNumber(
        counts[i - 1] ?? levels.get(i)?.start ?? 1,
        levels.get(i)?.format ?? "decimal",
      );
    });
  };

  return { chars, paras, bullets, fills, styles, number };
}

/** @typedef {ReturnType<typeof readHeader>} Header */
