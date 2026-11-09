// @vitest-environment jsdom
// Moving a window into a part of the app feels like one motion (ADR 0132): a filled, snapped or
// restored window glides to its new place instead of jumping, and a filled one dragged away takes its
// own size back gliding its size only, so it never lags the pointer. Reduced motion zeroes the
// transitions (`--motion-*`), so the classes only name the motion.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "./interactions";

describe("settle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("glides a window to its next place, until its size has arrived", () => {
    const el = document.createElement("section");
    settle(el);
    expect(el.classList.contains("is-settling")).toBe(true);
    // Its left arriving is not the end: the width and height still move.
    const left = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(left, "propertyName", { value: "left" });
    el.dispatchEvent(left);
    expect(el.classList.contains("is-settling")).toBe(true);
    const width = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(width, "propertyName", { value: "width" });
    el.dispatchEvent(width);
    expect(el.classList.contains("is-settling")).toBe(false);
  });

  it("stops gliding on its own when no transition ends (reduced motion, nothing moved)", () => {
    const el = document.createElement("section");
    settle(el, "size");
    expect(el.classList.contains("is-unsnapping")).toBe(true);
    vi.advanceTimersByTime(399);
    expect(el.classList.contains("is-unsnapping")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains("is-unsnapping")).toBe(false);
  });
});
