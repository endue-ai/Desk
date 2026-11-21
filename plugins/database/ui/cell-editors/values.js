// A typed cell's value (PG-40), without the DOM: what each kind's editor takes (checkValue: the
// value as the server writes it where the editor can tell, or the reason it is refused) and the SQL
// literal of a pending value: NULL, DEFAULT, TRUE and FALSE, a number bare, and on PostgreSQL a
// quoted text cast to the column's type where an explicit cast behaves as its assignment would
// (resolve.js); on MySQL and SQLite, and for a column without an editor, edit/values.js's literal.

import { isDefault, literal, NUMBER } from "../edit/values.js";
import { quoteText } from "../sql/quote.js";
import { array } from "./array.js";
import { boolean, boolOf } from "./boolean.js";
import { bytes } from "./bytes.js";
import { datetime } from "./datetime.js";
import { enumKind } from "./enum.js";
import { interval } from "./interval.js";
import { json } from "./json.js";
import { number } from "./number.js";
import { text } from "./text.js";
import { uuid } from "./uuid.js";

/**
 * @typedef {import("./resolve.js").Editor} Editor
 * @typedef {import("./resolve.js").Kind} Kind
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {{ check(text: string, editor: Editor): { value: string } | { error: string }, view?: (ctx: import("./panel.js").Ctx) => import("./panel.js").View }} KindModule
 */

/** Each kind's module: its check, and its view (text has the grid's own field). */
export const KINDS = /** @type {Record<Kind, KindModule>} */ ({
  text,
  number,
  boolean,
  enum: enumKind,
  date: datetime,
  time: datetime,
  timestamp: datetime,
  interval,
  json,
  array,
  bytes,
  uuid,
});

/**
 * What an editor makes of typed text: the value to keep, or why the column's type refuses it.
 * @param {Editor} editor
 * @param {string} typed
 * @returns {{ value: string } | { error: string }}
 */
export function checkValue(editor, typed) {
  return (KINDS[editor.kind] ?? text).check(typed, editor);
}

/**
 * A pending value's literal.
 * @param {Dialect} dialect
 * @param {string | null} value
 * @param {Editor} [editor]
 * @param {string} [type] The column's type, for a column without an editor.
 */
export function literalFor(dialect, value, editor, type = "") {
  if (value === null) return "NULL";
  if (isDefault(value)) return "DEFAULT";
  if (!editor || dialect !== "postgresql") return literal(dialect, value, editor?.type ?? type);
  const flag = editor.kind === "boolean" ? boolOf(value) : undefined;
  if (flag) return flag === "t" ? "TRUE" : "FALSE";
  if (editor.kind === "number") return NUMBER.test(value) ? value : quoteText(dialect, value);
  const quoted = quoteText(dialect, value);
  return editor.cast ? `${quoted}::${editor.cast}` : quoted;
}
