import { describe, expect, it } from "vitest";
import type { Rect } from "../surface/geometry";
import {
  arrangeArea,
  cascadeRects,
  cascadeSize,
  fanRows,
  flatSlots,
  gridShape,
  spreadSlots,
  spreadStage,
  tileRects,
} from "./geometry";

const APPS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [2560, 1080],
  [900, 1200],
] as const;

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the tile grid", () => {
  for (const [vw, vh] of APPS) {
    it(`fills the canvas with no overlap for 1 to 12 windows at ${vw}×${vh}`, () => {
      const area = arrangeArea(vw, vh);
      const gap = 12;
      for (let n = 1; n <= 12; n++) {
        const rects = tileRects(n, area, gap);
        expect(rects).toHaveLength(n);
        for (const [i, a] of rects.entries()) {
          expect(a.w).toBeGreaterThan(0);
          expect(a.h).toBeGreaterThan(0);
          for (const b of rects.slice(i + 1)) expect(overlap(a, b)).toBe(false);
        }
        // Rows from the area's top to its bottom, `gap` apart; in each, cells from its left to its
        // right edge, `gap` apart: nothing of the area is left but the gaps.
        const rows = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
        const height = (y: number) => rects.find((r) => r.y === y)?.h ?? 0;
        expect(rows[0]).toBe(area.y);
        const last = rows.at(-1) ?? 0;
        expect(last + height(last)).toBe(area.y + area.h);
        for (const [i, y] of rows.slice(1).entries()) {
          const above = rows[i] ?? 0;
          expect(y - (above + height(above))).toBe(gap);
        }
        for (const y of rows) {
          const row = rects.filter((r) => r.y === y).sort((a, b) => a.x - b.x);
          expect(row[0]?.x).toBe(area.x);
          const end = row.at(-1);
          expect((end?.x ?? 0) + (end?.w ?? 0)).toBe(area.x + area.w);
          for (const [i, r] of row.slice(1).entries()) {
            const left = row[i];
            expect(r.x - ((left?.x ?? 0) + (left?.w ?? 0))).toBe(gap);
            expect(r.h).toBe(row[0]?.h);
          }
        }
      }
    });
  }

  it("follows the count and the aspect", () => {
    const wide = arrangeArea(1440, 900);
    expect(gridShape(1, wide)).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(2, wide)).toEqual({ cols: 2, rows: 1 });
    expect(gridShape(4, wide)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(5, wide)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(6, wide)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(12, wide)).toEqual({ cols: 4, rows: 3 });
    const tall = arrangeArea(900, 1200);
    expect(gridShape(2, tall)).toEqual({ cols: 1, rows: 2 });
  });

  it("starts under Eris in her default place, and higher when she was moved", () => {
    expect(arrangeArea(1440, 900)).toEqual({ x: 104, y: 190, w: 1232, h: 622 });
    expect(arrangeArea(1440, 900, false)).toEqual({ x: 104, y: 72, w: 1232, h: 740 });
  });
});

describe("the cascade", () => {
  const area = arrangeArea(1440, 900);

  it("steps every window 32 px down and right from the top left, all the same size", () => {
    const rects = cascadeRects(5, area);
    const size = cascadeSize(area);
    expect(size).toEqual({ w: 739, h: 404 });
    rects.forEach((r, i) => {
      expect(r).toEqual({ x: area.x + 32 * i, y: area.y + 32 * i, ...size });
    });
  });

  it("starts a new run at the top, moved right, when the next step would leave the area", () => {
    const rects = cascadeRects(12, area);
    const firstRun = rects.filter((r) => r.y === area.y);
    expect(firstRun).toHaveLength(2);
    expect(firstRun[1]?.x).toBe(area.x + 7 * 32);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(area.x + area.w);
      expect(r.y + r.h).toBeLessThanOrEqual(area.y + area.h);
    }
    const corners = new Set(rects.map((r) => `${r.x},${r.y}`));
    expect(corners.size).toBe(12);
  });
});

describe("the spread", () => {
  const stage = spreadStage(1440, 900);

  it("gives the same places for the same count, every time", () => {
    for (let n = 1; n <= 12; n++) {
      expect(spreadSlots(n, stage)).toEqual(spreadSlots(n, stage));
      expect(spreadSlots(n, stage)).toHaveLength(n);
    }
  });

  it("fans a few windows in one curved row and many in layers further back", () => {
    expect(fanRows(3, stage)).toEqual([3]);
    expect(fanRows(4, stage)).toEqual([2, 2]);
    expect(fanRows(7, stage)).toEqual([4, 3]);
    expect(fanRows(12, stage)).toEqual([4, 4, 4]);
    const slots = spreadSlots(7, stage);
    const front = slots.filter((s) => s.row === 1);
    const back = slots.filter((s) => s.row === 0);
    for (const s of back) expect(s.z).toBeLessThan(-100);
    for (const s of front) expect(s.z).toBeGreaterThanOrEqual(0);
    // The outer cards turn towards the middle; the middle ones face the person.
    expect(back[0]?.rotateY).toBeGreaterThan(0);
    expect(back.at(-1)?.rotateY).toBeLessThan(0);
    expect(Math.min(...front.map((s) => s.order))).toBeGreaterThan(
      Math.max(...back.map((s) => s.order)),
    );
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(stage.x);
      expect(s.x + s.w).toBeLessThanOrEqual(stage.x + stage.w + 0.01);
    }
  });

  it("lays the same count out flat, with no turn and no depth, when motion is reduced", () => {
    const flat = spreadSlots(7, stage, true);
    expect(flat).toEqual(flatSlots(7, stage));
    for (const s of flat) expect([s.z, s.rotateY, s.rotateX]).toEqual([0, 0, 0]);
    for (const [i, a] of flat.entries())
      for (const b of flat.slice(i + 1)) {
        expect(overlap(a, b)).toBe(false);
      }
  });
});
