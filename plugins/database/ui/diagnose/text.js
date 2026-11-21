// Small pieces the problems check shares (ADR 0294): the nearest name for a hint, as the server
// measures it, a problem's message read as one sentence, and where a token or an expression of a
// statement ends. Pure.

/** The edit distance of `a` and `b`, or `limit + 1` once it is past `limit`. */
export function distance(/** @type {string} */ a, /** @type {string} */ b, limit = 3) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        /** @type {number} */ (previous[j]) + 1,
        /** @type {number} */ (row[j - 1]) + 1,
        /** @type {number} */ (previous[j - 1]) + cost,
      );
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return /** @type {number} */ (previous[b.length]);
}

/**
 * The candidate nearest `name`, as the server suggests a column: at most three edits, and at most
 * half the candidate's length; the first of equals.
 * @template T
 * @param {string} name
 * @param {Iterable<T>} candidates
 * @param {(candidate: T) => string} nameOf
 * @returns {T | undefined}
 */
export function nearest(name, candidates, nameOf) {
  /** @type {T | undefined} */
  let found;
  let best = 4;
  for (const candidate of candidates) {
    const other = nameOf(candidate);
    if (other === name) continue;
    const d = distance(name, other);
    if (d < best && d <= Math.floor(other.length / 2)) {
      best = d;
      found = candidate;
    }
  }
  return found;
}

/** A message of several lines as one sentence, for the status line. */
export const sentence = (/** @type {string} */ message) =>
  message
    .split("\n")
    .map((line, i, all) => (i < all.length - 1 && !/[.!?]$/u.test(line) ? `${line}.` : line))
    .join(" ");

/**
 * The end of the token that `at` is in, or of the expression it starts (up to a comma or a closing
 * parenthesis at its own depth), in the statement's tokens.
 * @param {import("../sql/lexer.js").Token[]} tokens offsets in the script
 * @param {number} at an offset in the script
 * @param {boolean} [expression]
 */
export function endOf(tokens, at, expression = false) {
  let i = tokens.findIndex((t) => t.end > at);
  if (i < 0) return at;
  if (!expression)
    return Math.max(at, /** @type {import("../sql/lexer.js").Token} */ (tokens[i]).end);
  let depth = 0;
  let end = at;
  for (; i < tokens.length; i++) {
    const token = /** @type {import("../sql/lexer.js").Token} */ (tokens[i]);
    if (token.type === "op" && (token.text === "(" || token.text === "[")) depth++;
    else if (token.type === "op" && (token.text === ")" || token.text === "]")) {
      if (depth === 0) break;
      depth--;
    } else if (token.type === "op" && token.text === "," && depth === 0) break;
    if (token.type !== "space" && token.type !== "comment") end = token.end;
  }
  return end;
}
