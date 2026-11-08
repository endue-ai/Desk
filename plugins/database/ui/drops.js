// What something dropped on the surface does (ADR 0119): a SQLite file opens as a connection, SQL
// text goes into a console, a .sql file the plugin reads opens in one, and a CSV, TSV or JSON file
// starts an import into a table (import.js, importer.js). Pure: dropped.js carries the action out.

import { formatOf } from "./import.js";

/**
 * @typedef {{ kind: "file", path: string, text?: string } | { kind: "text", text: string, name?: string }} Dropped
 *   A file the desk hands over by path (its text when it read it), or text dragged in.
 * @typedef {{ kind: "visit", path: string } | { kind: "insert", text: string }
 *   | { kind: "console", path: string }
 *   | { kind: "import", path: string, format: import("./import.js").Format }
 *   | { kind: "refuse", reason: string }} DropAction
 *   `console` reads the file, then puts its text in a console; `import` reads it into the wizard.
 */

const SQLITE = /\.(?:sqlite3?|db3)$/iu;

/** @returns {DropAction} */
export function dropAction(/** @type {Dropped} */ item) {
  if (item.kind === "text") {
    if (item.text.trim() === "")
      return { kind: "refuse", reason: "Nothing to put in the console." };
    return { kind: "insert", text: item.text };
  }
  if (SQLITE.test(item.path)) return { kind: "visit", path: item.path };
  if (/\.sql$/iu.test(item.path))
    return item.text === undefined
      ? { kind: "console", path: item.path }
      : { kind: "insert", text: item.text };
  const format = formatOf(item.path);
  if (format) return { kind: "import", path: item.path, format };
  return {
    kind: "refuse",
    reason: `${item.path}: drop a .sql file, a .csv or .json file, SQL text, or a SQLite database.`,
  };
}
