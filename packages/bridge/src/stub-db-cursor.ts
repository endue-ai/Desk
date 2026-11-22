/**
 * The stub's cursors, as a PostgreSQL server keeps them (stub-db.ts): `DECLARE name [SCROLL]
 * CURSOR FOR <query>` answers the query from the script and keeps its rows, which `FETCH [FORWARD]
 * n FROM name`, `MOVE ABSOLUTE n IN name`, `MOVE FORWARD ALL IN name` and `CLOSE name` read and
 * move through. DECLARE outside a transaction block is 25P01, a name not declared 34000; the end
 * of the transaction drops every cursor. An error of the query is DECLARE's, its position counted
 * in the DECLARE's text, as the server counts it.
 */
import type { DbColumn, DbPage, DbServerError, DbTransaction, DbValue } from "./generated";
import { failure } from "./stub-db-rules";

interface Cursor {
  columns?: DbColumn[];
  rows: DbValue[][];
  /** Rows before the cursor: 0 before the first, rows.length + 1 after the last. */
  at: number;
}

/** What a cursor statement answers: the page, or a failure to answer as the session's error. */
type Answered = { page: DbPage } | { error: DbServerError };

const DECLARE =
  /^\s*DECLARE\s+("?)(\w+)\1\s+(?:(?:NO\s+)?SCROLL\s+|BINARY\s+|INSENSITIVE\s+|ASENSITIVE\s+)*CURSOR\s+(?:(?:WITH|WITHOUT)\s+HOLD\s+)?FOR\s/iu;
const FETCH =
  /^\s*(FETCH|MOVE)\s+(?:(FORWARD|ABSOLUTE)\s+)?(ALL|\d+)?\s*(?:FROM|IN)\s+("?)(\w+)\4\s*;?\s*$/iu;
const CLOSE = /^\s*CLOSE\s+("?)(\w+)\1\s*;?\s*$/iu;

export function stubDbCursors<S extends object>(
  /** The script's whole answer to a query on `session`: its columns and every row, or its error. */
  query: (
    session: S,
    sql: string,
  ) => Promise<{ columns?: DbColumn[]; rows: DbValue[][] } | { error: DbServerError }>,
) {
  const held = new WeakMap<S, Map<string, Cursor>>();
  const of = (session: S) => {
    const cursors = held.get(session) ?? new Map<string, Cursor>();
    held.set(session, cursors);
    return cursors;
  };

  const missing = (name: string) => ({
    error: failure("34000", `cursor "${name}" does not exist`),
  });

  return {
    /** Whether `sql` is a cursor statement the stub answers itself. */
    is: (sql: string) => DECLARE.test(sql) || FETCH.test(sql) || CLOSE.test(sql),
    /** Answer a cursor statement on `session` in `transaction`. */
    async answer(session: S, sql: string, transaction: DbTransaction): Promise<Answered> {
      const cursors = of(session);
      const declared = DECLARE.exec(sql);
      if (declared) {
        const name = (declared[2] ?? "").toLowerCase();
        if (transaction !== "open")
          return {
            error: failure("25P01", "DECLARE CURSOR can only be used in transaction blocks"),
          };
        if (cursors.has(name))
          return { error: failure("42P03", `cursor "${name}" already exists`) };
        const prefix = declared[0].length;
        const got = await query(session, sql.slice(prefix));
        if ("error" in got) {
          const at = got.error.position;
          const error = at ? { ...got.error, position: at + prefix } : got.error;
          return { error };
        }
        cursors.set(name, {
          ...(got.columns ? { columns: got.columns } : {}),
          rows: got.rows,
          at: 0,
        });
        return { page: { rows: [], more: false, tag: "DECLARE CURSOR" } };
      }
      const closed = CLOSE.exec(sql);
      if (closed) {
        const name = (closed[2] ?? "").toLowerCase();
        if (!cursors.delete(name)) return missing(name);
        return { page: { rows: [], more: false, tag: "CLOSE CURSOR" } };
      }
      const [, verb = "", how = "FORWARD", count = "1", , named = ""] = FETCH.exec(sql) ?? [];
      const name = named.toLowerCase();
      const cursor = cursors.get(name);
      if (!cursor) return missing(name);
      const total = cursor.rows.length;
      const fetch = verb.toUpperCase() === "FETCH";
      if (how.toUpperCase() === "ABSOLUTE") {
        const to = Math.min(Number(count), total + 1);
        cursor.at = to;
        const row = to >= 1 && to <= total ? [cursor.rows[to - 1] ?? []] : [];
        return { page: page(fetch, cursor, fetch ? row : [], row.length) };
      }
      const from = Math.min(cursor.at, total);
      const want = count.toUpperCase() === "ALL" ? total : Number(count);
      const rows = cursor.rows.slice(from, from + want);
      cursor.at = from + rows.length + (from + want > total ? 1 : 0);
      return { page: page(fetch, cursor, fetch ? rows : [], rows.length) };
    },
    /** The transaction ended: its cursors go. */
    ended: (session: S) => held.delete(session),
  };
}

function page(fetch: boolean, cursor: Cursor, rows: DbValue[][], count: number): DbPage {
  const tag = `${fetch ? "FETCH" : "MOVE"} ${count}`;
  if (!fetch || !cursor.columns) return { rows: [], more: false, tag, rowCount: count };
  return { columns: cursor.columns, rows, more: false, tag, rowCount: count };
}
