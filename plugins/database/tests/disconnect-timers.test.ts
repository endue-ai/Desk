// Disconnect stops what the plugin reads on its own (ADR 0339): after it, the activity panel's
// period opens no session and the panel says the connection is disconnected; a read in flight is
// stopped; a refresh by hand connects again. On the scripted PostgreSQL of activity-fixture.ts.
import { describe, expect, it } from "vitest";
import { ACTIVITY_CONNECTION, activityServer } from "./activity-fixture";
import { type Mounted, mount } from "./harness";

const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const opens = (m: Mounted) => m.host.calls.filter((c) => c.method === "db.open").length;

async function start() {
  const server = activityServer();
  let slow = false;
  const m = await mount({
    store: { connections: [ACTIVITY_CONNECTION] },
    script: (sql, who) =>
      slow && /pg_stat_activity/u.test(sql) ? { waits: true } : server.script(sql, who),
  });
  await m.host.command("endue.database.activity", { connection: "warehouse" });
  const id = m.shown()?.id as string;
  const panel = () => m.view.consoles.findLast((c) => c.model?.id === id)?.model?.activity;
  return {
    m,
    id,
    panel,
    slow: (on: boolean) => {
      slow = on;
    },
  };
}

describe("Disconnect and the activity panel's refresh", () => {
  it("opens no session for the panel's period after Disconnect, and says why", async () => {
    const { m, id, panel } = await start();
    await acts(m).activityRefresh?.(id, "timer");
    const before = opens(m);
    await m.host.command("endue.database.disconnect", { connection: "warehouse" });
    await acts(m).activityRefresh?.(id, "timer");
    await m.settle();
    expect(opens(m)).toBe(before);
    expect(panel()?.error).toMatch(/warehouse is disconnected/u);
    expect(panel()?.reading).toBe(false);
  });

  it("reads again when the person refreshes by hand", async () => {
    const { m, id, panel } = await start();
    await m.host.command("endue.database.disconnect", { connection: "warehouse" });
    await acts(m).activityRefresh?.(id, "timer");
    const before = opens(m);
    await acts(m).activityRefresh?.(id);
    await m.settle();
    expect(opens(m)).toBeGreaterThan(before);
    expect(panel()?.error).toBe("");
    // Connected again: the period reads too.
    const after = opens(m);
    await acts(m).activityRefresh?.(id, "timer");
    expect(opens(m)).toBeGreaterThan(after);
  });

  it("stops a read in flight when the connection is disconnected", async () => {
    const { m, id, panel, slow } = await start();
    slow(true);
    const reading = acts(m).activityRefresh?.(id, "timer");
    // Not settled: the read waits on the server until it is cancelled.
    for (let i = 0; i < 200 && !m.host.calls.some((c) => c.method === "db.run"); i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const runs = () => m.host.calls.filter((c) => c.method === "db.run").length;
    const before = runs();
    for (let i = 0; i < 200 && runs() === before; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(panel()?.reading).toBe(true);
    await m.host.command("endue.database.disconnect", { connection: "warehouse" });
    await reading;
    await m.settle();
    // The read's own session: its statement cancelled, then the session closed.
    const methods = m.host.calls.map((c) => c.method);
    const after = methods.slice(methods.lastIndexOf("db.open"));
    expect(after.filter((c) => c === "db.cancel" || c === "db.close")).toEqual([
      "db.cancel",
      "db.close",
    ]);
    expect(panel()?.reading).toBe(false);
  });
});
