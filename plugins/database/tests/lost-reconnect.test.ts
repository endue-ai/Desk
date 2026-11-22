// A lost session comes back (PG-105, ADR 0355): a console's session lost while idle is opened again
// on its own, 1 s, 2 s, 4 s ... apart (eight tries, at most 30 s apart), only while the plugin holds
// the server's grant, so nothing asks; one lost inside a transaction, a revoked grant or the plugin
// stopping waits for the person: Reconnect (the header's button, a command) or the next run.
import { describe, expect, it } from "vitest";
import { BACKOFF_MS, createReconnect } from "../ui/session/reconnect.js";
import type { Gone } from "../ui/session/words.js";
import { run, sessionOf, shop, state } from "./session-helpers";

type Attempt = { error?: { kind: string; message: string }; notices: string[] };

function fake(answers: Attempt[] = [], allowed = true) {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const tried: boolean[] = [];
  const said: string[] = [];
  let lost = true;
  const reconnect = createReconnect({
    attempt: async (_owner: string, auto: boolean) => {
      tried.push(auto);
      const answer = answers.shift() ?? { notices: [] };
      if (!answer.error) lost = false;
      return answer;
    },
    may: async () => allowed,
    lost: () => lost,
    say: (_owner: string, line: (label: string) => string) => said.push(line("Shop")),
    onState: () => {},
    setTimer: (fn: () => void, ms: number) => {
      const timer = { fn, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer: unknown) => {
      if (timer) (timer as { live: boolean }).live = false;
    },
  });
  /** Fire the next live timer and let its attempt finish. */
  const fire = async () => {
    const next = timers.find((t) => t.live);
    if (!next) return undefined;
    next.live = false;
    next.fn();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return next.ms;
  };
  return { reconnect, timers, tried, said, fire, live: () => timers.filter((t) => t.live) };
}

const gone = (over: Partial<Gone> = {}): Gone => ({
  why: "The network to the server failed",
  transaction: "idle",
  lost: true,
  reason: "io",
  ...over,
});
const down = { error: { kind: "connect", message: "Could not connect" }, notices: [] };
const lostModel = {
  state: "lost",
  label: "Session lost",
  tone: "danger",
  detail: "Lost.",
} as const;

describe("a lost session comes back", () => {
  it("an idle console's session is tried again on its own with a backoff, then waits for the person", async () => {
    const t = fake(Array.from({ length: 8 }, () => down));
    t.reconnect.lost("console:1", "console", gone());
    const waits: Array<number | undefined> = [];
    for (let i = 0; i < 9; i++) waits.push(await t.fire());
    expect(waits).toEqual([...BACKOFF_MS, undefined]);
    expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(t.tried).toEqual(Array(8).fill(true));
    const model = t.reconnect.model("console:1", lostModel);
    expect(model.retry).toMatchObject({ automatic: true, tries: 8, max: 8 });
    expect(model.detail).toMatch(/Not connecting again on its own.*Reconnect or the next run/su);
  });

  it("a try that connects says so and stops", async () => {
    const t = fake([down, { notices: ["A new session: ..."] }]);
    t.reconnect.lost("console:1", "console", gone());
    expect(t.reconnect.model("console:1", lostModel).detail).toMatch(/try 1 of 8/u);
    await t.fire();
    expect(t.reconnect.model("console:1", lostModel).detail).toMatch(/try 2 of 8/u);
    await t.fire();
    expect(t.live()).toHaveLength(0);
    expect(t.said.at(-1)).toMatch(
      /^Shop: connected again on a new session \(try 2\).*nothing was run again/su,
    );
  });

  it("a session lost in a transaction, a table view's, a revoked grant, the plugin stopping are not tried on their own", () => {
    for (const [kind, over] of [
      ["console", { transaction: "open" }],
      ["console", { transaction: "failed" }],
      ["table", {}],
      ["console", { reason: "revoked" }],
      ["console", { reason: "unloaded" }],
      ["console", { reason: "desk" }],
    ] as const) {
      const t = fake();
      t.reconnect.lost("o", kind, gone(over));
      expect(t.timers).toHaveLength(0);
      const model = t.reconnect.model("o", lostModel);
      expect(model.retry?.automatic).toBe(false);
      expect(model.detail).toMatch(/Reconnect or the next run opens a new one/u);
    }
  });

  it("without the grant held nothing is tried, so nothing asks", async () => {
    const t = fake([], false);
    t.reconnect.lost("console:1", "console", gone());
    await t.fire();
    expect(t.tried).toEqual([]);
    expect(t.reconnect.model("console:1", lostModel).detail).toMatch(/would ask/u);
  });

  it("a refused sign-in stops the tries", async () => {
    const t = fake([
      { error: { kind: "auth", message: "password authentication failed" }, notices: [] },
    ]);
    t.reconnect.lost("console:1", "console", gone());
    await t.fire();
    expect(t.live()).toHaveLength(0);
    expect(t.reconnect.model("console:1", lostModel).detail).toMatch(
      /password authentication failed/u,
    );
  });

  it("Reconnect tries at once, as the person's act, and the waiting try is dropped", async () => {
    const t = fake([{ notices: [] }]);
    t.reconnect.lost("console:1", "console", gone());
    expect(t.live()).toHaveLength(1);
    await expect(t.reconnect.now("console:1")).resolves.toMatch(
      /^Shop: connected on a new session/u,
    );
    expect(t.tried).toEqual([false]);
    expect(t.live()).toHaveLength(0);
  });

  it("Reconnect that fails says why", async () => {
    const t = fake([down]);
    t.reconnect.lost("console:1", "console", gone({ transaction: "open" }));
    await expect(t.reconnect.now("console:1")).rejects.toThrow(/Could not connect/u);
  });
});

describe("a lost session comes back in the plugin", () => {
  const until = async (test: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!test()) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const granted = { "perm.query": () => ({ grants: [{ permission: "db:connect" }] }) };

  it("an idle console's session the network dropped opens again on its own", async () => {
    const m = await shop({ handlers: granted });
    await run(m, "select 1");
    const first = sessionOf(m, "select 1");
    m.host.emit({
      event: "db.closed",
      data: { sessionId: first ?? "", reason: "io", message: "connection reset by peer" },
    });
    await m.settle();
    expect(state(m)).toBe("lost");
    expect(m.shown()?.session?.detail).toMatch(/try 1 of 8/u);
    await until(() => state(m) === "idle");
    expect(m.shown()?.session?.pid).toBeGreaterThan(0);
    expect(m.view.said.at(-1)).toMatch(/connected again on a new session \(try 1\)/u);
    await run(m, "select 2");
    expect(sessionOf(m, "select 2")).not.toBe(first);
  });

  it("keeps the console's text and the result on screen while the session is lost", async () => {
    const m = await shop();
    await run(m, "select * from seen");
    const rows = () => m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows;
    expect(rows()).toEqual([["1"]]);
    const typed = "select * from seen;\n-- not run yet\nselect 42";
    m.view.text = typed;
    m.app.edited(typed);
    m.host.emit({
      event: "db.closed",
      data: { sessionId: sessionOf(m, "select * from seen") ?? "", reason: "io", message: "reset" },
    });
    await m.settle();
    expect(state(m)).toBe("lost");
    expect(m.shown()?.text).toBe(typed);
    expect(m.view.text).toBe(typed);
    expect(rows()).toEqual([["1"]]);
  });

  it("a session lost in a transaction waits for Reconnect, which opens a new one", async () => {
    const m = await shop({ handlers: granted });
    await run(m, "begin");
    m.host.emit({
      event: "db.closed",
      data: { sessionId: sessionOf(m, "begin") ?? "", reason: "server" },
    });
    await m.settle();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(state(m)).toBe("lost");
    await m.host.command("endue.database.reconnect");
    await m.settle();
    expect(state(m)).toBe("idle");
    expect(m.view.said.at(-1)).toMatch(/connected on a new session/u);
  });
});
