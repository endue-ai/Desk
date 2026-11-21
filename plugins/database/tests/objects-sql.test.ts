// The statements of the explorer's operations (PG-52, ui/features/objects/): each operation on each
// kind of PostgreSQL object with every name quoted and CASCADE only when chosen, what the server
// would refuse said first, MySQL's and SQLite's subset, a source edit's script, and the SQL
// templates of a table and a routine.
import { describe, expect, it } from "vitest";
import type { Target } from "../ui/features/objects/kinds.js";
import { notOffered, opsOf } from "../ui/features/objects/kinds.js";
import type { Facts } from "../ui/features/objects/sql-postgres.js";
import { applyPrefix, modeOf, scriptOf } from "../ui/features/objects/statements.js";
import { templateOf } from "../ui/features/objects/templates.js";

const table: Target = { kind: "table", schema: "public", name: "people" };
const view: Target = { kind: "view", schema: "public", name: "big_orders" };
const matview: Target = { kind: "materialized view", schema: "sales", name: "Daily totals" };
const fn: Target = {
  kind: "function",
  schema: "public",
  name: "add(a integer, b integer)",
  ident: "16400",
};
const proc: Target = {
  kind: "procedure",
  schema: "public",
  name: "refund(order_id integer)",
  ident: "16405",
};
const trigger: Target = {
  kind: "trigger",
  schema: "public",
  name: "people_touch",
  table: "people",
};
const index: Target = { kind: "index", schema: "public", name: "people_name", table: "people" };
const fk: Target = {
  kind: "foreign key",
  schema: "public",
  name: "orders_person_fkey",
  table: "orders",
};
const schema: Target = { kind: "schema", schema: "sales", name: "sales" };
const routines: Facts = {
  routine: { name: "add", args: "a integer, b integer", params: [] },
};
const pg = (
  op: string,
  target: Target,
  values: Record<string, string> = {},
  choices: string[] = [],
  facts: Facts = {},
) => scriptOf("postgresql", op as never, target, { ...routines, ...facts }, { values, choices });

