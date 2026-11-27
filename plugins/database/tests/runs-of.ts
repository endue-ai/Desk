// The statements a plugin sent its sessions, as db.run calls: a db.script batch (ADR 0344) counts
// as one db.run for each statement it carried, in order, so a test reads what was sent to which
// session whichever way it went. A batch stops at an error: the statements after it were sent, not
// run. A console's read through a cursor (PG-22, ADR 0352) counts as the read itself: its DECLARE as
// the statement it declares, and the statements the cursor adds (START TRANSACTION, FETCH, MOVE,
// CLOSE, END and ABORT) are left out; rawRunsOf keeps them.
type Call = { method: string; params?: unknown };

const PREFIX = "DECLARE endue_desk_rows SCROLL CURSOR FOR\n";
const OWN =
  /^(START TRANSACTION|END|ABORT|(FETCH|MOVE) .* (FROM|IN) endue_desk_rows|CLOSE endue_desk_rows)$/u;

export function rawRunsOf<C extends Call>(calls: readonly C[]): C[] {
  return calls.flatMap((call) => {
    if (call.method !== "db.script") return [call];
    const { statements, ...rest } = call.params as { statements: { sql: string }[] };
    return statements.map((s) => ({ ...call, method: "db.run", params: { ...rest, sql: s.sql } }));
  });
}

export function runsOf<C extends Call>(calls: readonly C[]): C[] {
  return rawRunsOf(calls).flatMap((call) => {
    const sql = (call.params as { sql?: unknown } | undefined)?.sql;
    if (call.method !== "db.run" || typeof sql !== "string") return [call];
    if (OWN.test(sql)) return [];
    if (!sql.startsWith(PREFIX)) return [call];
    return [{ ...call, params: { ...(call.params as object), sql: sql.slice(PREFIX.length) } }];
  });
}
