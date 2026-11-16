// The graph's layout: lanes stay put, first parents keep their child's lane, merges fan in and
// out, freed lanes are reused, and a thousand commits lay out quickly.
import { describe, expect, it } from "vitest";
import { layoutGraph, segmentPath } from "../ui/graph.js";

const n = (sha: string, ...parents: string[]) => ({ sha, parents });

describe("layoutGraph", () => {
  it("draws a straight line for a linear history", () => {
    const { rows, width } = layoutGraph([n("c", "b"), n("b", "a"), n("a")]);
    expect(width).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[1]?.segments).toEqual([
      { kind: "in", from: 0, to: 0, color: 0 },
      { kind: "out", from: 0, to: 0, color: 0 },
    ]);
    expect(rows[2]?.segments).toEqual([{ kind: "in", from: 0, to: 0, color: 0 }]);
  });

  it("opens a lane for a merge's second parent and closes it where the branch began", () => {
    // m merges f into b; f and b both come from a.
    const { rows, width } = layoutGraph([n("m", "b", "f"), n("f", "a"), n("b", "a"), n("a")]);
    expect(width).toBe(2);
    expect(rows[0]).toMatchObject({ lane: 0, merge: true });
    expect(rows[0]?.segments).toContainEqual({ kind: "out", from: 0, to: 1, color: 1 });
    expect(rows[1]?.lane).toBe(1);
    expect(rows[2]?.lane).toBe(0);
    expect(rows[2]?.segments).toContainEqual({ kind: "pass", from: 1, to: 1, color: 1 });
    // At a, both lanes come in.
    expect(rows[3]?.segments.filter((s) => s.kind === "in")).toEqual([
      { kind: "in", from: 0, to: 0, color: 0 },
      { kind: "in", from: 1, to: 0, color: 1 },
    ]);
  });

  it("gives two branch tips their own lanes and colours, and reuses a freed lane", () => {
    const { rows } = layoutGraph([n("x", "a"), n("y", "a"), n("a", "r"), n("z", "r"), n("r")]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 1, 0]);
    expect(rows[0]?.color).not.toBe(rows[1]?.color);
  });

  it("lays out 1,000 commits with merges in well under 100 ms", () => {
    const nodes = [];
    for (let i = 0; i < 1000; i++) {
      const parents = i < 999 ? [`c${i + 1}`] : [];
      if (i % 10 === 0 && i < 990) parents.push(`c${i + 5}`);
      nodes.push(n(`c${i}`, ...parents));
    }
    const started = performance.now();
    const { rows } = layoutGraph(nodes);
    expect(rows).toHaveLength(1000);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("segmentPath", () => {
  const size = { height: 30, laneWidth: 20, pad: 5 };
  it("draws a pass as a vertical line and a fan-in as a curve", () => {
    expect(segmentPath({ kind: "pass", from: 1, to: 1, color: 0 }, size)).toBe("M35 0V30");
    expect(segmentPath({ kind: "in", from: 0, to: 0, color: 0 }, size)).toBe("M15 0V15");
    expect(segmentPath({ kind: "out", from: 0, to: 1, color: 0 }, size)).toMatch(/^M15 15C/);
  });
});
