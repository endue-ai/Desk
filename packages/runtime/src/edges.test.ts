import { describe, expect, it } from "vitest";
import { edgeOf } from "./edges";

describe("edges", () => {
  it("puts left, right and bottom surfaces on the matching desk edge", () => {
    expect(edgeOf("left")).toBe("left");
    expect(edgeOf("right")).toBe("right");
    expect(edgeOf("bottom")).toBe("bottom");
  });

  it("keeps every other placement off the edges", () => {
    for (const placement of ["center", "floating", "overlay", "top", "", undefined]) {
      expect(edgeOf(placement)).toBeUndefined();
    }
  });
});
