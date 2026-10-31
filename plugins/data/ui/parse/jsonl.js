// JSON Lines and NDJSON: one JSON value per line, each its own root. A bad line is flagged on its
// own and the lines after it still parse; blank lines are skipped.

import { lineStarts } from "../lines.js";
import { parseJson } from "./json.js";

/**
 * @typedef {import("../tree.js").DataDoc} DataDoc
 * @typedef {import("../tree.js").DataNode} DataNode
 */

/**
 * @param {string} text
 * @returns {DataDoc}
 */
export function parseJsonLines(text) {
  const starts = lineStarts(text);
  /** @type {DataDoc} */
  const out = { roots: [], errors: [], warnings: [], secretRanges: [], rootLabel: "Line" };
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i] ?? 0;
    let to = i + 1 < starts.length ? (starts[i + 1] ?? 0) - 1 : text.length;
    if (text.charCodeAt(to - 1) === 0x0d) to--;
    if (text.slice(from, to).trim() === "") continue;
    const doc = parseJson(text, "json", { from, to, starts });
    const root = doc.roots[0];
    const error = doc.errors[0];
    out.warnings?.push(...(doc.warnings ?? []));
    out.secretRanges?.push(...(doc.secretRanges ?? []));
    if (error) {
      out.errors.push(error);
      /** @type {DataNode} */
      const bad = {
        kind: "string",
        value: text.slice(from, to),
        line: i + 1,
        col: 1,
        error: error.message,
      };
      bad.from = from;
      bad.to = to;
      out.roots.push(bad);
    } else if (root) out.roots.push(root);
  }
  return out;
}
