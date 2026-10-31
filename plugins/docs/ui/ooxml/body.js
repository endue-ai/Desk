// OOXML block content: paragraphs with their resolved style, numbering and outline level (split at
// page breaks), tables with grid spans and vertical merges as colSpan and rowSpan, content controls
// and tracked block insertions, and the sections their w:sectPr close.
import { paragraph, twips } from "../model.js";
import { attr, kid, kids, num } from "../xml.js";
import { inlines } from "./inline.js";
import { mergePara, paraProps } from "./styles.js";

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Paragraph} Paragraph
 * @typedef {import("./inline.js").Ctx & { numbering: ReturnType<typeof import("./numbering.js").createNumbering> }} BodyCtx
 */

const HEADING = /^heading ([1-6])$/i;

/**
 * The blocks of a container (body, cell, header, note, comment, text box), calling `onSection`
 * with each paragraph-level w:sectPr after the blocks it closes.
 * @param {Element} container
 * @param {BodyCtx} ctx
 * @param {(sectPr: Element, blocks: Block[]) => void} [onSection]
 * @returns {Block[]}
 */
export function blocks(container, ctx, onSection) {
  /** @type {Block[]} */
  let out = [];
  const visit = (/** @type {Element} */ parent) => {
    for (const el of kids(parent)) {
      const name = el.localName;
      if (name === "p") {
        out.push(...paragraphBlocks(el, ctx));
        out.push(...ctx.pending.splice(0));
        const sectPr = kid(kid(el, "pPr"), "sectPr");
        if (sectPr && onSection) {
          onSection(sectPr, out);
          out = [];
        }
      } else if (name === "tbl") out.push(table(el, ctx));
      else if (name === "sdt") visit(kid(el, "sdtContent") ?? el);
      else if (["customXml", "ins", "moveTo"].includes(name)) visit(el);
      else if (name === "AlternateContent") {
        const choice = kid(el, "Choice") ?? kid(el, "Fallback");
        if (choice) visit(choice);
      } else if (name === "commentRangeStart" || name === "commentRangeEnd") {
        const id = attr(el, "id") ?? "";
        if (name === "commentRangeEnd") ctx.comments.delete(id);
        else {
          ctx.ranged.add(id);
          if (ctx.known.has(id)) ctx.comments.add(id);
        }
      }
    }
  };
  visit(container);
  return out;
}

/**
 * One w:p as one paragraph, or several when page breaks split it.
 * @param {Element} p
 * @param {BodyCtx} ctx
 * @returns {Block[]}
 */
function paragraphBlocks(p, ctx) {
  const { styles, numbering } = ctx;
  const pPr = kid(p, "pPr");
  const direct = paraProps(pPr);
  const style = styles.paragraph(attr(kid(pPr, "pStyle"), "val"));
  const numId = direct.numId ?? style?.pPr.numId;
  const ilvl = direct.ilvl ?? style?.pPr.ilvl ?? 0;
  const numbered = numId ? numbering.next(numId, ilvl) : undefined;
  const props = mergePara(styles.basePara, style?.pPr ?? {}, numbered?.level.pPr ?? {}, direct);
  const base = { ...styles.baseRun, ...style?.rPr };
  const all = inlines(p, base, ctx);

  /** @type {Partial<Paragraph>} */
  const shape = {};
  if (style && style.name !== "Normal") shape.style = style.name;
  const level =
    props.level !== undefined && props.level < 6 ? props.level + 1 : headingOf(style?.name);
  if (level) shape.level = level;
  if (props.align) shape.align = props.align;
  if (props.indent && Object.keys(props.indent).length) shape.indent = props.indent;
  if (props.spacing && Object.keys(props.spacing).length) shape.spacing = props.spacing;
  if (props.rtl) shape.rtl = true;
  if (numbered && numbered.text !== "") shape.marker = numbered.text;

  /** @type {import("../model.js").Inline[][]} */
  const parts = [[]];
  for (const item of all) {
    if (/** @type {{ type: string }} */ (item).type === "pagebreak") parts.push([]);
    else parts.at(-1)?.push(item);
  }
  /** @type {Block[]} */
  const out = [];
  if (props.pageBreakBefore) out.push({ type: "pagebreak" });
  let first = true;
  parts.forEach((items, i) => {
    if (i > 0) out.push({ type: "pagebreak" });
    // A break at the start or end of a paragraph leaves no empty paragraph beside it.
    if (items.length === 0 && parts.length > 1) return;
    out.push(piece(items, shape, first));
    first = false;
  });
  return out;
}

