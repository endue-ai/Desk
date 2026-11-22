// The db:connect question comes from the person's own act (PG-01g, ADR 0335): typing reads a
// PostgreSQL server's catalog for the completions only once the plugin holds the grant (perm.query,
// which asks nothing), so the question never comes up while the person types; the first run asks; a
// refusal says how to ask again; Allow connecting asks again through perm.request with `again`. A
// scripted server (the bridge stub's StubDatabase) stands in for PostgreSQL.
import { describe, expect, it } from "vitest";
import type { StubDatabase } from "../../../packages/bridge/src/index";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { allowConnect, connectHeld, wordRefusals } from "../ui/session/connect-gate.js";
import { fromValues } from "../ui/settings.js";
import { dbBridge } from "./pg-host";
import { PG, run, shop } from "./session-helpers";

const db: StubDatabase = { statements: [{ sql: "select 1", tag: "SELECT 1" }] };
const made = (calls: ReadonlyArray<{ method: string; params?: unknown }>, method: string) =>
  calls.filter((c) => c.method === method).map((c) => (c.params ?? {}) as Record<string, unknown>);

/** The executor over db.* with refusals worded, the person answering each question `granted`. */
function refusing(granted: boolean) {
  const { bridge, calls } = dbBridge(db, { prompt: () => granted });
  const sessions = wordRefusals(createSessions(bridge));
  const settings = fromValues({});
  const unused = async () => {
    throw new Error("PostgreSQL runs no client program");
  };
  const { execute } = createExecutor({
    runner: { run: unused },
    output: { read: unused },
    clients: { get: unused },
    sessions,
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => undefined, set: () => {}, ask: async () => undefined },
    cancelled: (message) => Object.assign(new Error(message), { code: "cancelled" }),
  });
  return { execute, bridge, calls };
}

describe("the db:connect question (PG-01g)", () => {
  it("typing raises no question: completions read a PostgreSQL server only once the grant exists", async () => {
    const m = await shop();
    const typed = "select * from or";
    await m.app.complete(typed, typed.length);
    await m.settle();
    expect(made(m.host.calls, "perm.request")).toEqual([]);
    expect(made(m.host.calls, "db.open")).toEqual([]);

    await run(m, "select 1");
    expect(made(m.host.calls, "perm.request")).toHaveLength(1);
    const opened = made(m.host.calls, "db.open").length;
    await m.app.complete(typed, typed.length);
    await m.settle();
    expect(made(m.host.calls, "db.open").length).toBeGreaterThan(opened);
    expect(made(m.host.calls, "perm.request")).toHaveLength(1);
  });

  it("whether the grant is held is asked without a question", async () => {
    const none = dbBridge(db);
    expect(await connectHeld(none.bridge, PG)).toBe(false);
    const all = dbBridge(db, { grants: [{ permission: "db:connect", hosts: ["*"] }] });
    expect(await connectHeld(all.bridge, PG)).toBe(true);
    expect(made(none.calls, "perm.request")).toEqual([]);
    expect(made(none.calls, "perm.query")).toHaveLength(1);
  });

  it("a refused run says how to ask again", async () => {
    const t = refusing(false);
    const done = await t.execute(PG, "select 1");
    expect(done.result.error?.kind).toBe("refused");
    expect(done.result.error?.message).toBe(
      "Not allowed to connect to db.example:5432. Allow connecting to db.example:5432 asks again (Database: allow connecting).",
    );
  });

  it("Allow connecting asks again through perm.request with again", async () => {
    const t = refusing(true);
    expect(await allowConnect(t.bridge, PG)).toBe(true);
    const asked = made(t.calls, "perm.request");
    expect(asked).toEqual([
      {
        permission: { permission: "db:connect", hosts: ["db.example:5432"] },
        reason: "To run SQL on Shop, a PostgreSQL server",
        again: true,
      },
    ]);
    expect(await connectHeld(t.bridge, PG)).toBe(true);
    const done = await t.execute(PG, "select 1");
    expect(done.result.error).toBeUndefined();
    expect(made(t.calls, "perm.request")).toHaveLength(1);
  });
});
