// Who keeps a PostgreSQL session (PG-02, ADR 0320): a console, by its own id, so the session follows
// it when the frame wakes, and a table view, by its buffer; a DDL view or a feature's panel keeps
// none. And what the status line and a question call each. Pure.

import { labelOf } from "../console-list.js";

/**
 * @typedef {import("../consoles.js").Console} Console
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("./keeper.js").Owner} Owner
 */

/** The key a console's or a table view's session is kept under, whatever its connection now. */
export function keyOf(/** @type {Console} */ target) {
  if (target.kind === "console") return `console:${target.consoleId ?? target.id}`;
  if (target.kind === "table") return `table:${target.id}`;
  return undefined;
}

/** The owner a buffer's runs go to, on a PostgreSQL connection; undefined for any other. */
export function ownerOf(/** @type {Console} */ target, /** @type {Connection | undefined} */ conn) {
  const owner = keyOf(target);
  if (conn?.engine !== "postgresql" || !owner) return undefined;
  return /** @type {Owner} */ ({ owner, kind: target.kind });
}

/** What the person calls a buffer that keeps a session: a console's label, a table's name. */
export function sessionLabel(
  /** @type {Console} */ target,
  /** @type {Connection | undefined} */ conn,
) {
  if (target.kind === "table" && target.table) {
    const { schema, name } = target.table;
    return `${conn?.name ?? "no connection"} · ${schema ? `${schema}.` : ""}${name}`;
  }
  return labelOf(target, conn);
}
