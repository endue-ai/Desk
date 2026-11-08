// The raw pane: the file's text with line numbers and token colours, or a hex dump with offsets for
// binary formats, as a virtual list. Secret values draw as dots (their text never enters the DOM),
// a parse error's line is marked, and the selected node's line is current and scrolled to. A line
// longer than 2000 characters shows the part around the selected column.

import { hexRow, rawLines, tokenize } from "./raw.js";
import { createVirtual } from "./virtual.js";

/**
 * @typedef {import("./formats.js").Opened} Opened
 * @typedef {Array<[number, number]>} Ranges
 */

const LINE_HEIGHT = 18;
const MAX_LINE = 2000;
const BEFORE = 200;
const MASK = "••••••••";

/** Sorted, overlapping ranges joined into sorted ranges apart. */
export function union(/** @type {Ranges} */ ranges) {
  /** @type {Ranges} */
  const out = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** The first range that ends after `at`. */
const firstAfter = (/** @type {Ranges} */ ranges, /** @type {number} */ at) => {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((ranges[mid]?.[1] ?? 0) <= at) low = mid + 1;
    else high = mid;
  }
  return low;
};

/**
 * @param {Document} doc
 * @param {HTMLElement} el The raw element, which scrolls.
 */
export function createRawView(doc, el) {
  /** @type {Opened | null} */
  let opened = null;
  /** @type {import("./raw.js").RawLines | null} */
  let lines = null;
  /** @type {Ranges} */
  let masks = [];
  /** @type {Map<number, string>} */
  let errors = new Map();
  let current = { line: 0, col: 0 };

  /** The text of line `n` with its masked parts as dots, cut to MAX_LINE around the column. */
  const textLine = (/** @type {number} */ n) => {
    const text = opened?.text ?? "";
    const start = lines?.start(n) ?? 0;
    const end = lines?.end(n) ?? 0;
    let from = start;
    let to = end;
    if (end - start > MAX_LINE) {
      const focus = current.line === n ? start + current.col - 1 : start;
      from = Math.max(start, focus - BEFORE);
      to = Math.min(end, from + MAX_LINE);
    }
    let out = from > start ? "… " : "";
    let at = from;
    for (let i = firstAfter(masks, from); i < masks.length; i++) {
      const [maskFrom, maskTo] = /** @type {[number, number]} */ (masks[i]);
      if (maskFrom >= to) break;
      if (maskFrom > at) out += text.slice(at, maskFrom);
      out += MASK;
      at = Math.min(Math.max(at, maskTo), to);
    }
    if (at < to) out += text.slice(at, to);
    if (to < end) out += ` … ${(end - to).toLocaleString("en-US")} more characters`;
    return out;
  };

  const hexLine = (/** @type {number} */ n) => {
    const bytes = opened?.bytes ?? new Uint8Array();
    const start = lines?.start(n) ?? 0;
    const end = lines?.end(n) ?? 0;
    const masked = (/** @type {number} */ at) => {
      const range = masks[firstAfter(masks, at)];
      return range !== undefined && range[0] <= at;
    };
    return hexRow(bytes, start, end, masked);
  };

  const drawLine = (/** @type {number} */ n) => {
    const line = doc.createElement("div");
    line.className = "line";
    line.dataset.line = String(n);
    const number = doc.createElement("span");
    number.className = "ln";
    number.setAttribute("aria-hidden", "true");
    number.textContent = String(n);
    const code = doc.createElement("span");
    code.className = "code";
    const text = lines?.kind === "hex" ? hexLine(n) : textLine(n);
    const format = lines?.kind === "hex" ? "msgpack" : (opened?.format ?? "text");
    for (const [name, part] of tokenize(format, text)) {
      if (!name) {
        code.append(part);
        continue;
      }
      const token = doc.createElement("span");
      token.className = name;
      token.textContent = part;
      code.append(token);
    }
    line.append(number, code);
    const error = errors.get(n);
    if (error !== undefined) {
      line.classList.add("error");
      const said = doc.createElement("span");
      said.className = "visually-hidden";
      said.textContent = ` Parse error: ${error}`;
      line.append(said);
    }
    if (n === current.line) {
      line.classList.add("current");
      line.setAttribute("aria-current", "true");
    }
    return line;
  };

  const virtual = createVirtual(el, LINE_HEIGHT, (first, last) => {
    const items = [];
    for (let i = first; i < last; i++) items.push(drawLine(i + 1));
    virtual.window.replaceChildren(...items);
  });

  return {
    /**
     * @param {Opened | null} next
     * @param {Ranges} hidden The ranges that draw as dots.
     * @param {Array<{ line: number, message: string }>} marked Lines with a parse error.
     */
    load(next, hidden, marked) {
      opened = next;
      lines = next && (next.text !== undefined || next.bytes) ? rawLines(next) : null;
      masks = union(hidden);
      errors = new Map(marked.map((e) => [e.line, e.message]));
      current = { line: 0, col: 0 };
      el.scrollTop = 0;
      virtual.setCount(lines?.count ?? 0);
      virtual.render();
    },
    /** @param {Ranges} hidden */
    mask(hidden) {
      masks = union(hidden);
      virtual.render();
    },
    /** Make a line current and scroll to it. */
    goTo(/** @type {number} */ line, col = 1) {
      if (!lines) return;
      current = { line: Math.max(1, Math.min(lines.count, line)), col };
      virtual.reveal(current.line - 1);
      virtual.render();
    },
    focus() {
      el.focus();
    },
  };
}
