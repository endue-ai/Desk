import { describe, expect, test } from "vitest";
import type { PaneNode } from "../modes/types";
import { close, LAUNCHER, leaves, nextPaneId, panesOf, setRatio, setView, split } from "./tree";

const one: PaneNode = { kind: "view", id: "p1", view: "calendar" };

describe("the pane tree", () => {
  test("a surface saved without panes is one pane showing the view named by its id", () => {
    expect(panesOf({ id: "notes" })).toEqual({ kind: "view", id: "p1", view: "notes" });
  });

  test("splitting keeps the pane first and adds a launcher second", () => {
    const { node, added } = split(one, "p1", "row");
    expect(added).toBe("p2");
    expect(node).toMatchObject({ kind: "split", dir: "row", ratio: 0.5 });
    expect(leaves(node).map((l) => [l.id, l.view])).toEqual([
      ["p1", "calendar"],
      ["p2", LAUNCHER],
    ]);
  });

  test("splits nest, and ids never repeat", () => {
    const a = split(one, "p1", "row").node;
    const b = split(a, "p1", "column").node;
    expect(leaves(b).map((l) => l.id)).toEqual(["p1", "p3", "p2"]);
    expect(nextPaneId(b)).toBe("p4");
  });

  test("closing a pane gives its sibling the whole split; the last pane closes to null", () => {
    const a = split(one, "p1", "row").node;
    expect(close(a, "p2")).toEqual(one);
    expect(close(one, "p1")).toBeNull();
    const b = split(a, "p2", "column").node;
    expect(leaves(close(b, "p3") as PaneNode).map((l) => l.id)).toEqual(["p1", "p2"]);
  });

  test("a pane can show another view", () => {
    const a = split(one, "p1", "row").node;
    expect(leaves(setView(a, "p2", "notes")).map((l) => l.view)).toEqual(["calendar", "notes"]);
  });

  test("ratios stay between 15 % and 85 %", () => {
    const a = split(one, "p1", "row").node;
    expect(setRatio(a, "s2", 0.99)).toMatchObject({ ratio: 0.85 });
    expect(setRatio(a, "s2", 0)).toMatchObject({ ratio: 0.15 });
    expect(setRatio(a, "s2", 0.3333)).toMatchObject({ ratio: 0.333 });
  });
});
