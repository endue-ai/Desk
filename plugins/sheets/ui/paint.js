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

const FONT = '-apple-system, "SUIT", "Inter", system-ui, sans-serif';
/** @type {CanvasRenderingContext2D | null | undefined} */
let context;
/** @type {Map<string, number>} */
const widths = new Map();

/** The width of a text in the grid's font, or undefined where nothing can measure (jsdom). */
function measure(/** @type {string} */ text, /** @type {string} */ font) {
  if (context === undefined) {
    const real = typeof document !== "undefined" && !/jsdom/u.test(navigator.userAgent);
    context = real ? document.createElement("canvas").getContext("2d") : null;
  }
  if (!context) return undefined;
  const key = `${font}|${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    if (widths.size > 20_000) widths.clear();
    context.font = font;
    width = context.measureText(text).width;
    widths.set(key, width);
  }
  return width;
}

/**
 * @typedef {{
 *   selected: boolean, active: boolean, fixed: boolean, size: number, room: number,
 * }} CellState size: the font size in pixels; room: empty cells to the right that text may run over
 */

/**
 * Paint one cell: its text, box, style, and whether it is selected or the active cell. A number
 * too wide for its column shows as #### and text runs over the empty cells to its right, as in
 * spreadsheet programs.
 * @param {HTMLElement} el
 * @param {Sheet} sheet
 * @param {number} r
 * @param {number} c
 * @param {[number, number, number, number]} box left, top, width, height
 * @param {CellState} state
 */
export function paintCell(el, sheet, r, c, box, state) {
  const label = /** @type {HTMLElement} */ (
    el.firstElementChild ?? el.appendChild(el.ownerDocument.createElement("span"))
  );
  const cell = sheet.cell(r, c);
  const style = sheet.style(r, c);
  const kind = cell?.t;
  const align =
    style?.align ?? (kind === "n" ? "right" : kind === "b" || kind === "e" ? "center" : "left");
  const font = `${style?.italic ? "italic " : ""}${style?.bold ? "bold " : ""}${state.size}px ${FONT}`;
  const room = box[2] - 8;
  let text = sheet.text(r, c);
  let spill = 0;
  const wide = text && !style?.wrap ? measure(text, font) : undefined;
  if (wide !== undefined && wide > room) {
    if (kind === "n") text = "#".repeat(Math.max(1, Math.floor(room / (measure("#", font) || 8))));
    else if (align === "left" && state.room > 0) spill = Math.min(wide, room + state.room);
  }
  if (label.textContent !== text) label.textContent = text;
  label.style.maxWidth = spill ? `${Math.ceil(spill)}px` : "";
  el.classList.toggle("spill", spill > 0);
  place(el, ...box);
  el.dataset.align = align;
  el.classList.toggle("fixed", state.fixed);
  el.style.backgroundColor = style?.fill ?? "";
  el.style.color = style?.color ?? (style?.fill ? contrast(style.fill) : "");
  el.style.fontWeight = style?.bold ? "bold" : "";
  el.style.fontStyle = style?.italic ? "italic" : "";
  const lines = [style?.underline && "underline", style?.strike && "line-through"];
  el.style.textDecoration = lines.filter(Boolean).join(" ");
  el.classList.toggle("wrap", Boolean(style?.wrap));
  el.setAttribute("aria-selected", String(state.selected));
  el.classList.toggle("active", state.active);
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
