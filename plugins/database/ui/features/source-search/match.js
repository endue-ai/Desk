// The source search's matcher (PG-82): a text or a regular expression found line by line in a
// definition, each matching line with its number, its text (a long one cut around its first match)
// and the ranges that matched; matches inside SQL comments (`--`, nested `/* */`, also inside a
// dollar-quoted body, never inside a string or a quoted name) are left out unless comments are
// searched, and so are those in the ranges a text says to skip (a DDL statement's own words around
// what is searched). The worker (worker.js) and small searches in place both run this. Pure.

/**
 * @typedef {{ text: string, regex: boolean, ignoreCase: boolean }} How
 * @typedef {How & { comments: boolean }} Query
 * @typedef {{ line: number, text: string, ranges: [number, number][] }} Line
 *   `ranges` are within `text`, the line as shown.
 * @typedef {{ count: number, lines: Line[] }} Found `count` matching lines, `lines` the first kept.
 * @typedef {[number, number]} Range
 */

/** At most this many lines are kept per object; the count goes on. */
export const LINE_CAP = 50;
/** A line is shown at most this long, cut around its first match. */
export const SHOWN = 240;
const BEFORE = 60;

/**
 * The test of a query, with the flags a search across lines needs.
 * @param {How} how
 * @returns {RegExp}
 */
export function testOf(how) {
  if (how.text === "") throw new Error("Type the text to find first.");
  const flags = `gu${how.ignoreCase ? "i" : ""}`;
  if (!how.regex) return new RegExp(how.text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), flags);
  try {
    return new RegExp(how.text, flags);
  } catch (error) {
    throw new Error(
      `Not a regular expression: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The SQL comments of a text, in order, each as [from, to).
 * @param {string} text
 * @returns {Range[]}
 */
export function commentRanges(text) {
  /** @type {Range[]} */
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      const to = end < 0 ? n : end;
      out.push([i, to]);
      i = to;
    } else if (c === "/" && next === "*") {
      const from = i;
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      out.push([from, i]);
    } else if (c === "'" || c === '"') {
      // A string or a quoted name; '' and "" stay inside it, E'..' keeps a backslash's character.
      const escapes = c === "'" && (text[i - 1] === "E" || text[i - 1] === "e");
      i++;
      while (i < n) {
        if (escapes && text[i] === "\\") i += 2;
        else if (text[i] === c && text[i + 1] === c) i += 2;
        else if (text[i] === c) break;
        else i++;
      }
      i++;
    } else i++;
  }
  return out;
}

/** Whether [from, to) starts inside one of the sorted ranges. */
const inside = (/** @type {Range[]} */ ranges, /** @type {number} */ at) => {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = /** @type {Range} */ (ranges[mid]);
    if (at < a) hi = mid - 1;
    else if (at >= b) lo = mid + 1;
    else return true;
  }
  return false;
};

/** A line as shown and its ranges: a long one from a little before its first match. */
function shownLine(/** @type {string} */ line, /** @type {Range[]} */ ranges) {
  if (line.length <= SHOWN) return { text: line, ranges };
  const first = ranges[0]?.[0] ?? 0;
  const from = first > BEFORE ? first - BEFORE : 0;
  const to = Math.min(line.length, from + SHOWN);
  const lead = from > 0 ? "…" : "";
  const text = `${lead}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
  const shift = lead.length - from;
  const kept = ranges
    .filter(([a]) => a >= from && a < to)
    .map(([a, b]) => /** @type {Range} */ ([a + shift, Math.min(b, to) + shift]));
  return { text, ranges: kept };
}

/**
 * The lines of a text where the test matches, or null when none does.
 * @param {string} text
 * @param {RegExp} test a global test (testOf)
 * @param {{ comments: boolean, skip?: Range[], cap?: number }} options `skip`: sorted ranges
 *   whose matches do not count.
 * @returns {Found | null}
 */
export function linesOf(text, test, options) {
  const cap = options.cap ?? LINE_CAP;
  const skip = [...(options.skip ?? []), ...(options.comments ? [] : commentRanges(text))].sort(
    (a, b) => a[0] - b[0],
  );
  /** @type {Line[]} */
  const lines = [];
  let count = 0;
  let start = 0;
  let number = 1;
  const re = new RegExp(test.source, test.flags.includes("g") ? test.flags : `${test.flags}g`);
  while (start <= text.length) {
    const end = text.indexOf("\n", start);
    const stop = end < 0 ? text.length : end;
    const line = text.slice(start, stop);
    /** @type {Range[]} */
    const ranges = [];
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0] === "") {
        re.lastIndex++;
        continue;
      }
      if (!inside(skip, start + m.index)) ranges.push([m.index, m.index + m[0].length]);
    }
    if (ranges.length) {
      count++;
      if (lines.length < cap) lines.push({ line: number, ...shownLine(line, ranges) });
    }
    if (end < 0) break;
    start = end + 1;
    number++;
  }
  return count ? { count, lines } : null;
}

/**
 * Many texts against one query, as the worker answers them.
 * @param {string[]} texts
 * @param {Query} query
 * @param {Range[][]} [skips] each text's ranges to skip
 * @returns {(Found | null)[]}
 */
export function matchTexts(texts, query, skips = []) {
  const test = testOf(query);
  return texts.map((text, i) =>
    linesOf(text, test, { comments: query.comments, skip: skips[i] ?? [] }),
  );
}
