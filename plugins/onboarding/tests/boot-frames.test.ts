import { describe, expect, it } from "vitest";
import { AGENT, bootFrames, MAX_SCALE, PIECE, SHOW, showScale, total } from "../ui/boot-frames.js";

describe("the heads-up boot", () => {
  it("forms a piece in the middle, holds it there, then lands it home", () => {
    const frames = bootFrames({ dx: 300, dy: -200, scale: 2 });
    const there = "translate(300px, -200px) scale(2)";
    expect(frames[0]).toMatchObject({ offset: 0, opacity: 0, transform: `${there} scale(0.3)` });
    const formed = PIECE.appear / total(PIECE);
    const held = (PIECE.appear + PIECE.hold) / total(PIECE);
    expect(frames.find((f) => f.offset === formed)?.transform).toBe(`${there} scale(1.06)`);
    expect(frames.find((f) => f.offset === held)?.transform).toBe(`${there} scale(1)`);
    expect(frames.at(-1)).toMatchObject({ offset: 1, opacity: 1, transform: "none" });
  });

  it("draws a line where a piece says so, and lands a waiting agent dim", () => {
    const frames = bootFrames({
      dx: 0,
      dy: 0,
      scale: 1,
      from: "scaleX(0)",
      opacity: 0.35,
      times: AGENT,
    });
    expect(frames[0].transform).toBe("translate(0px, 0px) scale(1) scaleX(0)");
    expect(frames.at(-1)?.opacity).toBe(0.35);
  });

  it("keeps its offsets in order", () => {
    for (const times of [PIECE, AGENT]) {
      const offsets = bootFrames({ dx: 1, dy: 1, scale: 1, times }).map((f) => f.offset);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
  });

  it("shows small pieces bigger in the middle and never shrinks a large one", () => {
    expect(showScale(24, 24)).toBe(MAX_SCALE);
    expect(showScale(56, 40)).toBeCloseTo(SHOW / 56);
    expect(showScale(400, 56)).toBe(1);
    expect(showScale(0, 0)).toBe(MAX_SCALE);
  });
});
