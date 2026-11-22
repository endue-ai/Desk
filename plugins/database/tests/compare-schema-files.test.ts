// A schema dumped to a folder and saved as a snapshot (PG-53, ui/features/compare-schema/dump.js,
// snapshot.js, folder.js): one file per object in a stable order and format, and both read back
// with no difference from the schema; a hand-written file reads as the server's.
import { describe, expect, it } from "vitest";
import { compareModels } from "../ui/features/compare-schema/diff.js";
import { dumpOf } from "../ui/features/compare-schema/dump.js";
import { modelOfFiles } from "../ui/features/compare-schema/folder.js";
import { modelOfRows } from "../ui/features/compare-schema/read.js";
import { snapshotModel, snapshotText } from "../ui/features/compare-schema/snapshot.js";
import { devRows, readRows } from "./compare-schema-fixture";

const KEYS = ["server.version", "server.types", "server.casts", "server.roles", "server.methods", "tables", "table.table", "table.columns", "table.constraints", "table.indexes", "views", "sequences", "routines", "types", "triggers"];
const served = (rows = devRows()) =>
  modelOfRows("dev", Object.fromEntries(KEYS.map((k) => [k, (readRows(k, rows).rows ?? []).slice(1) as (string | null)[][]]))).model;

describe("a schema in files", () => {
  it("dumps a schema to a folder, one file per object in a stable order and format", () => {
    const files = dumpOf(served());
    expect(files.map((f) => f.path)).toEqual([
      "functions/total_of(integer).sql",
      "sequences/people_id_seq.sql",
      "tables/orders.sql",
      "tables/people.sql",
      "tables/tags.sql",
      "types/mood.sql",
      "views/big_orders.sql",
    ]);
    expect(files.find((f) => f.path === "tables/people.sql")?.text).toBe(
      [
        'CREATE TABLE "dev"."people" (',
        `    "id" integer DEFAULT nextval('dev.people_id_seq'::regclass) NOT NULL,`,
        '    "name" text NOT NULL,',
        '    "joined" timestamp with time zone DEFAULT now(),',
        '    "email" text,',
        '    CONSTRAINT "people_pkey" PRIMARY KEY ("id")',
        ");",
        "",
        'CREATE INDEX "people_name" ON "dev"."people" USING "btree" ("name");',
        "",
        `COMMENT ON TABLE "dev"."people" IS 'Who buys';`,
        "",
        `COMMENT ON COLUMN "dev"."people"."email" IS 'Where receipts go';`,
        "",
      ].join("\n"),
    );
    expect(files.find((f) => f.path === "types/mood.sql")?.text).toBe(`CREATE TYPE "dev"."mood" AS ENUM ('sad', 'ok', 'glad');\n`);
    // The same twice, whatever order the server read them in.
    const shuffled = devRows();
    shuffled.tables = Object.fromEntries(Object.entries(shuffled.tables).reverse());
    expect(dumpOf(served(shuffled))).toEqual(files);
    // A name that is not plain lower case keeps its own file.
    const mixed = modelOfFiles("dev", [{ path: "a.sql", text: 'CREATE TABLE "People" (id int); CREATE TABLE people (id int);' }]);
    expect(dumpOf(mixed).map((f) => f.path)).toEqual([expect.stringMatching(/^tables\/People-[a-z0-9]+\.sql$/u), "tables/people.sql"]);
  });

  it("a dumped folder and a saved snapshot read back compare equal to the schema", () => {
    const model = served();
    expect(compareModels(model, modelOfFiles("dev", dumpOf(model))).items).toEqual([]);
    const text = snapshotText(model, { from: "Dev", at: new Date("2026-11-22T09:00:00Z") });
    const back = snapshotModel(text);
    expect(back).toMatchObject({ from: "Dev", saved: "2026-11-22T09:00:00.000Z" });
    expect(compareModels(model, back.model).items).toEqual([]);
    expect(() => snapshotModel('{"format":"other"}')).toThrow("it is not a saved schema");
    // A hand-written file, with aliases, a serial and inline keys, reads as the server's.
    const hand = modelOfFiles("dev", [
      {
        path: "hand.sql",
        text: `CREATE TYPE mood AS ENUM ('sad', 'ok', 'glad');
          CREATE TABLE people (id serial PRIMARY KEY, name text NOT NULL, joined timestamptz DEFAULT now(), email text);
          COMMENT ON TABLE people IS 'Who buys'; COMMENT ON COLUMN people.email IS 'Where receipts go';
          CREATE INDEX people_name ON people (name);
          CREATE TABLE orders (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, person int REFERENCES people, total decimal(10, 2) CHECK (total > 0::numeric));
          CREATE TABLE tags (id int4 PRIMARY KEY, person integer REFERENCES people (id), label varchar NOT NULL);`,
      },
    ]);
    const got = compareModels(model, hand).items.map((i) => [i.key, i.state]);
    expect(got).toEqual([
      ["function total_of(integer)", "left"],
      ["table tags", "differs"],
      ["view big_orders", "left"],
    ]);
  });
});
