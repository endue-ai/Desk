// The terminal's split layout without a DOM (#315): a tab holds a tree of panes, split right (side by
// side) or down (one above the other). Splitting, closing, moving the focus by direction, a divider's
// drag, the panes' boxes, and the form a layout is kept in across a restart.
import { describe, expect, it } from "vitest";
import { keptOf, readKept } from "../ui/keep.js";
import {
  boxes,
  dividers,
  leaf,
  type Layout,
  neighbour,
  panesOf,
  remove,
  setRatio,
  split,
} from "../ui/layout.js";

/** a | (b over c): the layout most cases use. */
const three = (): Layout => split(split(leaf("a"), "a", "right", "b"), "b", "down", "c");

describe("the split layout", () => {
  it("splits a pane right and down", () => {
    expect(split(leaf("a"), "a", "right", "b")).toEqual({
      split: "right",
      ratio: 0.5,
      a: { pane: "a" },
      b: { pane: "b" },
    });
    expect(split(leaf("a"), "a", "down", "b")).toEqual({
      split: "down",
      ratio: 0.5,
      a: { pane: "a" },
      b: { pane: "b" },
    });
    expect(three()).toEqual({
      split: "right",
      ratio: 0.5,
      a: { pane: "a" },
      b: { split: "down", ratio: 0.5, a: { pane: "b" }, b: { pane: "c" } },
    });
    expect(panesOf(three())).toEqual(["a", "b", "c"]);
    // A pane that is not there splits nothing.
    expect(split(leaf("a"), "x", "right", "b")).toEqual({ pane: "a" });
  });

  it("closing a pane gives its room to its neighbour", () => {
    expect(remove(three(), "b")).toEqual({
      split: "right",
      ratio: 0.5,
      a: { pane: "a" },
      b: { pane: "c" },
    });
    expect(remove(three(), "a")).toEqual({
      split: "down",
      ratio: 0.5,
      a: { pane: "b" },
      b: { pane: "c" },
    });
    expect(remove(leaf("a"), "a")).toBeNull();
    expect(remove(leaf("a"), "x")).toEqual({ pane: "a" });
  });

  it("moves the focus to the pane beside it", () => {
    const layout = three();
    expect(neighbour(layout, "a", "right")).toBe("b");
    expect(neighbour(layout, "b", "left")).toBe("a");
    expect(neighbour(layout, "c", "left")).toBe("a");
    expect(neighbour(layout, "b", "down")).toBe("c");
    expect(neighbour(layout, "c", "up")).toBe("b");
    // At an edge the focus stays.
    expect(neighbour(layout, "a", "left")).toBe("a");
    expect(neighbour(layout, "a", "up")).toBe("a");
    expect(neighbour(layout, "c", "right")).toBe("c");
    expect(neighbour(layout, "b", "up")).toBe("b");
  });

  it("a divider's drag sets the split's ratio, within bounds", () => {
    const layout = three();
    expect(dividers(layout).map((d) => d.path)).toEqual(["", "b"]);
    const min = { width: 0.1, height: 0.1 };
    expect(setRatio(layout, "", 0.3, min)).toMatchObject({ ratio: 0.3 });
    expect(setRatio(layout, "b", 0.7, min)).toMatchObject({ b: { ratio: 0.7 } });
    // No pane narrower or shorter than the minimum: a at least 0.1 wide, b and c each 0.1 high.
    expect(setRatio(layout, "", 0.01, min)).toMatchObject({ ratio: 0.1 });
    expect(setRatio(layout, "", 0.99, min)).toMatchObject({ ratio: 0.9 });
    expect(setRatio(layout, "b", 0, min)).toMatchObject({ b: { ratio: 0.1 } });
    // The minimum of a subtree: a | (b | c) keeps two widths on the right.
    const four = split(three(), "b", "right", "d");
    expect(setRatio(four, "", 0.95, min)).toMatchObject({ ratio: 0.8 });
    // A path that names no split changes nothing.
    expect(setRatio(layout, "a", 0.2, min)).toEqual(layout);
  });

  it("the panes' boxes tile the tab", () => {
    const layout = setRatio(three(), "", 0.25, { width: 0, height: 0 });
    expect(boxes(layout)).toEqual({
      a: { x: 0, y: 0, width: 0.25, height: 1 },
      b: { x: 0.25, y: 0, width: 0.75, height: 0.5 },
      c: { x: 0.25, y: 0.5, width: 0.75, height: 0.5 },
    });
    const area = Object.values(boxes(layout)).reduce((sum, b) => sum + b.width * b.height, 0);
    expect(area).toBeCloseTo(1);
    // Each divider sits on the line between its split's halves, within the split's box.
    expect(dividers(layout)).toEqual([
      { path: "", split: "right", at: 0.25, box: { x: 0, y: 0, width: 1, height: 1 } },
      { path: "b", split: "down", at: 0.5, box: { x: 0.25, y: 0, width: 0.75, height: 1 } },
    ]);
  });

  it("a kept layout reads back, a malformed one is refused", () => {
    const info = {
      a: { cwd: "/src", title: "zsh", named: false },
      b: { cwd: null, title: "build", named: true },
      c: { cwd: "~/x", title: "zsh 2", named: false },
    };
    const kept = keptOf(
      [
        { layout: three(), focused: "c" },
        { layout: leaf("d"), focused: "d" },
      ],
      0,
      (id) => info[id as keyof typeof info] ?? { cwd: null, title: "zsh", named: false },
    );
    expect(kept).toEqual({
      v: 1,
      shown: 0,
      tabs: [
        {
          focused: 2,
          layout: {
            split: "right",
            ratio: 0.5,
            a: { pane: info.a },
            b: { split: "down", ratio: 0.5, a: { pane: info.b }, b: { pane: info.c } },
          },
        },
        { focused: 0, layout: { pane: { cwd: null, title: "zsh", named: false } } },
      ],
    });
    expect(readKept(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    for (const bad of [
      undefined,
      null,
      { v: 2, shown: 0, tabs: kept.tabs },
      { v: 1, shown: 0, tabs: [] },
      { v: 1, shown: 0, tabs: [{ focused: 0, layout: { split: "left", ratio: 0.5 } }] },
      { v: 1, shown: 0, tabs: [{ focused: 0, layout: { pane: { cwd: 3, title: "x" } } }] },
      { v: 1, shown: 0, tabs: [{ focused: 5, layout: { pane: info.a } }] },
      {
        v: 1,
        shown: 0,
        tabs: [{ focused: 0, layout: { split: "down", ratio: 2, a: { pane: info.a }, b: {} } }],
      },
    ]) {
      expect(readKept(bad)).toBeNull();
    }
  });
});
