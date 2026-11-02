// When hidden frames are unloaded (ADR 0070), the decisions alone: after desk.display.unload-after,
// at once past desk.display.live-surfaces (the one hidden longest first), never a visible or focused
// one, and loaded again when shown.
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

function frames(ids: string[], { after = 5 * MINUTE, limit = 0 } = {}) {
  const timers = new ManualTimers();
  const shown = new Set(ids);
  const unloaded = new Set<string>();
  const refused = new Set<string>();
  const log: string[] = [];
  const settings = { after, limit, focused: null as string | null };
  const policy = new FramePolicy({
    visible: (id) => shown.has(id),
    focused: () => settings.focused,
    afterMs: () => settings.after,
    limit: () => settings.limit,
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
  return { policy, timers, unloaded, refused, log, settings, hide, show };
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
    expect(f.policy.wake("b")).toBe(false);
    // Woken while hidden, it is unloaded again after the same time.
    await f.timers.advance(5 * MINUTE);
    expect(f.unloaded).toEqual(new Set(["b"]));
  });

  it("past live-surfaces unloads the surface hidden longest at once, and never a visible one", async () => {
    const f = frames(["a", "b", "c", "d"], { limit: 3 });
    await f.hide("c");
    expect(f.unloaded).toEqual(new Set(["c"]));
    await f.timers.advance(10_000);
    await f.hide("a");
    await f.timers.advance(10_000);
    await f.hide("b");
    // Three live (a, b, d) is the limit: nothing more goes until unload-after.
    expect(f.unloaded).toEqual(new Set(["c"]));
    await f.show("c");
    // Four live again: a, hidden longest, goes; b, hidden later, stays.
    expect(f.unloaded).toEqual(new Set(["a"]));
    await f.timers.advance(10_000);
    await f.hide("d");
    await f.hide("c");
    expect(f.unloaded).toEqual(new Set(["a"]));
    // A lower limit takes effect at once: b has been hidden longer than d and c.
    f.settings.limit = 2;
    f.policy.check();
    await settle();
    expect(f.unloaded).toEqual(new Set(["a", "b"]));
  });

  it("never unloads the surface in focus", async () => {
    const f = frames(["a"], { limit: 1 });
    f.settings.focused = "a";
    await f.hide("a");
    await f.timers.advance(10 * MINUTE);
    expect(f.unloaded).toEqual(new Set());
    f.settings.focused = null;
    f.policy.check();
    await f.timers.advance(5 * MINUTE);
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
    const f = frames(["a", "b"], { limit: 1 });
    f.refused.add("a");
    await f.hide("a");
    expect(f.log.filter((line) => line === "ask a")).toHaveLength(1);
    await f.timers.advance(999);
    expect(f.log.filter((line) => line === "ask a")).toHaveLength(1);
    f.refused.delete("a");
    await f.timers.advance(1);
    expect(f.unloaded).toEqual(new Set(["a"]));
  });

  it("with 0 keeps hidden surfaces loaded and sets no cap", async () => {
    const f = frames(["a", "b", "c"], { after: 0, limit: 0 });
    await f.hide("a");
    await f.hide("b");
    await f.timers.advance(24 * 60 * MINUTE);
    expect(f.unloaded).toEqual(new Set());
  });

  it("forgets a surface that closes", async () => {
    const f = frames(["a"], { limit: 1 });
    await f.hide("a");
    f.policy.untrack("a");
    expect(f.policy.unloaded("a")).toBe(false);
    expect(f.policy.wake("a")).toBe(false);
  });
});
