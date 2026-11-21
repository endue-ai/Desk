// Two plans compared node by node, a plan laid out as a flame, and a plan as text and as JSON
// (PG-70).
import { describe, expect, it } from "vitest";
import { comparePlans } from "../ui/explain/compare.js";
import { flameOf } from "../ui/explain/flame.js";
import { planOf, postgresPlan, sqlitePlan } from "../ui/explain/plan.js";
import { planJson, planText } from "../ui/explain/text.js";
import { captured, setOf } from "./plans/captured";

const scan = (type: string, relation: string, cost: number, time: number, extra = {}) => ({
  "Node Type": type,
  "Relation Name": relation,
  Alias: relation[0],
  "Total Cost": cost,
  "Plan Rows": 100,
  "Actual Total Time": time,
  "Actual Rows": 90,
  "Actual Loops": 1,
  ...extra,
});
const join = (type: string, cost: number, time: number, plans: unknown[]) => [
  {
    Plan: {
      "Node Type": type,
      "Total Cost": cost,
      "Plan Rows": 100,
      "Actual Total Time": time,
      "Actual Rows": 90,
      "Actual Loops": 1,
      Plans: plans,
    },
    "Planning Time": 0.2,
    "Execution Time": time + 0.1,
  },
];

const BEFORE = join("Hash Join", 400, 12, [
  scan("Seq Scan", "orders", 300, 9),
  {
    ...scan("Hash", "", 50, 2),
    "Relation Name": undefined,
    Plans: [scan("Seq Scan", "customers", 50, 1.5)],
  },
]);
const AFTER = join("Nested Loop", 80, 1.2, [
  scan("Seq Scan", "customers", 50, 1.5),
  scan("Index Scan", "orders", 25, 0.5, { "Index Name": "orders_customer" }),
]);

describe("plans compared", () => {
  it("pairs the nodes of two plans and says what changed", () => {
    const { rows, changed } = comparePlans(postgresPlan(BEFORE), postgresPlan(AFTER));
    expect(
      rows.map((r) => [r.depth, r.before?.label ?? null, r.after?.label ?? null, r.changes]),
    ).toEqual([
      [
        0,
        "Hash Join",
        "Nested Loop",
        ["Hash Join → Nested Loop", "cost 400 → 80 (−80%)", "time 12 ms → 1.2 ms (−90%)"],
      ],
      [
        1,
        "Seq Scan on orders o",
        "Index Scan on orders o using orders_customer",
        ["Seq Scan → Index Scan", "cost 300 → 25 (−92%)", "time 9 ms → 0.5 ms (−94%)"],
      ],
      [1, "Hash", "Seq Scan on customers c", ["Hash → Seq Scan", "time 2 ms → 1.5 ms (−25%)"]],
      [2, "Seq Scan on customers c", null, ["gone"]],
    ]);
    expect(changed).toBe(4);
  });

  it("pairs a child by its type and relation before its place, and leaves small changes alone", () => {
    const moved = join("Hash Join", 410, 12.3, [
      {
        ...scan("Hash", "", 50, 2),
        "Relation Name": undefined,
        Plans: [scan("Seq Scan", "customers", 50, 1.52)],
      },
      scan("Seq Scan", "orders", 310, 9.4),
    ]);
    const { rows, changed } = comparePlans(postgresPlan(BEFORE), postgresPlan(moved));
    expect(rows.map((r) => [r.before?.label, r.after?.label, r.changes])).toEqual([
      ["Hash Join", "Hash Join", []],
      ["Seq Scan on orders o", "Seq Scan on orders o", []],
      ["Hash", "Hash", []],
      ["Seq Scan on customers c", "Seq Scan on customers c", []],
    ]);
    expect(changed).toBe(0);
    const more = join("Nested Loop", 80, 1.2, [
      scan("Seq Scan", "customers", 50, 1.5),
      scan("Index Scan", "orders", 25, 0.5, { "Index Name": "orders_customer" }),
      scan("Seq Scan", "refunds", 5, 0.1),
    ]);
    expect(comparePlans(postgresPlan(AFTER), postgresPlan(more)).rows.at(-1)).toMatchObject({
      before: null,
      after: { label: "Seq Scan on refunds r" },
      changes: ["added"],
    });
  });

  it("lays a plan out as a flame of its time, or its cost", () => {
    const root = postgresPlan(BEFORE);
    const { measure, blocks, depth } = flameOf(root);
    expect(measure).toBe("time");
    expect(depth).toBe(3);
    expect(
      blocks.map((b) => [b.node.label, b.depth, Number(b.x.toFixed(4)), Number(b.w.toFixed(4))]),
    ).toEqual([
      ["Hash Join", 0, 0, 1],
      ["Seq Scan on orders o", 1, 0, 0.75],
      ["Hash", 1, 0.75, 0.1667],
      ["Seq Scan on customers c", 2, 0.75, 0.125],
    ]);
    for (const b of blocks) expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9);
    const estimated = flameOf(planOf(setOf(captured()[0]?.plans.estimate)) as never);
    expect(estimated.measure).toBe("cost");
    expect(estimated.blocks[0]).toMatchObject({ x: 0, w: 1, depth: 0 });
    expect(flameOf(sqlitePlan([["2", "0", "0", "SCAN t"]])).blocks).toEqual([]);
  });

  it("writes the plan as text and as JSON", () => {
    const root = postgresPlan(BEFORE, JSON.stringify(BEFORE, null, 2));
    expect(planText(root).split("\n")).toEqual([
      "Hash Join  (cost=400.00 rows=100) (actual time=12 rows=90 loops=1)",
      "  ->  Seq Scan on orders o  (cost=300.00 rows=100) (actual time=9 rows=90 loops=1)",
      "  ->  Hash  (cost=50.00 rows=100) (actual time=2 rows=90 loops=1)",
      "        ->  Seq Scan on customers c  (cost=50.00 rows=100) (actual time=1.500 rows=90 loops=1)",
      "Planning Time: 0.200 ms",
      "Execution Time: 12.100 ms",
    ]);
    expect(planJson(root)).toBe(JSON.stringify(BEFORE, null, 2));
    const lite = sqlitePlan([["2", "0", "0", "SCAN t"]]);
    expect(JSON.parse(planJson(lite))).toEqual({
      label: "Query plan",
      children: [{ label: "SCAN t" }],
    });
    expect(planText(lite)).toBe("Query plan\n  ->  SCAN t");
    const write = planOf(setOf(captured()[0]?.plans.write));
    expect(planText(write as never)).toMatch(
      /^Trigger orders_audit on orders: time=[\d.]+ calls=20$/mu,
    );
  });
});
