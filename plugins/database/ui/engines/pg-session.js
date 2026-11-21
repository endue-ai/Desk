// PostgreSQL on the core's sessions (db.*, ADR 0281), no client program: a run opens a session,
// runs each statement through db.run and reads its pages up to the row limit (closing the rest),
// and closes the session, as one psql process was one run (PG-02 keeps one per console next). It
// asks for db:connect on the connection's host and port once the grant is missing (ADR 0260), reads
// a CA file for the TLS modes that check certificates, hands over the password the person typed (else
// the core reads the password file), and starts the session read-only for a read-only connection.
// A script in one transaction or a dry run is BEGIN, the statements, COMMIT or ROLLBACK on that
// session. Cancel is db.cancel; the statement timeout is the server's statement_timeout, with a
// backstop that cancels and then closes the session. No DOM.

import { readScope, withGrant } from "../console-files.js";
import { endedBy, failedRun, notRun } from "./common.js";
import { affectedOf, CANCELED, errorOf, noticeOf, refusedOf, setOf } from "./pg-result.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./common.js").StatementOutcome} StatementOutcome
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {import("@endue-ai/bridge").DbPage} Page
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call" | "onEvent">} Bridge
 * @typedef {{
 *   statements: Statement[], maxRows: number, timeoutMs: number, password?: string,
 *   mode: "run" | "transaction" | "dry-run",
 * }} Plan
 * @typedef {{ sessionId?: string, running: boolean, cancelled: boolean, timedOut: boolean }} Job
 */

/** What the server shows as the session's application (pg_stat_activity.application_name). */
export const APPLICATION = "endue Desk";
/** Runs holding a session at once; the core allows a plugin 16. */
export const MAX_SESSIONS = 12;
/** How long the client waits past the statement timeout before it cancels, then closes. */
export const BACKSTOP_MS = 5000;
export const GRACE_MS = 1000;
const PAGE_ROWS = 10_000;
const SIGN_IN_MS = 10_000;
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

/** The session's settings: its name on the server, ISO dates, the statement timeout. */
export const settingsOf = (/** @type {number} */ timeoutMs) => ({
  application_name: APPLICATION,
  DateStyle: "ISO",
  ...(timeoutMs > 0 ? { statement_timeout: String(timeoutMs) } : {}),
});

/**
 * @param {Bridge} bridge
 * @param {{
 *   onBusy?(running: number): void, now?(): number,
 *   setTimer?(fn: () => void, ms: number): unknown, clearTimer?(timer: unknown): void,
 * }} [options]
 */
