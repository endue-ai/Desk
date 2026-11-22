// A new table from a file's sample (PG-60): each column's type the narrowest every value reads as,
// its name a plain SQL name, and the CREATE TABLE with the person's corrections.
import { describe, expect, it } from "vitest";
import {
  createTable,
  inferColumns,
  inferType,
  plainName,
  tableFromFile,
} from "../ui/import-copy/infer.js";

describe("inferring a column's type", () => {
  it.each([
    [["true", "f", "yes", null], "boolean"],
    [["1", "-42", ""], "integer"],
    [["1", "3000000000"], "bigint"],
    [["1", "2.5", "1e3"], "numeric"],
    [["2026-11-23", null], "date"],
    [["2026-11-23 09:00:00", "2026-11-23T10:15"], "timestamp"],
    [["2026-11-23 09:00:00+00", "2026-11-23T10:15:00Z"], "timestamptz"],
    [["2026-11-23", "2026-11-23 09:00:00"], "timestamp"],
    [["6f9619ff-8b86-d011-b42d-00cf4fc964ff"], "uuid"],
    [['{"a": 1}', "[1, 2]"], "jsonb"],
    [["1", "x"], "text"],
    [[null, ""], "text"],
  ])("%j reads as %s", (values, type) => {
    expect(inferType(values, "")).toBe(type);
  });

  it("reads 23/11/2026 as a date only when a date order is chosen", () => {
    expect(inferType(["23/11/2026"], "")).toBe("text");
    expect(inferType(["23/11/2026", "01.02.2026"], "DMY")).toBe("date");
  });
});

describe("a new table's columns", () => {
  it("makes plain, unique names and infers each type from the sample", () => {
    const columns = inferColumns(
      ["Order ID", "order id", "Zoë's Total ($)", "", "2nd"],
      [
        ["1", "a", "9.50", null, "x"],
        ["2", "b", "10", null, "y"],
      ],
      "",
    );
    expect(columns).toEqual([
      { name: "order_id", type: "integer" },
      { name: "order_id_2", type: "text" },
      { name: "zoe_s_total", type: "numeric" },
      { name: "column", type: "text" },
      { name: "c_2nd", type: "text" },
    ]);
    expect(plainName("--")).toBe("column");
    expect(tableFromFile("Sales 2026.csv")).toBe("sales_2026");
  });

  it("writes the CREATE TABLE, leaving out a column with no name", () => {
    expect(
      createTable('"public"."sales"', [
        { name: "id", type: "bigint" },
        { name: "", type: "text" },
        { name: "price", type: "numeric(10,2)" },
      ]),
    ).toEqual({
      sql: 'CREATE TABLE "public"."sales" (\n  "id" bigint,\n  "price" numeric(10,2)\n)',
    });
  });

  it("refuses no column, a name twice and a type that is not one", () => {
    expect(createTable("t", [{ name: "", type: "text" }])).toEqual({
      problem: "Give at least one column a name.",
    });
    expect(
      createTable("t", [
        { name: "a", type: "text" },
        { name: "a", type: "int" },
      ]),
    ).toEqual({ problem: "Two columns are named a." });
    expect(createTable("t", [{ name: "a", type: "text; drop table x" }])).toMatchObject({
      problem: expect.stringMatching(/^a: name a type/u),
    });
  });
});
