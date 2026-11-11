import { describe, expect, it } from "vitest";
import { intoSight, sideways } from "../ui/scroll.js";

const PIXELS = 0;
const LINES = 1;
const PAGES = 2;

describe("a wheel over the dock", () => {
  it("moves the row by a vertical turn, down to the right and up to the left", () => {
    expect(sideways({ deltaX: 0, deltaY: 120, deltaMode: PIXELS }, 800)).toBe(120);
    expect(sideways({ deltaX: 0, deltaY: -40, deltaMode: PIXELS }, 800)).toBe(-40);
  });

  it("counts lines and pages in pixels", () => {
    expect(sideways({ deltaX: 0, deltaY: 3, deltaMode: LINES }, 800)).toBe(48);
    expect(sideways({ deltaX: 0, deltaY: -1, deltaMode: PAGES }, 800)).toBe(-800);
  });

  it("leaves a sideways wheel or swipe to the row's own scrolling", () => {
    expect(sideways({ deltaX: 90, deltaY: 30, deltaMode: PIXELS }, 800)).toBe(0);
    expect(sideways({ deltaX: -50, deltaY: 50, deltaMode: PIXELS }, 800)).toBe(0);
    expect(sideways({ deltaX: 0, deltaY: 0, deltaMode: PIXELS }, 800)).toBe(0);
  });
});

describe("a tile that takes the focus", () => {
  const shown = { left: 8, right: 792 };

  it("stays where it is when it shows whole", () => {
    expect(intoSight({ left: 8, right: 100 }, shown)).toBe(0);
    expect(intoSight({ left: 700, right: 792 }, shown)).toBe(0);
  });

  it("scrolls in just far enough when part or all of it is out of sight", () => {
    expect(intoSight({ left: 740, right: 850 }, shown)).toBe(58);
    expect(intoSight({ left: 1200, right: 1300 }, shown)).toBe(508);
    expect(intoSight({ left: -30, right: 70 }, shown)).toBe(-38);
  });
});
