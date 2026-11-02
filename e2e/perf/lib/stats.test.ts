import { describe, expect, it } from "vitest";
import { median, percentile, round1 } from "./stats";

describe("stats", () => {
  it("percentile is the nearest rank: p95 of 20 tries is the 19th smallest", () => {
    const tries = Array.from({ length: 20 }, (_, i) => 20 - i); // 20, 19, ..., 1
    expect(percentile(tries, 0.95)).toBe(19);
    expect(percentile(tries, 0.5)).toBe(10);
    expect(percentile(tries, 1)).toBe(20);
    expect(percentile([7], 0.95)).toBe(7);
    expect(() => percentile([], 0.95)).toThrow(/no values/);
  });

  it("median is the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(/no values/);
  });

  it("round1 keeps one decimal", () => {
    expect(round1(12.345)).toBe(12.3);
    expect(round1(12.35)).toBe(12.4);
    expect(round1(7)).toBe(7);
  });
});
