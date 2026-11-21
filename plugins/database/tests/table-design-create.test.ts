// A new table's script from the table form's model (PG-51, ui/features/table-design/): CREATE TABLE
// with every part of the form, every identifier quoted, then its indexes, comments and owner, all
// between BEGIN and COMMIT; and what the form refuses to write, said in words while Run waits.
import { describe, expect, it } from "vitest";
import {
  addColumn,
  addPart,
  setColumn,
  setPart,
  setPartition,
  setTable,
  toggleKey,
  typeFrom,
} from "../ui/features/table-design/edits.js";
import { blank, type Column, type Design } from "../ui/features/table-design/model.js";
import { scriptOf } from "../ui/features/table-design/script.js";
import { shopFacts } from "./table-design-fixture";

const facts = shopFacts();

/** A new table in `schema` with these columns; answers the design and their ids by name. */
function table(
  name: string,
  columns: Array<Partial<Column> & { name: string }>,
  schema = "public",
) {
  let d: Design = setTable(blank(schema), { name });
  const ids: Record<string, string> = {};
  for (const c of columns) {
    const made = addColumn(d, c);
    d = made.design;
    ids[c.name] = made.id;
  }
  return { d, ids };
}

describe("the table form's CREATE script", () => {
  it("writes CREATE TABLE for every part of the form", () => {
    let { d, ids } = table("Orders 2026", [
      { name: "id", type: "bigint" },
      { name: "Code", type: "character varying", length: "12", nullable: false },
      { name: "placed", type: "timestamp with time zone", length: "3", default: "now()" },
      { name: "tags", type: "text", array: true },
      { name: "mood", type: "app.mood" },
      { name: "qty", type: "integer", default: "1" },
      { name: "price", type: "numeric", length: "10, 2" },
      { name: "total", type: "numeric", generated: "qty * price" },
      { name: "parent", type: "bigint" },
      { name: "person", type: "integer" },
      { name: 'say "hi"', type: "text", comment: "It's quoted" },
    ]);
    d = setColumn(d, ids.id as string, { identity: "always" });
    d = toggleKey(d, ids.id as string);
    d = setPart(d, "primaryKey", d.primaryKey?.id ?? "", { name: "orders_pk" });
    let made = addPart(d, "uniques", { columns: [ids.Code, ids.placed] });
    d = made.design;
    made = addPart(d, "checks", { name: "qty_positive", expression: "qty > 0" });
    d = made.design;
    made = addPart(d, "foreignKeys", {
      name: "",
      columns: [ids.person],
      refSchema: "public",
      refTable: "people",
      refColumns: ["id"],
      onDelete: "SET NULL",
    });
    d = made.design;
    made = addPart(d, "foreignKeys", {
      name: "orders_parent",
      columns: [ids.parent],
      self: true,
      refColumns: [ids.id],
      onDelete: "CASCADE",
      onUpdate: "RESTRICT",
    });
    d = made.design;
    made = addPart(d, "indexes", {
      name: "orders by code",
      keys: [
        { column: ids.Code, expression: "" },
        { column: "", expression: "lower(mood::text)" },
      ],
      unique: true,
      where: "qty > 1",
    });
    d = made.design;
    made = addPart(d, "indexes", { method: "gin", keys: [{ column: ids.tags, expression: "" }] });
    d = setTable(made.design, { comment: "What was bought", owner: "reports" });

    const script = scriptOf(null, d, facts);
    expect(script.problems).toEqual([]);
    expect(script.after).toEqual([]);
    expect(script.text).toBe(
      [
        "BEGIN;",
        "",
        'CREATE TABLE "public"."Orders 2026" (',
        '    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,',
        '    "Code" character varying(12) NOT NULL,',
        '    "placed" timestamp(3) with time zone DEFAULT now(),',
        '    "tags" text[],',
        '    "mood" "app"."mood",',
        '    "qty" integer DEFAULT 1,',
        '    "price" numeric(10,2),',
        '    "total" numeric GENERATED ALWAYS AS (qty * price) STORED,',
        '    "parent" bigint,',
        '    "person" integer,',
        '    "say ""hi""" text,',
        '    CONSTRAINT "orders_pk" PRIMARY KEY ("id"),',
        '    UNIQUE ("Code", "placed"),',
        '    CONSTRAINT "qty_positive" CHECK (qty > 0),',
        '    FOREIGN KEY ("person") REFERENCES "public"."people" ("id") ON DELETE SET NULL,',
        '    CONSTRAINT "orders_parent" FOREIGN KEY ("parent") REFERENCES "public"."Orders 2026" ("id") ON DELETE CASCADE ON UPDATE RESTRICT',
        ");",
        "",
        'CREATE UNIQUE INDEX "orders by code" ON "public"."Orders 2026" USING "btree" ("Code", (lower(mood::text))) WHERE qty > 1;',
        "",
        'CREATE INDEX ON "public"."Orders 2026" USING "gin" ("tags");',
        "",
        `COMMENT ON TABLE "public"."Orders 2026" IS 'What was bought';`,
        "",
        `COMMENT ON COLUMN "public"."Orders 2026"."say ""hi""" IS 'It''s quoted';`,
        "",
        'ALTER TABLE "public"."Orders 2026" OWNER TO "reports";',
        "",
        "COMMIT;",
        "",
      ].join("\n"),
    );
  });

  it("partitions a new table by its keys and says its partitions come after", () => {
    let { d, ids } = table("events", [
      { name: "day", type: "date", nullable: false },
      { name: "id", type: "bigint" },
      { name: "kind", type: "text" },
    ]);
    d = setPartition(d, { by: "range", keys: [{ column: ids.day as string, expression: "" }] });
    d = toggleKey(toggleKey(d, ids.id as string), ids.day as string);
    const script = scriptOf(null, d, facts);
    expect(script.problems).toEqual([]);
    expect(script.inside[0]?.sql).toBe(
      'CREATE TABLE "public"."events" (\n    "day" date NOT NULL,\n    "id" bigint NOT NULL,\n    "kind" text,\n    PRIMARY KEY ("id", "day")\n) PARTITION BY RANGE ("day")',
    );
    expect(script.inside[0]?.marks[0]).toMatch(/^Rows go into its partitions/u);
    expect(script.text).toContain("-- Rows go into its partitions");

    const hashed = setPartition(d, {
      by: "hash",
      keys: [{ column: "", expression: "lower(kind)" }],
    });
    expect(scriptOf(null, hashed, facts).problems).toEqual([
      "The primary key cannot go with a partition key that holds an expression.",
    ]);
    const missing = setPartition(d, {
      by: "list",
      keys: [{ column: ids.kind as string, expression: "" }],
    });
    expect(scriptOf(null, missing, facts).problems).toEqual([
      "The primary key must hold the partition columns: kind.",
    ]);
  });

  it("says what the form cannot write; Run waits while any is there", () => {
    const { d, ids } = table("", [
      { name: "", type: "integer" },
      { name: "a", type: "intt" },
      { name: "b", type: "integer", length: "4" },
      { name: "c", type: "character varying", length: "big" },
      { name: "d", type: "text", default: "1; DROP TABLE x" },
      { name: "e", type: "text", identity: "always" },
      { name: "f", type: "integer", generated: "a + (b" },
      { name: "a", type: "integer" },
    ]);
    const more = addPart(d, "foreignKeys", {
      columns: [ids.b],
      refSchema: "public",
      refTable: "people",
    });
    const owned = setTable(more.design, { owner: "nobody" });
    expect(scriptOf(null, owned, facts).problems).toEqual([
      "The table has no name.",
      "Column 1 has no name.",
      "Column a has the type intt, which this server does not have: pick one of its.",
      "Column b has a length, which integer does not take.",
      "Column c has the length big: write a number, or two with a comma (10,2).",
      "The default of column d is not one expression: it holds a ; or a comment, or its parentheses do not close.",
      "Column e is an identity: that takes smallint, integer or bigint.",
      "The generation of column f is not one expression: it holds a ; or a comment, or its parentheses do not close.",
      "Two columns are named a: rename one.",
      "Foreign key (no name) references no columns.",
      "There is no role nobody on this server to own the table.",
    ]);
    const long = table("x".repeat(64), [{ name: "é".repeat(32), type: "integer" }]).d;
    expect(scriptOf(null, long, facts).problems).toEqual([
      "The table's name is longer than PostgreSQL's 63 bytes.",
      "Column ééééééééééééééééééééééééééééééééé's name is longer than PostgreSQL's 63 bytes.".replace(
        "ééééééééééééééééééééééééééééééééé",
        "é".repeat(32),
      ),
    ]);
  });

  it("takes a command's types as PostgreSQL names them", () => {
    expect(typeFrom(facts.types, "varchar(120)")).toEqual({
      type: "character varying",
      length: "120",
      array: false,
    });
    expect(typeFrom(facts.types, "int4[]")).toEqual({ type: "integer", length: "", array: true });
    expect(typeFrom(facts.types, "int")).toMatchObject({ type: "integer" });
    expect(typeFrom(facts.types, "timestamptz")).toMatchObject({
      type: "timestamp with time zone",
    });
    expect(typeFrom(facts.types, "app.mood")).toMatchObject({ type: "app.mood" });
    expect(typeFrom(facts.types, "numeric(10, 2)")).toMatchObject({
      type: "numeric",
      length: "10,2",
    });
  });
});
