// The grid's elements: one row element per row on screen with its header and cells, made on first
// use, kept while they stay on screen and removed when they leave; and how one cell is painted,
// with the file's styles over the desk's colours.

/**
 * @typedef {import("./model.js").Sheet} Sheet
 * @typedef {{ el: HTMLElement, head: HTMLElement, cells: Map<number, HTMLElement>, used: boolean }} Line
 */

export const place = (/** @type {HTMLElement} */ el, x = 0, y = 0, w = 0, h = 0) => {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
};

/** Dark text on a light fill, light text on a dark one, when the file names no text colour. */
export const contrast = (/** @type {string} */ fill) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(fill.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1b1b1f" : "#f4f2f7";
};

/**
 * Paint one cell: its text, box, style, and whether it is selected or the active cell.
 * @param {HTMLElement} el
 * @param {Sheet} sheet
 * @param {number} r
 * @param {number} c
 * @param {[number, number, number, number]} box left, top, width, height
 * @param {boolean} selected
 * @param {boolean} active
 */
export function paintCell(el, sheet, r, c, box, selected, active) {
  const text = sheet.text(r, c);
  if (el.textContent !== text) el.textContent = text;
  place(el, ...box);
  const cell = sheet.cell(r, c);
  const style = sheet.style(r, c);
  // As spreadsheets align by default: numbers right, truth values and errors centred, text left.
  const kind = cell?.t;
  el.dataset.align =
    style?.align ?? (kind === "n" ? "right" : kind === "b" || kind === "e" ? "center" : "left");
  el.style.backgroundColor = style?.fill ?? "";
  el.style.color = style?.color ?? (style?.fill ? contrast(style.fill) : "");
  el.style.fontWeight = style?.bold ? "bold" : "";
  el.style.fontStyle = style?.italic ? "italic" : "";
  const lines = [style?.underline && "underline", style?.strike && "line-through"];
  el.style.textDecoration = lines.filter(Boolean).join(" ");
  el.classList.toggle("wrap", Boolean(style?.wrap));
  el.setAttribute("aria-selected", String(selected));
  el.classList.toggle("active", active);
}

/**
 * The elements of the grid's layer, reused by row and column.
 * @param {Document} doc
 * @param {HTMLElement} layer
 */
export function createPool(doc, layer) {
  const make = (/** @type {string} */ role, /** @type {string} */ className, parent = layer) => {
    const el = doc.createElement("div");
    el.setAttribute("role", role);
    el.className = className;
    parent.append(el);
    return el;
  };
  const headRow = make("row", "head-row");
  headRow.setAttribute("aria-rowindex", "1");
  const corner = make("columnheader", "corner", headRow);
  corner.setAttribute("aria-colindex", "1");
  corner.setAttribute("aria-label", "Rows and columns");
  /** @type {Map<number, HTMLElement>} */
  const heads = new Map();
  /** @type {Set<HTMLElement>} */
  const headsSeen = new Set();
  /** @type {Map<number, Line>} */
  const lines = new Map();

  return {
    corner,
    /** Start a frame: nothing is in use until asked for again. */
    begin() {
      headsSeen.clear();
      for (const line of lines.values()) line.used = false;
    },
    /** The header of column c, named by its letters. */
    colHead(/** @type {number} */ c, /** @type {string} */ name) {
      let el = heads.get(c);
      if (!el) {
        el = make("columnheader", "col-head", headRow);
        el.setAttribute("aria-colindex", String(c + 2));
        el.textContent = name;
        heads.set(c, el);
      }
      headsSeen.add(el);
      return el;
    },
    /** The row element of row r, with its header. */
    line(/** @type {number} */ r) {
      let line = lines.get(r);
      if (!line) {
        const el = make("row", "row");
        el.setAttribute("aria-rowindex", String(r + 2));
        const head = make("rowheader", "row-head", el);
        head.setAttribute("aria-colindex", "1");
        head.textContent = String(r + 1);
        line = { el, head, cells: new Map(), used: false };
        lines.set(r, line);
      }
      if (!line.used) {
        line.used = true;
        for (const cell of line.cells.values()) cell.dataset.used = "";
      }
      return line;
    },
    /** The element of cell (r, c) in its row. */
    cell(/** @type {Line} */ line, /** @type {number} */ r, /** @type {number} */ c) {
      let el = line.cells.get(c);
      if (!el) {
        el = make("gridcell", "cell", line.el);
        el.id = `cell-${r}-${c}`;
        el.setAttribute("aria-colindex", String(c + 2));
        line.cells.set(c, el);
      }
      el.dataset.used = "1";
      return el;
    },
    /** Whether cell (r, c) was painted in this frame. */
    painted: (/** @type {number} */ r, /** @type {number} */ c) =>
      lines.get(r)?.cells.get(c)?.dataset.used === "1",
    /** End a frame: remove what was not asked for. */
    sweep() {
      for (const [c, el] of heads) {
        if (headsSeen.has(el)) continue;
        el.remove();
        heads.delete(c);
      }
      for (const [r, line] of lines) {
        if (!line.used) {
          line.el.remove();
          lines.delete(r);
          continue;
        }
        for (const [c, el] of line.cells) {
          if (el.dataset.used === "1") continue;
          el.remove();
          line.cells.delete(c);
        }
      }
    },
    clear() {
      this.begin();
      this.sweep();
    },
  };
}
