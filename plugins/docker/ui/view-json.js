// `docker container inspect` as a JSON tree: an object or array per folding row with how much it
// holds, a value per row coloured by its type. Deep levels start folded, so the tree opens readable.

import { caret, el, row, span } from "./dom.js";

/** @typedef {import("./tree.js").RowSpec} RowSpec */

/** Levels deeper than this start folded. */
const OPEN_LEVELS = 1;
/** Rows past this are cut, with a row that says so. */
const MAX_ROWS = 4000;

/** A value as it reads on its row. */
function scalar(/** @type {Document} */ doc, /** @type {unknown} */ value) {
  if (value === null) return span(doc, "json null", "null");
  if (typeof value === "string")
    return el(doc, "span", { class: "json string", title: value }, JSON.stringify(value));
  if (typeof value === "number") return span(doc, "json number", String(value));
  if (typeof value === "boolean") return span(doc, "json boolean", String(value));
  return span(doc, "json", String(value));
}

/**
 * The rows of `value`. `folded` holds the paths folded by hand; `opened` the deep ones unfolded.
 * @param {Document} doc
 * @param {unknown} value
 * @param {Set<string>} folded A shallow path in it is folded; a deep one is open when it holds `+path`.
 * @returns {RowSpec[]}
 */
export function renderJson(doc, value, folded) {
  /** @type {RowSpec[]} */
  const rows = [];
  const isFolded = (/** @type {string} */ path, /** @type {number} */ depth) =>
    depth > OPEN_LEVELS ? !folded.has(`+${path}`) : folded.has(path);
  const walk = (
    /** @type {string} */ key,
    /** @type {unknown} */ v,
    /** @type {string} */ path,
    /** @type {number} */ depth,
  ) => {
    if (rows.length >= MAX_ROWS) return;
    const label = key === "" ? undefined : span(doc, "json key", key);
    if (v !== null && typeof v === "object") {
      const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
      const shut = isFolded(path, depth);
      const size = Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`;
      // A deep node's fold key starts with +: it is open while the tree's set holds it (tree.js).
      const fold = depth > OPEN_LEVELS ? `+${path}` : path;
      rows.push(
        row(
          doc,
          "json-node",
          { kind: "section", section: path },
          depth + 1,
          [caret(doc, !shut), label, span(doc, "json size desk-muted", size)],
          fold,
          { key: `json:${path}` },
        ),
      );
      if (shut || entries.length === 0) return;
      for (const [k, x] of entries) walk(String(k), x, `${path}/${k}`, depth + 1);
      return;
    }
    rows.push(
      row(
        doc,
        "json-leaf",
        { kind: "field", section: "json", label: path },
        depth + 1,
        [label, scalar(doc, v)],
        undefined,
        { key: `json:${path}` },
      ),
    );
  };
  walk("", value, "$", 0);
  if (rows.length >= MAX_ROWS)
    rows.push(
      row(doc, "empty", undefined, 1, [
        span(
          doc,
          "desk-muted",
          "The rest is cut: copy the JSON from the terminal with docker inspect.",
        ),
      ]),
    );
  return rows;
}
