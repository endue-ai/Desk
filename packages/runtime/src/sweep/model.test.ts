import { describe, expect, it } from "vitest";
import { around, boxBetween, GAP, gridIn, SMALLEST, tooSmall, touched } from "./model";
import { snapshotName, snapshotText } from "./snapshot";

describe("the swept area", () => {
  it("spans the drag whichever way it went, and a click is too small to mean anything", () => {
    expect(boxBetween(300, 200, 100, 50)).toEqual({ x: 100, y: 50, w: 200, h: 150 });
    expect(tooSmall(boxBetween(10, 10, 14, 30))).toBe(true);
    expect(tooSmall(boxBetween(10, 10, 60, 60))).toBe(false);
  });

  it("touches the windows it overlaps, not those it only borders", () => {
    const windows = [
      { id: "a", box: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "b", box: { x: 100, y: 0, w: 100, h: 100 } },
      { id: "c", box: { x: 400, y: 400, w: 50, h: 50 } },
    ];
    expect(touched({ x: 50, y: 50, w: 50, h: 10 }, windows).map((w) => w.id)).toEqual(["a"]);
    expect(touched({ x: 90, y: 10, w: 20, h: 10 }, windows).map((w) => w.id)).toEqual(["a", "b"]);
    expect(around(windows.map((w) => w.box))).toEqual({ x: 0, y: 0, w: 450, h: 450 });
    expect(around([])).toBeUndefined();
  });
});

describe("Arrange", () => {
  it("lays windows out in a grid inside the area, a gap apart", () => {
    const cells = gridIn({ x: 100, y: 50, w: 1208, h: 600 }, 2);
    expect(cells).toEqual([
      { x: 100, y: 50, w: 600, h: 600 },
      { x: 100 + 600 + GAP, y: 50, w: 600, h: 600 },
    ]);
    expect(gridIn({ x: 0, y: 0, w: 1000, h: 1000 }, 4).map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [496 + GAP, 0],
      [0, 496 + GAP],
      [496 + GAP, 496 + GAP],
    ]);
  });

  it("never makes a window smaller than it can be used", () => {
    for (const cell of gridIn({ x: 0, y: 0, w: 100, h: 100 }, 3)) {
      expect(cell.w).toBeGreaterThanOrEqual(SMALLEST.w);
      expect(cell.h).toBeGreaterThanOrEqual(SMALLEST.h);
    }
    expect(gridIn({ x: 0, y: 0, w: 100, h: 100 }, 0)).toEqual([]);
  });
});

describe("a snapshot for Eris", () => {
  it("says the area, the windows in it and where the picture is", () => {
    const text = snapshotText(
      { x: 10, y: 20, w: 300, h: 200 },
      [{ id: "w1", title: "Notes", plugin: "endue.notes", box: { x: 10, y: 20, w: 150, h: 100 } }],
      "~/.desk/snapshots/a.png",
    );
    expect(text).toContain("snapshot of an area of the desk (300×200 at 10,20)");
    expect(text).toContain("- Notes (window w1, endue.notes) at 10,20, 150×100");
    expect(text).toContain("saved at ~/.desk/snapshots/a.png");
    expect(snapshotText({ x: 0, y: 0, w: 1, h: 1 }, [])).toContain("No window is in it");
    expect(snapshotName(new Date(2026, 10, 21, 23, 4, 5))).toBe(
      "endue-snapshot-2026-11-21-23-04-05.png",
    );
  });
});
