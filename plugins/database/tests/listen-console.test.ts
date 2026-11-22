// A console that listens (PG-25, ADR 0358) on the scripted server: after LISTEN, a NOTIFY from
// another console shows on its Notifications tab (when, channel, payload, the sender's pid) with a
// badge of the unseen ones, which the tab on screen clears; Clear empties it and Export exports it;
// UNLISTEN stops it; a lost session says it stopped listening and is not made to listen again
// on its own, Listen again does it; an agent's LISTEN does not run; the keeper's idle timer leaves a
// listening session open; a burst keeps the latest 1,000 and says how many were dropped.
import { describe, expect, it } from "vitest";
import { createKeeper } from "../ui/session/keeper.js";
import { createSlots } from "../ui/session/slots.js";
import type { Mounted } from "./harness";
import { run, sessionOf, shop } from "./session-helpers";

const granted = { "perm.query": () => ({ grants: [{ permission: "db:connect" }] }) as never };
const until = async (test: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const tabs = (m: Mounted) => m.shown()?.shown?.tabs ?? [];
const notifications = (m: Mounted) => tabs(m).find((t) => t.kind === "notifications");
const rows = (m: Mounted) => notifications(m)?.set?.rows ?? [];
const go = (m: Mounted, name: string) =>
  m.host.command("endue.database.consoles", { console: name });
/** Draw the console on screen again, after the plugin's 100 ms coalescing. */
const drawn = async (m: Mounted) => {
  await new Promise((resolve) => setTimeout(resolve, 130));
  await m.settle();
};

async function two() {
  const m = await shop({ handlers: granted });
  await run(m, "LISTEN jobs");
  await m.host.command("endue.database.new-console", { connection: "Shop" });
  return m;
}

describe("a console that listens", () => {
  it("shows another console's NOTIFY on its Notifications tab, with a badge until the tab is on screen", async () => {
    const m = await two();
    await run(m, "NOTIFY jobs, 'order 7 paid'");
    await go(m, "Shop");
    await drawn(m);
    const tab = notifications(m);
    expect(tab?.label).toBe("Notifications · 1 new");
    expect(tab?.set?.columns).toEqual(["received", "channel", "payload", "pid"]);
    const [row] = rows(m);
    expect(row?.slice(1, 3)).toEqual(["jobs", "order 7 paid"]);
    expect(row?.[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/u);
    expect(Number(row?.[3])).toBeGreaterThan(1000);
    expect(tab?.note).toBe("Listening on jobs.");

    m.app.tab(tabs(m).indexOf(tab as never));
    await m.settle();
    expect(notifications(m)?.label).toBe("Notifications");
    m.app.tab(0);
    await m.settle();
    expect(notifications(m)?.label).toBe("Notifications");
  });

  it("Clear empties it, Export exports it as a result, and UNLISTEN stops it", async () => {
    const m = await two();
    await run(m, "NOTIFY jobs, 'one'");
    await go(m, "Shop");
    await drawn(m);
    expect(rows(m)).toHaveLength(1);
    await m.host.command("endue.database.clear-notifications");
    await m.settle();
    expect(rows(m)).toEqual([]);
    await run(m, "UNLISTEN jobs");
    await go(m, "Shop 2");
    await run(m, "NOTIFY jobs, 'two'");
    await go(m, "Shop");
    await drawn(m);
    expect(notifications(m)).toBeUndefined();
    await run(m, "LISTEN jobs; NOTIFY jobs, 'mine'");
    await drawn(m);
    expect(rows(m).map((r) => r[2])).toEqual(["mine"]);
    const exported = await m.host
      .command("endue.database.export-notifications")
      .catch((e: Error) => e.message);
    expect(m.shown()?.shown?.tabs[m.shown()?.tab ?? -1]?.kind).toBe("notifications");
    expect(String(exported)).not.toMatch(/No result here/u);
  });

  it("a lost session says it stopped listening, nothing listens again on its own, Listen again does", async () => {
    const m = await shop({ handlers: granted });
    await run(m, "LISTEN jobs; LISTEN orders");
    const first = sessionOf(m, "LISTEN jobs");
    m.host.emit({
      event: "db.closed",
      data: { sessionId: first ?? "", reason: "io", message: "reset" },
    });
    await m.settle();
    expect(m.view.said.at(-1)).toMatch(/stopped listening on jobs, orders: Listen again/u);
    await until(() => m.shown()?.session?.state === "idle");
    await drawn(m);
    expect(
      m.host.calls
        .filter((c) => c.method === "db.run")
        .map((c) => (c.params as { sql: string }).sql),
    ).not.toContain('LISTEN "jobs"');
    expect(notifications(m)).toMatchObject({ stopped: true });
    expect(notifications(m)?.note).toMatch(
      /^Stopped listening on jobs, orders: the session ended/u,
    );
    await m.host.command("endue.database.listen-again");
    await m.settle();
    const again = m.host.calls
      .filter((c) => c.method === "db.run" || c.method === "db.script")
      .map((c) => JSON.stringify(c.params));
    expect(again.join("\n")).toMatch(/LISTEN \\"jobs\\"/u);
    await drawn(m);
    expect(notifications(m)).toMatchObject({ stopped: false, note: "Listening on jobs, orders." });
  });

  it("an agent's run that LISTENs does not run", async () => {
    const m = await shop({ handlers: granted });
    const said = await m.host
      .command("endue.database.query", { connection: "Shop", sql: "LISTEN jobs" })
      .then(JSON.stringify, (e: Error) => e.message);
    expect(said).toMatch(/Nothing listens on an agent's behalf/u);
    expect(
      m.host.calls.some(
        (c) =>
          JSON.stringify(c.params ?? {}).includes("LISTEN jobs") && c.method.startsWith("db.run"),
      ),
    ).toBe(false);
  });

  it("the idle timer leaves a listening console's session open", async () => {
    const timers: Array<() => void> = [];
    const calls: string[] = [];
    let listening = true;
    let now = 0;
    const keeper = createKeeper({
      call: async (method: string) => void calls.push(method),
      slots: createSlots(),
      onState: () => {},
      onLost: () => {},
      idleMs: () => 1000,
      limit: () => 8,
      now: () => now,
      monotonic: () => now,
      setTimer: (fn: () => void) => timers.push(fn),
      clearTimer: () => {},
      holds: () => listening,
    });
    const conn = { id: "c-pg", name: "Shop" } as never;
    await keeper.use(
      { owner: "console:a", kind: "console" },
      conn,
      0,
      async () => ({ sessionId: "d-1", pid: 1 }),
      async () => undefined,
    );
    now = 5000;
    timers.shift()?.();
    expect(calls).toEqual([]);
    listening = false;
    now = 10_000;
    timers.shift()?.();
    expect(calls).toEqual(["db.close"]);
  });

  it("a burst of 5,000 keeps the latest 1,000 and says how many were dropped", async () => {
    const m = await shop({ handlers: granted });
    await run(m, "LISTEN jobs");
    const sessionId = sessionOf(m, "LISTEN jobs") ?? "";
    for (let i = 0; i < 5000; i++)
      m.host.emit({
        event: "db.notification",
        data: { sessionId, pid: 9, channel: "jobs", payload: String(i) },
      });
    await drawn(m);
    expect(rows(m)).toHaveLength(1000);
    expect(rows(m)[0]?.[2]).toBe("4000");
    expect(notifications(m)?.note).toBe(
      "Listening on jobs. Keeps the latest 1,000: 4,000 older dropped.",
    );
  });
});
