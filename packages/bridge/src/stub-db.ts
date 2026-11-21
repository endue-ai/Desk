/**
 * The browser stub's database sessions: db.* (ADR 0281) answered from a script instead of a
 * server, with the core's rules (specs/bridge/v0/README.md): db:connect checked against the host
 * and port, agents refused, postgresql alone, reserved settings and page limits, 16 sessions a
 * caller, sessions their caller's alone, pages whose `more` is exact and whose last page counts
 * every page, one statement at a time, cancel, COPY, and db.closed when the session ends. A
 * password kept with db.passwords.* signs in by `passwordRef` (stub-db-passwords.ts, ADR 0311).
 */
import { StubError, type StubHandlers } from "./adapters";
import type {
  BridgeEvent,
  DbColumn,
  DbConnectPermission,
  DbPage,
  DbServerError,
  DbSessionInfo,
  DbTransaction,
  DbValue,
  Permission,
} from "./generated";
import { covers } from "./stub-covers";
import { type DbPasswordsServed, stubDbPasswords } from "./stub-db-passwords";

export type DbServed =
  | `db.${"open" | "run" | "fetch" | "copy" | "cancel" | "close" | "list"}`
  | DbPasswordsServed;

/** One statement a scripted server answers. */
export interface StubStatement {
  /** The statement it answers: the same text, or the text the pattern matches. */
  sql: string | RegExp;
  columns?: DbColumn[];
  rows?: DbValue[][];
  /** The command tag; `SELECT <rows>` when there are columns, else the first word. */
  tag?: string;
  /** The server's error, which ends the statement. */
  error?: DbServerError;
  /** Notices it raises, as db.notice events, before its answer. */
  notices?: DbServerError[];
  /** It runs until db.cancel, then answers 57014. */
  waits?: boolean;
  /** A COPY: `in` waits for db.copy; `out` answers `data`. */
  copy?: { direction: "in"; columns: number } | { direction: "out"; data: string };
}

/** A scripted database server. */
export interface StubDatabase {
  /** The password the sign-in needs: a wrong one is refused (28P01), none answers needsPassword.
   * Without it every sign-in is let in. */
  password?: string;
  /** What the server reports at the sign-in; server_version and client_encoding by default. */
  parameters?: Record<string, string>;
  statements: StubStatement[];
}

export interface StubDbOptions {
  /** A scripted database server; with it the stub's db.open signs in (stub-db.ts). */
  db?: StubDatabase;
}

/** The stub's grant check: throws permission_denied unless a grant covers `scope` and `fits`. */
type Check = (caller: string | undefined, scope: Permission, fits: boolean) => void;

interface Session {
  caller: string;
  scope: DbConnectPermission;
  info: Omit<DbSessionInfo, "running" | "more" | "transaction">;
  transaction: DbTransaction;
  result?: { rows: DbValue[][]; at: number; tag: string };
  copying?: { lines: number };
  running?: () => void;
}

const MAX_SESSIONS = 16;
const RESERVED = ["client_encoding", "user", "database", "replication"];
const bytes = (value: DbValue) => (value === null ? 0 : new TextEncoder().encode(value).length);
const failure = (code: string, message: string): DbServerError => ({
  severity: "ERROR",
  localSeverity: "ERROR",
  code,
  message,
});

function limits(pageRows = 1000, pageBytes = 4 * 1024 * 1024) {
  if (pageRows < 1 || pageRows > 10_000)
    throw new StubError("invalid_params", "pageRows is 1 to 10000");
  if (pageBytes < 65_536 || pageBytes > 16_777_216)
    throw new StubError("invalid_params", "pageBytes is 65536 to 16777216");
  return { pageRows, pageBytes };
}

function refuseAgents(caller: string | undefined) {
  if (caller?.startsWith("agent:"))
    throw new StubError("permission_denied", "agents reach databases through the plugin");
}

/** The tag a scripted statement ends with. */
function tagOf(statement: StubStatement, rows: number): string {
  if (statement.tag) return statement.tag;
  if (statement.columns) return `SELECT ${rows}`;
  const sql = typeof statement.sql === "string" ? statement.sql : "";
  return (sql.trim().split(/\s+/)[0] ?? "").toUpperCase();
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
    if (session.running) throw new StubError("invalid_params", "a statement runs on the session");
    if (session.copying)
      throw new StubError("invalid_params", "a COPY FROM STDIN waits for its data");
  };
  const end = (sessionId: string, reason: "closed" | "unloaded" | "revoked") => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    session.running?.();
    later({ event: "db.closed", data: { sessionId, reason } });
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
  const last = (session: Session, tag: string, extra: Partial<DbPage> = {}): DbPage => {
    if (/^BEGIN|^START/i.test(tag)) session.transaction = "open";
    if (/^(COMMIT|ROLLBACK|END)/i.test(tag)) session.transaction = "idle";
    return { rows: [], more: false, tag, transaction: session.transaction, ...extra };
  };
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
    for (const notice of statement.notices ?? [])
      later({ event: "db.notice", data: { sessionId: session.info.sessionId, notice } });
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
      sessions.set(sessionId, { caller: me, scope: params.scope, info, transaction: "idle" });
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
      const { pageRows, pageBytes } = limits(params.pageRows, params.pageBytes);
      const session = mine(caller, params.sessionId);
      idle(session);
      session.result = undefined;
      const matches = (s: StubStatement) =>
        typeof s.sql === "string" ? s.sql === params.sql : s.sql.test(params.sql);
      const statement = script?.statements.find(matches);
      if (statement) return answer(session, statement, pageRows, pageBytes);
      if (/^\s*(BEGIN|START|COMMIT|ROLLBACK|END)\b/i.test(params.sql))
        return last(session, (params.sql.trim().split(/\s+/)[0] ?? "").toUpperCase());
      return failed(
        session,
        failure("0A000", "the stub's script has no answer for this statement"),
      );
    },
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
      mine(caller, params.sessionId).running?.();
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
          running: s.running !== undefined,
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
