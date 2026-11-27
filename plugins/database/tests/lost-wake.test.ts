// After the computer slept (PG-105, ADR 0355), a kept session is checked before the next run: one
// SELECT 1, five seconds at most. One that answers is used as before; one that does not is closed
// and lost. Outside a transaction the run goes on on a new session; inside one nothing runs, and
// the words say the transaction is gone. Without a sleep nothing is checked.
import { describe, expect, it } from "vitest";
import { createKeeper } from "../ui/session/keeper.js";
import { createSlots } from "../ui/session/slots.js";

const CONN = { id: "c1", name: "Shop" } as never;
const WHO = { owner: "console:1", kind: "console" } as const;

function keeper(probe: "answers" | "fails" | "hangs" = "answers") {
  const clock = { wall: 1_000_000, mono: 1000 };
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const lost: string[] = [];
  const timers: Array<() => void> = [];
  let opened = 0;
  const k = createKeeper({
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method !== "db.run") return {};
      if (probe === "fails")
        throw Object.assign(new Error("connection reset"), { code: "io_error" });
      if (probe === "hangs") return new Promise(() => {});
      return { rows: [["1"]], more: false, transaction: "idle" };
    },
    slots: createSlots(),
    onState: () => {},
    onLost: (_owner: string, line: (label: string) => string) => lost.push(line("Shop")),
    idleMs: () => 0,
    limit: () => 8,
    now: () => clock.wall,
    monotonic: () => clock.mono,
    setTimer: (fn: () => void) => {
      timers.push(fn);
      return fn;
    },
    clearTimer: () => {},
  });
  const open = async () => ({ sessionId: `s${++opened}`, pid: 100 + opened });
  const use = (
    work: (entry: { sessionId: string; transaction: string }, notes: string[]) => unknown = (e) =>
      e.sessionId,
  ) => k.use(WHO, CONN, 0, open, async (entry, notes) => work(entry, notes));
  /** The wall clock moves `wall` ms while the monotonic one moves `mono`. */
  const pass = (wall: number, mono = wall) => {
    clock.wall += wall;
    clock.mono += mono;
  };
  const probes = () => calls.filter((c) => c.method === "db.run").map((c) => c.params.sql);
  return { k, use, pass, calls, probes, lost, timers, opened: () => opened };
}

describe("a kept session after the computer slept", () => {
  it("without a sleep nothing is checked", async () => {
    const t = keeper();
    await t.use();
    t.pass(60 * 60_000);
    expect(await t.use()).toEqual({ done: "s1" });
    expect(t.probes()).toEqual([]);
  });

  it("is checked with one SELECT 1 and used as before when it answers", async () => {
    const t = keeper("answers");
    await t.use();
    t.pass(10 * 60_000, 1000);
    expect(await t.use()).toEqual({ done: "s1" });
    expect(t.probes()).toEqual(["SELECT 1"]);
    // Checked once: the next run after it is not.
    expect(await t.use()).toEqual({ done: "s1" });
    expect(t.probes()).toHaveLength(1);
  });

  it("that does not answer is closed and lost, and an idle one's run goes on on a new session", async () => {
    const t = keeper("fails");
    await t.use();
    t.pass(10 * 60_000, 1000);
    let said: string[] = [];
    const done = await t.use((entry, notes) => {
      said = notes;
      return entry.sessionId;
    });
    expect(done).toEqual({ done: "s2" });
    expect(t.calls.some((c) => c.method === "db.close" && c.params.sessionId === "s1")).toBe(true);
    expect(t.lost.at(-1)).toMatch(
      /Shop: the session was lost \(The session did not answer after the computer slept\)/u,
    );
    expect(said.join("\n")).toMatch(/A new session/u);
    expect(t.k.state("console:1").state).toBe("idle");
  });

  it("that hangs counts as gone after five seconds", async () => {
    const t = keeper("hangs");
    await t.use();
    t.pass(10 * 60_000, 1000);
    const going = t.use();
    await new Promise((resolve) => setTimeout(resolve, 1));
    t.timers.at(-1)?.();
    expect(await going).toEqual({ done: "s2" });
  });

  it("inside a transaction the run does not run, and says the transaction is gone", async () => {
    const t = keeper("fails");
    await t.use((entry) => {
      entry.transaction = "open";
    });
    t.pass(10 * 60_000, 1000);
    let ran = false;
    const done = await t.use(() => {
      ran = true;
    });
    expect(ran).toBe(false);
    expect(done).toMatchObject({
      error: {
        message: expect.stringMatching(
          /computer slept.*rolled back.*nothing of this run ran.*Run again/su,
        ),
      },
    });
    expect(t.opened()).toBe(1);
    expect(t.k.state("console:1").state).toBe("lost");
    // The next run opens a new session.
    expect(await t.use()).toEqual({ done: "s2" });
  });
});
