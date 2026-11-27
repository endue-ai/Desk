// What something dropped on the surface does (ADR 0119): a SQLite file opens as a connection, SQL
// text goes into a console, a .sql file opens as a console bound to it (ADR 0286), and a CSV, TSV,
// JSON, JSON lines or .xlsx file starts an import into a table (import.js, importer.js, PG-60). Pure: dropped.js carries the
// action out.

import { copyFormatOf as formatOf } from "./import-copy/wizard.js";
import { t } from "./strings/index.js";

/**
 * @typedef {{ kind: "file", path: string, text?: string } | { kind: "text", text: string, name?: string }} Dropped
 *   A file the desk hands over by path (its text when it read it), or text dragged in.
 * @typedef {{ kind: "visit", path: string } | { kind: "insert", text: string }
 *   | { kind: "sql", path: string, text?: string }
 *   | { kind: "import", path: string, format: import("./import-copy/wizard.js").CopyFormat }
 *   | { kind: "refuse", reason: string }} DropAction
 *   `sql` opens the file's console, with the text the desk read when it did; `import` reads the
 *   file into the wizard.
 */

const SQLITE = /\.(?:sqlite3?|db3)$/iu;

/** @returns {DropAction} */
export function dropAction(/** @type {Dropped} */ item) {
  if (item.kind === "text") {
    if (item.text.trim() === "")
      return { kind: "refuse", reason: t("drops.nothingToPutInTheConsole") };
    return { kind: "insert", text: item.text };
  }
  if (SQLITE.test(item.path)) return { kind: "visit", path: item.path };
  if (/\.sql$/iu.test(item.path))
    return item.text === undefined
      ? { kind: "sql", path: item.path }
      : { kind: "sql", path: item.path, text: item.text };
  const format = formatOf(item.path);
  if (format) return { kind: "import", path: item.path, format };
  return {
    kind: "refuse",
    reason: t("drops.dropASqlFileACsv", { path: String(item.path) }),
  };
}
