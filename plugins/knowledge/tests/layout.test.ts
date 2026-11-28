import { describe, expect, it } from "vitest";
import { layout } from "../ui/layout.js";

/** Two clusters of ten, each a star around its hub, and no edge between them. */
function stars() {
  const pairs: number[] = [];
  for (let i = 1; i < 10; i++) pairs.push(0, i);
  for (let i = 11; i < 20; i++) pairs.push(10, i);
  return { n: 20, edges: Int32Array.from(pairs) };
}

const at = (p: Float32Array, i: number) => [p[2 * i] ?? 0, p[2 * i + 1] ?? 0] as const;
const dist = (p: Float32Array, i: number, j: number) =>
  Math.hypot(at(p, i)[0] - at(p, j)[0], at(p, i)[1] - at(p, j)[1]);

describe("layout", () => {
  it("is deterministic and finite", () => {
    const a = layout(stars());
    expect(a).toEqual(layout(stars()));
    expect([...a].every(Number.isFinite)).toBe(true);
  });

  it("keeps linked nodes closer than unlinked ones", () => {
    const p = layout(stars());
    const linked = dist(p, 0, 5);
    const across = dist(p, 0, 15);
    expect(linked).toBeLessThan(across);
    expect(dist(p, 0, 10)).toBeGreaterThan(linked);
  });

  it("spreads nodes apart without edges and starts known ones where they were", () => {
    const free = layout({ n: 30, edges: new Int32Array(0) });
    for (let i = 1; i < 30; i++) expect(dist(free, 0, i)).toBeGreaterThan(1);
    const start = Float32Array.from(layout(stars()));
    const again = layout({ ...stars(), start, iterations: 1 });
    expect(Math.abs((again[0] ?? 0) - (start[0] ?? 0))).toBeLessThan(5);
  });

  it("lays out thousands of nodes quickly", () => {
    const n = 3000;
    const pairs: number[] = [];
    for (let i = 1; i < n; i++) pairs.push(i % 97, i);
    const started = performance.now();
    const p = layout({ n, edges: Int32Array.from(pairs), iterations: 150 });
    expect([...p].every(Number.isFinite)).toBe(true);
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});