describe("PostgreSQL's statements", () => {
  it("writes each operation's PostgreSQL statement, every name quoted", () => {
    expect(pg("rename", table, { to: "Persons" })).toBe(
      'ALTER TABLE "public"."people" RENAME TO "Persons";',
    );
    expect(pg("rename", matview, { to: "daily" })).toBe(
      'ALTER MATERIALIZED VIEW "sales"."Daily totals" RENAME TO "daily";',
    );
    expect(pg("rename", fn, { to: "plus" })).toBe(
      'ALTER FUNCTION "public"."add"(a integer, b integer) RENAME TO "plus";',
    );
    expect(pg("rename", trigger, { to: "touch" })).toBe(
      'ALTER TRIGGER "people_touch" ON "public"."people" RENAME TO "touch";',
    );
    expect(pg("rename", fk, { to: "orders_people" })).toBe(
      'ALTER TABLE "public"."orders" RENAME CONSTRAINT "orders_person_fkey" TO "orders_people";',
    );
    expect(pg("rename", index, { to: 'say "hi"' })).toBe(
      'ALTER INDEX "public"."people_name" RENAME TO "say ""hi""";',
    );
    expect(pg("rename", schema, { to: "sales_2026" })).toBe(
      'ALTER SCHEMA "sales" RENAME TO "sales_2026";',
    );
    expect(pg("move", view, { to: "archive" })).toBe(
      'ALTER VIEW "public"."big_orders" SET SCHEMA "archive";',
    );
    expect(
      pg("move", proc, { to: "archive" }, [], {
        routine: { name: "refund", args: "order_id integer", params: [] },
      }),
    ).toBe('ALTER PROCEDURE "public"."refund"(order_id integer) SET SCHEMA "archive";');
    expect(
      pg("owner", { kind: "sequence", schema: "public", name: "people_id_seq" }, { to: "app" }),
    ).toBe('ALTER SEQUENCE "public"."people_id_seq" OWNER TO "app";');
    expect(pg("owner", schema, { to: "reports" }, [], { owner: "app" })).toBe(
      'ALTER SCHEMA "sales" OWNER TO "reports";',
    );
    expect(pg("comment", table, { comment: "Who buys, it's said" })).toBe(
      `COMMENT ON TABLE "public"."people" IS 'Who buys, it''s said';`,
    );
    expect(pg("comment", trigger, { comment: "" })).toBe(
      'COMMENT ON TRIGGER "people_touch" ON "public"."people" IS NULL;',
    );
    expect(pg("comment", fk, { comment: "a\\b" })).toBe(
      `COMMENT ON CONSTRAINT "orders_person_fkey" ON "public"."orders" IS E'a\\\\b';`,
    );
    expect(
      pg("comment", { kind: "foreign table", schema: "ext", name: "rates" }, { comment: "x" }),
    ).toBe(`COMMENT ON FOREIGN TABLE "ext"."rates" IS 'x';`);
    expect(pg("drop", view)).toBe('DROP VIEW "public"."big_orders";');
    expect(pg("drop", view, {}, ["cascade"])).toBe('DROP VIEW "public"."big_orders" CASCADE;');
    expect(pg("drop", fn)).toBe('DROP FUNCTION "public"."add"(a integer, b integer);');
    expect(pg("drop", trigger)).toBe('DROP TRIGGER "people_touch" ON "public"."people";');
    expect(pg("drop", fk, {}, ["cascade"])).toBe(
      'ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_person_fkey" CASCADE;',
    );
    expect(pg("drop", schema)).toBe('DROP SCHEMA "sales";');
    expect(pg("truncate", table)).toBe('TRUNCATE TABLE "public"."people";');
    expect(pg("truncate", table, {}, ["restart", "cascade"])).toBe(
      'TRUNCATE TABLE "public"."people" RESTART IDENTITY CASCADE;',
    );
    const ready: Facts = { populated: true, unique: true };
    expect(pg("refresh", matview, {}, [], ready)).toBe(
      'REFRESH MATERIALIZED VIEW "sales"."Daily totals";',
    );
    expect(pg("refresh", matview, {}, ["concurrently"], ready)).toBe(
      'REFRESH MATERIALIZED VIEW CONCURRENTLY "sales"."Daily totals";',
    );
    expect(pg("refresh", matview, {}, ["nodata"], ready)).toBe(
      'REFRESH MATERIALIZED VIEW "sales"."Daily totals" WITH NO DATA;',
    );
    expect(pg("enable", trigger, { state: "disable" })).toBe(
      'ALTER TABLE "public"."people" DISABLE TRIGGER "people_touch";',
    );
    expect(pg("enable", trigger, { state: "enable" })).toBe(
      'ALTER TABLE "public"."people" ENABLE TRIGGER "people_touch";',
    );
  });

  it("refuses what the server would refuse, in words", () => {
    expect(() => pg("rename", table, { to: "  " })).toThrow(/Type the new name/u);
    expect(() => pg("rename", table, { to: "people" })).toThrow(/its name now/u);
    expect(() => pg("rename", table, { to: "é".repeat(32) })).toThrow(
      /63 bytes at most: this one has 64/u,
    );
    expect(pg("rename", table, { to: "x".repeat(63) })).toContain(`"${"x".repeat(63)}"`);
    expect(() => pg("move", view, { to: "public" })).toThrow(/its schema now/u);
    expect(() => pg("drop", { ...index, name: "people_pkey", owned: true })).toThrow(
      /index of a constraint of people: drop the constraint/u,
    );
    expect(() =>
      pg("refresh", matview, {}, ["concurrently"], { populated: false, unique: true }),
    ).toThrow(/has data/u);
    expect(() =>
      pg("refresh", matview, {}, ["concurrently"], { populated: true, unique: false }),
    ).toThrow(/unique index/u);
    expect(() =>
      pg("refresh", matview, {}, ["concurrently", "nodata"], { populated: true, unique: true }),
    ).toThrow(/WITH NO DATA/u);
    expect(() => pg("truncate", view)).toThrow(/Truncate is not on PostgreSQL for a view/u);
    expect(() =>
      scriptOf("postgresql", "rename", fn, {}, { values: { to: "x" }, choices: [] }),
    ).toThrow(/arguments of add\(a integer, b integer\) were not read/u);
  });
});

