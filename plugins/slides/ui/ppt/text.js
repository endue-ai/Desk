// Text bodies of PowerPoint 97-2003 shapes: paragraphs and runs from a text atom and its style runs,
// over the master's levels for the text's type; bullets (characters, fonts, colours, sizes and
// automatic numbers), margins, spacing, fields (slide number, date, footer) and links; and the
// box's insets, anchor, wrap and direction from its OfficeArt properties. No DOM.
import { paragraphOf, runOf, textOf } from "../deck.js";
import { autoNumber } from "../pptx/text.js";
import { indexColor } from "./color.js";
import { value } from "./options.js";

/**
 * @typedef {import("../deck.js").TextBody} TextBody
 * @typedef {import("../deck.js").Paragraph} Paragraph
 * @typedef {import("../deck.js").Run} Run
 * @typedef {import("./styles.js").PF} PF
 * @typedef {import("./styles.js").CF} CF
 * @typedef {import("./styles.js").Level} Level
 * @typedef {import("./styles.js").PFRun} PFRun
 * @typedef {import("./styles.js").CFRun} CFRun
 * @typedef {import("./styles.js").Ruler} Ruler
 * @typedef {import("./options.js").Options} Options
 * @typedef {"slide" | "date" | "footer" | "header"} Field
 * @typedef {{
 *   text: string, type: number, paragraphs: PFRun[], characters: CFRun[], ruler: Ruler,
 *   fields: Map<number, Field>, links: Array<[number, number]>,
 *   numbers: Array<{ scheme: number, start: number } | null>
 * }} PptText  numbers: automatic numbering by paragraph run, from the PowerPoint 2000 extension.
 * @typedef {{
 *   levels: Level[][], scheme: string[], fonts: string[], slideNumber: number,
 *   footer: string, header: string, date: string
 * }} TextContext  levels: the levels a text inherits, lowest priority first.
 */

/** TextAutoNumberSchemeEnum values as DrawingML scheme names. */
const SCHEMES = [
  "alphaLcPeriod",
  "alphaUcPeriod",
  "arabicParenR",
  "arabicPeriod",
  "romanLcParenBoth",
  "romanLcParenR",
  "romanLcPeriod",
  "romanUcPeriod",
  "alphaLcParenBoth",
  "alphaLcParenR",
  "alphaUcParenBoth",
  "alphaUcParenR",
  "arabicParenBoth",
  "arabicPlain",
  "romanUcParenBoth",
  "romanUcParenR",
];

/** Symbol and Wingdings bullets as the characters they draw. */
const SYMBOLS = /** @type {Record<number, string>} */ ({
  167: "▪",
  216: "➢",
  252: "✔",
  113: "❏",
  118: "❖",
  110: "■",
  108: "●",
  159: "•",
  224: "➔",
  232: "➤",
  183: "•",
  111: "□",
  119: "⬧",
  168: "◆",
  45: "–",
});

const ALIGN = /** @type {Paragraph["align"][]} */ (["left", "center", "right", "justify"]);

/** The PF and CF of one level, merged down from level 0 through every inherited style. */
function inherited(/** @type {Level[][]} */ chain, /** @type {number} */ level) {
  /** @type {PF} */
  const pf = {};
  /** @type {CF} */
  const cf = {};
  for (const levels of chain)
    for (let l = 0; l <= level; l++) {
      Object.assign(pf, levels[l]?.pf);
      Object.assign(cf, levels[l]?.cf);
    }
  return { pf, cf };
}

/**
 * The run that covers character `at`: runs cover `count` characters each, in order.
 * @template {{ count: number }} R
 * @param {R[]} runs @param {number} at
 */
function runAt(runs, at) {
  let start = 0;
  for (const [i, run] of runs.entries()) {
    const count = Math.max(1, run.count);
    if (at < start + count) return { run, index: i, start, end: start + count };
    start += count;
  }
  return null;
}

/** Spacing before or after: a percentage of the line, or master units when negative. */
const spacing = (/** @type {number | undefined} */ v, /** @type {number} */ size) =>
  v === undefined ? 0 : v < 0 ? -v / 8 : (v / 100) * size * 1.2;

/** A run's properties from its CF. */
function runProps(
  /** @type {CF} */ cf,
  /** @type {TextContext} */ ctx,
  /** @type {number} */ type,
) {
  const fallback = ctx.scheme[type === 0 || type === 6 ? 3 : 1] ?? "#000000";
  return {
    size: cf.size && cf.size > 0 ? cf.size : 18,
    bold: Boolean(cf.bold),
    italic: Boolean(cf.italic),
    underline: Boolean(cf.underline),
    color: (cf.color !== undefined ? indexColor(cf.color, ctx.scheme) : null) ?? fallback,
    font: ctx.fonts[cf.font ?? 0] ?? "",
    baseline: cf.position ?? 0,
  };
}

/** The text a field shows. */
function fieldText(/** @type {Field} */ field, /** @type {TextContext} */ ctx) {
  if (field === "slide") return String(ctx.slideNumber);
  return field === "footer" ? ctx.footer : field === "header" ? ctx.header : ctx.date;
}

/**
 * The paragraphs of a text.
 * @param {PptText} t @param {TextContext} ctx @returns {Paragraph[]}
 */