/** A paragraph, or the rest of one after a page break (no marker, no first-line indent). */
function piece(
  /** @type {import("../model.js").Inline[]} */ items,
  /** @type {Partial<Paragraph>} */ shape,
  /** @type {boolean} */ first,
) {
  if (first) return paragraph(items, shape);
  const { marker: _, ...rest } = shape;
  return paragraph(items, { ...rest, indent: { ...rest.indent, first: 0 } });
}

const headingOf = (/** @type {string | undefined} */ name) => {
  const match = HEADING.exec(name ?? "");
  return match ? Number(match[1]) : undefined;
};

/**
 * A w:tbl: rows of cells, grid spans as colSpan, vertical merges as rowSpan on the first cell.
 * @param {Element} tbl
 * @param {BodyCtx} ctx
 * @returns {import("../model.js").Table}
 */
function table(tbl, ctx) {
  const tblPr = kid(tbl, "tblPr");
  const columns = kids(kid(tbl, "tblGrid"), "gridCol").map((c) => twips(num(c, "w") ?? 0));
  /** @type {import("../model.js").Row[]} */
  const rows = [];
  /** The cell a vertical merge started in, by grid column. */
  /** @type {Map<number, import("../model.js").Cell>} */
  const open = new Map();
  /** Borders drawn cell by cell (w:tcBorders), as LibreOffice writes them. */
  let cellBorders = false;
  /** @type {Element[]} */
  const trs = [];
  const collect = (/** @type {Element} */ parent) => {
    for (const el of kids(parent)) {
      if (el.localName === "tr") trs.push(el);
      else if (el.localName === "sdt") collect(kid(el, "sdtContent") ?? el);
      else if (["customXml", "ins"].includes(el.localName)) collect(el);
    }
  };
  collect(tbl);
  for (const tr of trs) {
    const trPr = kid(tr, "trPr");
    if (kid(trPr, "del")) continue;
    /** @type {import("../model.js").Row} */
    const row = { cells: [] };
    if (kid(trPr, "tblHeader")) row.header = true;
    let col = num(kid(trPr, "gridBefore"), "val") ?? 0;
    /** @type {Element[]} */
    const tcs = [];
    const cells = (/** @type {Element} */ parent) => {
      for (const el of kids(parent)) {
        if (el.localName === "tc") tcs.push(el);
        else if (el.localName === "sdt") cells(kid(el, "sdtContent") ?? el);
        else if (el.localName === "customXml") cells(el);
      }
    };
    cells(tr);
    for (const tc of tcs) {
      const tcPr = kid(tc, "tcPr");
      if (
        kids(kid(tcPr, "tcBorders")).some(
          (b) => !["nil", "none"].includes(attr(b, "val") ?? "none"),
        )
      )
        cellBorders = true;
      const span = Math.max(1, num(kid(tcPr, "gridSpan"), "val") ?? 1);
      const merge = kid(tcPr, "vMerge");
      const mergeVal = attr(merge, "val");
      if (merge && mergeVal !== "restart") {
        const origin = open.get(col);
        if (origin) {
          origin.rowSpan++;
          col += span;
          continue;
        }
      }
      /** @type {import("../model.js").Cell} */
      const cell = { blocks: blocks(tc, ctx), colSpan: span, rowSpan: 1 };
      const tcW = kid(tcPr, "tcW");
      if (tcW && (attr(tcW, "type") ?? "dxa") === "dxa" && num(tcW, "w"))
        cell.width = twips(num(tcW, "w") ?? 0);
      else if (columns.length >= col + span)
        cell.width = columns.slice(col, col + span).reduce((a, b) => a + b, 0) || undefined;
      const fill = attr(kid(tcPr, "shd"), "fill");
      if (fill && /^[0-9a-f]{6}$/i.test(fill)) cell.fill = `#${fill.toUpperCase()}`;
      for (let i = col; i < col + span; i++) {
        if (merge) open.set(i, cell);
        else open.delete(i);
      }
      row.cells.push(cell);
      col += span;
    }
    rows.push(row);
  }
  /** @type {import("../model.js").Table} */
  const out = { type: "table", rows, borders: ctx.styles.tableBorders(tblPr) || cellBorders };
  if (columns.some((c) => c > 0)) out.columns = columns;
  return out;
}
