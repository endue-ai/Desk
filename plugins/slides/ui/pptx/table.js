// DrawingML tables: the grid, rows, spans and merges, cell text, margins, fills and borders, with the
// table style (from tableStyles.xml, or the built-in Medium Style 2 the default tables use) applied
// part by part: whole table, bands, first and last columns and rows, then the cell's own.
import { boxOf, NO_FILL } from "../deck.js";
import { attr, bool, kid, kids, num, parseXml } from "../xml.js";
import { childColor } from "./color.js";
import { fillElement, fillOf, lineOf, styleRef } from "./fill.js";
import { readText } from "./text.js";
import { fontOf } from "./theme.js";

/**
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("../deck.js").Cell} Cell
 * @typedef {import("../deck.js").Line} Line
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("./shapes.js").Scope} Scope
 */

const EMU = 12700;
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const ln = (/** @type {number} */ w, /** @type {string} */ color) =>
  `<a:ln w="${w}"><a:solidFill><a:schemeClr val="${color}"/></a:solidFill></a:ln>`;
const fill = (/** @type {string} */ color, tint = "") =>
  `<a:fill><a:solidFill><a:schemeClr val="${color}">${tint && `<a:tint val="${tint}"/>`}</a:schemeClr></a:solidFill></a:fill>`;
const bold = (/** @type {string} */ color) =>
  `<a:tcTxStyle b="on"><a:fontRef idx="minor"/><a:schemeClr val="${color}"/></a:tcTxStyle>`;

/** Medium Style 2 in one accent: the style PowerPoint and python-pptx give new tables. */
const mediumStyle2 = (/** @type {string} */ accent) =>
  parseXml(`<a:tblStyle ${A}>
<a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"/><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>
${["left", "right", "top", "bottom", "insideH", "insideV"].map((s) => `<a:${s}>${ln(12700, "lt1")}</a:${s}>`).join("")}
</a:tcBdr>${fill(accent, "20000")}</a:tcStyle></a:wholeTbl>
<a:band1H><a:tcStyle>${fill(accent, "40000")}</a:tcStyle></a:band1H>
<a:band1V><a:tcStyle>${fill(accent, "40000")}</a:tcStyle></a:band1V>
<a:lastCol>${bold("lt1")}<a:tcStyle>${fill(accent)}</a:tcStyle></a:lastCol>
<a:firstCol>${bold("lt1")}<a:tcStyle>${fill(accent)}</a:tcStyle></a:firstCol>
<a:lastRow>${bold("lt1")}<a:tcStyle><a:tcBdr><a:top>${ln(38100, "lt1")}</a:top></a:tcBdr>${fill(accent)}</a:tcStyle></a:lastRow>
<a:firstRow>${bold("lt1")}<a:tcStyle><a:tcBdr><a:bottom>${ln(38100, "lt1")}</a:bottom></a:tcBdr>${fill(accent)}</a:tcStyle></a:firstRow>
</a:tblStyle>`);

const BUILT_IN = /** @type {Record<string, string>} */ ({
  "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}": "accent1",
  "{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}": "accent2",
  "{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}": "accent3",
  "{00A15C55-8517-42AA-B614-E9B94910E393}": "accent4",
  "{7DF18680-E054-41AD-8BC1-D1AEF772440D}": "accent5",
  "{93296810-A885-4BE3-A3E7-6D5BEEA58F35}": "accent6",
  "{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}": "dk1",
});
/** Styles that draw nothing but, for the second, a grid. */
const PLAIN = /** @type {Record<string, string>} */ ({
  "{2D5ABB26-0587-4C30-8999-92F81FD0307C}": "",
  "{5940675A-B579-460E-94D1-54222C63F5DA}": `<a:wholeTbl><a:tcStyle><a:tcBdr>${["left", "right", "top", "bottom", "insideH", "insideV"].map((s) => `<a:${s}>${ln(12700, "tx1")}</a:${s}>`).join("")}</a:tcBdr></a:tcStyle></a:wholeTbl>`,
});

