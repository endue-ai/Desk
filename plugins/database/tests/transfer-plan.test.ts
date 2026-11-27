// A query's result copied (PG-63): into a new table of the columns the server describes, or appended
// to a table already there by a column mapping, a left-out column and a type of another kind said.
import { describe, expect, it } from "vitest";
import { keyOf } from "../ui/transfer/ddl.js";
import { planQuery, scriptOf } from "../ui/transfer/plan.js";

const version = { number: 170002, text: "17.2" };
const described = [
  { name: "day", type: "date" },
  { name: "total", type: "numeric" },
  { name: "note", type: "text" },
];
const facts = (tables: [string, { name: string; type: string; generated: boolean }[]][] = []) => ({
  source: version,
  target: { version, missing: [], schemas: ["public"], tables: new Map(tables) },
});
const query = "select day, sum(n) as total, '' as note from sales group by day -- daily\n;";

describe("a query's result into a table", () => {
  it("goes into a new table", () => {
    const plan = planQuery(
      query,
      described,
      { schema: "public", name: "daily", append: false },
      facts(),
    );
    expect(plan.report).toEqual({ problems: [], notes: [] });
    expect(plan.setup).toBe(
      'CREATE TABLE "public"."daily" (\n    "day" date,\n    "total" numeric,\n    "note" text\n);\n',
    );
    expect(plan.steps).toEqual([
      {
        source: "the query",
        target: "public.daily",
        out: "COPY (select day, sum(n) as total, '' as note from sales group by day -- daily\n) TO STDOUT",
        in: 'COPY "public"."daily" ("day", "total", "note") FROM STDIN',
      },
    ]);
    expect(scriptOf(plan)).toMatch(/^BEGIN;\n\nCREATE TABLE/u);
  });

  it("is appended to an existing table with a column mapping", () => {
    const held = facts([
      [
        keyOf("public", "daily"),
        [
          { name: "day", type: "date", generated: false },
          { name: "amount", type: "numeric(12,2)", generated: false },
          { name: "id", type: "bigint", generated: false },
        ],
      ],
    ]);
    const plan = planQuery(
      query,
      described,
      { schema: "public", name: "daily", append: true, mapping: { total: "amount", note: "" } },
      held,
    );
    expect(plan.setup).toBe("");
    expect(plan.report).toEqual({ problems: [], notes: [] });
    expect(plan.steps[0]?.out).toBe(
      `COPY (SELECT "day", "total" FROM (${query.slice(0, -2)}\n) AS q) TO STDOUT`,
    );
    expect(plan.steps[0]?.in).toBe('COPY "public"."daily" ("day", "amount") FROM STDIN');
    const wrong = planQuery(
      query,
      described,
      { schema: "public", name: "daily", append: true, mapping: { total: "day", note: "id" } },
      held,
    );
    expect(wrong.report.problems).toEqual([
      "Two result columns go into day: map each to its own column.",
    ]);
    expect(wrong.report.notes).toEqual([
      "public.daily.day is numeric here and date on the target: each value is read as the target's type.",
      "public.daily.id is text here and bigint on the target: each value is read as the target's type.",
    ]);
    const none = planQuery(
      query,
      described,
      { schema: "public", name: "gone", append: true },
      held,
    );
    expect(none.report.problems).toEqual([
      "public.gone is not on the target: copy its structure too.",
    ]);
  });
});