export function paragraphsOf(t, ctx) {
  /** @type {Paragraph[]} */
  const out = [];
  /** Automatic numbers by level: the scheme and the last number. */
  /** @type {Array<[number, number] | undefined>} */
  const counters = [];
  let start = 0;
  for (const line of t.text.split("\r")) {
    const end = start + line.length;
    const pfRun = runAt(t.paragraphs, start);
    const level = pfRun?.run.level ?? 0;
    const base = inherited(ctx.levels, level);
    /** @type {PF} */
    const pf = { ...base.pf, ...t.ruler[level], ...pfRun?.run.pf };
    // Character runs, split again at links and line breaks.
    const cuts = new Set([start, end]);
    for (let at = start, r = runAt(t.characters, at); r && at < end; r = runAt(t.characters, at)) {
      cuts.add(Math.min(end, r.end));
      at = r.end;
    }
    for (const [a, b] of t.links) for (const c of [a, b]) if (c > start && c < end) cuts.add(c);
    for (let i = start; i < end; i++) if (t.text[i] === "\v") cuts.add(i).add(i + 1);
    const points = [...cuts].sort((a, b) => a - b);
    /** @type {Run[]} */
    const runs = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const [a = 0, b = 0] = [points[i], points[i + 1]];
      const cfRun = runAt(t.characters, a)?.run;
      const props = runProps({ ...base.cf, ...cfRun?.cf }, ctx, t.type);
      if (t.links.some(([x, y]) => a >= x && a < y)) {
        props.color = ctx.scheme[6] ?? props.color;
        props.underline = true;
      }
      if (t.text[a] === "\v") {
        runs.push(runOf("", { ...props, lineBreak: true }));
        continue;
      }
      let text = "";
      for (let c = a; c < b; c++) {
        const field = t.fields.get(c);
        text += field ? fieldText(field, ctx) : (t.text[c] ?? "");
      }
      runs.push(runOf(text, props));
    }
    const first = runs.find((r) => r.text !== "") ?? runOf("", runProps(base.cf, ctx, t.type));
    const size = first.size;
    const hasText = runs.some((r) => r.text.trim() !== "");
    let bullet = null;
    const number = pfRun ? t.numbers[pfRun.index] : null;
    if (hasText) counters.length = Math.min(counters.length, level + 1);
    if (hasText && pf.hasBullet) {
      let text = bulletChar(pf, ctx);
      if (number) {
        const last = counters[level];
        const n = last && last[0] === number.scheme ? last[1] + 1 : number.start;
        counters[level] = [number.scheme, n];
        text = autoNumber(SCHEMES[number.scheme] ?? "arabicPeriod", n);
      }
      const font = pf.bulletHasFont && pf.bulletFont !== undefined ? ctx.fonts[pf.bulletFont] : "";
      const sized = pf.bulletHasSize && pf.bulletSize ? pf.bulletSize : 100;
      bullet = {
        text,
        color:
          (pf.bulletHasColor && pf.bulletColor !== undefined
            ? indexColor(pf.bulletColor, ctx.scheme)
            : null) ?? first.color,
        font: number || !font || /^(Wingdings|Symbol|Webdings)/i.test(font) ? first.font : font,
        size: sized > 0 ? (size * sized) / 100 : -sized,
      };
    }
    if (hasText && !number) counters[level] = undefined;
    const lineSpacing = pf.lineSpacing ?? 100;
    const margin = (pf.leftMargin ?? 0) / 8;
    out.push(
      paragraphOf(runs, {
        align: ALIGN[pf.align ?? 0] ?? "justify",
        level,
        marginLeft: margin,
        indent: (pf.indent ?? 0) / 8 - margin,
        bullet,
        spaceBefore: spacing(pf.spaceBefore, size),
        spaceAfter: spacing(pf.spaceAfter, size),
        lineSpacing: lineSpacing > 0 ? lineSpacing / 100 : 1,
        lineExact: lineSpacing < 0 ? -lineSpacing / 8 : 0,
        size,
      }),
    );
    start = end + 1;
  }
  return out;
}

/** A bullet's character, with Symbol and Wingdings characters drawn as Unicode. */
function bulletChar(/** @type {PF} */ pf, /** @type {TextContext} */ ctx) {
  const code = pf.bulletChar ?? 0x2022;
  const font =
    pf.bulletHasFont && pf.bulletFont !== undefined ? (ctx.fonts[pf.bulletFont] ?? "") : "";
  const symbolic = /^(Wingdings|Symbol|Webdings)/i.test(font) || (code >= 0xf000 && code <= 0xf0ff);
  if (symbolic) return SYMBOLS[code & 0xff] ?? "•";
  return code === 0 || code === 0xd || code === 0xb ? "•" : String.fromCharCode(code);
}

/** anchorText values: top, middle and bottom, with their centred and baseline variants. */
const ANCHORS = /** @type {TextBody["anchor"][]} */ ([
  "top",
  "middle",
  "bottom",
  "top",
  "middle",
  "bottom",
  "top",
  "bottom",
  "top",
  "bottom",
]);

/**
 * A text body: the paragraphs in the box's insets, anchor, wrap and direction.
 * @param {Paragraph[]} paragraphs @param {Options} opts @returns {TextBody}
 */
export function bodyOf(paragraphs, opts) {
  const emu = (/** @type {number} */ pid, /** @type {number} */ fallback) =>
    (value(opts, pid, fallback) | 0) / 12700;
  const flow = value(opts, 0x0088);
  return textOf(paragraphs, {
    inset: {
      left: emu(0x0081, 91440),
      top: emu(0x0082, 45720),
      right: emu(0x0083, 91440),
      bottom: emu(0x0084, 45720),
    },
    anchor: ANCHORS[value(opts, 0x0087)] ?? "top",
    wrap: value(opts, 0x0085) !== 2,
    vertical: flow === 1 || flow === 3 || flow === 5 ? "vert" : flow === 2 ? "vert270" : "horz",
  });
}
