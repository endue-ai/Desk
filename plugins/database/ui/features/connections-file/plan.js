// What an import would do (PG-15), before anything is kept: each entry of the file against the
// connections here. The same id is a change (ticked, naming the fields that change) or already here
// (skipped); a name another connection here has is taken (unticked; ticked, it is added under a
// free name); the rest are added. The kept connections follow the ticks: a change keeps this
// computer's keychain choice, and every name stays unique. No DOM.

import { chosen, withChoice } from "../../keychain.js";
import { entryOf, FIELDS } from "./file.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./file.js").Entry} Entry
 * @typedef {"add" | "change" | "same" | "taken"} Kind
 * @typedef {{ conn: Connection, kind: Kind, was: string, changes: string[], notes: string[], ticked: boolean }} Row
 *   `was` is the name of the connection here it meets (by id, or by name when taken).
 */

const LABELS = /** @type {Record<string, string>} */ ({
  ssl: "SSL",
  sslCa: "CA file",
  sslCert: "certificate file",
  sslKey: "key file",
  tag: "environment",
  readOnly: "read-only",
  color: "colour",
});
const lower = (/** @type {string} */ name) => name.toLowerCase();

/**
 * @param {Connection[]} local
 * @param {Entry[]} entries
 * @returns {Row[]}
 */
export function planImport(local, entries) {
  return entries.map(({ conn, notes }) => {
    const here = local.find((c) => c.id === conn.id);
    if (here) {
      const before = entryOf(here);
      const after = entryOf(conn);
      const changes = FIELDS.filter((k) => k !== "id" && before[k] !== after[k]).map(
        (k) => LABELS[k] ?? k,
      );
      const kind = changes.length ? "change" : "same";
      return { conn, kind, was: here.name, changes, notes, ticked: changes.length > 0 };
    }
    const taken = local.find((c) => lower(c.name) === lower(conn.name));
    if (taken) return { conn, kind: "taken", was: taken.name, changes: [], notes, ticked: false };
    return { conn, kind: "add", was: "", changes: [], notes, ticked: true };
  });
}

/** `name`, or `name (2)`, `name (3)` … when it is taken; at most 80 characters. */
export function freeName(/** @type {string} */ name, /** @type {Set<string>} */ taken) {
  if (!taken.has(lower(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const next = `${name.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(lower(next))) return next;
  }
}

/**
 * The connections the ticked rows keep, in the file's order, each with its row's index.
 * @param {Connection[]} local
 * @param {Row[]} rows
 * @param {Iterable<number>} ticks
 * @returns {{ index: number, conn: Connection }[]}
 */
export function applyImport(local, rows, ticks) {
  const ticked = new Set(ticks);
  const use = rows.flatMap((row, index) =>
    ticked.has(index) && row.kind !== "same" ? [{ row, index }] : [],
  );
  const replaced = new Set(use.filter((u) => u.row.kind === "change").map((u) => u.row.conn.id));
  const taken = new Set(local.filter((c) => !replaced.has(c.id)).map((c) => lower(c.name)));
  return use.map(({ row, index }) => {
    const here = local.find((c) => c.id === row.conn.id);
    const conn = here ? withChoice(row.conn, chosen(here)) : withChoice(row.conn, false);
    const name = freeName(conn.name, taken);
    taken.add(lower(name));
    return { index, conn: name === conn.name ? conn : { ...conn, name } };
  });
}
