// When hidden frames are unloaded (ADR 0070), the decisions alone: after desk.display.unload-after,
// at once past the live budget, desk.surfaces.live (the least recently focused out of sight first,
// ADR 0134), never a visible or focused one, and loaded again when shown.
import { describe, expect, it } from "vitest";
import { FramePolicy, type FrameTimers } from "./policy";

/** Timers that only move when told to, running what falls due in order. */
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

  async advance(ms: number): Promise<void> {
    const end = this.#now + ms;
    for (;;) {
      const [id, first] =
        [...this.#due].sort(([, a], [, b]) => a.at - b.at).find(([, d]) => d.at <= end) ?? [];
      if (id === undefined || !first) break;
      this.#due.delete(id);
      this.#now = first.at;
      first.run();
      await settle();
    }
    this.#now = end;
    await settle();
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const MINUTE = 60_000;

function frames(ids: string[], { after = 5 * MINUTE, budget = Number.POSITIVE_INFINITY } = {}) {
  const timers = new ManualTimers();
  const shown = new Set(ids);
  const unloaded = new Set<string>();
  const refused = new Set<string>();
  const log: string[] = [];
  const settings = { after, budget, focused: null as string | null };
  const policy = new FramePolicy({
    visible: (id) => shown.has(id),
    focused: () => settings.focused,
    afterMs: () => settings.after,
    budget: () => settings.budget,
    unload: async (id, still) => {
      log.push(`ask ${id}`);
      await Promise.resolve();
      if (refused.has(id) || !still()) return false;
      unloaded.add(id);
      log.push(`unload ${id}`);
      return true;
    },
    remount: (id) => {
      unloaded.delete(id);
      log.push(`remount ${id}`);
    },
    timers,
  });
  for (const id of ids) policy.track(id);
  const hide = async (id: string) => {
    shown.delete(id);
    policy.check();
    await settle();
  };
  const show = async (id: string) => {
    shown.add(id);
    policy.check();
    await settle();
  };
  /** The keys go to `id` (null: to none of these), and the policy looks again. */
  const focus = async (id: string | null) => {
    settings.focused = id;
    policy.check();
    await settle();
  };
  return { policy, timers, unloaded, refused, log, settings, hide, show, focus };
}

describe("FramePolicy", () => {
  it("unloads a surface hidden for unload-after, not a moment before", async () => {
    const f = frames(["a", "b"]);
    await f.hide("a");
    await f.timers.advance(5 * MINUTE - 1);
    expect(f.unloaded).toEqual(new Set());
    await f.timers.advance(1);
    expect(f.unloaded).toEqual(new Set(["a"]));
    expect(f.policy.unloaded("a")).toBe(true);
    expect(f.policy.unloaded("b")).toBe(false);
  });

  it("starts the time again when a hidden surface shows before it", async () => {
    const f = frames(["a"]);
    await f.hide("a");
    await f.timers.advance(4 * MINUTE);
    await f.show("a");
    await f.hide("a");
    await f.timers.advance(4 * MINUTE);
    expect(f.unloaded).toEqual(new Set());
    await f.timers.advance(MINUTE);
    expect(f.unloaded).toEqual(new Set(["a"]));
  });

  it("loads an unloaded surface again when it shows, and when woken", async () => {
    const f = frames(["a", "b"]);
    await f.hide("a");
    await f.hide("b");
    await f.timers.advance(5 * MINUTE);
    expect(f.unloaded).toEqual(new Set(["a", "b"]));
    await f.show("a");
    expect(f.log.at(-1)).toBe("remount a");
    expect(f.policy.wake("b")).toBe(true);
    expect(f.unloaded).toEqual(new Set());
    // Live already (loaded by showing it, say): nothing to load, and what waits for it waits (#1).
    expect(f.policy.wake("b")).toBe(true);
    expect(f.log.filter((line) => line === "remount b")).toHaveLength(1);
    // Woken while hidden, it is unloaded again after the same time.
    await f.timers.advance(5 * MINUTE);
    expect(f.unloaded).toEqual(new Set(["b"]));
  });

  it("past the budget puts the least recently focused out of sight to sleep at once, and never a visible one", async () => {
    const f = frames(["a", "b", "c", "d"], { budget: 2 });
    // Opened a to d, then a and b focused: most recent first, b a d c.
    await f.focus("a");
    await f.focus("b");
    await f.focus(null);
    await f.hide("c");
    await f.hide("d");
    // Two out of sight is the budget: nothing goes until unload-after.
    expect(f.unloaded).toEqual(new Set());
    await f.hide("a");
    // a, d and c out of sight: c, focused least recently, goes; d, hidden after it, stays.
    expect(f.unloaded).toEqual(new Set(["c"]));
    await f.show("c");
    expect(f.unloaded).toEqual(new Set());
    await f.hide("b");
    // b a d out of sight: d goes; c, in sight, stays whatever its place.
    expect(f.unloaded).toEqual(new Set(["d"]));
    await f.hide("c");
    // b a c out of sight and live: c, shown a moment ago but focused least recently, goes.
    expect(f.unloaded).toEqual(new Set(["c", "d"]));
    // A lower budget takes effect at once.
    f.settings.budget = 1;
    f.policy.check();
    await settle();
    expect(f.unloaded).toEqual(new Set(["a", "c", "d"]));
  });

  it("counts a surface woken for an answer as the most recent", async () => {
    const f = frames(["a", "b", "c"], { budget: 1 });
    await f.hide("a");
    await f.hide("b");
    await f.hide("c");
    expect(f.unloaded).toEqual(new Set(["a", "b"]));
    expect(f.policy.wake("a")).toBe(true);
    await settle();
    // a is in use now: c, focused less recently, goes in its place.
    expect(f.unloaded).toEqual(new Set(["b", "c"]));
    expect(f.policy.counts()).toEqual({ shown: 0, hidden: 1, asleep: 2 });
  });

  it("counts the frames loaded in sight and out of it, and those asleep", async () => {
    const f = frames(["a", "b", "c", "d"], { budget: 1 });
    expect(f.policy.counts()).toEqual({ shown: 4, hidden: 0, asleep: 0 });
    await f.hide("a");
    await f.hide("b");
    expect(f.policy.counts()).toEqual({ shown: 2, hidden: 1, asleep: 1 });
    // The surface the keys go to counts as in sight, and wakes.
    await f.focus("a");
    expect(f.policy.counts()).toEqual({ shown: 3, hidden: 1, asleep: 0 });
  });

  it("never unloads the surface in focus", async () => {
    const f = frames(["a"], { budget: 0 });
    f.settings.focused = "a";
    await f.hide("a");
    await f.timers.advance(10 * MINUTE);
    expect(f.unloaded).toEqual(new Set());
    // Out of sight without the keys, past a budget of none: it goes at once.
    await f.focus(null);
    expect(f.unloaded).toEqual(new Set(["a"]));
  });

  it("keeps a surface that shows while its state is asked", async () => {
    const f = frames(["a"]);
    await f.hide("a");
    await f.timers.advance(5 * MINUTE - 1);
    const shown = f.timers.advance(1);
    await f.show("a");
    await shown;
    expect(f.log).toContain("ask a");
    expect(f.unloaded).toEqual(new Set());
  });

  it("tries a refused unload again a second later", async () => {
    const f = frames(["a", "b"], { budget: 0 });
    f.refused.add("a");
    await f.hide("a");
    expect(f.log.filter((line) => line === "ask a")).toHaveLength(1);
    await f.timers.advance(999);
    expect(f.log.filter((line) => line === "ask a")).toHaveLength(1);
    f.refused.delete("a");
    await f.timers.advance(1);
    expect(f.unloaded).toEqual(new Set(["a"]));
  });

  it("with unload-after 0 and no budget keeps hidden surfaces loaded", async () => {
    const f = frames(["a", "b", "c"], { after: 0 });
    await f.hide("a");
    await f.hide("b");
    await f.timers.advance(24 * 60 * MINUTE);
    expect(f.unloaded).toEqual(new Set());
  });

  it("forgets a surface that closes", async () => {
    const f = frames(["a"], { budget: 0 });
    await f.hide("a");
    f.policy.untrack("a");
    expect(f.policy.unloaded("a")).toBe(false);
    expect(f.policy.wake("a")).toBe(false);
  });
});
