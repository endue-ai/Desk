import { expect, test } from "vitest";
import { clampRect, fromScreen, MIN, toScreen } from "./geometry";

test("at 1440×900 the reference frame is the screen", () => {
  expect(toScreen({ x: 120, y: 240, w: 560, h: 400 }, 1440, 900)).toEqual({
    x: 120,
    y: 240,
    w: 560,
    h: 400,
  });
});

test("at 1024 wide surfaces shrink and stay on the screen", () => {
  const r = toScreen({ x: 1000, y: 220, w: 320, h: 360 }, 1024, 768);
  expect(r.w).toBeLessThan(320);
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w).toBeLessThanOrEqual(1024);
  expect(r.y + r.h).toBeLessThanOrEqual(768);
});

test("a shorter app shrinks windows' heights only, a narrower one their widths only", () => {
  const ref = { x: 400, y: 240, w: 640, h: 480 };
  const shorter = toScreen(ref, 1440, 700);
  expect(shorter.w).toBe(640);
  expect(shorter.h).toBeLessThan(480);
  const narrower = toScreen(ref, 1100, 900);
  expect(narrower.h).toBe(480);
  expect(narrower.w).toBeLessThan(640);
  // And a window resized there keeps its other side when the app grows back.
  expect(toScreen(fromScreen(shorter, 1440, 700), 1440, 900)).toMatchObject({ w: 640, h: 480 });
});

test("screen and reference positions round-trip", () => {
  const ref = { x: 300, y: 300, w: 400, h: 300 };
  const back = fromScreen(toScreen(ref, 1280, 800), 1280, 800);
  expect(Math.abs(back.x - ref.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(back.w - ref.w)).toBeLessThanOrEqual(2);
});

test("a dragged rect stays on the screen and keeps its minimum size", () => {
  expect(clampRect({ x: -50, y: 2000, w: 10, h: 10 }, 1440, 900)).toEqual({
    x: 0,
    y: 900 - MIN.h,
    w: MIN.w,
    h: MIN.h,
  });
});

test("a window can grow to the whole screen, under the bars, and no further", () => {
  expect(clampRect({ x: 0, y: 0, w: 1440, h: 900 }, 1440, 900)).toEqual({
    x: 0,
    y: 0,
    w: 1440,
    h: 900,
  });
  expect(clampRect({ x: -10, y: -10, w: 2000, h: 1200 }, 1440, 900)).toEqual({
    x: 0,
    y: 0,
    w: 1440,
    h: 900,
  });
});

test("a window resized on a small screen still fits when the screen grows", () => {
  const saved = fromScreen({ x: 104, y: 72, w: 800, h: 608 }, 1024, 768);
  const shown = toScreen(saved, 1440, 900);
  expect(shown.x + shown.w).toBeLessThanOrEqual(1440);
  expect(shown.y + shown.h).toBeLessThanOrEqual(900);
});
