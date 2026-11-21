// PostgreSQL's plans read as the plan tab draws them (PG-70), on plans captured from every server
// from 13 to 18 (tests/plans/): estimate against actual rows with loops multiplied out, own time
// split from total, the marks that say why a node is slow, and the statement's totals at the top.
import { describe, expect, it } from "vitest";
import { flatten } from "../ui/explain/node.js";
import { planOf } from "../ui/explain/plan.js";
import { captured, setOf } from "./plans/captured";

const servers = captured();
const read = (plan: unknown) => {
  const root = planOf(setOf(plan));
  if (!root) throw new Error("no plan");
  return root;
};
const nodes = (plan: unknown) => flatten(read(plan)).map(({ node }) => node);
const find = (plan: unknown, kind: string) => {
  const found = nodes(plan).find((n) => n.kind === kind);
  if (!found) throw new Error(`no ${kind}`);
  return found;
};
/** A node of the JSON plan as the server printed it. */
function rawNode(plan: unknown, test: (p: Record<string, unknown>) => boolean) {
  const todo = [(plan as Array<{ Plan: Record<string, unknown> }>)[0]?.Plan];
  while (todo.length) {
    const p = todo.pop();
    if (!p) continue;
    if (test(p)) return p;
    todo.push(...((p.Plans as Record<string, unknown>[] | undefined) ?? []));
  }
  throw new Error("no such node");
}
const marks = (plan: unknown) =>
  nodes(plan).flatMap((n) => n.marks.map((m) => `${n.kind}: ${m.kind}`));

describe("PostgreSQL's plans", () => {
  it("reads the plans captured from PostgreSQL 13 to 18", () => {
    expect(servers.map((s) => Math.floor(s.num / 10000))).toEqual([13, 14, 15, 16, 17, 18]);
    for (const { version, plans } of servers) {
      const root = read(plans.join);
      const s = root.summary;
      expect(root.label, version).toBe("Sort");
      expect(s?.planning, version).toBeGreaterThan(0);
      expect(s?.execution, version).toBeGreaterThanOrEqual(root.time ?? Number.NaN);
      expect(s?.buffers?.sharedHit, version).toBeGreaterThan(0);
      expect(s?.planningBuffers?.sharedHit, version).toBeGreaterThan(0);
      expect(s?.wal, version).toEqual({ records: 0, fpi: 0, bytes: 0 });
      expect(s?.settings, version).toMatchObject({ work_mem: "64kB", enable_hashjoin: "off" });
      expect(s?.raw, version).toMatch(/^\[\s*\{\s*"Plan"/u);
      expect(nodes(plans.join).map((n) => n.label)[2], version).toBe(
        "Seq Scan on public.customers c",
      );
      const estimate = read(plans.estimate);
      expect(estimate.time, version).toBeNull();
      expect(estimate.children[0]?.actualRows, version).toBeNull();
    }
  });

  it("multiplies loops out and splits own time from total", () => {
    for (const { version, plans } of servers) {
      const scan = find(plans.join, "Index Scan");
      const raw = rawNode(plans.join, (p) => p["Index Name"] === "orders_customer");
      expect(scan.loops, version).toBe(666);
      expect(scan.actualRows, version).toBeCloseTo(Number(raw["Actual Rows"]) * 666, 6);
      expect(scan.actualRows, version).toBeGreaterThan(1900);
      expect(scan.time, version).toBeCloseTo(Number(raw["Actual Total Time"]) * 666, 6);
      expect(scan.removed, version).toBeCloseTo(Number(raw["Rows Removed by Filter"]) * 666, 6);
      expect(scan.rows, version).toBe(1);
      const root = read(plans.join);
      const below = root.children.reduce((sum, c) => sum + (c.time ?? 0), 0);
      expect(root.ownTime, version).toBeCloseTo((root.time ?? 0) - below, 6);
      for (const n of nodes(plans.join)) expect(n.ownTime, version).toBeGreaterThanOrEqual(0);
    }
  });

  it("marks a large misestimate, a filtering sequential scan, a spill, many loops and an index scan's filter", () => {
    for (const { version, plans } of servers) {
      expect(marks(plans.join), version).toEqual([
        "Sort: misestimate",
        "Sort: spill",
        "Nested Loop: misestimate",
        "Seq Scan: misestimate",
        "Index Scan: index-filter",
      ]);
      expect(find(plans.join, "Seq Scan").marks[0]?.text, version).toBe(
        "67× more rows than estimated",
      );
      expect(find(plans.join, "Sort").marks[1]?.text, version).toMatch(
        /^the sort spilled to disk \(external merge, \d+ kB\)$/u,
      );
      expect(find(plans.join, "Index Scan").marks[0]?.text, version).toMatch(
        /^its filter removed 17,982 rows the index found, keeping 1,9\d\d$/u,
      );
      expect(marks(plans.loops), version).toEqual(["Nested Loop: loops", "Seq Scan: filter"]);
      expect(find(plans.loops, "Seq Scan").marks[0]?.text, version).toBe(
        "filters 98% of the 60,000 rows it reads away",
      );
      expect(find(plans.loops, "Nested Loop").marks[0]?.text, version).toBe(
        "its inner side ran 1,200 times",
      );
      expect(marks(plans.hash), version).toEqual(["Hash: spill"]);
      expect(find(plans.hash, "Hash").marks[0]?.text, version).toMatch(
        /^the hash spilled to disk in (16|32|64) batches$/u,
      );
      expect(marks(plans.write), version).toEqual([]);
    }
  });

  it("sums the triggers, and reads WAL, serialization and planner memory", () => {
    for (const { version, num, plans } of servers) {
      const s = read(plans.write).summary;
      expect(read(plans.write).label, version).toBe("Update on orders");
      expect(s?.triggers, version).toEqual([
        { name: "orders_audit", relation: "orders", time: expect.any(Number), calls: 20 },
      ]);
      expect(s?.wal?.records, version).toBe(80);
      expect(s?.wal?.bytes, version).toBeGreaterThan(5000);
      if (num >= 170000) {
        const ran = read(plans.serialize).summary;
        expect(ran?.serialization, version).toEqual({ time: expect.any(Number), bytes: 46 });
        expect(ran?.memory?.used, version).toBeGreaterThan(0);
      }
      if (num >= 160000)
        expect(read(plans.generic).label, version).toBe("Index Scan on orders using orders_pkey");
    }
  });
});
