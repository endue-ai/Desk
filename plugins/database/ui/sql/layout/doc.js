// The layout's documents and their printer (ADR 0292): text, a space between tokens, a line that is
// a space or a new line, a soft line that is nothing or a new line, a hard line, groups that print
// flat when they fit the line and broken otherwise, indents, alignment to the current column, and
// fills that break only where the next part does not fit. A group that holds a hard line (or text
// over several lines) always breaks. A new line on a line that holds nothing yet only moves the
// indent, so no blank line is ever printed; a space at the start of a line is left out and so is
// the space at the end of one. Pure, iterative: a statement of any length never runs the stack out.

/**
 * @typedef {string | Doc[] | { t: "sp" } | { t: "line" } | { t: "soft" } | { t: "hard" }
 *   | { t: "group", c: Doc, brk: boolean } | { t: "indent", n: number, c: Doc }
 *   | { t: "align", c: Doc } | { t: "fill", c: Doc[], i: number }
 *   | { t: "next", c: Doc[], i: number }} Doc
 *   A fill's `c` alternates content and separator from `i`; `next` is the printer's own step to
 *   the separator at `i` (never built by a caller).
 */

export const SP = /** @type {const} */ ({ t: "sp" });
export const LINE = /** @type {const} */ ({ t: "line" });
export const SOFT = /** @type {const} */ ({ t: "soft" });
export const HARD = /** @type {const} */ ({ t: "hard" });

/** @type {WeakMap<object, boolean>} */
const known = new WeakMap();

/** Whether a document holds a hard line or text over several lines. */
export function hasHard(/** @type {Doc} */ doc) {
  /** @type {Doc[]} */
  const stack = [doc];
  while (stack.length > 0) {
    const d = /** @type {Doc} */ (stack.pop());
    if (typeof d === "string") {
      if (d.includes("\n")) return true;
      continue;
    }
    if (known.get(d) === false) continue;
    if (known.get(d) === true) return true;
    if (Array.isArray(d)) stack.push(...d);
    else if (d.t === "hard") return true;
    else if (d.t === "group") {
      if (d.brk) return true;
    } else if (d.t === "indent" || d.t === "align") stack.push(d.c);
    else if (d.t === "fill") stack.push(...d.c.slice(d.i));
  }
  return false;
}

/** @param {Doc} c @param {boolean} [brk] always broken */
export const group = (c, brk = false) => {
  const made = /** @type {const} */ ({ t: "group", c, brk: brk || hasHard(c) });
  known.set(made, made.brk);
  return made;
};
export const indent = (/** @type {number} */ n, /** @type {Doc} */ c) =>
  /** @type {const} */ ({ t: "indent", n, c });
export const align = (/** @type {Doc} */ c) => /** @type {const} */ ({ t: "align", c });
/** @param {Doc[]} c content, separator, content, ... */
export const fill = (c) => /** @type {const} */ ({ t: "fill", c, i: 0 });

/** `items` with `separator` between each two. */
export function join(/** @type {Doc[]} */ items, /** @type {Doc} */ separator) {
  /** @type {Doc[]} */
  const out = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(separator);
    out.push(item);
  });
  return out;
}

const FLAT = 0;
const BREAK = 1;
/** @typedef {[number, number, Doc]} Command indent, mode, document */

/** Whether `next`, and what follows it up to the next line break, fits in `width` columns. */
function fits(
  /** @type {Command} */ next,
  /** @type {Command[]} */ rest,
  /** @type {number} */ width,
) {
  let left = width;
  let r = rest.length;
  /** @type {Command[]} */
  const stack = [next];
  while (left >= 0) {
    if (stack.length === 0) {
      if (r === 0) return true;
      stack.push(/** @type {Command} */ (rest[--r]));
      continue;
    }
    const [ind, mode, d] = /** @type {Command} */ (stack.pop());
    if (typeof d === "string") {
      const end = d.indexOf("\n");
      left -= end < 0 ? d.length : end;
      if (end >= 0) return left >= 0;
    } else if (Array.isArray(d)) {
      for (let i = d.length - 1; i >= 0; i--) stack.push([ind, mode, /** @type {Doc} */ (d[i])]);
    } else if (d.t === "sp") left -= 1;
    else if (d.t === "line") {
      if (mode === BREAK) return true;
      left -= 1;
    } else if (d.t === "soft") {
      if (mode === BREAK) return true;
    } else if (d.t === "hard") return true;
    else if (d.t === "group") stack.push([ind, d.brk ? BREAK : mode, d.c]);
    else if (d.t === "indent" || d.t === "align") stack.push([ind, mode, d.c]);
    else
      for (let i = d.c.length - 1; i >= d.i; i--)
        stack.push([ind, mode, /** @type {Doc} */ (d.c[i])]);
  }
  return false;
}

