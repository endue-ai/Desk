// EXPLAIN output as a plan tree with cost highlights: PostgreSQL's JSON (with ANALYZE too), MySQL's
// JSON and EXPLAIN ANALYZE tree, MariaDB's JSON, SQLite's QUERY PLAN rows. Fixtures as the clients
// print them (one row, one column, for the first four).
import { describe, expect, it } from "vitest";
import { explainSql, flatten, planOf } from "../ui/explain/plan.js";

const one = (column: string, value: string) => ({
  columns: [column],
  rows: [[value]],
  truncated: false,
});
const shape = (set: Parameters<typeof planOf>[0]) => {
  const root = planOf(set);
  if (!root) throw new Error("no plan");
  return flatten(root).map(
    ({ node, depth }) => `${"  ".repeat(depth)}${node.label}${node.hot ? ` [${node.hot}]` : ""}`,
  );
};

const PG = JSON.stringify([
  {
    Plan: {
      "Node Type": "Hash Join",
      "Join Type": "Inner",
      "Startup Cost": 1.07,
      "Total Cost": 40.5,
      "Plan Rows": 120,
      "Hash Cond": "(o.customer_id = c.id)",
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "orders",
          Alias: "o",
          "Total Cost": 30,
          "Plan Rows": 1200,
          Filter: "(total > '0'::numeric)",
        },
        {
          "Node Type": "Hash",
          "Total Cost": 5,
          "Plan Rows": 10,
          Plans: [
            {
              "Node Type": "Index Scan",
              "Relation Name": "customers",
              Alias: "c",
              "Index Name": "customers_pkey",
              "Total Cost": 5,
              "Plan Rows": 10,
            },
          ],
        },
      ],
    },
  },
]);

describe("explain", () => {
  it("reads PostgreSQL's JSON plan, marking where the cost goes", () => {
    expect(shape(one("QUERY PLAN", PG))).toEqual([
      "Hash Join",
      "  Seq Scan on orders o [high]",
      "  Hash",
      "    Index Scan on customers c using customers_pkey",
    ]);
    const root = planOf(one("QUERY PLAN", PG));
    expect(root).toMatchObject({
      cost: 40.5,
      rows: 120,
      detail: "Hash Cond: (o.customer_id = c.id)",
    });
    expect(root?.children[0]?.share).toBeCloseTo(30 / 40.5);
  });

  it("uses the time when the statement ran (ANALYZE), over all its loops", () => {
    const analyzed = JSON.stringify([
      {
        Plan: {
          "Node Type": "Nested Loop",
          "Join Type": "Left",
          "Total Cost": 10,
          "Actual Total Time": 12,
          "Actual Rows": 5,
          "Actual Loops": 1,
          Plans: [
            {
              "Node Type": "Seq Scan",
              "Relation Name": "a",
              "Total Cost": 1,
              "Actual Total Time": 1,
              "Actual Rows": 5,
              "Actual Loops": 1,
            },
            {
              "Node Type": "Index Scan",
              "Relation Name": "b",
              "Total Cost": 8,
              "Actual Total Time": 2,
              "Actual Rows": 1,
              "Actual Loops": 5,
            },
          ],
        },
        "Execution Time": 12.3,
      },
    ]);
    const root = planOf(one("QUERY PLAN", analyzed));
    expect(root?.label).toBe("Nested Loop (Left)");
    expect(root?.children.map((c) => [c.time, c.hot])).toEqual([
      [1, ""],
      [10, "high"],
    ]);
  });

  it("reads MySQL's JSON plan, a table's own cost against the whole", () => {
    const json = JSON.stringify({
      query_block: {
        select_id: 1,
        cost_info: { query_cost: "10.00" },
        ordering_operation: {
          using_filesort: true,
          nested_loop: [
            {
              table: {
                table_name: "o",
                access_type: "ALL",
                rows_examined_per_scan: 1000,
                cost_info: { read_cost: "6.00", eval_cost: "1.00" },
                attached_condition: "(`o`.`total` > 0)",
              },
            },
            {
              table: {
                table_name: "c",
                access_type: "eq_ref",
                key: "PRIMARY",
                rows_examined_per_scan: 1,
                cost_info: { read_cost: "2.50", eval_cost: "0.50" },
              },
            },
          ],
        },
      },
    });
    expect(shape(one("EXPLAIN", json))).toEqual([
      "Query block #1",
      "  Sort (filesort)",
      "    Nested loop",
      "      Full table scan on o [high]",
      "      Unique index lookup on c using PRIMARY [medium]",
    ]);
    const mariadb = JSON.stringify({
      query_block: { select_id: 1, table: { table_name: "t", access_type: "ALL", rows: 3 } },
    });
    expect(shape(one("EXPLAIN", mariadb))).toEqual(["Query block #1", "  Full table scan on t"]);
  });

  it("reads MySQL's EXPLAIN ANALYZE tree by its indentation", () => {
    const tree = [
      "-> Nested loop inner join  (cost=4.50 rows=3) (actual time=0.10..9.00 rows=3 loops=1)",
      "    -> Table scan on o  (cost=1.00 rows=3) (actual time=0.05..0.50 rows=3 loops=1)",
      "    -> Single-row index lookup on c using PRIMARY (id=o.customer_id)  (cost=1.00 rows=1) (actual time=2.00..2.50 rows=1 loops=3)",
    ].join("\n");
    expect(shape(one("EXPLAIN", tree))).toEqual([
      "Nested loop inner join",
      "  Table scan on o",
      "  Single-row index lookup on c using PRIMARY (id=o.customer_id) [high]",
    ]);
    expect(planOf(one("EXPLAIN", tree))?.children[1]).toMatchObject({
      time: 7.5,
      actualRows: 3,
      rows: 1,
    });
  });

  it("reads SQLite's query plan rows into a tree and marks full scans", () => {
    const set = {
      columns: ["id", "parent", "notused", "detail"],
      rows: [
        ["2", "0", "0", "SCAN o"],
        ["4", "0", "0", "SEARCH c USING INTEGER PRIMARY KEY (rowid=?)"],
        ["7", "0", "0", "SCALAR SUBQUERY 1"],
        ["9", "7", "0", "SCAN t USING COVERING INDEX t_a"],
      ],
      truncated: false,
    };
    expect(shape(set)).toEqual([
      "Query plan",
      "  SCAN o [medium]",
      "  SEARCH c USING INTEGER PRIMARY KEY (rowid=?)",
      "  SCALAR SUBQUERY 1",
      "    SCAN t USING COVERING INDEX t_a",
    ]);
    expect(planOf({ columns: ["a"], rows: [["1"]], truncated: false })).toBeUndefined();
  });

  it("writes the EXPLAIN each engine reads", () => {
    expect(explainSql("postgresql", "postgresql", "select 1", false)).toBe(
      "EXPLAIN (FORMAT JSON) select 1",
    );
    expect(explainSql("postgresql", "postgresql", "select 1", true)).toBe(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) select 1",
    );
    expect(explainSql("mysql", "mysql", "select 1", false)).toBe("EXPLAIN FORMAT=JSON select 1");
    expect(explainSql("mysql", "mysql", "select 1", true)).toBe("EXPLAIN ANALYZE select 1");
    expect(explainSql("mysql", "mariadb", "select 1", true)).toBe("ANALYZE FORMAT=JSON select 1");
    expect(explainSql("sqlite", "sqlite", "select 1", false)).toBe("EXPLAIN QUERY PLAN select 1");
    expect(() => explainSql("sqlite", "sqlite", "select 1", true)).toThrow(/no EXPLAIN ANALYZE/u);
  });
});