/** The style a table names: its own definition, a built-in one, or Medium Style 2 - Accent 1. */
export function tableStyle(/** @type {string | null} */ id, /** @type {Element | null} */ own) {
  if (own) return own;
  if (id && id in PLAIN) return parseXml(`<a:tblStyle ${A}>${PLAIN[id]}</a:tblStyle>`);
  return mediumStyle2((id && BUILT_IN[id]) || "accent1");
}

/**
 * @typedef {{ fill?: Fill, borders: Record<string, { el: Element | null, ctx: import("./fill.js").PartContext }>,
 *   bold?: boolean, italic?: boolean, color?: string, font?: string }} CellLook
 */

/** Apply one part of a table style (wholeTbl, band1H, ...) to a cell's look. */
function applyPart(
  /** @type {CellLook} */ look,
  /** @type {Element | null} */ part,
  /** @type {Scope} */ scope,
  /** @type {{ top: boolean, bottom: boolean, left: boolean, right: boolean }} */ edge,
) {
  if (!part) return;
  const { ctx } = scope;
  const tx = kid(part, "tcTxStyle");
  if (tx) {
    if (attr(tx, "b") !== null) look.bold = bool(tx, "b");
    if (attr(tx, "i") !== null) look.italic = bool(tx, "i");
    const color = childColor(tx, ctx);
    if (color) look.color = color;
    const ref = kid(tx, "fontRef");
    if (ref) look.font = fontOf(attr(ref, "idx") === "major" ? "+mj-lt" : "+mn-lt", ctx.theme);
  }
  const style = kid(part, "tcStyle");
  const filled = kid(style, "fill");
  if (filled) look.fill = fillOf(fillElement(filled), ctx) ?? look.fill;
  const ref = kid(style, "fillRef");
  if (ref) {
    const found = styleRef(ref, ctx.theme.fills, ctx);
    if (found) look.fill = fillOf(found.el, found.ctx) ?? look.fill;
  }
  const borders = kid(style, "tcBdr");
  const side = (/** @type {string} */ name) => {
    const el = kid(borders, name);
    return el ? { el: kid(el, "ln"), ctx } : null;
  };
  const pick = (
    /** @type {string} */ outer,
    /** @type {string} */ inner,
    /** @type {boolean} */ isEdge,
  ) => (isEdge ? side(outer) : (side(inner) ?? null));
  for (const [
    name,
    outer,
    inner,
    isEdge,
  ] of /** @type {Array<[string, string, string, boolean]>} */ ([
    ["top", "top", "insideH", edge.top],
    ["bottom", "bottom", "insideH", edge.bottom],
    ["left", "left", "insideV", edge.left],
    ["right", "right", "insideV", edge.right],
  ])) {
    const found = pick(outer, inner, isEdge);
    if (found) look.borders[name] = found;
  }
}

/**
 * @param {Element} tbl
 * @param {Box} box
 * @param {string} name
 * @param {Scope} scope
 * @returns {SlideElement}
 */
