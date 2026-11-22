// Navigation against a real PostgreSQL (PG-32), when ENDUE_DB_TEST_POSTGRES holds the URI of a
// scratch database, on the desk core's sessions (no psql): a schema with a view, a SQL-standard
// function, a PL/pgSQL function, a trigger, a foreign key, a policy and a default over one table.
// Find usages reads the dependency catalog's (marked catalog) and finds the PL/pgSQL body and a
// console's place by parsing (marked parsed); a column's and a trigger function's usages are the
// server's too; the card's columns, default and comments are what the schema cache read.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { problemModel } from "../ui/diagnose/model.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { cardOf } from "../ui/navigate/card.js";
import { findUsages } from "../ui/navigate/find.js";
import { createRunner } from "../ui/run.js";
import { createSchemaCache } from "../ui/schema-cache/index.js";
import { fromValues } from "../ui/settings.js";
import { resolver } from "./navigate-fixture";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { memoryStore } from "./schema-cache-helpers";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
const S = "t462_live";

describe.skipIf(!pgUri)("navigation on a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgres://");
  const conn = normalize({ ...fields, id: "c-live-462", name: "live" });
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({});
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    sessions: createSessions(bridge),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const run = async (sql: string) => {
    const done = await executor.execute(conn, sql);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
    return done;
  };
  const cache = createSchemaCache({
    execute: (c, sql, options) => executor.execute(c, sql, options),
    store: memoryStore(),
    systemSchemas: () => false,
    changed: () => {},
  });

  beforeAll(async () => {
    await run(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
    await run(
      `CREATE SCHEMA ${S};\nSET search_path TO ${S};\n` +
        "CREATE TABLE people (id int PRIMARY KEY, name text DEFAULT 'someone', owner text);\n" +
        "COMMENT ON TABLE people IS 'Who buys';\n" +
        "COMMENT ON COLUMN people.name IS 'Full name';\n" +
        "CREATE TABLE orders (id int PRIMARY KEY, person int REFERENCES people (id));\n" +
        "CREATE VIEW named AS SELECT id, name FROM people;\n" +
        `CREATE FUNCTION people_count() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM ${S}.people; END;\n` +
        "CREATE FUNCTION rename_all() RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE people SET name = upper(name); END $$;\n" +
        "CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;\n" +
        "CREATE TRIGGER people_touch BEFORE UPDATE ON people FOR EACH ROW EXECUTE FUNCTION touch();\n" +
        "ALTER TABLE people ENABLE ROW LEVEL SECURITY;\n" +
        "CREATE POLICY own_rows ON people USING (owner = current_user)",
    );
    await cache.open(conn);
    await cache.choose(conn, [S]);
    await cache.settled(conn);
  }, 60_000);
  afterAll(async () => {
    await run(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  }, 60_000);

  const find = async (
    aim: Parameters<typeof findUsages>[2],
    consoles: Parameters<typeof findUsages>[3] = [],
  ) => {
    const model = problemModel(conn.id, cache.view(conn) as never);
    if (!model) throw new Error("The cache read nothing.");
    const names = await resolver(model);
    const execute = (c: typeof conn, sql: string, options?: object) =>
      executor.execute(c, sql, options);
    return findUsages(
      { execute, resolve: async (text) => ({ names: names(text) }) },
      conn,
      aim,
      consoles,
    );
  };
  const listed = (items: Array<{ source: string; kind: string; name: string }>) =>
    items.map((u) => `${u.source} ${u.kind} ${u.name}`);

  it("a table's usages: the dependency catalog's, then the PL/pgSQL body and a console's place", async () => {
    const text = `select p.name from ${S}.people p`;
    const found = await find({ kind: "relation", schema: S, name: "people", relkind: "table" }, [
      { id: "b1", name: "live", kind: "console", text },
    ]);
    expect(found.capped).toBe(false);
    expect(listed(found.items)).toEqual([
      "catalog foreign key orders_person_fkey",
      "catalog function people_count",
      "catalog policy own_rows",
      "catalog trigger people_touch",
      "catalog view named",
      "parsed function rename_all",
      "parsed console live",
    ]);
    expect(found.items.find((u) => u.kind === "foreign key")).toMatchObject({ table: "orders" });
    expect(found.items.at(-1)).toMatchObject({ from: text.indexOf("people"), line: 1 });
  });

  it("a column's and a trigger function's usages are the server's", async () => {
    const id = await find({ kind: "column", schema: S, table: "people", name: "id" });
    expect(listed(id.items.filter((u) => u.source === "catalog"))).toEqual([
      "catalog foreign key orders_person_fkey",
      "catalog view named",
    ]);
    const touch = await find({ kind: "function", schema: S, name: "touch" });
    expect(listed(touch.items)).toEqual(["catalog trigger people_touch"]);
  });

  it("the card is what the schema cache read of the server", () => {
    const view = cache.view(conn);
    if (!view) throw new Error("No cache.");
    const card = cardOf(view, { kind: "relation", schema: S, name: "people", relkind: "table" });
    expect(card).toMatchObject({
      title: `${S}.people`,
      comment: "Who buys",
      keys: ["PRIMARY KEY (id)"],
    });
    expect(card?.columns?.[1]).toEqual({
      name: "name",
      type: "text",
      default: "'someone'::text",
      comment: "Full name",
    });
    const orders = cardOf(view, { kind: "relation", schema: S, name: "orders", relkind: "table" });
    expect(orders?.columns?.[1]).toMatchObject({ key: "→ people.id" });
  });
});
