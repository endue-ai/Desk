// ODF text in a frame or shape: paragraphs, headings and nested lists, spans, spaces, tabs and line
// breaks; properties from the frame's style (and the outline style of a list's level), then the
// paragraph's and span's styles; bullets and numbers from the list style.
import { paragraphOf, runOf } from "../deck.js";
import { autoNumber } from "../pptx/text.js";
import { attr, kid, kids } from "../xml.js";
import { chainOf, length, propsOf } from "./style.js";

/**
 * @typedef {import("../deck.js").Paragraph} Paragraph
 * @typedef {import("../deck.js").Run} Run
 * @typedef {import("./style.js").Styles} Styles
 * @typedef {import("./style.js").Props} Props
 * @typedef {{ index: Styles, frame: Element[], listStyle: Element | null }} TextContext
 *   frame: the chain of the frame's style (presentation or graphic family).
 */

const ALIGN = /** @type {Record<string, Paragraph["align"]>} */ ({
  start: "left",
  left: "left",
  center: "center",
  end: "right",
  right: "right",
  justify: "justify",
});

/** Apply text properties to a run. @param {Run} run @param {Props} p @param {Styles} index */
function applyText(run, p, index) {
  const size = p["font-size"];
  if (size)
    run.size = size.endsWith("%")
      ? (run.size * Number.parseFloat(size)) / 100
      : length(size, run.size);
  if (p["font-weight"])
    run.bold = p["font-weight"] === "bold" || Number.parseInt(p["font-weight"], 10) >= 600;
  if (p["font-style"]) run.italic = p["font-style"] !== "normal";
  if (p["text-underline-style"]) run.underline = p["text-underline-style"] !== "none";
  if (p["text-line-through-style"]) run.strike = p["text-line-through-style"] !== "none";
  if (p.color) run.color = p.color.toLowerCase();
  const font = p["font-name"]
    ? index.font(p["font-name"])
    : p["font-family"]?.replace(/^['"]|['"]$/g, "");
  if (font) run.font = font;
  const position = p["text-position"];
  if (position)
    run.baseline = position.startsWith("super")
      ? 33
      : position.startsWith("sub")
        ? -33
        : Number.parseFloat(position) || 0;
}

/** The chain for an outline level: Default-outline1 becomes Default-outline3 for level 2. */
function outlineChain(/** @type {TextContext} */ ctx, /** @type {number} */ level) {
  if (level === 0) return ctx.frame;
  const outline = [...ctx.frame].reverse().find((s) => /outline1$/.test(attr(s, "name") ?? ""));
  if (!outline) return ctx.frame;
  const name = (attr(outline, "name") ?? "").replace(/1$/, String(Math.min(9, level + 1)));
  const chain = chainOf(ctx.index, "presentation", name);
  return chain.length > (ctx.index.defaults("presentation") ? 1 : 0)
    ? [...ctx.frame, ...chain]
    : ctx.frame;
}

/**
 * The paragraphs of a text holder (draw:text-box, or a shape with text:p children).
 * @param {Element | null} holder
 * @param {TextContext} ctx
 * @returns {Paragraph[]}
 */
export function readParagraphs(holder, ctx) {
  /** @type {Paragraph[]} */
  const out = [];
  /** @type {Array<number | undefined>} */
  const counters = [];
  // depth counts the lists around an element; the first paragraph of a list item has its bullet.
  const visit = (
    /** @type {Element} */ el,
    /** @type {number} */ depth,
    /** @type {Element | null} */ list,
    /** @type {boolean} */ item,
  ) => {
    let first = item;
    for (const child of kids(el)) {
      const name = child.localName;
      if (name === "list")
        visit(child, depth + 1, ctx.index.list(attr(child, "style-name")) ?? list, false);
      else if (name === "list-item") visit(child, depth, list, true);
      else if (name === "list-header") visit(child, depth, list, false);
      else if (name === "p" || name === "h") {
        const level = Math.max(0, depth - 1);
        out.push(paragraph(child, level, first ? (list ?? ctx.listStyle) : null, counters, ctx));
        first = false;
      }
    }
  };
  if (holder) visit(holder, 0, null, false);
  return out;
}

/** One text:p or text:h. */
function paragraph(
  /** @type {Element} */ p,
  /** @type {number} */ level,
  /** @type {Element | null} */ list,
  /** @type {Array<number | undefined>} */ counters,
  /** @type {TextContext} */ ctx,
) {
  const chain = [
    ...outlineChain(ctx, level),
    ...chainOf(ctx.index, "paragraph", attr(p, "style-name")).slice(
      ctx.index.defaults("paragraph") ? 1 : 0,
    ),
  ];
  const pp = propsOf(chain, "paragraph-properties");
  const base = runOf("", { size: 18, color: "#000000" });
  applyText(base, propsOf(chain, "text-properties"), ctx.index);
  /** @type {Run[]} */
  const runs = [];
  const walk = (/** @type {Element} */ el, /** @type {Run} */ props) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ");
        if (text) runs.push({ ...props, text });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = /** @type {Element} */ (node);
      const name = child.localName;
      if (name === "s")
        runs.push({
          ...props,
          text: " ".repeat(Math.max(1, Number.parseInt(attr(child, "c") ?? "1", 10) || 1)),
        });
      else if (name === "tab") runs.push({ ...props, text: "\t" });
      else if (name === "line-break") runs.push({ ...props, text: "", lineBreak: true });
      else if (name === "span" || name === "a") {
        const style = { ...props };
        applyText(
          style,
          propsOf(
            chainOf(ctx.index, "text", attr(child, "style-name")).slice(
              ctx.index.defaults("text") ? 1 : 0,
            ),
            "text-properties",
          ),
          ctx.index,
        );
        walk(child, style);
      } else if (
        ![
          "frame",
          "annotation",
          "bookmark",
          "bookmark-start",
          "bookmark-end",
          "soft-page-break",
          "change",
        ].includes(name)
      )
        walk(child, props);
    }
  };
  walk(p, base);
  const hasText = runs.some((r) => r.text.trim() !== "");
  const levelStyle = list
    ? (kids(list).find((l) => attr(l, "level") === String(level + 1)) ?? null)
    : null;
  const position = kid(levelStyle, "list-level-properties");
  const alignment = kid(position, "list-level-label-alignment");
  const labelWidth = length(attr(position, "min-label-width"));
  // In a list the paragraph's own margin and indent add to the list level's.
  const ownMargin = length(pp["margin-left"]);
  const ownIndent = length(pp["text-indent"]);
  const marginLeft = levelStyle
    ? (alignment
        ? length(attr(alignment, "margin-left"))
        : length(attr(position, "space-before")) + labelWidth) + ownMargin
    : ownMargin;
  const indent = levelStyle
    ? (alignment ? length(attr(alignment, "text-indent")) : -labelWidth) + ownIndent
    : ownIndent;
  counters.length = Math.min(counters.length, level + 1);
  let bullet = null;
  if (levelStyle && hasText) {
    const first = runs.find((r) => r.text.trim() !== "") ?? base;
    const tp = propsOf([levelStyle], "text-properties");
    const size = tp["font-size"]?.endsWith("%")
      ? (first.size * Number.parseFloat(tp["font-size"])) / 100
      : first.size;
    let text = "•";
    if (levelStyle.localName === "list-level-style-bullet")
      text = attr(levelStyle, "bullet-char") ?? "•";
    else if (levelStyle.localName === "list-level-style-number") {
      const number =
        (counters[level] ?? Number.parseInt(attr(levelStyle, "start-value") ?? "1", 10) - 1) + 1;
      counters[level] = number;
      const format = attr(levelStyle, "num-format") ?? "1";
      const scheme = { a: "alphaLc", A: "alphaUc", i: "romanLc", I: "romanUc" }[format] ?? "arabic";
      text = `${attr(levelStyle, "num-prefix") ?? ""}${autoNumber(`${scheme}Plain`, number)}${attr(levelStyle, "num-suffix") ?? ""}`;
    }
    const font = tp["font-name"] ? ctx.index.font(tp["font-name"]) : tp["font-family"];
    bullet = {
      text,
      color: tp.color && tp["use-window-font-color"] !== "true" ? tp.color : first.color,
      font: font && !/symbol|wingding|opensymbol/i.test(font) ? font : first.font,
      size,
    };
  }
  const lineHeight = pp["line-height"];
  return paragraphOf(runs, {
    align: ALIGN[pp["text-align"] ?? "start"] ?? "left",
    level,
    marginLeft,
    indent,
    bullet,
    spaceBefore: length(pp["margin-top"]),
    spaceAfter: length(pp["margin-bottom"]),
    lineSpacing: lineHeight?.endsWith("%") ? Number.parseFloat(lineHeight) / 100 : 1,
    lineExact:
      lineHeight && !lineHeight.endsWith("%") && lineHeight !== "normal" ? length(lineHeight) : 0,
    size: runs[0]?.size ?? base.size,
  });
}

/** Plain text of paragraphs, one line each. @param {Paragraph[]} paragraphs */
export const textOfParagraphs = (paragraphs) =>
  paragraphs
    .map((p) =>
      p.runs
        .map((r) => (r.lineBreak ? "\n" : r.text))
        .join("")
        .trim(),
    )
    .join("\n")
    .trim();