describe("MySQL's and SQLite's subset", () => {
  const my = (op: string, target: Target, values: Record<string, string> = {}) =>
    scriptOf("mysql", op as never, { ...target, schema: "shop" }, {}, { values, choices: [] });
  const lite = (op: string, target: Target, values: Record<string, string> = {}) =>
    scriptOf("sqlite", op as never, { ...target, schema: "main" }, {}, { values, choices: [] });

  it("gives MySQL and SQLite the subset their DDL allows, and says what is not on the engine", () => {
    expect(my("rename", table, { to: "persons" })).toBe(
      "RENAME TABLE `shop`.`people` TO `shop`.`persons`;",
    );
    expect(my("move", table, { to: "archive" })).toBe(
      "RENAME TABLE `shop`.`people` TO `archive`.`people`;",
    );
    expect(my("comment", table, { comment: "it's" })).toBe(
      "ALTER TABLE `shop`.`people` COMMENT = 'it''s';",
    );
    expect(my("comment", { kind: "procedure", schema: "", name: "refund" }, { comment: "" })).toBe(
      "ALTER PROCEDURE `shop`.`refund` COMMENT '';",
    );
    expect(my("drop", view)).toBe("DROP VIEW `shop`.`big_orders`;");
    expect(my("drop", index)).toBe("DROP INDEX `people_name` ON `shop`.`people`;");
    expect(my("drop", { ...index, name: "PRIMARY" })).toBe(
      "ALTER TABLE `shop`.`people` DROP PRIMARY KEY;",
    );
    expect(my("drop", fk)).toBe(
      "ALTER TABLE `shop`.`orders` DROP FOREIGN KEY `orders_person_fkey`;",
    );
    expect(my("drop", { kind: "trigger", schema: "", name: "touch", table: "people" })).toBe(
      "DROP TRIGGER `shop`.`touch`;",
    );
    expect(my("rename", index, { to: "by_name" })).toBe(
      "ALTER TABLE `shop`.`people` RENAME INDEX `people_name` TO `by_name`;",
    );
    expect(my("truncate", table)).toBe("TRUNCATE TABLE `shop`.`people`;");
    expect(() => my("owner", table, { to: "app" })).toThrow(
      /Change the owner is not on MySQL for a table/u,
    );
    expect(() => my("rename", { kind: "function", schema: "", name: "f" }, { to: "g" })).toThrow(
      /Rename is not on MySQL for a function/u,
    );
    expect(lite("rename", table, { to: "persons" })).toBe(
      'ALTER TABLE "people" RENAME TO "persons";',
    );
    expect(lite("drop", view)).toBe('DROP VIEW "big_orders";');
    expect(lite("truncate", table)).toBe('DELETE FROM "people";');
    expect(() => lite("rename", view, { to: "v" })).toThrow(/Rename is not on SQLite for a view/u);
    expect(() => lite("comment", table, { comment: "x" })).toThrow(/Comment is not on SQLite/u);
    expect(() =>
      lite("drop", { ...index, name: "sqlite_autoindex_people_1", owned: true }),
    ).toThrow(/goes only with its table/u);
    expect(opsOf("sqlite", "view")).toEqual(["source", "drop", "generate"]);
    expect(notOffered("mysql", "source", { kind: "function", schema: "shop", name: "f" })).toBe(
      "Edit the source is not on MySQL for a function: d shows its DDL.",
    );
  });

  it("writes the source edit's script", () => {
    const text = "CREATE OR REPLACE VIEW public.big_orders AS\n SELECT id FROM orders;\n";
    const apply = (engine: "postgresql" | "mysql" | "sqlite", target: Target) =>
      scriptOf(engine, "apply", target, { text, ...routines }, {});
    expect(apply("postgresql", view)).toBe(text);
    expect(apply("postgresql", fn)).toBe(text);
    expect(applyPrefix("postgresql", view, {})).toBe("");
    expect(apply("postgresql", matview)).toBe(
      `DROP MATERIALIZED VIEW "sales"."Daily totals";\n${text}`,
    );
    expect(apply("sqlite", { ...view, schema: "main" })).toBe(`DROP VIEW "big_orders";\n${text}`);
    expect(apply("mysql", { ...view, schema: "shop" })).toBe(text);
    expect(modeOf("postgresql")).toBe("transaction");
    expect(modeOf("sqlite")).toBe("transaction");
    expect(modeOf("mysql")).toBe("run");
    expect(() => scriptOf("postgresql", "apply", view, { text: " \n" }, {})).toThrow(
      /console is empty/u,
    );
  });
});

describe("generate SQL", () => {
  const columns = [
    { name: "id", primary: true },
    { name: "full name", primary: false },
    { name: "joined", primary: false },
  ];
  it("generates SELECT, INSERT, UPDATE and DELETE for a table and a call for a function and a procedure", () => {
    const of = (which: string, target: Target = table, read = { columns }) =>
      templateOf("postgresql", which as never, target, read);
    expect(of("select")).toBe(
      'SELECT "id", "full name", "joined"\nFROM "public"."people"\nLIMIT 100;\n',
    );
    expect(of("insert")).toBe(
      'INSERT INTO "public"."people" ("id", "full name", "joined")\nVALUES (:id, :full_name, :joined);\n',
    );
    expect(of("update")).toBe(
      'UPDATE "public"."people"\nSET "full name" = :full_name,\n    "joined" = :joined\nWHERE "id" = :id;\n',
    );
    expect(of("delete")).toBe('DELETE FROM "public"."people"\nWHERE "id" = :id;\n');
    const keyless = columns.map((c) => ({ ...c, primary: false }));
    expect(of("delete", table, { columns: keyless })).toBe(
      'DELETE FROM "public"."people"\nWHERE "id" = :id AND "full name" = :full_name AND "joined" = :joined;\n',
    );
    expect(() => of("insert", view)).toThrow(/A view has no INSERT template/u);
    const params = [
      { name: "a", mode: "in" as const },
      { name: "", mode: "in" as const },
      { name: "total", mode: "out" as const },
    ];
    expect(
      templateOf("postgresql", "call", fn, { routine: { name: "add", args: "", params } }),
    ).toBe('SELECT * FROM "public"."add"(:a, :arg2);\n');
    expect(
      templateOf("postgresql", "call", proc, { routine: { name: "refund", args: "", params } }),
    ).toBe('CALL "public"."refund"(:a, :arg2, NULL);\n');
    expect(
      templateOf(
        "mysql",
        "call",
        { ...proc, schema: "shop" },
        { routine: { name: "refund", args: "", params } },
      ),
    ).toBe("CALL `shop`.`refund`(:a, :arg2, @total);\n");
    expect(templateOf("sqlite", "select", { ...table, schema: "main" }, { columns })).toBe(
      'SELECT "id", "full name", "joined"\nFROM "people"\nLIMIT 100;\n',
    );
  });
});
