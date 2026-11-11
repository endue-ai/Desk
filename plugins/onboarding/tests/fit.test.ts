import { describe, expect, it } from "vitest";
import { ABOVE_DOCK, BOTTOM, fitFor, GAP, MIN_SCALE, ORB, TOP } from "../ui/fit.js";

// The first run fits its window from 1024x500 up (#161 finding 7): the orb gives way, the caption,
// the form and the choices along the edge keep their size. The page-level check is
// packages/runtime/e2e/first-run-fits.spec.ts.

describe("the stage fitted to the window", () => {
  it("keeps the whole orb where there is room", () => {
    expect(fitFor({ height: 950, rest: 244 })).toEqual({ scale: 1, bottom: BOTTOM });
  });

  it("shrinks the orb by what the caption, the form and the edge leave", () => {
    const rest = 96 + 8 + 82;
    const fit = fitFor({ height: 500, rest, edge: 32, edgeBottom: ABOVE_DOCK, frame: true });
    expect(fit.bottom).toBe(ABOVE_DOCK + 32 + GAP);
    const room = 500 - TOP - fit.bottom - rest;
    expect(fit.scale).toBeCloseTo(room / ORB, 3);
    expect(TOP + ORB * fit.scale + rest + fit.bottom).toBeLessThanOrEqual(500 + 1);
  });

  it("keeps clear of the frame's dock once the desk's frame is up", () => {
    expect(fitFor({ height: 800, rest: 200, frame: true }).bottom).toBe(ABOVE_DOCK);
    expect(fitFor({ height: 800, rest: 200 }).bottom).toBe(BOTTOM);
  });

  it("never makes the orb smaller than its least", () => {
    expect(fitFor({ height: 500, rest: 600 }).scale).toBe(MIN_SCALE);
  });
});
