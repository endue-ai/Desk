/**
 * The browser stub's database sessions: db.* (ADR 0281) answered from a script instead of a
 * server, with the core's rules (specs/bridge/v0/README.md): db:connect checked against the host
 * and port, agents refused, postgresql alone, reserved settings and page limits, 16 sessions a
 * caller, sessions their caller's alone, pages whose `more` is exact and whose last page counts
 * every page, one statement at a time, cancel, COPY, and db.closed when the session ends; a
 * transaction as the server keeps it (stub-db-transaction.ts), and pg_terminate_backend's FATAL. A
 * password kept with db.passwords.* signs in by `passwordRef` (stub-db-passwords.ts, ADR 0311);
 * db.script runs several statements as db.run runs each (stub-db-script.ts, ADR 0344).
 */
import { StubError, type StubHandlers } from "./adapters";
import type {
  BridgeEvent,
  DbConnectPermission,
  DbPage,
  DbRunParams,
  DbServerError,
  DbSessionInfo,
  DbTransaction,
  DbValue,
  Permission,
} from "./generated";
import { covers } from "./stub-covers";
import { stubDbCursors } from "./stub-db-cursor";
import { type DbPasswordsServed, stubDbPasswords } from "./stub-db-passwords";
import {
  bytes,
  failure,
  limits,
  MAX_SESSIONS,
  RESERVED,
  refuseAgents,
  tagOf,
} from "./stub-db-rules";
import { type Scripting, stubDbScript } from "./stub-db-script";
import {
  controlTag,
  endsFailed,
  IGNORED,
  isControl,
  TERMINATED,
  terminateAnswer,
  terminated,
  transactionAfter,
} from "./stub-db-transaction";
import type { StubDatabase, StubSession, StubStatement } from "./stub-db-types";

export type { StubDbOptions } from "./stub-db-types";

export type DbServed =
  | `db.${"open" | "run" | "script" | "fetch" | "copy" | "cancel" | "close" | "list"}`
  | DbPasswordsServed;

/** The stub's grant check: throws permission_denied unless a grant covers `scope` and `fits`. */
type Check = (caller: string | undefined, scope: Permission, fits: boolean) => void;

interface Session {
  caller: string;
  scope: DbConnectPermission;
  signed: StubSession;
  info: Omit<DbSessionInfo, "running" | "more" | "transaction">;
  transaction: DbTransaction;
  result?: { rows: DbValue[][]; at: number; tag: string };
  copying?: { lines: number };
  running?: () => void;
  scripting?: Scripting;
}

