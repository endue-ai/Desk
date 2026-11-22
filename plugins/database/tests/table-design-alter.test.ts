// An existing table's ALTER script from the table form's model (PG-51, ADR 0324): the design read
// from the server (read.js over table-design-fixture.ts), edited as the form edits it (edits.js),
// and the script written from the difference: nothing for a design left as it was, renames as
// renames, an order that applies, the dangerous steps marked, CONCURRENTLY after the transaction,
// and what the form will not write said instead of guessed.
import { describe, expect, it } from "vitest";
import {
  addColumn,
  addPart,
  dropColumn,
  removePart,
  setColumn,
  setPart,
  setTable,
  toggleKey,
} from "../ui/features/table-design/edits.js";
import type { Design } from "../ui/features/table-design/model.js";
import { designOf } from "../ui/features/table-design/read.js";
import { scriptOf } from "../ui/features/table-design/script.js";
import { shopFacts, TABLES } from "./table-design-fixture";

/** A table of the fixture as the form reads it, and the server's facts. */
function read(name: "people" | "orders", version = "170006") {
  const facts = shopFacts(version);
  const rows = TABLES[`public.${name}`];
  if (!rows) throw new Error(name);
  const { design } = designOf(
    "public",
    name,
    {
      table: [rows.table],
      columns: rows.columns,
      constraints: rows.constraints,
      indexes: rows.indexes,
    },
    facts,
  );
  return { was: design, facts };
}
const sqls = (was: Design, now: Design, facts = shopFacts()) =>
  scriptOf(was, now, facts).inside.map((s) => s.sql);

