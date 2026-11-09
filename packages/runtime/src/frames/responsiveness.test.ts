// Whether plugin frames still answer the desk (#39), the model alone on manual timers: pings every
// 2 s, late 5 s after the last answer of a watched frame, Wait for 10 s more, Stop until Reload.
import { describe, expect, it } from "vitest";
import type { FrameTimers } from "./policy";
import { type Response, ResponsivenessModel } from "./responsiveness";

/** Timers that move only when told to: `advance` runs what falls due in order, `jump` as a slept desk. */
class ManualTimers implements FrameTimers {
  #now = 0;
  #next = 1;
  readonly #due = new Map<number, { at: number; run: () => void }>();

  now(): number {
    return this.#now;
  }

  after(ms: number, run: () => void): () => void {
    const id = this.#next++;
    this.#due.set(id, { at: this.#now + Math.max(0, ms), run });
    return () => this.#due.delete(id);
  }

  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      const [id, first] =
        [...this.#due].sort(([, a], [, b]) => a.at - b.at).find(([, d]) => d.at <= end) ?? [];
      if (id === undefined || !first) break;
      this.#due.delete(id);
      this.#now = first.at;
      first.run();
    }
    this.#now = end;
  }

  /** Time passes at once: what fell due meanwhile runs once, late, at the end. */
  jump(ms: number): void {
    this.#now += ms;
    const due = [...this.#due].filter(([, d]) => d.at <= this.#now);
    for (const [id, d] of due) {
      this.#due.delete(id);
      d.run();
    }
  }
}

/** One surface's frame, played by the test: it answers each ping at once unless it stopped. */
function watch(ids = ["a"]) {
  const timers = new ManualTimers();
  const live = new Set(ids);
  const answering = new Set(ids);
  const pings: Array<[string, number]> = [];
  const changes: Array<[string, Response]> = [];
  const model: ResponsivenessModel = new ResponsivenessModel({
    timers,
    live: (id) => live.has(id),
    ping: (id, n) => {
      pings.push([id, n]);
      if (answering.has(id)) queueAnswer(id);
    },
  });
  // The frame answers once the tick that pinged it is over, as a posted message would.
  const queued: string[] = [];
  const queueAnswer = (id: string) => void queued.push(id);
  const answer = () => {
    for (const id of queued.splice(0)) model.answered(id);
  };
  /** Let `ms` pass in 100 ms steps, answering what was pinged as it goes. */
  const run = (ms: number) => {
    for (let i = 0; i < ms; i += 100) {
      timers.advance(Math.min(100, ms - i));
      answer();
    }
  };
  model.onChange((id, response) => void changes.push([id, response]));
  // Each frame said hello as it loaded.
  for (const id of ids) model.track(id);
  for (const id of ids) model.hello(id);
  return { timers, model, live, answering, pings, changes, run, answer };
}

