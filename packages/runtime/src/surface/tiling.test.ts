import { describe, expect, it } from "vitest";
import { FREE } from "./geometry";
import { tiles } from "./tiling";

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("tiles", () => {
  it("gives one window the whole free area", () => {
    expect(tiles(1)).toEqual([FREE]);
  });

  it("tiles the unplaced windows in the free area without overlap, in order", () => {
    for (const n of [2, 3, 4, 6, 7]) {
      const rects = tiles(n);
      expect(rects).toHaveLength(n);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(FREE.x);
        expect(r.y).toBeGreaterThanOrEqual(FREE.y);
        expect(r.x + r.w).toBeLessThanOrEqual(FREE.x + FREE.w);
        expect(r.y + r.h).toBeLessThanOrEqual(FREE.y + FREE.h);
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const a = rects[i];
          const b = rects[j];
          if (a && b) expect(overlaps(a, b)).toBe(false);
        }
    }
    // Reading order: the second window sits to the right of the first, the fourth under it.
    const four = tiles(4);
    expect(four[1]?.x).toBeGreaterThan(four[0]?.x ?? 0);
    expect(four[1]?.y).toBe(four[0]?.y);
    expect(four[2]?.y).toBeGreaterThan(four[0]?.y ?? 0);
  });
});
