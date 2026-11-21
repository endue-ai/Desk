import { describe, expect, it } from "vitest";
import { borderPoint } from "./errand-targets";

describe("where an errand's thread meets a window", () => {
  const box = { x: 100, y: 300, w: 400, h: 300 };

  it("on the border, where the way from the window's middle toward her crosses it", () => {
    // Above and to the right: through the top edge.
    const top = borderPoint(box, { x: 664, y: 109 });
    expect(top.x).toBeCloseTo(460.1, 1);
    expect(top.y).toBe(300);
    // Straight to the left: the middle of the left edge.
    expect(borderPoint(box, { x: -200, y: 450 })).toEqual({ x: 100, y: 450 });
    // Below: the bottom edge.
    expect(borderPoint(box, { x: 300, y: 1000 })).toEqual({ x: 300, y: 600 });
    // Far right and a little up: the right edge.
    expect(borderPoint(box, { x: 700, y: 350 })).toEqual({ x: 500, y: 400 });
  });

  it("from inside the window, the nearest point of its edge", () => {
    expect(borderPoint(box, { x: 120, y: 400 })).toEqual({ x: 100, y: 400 });
    expect(borderPoint(box, { x: 300, y: 590 })).toEqual({ x: 300, y: 600 });
  });
});