export function createSessions(bridge, options = {}) {
  const onBusy = options.onBusy ?? (() => {});
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)));
  /** @type {Set<Job>} */
  const jobs = new Set();
  /** Runs waiting for a session. @type {Array<() => void>} */
  const queue = [];
  let held = 0;
  /** Where each session's notices go: the statement that runs, by session id. */
  const sinks = /** @type {Map<string, string[]>} */ (new Map());

  bridge.onEvent((event) => {
    if (event.event === "db.notice")
      sinks.get(event.data.sessionId)?.push(...noticeOf(event.data.notice));
  });

  const take = async () => {
    if (held < MAX_SESSIONS) held++;
    else await new Promise((resolve) => queue.push(() => resolve(undefined)));
  };
  const give = () => {
    const next = queue.shift();
    if (next) next();
    else held--;
  };
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

  /** db.open's tls: none for the default (the core's prefer), the CA file's PEM when one is set. */
  const tlsOf = async (/** @type {Connection} */ conn) => {
    if (conn.ssl === "default") return undefined;
    if (conn.ssl === "disable" || !conn.sslCa) return { mode: conn.ssl };
    const path = conn.sslCa;
    const scope = readScope(path);
    const read = () => call("fs.read", { path, encoding: "utf8", scope });
    const file = await withGrant(bridge, scope, read, `To trust ${conn.name}'s certificates`);
    return { mode: conn.ssl, ca: String(file.content) };
  };

  /**
   * Sign in; the session's id, or the error the run ends with.
   * @param {Connection} conn @param {Exclude<ReturnType<typeof targetOf>, string>} target @param {Plan} plan
   * @returns {Promise<{ sessionId: string } | { error: DbError }>}
   */
  const open = async (conn, target, plan) => {
    const where = `${target.host}:${target.port}`;
    /** @type {{ mode: string, ca?: string } | undefined} */
    let tls;
    try {
      tls = await tlsOf(conn);
    } catch (error) {
      return { error: { kind: "connect", message: textOf(error) } };
    }
    const scope = /** @type {const} */ ({ permission: "db:connect", hosts: [where] });
    const params = {
      engine: "postgresql",
      ...target,
      ...(plan.password !== undefined ? { password: plan.password } : {}),
      ...(tls ? { tls } : {}),
      settings: settingsOf(plan.timeoutMs),
      ...(conn.readOnly ? { readOnly: true } : {}),
      timeoutMs: SIGN_IN_MS,
      scope,
    };
    try {
      const opened = /** @type {import("@endue-ai/bridge").DbOpenResult} */ (
        await granted(() => call("db.open", params), scope, conn)
      );
      if (opened.sessionId) return { sessionId: opened.sessionId };
      if (opened.error) return { error: refusedOf(opened.error) };
      const message = `${where} asks for a password, and the password file has none for ${target.user}.`;
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

  /** The statement timeout passed by the backstop: cancel, then end the session. */
  const stall = (/** @type {Job} */ job) => {
    job.timedOut = true;
    const sessionId = job.sessionId;
    void call("db.cancel", { sessionId }).catch(() => {});
    setTimer(() => void call("db.close", { sessionId }).catch(() => {}), GRACE_MS);
  };

  /**
   * One statement on the job's session: its pages up to `maxRows`, then the rest closed.
   * @param {Job} job @param {Statement} statement @param {number} index @param {Plan} plan
   * @returns {Promise<StatementOutcome>}
   */
  const one = async (job, statement, index, plan) => {
    const { maxRows, timeoutMs } = plan;
    const sessionId = job.sessionId;
    /** @type {string[]} */
    const notices = [];
    sinks.set(/** @type {string} */ (sessionId), notices);
    const rowsOf = (/** @type {number} */ have) => Math.max(1, Math.min(PAGE_ROWS, maxRows - have));
    const ended = (/** @type {"cancelled" | "timedOut"} */ flag) =>
      /** @type {DbError} */ (endedBy(/** @type {never} */ ({ [flag]: true }), timeoutMs));
    const backstop =
      timeoutMs > 0 ? setTimer(() => stall(job), timeoutMs + BACKSTOP_MS) : undefined;
    job.running = true;
    try {
      /** @type {Page} */
      let page = await call("db.run", { sessionId, sql: statement.text, pageRows: rowsOf(0) });
      const columns = page.columns;
      const rows = [...page.rows];
      while (page.more && !page.copy && rows.length < maxRows && !job.cancelled) {
        page = await call("db.fetch", { sessionId, pageRows: rowsOf(rows.length) });
        for (const row of page.rows) rows.push(row);
      }
      // COPY ... FROM STDIN is refused before it is sent (sql/classify.js); one that comes anyway
      // is ended, so the session is not left waiting for data.
      if (page.copy?.direction === "in")
        page = await call("db.copy", { sessionId, fail: "COPY FROM STDIN does not run here" });
      if (page.more) await call("db.fetch", { sessionId, close: true }).catch(() => {});
      const sets = columns ? [setOf(columns, rows, maxRows, page.more)] : [];
      const base = { index, ran: true, sets, warnings: 0, notices };
      const failure = page.error;
      if (!failure) return { ...base, affected: columns ? null : affectedOf(page) };
      const stopped = failure.code === CANCELED;
      const timeout = /statement timeout/u.test(failure.message) && timeoutMs > 0;
      const error =
        stopped && job.cancelled
          ? ended("cancelled")
          : job.timedOut || (stopped && timeout)
            ? ended("timedOut")
            : errorOf(failure, statement.text);
      return { ...base, affected: null, error };
    } catch (failure) {
      const error = job.cancelled
        ? ended("cancelled")
        : job.timedOut
          ? ended("timedOut")
          : /** @type {DbError} */ ({
              kind: "client",
              message: `The session ended: ${textOf(failure)}`,
            });
      return { index, ran: true, sets: [], affected: null, warnings: 0, notices, error };
    } finally {
      job.running = false;
      clearTimer(backstop);
    }
  };

  /** BEGIN, COMMIT or ROLLBACK of the plugin's own; its error, if any. */
  const own = async (/** @type {Job} */ job, /** @type {string} */ sql) => {
    try {
      const page = /** @type {Page} */ (await call("db.run", { sessionId: job.sessionId, sql }));
      return page.error ? errorOf(page.error, sql) : undefined;
    } catch (failure) {
      return /** @type {DbError} */ ({ kind: "client", message: `${sql}: ${textOf(failure)}` });
    }
  };

  /** The plan's statements on the job's session, in its mode. @returns {Promise<RunResult>} */
  const script = async (/** @type {Job} */ job, /** @type {Plan} */ plan) => {
    const outcomes = plan.statements.map((_, index) => notRun(index));
    /** @type {string[]} */
    const notices = [];
    const result = (/** @type {DbError | undefined} */ error) => ({
      statements: outcomes,
      notices,
      ms: 0,
      ...(error ? { error } : {}),
    });
    if (plan.mode !== "run") {
      const begun = await own(job, "BEGIN");
      if (begun) return result(begun);
    }
    let failed = false;
    for (const [index, statement] of plan.statements.entries()) {
      if (job.cancelled) break;
      const outcome = await one(job, statement, index, plan);
      outcomes[index] = outcome;
      failed = Boolean(outcome.error);
      if (failed) break;
    }
    /** @type {DbError | undefined} */
    let error;
    if (plan.mode === "dry-run" || (plan.mode === "transaction" && (failed || job.cancelled)))
      await own(job, "ROLLBACK");
    else if (plan.mode === "transaction") error = await own(job, "COMMIT");
    if (job.cancelled && !outcomes.some((o) => o.error?.kind === "cancelled"))
      notices.push("Cancelled: the statements shown had finished before the cancel reached them.");
    return result(error);
  };

  /**
   * Run the plan on a session of its own.
   * @param {Connection} conn
   * @param {Plan} plan
   * @returns {Promise<RunResult>}
   */
  const run = async (conn, plan) => {
    const started = now();
    const target = targetOf(conn);
    if (typeof target === "string")
      return failedRun(plan.statements, { kind: "connect", message: target });
    /** @type {Job} */
    const job = { running: false, cancelled: false, timedOut: false };
    jobs.add(job);
    onBusy(jobs.size);
    await take();
    try {
      if (job.cancelled)
        return failedRun(plan.statements, { kind: "cancelled", message: "Cancelled." });
      const opened = await open(conn, target, plan);
      if ("error" in opened) return failedRun(plan.statements, opened.error, now() - started);
      job.sessionId = opened.sessionId;
      try {
        return { ...(await script(job, plan)), ms: now() - started };
      } finally {
        sinks.delete(opened.sessionId);
        await call("db.close", { sessionId: opened.sessionId }).catch(() => {});
      }
    } finally {
      give();
      jobs.delete(job);
      onBusy(jobs.size);
    }
  };

  /** Cancel every run: the statement that runs is cancelled on the server, nothing after starts. */
  const cancel = () => {
    for (const job of jobs) {
      job.cancelled = true;
      if (job.running && job.sessionId)
        void call("db.cancel", { sessionId: job.sessionId }).catch(() => {});
    }
  };

  return { run, cancel, running: () => jobs.size };
}
