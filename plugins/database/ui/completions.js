// Completions at the editor's caret for the console on screen, after reading (quietly, from the
// catalog's cache when it can) the schemas, the default schema's objects and the columns of the
// tables the statement names, at most four of them. A server the plugin holds no db:connect grant
// for is not read: typing never raises the question (ADR 0335), and what was read before still
// completes. No DOM.

import { complete } from "./editor/complete.js";
import { engineOf } from "./engines/index.js";

const COMPLETE_READS = 4;

/**
 * @param {{
 *   consoles: { current(): import("./consoles.js").Console | null },
 *   manager: { get(id: string): import("./engines/common.js").Connection | undefined },
 *   catalog: ReturnType<typeof import("./catalog.js").createCatalog>,
 *   held?(conn: import("./engines/common.js").Connection): Promise<boolean>,
 * }} deps `held`: whether the connection may be read without asking (session/connect-gate.js).
 */
export function createCompletions({ consoles, manager, catalog, held = async () => true }) {
  /** @param {string} text @param {number} caret */
  return async (text, caret) => {
    const shown = consoles.current();
    const conn = shown ? manager.get(shown.connection) : undefined;
    if (!conn) return undefined;
    const { dialect } = engineOf(conn.engine);
    if (!(await held(conn))) return complete(text, caret, dialect, catalog.snapshot(conn));
    const view_ = catalog.snapshot(conn);
    const quiet = (/** @type {Promise<unknown>} */ p) => p.catch(() => undefined);
    await Promise.all([
      quiet(catalog.schemas(conn, true)),
      ...(view_.defaultSchema ? [quiet(catalog.objects(conn, view_.defaultSchema, true))] : []),
    ]);
    let found = complete(text, caret, dialect, catalog.snapshot(conn));
    if (found.wants.length) {
      const reads = found.wants
        .slice(0, COMPLETE_READS)
        .map((w) => quiet(catalog.columns(conn, w.schema, w.table, true)));
      await Promise.all(reads);
      found = complete(text, caret, dialect, catalog.snapshot(conn));
    }
    return found;
  };
}
