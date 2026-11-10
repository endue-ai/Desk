import { describe, expect, it } from "vitest";
import { fillRect, halves, rows } from "./snap";

const area = { x: 0, y: 0, w: 1440, h: 900 };

describe("fill rects", () => {
  it("halves share the width with a gap between them", () => {
    const { left, right } = halves(area);
    expect(left.x).toBe(area.x);
    expect(right.x + right.w).toBe(area.x + area.w);
    expect(left.x + left.w).toBeLessThan(right.x);
    expect(left.h).toBe(area.h);
  });

  it("rows share the height, the bottom one a gap below the top one, one height", () => {
    const { top, bottom } = rows(area);
    expect(top).toEqual({ x: 0, y: 0, w: 1440, h: 444 });
    expect(bottom).toEqual({ x: 0, y: 456, w: 1440, h: 444 });
  });

  it("a fill is the whole area, one of its halves or one of its quarters", () => {
    const free = { x: 104, y: 190, w: 1232, h: 622 };
    expect(fillRect("full", free)).toEqual(free);
    expect(fillRect("left", free)).toEqual({ x: 104, y: 190, w: 610, h: 622 });
    expect(fillRect("right", free)).toEqual({ x: 726, y: 190, w: 610, h: 622 });
    expect(fillRect("top", free)).toEqual({ x: 104, y: 190, w: 1232, h: 305 });
    expect(fillRect("bottom", free)).toEqual({ x: 104, y: 507, w: 1232, h: 305 });
    expect(fillRect("top-left", free)).toEqual({ x: 104, y: 190, w: 610, h: 305 });
    expect(fillRect("top-right", free)).toEqual({ x: 726, y: 190, w: 610, h: 305 });
    expect(fillRect("bottom-left", free)).toEqual({ x: 104, y: 507, w: 610, h: 305 });
    expect(fillRect("bottom-right", free)).toEqual({ x: 726, y: 507, w: 610, h: 305 });
  });
});