describe("ResponsivenessModel", () => {
  it("pings no frame before its hello", () => {
    const timers = new ManualTimers();
    const pings: string[] = [];
    const model = new ResponsivenessModel({
      timers,
      live: () => true,
      ping: (id) => void pings.push(id),
    });
    model.track("a");
    timers.advance(60_000);
    expect(pings).toEqual([]);
    model.hello("a");
    timers.advance(2000);
    expect(pings).toEqual(["a"]);
  });

  it("pings every live frame every 2 s from its hello and watches each once it has answered", () => {
    const { model, pings, run } = watch(["a", "b"]);
    run(1999);
    expect(pings).toEqual([]);
    run(1);
    expect(pings).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(model.get("a")).toEqual({ state: "responding", watched: true, asking: false });
    run(4000);
    expect(pings.map(([id]) => id)).toEqual(["a", "b", "a", "b", "a", "b"]);
  });

  it("is late 5 s after the last answer of a watched frame, and asks Wait or Stop", () => {
    const { model, answering, run, changes } = watch();
    run(2000);
    answering.delete("a");
    run(4999);
    expect(model.get("a")?.state).toBe("responding");
    run(1);
    expect(model.get("a")).toEqual({ state: "late", watched: true, asking: true });
    expect(changes.map(([, r]) => r.state)).toEqual(["responding", "late"]);
  });

  it("never judges a frame that has not answered yet, and lets one be after three silent pings", () => {
    const { model, answering, pings, run } = watch();
    answering.delete("a");
    run(60_000);
    // An SDK from before the ping: three pings, then none until its next hello.
    expect(pings.length).toBe(3);
    expect(model.get("a")).toEqual({ state: "responding", watched: false, asking: false });
    answering.add("a");
    model.hello("a");
    run(2000);
    expect(pings.length).toBe(4);
    expect(model.get("a")?.watched).toBe(true);
  });

  it("starts over on a new page's hello: a late frame that reloads is responding and unwatched", () => {
    const { model, answering, run } = watch();
    run(2000);
    answering.delete("a");
    run(5000);
    expect(model.get("a")?.state).toBe("late");
    model.hello("a");
    expect(model.get("a")).toEqual({ state: "responding", watched: false, asking: false });
  });

  it("is responding again as soon as a late frame answers", () => {
    const { model, answering, run } = watch();
    run(2000);
    answering.delete("a");
    run(6000);
    expect(model.get("a")?.state).toBe("late");
    answering.add("a");
    run(2000);
    expect(model.get("a")).toEqual({ state: "responding", watched: true, asking: false });
  });

  it("Wait stops asking for 10 s, then asks again while the frame stays silent", () => {
    const { model, answering, run } = watch();
    run(2000);
    answering.delete("a");
    run(5000);
    expect(model.wait("a")).toBe(true);
    expect(model.get("a")).toEqual({ state: "late", watched: true, asking: false });
    run(9999);
    expect(model.get("a")?.asking).toBe(false);
    run(1);
    expect(model.get("a")?.asking).toBe(true);
  });

  it("Wait ends early when the frame answers meanwhile", () => {
    const { model, answering, run } = watch();
    run(2000);
    answering.delete("a");
    run(5000);
    model.wait("a");
    answering.add("a");
    run(2000);
    expect(model.get("a")?.state).toBe("responding");
    run(10_000);
    expect(model.get("a")).toEqual({ state: "responding", watched: true, asking: false });
  });

  it("Stop keeps it stopped and unpinged until Reload, and watches it again once it answers", () => {
    const { model, answering, pings, run } = watch();
    run(2000);
    answering.delete("a");
    run(5000);
    expect(model.stop("a")).toBe(true);
    expect(model.get("a")).toEqual({ state: "stopped", watched: false, asking: false });
    const before = pings.length;
    run(30_000);
    expect(pings.length).toBe(before);
    expect(model.get("a")?.state).toBe("stopped");
    expect(model.reload("a")).toBe(true);
    expect(model.get("a")).toEqual({ state: "responding", watched: false, asking: false });
    run(10_000);
    expect(pings.length).toBe(before);
    // The reloaded page says hello and answers.
    answering.add("a");
    model.hello("a");
    run(2000);
    expect(model.get("a")?.watched).toBe(true);
  });

  it("does nothing on Wait or Stop for a frame that is not late, nor on Reload for one not stopped", () => {
    const { model, run } = watch();
    run(2000);
    expect(model.wait("a")).toBe(false);
    expect(model.stop("a")).toBe(false);
    expect(model.reload("a")).toBe(false);
    expect(model.wait("nobody")).toBe(false);
    expect(model.get("a")?.state).toBe("responding");
  });

  it("does not ping a frame that is not live, and starts over when it unloads late", () => {
    const { model, live, answering, pings, run } = watch();
    run(2000);
    answering.delete("a");
    run(5000);
    expect(model.get("a")?.state).toBe("late");
    live.delete("a");
    const before = pings.length;
    run(10_000);
    expect(pings.length).toBe(before);
    expect(model.get("a")).toEqual({ state: "responding", watched: false, asking: false });
  });

  it("gives every ping an interval: a desk that slept past the deadline is not late on waking", () => {
    const { model, timers, run, answer } = watch();
    run(2000);
    timers.jump(3_600_000);
    answer();
    expect(model.get("a")?.state).toBe("responding");
    run(10_000);
    expect(model.get("a")?.state).toBe("responding");
  });

  it("stops pinging what it no longer tracks", () => {
    const { model, pings, run } = watch(["a", "b"]);
    model.untrack("a");
    run(4000);
    expect(new Set(pings.map(([id]) => id))).toEqual(new Set(["b"]));
    expect(model.get("a")).toBeUndefined();
    expect(model.ids()).toEqual(["b"]);
  });
});
