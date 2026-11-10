// Carrying out the live set (ADR 0070, ADR 0134): a surface the set leaves out has its state asked
// for and its frame taken away, one it lets back in loads again, and the surface the keys go to
// never goes. Which surfaces the set keeps (the budget, the time out of sight) is the window
// manager's (crates/desk-wm/tests/host.rs); here the set is the test's.
import { describe, expect, it } from "vitest";
import { FramePolicy, type FrameTimers, RETRY_MS } from "./policy";

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

/** The policy over surfaces `ids`, all of them in the live set to start with. */
function frames(ids: string[]) {
  const timers = new ManualTimers();
  const live = new Set(ids);
  const unloaded = new Set<string>();
  const refused = new Set<string>();
  const log: string[] = [];
  let focused: string | null = null;
  const policy = new FramePolicy({
    live: (id) => live.has(id),
    focused: () => focused,
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
  /** The live set is `next` now, and the policy looks again. */
  const keep = async (...next: string[]) => {
    live.clear();
    for (const id of next) live.add(id);
    policy.check();
    await settle();
  };
  /** The keys go to `id` (null: to none of these), and the policy looks again. */
  const focus = async (id: string | null) => {
    focused = id;
    policy.check();
    await settle();
  };
  return { policy, timers, live, unloaded, refused, log, keep, focus };
}

describe("FramePolicy", () => {
  it("takes the frame of a surface the set leaves out away at once, its state asked first", async () => {
    const f = frames(["a", "b"]);
    await f.keep("b");
    expect(f.log).toEqual(["ask a", "unload a"]);
    expect(f.policy.unloaded("a")).toBe(true);
    expect(f.policy.unloaded("b")).toBe(false);
  });

  it("loads a frame again once the set lets it back in", async () => {
    const f = frames(["a", "b"]);
    await f.keep();
    expect(f.unloaded).toEqual(new Set(["a", "b"]));
    await f.keep("a");
    expect(f.log.at(-1)).toBe("remount a");
    expect(f.unloaded).toEqual(new Set(["b"]));
  });

  it("wakes an unloaded frame for an answer, and one live already is not loaded twice", async () => {
    const f = frames(["a"]);
    await f.keep();
    expect(f.unloaded).toEqual(new Set(["a"]));
    // The set lets it in before anyone looked again: a request needs it now.
    f.live.add("a");
    expect(f.policy.wake("a")).toBe(true);
    expect(f.unloaded).toEqual(new Set());
    // Live already: nothing to load, and what waits for it waits (#1).
    expect(f.policy.wake("a")).toBe(true);
    expect(f.log.filter((line) => line === "remount a")).toHaveLength(1);
  });

  it("never unloads the surface the keys go to", async () => {
    const f = frames(["a"]);
    await f.focus("a");
    await f.keep();
    await f.timers.advance(10 * 60_000);
    expect(f.unloaded).toEqual(new Set());
    // Left out without the keys: it goes at once.
    await f.focus(null);
    expect(f.unloaded).toEqual(new Set(["a"]));
    // The keys wake it again.
    await f.focus("a");
    expect(f.unloaded).toEqual(new Set());
  });

  it("keeps a surface the set lets back in while its state is asked", async () => {
    const f = frames(["a"]);
    f.live.delete("a");
    f.policy.check();
    // Let back in before the plugin answered.
    f.live.add("a");
    f.policy.check();
    await settle();
    expect(f.log).toEqual(["ask a"]);
    expect(f.unloaded).toEqual(new Set());
    expect(f.policy.unloaded("a")).toBe(false);
  });

  it("tries a refused unload again a second later", async () => {
    const f = frames(["a", "b"]);
    f.refused.add("a");
    await f.keep("b");
    expect(f.log.filter((line) => line === "ask a")).toHaveLength(1);
    await f.timers.advance(RETRY_MS - 1);
    expect(f.log.filter((line) => line === "ask a")).toHaveLength(1);
    f.refused.delete("a");
    await f.timers.advance(1);
    expect(f.unloaded).toEqual(new Set(["a"]));
  });

  it("counts the frames loaded and kept, loaded and left out, and asleep", async () => {
    const f = frames(["a", "b", "c", "d"]);
    expect(f.policy.counts()).toEqual({ shown: 4, hidden: 0, asleep: 0 });
    // a refuses to go for now: loaded and left out.
    f.refused.add("a");
    await f.keep("c", "d");
    expect(f.policy.counts()).toEqual({ shown: 2, hidden: 1, asleep: 1 });
    // The surface the keys go to counts as kept, and wakes.
    await f.focus("b");
    expect(f.policy.counts()).toEqual({ shown: 3, hidden: 1, asleep: 0 });
  });

  it("forgets a surface that closes", async () => {
    const f = frames(["a"]);
    await f.keep();
    f.policy.untrack("a");
    expect(f.policy.unloaded("a")).toBe(false);
    expect(f.policy.wake("a")).toBe(false);
  });
});
