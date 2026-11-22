// The statements a plugin sent its sessions, as db.run calls: a db.script batch (ADR 0344) counts
// as one db.run for each statement it carried, in order, so a test reads what was sent to which
// session whichever way it went. A batch stops at an error: the statements after it were sent, not
// run.
type Call = { method: string; params?: unknown };

export function runsOf<C extends Call>(calls: readonly C[]): C[] {
  return calls.flatMap((call) => {
    if (call.method !== "db.script") return [call];
    const { statements, ...rest } = call.params as { statements: { sql: string }[] };
    return statements.map((s) => ({ ...call, method: "db.run", params: { ...rest, sql: s.sql } }));
  });
}
