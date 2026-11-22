// What Eris is sent from a console (PG-90): the statement, the error's SQLSTATE, message, position
// and HINT, a plan's nodes and the names, types and comments of the tables in scope. Never a result's
// values, an error's DETAIL or CONTEXT lines, a column's default or a typed parameter's value, unless
// the person ticks a sample, and never a sample from a production connection unless that is on.
import { describe, expect, it } from "vitest";
import type { Connection, DbError, ResultSet } from "../ui/engines/common.js";
import { node } from "../ui/explain/node.js";
import {
  errorFacts,
  factsOf,
  LIMITS,
  planFacts,
  promptOf,
  sampleAllowed,
  sampleOf,
} from "../ui/features/assist/payload.js";

const CONN = {
  id: "c-shop",
  name: "shop",
  engine: "postgresql",
  tag: "none",
  readOnly: false,
} as Connection;

const ERROR: DbError = {
  kind: "sql",
  code: "23505",
  message: 'duplicate key value violates unique constraint "people_email_key"',
  detail: [
    "DETAIL:  Key (email)=(ada@example.test) already exists.",
    "HINT:  Pick another email.",
    "CONTEXT:  SQL function \"add_person\" statement 1 with value 'secret-value'",
  ].join("\n"),
  position: 7,
};

const SET: ResultSet = {
  columns: ["id", "email"],
  rows: [
    ["1", "ada@example.test"],
    ["2", "bob@example.test"],
    ["3", null],
    ["4", "dee@example.test"],
    ["5", "eve@example.test"],
    ["6", "fay@example.test"],
  ],
  truncated: false,
};

const SCHEMA = {
  tables: [
    {
      name: "public.people",
      kind: "table",
      comment: "Who buys",
      columns: [
        { name: "id", type: "integer" },
        { name: "email", type: "text", comment: "Where receipts go" },
      ],
      references: [],
    },
  ],
  left: 3,
  of: 4,
};

const fix = (sample?: ResultSet | null) =>
  factsOf({
    task: "fix",
    conn: CONN,
    statement: "insert into people (email) values (:email)",
    error: ERROR,
    schema: SCHEMA,
    ...(sample ? { sample } : {}),
  });

describe("what is sent", () => {
  it("is the statement, the error without its value lines, and the schema's names, types and comments", () => {
    const facts = fix();
    const prompt = promptOf("fix", facts);
    expect(facts.statement).toBe("insert into people (email) values (:email)");
    expect(facts.error).toEqual({
      code: "23505",
      message: 'duplicate key value violates unique constraint "people_email_key"',
      position: 7,
      hint: "Pick another email.",
    });
    expect(facts.schema.tables[0]).toEqual(SCHEMA.tables[0]);
    expect(facts.schema.left).toBe(3);
    expect(facts.sample).toBeUndefined();
    for (const value of ["ada@example.test", "already exists", "secret-value", "CONTEXT"])
      expect(prompt).not.toContain(value);
    expect(prompt).toContain("Who buys");
    expect(prompt).toContain("Where receipts go");
    expect(prompt).toContain("fix_sql_error");
    expect(prompt).toMatch(/3 more tables are not sent/u);
  });

  it("sends a sample of rows and the error's value lines only when one is ticked", () => {
    const facts = fix(SET);
    const prompt = promptOf("fix", facts);
    expect(facts.sample?.rows).toHaveLength(LIMITS.sampleRows);
    expect(facts.sample?.columns).toEqual(["id", "email"]);
    expect(facts.error?.detail).toContain("already exists");
    expect(prompt).toContain("ada@example.test");
    expect(prompt).not.toContain("fay@example.test");
    // NULL stays apart from text.
    expect(facts.sample?.rows[2]).toEqual(["3", null]);
  });

  it("keeps a sample within its characters", () => {
    const wide: ResultSet = {
      columns: ["doc"],
      rows: Array.from({ length: 5 }, () => ["x".repeat(3000)]),
      truncated: false,
    };
    const sample = sampleOf(wide);
    expect(JSON.stringify(sample).length).toBeLessThanOrEqual(LIMITS.sample);
    expect(sampleOf({ columns: [], rows: [], truncated: false })).toBeUndefined();
  });

  it("never sends an error's DETAIL without the sample", () => {
    expect(errorFacts(ERROR, false)).not.toHaveProperty("detail");
    expect(errorFacts({ kind: "sql", message: "boom" }, false)).toEqual({ message: "boom" });
  });

  it("allows a sample from a production connection only when that is on for it", () => {
    expect(sampleAllowed(CONN, { production: false })).toEqual({ ok: true, why: "" });
    const prod = { ...CONN, tag: "production" } as Connection;
    expect(sampleAllowed(prod, { production: false }).ok).toBe(false);
    expect(sampleAllowed(prod, { production: false }).why).toMatch(/production/u);
    expect(sampleAllowed(prod, { production: true }).ok).toBe(true);
  });

  it("sends a plan's nodes, conditions, estimates and timings, cut to its budget", () => {
    const leaf = node({ label: "Seq Scan on orders o", detail: "Filter: (total > 100)" });
    leaf.rows = 10;
    leaf.actualRows = 500;
    leaf.time = 12.5;
    leaf.marks = [{ kind: "misestimate", level: "high", text: "50× more rows than estimated" }];
    const root = node({ label: "Hash Join", children: [leaf] });
    root.cost = 99;
    const facts = planFacts(root);
    expect(facts).toEqual({
      node: "Hash Join",
      cost: 99,
      children: [
        {
          node: "Seq Scan on orders o",
          detail: "Filter: (total > 100)",
          rows: 10,
          actualRows: 500,
          ms: 12.5,
          marks: ["50× more rows than estimated"],
        },
      ],
    });
    // A deep plan is cut to what fits.
    let deep = node({ label: "Result" });
    for (let i = 0; i < 400; i++)
      deep = node({ label: `Node ${i} ${"y".repeat(60)}`, children: [deep] });
    expect(JSON.stringify(planFacts(deep)).length).toBeLessThanOrEqual(LIMITS.plan + 200);
  });

  it("cuts a long statement and a long request, and says so", () => {
    const facts = factsOf({
      task: "write",
      conn: CONN,
      request: "r".repeat(LIMITS.request + 50),
      statement: "s".repeat(LIMITS.statement + 50),
      schema: SCHEMA,
    });
    expect(facts.request?.length).toBeLessThan(LIMITS.request + 60);
    expect(facts.request).toMatch(/more characters cut/u);
    expect(facts.statement?.length).toBeLessThan(LIMITS.statement + 60);
    const prompt = promptOf("write", facts);
    expect(prompt.length).toBeLessThanOrEqual(32_000);
    expect(prompt).toContain("propose_sql");
  });
});
