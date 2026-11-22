// PostgreSQL on the core's sessions (db.*, ADR 0281), no client program. A console's or a table
// view's run goes to the session that owner keeps (PG-02, ADR 0320: session/keeper.js), opened at its
// first run and kept, so what one run sets the next sees; any other run (the catalog, a feature's
// read, an agent's query) opens a short session of its own and closes it. The statements run as
// pg-script.js says. A session asks for db:connect on the connection's host and port once the grant
// is missing (ADR 0260), takes its TLS from pg-tls.js (a CA file, a client certificate and key, ADR
// 0331), hands over the password the person typed (else names the one the keychain keeps,
// `passwordRef`, ADR 0311; the core reads the password file first), and starts read-only for a read-only connection. Cancel is
// db.cancel, for the runs of the console on screen, or of one run its signal stops (a kept session
// stays open); the statement timeout is the server's statement_timeout, which a kept session takes
// again with SET when the setting changed. Every session signs in with the connection's session
// options and runs its startup script first (pg-options.js, pg-startup.js, PG-12). No DOM.

import { endpoint } from "../keychain.js";
import { createKeeper } from "../session/keeper.js";
import { createSlots, RUNS_AT_ONCE } from "../session/slots.js";
import { failedRun } from "./common.js";
import { sessionSettings } from "./pg-options.js";
import { noticeOf, refusedOf } from "./pg-result.js";
import { createScript } from "./pg-script.js";
import { runStartup } from "./pg-startup.js";
import { createTls } from "./pg-tls.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./pg-script.js").Plan} Plan
 * @typedef {import("./pg-script.js").Job} Job
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call" | "onEvent">} Bridge
 * @typedef {{ owner: string } | undefined} Scope
 *   What Cancel stops: that owner's runs and the plugin's own short reads, else every run.
 */

/** What the server shows as the session's application (pg_stat_activity.application_name). */
export const APPLICATION = "endue Desk";
/** Short runs holding a session at once (session/slots.js); the core allows a plugin 16. */
export const MAX_SESSIONS = RUNS_AT_ONCE;
export { BACKSTOP_MS, GRACE_MS } from "./pg-script.js";

const SIGN_IN_MS = 10_000;
/** Kept sessions per connection when no setting says. */
const PER_CONNECTION = 8;
/** @returns {DbError} */
const cancelled = () => ({ kind: "cancelled", message: "Cancelled." });
/** A host db.open takes: a name or an IPv4 address (no socket folder, no IPv6 yet). */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/u;

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const textOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** The server and the sign-in a connection names, or the sentence why it cannot be reached. */
export function targetOf(/** @type {Connection} */ conn) {
  const host = conn.host || "localhost";
  if (!HOST.test(host))
    return `${conn.name}: ${host} is not a host name or an IPv4 address, which is what the desk's PostgreSQL sessions connect to (a socket folder or an IPv6 address is not supported yet).`;
  if (!conn.user) return `${conn.name} has no user: set the role PostgreSQL signs in as.`;
  return { host, port: conn.port ?? 5432, database: conn.database || conn.user, user: conn.user };
}

/** The session's settings: its name on the server, ISO dates, the statement timeout, then the
 * connection's own session options (its application name over the plugin's). */
export const settingsOf = (
  /** @type {number} */ timeoutMs,
  /** @type {Connection | undefined} */ conn = undefined,
) => ({
  application_name: APPLICATION,
  DateStyle: "ISO",
  ...(timeoutMs > 0 ? { statement_timeout: String(timeoutMs) } : {}),
  ...(conn ? sessionSettings(conn) : {}),
});

