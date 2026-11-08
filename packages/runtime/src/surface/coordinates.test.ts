import { describe, expect, it } from "vitest";
import type { SurfacePlacement } from "../modes/types";
import { isFloating, screenRect, storedRect } from "./coordinates";

const placement: SurfacePlacement = {
  id: "notes",
  plugin: "notes",
  pinned: false,
  x: 400,
  y: 240,
  w: 400,
  h: 280,
  floating: true,
};

describe("window coordinate systems", () => {
  it("puts a window in normal mode unless it says floating", () => {
    const { floating: _floating, ...saved } = placement;
    expect(isFloating(saved)).toBe(false);
    expect(isFloating({ ...saved, floating: false })).toBe(false);
    expect(isFloating(placement)).toBe(true);
    // A normal window moves with the pan.
    expect(screenRect(saved, { x: 300, y: -200 }, 1440, 900)).toMatchObject({ x: 700, y: 40 });
  });

  it("keeps floating windows independent of pan and responsive to app size", () => {
    const full = screenRect(placement, { x: 0, y: 0 }, 1440, 900);
    expect(screenRect(placement, { x: 300, y: -200 }, 1440, 900)).toEqual(full);
    const smaller = screenRect(placement, { x: 300, y: -200 }, 1024, 768);
    expect(smaller.x).toBeLessThan(full.x);
    expect(smaller.w).toBeLessThan(full.w);
  });

  it("keeps canvas world size and coordinates unchanged on viewport resize", () => {
    const p = { ...placement, floating: false };
    const pan = { x: -800, y: 200 };
    const rect = screenRect(p, pan, 1440, 900);
    expect(rect).toEqual({ x: -400, y: 440, w: 400, h: 280 });
    expect(screenRect(p, pan, 1024, 768)).toEqual(rect);
    expect(storedRect(rect, false, pan, 1024, 768)).toEqual({
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
    });
  });

  it("converts between modes at the current screen location, including a panned canvas", () => {
    const pan = { x: 120, y: -80 };
    const rect = screenRect(placement, pan, 1440, 900);
    const canvas = { ...placement, ...storedRect(rect, false, pan, 1440, 900), floating: false };
    expect(screenRect(canvas, pan, 1440, 900)).toEqual(rect);
    expect(storedRect(rect, true, pan, 1440, 900)).toEqual({
      x: placement.x,
      y: placement.y,
      w: placement.w,
      h: placement.h,
    });
  });

  it("fills the whole app, or a half of it, at any app size", () => {
    const full = { ...placement, fill: "full" as const };
    expect(screenRect(full, { x: 0, y: 0 }, 1440, 900)).toEqual({ x: 0, y: 0, w: 1440, h: 900 });
    expect(screenRect(full, { x: 0, y: 0 }, 2560, 1440)).toEqual({ x: 0, y: 0, w: 2560, h: 1440 });
    const right = screenRect({ ...placement, fill: "right" }, { x: 0, y: 0 }, 2000, 1000);
    expect(right.x + right.w).toBe(2000);
    expect(right).toMatchObject({ y: 0, h: 1000 });
    // A normal window keeps the world rect it was filled to, so it moves with the pan.
    const canvas = { ...placement, floating: false, fill: "full" as const };
    expect(screenRect(canvas, { x: 0, y: 0 }, 1440, 900)).toEqual({
      x: 400,
      y: 240,
      w: 400,
      h: 280,
    });
  });
});
