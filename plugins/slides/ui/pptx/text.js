// DrawingML text bodies: paragraphs and runs, with properties inherited level by level from the
// master's text styles, the master and layout placeholders' list styles and the shape's own; theme
// fonts and colours resolved; bullets and numbering; normAutofit's font scale and line reduction.
import { paragraphOf, runOf, textOf } from "../deck.js";
import { attr, bool, kid, kids, num, path } from "../xml.js";
import { childColor } from "./color.js";
import { fontOf } from "./theme.js";

/**
 * @typedef {import("../deck.js").TextBody} TextBody
 * @typedef {import("../deck.js").Paragraph} Paragraph
 * @typedef {import("../deck.js").Run} Run
 * @typedef {import("./fill.js").PartContext} PartContext
 * @typedef {{
 *   ctx: PartContext, bodies: Element[], lists: Element[], upper: Element[],
 *   fontRef?: { font: string, color: string | null } | null, slideNumber?: number,
 *   base?: Partial<Run>
 * }} TextOptions
 *   bodies: bodyPr elements, lowest priority first. lists: list styles under a p:style fontRef
 *   (the master's text style, the presentation's defaults); upper: list styles over it (the master
 *   and layout placeholders', the shape's own). base: run properties a table style sets.
 */

const EMU = 12700;

/** Wingdings and Symbol bullets as the characters they draw. */
const SYMBOLS = /** @type {Record<string, string>} */ ({
  "§": "▪",
  Ø: "➢",
  ü: "✔",
  q: "❏",
  v: "❖",
  n: "■",
  l: "●",
  Ÿ: "•",
  à: "➔",
  è: "➤",
  "·": "•",
  o: "□",
  w: "⬧",
});

const ROMAN = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** A number in an autoNum scheme: arabicPeriod 3 -> "3.", alphaLcParenR 2 -> "b)". */
export function autoNumber(/** @type {string} */ scheme, /** @type {number} */ value) {
  const m = /^(arabic|romanUc|romanLc|alphaUc|alphaLc)(.*)$/.exec(scheme);
  const [, kind = "arabic", suffix = "Period"] = m ?? [];
  let text = String(value);
  if (kind.startsWith("roman")) {
    let rest = value;
    text = "";
    for (const [v, s] of ROMAN)
      while (rest >= Number(v)) {
        text += s;
        rest -= Number(v);
      }
  } else if (kind.startsWith("alpha")) {
    text = "";
    for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / 26))
      text = String.fromCharCode(97 + ((rest - 1) % 26)) + text;
  }
  if (kind.endsWith("Uc")) text = text.toUpperCase();
  if (suffix.startsWith("ParenBoth")) return `(${text})`;
  if (suffix.startsWith("ParenR")) return `${text})`;
  if (suffix.startsWith("Plain") || suffix === "Db" || suffix === "") return text;
  if (suffix.startsWith("Minus")) return `- ${text} -`;
  return `${text}.`;
}

/** @typedef {Run & { highlight?: string }} RunProps */

/** Apply an rPr or defRPr to run properties. @param {RunProps} props @param {Element | null} rPr */
function applyRun(props, rPr, /** @type {PartContext} */ ctx) {
  if (!rPr) return;
  if (attr(rPr, "sz") !== null) props.size = num(rPr, "sz") / 100;
  if (attr(rPr, "b") !== null) props.bold = bool(rPr, "b");
  if (attr(rPr, "i") !== null) props.italic = bool(rPr, "i");
  const u = attr(rPr, "u");
  if (u !== null) props.underline = u !== "none";
  const strike = attr(rPr, "strike");
  if (strike !== null) props.strike = strike !== "noStrike";
  if (attr(rPr, "baseline") !== null) props.baseline = num(rPr, "baseline") / 1000;
  const fill = kid(rPr, "solidFill", "gradFill", "noFill");
  if (fill?.localName === "solidFill") props.color = childColor(fill, ctx) ?? props.color;
  if (fill?.localName === "gradFill")
    props.color = childColor(path(fill, "gsLst", "gs"), ctx) ?? props.color;
  const font = fontOf(attr(kid(rPr, "latin"), "typeface"), ctx.theme);
  if (font) props.font = font;
  const highlight = childColor(kid(rPr, "highlight"), ctx);
  if (highlight) props.highlight = highlight;
  if (kid(rPr, "hlinkClick")) {
    props.color = `#${ctx.scheme.hlink ?? "0563c1"}`;
    props.underline = true;
  }
}

