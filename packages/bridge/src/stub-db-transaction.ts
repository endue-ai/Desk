/**
 * What the stub's sessions do with a transaction, as a PostgreSQL server does (stub-db.ts): the state
 * ReadyForQuery reports after a statement that succeeded (BEGIN opens, a savepoint and ROLLBACK TO
 * keep it open, COMMIT, END and ROLLBACK end it), which statements a failed transaction still takes
 * (only the ones that end it or roll back to a savepoint; COMMIT then answers ROLLBACK), and the
 * backend a `pg_terminate_backend(pid)` names, which ends that session with the server's FATAL.
 */
import type { DbPage, DbServerError, DbTransaction } from "./generated";

const words = (sql: string) => sql.trim().toUpperCase().split(/\s+/);

/** The transaction state after `sql` succeeded on a session in `before`. */
export function transactionAfter(sql: string, before: DbTransaction): DbTransaction {
  const [first, second] = words(sql);
  if (first === "BEGIN" || first === "START") return "open";
  if ((first === "ROLLBACK" || first === "ABORT") && second === "TO") return "open";
  if (first === "COMMIT" || first === "END" || first === "ROLLBACK" || first === "ABORT")
    return "idle";
  return before;
}

/** Whether a failed transaction takes `sql`: ROLLBACK, ROLLBACK TO, COMMIT and END. */
export const endsFailed = (sql: string) =>
  ["ROLLBACK", "ABORT", "COMMIT", "END"].includes(words(sql)[0] ?? "");

/** The tag a transaction control statement ends with: COMMIT of a failed transaction rolls it back. */
export function controlTag(sql: string, before: DbTransaction): string {
  const first = words(sql)[0] ?? "";
  if (before === "failed" && (first === "COMMIT" || first === "END")) return "ROLLBACK";
  return first;
}

/** Whether `sql` is a statement the stub answers itself when its script has none. */
export const isControl = (sql: string) =>
  /^\s*(BEGIN|START|COMMIT|ROLLBACK|ABORT|END|SAVEPOINT|RELEASE)\b/iu.test(sql);

/** The process id `pg_terminate_backend(<pid>)` names, if `sql` is one. */
export function terminated(sql: string): number | undefined {
  const pid = /pg_terminate_backend\(\s*(\d+)\s*[,)]/iu.exec(sql)?.[1];
  return pid === undefined ? undefined : Number(pid);
}

/** pg_terminate_backend's answer: true when a session had that process id. */
export const terminateAnswer = (found: boolean): Partial<DbPage> => ({
  columns: [
    {
      name: "pg_terminate_backend",
      typeOid: 16,
      typeModifier: -1,
      typeSize: 1,
      tableOid: 0,
      columnNumber: 0,
    },
  ],
  rows: [[found ? "t" : "f"]],
  rowCount: 1,
});

/** The error a failed transaction answers for every other statement. */
export const IGNORED: DbServerError = {
  severity: "ERROR",
  localSeverity: "ERROR",
  code: "25P02",
  message: "current transaction is aborted, commands ignored until end of transaction block",
};

/** The FATAL a session ended by pg_terminate_backend hears. */
export const TERMINATED: DbServerError = {
  severity: "FATAL",
  localSeverity: "FATAL",
  code: "57P01",
  message: "terminating connection due to administrator command",
};
