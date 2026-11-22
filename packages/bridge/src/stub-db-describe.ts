/**
 * The stub's db.describe (ADR 0353): what a scripted statement takes and answers, without running
 * it: its `paramTypes`, its columns (none for a statement without rows), or its error with the
 * position. No rows, no notices, no result left open, and the transaction stays as it is, but a
 * failed one answers 25P02 as the server's Parse does.
 */
import type { DbDescribeParams, DbDescribeResult, DbTransaction } from "./generated";
import { failure } from "./stub-db-rules";
import { IGNORED } from "./stub-db-transaction";
import type { StubSession, StubStatement } from "./stub-db-types";

export function stubDbDescribe<S extends { transaction: DbTransaction; signed: StubSession }>(deps: {
  /** The caller's idle session, its open result closed, or the error db.run would throw. */
  idle(caller: string | undefined, sessionId: string): S;
  /** The script's statement for `sql`, if any. */
  scripted(session: S, sql: string): StubStatement | undefined;
}) {
  return {
    "db.describe": (params: DbDescribeParams, caller: string | undefined): DbDescribeResult => {
      const session = deps.idle(caller, params.sessionId);
      const transaction = session.transaction;
      if (transaction === "failed") return { paramTypes: [], transaction, error: IGNORED };
      const statement = deps.scripted(session, params.sql);
      const error =
        statement?.error ??
        (statement ? undefined : failure("0A000", "the stub's script has no answer for this statement"));
      if (error) {
        if (transaction === "open") session.transaction = "failed";
        return { paramTypes: [], transaction: session.transaction, error };
      }
      const fixed = params.paramTypes ?? [];
      const inferred = statement?.paramTypes ?? [];
      const paramTypes = inferred.map((oid, i) => (fixed[i] ? fixed[i] : oid));
      const columns = statement?.copy ? undefined : statement?.columns;
      return { paramTypes, ...(columns ? { columns } : {}), transaction };
    },
  };
}