/**
 * The document as text in `width` columns.
 * @param {Doc} doc
 * @param {number} width
 */
export function print(doc, width) {
  /** @type {string[]} */
  const out = [];
  let col = 0;
  let pending = 0;
  let started = false;
  const newline = (/** @type {number} */ ind) => {
    if (started) out.push("\n");
    started = false;
    pending = ind;
    col = ind;
  };
  const text = (/** @type {string} */ s) => {
    if (s === "") return;
    if (!started) {
      out.push(" ".repeat(pending));
      started = true;
    }
    out.push(s);
    const end = s.lastIndexOf("\n");
    col = end < 0 ? col + s.length : s.length - end - 1;
  };
  /** @type {Command[]} */
  const cmds = [[0, BREAK, doc]];
  while (cmds.length > 0) {
    const [ind, mode, d] = /** @type {Command} */ (cmds.pop());
    if (typeof d === "string") text(d);
    else if (Array.isArray(d)) {
      for (let i = d.length - 1; i >= 0; i--) cmds.push([ind, mode, /** @type {Doc} */ (d[i])]);
    } else if (d.t === "sp") {
      if (started) text(" ");
    } else if (d.t === "line") {
      if (mode === BREAK) newline(ind);
      else if (started) text(" ");
    } else if (d.t === "soft") {
      if (mode === BREAK) newline(ind);
    } else if (d.t === "hard") newline(ind);
    else if (d.t === "indent") cmds.push([ind + d.n, mode, d.c]);
    else if (d.t === "align") cmds.push([started ? col : pending, mode, d.c]);
    else if (d.t === "group") {
      const flat = !d.brk && (mode === FLAT || fits([ind, FLAT, d.c], cmds, width - col));
      cmds.push([ind, flat ? FLAT : BREAK, d.c]);
    } else if (d.t === "next") {
      cmds.push([ind, mode, { t: "fill", c: d.c, i: d.i + 1 }]);
      cmds.push([ind, mode === FLAT || stays(d, ind, width, col) ? FLAT : BREAK, d.c[d.i]]);
    } else fillStep(d, ind, mode, cmds, width - col);
  }
  return out
    .join("")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/**
 * Whether a fill's separator stays flat: the content after it fits on this line, or it would not
 * fit on a line of its own either and its first line fits here (`EXISTS (`, `foo(`), so it breaks
 * inside rather than after the separator.
 */
function stays(
  /** @type {{ c: Doc[], i: number }} */ d,
  /** @type {number} */ ind,
  /** @type {number} */ width,
  /** @type {number} */ col,
) {
  const separator = /** @type {Doc} */ (d.c[d.i]);
  const after = /** @type {Doc} */ (d.c[d.i + 1]);
  if (fits([ind, FLAT, [separator, after]], [], width - col)) return true;
  const shift =
    typeof separator === "object" && !Array.isArray(separator) && separator.t === "indent"
      ? separator.n
      : 0;
  if (fits([ind, FLAT, after], [], width - ind - shift)) return false;
  return fits([ind, FLAT, separator], [[ind, BREAK, after]], width - col);
}

/** One content of a fill; the separator after it is chosen once the content is printed. */
function fillStep(
  /** @type {{ c: Doc[], i: number }} */ d,
  /** @type {number} */ ind,
  /** @type {number} */ mode,
  /** @type {Command[]} */ cmds,
  /** @type {number} */ width,
) {
  const content = d.c[d.i];
  if (content === undefined) return;
  const own = mode === FLAT || fits([ind, FLAT, content], [], width) ? FLAT : BREAK;
  if (d.c[d.i + 1] !== undefined && d.c[d.i + 2] !== undefined)
    cmds.push([ind, mode, { t: "next", c: d.c, i: d.i + 1 }]);
  cmds.push([ind, own, content]);
}
