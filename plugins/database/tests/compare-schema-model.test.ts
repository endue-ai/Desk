// Two schemas compared (PG-53, ui/features/compare-schema/diff.js): objects on one side only and
// objects that differ, each with its DDL on both sides, over fixture pairs; and what is no
// difference: formatting, order, the schema's own name and the names PostgreSQL makes up.
import { describe, expect, it } from "vitest";
import { compareModels } from "../ui/features/compare-schema/diff.js";
import { modelOfFiles } from "../ui/features/compare-schema/folder.js";
import { modelOfRows } from "../ui/features/compare-schema/read.js";
import { devRows, prodRows, readRows } from "./compare-schema-fixture";

const KEYS = ["server.version", "server.types", "server.casts", "server.roles", "server.methods", "tables", "table.table", "table.columns", "table.constraints", "table.indexes", "views", "sequences", "routines", "types", "triggers"];
/** A fixture schema read as the server answers it. */
const served = (schema: string, rows: ReturnType<typeof prodRows>) =>
  modelOfRows(schema, Object.fromEntries(KEYS.map((k) => [k, (readRows(k, rows).rows ?? []).slice(1) as (string | null)[][]]))).model;
const files = (schema: string, text: string) => modelOfFiles(schema, [{ path: "schema.sql", text }]);

describe("two schemas compared", () => {
  it("lists objects on one side only and objects that differ, each with its DDL on both sides", () => {
    const got = compareModels(served("dev", devRows()), served("prod", prodRows()));
    expect(got.items.map((i) => [i.kind, i.name, i.state])).toEqual([
      ["type", "mood", "differs"],
      ["table", "orders", "differs"],
      ["table", "people", "differs"],
      ["table", "tags", "left"],
      ["view", "big_orders", "differs"],
    ]);
    expect(got.same).toBe(2);
    const people = got.items.find((i) => i.name === "people");
    expect(people?.left).toContain('"email" text');
    expect(people?.left).toContain('CREATE TABLE "dev"."people"');
    expect(people?.right).not.toContain("email");
    expect(got.items.find((i) => i.name === "tags")?.right).toBe("");
    expect(got.items.find((i) => i.name === "big_orders")).toMatchObject({
      left: expect.stringContaining("total > 500::numeric"),
      right: expect.stringContaining("total > 100::numeric"),
    });
  });

  it("formatting, order and generated names are not differences", () => {
    const a = files(
      "app",
      `CREATE TABLE app.people (
         id integer NOT NULL,
         name text NOT NULL,
         code varchar(12),
         CONSTRAINT people_pkey PRIMARY KEY (id),
         CONSTRAINT people_code_key UNIQUE (code),
         CHECK (length(name) > 0)
       );
       CREATE INDEX people_name ON app.people USING btree (name);
       CREATE INDEX people_lower ON app.people (lower(name));
       CREATE VIEW app.named AS SELECT name FROM app.people;`,
    );
    const b = files(
      "app",
      `-- the same, written otherwise
       create view named as select NAME
         from "people";
       create index "people_lower" on people ((lower(name)));
       CREATE   TABLE "people" (
         code CHARACTER VARYING(12) UNIQUE,
         "name" TEXT not null check ((length(name) > 0)),
         id INT PRIMARY KEY
       );
       create index people_name on people (name);`,
    );
    expect(compareModels(a, b).items).toEqual([]);
    // The schema's own name is no difference either.
    const c = files("live", `CREATE TABLE live.people (id int PRIMARY KEY, name text NOT NULL, code varchar(12) UNIQUE, CHECK (length(name) > 0));
      CREATE INDEX people_name ON live.people (name); CREATE INDEX people_lower ON live.people (lower(name));
      CREATE VIEW live.named AS SELECT name FROM live.people;`);
    expect(compareModels(a, c).items).toEqual([]);
    // A name chosen for a constraint is: renamed, it differs.
    const d = files("app", `CREATE TABLE people (id int CONSTRAINT people_id PRIMARY KEY, name text NOT NULL, code varchar(12) UNIQUE, CHECK (length(name) > 0));
      CREATE INDEX people_name ON people (name); CREATE INDEX people_lower ON people (lower(name));
      CREATE VIEW named AS SELECT name FROM people;`);
    expect(compareModels(a, d).items.map((i) => [i.name, i.state])).toEqual([["people", "differs"]]);
  });
});