describe("the table form's ALTER script", () => {
  it("reads a table's design as the server has it", () => {
    const { was } = read("orders");
    expect(
      was.columns.map((c) => [c.id, c.name, c.type, c.length, c.nullable, c.identity]),
    ).toEqual([
      ["c1", "id", "integer", "", false, "always"],
      ["c2", "person", "integer", "", true, ""],
      ["c3", "total", "numeric", "10,2", true, ""],
    ]);
    expect(was.primaryKey).toEqual({ id: "k16422", name: "orders_pkey", columns: ["c1"] });
    expect(was.checks).toEqual([
      { id: "k16420", name: "orders_total_check", expression: "total >= 0::numeric" },
    ]);
    expect(was.foreignKeys[0]).toMatchObject({
      columns: ["c2"],
      refSchema: "public",
      refTable: "people",
      refColumns: ["id"],
      onDelete: "NO ACTION",
      self: false,
    });
    expect(read("people").was.indexes[0]).toMatchObject({
      name: "people_name",
      method: "btree",
      keys: [{ column: "c2", expression: "" }],
    });
  });

  it("writes nothing for a design left as it was", () => {
    const { was, facts } = read("people");
    const script = scriptOf(was, was, facts);
    expect(script).toMatchObject({ inside: [], after: [], problems: [], text: "" });
  });

  it("renames, never drops and adds", () => {
    const { was, facts } = read("people");
    let now = setTable(was, { name: "Persons" });
    now = setColumn(now, "c2", { name: "full name" });
    now = setPart(now, "primaryKey", "k16410", { name: "persons_pkey" });
    now = setPart(now, "indexes", "k16411", { name: "persons_name" });
    expect(sqls(was, now, facts)).toEqual([
      'ALTER TABLE "public"."people" RENAME TO "Persons"',
      'ALTER TABLE "public"."Persons" RENAME COLUMN "name" TO "full name"',
      'ALTER TABLE "public"."Persons" RENAME CONSTRAINT "people_pkey" TO "persons_pkey"',
      'ALTER INDEX "public"."people_name" RENAME TO "persons_name"',
    ]);
    // A chain goes in an order that applies; a cycle is refused.
    const chain = setColumn(setColumn(was, "c1", { name: "name" }), "c2", { name: "label" });
    expect(sqls(was, chain, facts)).toEqual([
      'ALTER TABLE "public"."people" RENAME COLUMN "name" TO "label"',
      'ALTER TABLE "public"."people" RENAME COLUMN "id" TO "name"',
    ]);
    const swap = setColumn(setColumn(was, "c1", { name: "name" }), "c2", { name: "id" });
    expect(scriptOf(was, swap, facts).problems).toEqual([
      "Columns id and name take each other's names: rename one to another name first, run it, then the rest.",
    ]);
  });

  it("orders the script so it applies and marks the dangerous steps", () => {
    const { was, facts } = read("orders");
    let now = dropColumn(was, "c3");
    now = removePart(now, "checks", "k16420");
    now = setColumn(now, "c2", { name: "buyer", type: "bigint", nullable: false });
    let made = addColumn(now, { name: "note", type: "text", nullable: false });
    now = made.design;
    made = addColumn(now, { name: "seq", type: "bigint", identity: "by default" });
    now = made.design;
    made = addPart(now, "uniques", { name: "orders_buyer_key", columns: ["c2"] });
    now = made.design;
    made = addPart(now, "checks", { expression: "length(note) < 200" });
    now = made.design;
    now = setPart(now, "foreignKeys", "k16421", { onDelete: "CASCADE" });
    made = addPart(now, "indexes", {
      name: "orders_note",
      keys: [{ column: "", expression: "lower(note)" }],
    });
    now = made.design;
    made = addPart(now, "indexes", {
      name: "orders_buyer",
      keys: [{ column: "c2", expression: "" }],
      concurrently: true,
    });
    now = made.design;
    const script = scriptOf(was, now, facts);
    expect(script.problems).toEqual([]);
    expect(script.inside.map((s) => [s.sql, s.marks])).toEqual([
      ['ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_person_fkey"', []],
      ['ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_total_check"', []],
      [
        'ALTER TABLE "public"."orders" DROP COLUMN "total"',
        ["Drops column total and its data for good."],
      ],
      ['ALTER TABLE "public"."orders" RENAME COLUMN "person" TO "buyer"', []],
      [
        'ALTER TABLE "public"."orders" ALTER COLUMN "buyer" TYPE bigint',
        [
          "Rewrites the whole table: reads and writes wait until it ends.",
          "Fails if a value of buyer does not convert to its new type.",
        ],
      ],
      [
        'ALTER TABLE "public"."orders" ALTER COLUMN "buyer" SET NOT NULL',
        ["Reads every row while reads and writes wait, and fails if one holds NULL."],
      ],
      [
        'ALTER TABLE "public"."orders" ADD COLUMN "note" text NOT NULL',
        ["Fails if the table has rows: a new NOT NULL column needs a default for them."],
      ],
      [
        'ALTER TABLE "public"."orders" ADD COLUMN "seq" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL',
        ["Rewrites the whole table: reads and writes wait until it ends."],
      ],
      [
        'ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_buyer_key" UNIQUE ("buyer")',
        ["Builds a unique index while writes wait, and fails on a duplicate."],
      ],
      [
        'ALTER TABLE "public"."orders" ADD CHECK (length(note) < 200)',
        ["Reads every row while reads and writes wait, and fails if one breaks it."],
      ],
      [
        'ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_person_fkey" FOREIGN KEY ("buyer") REFERENCES "public"."people" ("id") ON DELETE CASCADE',
        ["Reads every row while writes to both tables wait, and fails if one has no match."],
      ],
      [
        'CREATE INDEX "orders_note" ON "public"."orders" USING "btree" ((lower(note)))',
        ["Builds while writes to the table wait (reads go on)."],
      ],
    ]);
    expect(script.after.map((s) => s.sql)).toEqual([
      'CREATE INDEX CONCURRENTLY "orders_buyer" ON "public"."orders" USING "btree" ("buyer")',
    ]);
    // The text: the transaction, then each CONCURRENTLY index after COMMIT under its words.
    expect(script.text).toMatch(/^BEGIN;\n\nALTER TABLE "public"\."orders" DROP CONSTRAINT/u);
    expect(script.text).toContain(
      'COMMIT;\n\n-- CONCURRENTLY: runs after the transaction, on its own, while writes go on; if it fails, an invalid index is left to drop.\nCREATE INDEX CONCURRENTLY "orders_buyer"',
    );
    expect(script.text).toContain(
      '-- Drops column total and its data for good.\nALTER TABLE "public"."orders" DROP COLUMN "total";',
    );
  });

  it("changes a column's default, nullability, identity, comment, and the table's comment and owner", () => {
    const { was, facts } = read("people");
    let now = setColumn(was, "c3", {
      default: "clock_timestamp()",
      nullable: false,
      comment: "When",
    });
    now = setColumn(now, "c1", { identity: "always" });
    now = setColumn(now, "c2", { comment: "" });
    now = setTable(now, { comment: "", owner: "reports" });
    now = toggleKey(now, "c1", false);
    expect(sqls(was, now, facts)).toEqual([
      'ALTER TABLE "public"."people" DROP CONSTRAINT "people_pkey"',
      'ALTER TABLE "public"."people" ALTER COLUMN "id" DROP DEFAULT',
      'ALTER TABLE "public"."people" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY',
      'ALTER TABLE "public"."people" ALTER COLUMN "joined" SET DEFAULT clock_timestamp()',
      'ALTER TABLE "public"."people" ALTER COLUMN "joined" SET NOT NULL',
      'COMMENT ON TABLE "public"."people" IS NULL',
      'COMMENT ON COLUMN "public"."people"."name" IS NULL',
      `COMMENT ON COLUMN "public"."people"."joined" IS 'When'`,
      'ALTER TABLE "public"."people" OWNER TO "reports"',
    ]);
    const plain = setColumn(read("orders").was, "c1", { identity: "" });
    expect(sqls(read("orders").was, plain, facts)).toEqual([
      'ALTER TABLE "public"."orders" ALTER COLUMN "id" DROP IDENTITY',
    ]);
    const other = setColumn(read("orders").was, "c1", { identity: "by default" });
    expect(sqls(read("orders").was, other, facts)).toEqual([
      'ALTER TABLE "public"."orders" ALTER COLUMN "id" SET GENERATED BY DEFAULT',
    ]);
  });

  it("judges a type change by the server's casts", () => {
    const { was, facts } = read("orders");
    // Every type change in one statement; a longer varchar or text to varchar needs no rewrite.
    const two = setColumn(setColumn(was, "c2", { type: "bigint" }), "c3", { length: "12,2" });
    expect(scriptOf(was, two, facts).inside.map((s) => [s.sql, s.marks.length])).toEqual([
      [
        'ALTER TABLE "public"."orders" ALTER COLUMN "person" TYPE bigint, ALTER COLUMN "total" TYPE numeric(12,2)',
        2,
      ],
    ]);
    const people = read("people");
    const longer = setColumn(people.was, "c2", { type: "character varying", length: "200" });
    expect(scriptOf(people.was, longer, facts).inside[0]?.marks).toEqual([]);
    const domain = setColumn(was, "c2", { type: "public.positive" });
    expect(scriptOf(was, domain, facts).problems).toEqual([]);
    const toText = setColumn(was, "c2", { type: "text" });
    expect(scriptOf(was, toText, facts).problems).toEqual([]);
    const toBool = setColumn(was, "c2", { type: "boolean" });
    const held = scriptOf(was, toBool, facts);
    expect(held.problems).toEqual([
      "PostgreSQL has no automatic cast from integer to boolean for column person, so the change needs USING, which the form does not write: open the script in a console and add USING with an expression, or keep the type.",
    ]);
    // Written as it is, without USING, so the console has it to finish.
    expect(held.text).toContain('ALTER COLUMN "person" TYPE boolean;');
    const toArray = setColumn(was, "c2", { array: true });
    expect(scriptOf(was, toArray, facts).problems[0]).toMatch(
      /no automatic cast from integer to integer\[\]/u,
    );
  });

  it("says so instead of guessing", () => {
    const { was, facts } = read("orders");
    const generated = setColumn(was, "c3", { generated: "person * 2" });
    expect(scriptOf(was, generated, facts).problems).toEqual([
      "Column total becomes generated only as it is added: drop it and add a new one (its values go).",
    ]);
    const withGenerated: Design = {
      ...was,
      columns: was.columns.map((c) => (c.id === "c3" ? { ...c, generated: "person * 2" } : c)),
    };
    const changed = setColumn(withGenerated, "c3", { generated: "person * 3" });
    expect(sqls(withGenerated, changed, facts)).toEqual([
      'ALTER TABLE "public"."orders" ALTER COLUMN "total" SET EXPRESSION AS (person * 3)',
    ]);
    expect(scriptOf(withGenerated, changed, shopFacts("160004")).problems).toEqual([
      "Column total's generation changes in place only from PostgreSQL 17 on: drop it and add a new one.",
    ]);
    expect(sqls(withGenerated, setColumn(withGenerated, "c3", { generated: "" }), facts)).toEqual([
      'ALTER TABLE "public"."orders" ALTER COLUMN "total" DROP EXPRESSION',
    ]);
    // A part the form cannot write is kept: renamed or dropped, never changed.
    const kept: Design = {
      ...was,
      checks: [
        { ...(was.checks[0] as Design["checks"][number]), kept: "CHECK (total >= 0) NOT VALID" },
      ],
    };
    const edited = setPart(kept, "checks", "k16420", { expression: "total > 1" });
    expect(sqls(kept, edited, facts)).toEqual([]);
    const renamed = setPart(kept, "checks", "k16420", { name: "total_ok" });
    expect(sqls(kept, renamed, facts)).toEqual([
      'ALTER TABLE "public"."orders" RENAME CONSTRAINT "orders_total_check" TO "total_ok"',
    ]);
    // A changed index is dropped and created again; a cleared name of an existing part is refused.
    const people = read("people");
    const index = setPart(people.was, "indexes", "k16411", { method: "hash" });
    expect(sqls(people.was, index, facts)).toEqual([
      'DROP INDEX "public"."people_name"',
      'CREATE INDEX "people_name" ON "public"."people" USING "hash" ("name")',
    ]);
    // Columns keep their order: a reorder is said, not rebuilt.
    const moved: Design = { ...people.was, columns: [...people.was.columns].reverse() };
    expect(scriptOf(people.was, moved, facts)).toMatchObject({
      inside: [],
      problems: ["PostgreSQL cannot move a column: an existing table's columns keep their order."],
    });
    const unnamed = setPart(people.was, "indexes", "k16411", { name: "" });
    expect(scriptOf(people.was, unnamed, facts).problems).toEqual([
      "Index people_name keeps a name: type one.",
    ]);
  });
});
