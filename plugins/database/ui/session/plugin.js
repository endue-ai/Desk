// The plugin's PostgreSQL sessions, wired to its buffers and connections (PG-02, ADR 0320): the
// sessions (engines/pg-session.js) under the person's limit and idle minutes, a session's change
// drawn on the buffer on screen, a lost one said on the status line by its buffer's name, what
// closing a connection's sessions ends, the scope Cancel stops (the buffer on screen and the
// plugin's own reads), and the consoles' sessions taken back when the frame wakes. No DOM.

import { createSessions } from "../engines/pg-session.js";
import { keyOf, sessionLabel } from "./owners.js";
import { reasonsOf } from "./words.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../consoles.js").Console} Console
 * @typedef {{
 *   bridge: import("../engines/pg-session.js").Bridge,
 *   view: { say(text: string): void },
 *   consoles(): { list(): Console[], current(): Console | null, render(): void },
 *   connection(id: string): Connection | undefined,
 *   settings(): import("../settings.js").Settings,
 *   onBusy(running: number): void,
 * }} Deps
 *   `consoles` is a getter: the consoles are made after the sessions they run on.
 */

/** @param {Deps} deps */
export function createPluginSessions(deps) {
  const byOwner = (/** @type {string} */ owner) =>
    deps
      .consoles()
      .list()
      .find((t) => keyOf(t) === owner);
  const labelFor = (/** @type {string} */ owner) => {
    const target = byOwner(owner);
    return target ? sessionLabel(target, deps.connection(target.connection)) : "A console";
  };

  const pg = createSessions(deps.bridge, {
    onBusy: deps.onBusy,
    onState: () => deps.consoles().render(),
    onLost: (owner, line) => deps.view.say(line(labelFor(owner))),
    idleMs: () => deps.settings().sessionIdleMinutes * 60_000,
    limit: () => deps.settings().sessionsPerConnection,
  });
  const mine = (/** @type {string} */ connection) => (/** @type {{ connection: string }} */ e) =>
    e.connection === connection;

  return {
    pg,
    /** The connection's sessions, for Disconnect, a sign-in change and remove (manage.js). */
    connections: {
      reasons: (/** @type {string} */ connection) =>
        reasonsOf(
          pg
            .inTransaction(mine(connection))
            .map((e) => ({ label: labelFor(e.owner), transaction: e.transaction })),
        ),
      close: (/** @type {string} */ connection) => pg.close(mine(connection)),
    },
    /** What Cancel stops: the runs of the buffer on screen and the plugin's own reads. */
    scope() {
      const shown = deps.consoles().current();
      return { owner: (shown && keyOf(shown)) ?? "" };
    },
    /** After the frame wakes: the consoles' sessions the state kept, theirs again. */
    adopt: (/** @type {unknown} */ saved) =>
      pg.adopt(saved, (owner, connection) => {
        const target = byOwner(owner);
        return target?.connection === connection ? deps.connection(connection) : undefined;
      }),
  };
}
