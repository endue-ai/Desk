import { describe, expect, it } from "vitest";
import { aimSnap, CORNER, fillRect, fillTop, halves, rows, SNAP, SNAP_TOP, snapFor } from "./snap";

const area = { x: 0, y: 0, w: 1440, h: 900 };
const right = area.x + area.w;
const bottom = area.y + area.h;

describe("snapFor", () => {
  it("each of the four edges snaps to its half", () => {
    expect(snapFor({ x: 10, y: 450 }, area)).toBe("left");
    expect(snapFor({ x: right - 5, y: 450 }, area)).toBe("right");
    expect(snapFor({ x: 720, y: 4 }, area)).toBe("top");
    expect(snapFor({ x: 720, y: bottom - 10 }, area)).toBe("bottom");
  });

  it("each of the four corners snaps to its quarter", () => {
    expect(snapFor({ x: 2, y: 2 }, area)).toBe("top-left");
    expect(snapFor({ x: right - 2, y: 2 }, area)).toBe("top-right");
    expect(snapFor({ x: 2, y: bottom - 2 }, area)).toBe("bottom-left");
    expect(snapFor({ x: right - 2, y: bottom - 2 }, area)).toBe("bottom-right");
  });

  it("an edge's last stretch before a corner is the corner's, from either edge", () => {
    // Down the left edge: within CORNER of the top or the bottom.
    expect(snapFor({ x: 10, y: CORNER }, area)).toBe("top-left");
    expect(snapFor({ x: 10, y: CORNER + 1 }, area)).toBe("left");
    expect(snapFor({ x: 10, y: bottom - CORNER }, area)).toBe("bottom-left");
    // Along the top and the bottom: within CORNER of the left or the right.
    expect(snapFor({ x: right - CORNER, y: 4 }, area)).toBe("top-right");
    expect(snapFor({ x: right - CORNER - 1, y: 4 }, area)).toBe("top");
    expect(snapFor({ x: CORNER, y: bottom - 10 }, area)).toBe("bottom-left");
    expect(snapFor({ x: right - 10, y: bottom - CORNER }, area)).toBe("bottom-right");
  });

  it("a small app's corners take a quarter of an edge at most", () => {
    const small = { x: 0, y: 0, w: 400, h: 300 };
    expect(snapFor({ x: 5, y: 75 }, small)).toBe("top-left");
    expect(snapFor({ x: 5, y: 76 }, small)).toBe("left");
  });

  it("the pointer has to reach an edge's band: 24 px at the sides and the bottom, 8 at the top", () => {
    expect(snapFor({ x: SNAP, y: 450 }, area)).toBe("left");
    expect(snapFor({ x: SNAP + 1, y: 450 }, area)).toBeNull();
    expect(snapFor({ x: right - SNAP - 1, y: 450 }, area)).toBeNull();
    expect(snapFor({ x: 720, y: bottom - SNAP }, area)).toBe("bottom");
    expect(snapFor({ x: 720, y: bottom - SNAP - 1 }, area)).toBeNull();
    // A window moved up under the bars, not at them, keeps its place.
    expect(snapFor({ x: 720, y: SNAP_TOP }, area)).toBe("top");
    expect(snapFor({ x: 720, y: 20 }, area)).toBeNull();
  });

  it("a pointer past the edge, outside a windowed app, is at the edge", () => {
    expect(snapFor({ x: -40, y: 450 }, area)).toBe("left");
    expect(snapFor({ x: 720, y: -12 }, area)).toBe("top");
    expect(snapFor({ x: right + 30, y: bottom + 30 }, area)).toBe("bottom-right");
  });

  it("elsewhere it stays where it was dropped", () => {
    expect(snapFor({ x: 700, y: 400 }, area)).toBeNull();
    expect(snapFor({ x: 100, y: 100 }, area)).toBeNull();
  });
});

describe("aimSnap", () => {
  it("a drag from inside the app aims at the zone the pointer is in", () => {
    const aim = aimSnap({ x: 700, y: 400 }, area);
    expect(aim({ x: 600, y: 400 })).toBeNull();
    expect(aim({ x: 4, y: 400 })).toBe("left");
    expect(aim({ x: 4, y: 4 })).toBe("top-left");
    expect(aim({ x: 300, y: 400 })).toBeNull();
  });

  it("one that starts in a zone aims at nothing until the pointer has left every zone", () => {
    // A title bar grabbed on a window sitting at the top, dragged along it and into the corner.
    const aim = aimSnap({ x: 700, y: 5 }, area);
    expect(aim({ x: 600, y: 6 })).toBeNull();
    expect(aim({ x: 3, y: 3 })).toBeNull();
    expect(aim({ x: 300, y: 300 })).toBeNull();
    expect(aim({ x: 720, y: 2 })).toBe("top");
  });

  it("follows the app's size as it is now", () => {
    const aim = aimSnap({ x: 500, y: 400 }, area);
    expect(aim({ x: 1000, y: 400 }, { x: 0, y: 0, w: 1010, h: 800 })).toBe("right");
  });
});

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

  it("every fill's rect tells the top of the area it was taken from", () => {
    for (const top of [72, 190, 191]) {
      const free = { x: 104, y: top, w: 1232, h: 812 - top };
      for (const fill of [
        "full",
        "left",
        "top",
        "bottom",
        "bottom-left",
        "bottom-right",
      ] as const) {
        expect(fillTop(fill, fillRect(fill, free))).toBe(top);
      }
    }
  });
});
