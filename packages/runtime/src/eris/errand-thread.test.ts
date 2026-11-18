// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { arc, threadOf } from "./errand-thread";

describe("the thread an errand's spark runs along", () => {
  const from = { x: 600, y: 100 };
  const to = { x: 200, y: 500 };

  it("the arc starts at one end, ends at the other and lifts in between, a wide throw the most", () => {
    expect(arc(from, to, 0)).toEqual(from);
    expect(arc(from, to, 1).x).toBeCloseTo(to.x);
    expect(arc(from, to, 1).y).toBeCloseTo(to.y);
    // Half way it is 60 px above the straight line: a quarter of 400 px across is more.
    expect(arc(from, to, 0.5)).toEqual({ x: 400, y: 240 });
    // Straight down there is nothing to lift over.
    expect(arc(from, { x: 600, y: 500 }, 0.5)).toEqual({ x: 600, y: 300 });
  });

  it("its box holds the whole way with room around it, and its marks run from where it starts", () => {
    const thread = threadOf(document, from, to);
    expect(thread.getAttribute("class")).toBe("errand-thread");
    expect(thread.getAttribute("aria-hidden")).toBe("true");
    expect([thread.style.left, thread.style.top]).toEqual(["192px", "92px"]);
    expect([thread.getAttribute("width"), thread.getAttribute("height")]).toEqual([
      "416.0",
      "416.0",
    ]);
    const [line, flow] = [...thread.querySelectorAll("path")];
    expect(line?.getAttribute("class")).toBe("errand-thread-line");
    expect(flow?.getAttribute("class")).toBe("errand-thread-flow");
    const d = line?.getAttribute("d") ?? "";
    expect(flow?.getAttribute("d")).toBe(d);
    // From her (600, 100) in the box at (192, 92) to the window (200, 500).
    expect(d.startsWith("M408.0 8.0L")).toBe(true);
    expect(d.endsWith("L8.0 408.0")).toBe(true);
    expect(d.split("L")).toHaveLength(25);
  });

  it("an arc that lifts above both ends still lies inside its box", () => {
    const flat = threadOf(document, { x: 100, y: 300 }, { x: 900, y: 300 });
    // 60 px of lift and 8 px of room above the line's ends.
    expect(flat.style.top).toBe("232px");
    expect(flat.getAttribute("height")).toBe("76.0");
  });
});
