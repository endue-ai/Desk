import { describe, expect, it } from "vitest";
import { FREE } from "./geometry";
import { CASCADE, freeSlot, slotRect } from "./tiling";

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("slots", () => {
  it("lays the first six out in the free area without overlap, in reading order, one size", () => {
    const rects = Array.from({ length: 6 }, (_, n) => slotRect(n));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(FREE.x);
      expect(r.y).toBeGreaterThanOrEqual(FREE.y);
      expect(r.x + r.w).toBeLessThanOrEqual(FREE.x + FREE.w);
      expect(r.y + r.h).toBeLessThanOrEqual(FREE.y + FREE.h);
      expect({ w: r.w, h: r.h }).toEqual({ w: rects[0]?.w, h: rects[0]?.h });
    }
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a && b) expect(overlaps(a, b)).toBe(false);
      }
    // Reading order: the second sits to the right of the first, the fourth under it.
    expect(rects[1]?.x).toBeGreaterThan(rects[0]?.x ?? 0);
    expect(rects[1]?.y).toBe(rects[0]?.y);
    expect(rects[3]?.y).toBeGreaterThan(rects[0]?.y ?? 0);
  });

  it("cascades the next six over the first", () => {
    const first = slotRect(0);
    expect(slotRect(6)).toEqual({ ...first, x: first.x + CASCADE, y: first.y + CASCADE });
  });

  it("gives a slot's rect regardless of the others: no window resizes for another", () => {
    expect(slotRect(2)).toEqual(slotRect(2));
    expect(freeSlot([])).toBe(0);
    expect(freeSlot([0, 1, 3])).toBe(2);
    expect(freeSlot([1, 2])).toBe(0);
  });
});