export function readTable(tbl, box, name, scope) {
  const pr = kid(tbl, "tblPr");
  const flags = Object.fromEntries(
    ["firstRow", "lastRow", "firstCol", "lastCol", "bandRow", "bandCol"].map((f) => [
      f,
      bool(pr, f),
    ]),
  );
  const styleId = kid(pr, "tableStyleId")?.textContent?.trim() ?? null;
  const style = tableStyle(styleId, scope.table(styleId));
  const columns = kids(kid(tbl, "tblGrid"), "gridCol").map((c) => num(c, "w") / EMU);
  const trs = kids(tbl, "tr");
  const rows = trs.map((tr, r) => {
    const tcs = kids(tr, "tc");
    const cells = tcs.map((tc, c) => {
      const edge = {
        top: r === 0,
        bottom: r === trs.length - 1,
        left: c === 0,
        right: c === tcs.length - 1,
      };
      /** @type {CellLook} */
      const look = { borders: {} };
      // A row part's cells have their top and bottom on the part's edge; a column part's, their sides.
      const row = { ...edge, top: true, bottom: true };
      const col = { ...edge, left: true, right: true };
      applyPart(look, kid(style, "wholeTbl"), scope, edge);
      const bodyRow = flags.firstRow ? r - 1 : r;
      if (flags.bandRow && bodyRow >= 0)
        applyPart(look, kid(style, bodyRow % 2 ? "band2H" : "band1H"), scope, row);
      const bodyCol = flags.firstCol ? c - 1 : c;
      if (flags.bandCol && bodyCol >= 0)
        applyPart(look, kid(style, bodyCol % 2 ? "band2V" : "band1V"), scope, col);
      if (flags.firstCol && c === 0) applyPart(look, kid(style, "firstCol"), scope, col);
      if (flags.lastCol && c === tcs.length - 1) applyPart(look, kid(style, "lastCol"), scope, col);
      if (flags.lastRow && r === trs.length - 1) applyPart(look, kid(style, "lastRow"), scope, row);
      if (flags.firstRow && r === 0) applyPart(look, kid(style, "firstRow"), scope, row);
      const tcPr = kid(tc, "tcPr");
      const own = fillElement(tcPr);
      const cellFill = (own ? fillOf(own, scope.ctx) : undefined) ?? look.fill ?? NO_FILL;
      /** @type {Record<string, Line | null>} */
      const borders = {};
      for (const [side, tag] of [
        ["left", "lnL"],
        ["right", "lnR"],
        ["top", "lnT"],
        ["bottom", "lnB"],
      ]) {
        const chain = [look.borders[side ?? ""] ?? { el: null, ctx: scope.ctx }];
        const explicit = kid(tcPr, tag ?? "");
        if (explicit) chain.push({ el: explicit, ctx: scope.ctx });
        borders[side ?? ""] = lineOf(chain);
      }
      const text =
        readText(kid(tc, "txBody"), {
          ctx: scope.ctx,
          bodies: [],
          lists: scope.lists(""),
          upper: [],
          base: {
            ...(look.bold !== undefined ? { bold: look.bold } : {}),
            ...(look.italic !== undefined ? { italic: look.italic } : {}),
            ...(look.color ? { color: look.color } : {}),
            ...(look.font ? { font: look.font } : {}),
          },
          fontRef:
            look.color || look.font ? { font: look.font ?? "", color: look.color ?? null } : null,
          slideNumber: scope.slideNumber,
        }) ?? readText(null, { ctx: scope.ctx, bodies: [], lists: [], upper: [] });
      if (text) {
        text.inset = {
          left: num(tcPr, "marL", 91440) / EMU,
          right: num(tcPr, "marR", 91440) / EMU,
          top: num(tcPr, "marT", 45720) / EMU,
          bottom: num(tcPr, "marB", 45720) / EMU,
        };
        const anchor = attr(tcPr, "anchor");
        text.anchor = anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top";
      }
      /** @type {Cell} */
      const cell = {
        text: text ?? {
          paragraphs: [],
          anchor: "top",
          inset: { left: 0, top: 0, right: 0, bottom: 0 },
          wrap: true,
          vertical: "horz",
          scale: 1,
          lineReduction: 0,
        },
        fill: cellFill,
        borders: {
          left: borders.left ?? null,
          top: borders.top ?? null,
          right: borders.right ?? null,
          bottom: borders.bottom ?? null,
        },
        colSpan: Math.max(1, num(tc, "gridSpan", 1)),
        rowSpan: Math.max(1, num(tc, "rowSpan", 1)),
        merged: bool(tc, "hMerge") || bool(tc, "vMerge"),
      };
      return cell;
    });
    return { height: num(tr, "h") / EMU, cells };
  });
  return { type: "table", name, box: box ?? boxOf(), columns, rows };
}
