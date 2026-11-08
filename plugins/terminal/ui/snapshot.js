// A session as it starts, what a reload keeps of the terminals, and a session made again from what
// was kept (TERM-S07). No DOM.
import { tailOf } from "./output.js";

/**
 * @typedef {import("./types.js").Session} Session
 * @typedef {import("./types.js").Snapshot} Snapshot
 * @typedef {import("./types.js").Saved} Saved
 * @typedef {import("./spawn.js").Program} Program
 */

/** The size a terminal has until its view measures one. */
export const FALLBACK_SIZE = Object.freeze({ cols: 80, rows: 24 });

/** A new session that has not started its program yet. */
export function blankSession(
  /** @type {string} */ id,
  /** @type {string} */ title,
  /** @type {Program[]} */ programs,
) {
  /** @type {Session} */
  const session = {
    id,
    title,
    programs,
    program: null,
    procId: null,
    buffer: null,
    ...FALLBACK_SIZE,
    exit: null,
    ended: null,
    ...tailOf(),
    relaunch: false,
    cwd: null,
    named: false,
  };
  return session;
}

/** What the runtime keeps for the surface across a reload. */
export function snapshotOf(
  /** @type {number} */ next,
  /** @type {string | null} */ shown,
  /** @type {Iterable<Session>} */ sessions,
) {
  const saved = [...sessions].map(
    ({ id, title, program, procId, buffer, exit, ended, cwd, named, chunks }) => ({
      ...{ id, title, program, procId, buffer, exit, ended, cwd, named },
      tail: chunks,
    }),
  );
  return /** @type {Snapshot} */ ({ next, shown, sessions: saved });
}

/** A session from what a reload kept; one kept by an older version has no folder, name or banner. */
export function restoredSession(/** @type {Saved} */ kept, /** @type {Program[]} */ programs) {
  const { tail, ...rest } = kept;
  /** @type {Session} */
  const session = {
    ended: null,
    cwd: null,
    named: false,
    ...rest,
    programs,
    ...FALLBACK_SIZE,
    ...tailOf(tail),
    relaunch: false,
  };
  return session;
}

/** Move `id` to `index` in the sessions' order: the index it took, or -1 when it did not move. */
export function reorder(
  /** @type {Map<string, Session>} */ sessions,
  /** @type {string} */ id,
  /** @type {number} */ index,
) {
  const ids = [...sessions.keys()];
  const from = ids.indexOf(id);
  const to = Math.max(0, Math.min(ids.length - 1, Math.trunc(index)));
  if (from < 0 || from === to) return -1;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  const all = ids.map((key) => /** @type {Session} */ (sessions.get(key)));
  sessions.clear();
  for (const session of all) sessions.set(session.id, session);
  return to;
}
