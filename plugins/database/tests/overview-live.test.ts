// The overview against a real PostgreSQL through psql (ENDUE_DB_TEST_POSTGRES holds a URI of a
// scratch database, as live.test.ts): a table with an unused index and dead rows shows both, every
// section reads as the URI's role, pg_stat_statements is explained while it is not created here,
// and, when the server loads it, lists the heaviest statements once it is. Skipped without the URI.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createExecutor } from "../ui/execute.js";
import { type OverviewState, type Read, readOverview } from "../ui/features/overview/read.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

function harness(link: string) {
  const { fields, password } = parseUri(link);
  const conn = normalize({ ...fields, id: "c-live", name: "live" });
  const runner = createRunner(nodeBridge());
  const settings = fromValues({ "endue.database.max-rows": 1000 });
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const run = async (sql: string) => {
    const done = await executor.execute(conn, sql);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
    return done.result.statements.map((s) => s.sets[0]?.rows ?? []);
  };
  return { conn, run, read: () => readOverview(executor.execute, conn) };
}

const sectionOf = (state: OverviewState, id: string) =>
  state.sections.find((s) => s.id === id) as Read;
const rowsOf = (section: Read, key: string, value: string) =>
  (section.rows ?? []).filter((row) => row[(section.names ?? []).indexOf(key)] === value);
const cell = (section: Read, row: (string | null)[] | undefined, key: string) =>
  row?.[(section.names ?? []).indexOf(key)];

/** Read until `ready` holds: the statistics reach other sessions a moment after a session ends. */
async function readUntil(read: () => Promise<OverviewState>, ready: (s: OverviewState) => boolean) {
  let state = await read();
  for (let i = 0; i < 40 && !ready(state); i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = await read();
  }
  return state;
}

describe.skipIf(!uri)("the overview of a real server", () => {
  // The describe's body runs even when it is skipped: a stand-in URI that nothing ever runs against.
  const { run, read } = harness(uri ?? "postgres://skipped@localhost/skipped");
  let created = false;

  beforeAll(async () => {
    await run(
      [
        "DROP TABLE IF EXISTS endue_ov_orders",
        "CREATE TABLE endue_ov_orders (id int PRIMARY KEY, note text) WITH (autovacuum_enabled = false)",
        "CREATE INDEX endue_ov_orders_note_idx ON endue_ov_orders (note)",
        "INSERT INTO endue_ov_orders SELECT g, 'note ' || g FROM generate_series(1, 1000) g",
        "DELETE FROM endue_ov_orders WHERE id <= 400",
      ].join(";\n"),
    );
  }, 60_000);

  afterAll(async () => {
    await run("DROP TABLE IF EXISTS endue_ov_orders");
    if (created) await run("DROP EXTENSION IF EXISTS pg_stat_statements");
  }, 60_000);

  it("shows a table's unused index and its dead rows", async () => {
    const state = await readUntil(read, (s) => {
      const vacuum = sectionOf(s, "vacuum");
      return (
        Number(cell(vacuum, rowsOf(vacuum, "table", "endue_ov_orders")[0], "dead_rows")) >= 400
      );
    });
    const unused = sectionOf(state, "unused");
    const index = rowsOf(unused, "index", "endue_ov_orders_note_idx")[0];
    expect(cell(unused, index, "scans")).toBe("0");
    expect(rowsOf(unused, "index", "endue_ov_orders_pkey")).toEqual([]);
    const vacuum = sectionOf(state, "vacuum");
    const table = rowsOf(vacuum, "table", "endue_ov_orders")[0];
    expect(Number(cell(vacuum, table, "dead_rows"))).toBeGreaterThanOrEqual(400);
    expect(cell(vacuum, table, "own_settings")).toBe("autovacuum_enabled=false");
    expect(cell(vacuum, table, "vacuum_at")).toBeNull();
    const tables = sectionOf(state, "tables");
    const sizes = rowsOf(tables, "table", "endue_ov_orders")[0];
    expect(Number(cell(tables, sizes, "total_bytes"))).toBeGreaterThan(0);
    expect(Number(cell(tables, sizes, "index_bytes"))).toBeGreaterThan(0);
  }, 60_000);

  it("reads every section as the URI's role", async () => {
    const state = await read();
    expect(state.server?.versionNum).toBeGreaterThanOrEqual(130000);
    expect(state.sections.filter((s) => s.failed).map((s) => `${s.id}: ${s.failed}`)).toEqual([]);
    expect(sectionOf(state, "server").rows?.length).toBe(14);
    expect(sectionOf(state, "wraparound").rows?.length).toBeGreaterThan(0);
  }, 60_000);

  it("explains pg_stat_statements while it is not created in the database", async () => {
    const state = await read();
    if (state.server?.pgss.version) return;
    const statements = sectionOf(state, "statements");
    expect(statements.failed).toBeUndefined();
    expect(statements.missing).toMatch(/CREATE EXTENSION pg_stat_statements/u);
    expect(statements.rows).toBeUndefined();
  }, 60_000);

  it("lists the heaviest statements when the server loads pg_stat_statements", async () => {
    const before = await read();
    const pgss = before.server?.pgss;
    if (!pgss?.available || !(pgss.preload ?? "").includes("pg_stat_statements")) return;
    if (!pgss.version) {
      await run("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
      created = true;
    }
    // The section lists this database's 20 statements that took the most time, and other live test
    // files run in the same database at once: count from nothing (pg_stat_statements 1.7+), and make
    // the test's own statement take long enough (5 × 0.3 s) to be among them.
    await run(
      "SELECT pg_stat_statements_reset(0, (SELECT oid FROM pg_database WHERE datname = current_database()), 0)",
    ).catch(() => undefined);
    for (let i = 0; i < 5; i++)
      await run("SELECT count(*), pg_sleep(0.3) FROM endue_ov_orders WHERE id > 500");
    const state = await readUntil(read, (s) => (sectionOf(s, "statements").rows?.length ?? 0) > 0);
    const statements = sectionOf(state, "statements");
    expect(statements.failed).toBeUndefined();
    expect(statements.missing).toBeUndefined();
    expect(statements.names).toEqual(
      expect.arrayContaining(["total_ms", "calls", "mean_ms", "rows", "query"]),
    );
    const ours = (statements.rows ?? []).find((row) =>
      /endue_ov_orders/u.test(cell(statements, row, "query") ?? ""),
    );
    expect(Number(cell(statements, ours, "calls"))).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
