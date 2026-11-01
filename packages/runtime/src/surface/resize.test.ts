import { expect, test } from "vitest";
import { MIN } from "./geometry";
import { resizeRect } from "./resize";

const start = { x: 300, y: 250, w: 400, h: 300 };
test.each([
  ["nw", { x: 260, y: 220, w: 440, h: 330 }],
  ["ne", { x: 300, y: 220, w: 360, h: 330 }],
  ["sw", { x: 260, y: 250, w: 440, h: 270 }],
  ["se", { x: 300, y: 250, w: 360, h: 270 }],
  ["n", { x: 300, y: 220, w: 400, h: 330 }],
  ["e", { x: 300, y: 250, w: 360, h: 300 }],
  ["s", { x: 300, y: 250, w: 400, h: 270 }],
  ["w", { x: 260, y: 250, w: 440, h: 300 }],
] as const)("%s changes only the grabbed edges", (direction, expected) => {
  expect(resizeRect(start, direction, -40, -30)).toEqual(expected);
});

test("shrinking from the top left stops at the minimum without moving the opposite corner", () => {
  const rect = resizeRect(start, "nw", 1000, 1000);
  expect(rect).toEqual({ x: 700 - MIN.w, y: 550 - MIN.h, ...MIN });
});

test("floating edges stop at the viewport; canvas edges may extend beyond it", () => {
  const bounds = { x: 104, y: 72, w: 816, h: 608 };
  expect(resizeRect(start, "nw", -600, -600, bounds)).toEqual({ x: 104, y: 72, w: 596, h: 478 });
  expect(resizeRect(start, "se", 1000, 1000, bounds)).toEqual({ ...start, w: 620, h: 430 });
  expect(resizeRect(start, "nw", -600, -600)).toEqual({ x: -300, y: -350, w: 1000, h: 900 });
});
