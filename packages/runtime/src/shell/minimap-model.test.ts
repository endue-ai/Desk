import { describe, expect, it } from "vitest";
import {
  fitWorld,
  MAP,
  panByKey,
  panCentredOn,
  panMovedBy,
  toMap,
  toWorld,
  viewRect,
  worldOf,
} from "./minimap-model";

describe("the canvas map's world", () => {
  it("is the part in sight when no window lies outside it, with a margin", () => {
    const view = viewRect({ x: 0, y: 0 }, 1440, 900);
    expect(view).toEqual({ x: 0, y: 0, w: 1440, h: 900 });
    const world = worldOf([{ x: 200, y: 100, w: 400, h: 300 }], view);
    const m = 1440 * 0.06;
    expect(world).toEqual({ x: -m, y: -m, w: 1440 + 2 * m, h: 900 + 2 * m });
  });

  it("reaches every window, however far the canvas holds it", () => {
    const view = viewRect({ x: -500, y: 0 }, 1440, 900);
    const world = worldOf(
      [
        { x: -2000, y: 100, w: 600, h: 400 },
        { x: 3000, y: 1800, w: 500, h: 500 },
      ],
      view,
    );
    const m = 5500 * 0.06;
    expect(world.x).toBeCloseTo(-2000 - m);
    expect(world.x + world.w).toBeCloseTo(3500 + m);
    expect(world.y).toBeCloseTo(0 - m);
    expect(world.y + world.h).toBeCloseTo(2300 + m);
  });
});

describe("fitting the world into the map", () => {
  it("keeps the proportions and centres the world on the axis it does not fill", () => {
    // Twice as wide as the box's proportions: the width fills, the height is centred.
    const world = { x: 0, y: 0, w: 2880, h: 900 };
    const fit = fitWorld(world);
    expect(fit.scale).toBeCloseTo(MAP.w / 2880);
    const box = toMap(world, fit);
    expect(box.x).toBeCloseTo(0);
    expect(box.w).toBeCloseTo(MAP.w);
    expect(box.y + box.h / 2).toBeCloseTo(MAP.h / 2);
  });

  it("maps a point there and back", () => {
    const fit = fitWorld({ x: -700, y: 300, w: 4000, h: 2500 });
    const there = toMap({ x: 123, y: 456, w: 0, h: 0 }, fit);
    const back = toWorld(there.x, there.y, fit);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(456);
  });
});

describe("moving the canvas from the map", () => {
  it("centres the part in sight on the point pressed", () => {
    const pan = panCentredOn({ x: 2000, y: 1000 }, 1440, 900);
    expect(pan).toEqual({ x: 720 - 2000, y: 450 - 1000 });
    const view = viewRect(pan, 1440, 900);
    expect(view.x + view.w / 2).toBe(2000);
    expect(view.y + view.h / 2).toBe(1000);
  });

  it("follows a drag of the part in sight, scaled up to world pixels", () => {
    const fit = { scale: 0.1, x: 0, y: 0 };
    // The frame moved 10 map pixels right and 5 down: the view moved 100 and 50 world pixels.
    expect(panMovedBy({ x: 0, y: 0 }, 10, 5, fit)).toEqual({ x: -100, y: -50 });
  });

  it("steps a quarter of the view with an arrow key, a whole one with Shift", () => {
    const at = { x: 0, y: 0 };
    expect(panByKey(at, "ArrowRight", false, 1440, 900)).toEqual({ x: -360, y: 0 });
    expect(panByKey(at, "ArrowLeft", false, 1440, 900)).toEqual({ x: 360, y: 0 });
    expect(panByKey(at, "ArrowDown", true, 1440, 900)).toEqual({ x: 0, y: -900 });
    expect(panByKey(at, "ArrowUp", true, 1440, 900)).toEqual({ x: 0, y: 900 });
    expect(panByKey(at, "Enter", false, 1440, 900)).toBeNull();
  });
});
