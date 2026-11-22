// The plugin's PostgreSQL sessions, wired to its buffers and connections (PG-02, ADR 0320): the
// sessions (engines/pg-session.js) under the person's limit and idle minutes, a session's change
// drawn on the buffer on screen, a lost one said on the status line by its buffer's name, what
// closing a connection's sessions ends, the scope Cancel stops (the buffer on screen and the
// plugin's own reads), Disconnect's stop of what runs and what the plugin would start on its own
// (gate.js, ADR 0339), and the consoles' sessions taken back when the frame wakes; a refused one
// says how to ask again (connect-gate.js, ADR 0335); a console's transaction across runs, Manual
// mode's BEGIN and what the header counts of it (transactions.js, PG-20); a lost session said with
// the statements its transaction held, and opened again on its own or on Reconnect (reconnect.js,
// PG-105, ADR 0355). No DOM.

import { createSessions } from "../engines/pg-session.js";
import { createPassphrases } from "../engines/pg-tls.js";
import { connectHeld, wordRefusals } from "./connect-gate.js";
import { createGate } from "./gate.js";
import { lostLine } from "./lost-words.js";
import { keyOf, ownerOf, sessionLabel } from "./owners.js";
import { createReconnect } from "./reconnect.js";
import { chosenOf, createTransactions } from "./transactions.js";
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
 * }} Deps
 *   `consoles` is a getter: the consoles are made after the sessions they run on; `kept` names the
 *   password the keychain keeps for a connection (ADR 0311), for every session it opens;
 *   `askPassphrase` asks for a key file's passphrase, held in memory (ADR 0331).
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
  const render = () => deps.consoles().render();
  const sessions = createSessions(deps.bridge, {
    onBusy: deps.onBusy,
    onState: render,
    onLost: (owner, _line, gone) => {
      const lost = transactions.lose(owner);
      deps.view.say(lostLine(labelFor(owner), gone, lost));
      reconnect.lost(owner, byOwner(owner)?.kind ?? "", gone);
    },
    idleMs: () => deps.settings().sessionIdleMinutes * 60_000,
    limit: () => deps.settings().sessionsPerConnection,
    ...(deps.kept ? { kept: deps.kept } : {}),
    passphrases,
  });
  const worded = wordRefusals(sessions);
  const mine = (/** @type {string} */ connection) => (/** @type {{ connection: string }} */ e) =>
    e.connection === connection;
  const transactions = createTransactions({
    chosen: (owner) => {
      const target = byOwner(owner);
      return target?.kind === "console" ? chosenOf(target) : undefined;
    },
    held: (owner) => worded.inTransaction((e) => e.owner === owner).length > 0,
    flagMs: () => deps.settings().transactionIdleMinutes * 60_000,
    now: () => Date.now(),
  });
  /** Open an owner's session and run nothing on it: on its own as background work, else the
   * person's Reconnect. */
  const attempt = async (/** @type {string} */ owner, /** @type {boolean} */ auto) => {
    const target = byOwner(owner);
    const conn = target && deps.connection(target.connection);
    const session = target && ownerOf(target, conn);
    if (!conn || !session)
      return {
        error: { kind: "client", message: "That buffer keeps no PostgreSQL session." },
        notices: [],
      };
    return pg.run(conn, {
      statements: [],
      maxRows: 1,
      timeoutMs: deps.settings().timeoutSeconds * 1000,
      mode: "run",
      session,
      ...(auto ? { background: true, quiet: true } : {}),
    });
  };
  const reconnect = createReconnect({
    attempt,
    may: async (owner) => {
      const conn = deps.connection(byOwner(owner)?.connection ?? "");
      return conn !== undefined && (await connectHeld(deps.bridge, conn));
    },
    lost: (owner) => worded.state(owner).state === "lost",
    say: (owner, line) => deps.view.say(line(labelFor(owner))),
    label: labelFor,
    onState: render,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
  });
  const pg = {
    ...worded,
    run: (
      /** @type {Connection} */ conn,
      /** @type {import("../engines/pg-script.js").Plan} */ plan,
    ) => transactions.run(conn, plan, (c, p) => gate.run(c, p, worded.run)),
    state: (/** @type {string} */ owner) =>
      reconnect.model(owner, transactions.model(owner, worded.state(owner))),
    /** An owner that is gone: its session closes and its tries stop. */
    forget: (/** @type {string} */ owner) => {
      reconnect.stop(owner);
      worded.forget(owner);
    },
    /** Reconnect (PG-105): the owner's lost session opened now; the status line's words. */
    reconnect: (/** @type {string} */ owner) => reconnect.now(owner),
  };

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
