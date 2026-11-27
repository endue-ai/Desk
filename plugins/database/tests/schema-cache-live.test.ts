// The schema cache against a real PostgreSQL (PG-06), when ENDUE_DB_TEST_POSTGRES holds the URI of
// a scratch database: what it reads, that a change made in another session is picked up by a
// refresh that reads that schema alone, that an unchanged schema is not read again (the statements
// are counted), that ANALYZE moves no fingerprint, and that the cache survives a reload.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { createSchemaCache } from "../ui/schema-cache/index.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { kindOf, schemasOf } from "./pg-catalog";
import { memoryStore } from "./schema-cache-helpers";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;

describe.skipIf(!pgUri)("the schema cache on a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgresql://localhost/x");
  const conn = normalize({ ...fields, id: "c-live", name: "live" });
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
  /** Another session: a run of its own, not the cache's. */
  const elsewhere = async (sql: string) => {
    const done = await executor.execute(conn, sql);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
    return done;
  };
  const store = memoryStore();
  const cacheOn = () => {
    const sqls: string[] = [];
    const cache = createSchemaCache({
      execute: (c, sql, options) => {
        sqls.push(sql);
        return executor.execute(c, sql, options);
      },
      store,
      systemSchemas: () => false,
      changed: () => {},
    });
    return { cache, sqls };
  };
  const SCHEMAS = ["t446_a", "t446_b"];
  /** The server's server_version_num: PostgreSQL 18 keeps NOT NULL as constraints of their own. */
  let version = 0;

  beforeAll(async () => {
    const shown = await elsewhere("SHOW server_version_num");
    version = Number(shown.result.statements[0]?.sets[0]?.rows[0]?.[0]);
    await elsewhere("DROP SCHEMA IF EXISTS t446_a, t446_b CASCADE");
    await elsewhere(
      "CREATE SCHEMA t446_a; CREATE SCHEMA t446_b;\n" +
        "CREATE TABLE t446_a.people (id int PRIMARY KEY, name text NOT NULL DEFAULT 'x');\n" +
        "CREATE TABLE t446_b.orders (id int PRIMARY KEY, person int REFERENCES t446_a.people (id), total numeric(10, 2) CHECK (total >= 0));\n" +
        "CREATE INDEX orders_person ON t446_b.orders (person);\n" +
        "COMMENT ON TABLE t446_a.people IS 'Who buys';\n" +
        "CREATE FUNCTION t446_b.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;\n" +
        "CREATE TRIGGER orders_touch BEFORE UPDATE ON t446_b.orders FOR EACH ROW EXECUTE FUNCTION t446_b.touch();\n" +
        "CREATE VIEW t446_a.names AS SELECT name FROM t446_a.people",
    );
  }, 60_000);
  afterAll(async () => {
    await elsewhere("DROP SCHEMA IF EXISTS t446_a, t446_b CASCADE");
  }, 60_000);

  it("reads the schemas, then only what another session changed", async () => {
    const { cache, sqls } = cacheOn();
    await cache.open(conn);
    await cache.choose(conn, SCHEMAS);
    await cache.settled(conn);
    const view = () => cache.view(conn);
    expect(
      view()
        ?.objects("t446_a")
        ?.map((o) => [o.name, o.kind]),
    ).toEqual([
      ["names", "view"],
      ["people", "table"],
    ]);
    expect(view()?.columns("t446_a", "people")).toEqual([
      { name: "id", type: "integer", nullable: false, default: null, primary: true, comment: "" },
      {
        name: "name",
        type: "text",
        nullable: false,
        default: "'x'::text",
        primary: false,
        comment: "",
      },
    ]);
    expect(view()?.comment("t446_a", "people")).toBe("Who buys");
    expect(view()?.foreignKeys("t446_b", "orders")).toEqual([
      {
        name: "orders_person_fkey",
        columns: ["person"],
        schema: "t446_a",
        table: "people",
        refColumns: ["id"],
      },
    ]);
    expect(
      view()
        ?.parts("t446_b", "orders")
        ?.map((p) => [p.kind, p.name]),
    ).toEqual([
      ["check", "orders_total_check"],
      // From 18 the primary key's column holds a NOT NULL constraint (contype 'n') too.
      ...(version >= 180000 ? [["constraint", "orders_id_not_null"]] : []),
      ["foreign key", "orders_person_fkey"],
      ["primary key", "orders_pkey"],
      ["index", "orders_person"],
      ["index", "orders_pkey"],
      ["trigger", "orders_touch"],
    ]);
    expect(view()?.routines("t446_b")).toMatchObject([
      { name: "touch", args: "", result: "trigger" },
    ]);

    // Nothing changed, then ANALYZE: the fingerprint statement alone (and the database level's
    // two readers when another session changed a role of the server meanwhile).
    sqls.length = 0;
    const reports = [await cache.refresh(conn)];
    await elsewhere("ANALYZE t446_a.people");
    reports.push(await cache.refresh(conn));
    for (const report of reports) {
      expect(report.read).toEqual([]);
      expect(report.statements).toBe(report.database ? 3 : 1);
    }
    expect(sqls.map(kindOf).filter((k) => k === "marks")).toHaveLength(2);
    expect(
      sqls.map(kindOf).filter((k) => k !== "marks" && k !== "database" && k !== "server"),
    ).toEqual([]);

    // Each change in another session reads its schema alone.
    const changes: [string, string][] = [
      ["ALTER TABLE t446_a.people ADD COLUMN age int", "t446_a"],
      ["COMMENT ON COLUMN t446_b.orders.total IS 'With tax'", "t446_b"],
      ["CREATE INDEX people_name ON t446_a.people (name)", "t446_a"],
      ["ALTER TABLE t446_b.orders ALTER COLUMN total SET DEFAULT 0", "t446_b"],
      [
        "CREATE OR REPLACE FUNCTION t446_b.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.total := 0; RETURN NEW; END $$",
        "t446_b",
      ],
    ];
    // The nine per-schema readers; the database level's two only when it moved too (roles are
    // the whole server's: another session may make one meanwhile).
    for (const [sql, schema] of changes) {
      await elsewhere(sql);
      sqls.length = 0;
      const report = await cache.refresh(conn);
      expect(report.read).toEqual([schema]);
      expect(report.statements).toBe(report.database ? 12 : 10);
      for (const statement of sqls.slice(1, 10)) expect(schemasOf(statement)).toEqual([schema]);
    }
    expect(
      view()
        ?.columns("t446_a", "people")
        ?.map((c) => c.name),
    ).toEqual(["id", "name", "age"]);
    expect(
      view()
        ?.columns("t446_b", "orders")
        ?.find((c) => c.name === "total"),
    ).toMatchObject({
      comment: "With tax",
      default: "0",
    });

    // A DDL statement run from the plugin starts the check itself.
    const done = await elsewhere("CREATE TABLE t446_b.visits (id int)");
    expect(cache.ran(conn, done)).toBe(true);
    await cache.settled(conn);
    expect(
      view()
        ?.objects("t446_b")
        ?.map((o) => o.name),
    ).toContain("visits");
  }, 120_000);

  it("survives a reload of the plugin and asks the server for the fingerprints only", async () => {
    const { cache, sqls } = cacheOn();
    await cache.open(conn);
    expect(
      cache
        .view(conn)
        ?.columns("t446_a", "people")
        ?.map((c) => c.name),
    ).toEqual(["id", "name", "age"]);
    await cache.settled(conn);
    expect(sqls.map(kindOf).filter((k) => k !== "database" && k !== "server")).toEqual(["marks"]);
  }, 60_000);

  it("a table renamed in one schema reads again the schema whose foreign key names it", async () => {
    const { cache } = cacheOn();
    await cache.open(conn);
    await cache.settled(conn);
    await elsewhere("ALTER TABLE t446_a.people RENAME TO persons");
    const report = await cache.refresh(conn);
    expect(report.read).toEqual(["t446_a", "t446_b"]);
    expect(report.statements).toBe(report.database ? 22 : 20);
    expect(cache.view(conn)?.foreignKeys("t446_b", "orders")?.[0]).toMatchObject({
      schema: "t446_a",
      table: "persons",
    });
  }, 60_000);
});
