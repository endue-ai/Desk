import { describe, expect, it } from "vitest";
import { edgeOf, takesCell } from "./edges";

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

  it("gives a grid cell only to surfaces that sit on the grid", () => {
    expect(takesCell("center")).toBe(true);
    expect(takesCell("floating")).toBe(true);
    expect(takesCell("somewhere-new")).toBe(true);
    expect(takesCell(undefined)).toBe(true);
    for (const placement of ["left", "right", "bottom", "overlay"]) {
      expect(takesCell(placement)).toBe(false);
    }
  });
});
