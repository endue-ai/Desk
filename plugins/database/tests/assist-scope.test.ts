// The schema Eris is sent (PG-90): a large schema cut to the tables a statement or a sentence names
// and their neighbours by foreign key, both ways, within the stated budget of tables and characters.
import { describe, expect, it } from "vitest";
import { BUDGET, fit, namesIn, pick } from "../ui/features/assist/scope.js";

type Key = { schema: string; table: string; refSchema: string; refTable: string };

/** 300 tables t0 … t299 in public, each t<n> pointing at t<n-1>. */
const TABLES = Array.from({ length: 300 }, (_, i) => ({
  schema: "public",
  name: `t${i}`,
  kind: "table",
  comment: "",
}));
const KEYS: Key[] = TABLES.slice(1).map((t, i) => ({
  schema: "public",
  table: t.name,
  refSchema: "public",
  refTable: `t${i}`,
}));
const names = (tables: Array<{ name: string }>) => tables.map((t) => t.name);

describe("the schema cut", () => {
  it("finds the names a statement and a sentence use", () => {
    expect([...namesIn('select * from public."Orders" o join t5 on true', "postgresql")]).toEqual(
      expect.arrayContaining(["public", "orders", "o", "t5"]),
    );
    expect(namesIn("-- t9 in a comment\nselect 't8'", "postgresql").has("t8")).toBe(false);
    expect(namesIn("the customers who spent the most", "postgresql").has("customers")).toBe(true);
  });

  it("keeps what the statement names and their neighbours by foreign key, both ways", () => {
    const picked = pick(TABLES, KEYS, namesIn("select * from t150", "postgresql"), BUDGET.tables);
    expect(names(picked)).toEqual(["t150", "t149", "t151"]);
  });

  it("matches a sentence's word to a table by its singular or plural", () => {
    const shop = [
      { schema: "public", name: "orders", kind: "table", comment: "" },
      { schema: "public", name: "people", kind: "table", comment: "" },
      { schema: "public", name: "refunds", kind: "table", comment: "" },
    ];
    const keys = [{ schema: "public", table: "orders", refSchema: "public", refTable: "people" }];
    const picked = pick(shop, keys, namesIn("each order of last week", "postgresql"), 24);
    expect(names(picked)).toEqual(["orders", "people"]);
  });

  it("sends the first tables by name when nothing is named, within the table budget", () => {
    const picked = pick(TABLES, KEYS, namesIn("how many rows", "postgresql"), BUDGET.tables);
    expect(picked).toHaveLength(BUDGET.tables);
  });

  it("stays within the table budget when many are named", () => {
    const text = TABLES.slice(0, 40)
      .map((t) => `select * from ${t.name};`)
      .join("\n");
    const picked = pick(TABLES, KEYS, namesIn(text, "postgresql"), BUDGET.tables);
    expect(picked).toHaveLength(BUDGET.tables);
    expect(names(picked).slice(0, 3)).toEqual(["t0", "t1", "t2"]);
  });

  it("keeps whole tables within the character budget and counts the ones left out", () => {
    const wide = Array.from({ length: 30 }, (_, i) => ({
      name: `public.w${i}`,
      kind: "table",
      columns: Array.from({ length: 40 }, (_, c) => ({ name: `column_${c}`, type: "text" })),
      references: [],
    }));
    const kept = fit(wide, BUDGET.chars);
    expect(JSON.stringify(kept.tables).length).toBeLessThanOrEqual(BUDGET.chars);
    expect(kept.tables.length).toBeGreaterThan(0);
    expect(kept.tables.length + kept.left).toBe(30);
    expect(kept.tables.every((t) => t.columns.length === 40)).toBe(true);
  });
});
