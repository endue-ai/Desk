import { describe, expect, it } from "vitest";
import type { SurfacePlacement } from "../modes/types";
import { screenRect, storedRect } from "./coordinates";

const placement: SurfacePlacement = {
  id: "notes",
  plugin: "notes",
  pinned: false,
  x: 400,
  y: 240,
  w: 400,
  h: 280,
};

describe("window coordinate systems", () => {
  it("keeps legacy floating windows independent of pan and responsive to app size", () => {
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
});
