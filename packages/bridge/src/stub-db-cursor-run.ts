/**
 * The stub's cursor statements as db.run answers them (stub-db.ts, stub-db-cursor.ts): DECLARE's
 * query is answered whole by the script, with the values bound to DECLARE, and a FETCH's rows are
 * paged as any statement's are.
 */
import type { DbPage, DbServerError, DbTransaction, DbValue } from "./generated";
import { stubDbCursors } from "./stub-db-cursor";
import { failure } from "./stub-db-rules";
import type { StubStatement } from "./stub-db-types";

interface Host<S, B> {
  scripted(session: S, sql: string, bound?: B): StubStatement | undefined;
  first(session: S, statement: StubStatement, pageRows: number, pageBytes: number): Promise<DbPage>;
  failed(session: S, error: DbServerError): DbPage;
  last(session: S, tag: string, extra?: Partial<DbPage>): DbPage;
  page(session: S, pageRows: number, pageBytes: number): DbPage;
}

export function stubDbCursorRun<
  S extends { transaction: DbTransaction; result?: { rows: DbValue[][]; at: number; tag: string } },
  B,
>(host: Host<S, B>) {
  const all = Number.MAX_SAFE_INTEGER;
  const cursors = stubDbCursors<S, B>(async (session, sql, bound) => {
    const statement = host.scripted(session, sql, bound);
    if (!statement)
      return { error: failure("0A000", "the stub's script has no answer for this statement") };
    const done = await host.first(session, statement, all, all);
    if (done.error) return { error: done.error };
    return { ...(done.columns ? { columns: done.columns } : {}), rows: done.rows };
  });
  return {
    is: cursors.is,
    ended: cursors.ended,
    /** A cursor statement's answer on `session`, as db.run's first page. */
    async respond(session: S, sql: string, pageRows: number, pageBytes: number, bound?: B) {
      const got = await cursors.answer(session, sql, session.transaction, bound);
      if ("error" in got) return host.failed(session, got.error);
      const { columns, rows, tag = "", rowCount } = got.page;
      if (!columns) return host.last(session, tag, rowCount === undefined ? {} : { rowCount });
      session.result = { rows, at: 0, tag };
      return { ...host.page(session, pageRows, pageBytes), columns };
    },
  };
}
