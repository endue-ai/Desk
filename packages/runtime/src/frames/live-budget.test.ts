// The live budget (#37), the decisions alone: every surface in sight keeps its frame, and of those
// out of sight only the N most recently focused do; the rest sleep, least recent first, and a
// sleeping surface that shows wakes.
import { describe, expect, it } from "vitest";
import { type Counted, FocusOrder, liveBudget } from "./live-budget";

/** Twenty windows, `shown` in sight, every one live unless named `asleep`. */
function windows(
  count: number,
  { shown = [] as string[], asleep = [] as string[], held = [] as string[] } = {},
): Counted[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `w${i + 1}`;
    return {
      id,
      shown: shown.includes(id),
      live: !asleep.includes(id),
      ready: !held.includes(id),
    };
  });
}

describe("liveBudget", () => {
  it("with 20 windows and N = 8 keeps the visible ones and the 8 most recent hidden ones live", () => {
    // Most recent first: w1 is the one focused last.
    const surfaces = windows(20, { shown: ["w1", "w5"] });
    const { sleep, wake } = liveBudget(surfaces, 8);
    // Hidden, most recent first: w2 w3 w4 w6 … w20; the eight kept are w2–w4 and w6–w10.
    expect(sleep).toEqual(["w20", "w19", "w18", "w17", "w16", "w15", "w14", "w13", "w12", "w11"]);
    expect(wake).toEqual([]);
    const live = surfaces.filter((s) => !sleep.includes(s.id));
    expect(live.filter((s) => !s.shown)).toHaveLength(8);
    expect(live.filter((s) => s.shown).map((s) => s.id)).toEqual(["w1", "w5"]);
  });

  it("never puts a visible surface to sleep, however many there are", () => {
    const shown = Array.from({ length: 12 }, (_, i) => `w${i + 9}`);
    const { sleep } = liveBudget(windows(20, { shown }), 2);
    expect(sleep.some((id) => shown.includes(id))).toBe(false);
    expect(sleep).toEqual(["w8", "w7", "w6", "w5", "w4", "w3"]);
  });

  it("wakes a sleeping surface that shows, and counts only live frames against the budget", () => {
    const surfaces = windows(6, { shown: ["w4"], asleep: ["w2", "w4", "w5", "w6"] });
    // w1 and w3 are the only hidden live frames: within a budget of 2, nothing more sleeps.
    expect(liveBudget(surfaces, 2)).toEqual({ wake: ["w4"], sleep: [] });
    // A tighter budget puts the less recent of the two to sleep.
    expect(liveBudget(surfaces, 1)).toEqual({ wake: ["w4"], sleep: ["w3"] });
  });

  it("with 0 keeps only what is in sight", () => {
    const { sleep } = liveBudget(windows(4, { shown: ["w2"] }), 0);
    expect(sleep).toEqual(["w4", "w3", "w1"]);
  });

  it("passes over a surface it may not put to sleep yet and takes the next least recent", () => {
    const { sleep } = liveBudget(windows(5, { held: ["w5"] }), 3);
    expect(sleep).toEqual(["w4", "w3"]);
  });

  it("reads a budget that is not a whole number of 0 or more as its floor, or 0", () => {
    expect(liveBudget(windows(3), 1.9).sleep).toEqual(["w3", "w2"]);
    expect(liveBudget(windows(3), -4).sleep).toEqual(["w3", "w2", "w1"]);
    expect(liveBudget(windows(3), Number.POSITIVE_INFINITY).sleep).toEqual([]);
  });
});

describe("FocusOrder", () => {
  it("puts what was touched last first, and what it never saw after, as given", () => {
    const order = new FocusOrder();
    order.touch("a");
    order.touch("b");
    order.touch("c");
    order.touch("a");
    expect(order.sort(["x", "b", "c", "a", "y"])).toEqual(["a", "c", "b", "x", "y"]);
  });

  it("forgets a surface that closed", () => {
    const order = new FocusOrder();
    order.touch("a");
    order.touch("b");
    order.forget("b");
    expect(order.sort(["b", "a"])).toEqual(["a", "b"]);
  });
});
