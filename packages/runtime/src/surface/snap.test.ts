import { describe, expect, it } from "vitest";
import { halves, snapFor } from "./snap";

const area = { x: 104, y: 72, w: 1232, h: 740 };
const rect = { x: 500, y: 300, w: 400, h: 300 };

describe("snapFor", () => {
  it("a window dropped near the left or right edge snaps to that half", () => {
    expect(snapFor(rect, { x: area.x + 10, y: 400 }, area)).toEqual(halves(area).left);
    expect(snapFor(rect, { x: area.x + area.w - 5, y: 400 }, area)).toEqual(halves(area).right);
  });

  it("one dropped at the top fills the area", () => {
    expect(snapFor(rect, { x: 700, y: area.y + 10 }, area)).toEqual(area);
  });

  it("elsewhere it stays where it was dropped", () => {
    expect(snapFor(rect, { x: 700, y: 400 }, area)).toBeNull();
    expect(snapFor(rect, { x: area.x + 25, y: 400 }, area)).toBeNull();
  });

  it("halves share the width with a gap between them", () => {
    const { left, right } = halves(area);
    expect(left.x).toBe(area.x);
    expect(right.x + right.w).toBe(area.x + area.w);
    expect(left.x + left.w).toBeLessThan(right.x);
    expect(left.h).toBe(area.h);
  });
});