export function stubDb(
  script: StubDatabase | undefined,
  check: Check,
  later: (event: BridgeEvent) => void,
) {
  const sessions = new Map<string, Session>();
  /** Every session's caller, kept after it ends so its db.closed still finds it. */
  const owners = new Map<string, string>();
  const kept = stubDbPasswords();
  let next = 0;

  const mine = (caller: string | undefined, sessionId: string) => {
    refuseAgents(caller);
    const session = sessions.get(sessionId);
    if (!session || session.caller !== (caller ?? "desk"))
      throw new StubError("not_found", `${caller} has no session ${sessionId}`);
    return session;
  };
  const idle = (session: Session) => {
    if (session.running || session.scripting)
      throw new StubError("invalid_params", "a statement runs on the session");
    if (session.copying)
      throw new StubError("invalid_params", "a COPY FROM STDIN waits for its data");
  };
  const end = (
    sessionId: string,
    reason: "closed" | "unloaded" | "revoked" | "server",
    error?: DbServerError,
  ) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    session.running?.();
    later({ event: "db.closed", data: { sessionId, reason, ...(error ? { error } : {}) } });
  };
  /** The next page of the open result: rows until it is full, always one. */
  const page = (session: Session, pageRows: number, pageBytes: number): DbPage => {
    const result = session.result;
    if (!result) return { rows: [], more: false };
    const rows: DbValue[][] = [];
    let size = 0;
    while (result.at < result.rows.length && rows.length < pageRows) {
      if (rows.length > 0 && size >= pageBytes) break;
      const row = result.rows[result.at++] ?? [];
      size += row.reduce<number>((sum, value) => sum + bytes(value), 0);
      rows.push(row);
    }
    if (result.at < result.rows.length) return { rows, more: true };
    session.result = undefined;
    const rowCount = result.rows.length;
    return { rows, more: false, tag: result.tag, rowCount, transaction: session.transaction };
  };
  const last = (session: Session, tag: string, extra: Partial<DbPage> = {}): DbPage => ({
    rows: [],
    more: false,
    tag,
    transaction: session.transaction,
    ...extra,
  });
  const failed = (session: Session, error: DbServerError): DbPage => {
    if (session.transaction === "open") session.transaction = "failed";
    return { rows: [], more: false, error, transaction: session.transaction };
  };

  const answer = async (
    session: Session,
    statement: StubStatement,
    pageRows: number,
    pageBytes: number,
  ) => {
    const sessionId = session.info.sessionId;
    for (const notice of statement.afterwards ?? [])
      setTimeout(() => later({ event: "db.notice", data: { sessionId, notice } }), 0);
    const done = await first(session, statement, pageRows, pageBytes);
    return statement.notices?.length ? { ...done, notices: [...statement.notices] } : done;
  };
  const first = async (
    session: Session,
    statement: StubStatement,
    pageRows: number,
    pageBytes: number,
  ): Promise<DbPage> => {
    if (statement.waits) {
      await new Promise<void>((resolve) => {
        session.running = resolve;
      });
      session.running = undefined;
      return failed(session, failure("57014", "canceling statement due to user request"));
    }
    if (statement.error) return failed(session, statement.error);
    const copy = statement.copy;
    if (copy?.direction === "in") {
      session.copying = { lines: 0 };
      return {
        rows: [],
        more: true,
        copy: { direction: "in", format: "text", columns: copy.columns },
      } satisfies DbPage;
    }
    if (copy?.direction === "out") {
      const lines = copy.data.split("\n").filter(Boolean).length;
      const columns = { direction: "out", format: "text", columns: 1 } as const;
      return last(session, `COPY ${lines}`, {
        rowCount: lines,
        copy: columns,
        data: copy.data,
        encoding: "utf8",
      });
    }
    const rows = statement.rows ?? [];
    if (!statement.columns) return last(session, tagOf(statement, rows.length));
    session.result = { rows, at: 0, tag: tagOf(statement, rows.length) };
    return { ...page(session, pageRows, pageBytes), columns: statement.columns };
  };

  const lookup = (session: Session, sql: string) => {
    const matches = (s: StubStatement) =>
      typeof s.sql === "string" ? s.sql === sql : s.sql.test(sql);
    return script?.statements.find(matches) ?? script?.answer?.(sql, session.signed);
  };
  const noAnswer = () => failure("0A000", "the stub's script has no answer for this statement");
  // A cursor's query is answered whole by the script (stub-db-cursor.ts).
  const cursors = stubDbCursors<Session>(async (session, sql) => {
    const statement = lookup(session, sql);
    if (!statement) return { error: noAnswer() };
    const done = await first(session, statement, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (done.error) return { error: done.error };
    return { ...(done.columns ? { columns: done.columns } : {}), rows: done.rows };
  });
  const cursor = async (session: Session, sql: string, pageRows: number, pageBytes: number) => {
    const got = await cursors.answer(session, sql, session.transaction);
    if ("error" in got) return failed(session, got.error);
    const { columns, rows, tag = "", rowCount } = got.page;
    if (!columns) return last(session, tag, rowCount === undefined ? {} : { rowCount });
    session.result = { rows, at: 0, tag };
    return { ...page(session, pageRows, pageBytes), columns };
  };

  /** A statement's answer: the script's, else a transaction's control, pg_terminate_backend's, 0A000. */
  const respond = (session: Session, sql: string, pageRows: number, pageBytes: number) => {
    if (cursors.is(sql)) return cursor(session, sql, pageRows, pageBytes);
    const statement = lookup(session, sql);
    if (statement) return answer(session, statement, pageRows, pageBytes);
    if (isControl(sql)) return last(session, controlTag(sql, session.transaction));
    const pids = [...sessions.values()].map((s) => s.info.pid);
    const ended = terminateAnswer(sql, pids);
    if (ended) return last(session, "SELECT 1", ended);
    return failed(session, noAnswer());
  };

  /** One statement on an idle session, as db.run answers it. */
  const run = async (session: Session, params: DbRunParams): Promise<DbPage> => {
    const { pageRows, pageBytes } = limits(params.pageRows, params.pageBytes);
    session.result = undefined;
    const { sql } = params;
    const before = session.transaction;
    if (before === "failed" && !endsFailed(sql)) return failed(session, IGNORED);
    const done = await respond(session, sql, pageRows, pageBytes);
    // The last page of a statement that succeeded carries the state ReadyForQuery reports.
    if (!done.error && done.transaction) {
      session.transaction = transactionAfter(sql, before);
      done.transaction = session.transaction;
      if (session.transaction === "idle") cursors.ended(session);
      if (before === "failed" && isControl(sql)) done.tag = controlTag(sql, before);
    }
    const pid = terminated(sql);
    for (const [id, other] of [...sessions])
      if (pid !== undefined && !done.error && other.info.pid === pid && id !== params.sessionId)
        end(id, "server", TERMINATED);
    return done;
  };

  const handlers: Required<Pick<StubHandlers, DbServed>> = {
    ...kept.handlers,
    "db.open": (params, caller) => {
      refuseAgents(caller);
      const port = params.port ?? 5432;
      const endpoint = { permission: "db:connect" as const, hosts: [`${params.host}:${port}`] };
      check(caller, params.scope, covers(params.scope, endpoint));
      if (params.engine !== "postgresql")
        throw new StubError("unsupported", `the desk speaks postgresql, not ${params.engine}`);
      const reserved = Object.keys(params.settings ?? {}).find((name) =>
        RESERVED.includes(name.toLowerCase()),
      );
      if (reserved) throw new StubError("invalid_params", `${reserved} is the session's own`);
      const me = caller ?? "desk";
      if ([...sessions.values()].filter((s) => s.caller === me).length >= MAX_SESSIONS)
        throw new StubError(
          "invalid_value",
          `${me} already holds ${MAX_SESSIONS} database sessions`,
        );
      const tls = params.tls;
      if ((tls?.cert === undefined) !== (tls?.key === undefined))
        throw new StubError("invalid_params", "tls.cert and tls.key come together");
      if (tls?.key?.includes("ENCRYPTED") && tls.mode !== "disable") {
        if (!tls.keyPassword) return { keyPassword: "needed" };
        if (tls.keyPassword !== script?.keyPassword) return { keyPassword: "wrong" };
      }
      const password = kept.password(params, caller, port);
      if (!script) throw new StubError("io_error", `cannot connect to ${params.host}:${port}`);
      if (script.password !== undefined && password === undefined) return { needsPassword: true };
      if (script.password !== undefined && password !== script.password) {
        const message = `password authentication failed for user "${params.user}"`;
        return {
          error: { ...failure("28P01", message), severity: "FATAL", localSeverity: "FATAL" },
        };
      }
      const sessionId = `d-${++next}`;
      const pid = 1000 + next;
      const info = {
        sessionId,
        host: params.host,
        port,
        database: params.database,
        user: params.user,
        pid,
      };
      const signed: StubSession = {
        host: params.host,
        port,
        database: params.database,
        user: params.user,
        readOnly: params.readOnly === true,
        settings: { ...params.settings },
        ...(params.tls ? { tls: params.tls } : {}),
      };
      sessions.set(sessionId, {
        caller: me,
        scope: params.scope,
        signed,
        info,
        transaction: "idle",
      });
      owners.set(sessionId, me);
      const secure = params.tls && params.tls.mode !== "disable" && params.tls.mode !== "prefer";
      return {
        sessionId,
        pid,
        auth: script.password === undefined ? "none" : "scram-sha-256",
        ...(secure ? { tls: { version: "TLSv1.3", cipher: "TLS13_AES_256_GCM_SHA384" } } : {}),
        parameters: { server_version: "17.6", client_encoding: "UTF8", ...script.parameters },
      };
    },
    "db.run": (params, caller) => {
      limits(params.pageRows, params.pageBytes);
      const session = mine(caller, params.sessionId);
      idle(session);
      return run(session, params);
    },
    ...stubDbScript({
      idle: (caller, sessionId) => {
        const session = mine(caller, sessionId);
        idle(session);
        return session;
      },
      run,
    }),
    "db.fetch": (params, caller) => {
      const { pageRows, pageBytes } = limits(params.pageRows, params.pageBytes);
      const session = mine(caller, params.sessionId);
      idle(session);
      if (!session.result) throw new StubError("invalid_params", "no result has pages left");
      if (!params.close) return page(session, pageRows, pageBytes);
      session.result = undefined;
      return { rows: [], more: false, transaction: session.transaction };
    },
    "db.copy": (params, caller) => {
      const session = mine(caller, params.sessionId);
      const copying = session.copying;
      if (session.running || !copying)
        throw new StubError("invalid_params", "no COPY FROM STDIN waits for data");
      const data = params.encoding === "base64" ? atob(params.data ?? "") : (params.data ?? "");
      if (data.length > 1024 * 1024)
        throw new StubError("invalid_params", "a chunk is 1 MiB at most");
      copying.lines += data.split("\n").filter(Boolean).length;
      if (params.fail !== undefined) {
        session.copying = undefined;
        return failed(session, failure("57014", `COPY from stdin failed: ${params.fail}`));
      }
      if (!params.done) return { rows: [], more: true };
      session.copying = undefined;
      return last(session, `COPY ${copying.lines}`, { rowCount: copying.lines });
    },
    "db.cancel": (params, caller) => {
      const session = mine(caller, params.sessionId);
      if (session.scripting) session.scripting.cancelled = true;
      session.running?.();
      return {};
    },
    "db.close": (params, caller) => {
      refuseAgents(caller);
      if (sessions.get(params.sessionId)?.caller === (caller ?? "desk"))
        end(params.sessionId, "closed");
      return {};
    },
    "db.list": (_params, caller) => {
      refuseAgents(caller);
      const me = caller ?? "desk";
      const listed = [...sessions.values()].filter((s) => s.caller === me);
      return {
        sessions: listed.map((s) => ({
          ...s.info,
          running: s.running !== undefined || s.scripting !== undefined,
          more: s.result !== undefined || s.copying !== undefined,
          transaction: s.transaction,
        })),
      };
    },
  };

  return {
    handlers,
    /** A db.* event goes to the session's caller alone. */
    audience: (event: BridgeEvent): string[] => {
      if (!event.event.startsWith("db.")) return [];
      const owner = owners.get((event.data as { sessionId: string }).sessionId);
      return owner ? [owner] : [];
    },
    /** The caller stopped (`unloaded`), or, with `keep`, lost the grants of those `keep` refuses. */
    drop: (caller: string, keep?: (scope: DbConnectPermission) => boolean) => {
      for (const [id, session] of [...sessions])
        if (session.caller === caller && !keep?.(session.scope))
          end(id, keep ? "revoked" : "unloaded");
    },
  };
}
