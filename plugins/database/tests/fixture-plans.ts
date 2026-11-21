// Fixture plans for the runtime e2e page and its screenshots (packages/runtime/e2e/fixture/database.ts):
// the scripted server answers the server's version and EXPLAIN with a plan of a join (orders joined to
// customers in the north, by total), one plan before `create index` and another after it, so the
// plan tab, its flame and two plans compared have something to show. fixtures.ts puts them in front
// of its script, so every PostgreSQL connection on the page gets them ("warehouse" in the e2e).
// Fixture data only; nothing here needs Node.
import type { Answer, Script } from "./clients";

const ran = (rows: number, time: number, loops = 1) => ({
  "Actual Startup Time": 0.01,
  "Actual Total Time": time,
  "Actual Rows": rows,
  "Actual Loops": loops,
});
const cost = (total: number, rows: number) => ({
  "Startup Cost": 0,
  "Total Cost": total,
  "Plan Rows": rows,
  "Plan Width": 40,
});
const blocks = (hit: number, read = 0) => ({
  "Shared Hit Blocks": hit,
  "Shared Read Blocks": read,
});
const customers = {
  "Node Type": "Seq Scan",
  "Relation Name": "customers",
  Alias: "c",
  ...cost(22.5, 2),
  ...ran(20, 0.7),
  Filter: "(region = 'north'::text)",
  "Rows Removed by Filter": 1980,
  ...blocks(20),
};
const statement = (plan: object, execution: number) => [
  {
    Plan: plan,
    Planning: blocks(18),
    "Planning Time": 0.31,
    Triggers: [],
    "Execution Time": execution,
  },
];

/** Before the index: a hash join over a sequential scan of orders, sorted on disk. */
const BEFORE = statement(
  {
    "Node Type": "Sort",
    ...cost(1893.65, 100),
    ...ran(6000, 32.9),
    "Sort Key": ["o.total"],
    "Sort Method": "external merge",
    "Sort Space Used": 192,
    "Sort Space Type": "Disk",
    ...blocks(420, 12),
    "Temp Read Blocks": 24,
    "Temp Written Blocks": 24,
    Plans: [
      {
        "Node Type": "Hash Join",
        "Join Type": "Inner",
        ...cost(1889.9, 100),
        ...ran(6000, 27.4),
        "Hash Cond": "(o.customer_id = c.id)",
        ...blocks(420, 12),
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Relation Name": "orders",
            Alias: "o",
            ...cost(1100, 60000),
            ...ran(60000, 18.6),
            ...blocks(400, 12),
          },
          {
            "Node Type": "Hash",
            ...cost(22.5, 2),
            ...ran(20, 0.8),
            "Hash Buckets": 1024,
            "Hash Batches": 1,
            "Original Hash Batches": 1,
            "Peak Memory Usage": 9,
            ...blocks(20),
            Plans: [customers],
          },
        ],
      },
    ],
  },
  33.4,
);

/** After it: a nested loop that looks each customer's orders up in the index. */
const AFTER = statement(
  {
    "Node Type": "Sort",
    ...cost(412.8, 100),
    ...ran(6000, 4.1),
    "Sort Key": ["o.total"],
    "Sort Method": "quicksort",
    "Sort Space Used": 628,
    "Sort Space Type": "Memory",
    ...blocks(86),
    Plans: [
      {
        "Node Type": "Nested Loop",
        "Join Type": "Inner",
        ...cost(408.5, 100),
        ...ran(6000, 3.2),
        ...blocks(86),
        Plans: [
          customers,
          {
            "Node Type": "Index Scan",
            "Relation Name": "orders",
            Alias: "o",
            "Index Name": "orders_customer_idx",
            ...cost(190.3, 50),
            ...ran(300, 0.11, 20),
            "Index Cond": "(customer_id = c.id)",
            ...blocks(66),
          },
        ],
      },
    ],
  },
  4.4,
);

/** A one-column EXPLAIN's field as it is, under its header row (clients.ts). */
const planRows = (plan: unknown): Answer => ({
  rows: [["QUERY PLAN"], [JSON.stringify(plan, null, 2)]],
});

/** `script` with PostgreSQL's version and plans in front; `create index` turns the plan into the other. */
export function withPlans(script: Script): Script {
  let indexed = false;
  return (sql, env) => {
    const text = sql.trim();
    if (text === "SHOW server_version_num") return { rows: [["server_version_num"], ["170006"]] };
    if (/^create index/iu.test(text)) {
      indexed = true;
      return { changes: 0 };
    }
    if (/^EXPLAIN \(/u.test(text)) return planRows(indexed ? AFTER : BEFORE);
    return script(sql, env);
  };
}
