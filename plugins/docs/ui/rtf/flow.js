// One RTF flow (the body, a footnote, a header, an annotation): it gathers inlines into
// paragraphs, paragraphs marked \intbl into cells, cells into rows (\cell, \row) with the row
// definition's horizontal and vertical merges, and rows into tables.
import { paragraph, twips } from "../model.js";

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {{ right: number, hmerge?: "first" | "next", vmerge?: "first" | "next", fill?: string }} CellDef
 * @typedef {{ align?: import("../model.js").Align, left?: number, right?: number, first?: number, before?: number, after?: number, line?: number, exact?: boolean, level?: number, style?: string, intbl?: boolean, pagebb?: boolean, rtl?: boolean }} RtfPara
 */

export class Flow {
  constructor() {
    /** @type {Block[]} */
    this.blocks = [];
    /** @type {Inline[]} */
    this.inlines = [];
    /** The list marker \listtext gave the paragraph being written. */
    this.marker = "";
    /** @type {import("../model.js").Table | null} */
    this.table = null;
    /** @type {import("../model.js").Cell[]} */
    this.cells = [];
    /** @type {Block[]} */
    this.cell = [];
    /** Open vertical merges: the cell each column's merge started in. */
    /** @type {Map<number, import("../model.js").Cell>} */
    this.merges = new Map();
  }

  /** @param {Inline} inline */
  add(inline) {
    const last = this.inlines.at(-1);
    if (inline.type === "text" && last?.type === "text" && same(last, inline))
      last.text += inline.text;
    else this.inlines.push(inline);
  }

  /** The paragraph the inlines make, with the properties in force at its \par. */
  /** @param {RtfPara} props */
  paragraph(props) {
    /** @type {Partial<import("../model.js").Paragraph>} */
    const shape = {};
    if (props.style && !/^normal$/i.test(props.style)) shape.style = props.style;
    if (props.level) shape.level = props.level;
    if (props.align) shape.align = props.align;
    if (props.left || props.right || props.first)
      shape.indent = {
        left: twips(props.left ?? 0),
        right: twips(props.right ?? 0),
        first: twips(props.first ?? 0),
      };
    if (props.before || props.after || props.line) {
      shape.spacing = {};
      if (props.before) shape.spacing.before = twips(props.before);
      if (props.after) shape.spacing.after = twips(props.after);
      if (props.line)
        Object.assign(
          shape.spacing,
          props.exact ? { line: twips(props.line), exact: true } : { line: props.line / 240 },
        );
    }
    if (props.rtl) shape.rtl = true;
    const marker = this.marker.trim();
    if (marker) shape.marker = marker;
    this.marker = "";
    const out = paragraph(trimTab(this.inlines), shape);
    this.inlines = [];
    return out;
  }

  /** \par: the paragraph ends; inside a table it joins the current cell. */
  /** @param {RtfPara} props */
  par(props) {
    if (props.pagebb) this.pageBreak();
    const p = this.paragraph(props);
    if (props.intbl) this.cell.push(p);
    else {
      this.closeTable();
      this.blocks.push(p);
    }
  }

  /** \cell: the cell's last paragraph ends with it. */
  /** @param {RtfPara} props */
  endCell(props) {
    if (this.inlines.length > 0 || this.cell.length === 0) this.cell.push(this.paragraph(props));
    this.cells.push({ blocks: this.cell, colSpan: 1, rowSpan: 1 });
    this.cell = [];
  }

  /** \row: the cells meet the row definition's merges and widths. */
  /** @param {CellDef[]} defs */
  endRow(defs) {
    if (this.inlines.length > 0) this.endCell({});
    this.table ??= { type: "table", rows: [], borders: true };
    /** @type {import("../model.js").Cell[]} */
    const row = [];
    let left = 0;
    this.cells.forEach((cell, i) => {
      const def = defs[i];
      const width = def ? twips(def.right - left) : undefined;
      if (def) left = def.right;
      if (def?.hmerge === "next" && row.length > 0) {
        const prev = /** @type {import("../model.js").Cell} */ (row.at(-1));
        prev.colSpan++;
        prev.blocks.push(...cell.blocks.filter((b) => b.type !== "paragraph" || b.inlines.length));
        return;
      }
      if (def?.vmerge === "next") {
        const origin = this.merges.get(i);
        if (origin) {
          origin.rowSpan++;
          return;
        }
      }
      if (width && width > 0) cell.width = width;
      if (def?.fill) cell.fill = def.fill;
      if (def?.vmerge === "first") this.merges.set(i, cell);
      else this.merges.delete(i);
      row.push(cell);
    });
    this.table.rows.push({ cells: row });
    this.cells = [];
  }

  closeTable() {
    if (this.cells.length > 0) this.endRow([]);
    if (this.table) this.blocks.push(this.table);
    this.table = null;
    this.merges.clear();
  }

  pageBreak() {
    if (this.inlines.length > 0) this.blocks.push(this.paragraph({}));
    this.closeTable();
    this.blocks.push({ type: "pagebreak" });
  }

  /** Everything written, the last paragraph and table closed. */
  /** @param {RtfPara} props */
  finish(props) {
    if (this.inlines.length > 0) this.par({ ...props, intbl: props.intbl && this.table !== null });
    this.closeTable();
    return this.blocks;
  }
}

/** Two runs that format alike join into one. */
const same = (
  /** @type {import("../model.js").TextRun} */ a,
  /** @type {import("../model.js").TextRun} */ b,
) => {
  const { text: _a, ...ra } = a;
  const { text: _b, ...rb } = b;
  return JSON.stringify(ra) === JSON.stringify(rb);
};

/** A paragraph that ends in tabs (a list marker's \tab, a cell's padding) loses them. */
const trimTab = (/** @type {Inline[]} */ items) => {
  while (items.at(-1)?.type === "tab") items.pop();
  return items;
};
