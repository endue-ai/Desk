// The plugin's PostgreSQL sessions, wired to its buffers and connections (PG-02, ADR 0320): the
// sessions (engines/pg-session.js) under the person's limit and idle minutes, a session's change
// drawn on the buffer on screen, a lost one said on the status line by its buffer's name, what
// closing a connection's sessions ends, the scope Cancel stops (the buffer on screen and the
// plugin's own reads), Disconnect's stop of what runs and what the plugin would start on its own
// (gate.js, ADR 0339), and the consoles' sessions taken back when the frame wakes; a refused one
// says how to ask again (connect-gate.js, ADR 0335). No DOM.

import { createHelper } from "../auth/helper.js";
import { createSessions } from "../engines/pg-session.js";
import { createPassphrases } from "../engines/pg-tls.js";
import { wordRefusals } from "./connect-gate.js";
import { createGate } from "./gate.js";
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
 *   kept?(conn: Connection): string | undefined,
 *   askPassphrase?(conn: Connection, why: string): Promise<string | undefined>,
 *   runner?: Parameters<typeof createHelper>[0]["runner"],
 *   confirm?(title: string, reasons: string[]): Promise<boolean>,
 * }} Deps
 *   `consoles` is a getter: the consoles are made after the sessions they run on; `kept` names the
 *   password the keychain keeps for a connection (ADR 0311), for every session it opens;
 *   `askPassphrase` asks for a key file's passphrase, held in memory (ADR 0331); `runner` runs a
 *   connection's password command once `confirm` has the person's yes to it (ADR 0354).
 */

/** @param {Deps} deps */
export function createPluginSessions(deps) {
  const passphrases = createPassphrases(deps.askPassphrase ?? (async () => undefined));
  const byOwner = (/** @type {string} */ owner) =>
    deps
      .consoles()
      .list()
      .find((t) => keyOf(t) === owner);
  const labelFor = (/** @type {string} */ owner) => {
    const target = byOwner(owner);
    return target ? sessionLabel(target, deps.connection(target.connection)) : "A console";
  };

  const gate = createGate();
  const sessions = createSessions(deps.bridge, {
    onBusy: deps.onBusy,
    onState: () => deps.consoles().render(),
    onLost: (owner, line) => deps.view.say(line(labelFor(owner))),
    idleMs: () => deps.settings().sessionIdleMinutes * 60_000,
    limit: () => deps.settings().sessionsPerConnection,
    ...(deps.kept ? { kept: deps.kept } : {}),
    passphrases,
    ...(deps.runner && deps.confirm
      ? {
          helper: createHelper({ bridge: deps.bridge, runner: deps.runner, confirm: deps.confirm }),
        }
      : {}),
  });
  const worded = wordRefusals(sessions);
  const pg = { ...worded, run: (conn, plan) => gate.run(conn, plan, worded.run) };
  const mine = (/** @type {string} */ connection) => (/** @type {{ connection: string }} */ e) =>
    e.connection === connection;

  return {
    pg,
    /** The connection's sessions, for Disconnect, a sign-in change and remove (manage.js), and
     * `forget` for its key files' passphrases, gone with the password (ADR 0331). */
    connections: {
      reasons: (/** @type {string} */ connection) =>
        reasonsOf(
          pg
            .inTransaction(mine(connection))
            .map((e) => ({ label: labelFor(e.owner), transaction: e.transaction })),
        ),
      close: (/** @type {string} */ connection) => pg.close(mine(connection)),
      /** Disconnect: what runs on it stops, and nothing of the plugin's own opens a session. */
      disconnect: (/** @type {string} */ connection) => gate.disconnect(connection),
      forget: (/** @type {string} */ connection) => passphrases.forgetAll(connection),
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
