import { expect, test } from "vitest";
import { clampRect, fromScreen, MIN, SAFE, toScreen } from "./geometry";

test("at 1440×900 the reference frame is the screen", () => {
  expect(toScreen({ x: 120, y: 240, w: 560, h: 400 }, 1440, 900)).toEqual({
    x: 120,
    y: 240,
    w: 560,
    h: 400,
  });
});

test("at 1024 wide surfaces shrink and stay clear of the bars", () => {
  const r = toScreen({ x: 1000, y: 220, w: 320, h: 360 }, 1024, 768);
  expect(r.w).toBeLessThan(320);
  expect(r.x).toBeGreaterThanOrEqual(SAFE.left);
  expect(r.x + r.w).toBeLessThanOrEqual(1024 - SAFE.right);
  expect(r.y + r.h).toBeLessThanOrEqual(768 - SAFE.bottom);
});

test("screen and reference positions round-trip", () => {
  const ref = { x: 300, y: 300, w: 400, h: 300 };
  const back = fromScreen(toScreen(ref, 1280, 800), 1280, 800);
  expect(Math.abs(back.x - ref.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(back.w - ref.w)).toBeLessThanOrEqual(2);
});

test("a dragged rect stays inside and keeps its minimum size", () => {
  expect(clampRect({ x: -50, y: 2000, w: 10, h: 10 }, 1440, 900)).toEqual({
    x: SAFE.left,
    y: 900 - SAFE.bottom - MIN.h,
    w: MIN.w,
    h: MIN.h,
  });
});