/**
 * @typedef {{
 *   align: Paragraph["align"], marginLeft: number, indent: number, spaceBefore: [number, boolean],
 *   spaceAfter: [number, boolean], lineSpacing: number, lineExact: number,
 *   bullet: { kind: "none" | "char" | "auto", char: string, scheme: string, start: number,
 *     font: string, color: string | null, size: [number, boolean] }
 * }} ParaProps  Spaces are [value, isPercent]; bullet size is [value, isPoints].
 */

const ALIGN = /** @type {Record<string, Paragraph["align"]>} */ ({
  l: "left",
  ctr: "center",
  r: "right",
  just: "justify",
  dist: "justify",
});

/** @param {ParaProps} props @param {Element | null} pPr */
function applyParagraph(props, pPr, /** @type {PartContext} */ ctx) {
  if (!pPr) return;
  const algn = attr(pPr, "algn");
  if (algn) props.align = ALIGN[algn] ?? "left";
  if (attr(pPr, "marL") !== null) props.marginLeft = num(pPr, "marL") / EMU;
  if (attr(pPr, "indent") !== null) props.indent = num(pPr, "indent") / EMU;
  const space = (/** @type {Element | null} */ el) => {
    const pts = kid(el, "spcPts");
    if (pts) return /** @type {[number, boolean]} */ ([num(pts, "val") / 100, false]);
    const pct = kid(el, "spcPct");
    return pct ? /** @type {[number, boolean]} */ ([num(pct, "val") / 100000, true]) : null;
  };
  props.spaceBefore = space(kid(pPr, "spcBef")) ?? props.spaceBefore;
  props.spaceAfter = space(kid(pPr, "spcAft")) ?? props.spaceAfter;
  const line = space(kid(pPr, "lnSpc"));
  if (line) {
    props.lineSpacing = line[1] ? line[0] : 1;
    props.lineExact = line[1] ? 0 : line[0];
  }
  const b = props.bullet;
  for (const el of kids(pPr)) {
    const name = el.localName;
    if (name === "buNone") b.kind = "none";
    else if (name === "buChar") {
      b.kind = "char";
      b.char = attr(el, "char") ?? "•";
    } else if (name === "buAutoNum") {
      b.kind = "auto";
      b.scheme = attr(el, "type") ?? "arabicPeriod";
      b.start = num(el, "startAt", 1);
    } else if (name === "buBlip") {
      b.kind = "char";
      b.char = "•";
    } else if (name === "buFont") b.font = fontOf(attr(el, "typeface"), ctx.theme);
    else if (name === "buFontTx") b.font = "";
    else if (name === "buClr") b.color = childColor(el, ctx);
    else if (name === "buClrTx") b.color = null;
    else if (name === "buSzPct") b.size = [num(el, "val") / 100000, false];
    else if (name === "buSzPts") b.size = [num(el, "val") / 100, true];
    else if (name === "buSzTx") b.size = [1, false];
  }
}

/**
 * Read a txBody.
 * @param {Element | null} txBody
 * @param {TextOptions} options
 * @returns {TextBody | null}
 */