/**
 * @param {Bridge} bridge
 * @param {{
 *   onBusy?(running: number): void, now?(): number,
 *   setTimer?(fn: () => void, ms: number): unknown, clearTimer?(timer: unknown): void,
 *   onState?(owner: string): void, onLost?(owner: string, line: (label: string) => string): void,
 *   idleMs?(): number, limit?(): number, kept?(conn: Connection): string | undefined,
 *   passphrases?: import("./pg-tls.js").Passphrases,
 * }} [options] `onState` hears an owner's session change (the header draws it), `onLost` one lost
 *   with the status line's words for its label; `idleMs` closes a session no run used that long
 *   (0 never), `limit` is the kept sessions a connection may hold; `kept` names the connection's
 *   password the keychain keeps (manager.passwords.ref, ADR 0311); `passphrases` holds and asks for
 *   key files' passphrases (ADR 0331).
 */
export function createSessions(bridge, options = {}) {
  const onBusy = options.onBusy ?? (() => {});
  const kept = options.kept ?? (() => undefined);
  const tls = createTls(bridge, options.passphrases);
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)));
  /** @type {Set<Job>} */
  const jobs = new Set();
  /** Every session this frame opened, so a frame that wakes closes only another's. */
  const own = new Set();
  /** Each session's own notices (db.notice: raised outside any call, ADR 0334) not shown yet, by
   * session id: a run on it shows them as the run's (pg-script.js). */
  const sinks = /** @type {Map<string, string[]>} */ (new Map());
  const slots = createSlots();

  /** @param {string} method @param {Record<string, unknown>} params @returns {Promise<any>} */
  const call = (method, params) => bridge.call(/** @type {never} */ (method), params);

  /** A call under the plugin's db:connect grant; refused, ask once for the server and call again. */
  const granted = async (
    /** @type {() => Promise<unknown>} */ open,
    /** @type {{ permission: "db:connect", hosts: string[] }} */ scope,
    /** @type {Connection} */ conn,
  ) => {
    try {
      return await open();
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw error;
    }
    const reason = `To run SQL on ${conn.name}, a PostgreSQL server`;
    const decision = await call("perm.request", { permission: scope, reason }).catch(() => ({
      granted: false,
    }));
    if (!decision.granted) throw Object.assign(new Error("refused"), { code: "permission_denied" });
    return open();
  };

  /** The password db.open takes: the one typed, else the kept one's name when it is for this
   * host, port and user (endpoint(conn)), else none and the core reads the password file. */
  const signIn = (
    /** @type {Connection} */ conn,
    /** @type {{ host: string, port: number, user: string }} */ target,
    /** @type {Plan} */ plan,
  ) => {
    if (plan.password !== undefined) return { password: plan.password };
    const name = kept(conn);
    const at = endpoint(conn);
    const fits = at.host === target.host && at.port === target.port && at.user === target.user;
    return name && fits ? { passwordRef: name } : {};
  };

  /**
   * Sign in; the session's id, or the error the run ends with.
   * @param {Connection} conn @param {Exclude<ReturnType<typeof targetOf>, string>} target @param {Plan} plan
   * @returns {Promise<import("../session/keeper.js").Opened>}
   */
  const open = async (conn, target, plan) => {
    const where = `${target.host}:${target.port}`;
    /** @type {import("./pg-tls.js").Tls | undefined} */
    let secure;
    try {
      secure = await tls.of(conn);
    } catch (error) {
      return { error: { kind: "connect", message: textOf(error) } };
    }
    const scope = /** @type {const} */ ({ permission: "db:connect", hosts: [where] });
    const params = {
      engine: "postgresql",
      ...target,
      ...signIn(conn, target, plan),
      settings: settingsOf(plan.timeoutMs, conn),
      ...(conn.readOnly ? { readOnly: true } : {}),
      timeoutMs: SIGN_IN_MS,
      scope,
    };
    try {
      const opened = /** @type {import("@endue-ai/bridge").DbOpenResult} */ (
        await granted(
          () =>
            tls.open(conn, secure, plan.quiet === true, (t) =>
              call("db.open", { ...params, ...(t ? { tls: t } : {}) }),
            ),
          scope,
          conn,
        )
      );
      if (opened.sessionId) {
        own.add(opened.sessionId);
        const failed = await runStartup(first, conn, opened.sessionId, plan.timeoutMs);
        if (failed) return { error: failed };
        return { sessionId: opened.sessionId, pid: opened.pid ?? 0 };
      }
      if (opened.keyPassword) return { error: tls.refused(conn, opened.keyPassword) };
      if (opened.error) return { error: refusedOf(opened.error) };
      const message =
        "passwordRef" in params
          ? `${where} asks for a password, and neither the password file nor the keychain has one for ${target.user}.`
          : `${where} asks for a password, and the password file has none for ${target.user}.`;
      return { error: { kind: "auth", message } };
    } catch (error) {
      const code = codeOf(error);
      if (code === "permission_denied")
        return { error: { kind: "refused", message: `Not allowed to connect to ${where}.` } };
      if (code === "unsupported")
        return {
          error: {
            kind: "client",
            message: "This desk cannot open database sessions: db.* is unsupported.",
          },
        };
      return {
        error: { kind: "connect", message: `Could not connect to ${where}: ${textOf(error)}` },
      };
    }
  };

  const { script } = createScript({ call, sinks, setTimer, clearTimer });
  /** What the startup script runs on, before the session is handed out. */
  const first = {
    script,
    close: (/** @type {string} */ id) => call("db.close", { sessionId: id }),
  };
  const keeper = createKeeper({
    call,
    slots,
    onState: options.onState ?? (() => {}),
    onLost: options.onLost ?? (() => {}),
    idleMs: options.idleMs ?? (() => 0),
    limit: options.limit ?? (() => PER_CONNECTION),
    now,
    setTimer,
    clearTimer,
  });

  bridge.onEvent((event) => {
    if (event.event === "db.notice") {
      const id = event.data.sessionId;
      if (!sinks.has(id) && own.has(id)) sinks.set(id, []);
      sinks.get(id)?.push(...noticeOf(event.data.notice));
    }
    if (event.event === "db.closed") {
      sinks.delete(event.data.sessionId);
      keeper.closed(event.data);
    }
  });

  /** A run on a short session of its own, opened and closed around it. */
  const short = async (
    /** @type {Job} */ job,
    /** @type {Connection} */ conn,
    /** @type {Exclude<ReturnType<typeof targetOf>, string>} */ target,
    /** @type {Plan} */ plan,
  ) => {
    await slots.take("short");
    try {
      if (job.cancelled) return failedRun(plan.statements, cancelled());
      const opened = await open(conn, target, plan);
      if ("error" in opened) return failedRun(plan.statements, opened.error);
      job.sessionId = opened.sessionId;
      try {
        // Cancelled while it signed in: nothing ran.
        if (job.cancelled) return failedRun(plan.statements, cancelled());
        return await script(job, plan);
      } finally {
        sinks.delete(opened.sessionId);
        await call("db.close", { sessionId: opened.sessionId }).catch(() => {});
      }
    } finally {
      slots.give("short");
    }
  };

  /** A run on the session its owner keeps: opened at the first, and what earlier runs set stays. */
  const owned = async (
    /** @type {Job} */ job,
    /** @type {Connection} */ conn,
    /** @type {Exclude<ReturnType<typeof targetOf>, string>} */ target,
    /** @type {Plan & { session: import("../session/keeper.js").Owner }} */ plan,
  ) => {
    const used = await keeper.use(
      plan.session,
      conn,
      plan.timeoutMs,
      () => open(conn, target, plan),
      async (entry, notes) => {
        if (job.cancelled) return failedRun(plan.statements, cancelled());
        job.sessionId = entry.sessionId;
        job.transaction = entry.transaction;
        // A changed statement timeout reaches the session outside a transaction, where SET stays.
        if (entry.timeoutMs !== plan.timeoutMs && entry.transaction === "idle") {
          const ran = await script(job, {
            ...plan,
            mode: "run",
            statements: [setTimeout_(plan.timeoutMs)],
          });
          if (!ran.statements[0]?.error) entry.timeoutMs = plan.timeoutMs;
        }
        const done = await script(job, { ...plan, timeoutMs: entry.timeoutMs }, entry.transaction);
        entry.transaction = job.transaction ?? entry.transaction;
        if (job.ended) keeper.lost(entry.sessionId, job.ended);
        return { ...done, notices: [...notes, ...done.notices] };
      },
    );
    return "error" in used ? failedRun(plan.statements, used.error) : used.done;
  };

  /**
   * Run the plan: on its owner's kept session when it names one, else on a short one.
   * @param {Connection} conn
   * @param {Plan} plan
   * @returns {Promise<RunResult>}
   */
  const run = async (conn, plan) => {
    const started = now();
    const target = targetOf(conn);
    if (typeof target === "string")
      return failedRun(plan.statements, { kind: "connect", message: target });
    if (plan.signal?.aborted) return failedRun(plan.statements, cancelled());
    /** @type {Job} */
    const job = {
      running: false,
      cancelled: false,
      timedOut: false,
      agent: plan.agent === true,
      ...(plan.session ? { owner: plan.session.owner } : {}),
    };
    const abort = () => stop(job);
    plan.signal?.addEventListener("abort", abort, { once: true });
    jobs.add(job);
    onBusy(jobs.size);
    try {
      const done = plan.session
        ? await owned(job, conn, target, /** @type {never} */ (plan))
        : await short(job, conn, target, plan);
      return { ...done, ms: now() - started };
    } finally {
      plan.signal?.removeEventListener("abort", abort);
      jobs.delete(job);
      onBusy(jobs.size);
    }
  };

  /** Cancel one run: its statement is cancelled on its session, nothing after it starts. */
  const stop = (/** @type {Job} */ job) => {
    job.cancelled = true;
    if (job.running && job.sessionId)
      void call("db.cancel", { sessionId: job.sessionId }).catch(() => {});
  };
  /**
   * Cancel runs. With a scope, the owner's runs and the plugin's own short reads; another owner's
   * and agents' go on. A kept session stays open: only its statement is cancelled.
   * @param {Scope} [scope]
   */
  const cancel = (scope) => {
    for (const job of jobs)
      if (!scope || job.owner === scope.owner || (!job.owner && !job.agent)) stop(job);
  };

  return {
    run,
    cancel,
    running: () => jobs.size,
    /** What the header shows for an owner's session. */
    state: keeper.state,
    /** Close the kept sessions `test` takes (a console's, a connection's). */
    close: keeper.close,
    /** An owner that is gone: its session closes. */
    forget: keeper.forget,
    /** The kept sessions `test` takes that are in a transaction. */
    inTransaction: keeper.inTransaction,
    /** The consoles' sessions, for the surface state. */
    kept: keeper.kept,
    /**
     * After a frame wakes: take back the consoles' sessions `saved` names that db.list still
     * holds, for owners `known` still has; close every other session but this frame's own.
     * @param {unknown} saved
     * @param {(owner: string, connection: string) => Connection | undefined} known
     */
    async adopt(saved, known) {
      const listed = await call("db.list", {}).catch(() => ({ sessions: [] }));
      const keptOf = Array.isArray(saved) ? saved.filter(isKept) : [];
      await keeper.adopt(keptOf, listed.sessions ?? [], known, own);
    },
  };
}

/** SET statement_timeout as a statement of the plugin's own. */
const setTimeout_ = (/** @type {number} */ ms) => {
  const text = `SET statement_timeout = ${Math.max(0, Math.round(ms))}`;
  return { text, start: 0, end: text.length, line: 1, column: 1, tokens: [] };
};

/** One kept session in the surface state, as keeper.kept() wrote it. */
const isKept = (/** @type {any} */ k) =>
  typeof k?.owner === "string" &&
  typeof k.sessionId === "string" &&
  typeof k.connection === "string" &&
  typeof k.timeoutMs === "number";
