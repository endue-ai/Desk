// Sorting or filtering a read its cursor keeps, not fully read (PG-22, ADR 0352, rows/control.js):
// it needs every row, so the grid's keys and filters go into the statement, which runs again with
// ORDER BY and WHERE around it on the server, and the status line says so and offers Fetch every
// row; the shape stays with the result, and a result held whole is left to the frame.
import { describe, expect, it } from "vitest";
import { shapedSql } from "../ui/rows/control.js";
import type { Script } from "./harness";
import { rawRunsOf } from "./runs-of";
import { script as base, run, shop } from "./session-helpers";

const numbers = (count: number) => [
  ["n"],
  ...Array.from({ length: count }, (_, i) => [String(i + 1)]),
];
const script: Script = (sql, who) => {
  if (/^select n from big/u.test(sql) || /endue_rows/u.test(sql)) return { rows: numbers(1200) };
  return base(sql, who);
};
type Mounted = Awaited<ReturnType<typeof shop>>;
const declared = (m: Mounted) =>
  rawRunsOf(m.host.calls)
    .map((c) => (c.params as { sql?: string }).sql ?? "")
    .filter((sql) => sql.startsWith("DECLARE"))
    .map((sql) => sql.slice("DECLARE endue_desk_rows SCROLL CURSOR FOR\n".length));
const key = { key: "n", name: "n", direction: "desc" as const };
const filter = { key: "n", name: "n", op: "gt" as const, value: "10", numeric: true };

describe("sorting and filtering a read not fully read", () => {
  it("puts the keys and filters around the statement", () => {
    expect(shapedSql("select n from big;", "postgresql", [key], [filter])).toBe(
      'SELECT * FROM (\nselect n from big\n) AS endue_rows\nWHERE "n" > 10\nORDER BY "n" DESC',
    );
    expect(shapedSql("select n from big", "postgresql", [], [])).toBe("select n from big");
  });

  it("a sort runs the statement again with ORDER BY, says it needs every row, and keeps the shape", async () => {
    const m = await shop({ script });
    await run(m, "select n from big");
    await m.app.page({ sort: [key] });
    expect(declared(m).at(-1)).toBe(
      'SELECT * FROM (\nselect n from big\n) AS endue_rows\nORDER BY "n" DESC',
    );
    expect(m.view.said.at(-1)).toMatch(/Sorting needs every row.*ORDER BY.*Fetch every row/u);
    const set = m.shown()?.shown?.tabs[0]?.set;
    expect(set?.window).toMatchObject({ base: "select n from big", sort: [key], filters: [] });
    // A filter then joins the sort, around the statement as typed.
    await m.app.page({ filters: [filter] });
    expect(declared(m).at(-1)).toBe(
      'SELECT * FROM (\nselect n from big\n) AS endue_rows\nWHERE "n" > 10\nORDER BY "n" DESC',
    );
    expect(m.view.said.at(-1)).toMatch(/Filtering needs every row.*WHERE/u);
    // The editor still holds the statement as typed.
    expect(m.shown()?.text).toBe("select n from big");
  });
});