export function readText(txBody, options) {
  if (!txBody) return null;
  const { ctx } = options;
  const body = textOf([]);
  let scale = 1;
  let reduction = 0;
  for (const bodyPr of [...options.bodies, kid(txBody, "bodyPr")]) {
    if (!bodyPr) continue;
    const inset = body.inset;
    if (attr(bodyPr, "lIns") !== null) inset.left = num(bodyPr, "lIns") / EMU;
    if (attr(bodyPr, "tIns") !== null) inset.top = num(bodyPr, "tIns") / EMU;
    if (attr(bodyPr, "rIns") !== null) inset.right = num(bodyPr, "rIns") / EMU;
    if (attr(bodyPr, "bIns") !== null) inset.bottom = num(bodyPr, "bIns") / EMU;
    const anchor = attr(bodyPr, "anchor");
    if (anchor) body.anchor = anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top";
    const wrap = attr(bodyPr, "wrap");
    if (wrap) body.wrap = wrap !== "none";
    const vert = attr(bodyPr, "vert");
    if (vert) body.vertical = vert === "vert270" ? "vert270" : vert === "horz" ? "horz" : "vert";
    const autofit = kid(bodyPr, "normAutofit", "noAutofit", "spAutoFit");
    if (autofit) {
      const norm = autofit.localName === "normAutofit";
      scale = norm ? num(autofit, "fontScale", 100000) / 100000 : 1;
      reduction = norm ? num(autofit, "lnSpcReduction", 0) / 100000 : 0;
    }
  }
  body.scale = scale;
  body.lineReduction = reduction;
  /** Numbering by level: the scheme and the last number. @type {Array<[string, number] | undefined>} */
  const counters = [];
  for (const p of kids(txBody, "p")) {
    const pPr = kid(p, "pPr");
    const level = Math.min(8, Math.max(0, num(pPr, "lvl")));
    const key = `lvl${level + 1}pPr`;
    const levels = (/** @type {Element[]} */ list) =>
      list.map((l) => kid(l, key) ?? kid(l, "defPPr"));
    const under = levels(options.lists);
    const over = levels([...options.upper, kid(txBody, "lstStyle")]);
    /** @type {ParaProps} */
    const pp = {
      align: "left",
      marginLeft: 0,
      indent: 0,
      spaceBefore: [0, false],
      spaceAfter: [0, false],
      lineSpacing: 1,
      lineExact: 0,
      bullet: {
        kind: "none",
        char: "",
        scheme: "",
        start: 1,
        font: "",
        color: null,
        size: [1, false],
      },
    };
    /** @type {RunProps} */
    const base = runOf("", {
      font: fontOf("+mn-lt", ctx.theme),
      color: `#${ctx.scheme[ctx.map.tx1 ?? "dk1"] ?? "000000"}`,
      ...options.base,
    });
    for (const el of under) {
      applyParagraph(pp, el, ctx);
      applyRun(base, kid(el, "defRPr"), ctx);
    }
    if (options.fontRef) {
      if (options.fontRef.font) base.font = options.fontRef.font;
      if (options.fontRef.color) base.color = options.fontRef.color;
    }
    for (const el of [...over, pPr]) {
      applyParagraph(pp, el, ctx);
      applyRun(base, kid(el, "defRPr"), ctx);
    }
    /** @type {Run[]} */
    const runs = [];
    for (const r of kids(p, "r", "br", "fld")) {
      const props = { ...base };
      applyRun(props, kid(r, "rPr"), ctx);
      props.size *= scale;
      if (r.localName === "br") {
        runs.push({ ...props, text: "", lineBreak: true });
        continue;
      }
      let text = kid(r, "t")?.textContent ?? "";
      if (r.localName === "fld" && attr(r, "type") === "slidenum" && options.slideNumber)
        text = String(options.slideNumber);
      if (attr(kid(r, "rPr"), "cap") === "all") text = text.toUpperCase();
      runs.push({ ...props, text });
    }
    const end = { ...base };
    applyRun(end, kid(p, "endParaRPr"), ctx);
    const size = (runs[0]?.size ?? end.size * scale) || 18;
    const hasText = runs.some((r) => r.text !== "");
    // Numbering counts paragraphs of one level; a shallower paragraph starts the deeper ones over,
    // and a paragraph with text but no number ends its level's list.
    if (hasText) counters.length = Math.min(counters.length, level + 1);
    let bullet = null;
    if (hasText && pp.bullet.kind !== "none") {
      const b = pp.bullet;
      let text = b.char;
      if (b.kind === "auto") {
        const last = counters[level];
        const number = last && last[0] === b.scheme ? last[1] + 1 : b.start;
        counters[level] = [b.scheme, number];
        text = autoNumber(b.scheme, number);
      } else if (b.font === "Wingdings" || b.font === "Symbol" || b.font.startsWith("Wingdings")) {
        text = SYMBOLS[b.char] ?? "•";
      }
      const first = runs.find((r) => r.text !== "") ?? end;
      bullet = {
        text,
        color: b.color ?? first.color,
        font:
          b.kind === "auto" || !b.font || b.font === "Wingdings" || b.font === "Symbol"
            ? first.font
            : b.font,
        size: b.size[1] ? b.size[0] * scale : first.size * b.size[0],
      };
    }
    if (hasText && pp.bullet.kind !== "auto") counters[level] = undefined;
    const spacing = (/** @type {[number, boolean]} */ s) => (s[1] ? s[0] * size * 1.2 : s[0]);
    body.paragraphs.push(
      paragraphOf(runs, {
        align: pp.align,
        level,
        marginLeft: pp.marginLeft,
        indent: pp.indent,
        bullet,
        spaceBefore: spacing(pp.spaceBefore) * (1 - reduction),
        spaceAfter: spacing(pp.spaceAfter),
        lineSpacing: Math.max(0.5, pp.lineSpacing - reduction),
        lineExact: pp.lineExact,
        size,
      }),
    );
  }
  return body;
}
