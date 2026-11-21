// The style Format SQL lays PostgreSQL out by (ADR 0291): the case of keywords, the indent, the line
// width, where commas and AND / OR go, how joins sit, what stays on one line when it fits, and
// whether a list is indented under its clause or aligned after it. The settings `endue.database.
// format-*` hold it (settings.js); a value that is not one of the choices, or out of range, keeps
// the default. Pure: the page and the parse worker both read it.

/**
 * @typedef {{
 *   keywordCase: "upper" | "lower" | "preserve",
 *   indent: number,
 *   lineWidth: number,
 *   comma: "last" | "first",
 *   andOr: "before" | "after",
 *   joins: "flat" | "indented",
 *   oneLine: "statement" | "clause" | "item",
 *   lists: "indent" | "align",
 * }} Style
 *   `oneLine`: what stays on one line when it fits: a whole statement, each clause, or only each
 *   item (every list and condition then breaks one item a line).
 */

/** @type {Readonly<Style>} */
export const STYLE = Object.freeze({
  keywordCase: "upper",
  indent: 4,
  lineWidth: 80,
  comma: "last",
  andOr: "before",
  joins: "flat",
  oneLine: "clause",
  lists: "indent",
});

/** The values each string field may take, the default first. */
export const CHOICES = Object.freeze({
  keywordCase: ["upper", "lower", "preserve"],
  comma: ["last", "first"],
  andOr: ["before", "after"],
  joins: ["flat", "indented"],
  oneLine: ["clause", "statement", "item"],
  lists: ["indent", "align"],
});

/** The range of each number field. */
export const RANGES = Object.freeze({ indent: [1, 8], lineWidth: [40, 240] });

/**
 * A style from anything: each field that is one of its choices or in its range, the default else.
 * @param {unknown} value
 * @returns {Style}
 */
export function styleOf(value) {
  const given = /** @type {Record<string, unknown>} */ (
    value && typeof value === "object" ? value : {}
  );
  /** @type {Record<string, unknown>} */
  const style = { ...STYLE };
  for (const [name, choices] of Object.entries(CHOICES))
    if (choices.includes(/** @type {string} */ (given[name]))) style[name] = given[name];
  for (const [name, [min, max]] of Object.entries(RANGES)) {
    const n = given[name];
    if (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max) style[name] = n;
  }
  return /** @type {Style} */ (style);
}
