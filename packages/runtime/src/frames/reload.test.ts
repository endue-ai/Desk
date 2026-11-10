// A plugin frame's reload waits for its answer to a ping (`reload.ts`): the model alone, on a fake
// desk window and manual timers. The runtime with it is `reload-desk.test.ts`.
import { describe, expect, it } from "vitest";
import type { FrameTimers } from "./policy";
import { DRAIN_MS, frameReloads } from "./reload";

/** Timers that run only when the test moves time on. */
function manualTimers() {
  let now = 0;
  const due = new Map<number, { at: number; run(): void }>();
  let next = 0;
  const timers: FrameTimers = {
    now: () => now,
    after: (ms, run) => {
      const handle = next++;
      due.set(handle, { at: now + ms, run });
      return () => due.delete(handle);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [handle, timer] of [...due]) {
      if (timer.at > now) continue;
      due.delete(handle);
      timer.run();
    }
  };
  return { timers, advance };
}

/** A frame's window: what the desk posted to it. */
function frameWindow() {
  const posted: Array<{ type: string; n: number }> = [];
  const win = { postMessage: (m: { type: string; n: number }) => void posted.push(m) };
  return { win: win as unknown as Window, posted };
}

function setup(live: Record<string, Window | null>) {
  const desk = new EventTarget();
  const { timers, advance } = manualTimers();
  const loads: Array<[string, string]> = [];
  const reloads = frameReloads({
    win: desk as unknown as Window,
    timers,
    live: (id) => live[id] ?? null,
    load: (id, src) => void loads.push([id, src]),
  });
  /** A message reaches the desk from `source`. */
  const from = (source: unknown, data: unknown) =>
    desk.dispatchEvent(Object.assign(new Event("message"), { data, source }));
  return { reloads, loads, advance, from };
}

describe("frameReloads", () => {
  it("pings a live frame and loads once its own pong for that ping is in, not before", () => {
    const a = frameWindow();
    const { reloads, loads, from } = setup({ "a.one": a.win });
    reloads.reload("a.one", "v=2");
    expect(a.posted).toHaveLength(1);
    const [ping] = a.posted;
    expect(ping?.type).toBe("desk:ping");
    // The watch's pings count up from 1; this one never shares a number with them.
    expect(ping?.n).toBeLessThan(0);
    expect(loads).toEqual([]);
    from(a.win, { type: "desk:pong", n: ping?.n });
    expect(loads).toEqual([["a.one", "v=2"]]);
    // A late duplicate loads nothing more.
    from(a.win, { type: "desk:pong", n: ping?.n });
    expect(loads).toHaveLength(1);
  });

  it("takes no answer from another frame, from nobody, or to another ping (ADR 0012)", () => {
    const [a, b] = [frameWindow(), frameWindow()];
    const { reloads, loads, from } = setup({ "a.one": a.win, "b.two": b.win });
    reloads.reload("a.one", "v=2");
    const n = a.posted[0]?.n;
    from(b.win, { type: "desk:pong", n });
    from(null, { type: "desk:pong", n });
    from(a.win, { type: "desk:pong", n: 1 });
    from(a.win, { type: "desk:state", n });
    expect(loads).toEqual([]);
    from(a.win, { type: "desk:pong", n });
    expect(loads).toEqual([["a.one", "v=2"]]);
  });

  it("loads a frame that does not answer after DRAIN_MS all the same", () => {
    const a = frameWindow();
    const { reloads, loads, advance } = setup({ "a.one": a.win });
    reloads.reload("a.one", "v=2");
    advance(DRAIN_MS - 1);
    expect(loads).toEqual([]);
    advance(1);
    expect(loads).toEqual([["a.one", "v=2"]]);
    expect(DRAIN_MS).toBeLessThanOrEqual(500);
  });

  it("loads once, with the latest source, for updates that come while it waits", () => {
    const a = frameWindow();
    const { reloads, loads, from } = setup({ "a.one": a.win });
    reloads.reload("a.one", "v=2");
    reloads.reload("a.one", "v=3");
    expect(a.posted).toHaveLength(1);
    from(a.win, { type: "desk:pong", n: a.posted[0]?.n });
    expect(loads).toEqual([["a.one", "v=3"]]);
  });

  it("loads at once a frame that is not live or has not said hello, and asks it nothing", () => {
    const { reloads, loads } = setup({ "a.one": null });
    reloads.reload("a.one", "v=2");
    expect(loads).toEqual([["a.one", "v=2"]]);
  });

  it("loads nothing for a surface closed or a desk disposed while it waited", () => {
    const [a, b] = [frameWindow(), frameWindow()];
    const { reloads, loads, advance, from } = setup({ "a.one": a.win, "b.two": b.win });
    reloads.reload("a.one", "v=2");
    reloads.reload("b.two", "v=2");
    reloads.forget("a.one");
    from(a.win, { type: "desk:pong", n: a.posted[0]?.n });
    expect(loads).toEqual([]);
    // Opened again, it waits afresh.
    reloads.reload("a.one", "v=3");
    expect(a.posted).toHaveLength(2);
    reloads.dispose();
    from(b.win, { type: "desk:pong", n: b.posted[0]?.n });
    advance(DRAIN_MS);
    expect(loads).toEqual([]);
  });
});
