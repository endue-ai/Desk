// The plugin's PostgreSQL sessions, wired to its buffers and connections (PG-02, ADR 0320): the
// sessions (engines/pg-session.js) under the person's limit and idle minutes, a session's change
// drawn on the buffer on screen, a lost one said on the status line by its buffer's name, what
// closing a connection's sessions ends, the scope Cancel stops (the buffer on screen and the
// plugin's own reads), Disconnect's stop of what runs and what the plugin would start on its own
// (gate.js, ADR 0339), and the consoles' sessions taken back when the frame wakes; a refused one
// says how to ask again (connect-gate.js, ADR 0335); a console's transaction across runs, Manual
// mode's BEGIN and what the header counts of it (transactions.js, PG-20); a lost session said with
// the statements its transaction held, and opened again on its own or on Reconnect (reconnect.js,
// PG-105, ADR 0355); a console's notices as they are raised while it runs, what its session hears
// after LISTEN, the channels it listens to and what stops them (raised.js, listen.js, PG-25, ADR
// 0358): a listening session is never closed for idleness, one that ends says it stopped
// listening, nothing listens again on its own, and an agent's run may not LISTEN. No DOM.

import { createHelper } from "../auth/helper.js";
import { failedRun } from "../engines/common.js";
import { createSessions } from "../engines/pg-session.js";
import { createPassphrases } from "../engines/pg-tls.js";
import { createTunnel } from "../tunnel/open.js";
import { connectHeld, wordRefusals } from "./connect-gate.js";
import { createGate } from "./gate.js";
import { createListening, listens } from "./listen.js";
import { AGENT_LISTEN, liveShown, stoppedLine, withNotifications } from "./listen-tabs.js";
import { lostLine } from "./lost-words.js";
import { keyOf, ownerOf, sessionLabel } from "./owners.js";
import { createRaised } from "./raised.js";
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
  // An SSH tunnel's host key is shown with confirm, its secrets asked as a key's (ADR 0359).
  const tunnel = createTunnel({
    ...(deps.confirm ? { confirm: deps.confirm } : {}),
    ...(deps.askPassphrase ? { ask: deps.askPassphrase } : {}),
  });
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
  const listening = createListening({ now: () => Date.now() });
  const raised = createRaised();
  /** What a session hears draws at most once in 100 ms, however fast it comes. */
  let drawing = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
  const soon = () => {
    drawing ??= setTimeout(() => {
      drawing = undefined;
      render();
    }, 100);
  };
  const sessions = createSessions(deps.bridge, {
    onBusy: deps.onBusy,
    onState: render,
    onLost: (owner, _line, gone) => {
      const lost = transactions.lose(owner);
      const stopped = listening.model(owner)?.stopped ?? [];
      deps.view.say(`${lostLine(labelFor(owner), gone, lost)}${stoppedLine(stopped)}`);
      reconnect.lost(owner, byOwner(owner)?.kind ?? "", gone);
    },
    holds: (owner) => listening.listening(owner),
    ended: (owner) => listening.ended(owner),
    onRaised: (owner, lines) => {
      if (raised.add(owner, lines)) soon();
    },
    onNotification: (owner, n) => {
      listening.heard(owner, n);
      soon();
    },
    idleMs: () => deps.settings().sessionIdleMinutes * 60_000,
    limit: () => deps.settings().sessionsPerConnection,
    ...(deps.kept ? { kept: deps.kept } : {}),
    passphrases,
    tunnel,
    ...(deps.runner && deps.confirm
      ? {
          helper: createHelper({ bridge: deps.bridge, runner: deps.runner, confirm: deps.confirm }),
        }
      : {}),
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
  /** A run on an owner's session: its notices as they come, and the channels it listens to. */
  const heard = async (
    /** @type {Connection} */ conn,
    /** @type {import("../engines/pg-script.js").Plan} */ plan,
  ) => {
    const owner = plan.session?.kind === "console" ? plan.session.owner : undefined;
    if (!owner) return gate.run(conn, plan, worded.run);
    const before = worded.inTransaction((e) => e.owner === owner)[0]?.transaction ?? "idle";
    if (!plan.background) raised.start(owner);
    try {
      const done = await gate.run(conn, plan, worded.run);
      listening.ran(owner, plan.statements, done, plan.mode, before);
      return done;
    } finally {
      raised.end(owner);
    }
  };
  const pg = {
    ...worded,
    run: (
      /** @type {Connection} */ conn,
      /** @type {import("../engines/pg-script.js").Plan} */ plan,
    ) =>
      plan.agent && plan.statements.some(listens)
        ? Promise.resolve(failedRun(plan.statements, { kind: "refused", message: AGENT_LISTEN }))
        : transactions.run(conn, plan, heard),
    state: (/** @type {string} */ owner) =>
      reconnect.model(owner, transactions.model(owner, worded.state(owner))),
    /** An owner that is gone: its session closes and its tries stop. */
    forget: (/** @type {string} */ owner) => {
      reconnect.stop(owner);
      worded.forget(owner);
      listening.forget(owner);
    },
    /** What a console shows of PG-25 (listen-tabs.js): the notices of its run as they come, and
     * its Notifications tab; on screen, the tab's badge goes. */
    decorate: (/** @type {string} */ owner, /** @type {Console} */ model) => {
      const live = model.running ? raised.model(owner) : undefined;
      if (live) model.shown = liveShown(live);
      const next = withNotifications(model.shown, model.tab, listening.model(owner));
      model.shown = next.shown;
      model.tab = next.tab;
      if (model.shown?.tabs[model.tab]?.kind === "notifications") {
        listening.seen(owner);
        const tab = /** @type {import("../tabs.js").Tab} */ (model.shown.tabs[model.tab]);
        model.shown.tabs[model.tab] = { ...tab, label: "Notifications" };
      }
    },
    /** The notifications kept for an owner, for Clear and Listen again. */
    listening: {
      clear: (/** @type {string} */ owner) => listening.clear(owner),
      model: (/** @type {string} */ owner) => listening.model(owner),
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
      forget: (/** @type {string} */ connection) => {
        passphrases.forgetAll(connection);
        tunnel.forgetAll(connection);
      },
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
