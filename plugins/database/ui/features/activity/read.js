// Reading a connection's activity: the server's version once (kept per connection, read again when
// a read finds another), then the head, the sessions and the locks in one run of the plugin's own
// (`catalog`: nothing to ask), through deps.execute as every read goes. A server older than 13, a
// run that failed and a statement that failed are errors whose words are the sentence to show,
// the server's detail after its message. No DOM.

import { readOf } from "./model.js";
import { HEAD, LOCK_ROWS, locksSql, sessionsSql, tooOld } from "./sql.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../engines/common.js").DbError} DbError
 * @typedef {import("./model.js").Read} Read
 */

/** A failure in words: its message, then its DETAIL and HINT lines without their labels. */
export function wordsOf(/** @type {Pick<DbError, "message" | "detail">} */ error) {
  const more = (error.detail ?? "")
    .split("\n")
    .filter((line) => /^(?:DETAIL|HINT):/u.test(line))
    .map((line) => line.replace(/^[A-Z]+:\s*/u, "").trim())
    .join(" ");
  return more ? `${error.message}. ${more}` : error.message;
}

/**
 * @param {{
 *   execute: import("../../catalog.js").Execute, now?(): number,
 *   mine?(conn: Connection): Promise<number[]>,
 * }} deps
 *   `mine` answers the process ids of the plugin's sessions on this desk to the connection's
 *   server; it is asked before and after the read, so a session that ends or begins meanwhile is
 *   still known.
 */
export function createReader(deps) {
  /** @type {Map<string, { version: number, server: string }>} */
  const versions = new Map();

  /** Each statement's first result set; a failure throws its words. */
  const sets = async (
    /** @type {Connection} */ conn,
    /** @type {string[]} */ sqls,
    /** @type {boolean} */ background,
  ) => {
    const { result } = await deps.execute(conn, sqls.join(";\n"), {
      catalog: true,
      maxRows: LOCK_ROWS,
      ...(background ? { background: true } : {}),
    });
    if (result.error) throw new Error(wordsOf(result.error));
    const failed = result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(wordsOf(failed));
    return result.statements.map((s) => s.sets[0] ?? { columns: [], rows: [], truncated: false });
  };

  const versionOf = async (/** @type {Connection} */ conn, /** @type {boolean} */ background) => {
    const known = versions.get(conn.id);
    if (known) return known;
    const [head] = await sets(conn, [HEAD], background);
    const row = head?.rows[0] ?? [];
    const found = { version: Number(row[0] ?? 0), server: String(row[1] ?? "") };
    versions.set(conn.id, found);
    return found;
  };

  return {
    /** A read; `background` is the panel's period's, refused once the person disconnected
     * (ADR 0339). @returns {Promise<Read>} */
    async read(/** @type {Connection} */ conn, background = false) {
      const { version, server } = await versionOf(conn, background);
      const old = tooOld(conn.name, version, server);
      if (old) {
        versions.delete(conn.id);
        throw new Error(old);
      }
      const early = deps.mine?.(conn) ?? Promise.resolve([]);
      const all = [HEAD, sessionsSql(), locksSql(version)];
      const [head, sessions, locks] = await sets(conn, all, background);
      const late = (await deps.mine?.(conn)) ?? [];
      const read = readOf(
        head?.rows[0] ?? [],
        sessions?.rows ?? [],
        locks?.rows ?? [],
        locks?.truncated ?? false,
        deps.now?.() ?? Date.now(),
        new Set([...(await early), ...late]),
      );
      if (read.version !== version) versions.delete(conn.id);
      return read;
    },
  };
}
