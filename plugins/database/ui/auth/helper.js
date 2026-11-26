// A PostgreSQL connection's password command run for a session's password (PG-14, ADR 0354). Before
// its first run on this desk the person says yes to that exact command for that connection: the yes
// is kept in the plugin's store by connection id (the command, never what it printed), so a command
// a connections file, an agent or a hand-edited store brought in never runs unseen, and a changed
// command asks again. Then the program runs by `proc.spawn` without a shell, under the plugin's
// `proc:spawn` rule on `*`, which asks the desk once for that program by name (run.js). The first
// line it prints is the password: handed back to the session that asked and dropped there, never
// logged, kept or shown. It runs again for every new session: nothing is cached. A failure says the
// program's exit and its standard error's first line. No DOM.

import { t } from "../strings/index.js";
import { argvOf } from "./command.js";
import { commandFor } from "./fields.js";
import { reviewConnection } from "./review.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").DbError} DbError
 * @typedef {import("../engines/common.js").Invocation} Invocation
 * @typedef {import("../engines/common.js").Outcome} Outcome
 * @typedef {{ password: string } | { error: DbError }} Fetched
 * @typedef {(conn: Connection, quiet?: boolean) => Promise<Fetched>} Helper
 */

export const APPROVALS_KEY = "password-commands";
/** How long a password command may take before it is stopped. */
export const HELPER_MS = 30_000;
const KEPT_APPROVALS = 200;

/** The first line of a text, without its line break, cut at 300 characters. */
const firstLine = (/** @type {string} */ text) => {
  const line = (text.split(/\r?\n/u).find((l) => l.trim() !== "") ?? "").trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
};
/** @returns {{ error: DbError }} */
const failed = (/** @type {string} */ message) => ({ error: { kind: "connect", message } });

/**
 * @param {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   runner: { run(invocation: Invocation, options?: { timeoutMs?: number, quiet?: boolean }): Promise<Outcome> },
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 * }} deps
 * @returns {Helper & { review(conn: Connection): Promise<boolean> }}
 */
export function createHelper(deps) {
  /** Yeses being asked for, by connection id, so sessions opening at once ask once. */
  const asking = /** @type {Map<string, Promise<boolean>>} */ (new Map());

  const approvals = async () => {
    const kept = await deps.bridge.call("store.get", { key: APPROVALS_KEY }).catch(() => ({}));
    const value = /** @type {{ value?: unknown }} */ (kept).value;
    return /** @type {Record<string, string>} */ (
      value && typeof value === "object" && !Array.isArray(value) ? value : {}
    );
  };

  const keep = async (/** @type {Connection} */ conn, /** @type {string} */ command) => {
    const next = Object.entries({ ...(await approvals()), [conn.id]: command });
    const value = Object.fromEntries(next.slice(-KEPT_APPROVALS));
    await deps.bridge.call("store.set", { key: APPROVALS_KEY, value }).catch(() => {});
  };

  const approve = async (/** @type {Connection} */ conn, /** @type {string} */ command) => {
    const given = await approvals();
    if (given[conn.id] === command) return true;
    const yes = await deps
      .confirm(t("auth.helper.databaseRunAProgramToGet", { name: String(conn.name) }), [
        command,
        "It runs without a shell each time a session of this connection signs in; what it prints is the password, never kept",
      ])
      .catch(() => false);
    if (!yes) return false;
    await keep(conn, command);
    return true;
  };
  const approved = (/** @type {Connection} */ conn, /** @type {string} */ command) => {
    const key = `${conn.id}\n${command}`;
    const pending = asking.get(key) ?? approve(conn, command);
    asking.set(key, pending);
    return pending.finally(() => asking.delete(key));
  };

  /** @type {Helper} */
  const fetch = async (conn, quiet = false) => {
    const command = commandFor(conn);
    const { program, args } = argvOf(command);
    const said = `${conn.name}'s password command`;
    if (!program) return failed(t("auth.helper.isEmpty", { said: String(said) }));
    const mayRun = quiet ? (await approvals())[conn.id] === command : await approved(conn, command);
    if (!mayRun)
      return failed(
        quiet
          ? t("auth.helper.wasNotRunAllowItFrom", { said: String(said) })
          : t("auth.helper.wasNotRunItIsNot", { said: String(said) }),
      );
    /** @type {Outcome} */
    let outcome;
    try {
      outcome = await deps.runner.run(
        {
          command: program,
          args,
          env: {},
          nonce: "",
          statements: [],
          maxRows: 0,
          stopAfter: 0,
          reason: `To get ${conn.name}'s password, its password command`,
        },
        { timeoutMs: HELPER_MS, quiet },
      );
    } catch (error) {
      return failed(`${said}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (outcome.timedOut)
      return failed(
        t("auth.helper.didNotFinishInS", { said: String(said), value: String(HELPER_MS / 1000) }),
      );
    if (outcome.cancelled) return failed(t("auth.helper.wasStopped", { said: String(said) }));
    if (outcome.code !== 0) {
      const why = firstLine(outcome.stderr) || t("auth.helper.itWroteNothingToItsStandard");
      const how =
        outcome.code === null
          ? `ended by ${outcome.signal ?? "a signal"}`
          : `exited with ${outcome.code}`;
      return failed(`${said} ${how}: ${why}`);
    }
    const password = outcome.stdout.split(/\r?\n/u)[0] ?? "";
    if (!password)
      return failed(t("auth.helper.printedNoPasswordOnItsFirst", { said: String(said) }));
    return { password };
  };
  return Object.assign(fetch, {
    async review(/** @type {Connection} */ conn) {
      const command = commandFor(conn);
      const before = command !== "" && (await approvals())[conn.id] === command;
      const allowed = await reviewConnection(deps.bridge, conn, before, deps.confirm);
      if (allowed && command && !before) await keep(conn, command);
      return allowed;
    },
  });
}
