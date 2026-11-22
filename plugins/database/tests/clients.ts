// The scripted sqlite3 and the scripted PostgreSQL server: what a run would print, in sqlite3's real
// protocol (markers read from the arguments, quote mode), and what a session's db.run would answer
// (the bridge stub's StubDatabase, ADR 0281), from a script that answers each statement. The unit
// tests' harness and the runtime e2e page (packages/runtime/e2e/fixture/database.ts) share them, so
// this file imports nothing the browser cannot load. pg_dump and pg_restore are backup-fixture.ts's.
import type {
  DbColumn,
  DbServerError,
  StubDatabase,
  StubSession,
  StubStatement,
} from "../../../packages/bridge/src/index";
import { programReply } from "./backup-fixture";

/**
 * What a scripted statement gives back: rows (the first is the header; on PostgreSQL a value may be
 * null), changes, or an error; on PostgreSQL also the columns' type OIDs (text by default), their
 * tables of origin (table OID and column number, 0 and 0 by default), the error's fields, notices with the answer (the server's notices, VERBOSE's INFO, as `INFO:  ...`
 * lines), notices the session sends after it (`afterwards`, db.notice events a turn later, ADR 0334),
 * or a statement that runs until it is cancelled.
 */
export interface Answer {
  rows?: (string | null)[][];
  changes?: number;
  error?: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: number;
  types?: number[];
  origins?: [number, number][];
  notices?: string[];
  afterwards?: string[];
  waits?: boolean;
  /** A COPY through standard input or output (the stub's StubStatement.copy, PG-23). */
  copy?: StubStatement["copy"];
  /** The type OIDs db.describe answers for the statement's `$n` (ADR 0353). */
  paramTypes?: number[];
}
/** Who asks: sqlite3's environment, or the session's database, host, port, user and settings. */
/** What a call bound to a statement (ADR 0353): its values and types, `describe` for a check. */
export type Bound = { params?: (string | null)[]; paramTypes?: number[]; describe?: true };

export type Script = (sql: string, who: Record<string, string>, bound?: Bound) => Answer | "auth";

export interface Reply {
  stdout: string;
  stderr: string;
  code: number;
}

/** What `<client> --version` prints. */
export const VERSIONS: Record<string, string> = {
  sqlite3: "3.50.6 2025-09-22 18:50:24 9cc5\n",
  mysql: "mysql  Ver 8.4.13 for Linux on aarch64 (MySQL Community Server - GPL)\n",
};

const quote = (value: string) =>
  /^-?\d+(\.\d+)?$/u.test(value) ? value : `'${value.replaceAll("'", "''")}'`;

/** sqlite3's answer to a run: each statement's rows in quote mode, then its marker's total. */
export function sqliteRun(args: string[], script: Script, env: Record<string, string>): Reply {
  let stdout = "";
  let total = 0;
  for (let i = 0; i < args.length; i++) {
    const marker = /^SELECT total_changes\(\) AS "(.*)"$/u.exec(args[i + 1] ?? "");
    if (!marker) continue;
    const answer = script(args[i] ?? "", env);
    if (answer === "auth") throw new Error("sqlite3 has no passwords");
    if (answer.error) return { stdout, stderr: `Error: in prepare, ${answer.error}\n`, code: 1 };
    for (const row of answer.rows ?? []) stdout += `${row.map((v) => quote(v ?? "")).join(",")}\n`;
    total += answer.changes ?? 0;
    stdout += `'${marker[1]}'\n${total}\n`;
    i++;
  }
  return { stdout, stderr: "", code: 0 };
}

/** What `command` prints for `args`: its version, or the script's answers. */
export function scriptedReply(
  command: string,
  args: string[],
  script: Script,
  env: Record<string, string>,
): Reply {
  const program = programReply(command, args);
  if (program) return program;
  if (args[0] === "--version") return { stdout: VERSIONS[command] ?? "", stderr: "", code: 0 };
  return sqliteRun(args, script, env);
}

const column = (name: string, typeOid = 25, [tableOid, columnNumber] = [0, 0]): DbColumn => ({
  name,
  typeOid,
  typeModifier: -1,
  typeSize: -1,
  tableOid,
  columnNumber,
});
const serverError = (message: string, fields: Partial<DbServerError> = {}): DbServerError => ({
  severity: "ERROR",
  localSeverity: "ERROR",
  code: "",
  message,
  ...fields,
});
/** The command tag a statement ends with: its first word, with the count when there is one. */
const tagOf = (sql: string, changes?: number) => {
  const word = (/^\s*(\w+)/u.exec(sql)?.[1] ?? "").toUpperCase();
  if (changes === undefined) return word;
  return word === "INSERT" ? `INSERT 0 ${changes}` : `${word} ${changes}`;
};

/** A script's answer as the scripted server's statement. */
export function statementOf(sql: string, answer: Answer): StubStatement {
  const notices = noticesOf(answer.notices);
  const afterwards = noticesOf(answer.afterwards);
  const more = {
    ...(notices.length ? { notices } : {}),
    ...(afterwards.length ? { afterwards } : {}),
    ...(answer.paramTypes ? { paramTypes: answer.paramTypes } : {}),
  };
  if (answer.waits) return { sql, waits: true, ...more };
  if (answer.copy) return { sql, copy: answer.copy, ...more };
  if (answer.error) {
    const { code = "", detail, hint, position } = answer;
    const fields = { code, ...(detail ? { detail } : {}), ...(hint ? { hint } : {}) };
    return {
      sql,
      error: serverError(answer.error, { ...fields, ...(position ? { position } : {}) }),
      ...more,
    };
  }
  if (answer.rows) {
    const [head = [], ...rows] = answer.rows;
    const columns = head.map((name, i) =>
      column(name ?? "", answer.types?.[i], answer.origins?.[i]),
    );
    return { sql, columns, rows, ...more };
  }
  return { sql, tag: tagOf(sql, answer.changes), ...more };
}

/** `SEVERITY:  message` lines as the server's notices; a line with no severity goes on the one
 * before it, as a server's message of many lines. */
function noticesOf(lines: string[] = []) {
  const notices: ReturnType<typeof serverError>[] = [];
  for (const text of lines) {
    const [, severity, message = text] = /^([A-Z]+):\s+(.*)$/su.exec(text) ?? [];
    const before = notices.at(-1);
    if (!severity && before) before.message += `\n${text}`;
    else
      notices.push({
        ...serverError(message),
        severity: severity ?? "NOTICE",
        localSeverity: severity ?? "NOTICE",
        code: "00000",
      });
  }
  return notices;
}

/** Who a session is, as a script reads it. */
export const whoOf = (session: StubSession): Record<string, string> => ({
  engine: "postgresql",
  host: session.host,
  port: String(session.port),
  database: session.database,
  user: session.user,
  ...(session.readOnly ? { readOnly: "on" } : {}),
  ...session.settings,
});

/**
 * The scripted PostgreSQL server: every statement answered by `script` on the session it runs on.
 * With `password` a sign-in needs it; a script's "auth" is a refused password.
 */
export function scriptedDb(script: Script, password?: string): StubDatabase {
  return {
    ...(password === undefined ? {} : { password }),
    statements: [],
    answer: (sql, session, bound) => {
      const answer = script(sql, whoOf(session), bound);
      if (answer === "auth")
        return { sql, error: serverError("password authentication failed", { code: "28P01" }) };
      return statementOf(sql, answer);
    },
  };
}
