import { describe, expect, it } from "vitest";
import { fillRect, halves, snapFor } from "./snap";

const area = { x: 0, y: 0, w: 1440, h: 900 };

describe("snapFor", () => {
  it("a window dropped near the left or right edge snaps to that half", () => {
    expect(snapFor({ x: area.x + 10, y: 400 }, area)).toBe("left");
    expect(snapFor({ x: area.x + area.w - 5, y: 400 }, area)).toBe("right");
  });

  it("one dropped at the top fills the area; a title bar grabbed lower down does not", () => {
    expect(snapFor({ x: 700, y: area.y + 4 }, area)).toBe("full");
    expect(snapFor({ x: 700, y: area.y + 20 }, area)).toBeNull();
  });

  it("elsewhere it stays where it was dropped", () => {
    expect(snapFor({ x: 700, y: 400 }, area)).toBeNull();
    expect(snapFor({ x: area.x + 25, y: 400 }, area)).toBeNull();
  });

  it("halves share the width with a gap between them", () => {
    const { left, right } = halves(area);
    expect(left.x).toBe(area.x);
    expect(right.x + right.w).toBe(area.x + area.w);
    expect(left.x + left.w).toBeLessThan(right.x);
    expect(left.h).toBe(area.h);
  });

  it("a fill is the whole area or one of its halves", () => {
    expect(fillRect("full", area)).toEqual(area);
    expect(fillRect("left", area)).toEqual(halves(area).left);
    expect(fillRect("right", area)).toEqual(halves(area).right);
  });
});
