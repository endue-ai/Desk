// The migration script between two schemas (PG-53, ui/features/compare-schema/migrate.js): for the
// direction and the objects chosen, in the order of what each needs, destructive steps marked, what
// it will not write held; a changed table altered by the table form's own writer (PG-51).
import { describe, expect, it } from "vitest";
import { align } from "../ui/features/compare-schema/align.js";
import { compareModels } from "../ui/features/compare-schema/diff.js";
import { modelOfFiles } from "../ui/features/compare-schema/folder.js";
import { migrationOf } from "../ui/features/compare-schema/migrate.js";
import { factsFor } from "../ui/features/compare-schema/model.js";
import { alterSteps } from "../ui/features/table-design/alter.js";
import type { Design } from "../ui/features/table-design/model.js";
import { shopFacts } from "./table-design-fixture";

const files = (schema: string, text: string) => modelOfFiles(schema, [{ path: "schema.sql", text }]);
const BASE = `
  CREATE TABLE people (id int PRIMARY KEY, name text NOT NULL);
  CREATE TABLE gone (id int PRIMARY KEY, person int REFERENCES people);
  CREATE VIEW gone_view AS SELECT id FROM gone;
  CREATE TYPE old_kind AS ENUM ('a');
`;
const NEXT = `
  CREATE TYPE mood AS ENUM ('sad', 'ok');
  CREATE SEQUENCE ticket_no AS integer;
  CREATE TABLE people (id int PRIMARY KEY, name text NOT NULL, mood mood);
  CREATE TABLE orders (id int PRIMARY KEY, person int REFERENCES people, ticket int DEFAULT nextval('ticket_no'::regclass), parent int REFERENCES orders (id));
  CREATE TABLE lines (id int PRIMARY KEY, order_id int REFERENCES orders);
  CREATE VIEW recent AS SELECT id FROM orders;
  CREATE VIEW recent_people AS SELECT r.id FROM recent r JOIN people p ON p.id = r.id;
`;
/** Each statement's first line without its marks. */
const heads = (text: string) =>
  text
    .split(/;\n/u)
    .map((s) => s.split("\n").filter((l) => !l.startsWith("--")).join(" ").trim())
    .filter((s) => s && s !== "BEGIN" && s !== "COMMIT" && !s.startsWith("SET LOCAL"))
    .map((s) => s.replace(/\s*\(.*$/su, "").replace(/ AS$/u, ""));

describe("the migration script", () => {
  it("writes the migration for the chosen direction and objects, ordered by dependency", () => {
    const source = files("app", NEXT);
    const target = files("app", BASE);
    const keys = compareModels(source, target).items.map((i) => i.key);
    const m = migrationOf(source, target, keys);
    expect(m.held).toEqual([]);
    expect(heads(m.text)).toEqual([
      'DROP VIEW "app"."gone_view"',
      'CREATE TYPE "app"."mood" AS ENUM',
      'CREATE SEQUENCE "app"."ticket_no" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE',
      'ALTER TABLE "app"."people" ADD COLUMN "mood" "app"."mood"',
      'CREATE TABLE "app"."orders"',
      'CREATE TABLE "app"."lines"',
      'CREATE VIEW "app"."recent" AS SELECT id FROM orders',
      'CREATE VIEW "app"."recent_people" AS SELECT r.id FROM recent r JOIN people p ON p.id = r.id',
      'ALTER TABLE "app"."orders" ADD FOREIGN KEY',
      'ALTER TABLE "app"."orders" ADD FOREIGN KEY',
      'ALTER TABLE "app"."lines" ADD FOREIGN KEY',
      'DROP TABLE "app"."gone"',
      'DROP TYPE "app"."old_kind"',
    ]);
    expect(m.text.startsWith('BEGIN;\n\nSET LOCAL search_path TO "app", "public";')).toBe(true);
    // Only the chosen objects.
    const one = migrationOf(source, target, ["view recent", "table orders", "sequence ticket_no"]);
    expect(heads(one.text)).toEqual([
      'CREATE SEQUENCE "app"."ticket_no" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE',
      'CREATE TABLE "app"."orders"',
      'CREATE VIEW "app"."recent" AS SELECT id FROM orders',
      'ALTER TABLE "app"."orders" ADD FOREIGN KEY',
      'ALTER TABLE "app"."orders" ADD FOREIGN KEY',
    ]);
    // The other direction: what NEXT added goes, what it dropped comes back.
    const back = migrationOf(target, source, keys);
    expect(heads(back.text)).toEqual([
      'DROP VIEW "app"."recent_people"',
      'DROP VIEW "app"."recent"',
      'CREATE TYPE "app"."old_kind" AS ENUM',
      'ALTER TABLE "app"."people" DROP COLUMN "mood"',
      'CREATE TABLE "app"."gone"',
      'CREATE VIEW "app"."gone_view" AS SELECT id FROM gone',
      'ALTER TABLE "app"."gone" ADD FOREIGN KEY',
      'DROP TABLE "app"."lines"',
      'DROP TABLE "app"."orders"',
      'DROP SEQUENCE "app"."ticket_no"',
      'DROP TYPE "app"."mood"',
    ]);
    // Into another schema: the source's names are the target's.
    const moved = migrationOf(files("dev", NEXT), files("prod", BASE), ["table orders"]);
    expect(moved.text).toContain('CREATE TABLE "prod"."orders"');
    expect(moved.text).toContain('REFERENCES "prod"."people" ("id")');
  });

  it("marks the destructive steps and holds what it cannot write", () => {
    const source = files("app", `CREATE TYPE mood AS ENUM ('ok', 'glad'); CREATE DOMAIN positive AS int CHECK (VALUE > 0);
      CREATE TABLE people (id int PRIMARY KEY);`);
    const target = files("app", `CREATE TYPE mood AS ENUM ('sad', 'ok'); CREATE DOMAIN positive AS int CHECK (VALUE >= 0);
      CREATE TABLE people (id int PRIMARY KEY, name text); CREATE TABLE gone (id int); CREATE VIEW v AS SELECT 1;`);
    const keys = compareModels(source, target).items.map((i) => i.key);
    const m = migrationOf(source, target, keys);
    expect(m.text).toContain('-- Drops column name and its data for good.\nALTER TABLE "app"."people" DROP COLUMN "name";');
    expect(m.text).toContain('-- Drops table app.gone and its rows for good.\nDROP TABLE "app"."gone";');
    expect(m.text).toContain('-- Drops view app.v; anything built on it must go first.\nDROP VIEW "app"."v";');
    expect(m.text).toContain("ADD VALUE 'glad' AFTER 'ok'");
    expect(m.held).toEqual([
      "Type app.mood loses sad: PostgreSQL cannot drop an enum's value. Write it in a console (a new type, the columns moved to it).",
      "Type app.positive changed: a domain or composite type is not altered by the script. Write it in a console.",
    ]);
    expect(m.text.startsWith("-- Not written: Type app.mood loses sad")).toBe(true);
    // A type change with no cast needs USING (the table form's words); a file that did not read is held.
    const typed = migrationOf(files("app", "CREATE TABLE t (a date);"), files("app", "CREATE TABLE t (a integer);"), ["table t"], shopFacts());
    expect(typed.held[0]).toContain("PostgreSQL has no automatic cast from integer to date for column a");
    const unread = files("app", "CREATE TABLE t (a integer) WITH (fillfactor = 70);");
    expect(unread.notes?.[0]).toContain("schema.sql: table t: it cannot read WITH");
    expect(migrationOf(unread, files("app", "CREATE TABLE t (a integer);"), ["table t"]).held).toEqual([
      "app.t is not changed by the script: schema.sql did not read (table t: it cannot read WITH (fillfactor = 70)).",
    ]);
  });

  it("a changed table is altered with the table form's writer", () => {
    const was = files("app", "CREATE TABLE t (id int PRIMARY KEY, code varchar(10), qty int);");
    const now = files("app", `CREATE TABLE t (id int PRIMARY KEY, code varchar(20) NOT NULL, qty int CHECK (qty > 0), note text);
      CREATE INDEX t_code ON t (code);`);
    const m = migrationOf(now, was, ["table t"], shopFacts());
    const w = was.objects[0]?.table as Design;
    const facts = factsFor([...was.objects, ...now.objects], shopFacts());
    const steps = alterSteps(w, align(w, now.objects[0]?.table as Design, { source: "app", target: "app" }), facts).steps;
    expect(m.steps.slice(1)).toEqual(steps);
    expect(steps.map((s) => s.sql)).toEqual([
      'ALTER TABLE "app"."t" ALTER COLUMN "code" TYPE character varying(20)',
      'ALTER TABLE "app"."t" ALTER COLUMN "code" SET NOT NULL',
      'ALTER TABLE "app"."t" ADD COLUMN "note" text',
      'ALTER TABLE "app"."t" ADD CHECK (qty > 0)',
      'CREATE INDEX "t_code" ON "app"."t" USING "btree" ("code")',
    ]);
  });
});
