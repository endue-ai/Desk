import { t } from "./strings/index.js";
// Moving a console or a table view to another database of its server (PG-13, ADR 0321): its kept
// session closes through PG-02's own path (asked first in a transaction), a console keeps its
// text, and a table view reads the table on the new database.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./consoles.js").Deps} Deps
 * @typedef {{
 *   deps: Deps,
 *   discard(target: Console): Promise<void>,
 *   closing(target: Console): string[],
 *   release(target: Console): void,
 *   bind(target: Console, conn: Connection): Promise<unknown>,
 *   refresh(target: Console, conn: Connection): Promise<unknown>,
 *   tableName(conn: Connection, table: NonNullable<Console["table"]>): string,
 *   render(): void,
 * }} Parts
 */

/** `rebind(target, conn)`: what `consoles.rebind` does, from the parts of the consoles it needs. */
export function createRebind(/** @type {Parts} */ parts) {
  const { deps, discard, closing, release, bind, refresh, tableName, render } = parts;
  return async (/** @type {Console} */ target, /** @type {Connection} */ conn) => {
    if (target.running || target.filing) throw new Error(t("consoleRebind.aRunIsGoingOnIn"));
    await discard(target);
    const open = closing(target);
    if (
      open.length &&
      !(await deps.confirm(t("consoleRebind.moveItTo", { name: String(conn.name) }), open))
    )
      throw deps.cancelled(t("consoleRebind.notMovedItStaysOnIts"));
    release(target); // its session closes (PG-02): the next run opens one on the new database
    target.edit = null;
    if (target.kind === "console") await bind(target, conn);
    else target.connection = conn.id;
    if (target.kind === "table" && target.table) target.name = tableName(conn, target.table);
    if (!target.visited)
      await deps.commands
        .run("desk.buffers.update", { id: target.id, name: target.name })
        .catch(() => {});
    if (target.kind === "table") await refresh(target, conn);
    render();
    return target;
  };
}
