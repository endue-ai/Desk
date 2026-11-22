// The key two results are compared by (PG-26, ADR 0329): a result's primary key is the one the
// catalog names for the table it reads (a table's view, or a console's plain SELECT of one table,
// edit/source.js) when the result carries every one of its columns; a pinned result keeps the one
// it had. Two results are keyed by it when both carry the same one, else by row position. No DOM.

import { defaultSchema } from "../../catalog.js";
import { sourceOf } from "../../edit/source.js";
import { engineOf } from "../../engines/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("../../tabs.js").Tab} Tab
 * @typedef {"primary" | "picked" | "position" | "default"} Why
 *   How the key was chosen: the primary key, columns the person picked, row position the person
 *   picked, or row position because the results do not both carry a primary key.
 */

/** A result's primary key columns, or none. @returns {Promise<string[]>} */
export async function primaryKey(
  /** @type {Deps} */ deps,
  /** @type {Console} */ target,
  /** @type {Tab} */ tab,
) {
  if (tab.kind === "pinned") return tab.pin?.key ?? [];
  const conn = deps.manager.get(target.connection);
  const set = tab.set;
  if (!conn || !set) return [];
  const { dialect } = engineOf(conn.engine);
  const statement = target.execution?.statements[tab.statement];
  const source =
    target.kind === "table" && target.table
      ? { schema: target.table.schema, name: target.table.name }
      : statement
        ? sourceOf(statement, dialect)
        : undefined;
  if (!source) return [];
  const columns = await deps.catalog
    .columns(conn, source.schema || defaultSchema(conn), source.name, true)
    .catch(() => []);
  // PostgreSQL names columns exactly; MySQL and SQLite match them without case.
  const fold = (/** @type {string} */ s) => (dialect === "postgresql" ? s : s.toLowerCase());
  const names = columns
    .filter((c) => c.primary)
    .map(
      (c) =>
        set.columns.find((n) => n === c.name) ?? set.columns.find((n) => fold(n) === fold(c.name)),
    );
  return names.length > 0 && names.every(Boolean) ? /** @type {string[]} */ (names) : [];
}

/** Whether two keys are the same columns. */
export const sameKey = (/** @type {string[]} */ a, /** @type {string[]} */ b) =>
  a.length > 0 && a.length === b.length && a.every((name, i) => name === b[i]);

/**
 * The key as a command names it (`position`, `primary`, a column or columns joined by commas), or
 * as the person picks it, the primary key first when both results carry it.
 * @param {Deps} deps
 * @param {unknown} given
 * @param {string[]} primary The primary key both results carry, or none.
 * @param {string[]} common The columns both results have.
 * @returns {Promise<{ key: string[], why: Why }>}
 */
export async function chooseKey(deps, given, primary, common) {
  let picked = typeof given === "string" ? given : Array.isArray(given) ? given.join(",") : "";
  if (!picked) {
    const items = [
      ...(primary.length
        ? [{ id: "primary", label: `The primary key (${primary.join(", ")})` }]
        : []),
      { id: "position", label: "Row position", detail: "The first row with the first, and so on" },
      ...common.map((name) => ({
        id: `column:${name}`,
        label: name,
        detail: "A column both have",
      })),
    ];
    picked = (await deps.pick("Database: compare the two results by which key?", items)) ?? "";
    if (!picked) throw deps.cancelled("Not compared.");
    picked = picked.replace(/^column:/u, "");
  }
  if (picked === "position") return { key: [], why: "position" };
  if (picked === "primary") {
    if (!primary.length)
      throw new Error(
        "The two results do not both carry a primary key: pick a column or position.",
      );
    return { key: primary, why: "primary" };
  }
  const key = picked.split(",").map((name) => name.trim());
  return { key, why: sameKey(key, primary) ? "primary" : "picked" };
}
