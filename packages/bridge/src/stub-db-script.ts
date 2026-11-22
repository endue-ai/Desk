/**
 * The stub's db.script (ADR 0344): the statements in order, each as the stub's db.run answers
 * one (stub-db.ts), each page with its own notices; it stops after a page with `more`, at the
 * first error unless `goOn`, at a FATAL, and at a db.cancel, which also ends the statement that
 * waits. While it runs the session is busy, as it is in one statement.
 */
import { StubError } from "./adapters";
import type { DbPage, DbRunParams, DbScriptParams, DbScriptResult } from "./generated";
import { limits } from "./stub-db-rules";

/** What a session holds while a script runs: whether a cancel came. */
export interface Scripting {
  cancelled: boolean;
}

export function stubDbScript<S extends { scripting?: Scripting }>(deps: {
  /** The caller's idle session, or the error db.run would throw. */
  idle(caller: string | undefined, sessionId: string): S;
  /** One statement on it, as db.run answers it. */
  run(session: S, params: DbRunParams): Promise<DbPage>;
}) {
  return {
    "db.script": async (
      params: DbScriptParams,
      caller: string | undefined,
    ): Promise<DbScriptResult> => {
      const { pageRows, pageBytes } = limits(params.pageRows, params.pageBytes);
      const session = deps.idle(caller, params.sessionId);
      if (params.statements.length === 0)
        throw new StubError("invalid_params", "db.script takes one statement at least");
      const scripting: Scripting = { cancelled: false };
      session.scripting = scripting;
      const pages: DbPage[] = [];
      try {
        for (const statement of params.statements) {
          if (scripting.cancelled) break;
          const page = await deps.run(session, {
            sessionId: params.sessionId,
            sql: statement.sql,
            pageRows,
            pageBytes,
          });
          pages.push(page);
          const fatal = page.error?.severity === "FATAL";
          if (page.more || fatal || (page.error && !params.goOn)) break;
        }
      } finally {
        session.scripting = undefined;
      }
      return { pages, ...(scripting.cancelled ? { cancelled: true } : {}) };
    },
  };
}
