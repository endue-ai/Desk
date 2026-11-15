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

/** What the runtime keeps for the surface across a reload: the sessions, and the tabs' layouts. */
export function snapshotOf(
  /** @type {number} */ next,
  /** @type {string | null} */ shown,
  /** @type {Iterable<Session>} */ sessions,
  /** @type {Array<{ id: string, layout: import("./layout.js").Layout, focused: string }>} */ tabs = [],
) {
  const saved = [...sessions].map(
    ({ id, title, program, procId, buffer, exit, ended, cwd, named, chunks }) => ({
      ...{ id, title, program, procId, buffer, exit, ended, cwd, named },
      tail: chunks,
    }),
  );
  const kept = tabs.map(({ id, layout, focused }) => ({ id, layout, focused }));
  return /** @type {Snapshot} */ ({ next, shown, sessions: saved, tabs: kept });
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
