// The comment that turns warnings off for one line (ADR 0328): `-- endue-ignore` or
// `/* endue-ignore */`, with identifiers after it (spaces, commas, an optional colon) or none for
// every warning. A comment on a line with code covers that line; alone on its line, the next one.
// Only a real comment counts (never a string), wherever it stands: inside a statement, after its
// `;`, or at the end of the script. Errors are never turned off. Pure.
import { tokenize } from "../sql/lexer.js";

const MARK = "endue-ignore";
const BODY = /^(?:--|\/\*)\s*endue-ignore\b:?([\s\S]*?)(?:\*\/)?$/u;

/**
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {Map<number, Set<string> | null>} Ignored
 *   By line (from 0): the identifiers turned off there, or null for all.
 */

/** The comment tokens of the script that hold the mark, in script offsets. */
function marked(/** @type {string} */ sql, /** @type {Statement[]} */ pieces) {
  /** @type {import("../sql/lexer.js").Token[]} */
  const found = [];
  let gapStart = 0;
  for (const piece of [...pieces, { start: sql.length, end: sql.length, tokens: [] }]) {
    const gap = sql.slice(gapStart, piece.start);
    if (gap.includes(MARK))
      for (const t of tokenize(gap, "postgresql"))
        if (t.type === "comment")
          found.push({ ...t, start: t.start + gapStart, end: t.end + gapStart });
    if (sql.slice(piece.start, piece.end).includes(MARK))
      for (const t of piece.tokens) if (t.type === "comment") found.push(t);
    gapStart = piece.end;
  }
  return found.filter((t) => t.text.includes(MARK));
}

/**
 * The lines each ignore comment covers.
 * @param {string} sql
 * @param {Statement[]} pieces the script's statements (split.js)
 * @returns {{ ignored: Ignored, lineOf(offset: number): number }}
 */
export function ignoredLines(sql, pieces) {
  /** @type {Ignored} */
  const ignored = new Map();
  /** @type {number[] | undefined} */
  let starts;
  const lineOf = (/** @type {number} */ offset) => {
    if (!starts) {
      starts = [0];
      for (let i = sql.indexOf("\n"); i >= 0; i = sql.indexOf("\n", i + 1)) starts.push(i + 1);
    }
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (/** @type {number} */ (starts[mid]) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  if (!sql.includes(MARK)) return { ignored, lineOf };
  for (const comment of marked(sql, pieces)) {
    const match = BODY.exec(comment.text);
    if (!match) continue;
    const ids = (match[1] ?? "").split(/[\s,]+/u).filter(Boolean);
    const lineStart = sql.lastIndexOf("\n", comment.start - 1) + 1;
    const lineEnd = sql.indexOf("\n", comment.end);
    const code =
      sql.slice(lineStart, comment.start).trim() !== "" ||
      sql.slice(comment.end, lineEnd < 0 ? sql.length : lineEnd).trim() !== "";
    const line = code ? lineOf(comment.start) : lineOf(comment.end) + 1;
    const before = ignored.get(line);
    if (ids.length === 0 || before === null) ignored.set(line, null);
    else ignored.set(line, new Set([...(before ?? []), ...ids]));
  }
  return { ignored, lineOf };
}
