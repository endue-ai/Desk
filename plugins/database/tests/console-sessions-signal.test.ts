// A run's own signal (PG-81's, the value search's) on the sessions consoles keep (PG-02, ADR 0320):
// aborting one console's run cancels that run's statement on that console's session alone
// (db.cancel), and the session stays open with its transaction state, so the next run of that
// console goes to it; another console's run goes on. A short session still closes when its run
// ends. A scripted server (the bridge stub's StubDatabase) stands in for PostgreSQL.
import { describe, expect, it } from "vitest";
import type { ExecuteOptions } from "../ui/execute.js";
import { scriptedDb } from "./harness";
import { sessionExecutor } from "./pg-host";
import { PG, script } from "./session-helpers";

const grants = [{ permission: "db:connect" as const, hosts: ["*"] }];
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  expect(ok()).toBe(true);
};
const SLEEP = "select pg_sleep(60)";

function consoles() {
  const t = sessionExecutor(scriptedDb(script), { grants });
  const on = (owner: string, sql: string, more: ExecuteOptions = {}) =>
    t.execute(PG, sql, { session: { owner, kind: "console" }, ...more });
  const idOf = (sql: string, nth = 0) =>
    t.made("db.run").filter((p) => p.sql === sql)[nth]?.sessionId;
  const closes = () => t.made("db.close").map((p) => p.sessionId);
  return { t, on, idOf, closes };
}

describe("a run's own signal on a console's kept session", () => {
  it("cancels only that console's statement and leaves its session open; the other goes on", async () => {
    const { t, on, idOf, closes } = consoles();
    await on("console:a", "select 1");
    await on("console:b", "select 2");
    const a = idOf("select 1");
    const b = idOf("select 2");
    expect(a).not.toBe(b);

    const stopA = new AbortController();
    const stopB = new AbortController();
    const ranA = on("console:a", `${SLEEP};\nselect 3`, { signal: stopA.signal });
    const ranB = on("console:b", SLEEP, { signal: stopB.signal });
    await until(() => t.made("db.run").filter((p) => p.sql === SLEEP).length === 2);
    expect(t.sessions.state("console:a").state).toBe("running");

    stopA.abort();
    const doneA = await ranA;
    expect(doneA.result.statements.map((s) => [s.ran, s.error?.kind])).toEqual([
      [true, "cancelled"],
      [false, undefined],
    ]);
    expect(t.made("db.cancel")).toEqual([{ sessionId: a }]);
    expect(closes()).toEqual([]);
    expect(t.sessions.state("console:a").state).toBe("idle");
    // b still runs on its own session.
    expect(t.sessions.running()).toBe(1);
    expect(t.sessions.state("console:b").state).toBe("running");

    // a's next run goes to the session it keeps.
    await on("console:a", "select 4");
    expect(idOf("select 4")).toBe(a);
    expect(t.made("db.open")).toHaveLength(2);

    stopB.abort();
    expect((await ranB).result.statements[0]?.error?.kind).toBe("cancelled");
    expect(t.made("db.cancel")).toEqual([{ sessionId: a }, { sessionId: b }]);
    expect(closes()).toEqual([]);
    expect(t.sessions.kept().map((k) => k.owner)).toEqual(
      expect.arrayContaining(["console:a", "console:b"]),
    );
  });

  it("keeps the transaction's state: a cancel inside BEGIN leaves it failed until ROLLBACK", async () => {
    const { t, on, idOf, closes } = consoles();
    await on("console:a", "begin");
    const a = idOf("begin");
    expect(t.sessions.state("console:a").state).toBe("open");

    const stop = new AbortController();
    const ran = on("console:a", SLEEP, { signal: stop.signal });
    await until(() => t.made("db.run").some((p) => p.sql === SLEEP));
    stop.abort();
    expect((await ran).result.statements[0]?.error?.kind).toBe("cancelled");
    expect(t.made("db.cancel")).toEqual([{ sessionId: a }]);
    expect(closes()).toEqual([]);
    expect(t.sessions.state("console:a").state).toBe("failed");

    await on("console:a", "rollback");
    expect(idOf("rollback")).toBe(a);
    expect(t.sessions.state("console:a").state).toBe("idle");
  });

  it("a short run's signal cancels its statement and its session closes when the run ends", async () => {
    const { t, on, idOf, closes } = consoles();
    await on("console:a", "select 1");
    const a = idOf("select 1");
    const stop = new AbortController();
    const ran = t.execute(PG, SLEEP, { catalog: true, signal: stop.signal });
    await until(() => t.made("db.run").some((p) => p.sql === SLEEP));
    const short = idOf(SLEEP);
    expect(short).not.toBe(a);
    stop.abort();
    expect((await ran).result.statements[0]?.error?.kind).toBe("cancelled");
    expect(t.made("db.cancel")).toEqual([{ sessionId: short }]);
    expect(closes()).toEqual([short]);
    expect(t.sessions.state("console:a").state).toBe("idle");
  });
});
