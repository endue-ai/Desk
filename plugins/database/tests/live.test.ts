// The real clients, end to end through the runner, the engines and the executor. sqlite3 runs when
// it is on PATH (3.37 or newer); psql and mysql (or mariadb) when ENDUE_DB_TEST_POSTGRES and
// ENDUE_DB_TEST_MYSQL hold a URI of a scratch database, for example postgresql://postgres:pw@db/postgres.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareVersions, createClients, parseVersion } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { createExecutor, Refusal } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { clientVersion, nodeBridge } from "./node-bridge";

const sqliteLine = process.platform === "win32" ? undefined : clientVersion("sqlite3");
const sqliteOk =
  sqliteLine && compareVersions(parseVersion(sqliteLine)?.version ?? "0", "3.37") >= 0;
const scratch = mkdtempSync(join(tmpdir(), "endue-db-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function harness(conn: Connection, password?: string, overrides: Record<string, unknown> = {}) {
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({ "endue.database.max-rows": 100, ...overrides });
  const clients = createClients(runner, () => settings);
  const executor = createExecutor({
    runner,
    clients,
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const run = (sql: string, options: Parameters<typeof executor.execute>[2] = {}) =>
    executor.execute(conn, sql, options);
  return { run, runner };
}

function connectionOf(uri: string, readOnly = false) {
  const { fields, password } = parseUri(uri);
  return { conn: normalize({ ...fields, id: "c-live", name: "live", readOnly }), password };
}

/** The same checks for every engine; `ddl` makes the scratch table, `sleep` a slow statement. */
function scenarios(
  make: () => { conn: Connection; password?: string },
  ddl: string,
  sleep: string,
  many: string,
) {
  it("keeps NULL, '' and 'NULL' apart and text as it is", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password);
    await run("drop table if exists endue_t");
    const done = await run(
      `${ddl};\ninsert into endue_t (id, v) values (1, NULL), (2, ''), (3, 'NULL'), (4, 'a,"b"\n\tc é😀');\nselect id, v from endue_t order by id`,
    );
    const [create, insert, select] = done.result.statements;
    expect(create?.error).toBeUndefined();
    expect(insert?.affected).toBe(4);
    expect(select?.sets[0]?.columns).toEqual(["id", "v"]);
    expect(select?.sets[0]?.rows).toEqual([
      ["1", null],
      ["2", ""],
      ["3", "NULL"],
      ["4", 'a,"b"\n\tc é😀'],
    ]);
  });

  it("stops at the first error, says where it is and leaves the rest not run", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password);
    const done = await run("select 1 as one;\nselec 2;\nselect 3");
    const [first, second, third] = done.result.statements;
    expect(first?.sets[0]?.rows).toEqual([["1"]]);
    expect(second?.error?.kind).toBe("sql");
    expect(second?.error?.message).toMatch(/syntax|selec/iu);
    expect(third?.ran).toBe(false);
  });

  it("stops a single read once it has one row more than the limit", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password);
    const started = Date.now();
    const done = await run(many, { maxRows: 5 });
    const set = done.result.statements[0]?.sets[0];
    expect(set?.rows).toHaveLength(5);
    expect(set?.truncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("rolls a dry run back", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password);
    await run(`${ddl}; delete from endue_t where id > 100`);
    await run("insert into endue_t (id, v) values (101, 'x')", { mode: "dry-run" });
    const after = await run("select count(*) from endue_t where id > 100");
    expect(after.result.statements[0]?.sets[0]?.rows).toEqual([["0"]]);
  });

  it("cancels a slow statement", async () => {
    const { conn, password } = make();
    const { run, runner } = harness(conn, password);
    const running = run(sleep);
    setTimeout(() => runner.cancel(), 700);
    const done = await running;
    expect(done.result.statements[0]?.error?.kind).toBe("cancelled");
  });

  it("refuses a write on a read-only connection before the client runs", async () => {
    const { conn, password } = make();
    const { run } = harness({ ...conn, readOnly: true }, password);
    await expect(run("insert into endue_t (id) values (5)")).rejects.toBeInstanceOf(Refusal);
  });
}

describe.skipIf(!sqliteOk)("sqlite3, for real", () => {
  const make = () => ({
    conn: normalize({ engine: "sqlite", file: join(scratch, "live.db"), id: "c-live" }),
  });
  scenarios(
    make,
    "create table if not exists endue_t (id integer primary key, v text)",
    "with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c",
    "with recursive c(x) as (select 1 union all select x + 1 from c) select x from c",
  );

  it("prints storage classes as they are: integers, reals, blobs", async () => {
    const { run } = harness(make().conn);
    const done = await run("select 9223372036854775807, 0.1, 2.0, x'00ff', -0.5");
    expect(done.result.statements[0]?.sets[0]?.rows).toEqual([
      ["9223372036854775807", "0.1", "2.0", "0x00FF", "-0.5"],
    ]);
  });

  it("refuses dot-commands and keeps -safe on", async () => {
    const { run } = harness(make().conn);
    await expect(run(".shell echo no")).rejects.toThrow(/dot-commands/u);
    const done = await run("select load_extension('nothing')");
    expect(done.result.statements[0]?.error?.kind).toBe("sql");
  });
});

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
describe.skipIf(!pgUri)("psql, for real", () => {
  const make = () => connectionOf(pgUri ?? "");
  scenarios(
    make,
    "create table if not exists endue_t (id int primary key, v text)",
    "select pg_sleep(30)",
    "select g from generate_series(1, 10000000) g",
  );

  it("sends a meta-command nowhere", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password);
    await expect(run("\\! echo pwned")).rejects.toThrow(/psql meta-commands/u);
    const done = await run("select 1 \\! echo pwned");
    expect(done.result.statements[0]?.error?.kind).toBe("sql");
  });

  it("ends a statement past the timeout on the server", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password, { "endue.database.timeout-seconds": 1 });
    const done = await run("select pg_sleep(5)");
    expect(done.result.statements[0]?.error?.message).toMatch(/statement timeout/u);
  });

  it("says a wrong password is an authentication failure", async () => {
    const { conn } = make();
    const { run } = harness(conn, "certainly-wrong");
    const done = await run("select 1");
    expect(done.result.error?.kind).toBe("auth");
  });
});

const myUri = process.env.ENDUE_DB_TEST_MYSQL;
describe.skipIf(!myUri)("mysql, for real", () => {
  const make = () => connectionOf(myUri ?? "");
  scenarios(
    make,
    "create table if not exists endue_t (id int primary key, v text)",
    // MySQL's SLEEP() returns 1 when its query is killed; a real query fails, which stops the client.
    "select count(*) from information_schema.columns a, information_schema.columns b, information_schema.columns c",
    "select * from information_schema.columns",
  );

  it("keeps a procedure body whole under DELIMITER and turns the client's commands off", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password);
    const done = await run(
      "drop procedure if exists endue_p;\nDELIMITER //\ncreate procedure endue_p() begin select 1 as a; select 2 as b; end//\nDELIMITER ;\ncall endue_p()",
    );
    const call = done.result.statements[2];
    expect(call?.sets.map((s) => s.rows)).toEqual([[["1"]], [["2"]]]);
    const shell = await run("select 1 \\! echo pwned");
    expect(shell.result.statements[0]?.error).toMatchObject({
      kind: "client",
      message: "Unknown command '\\!'.",
    });
  });

  it("prints bytes as hex", async () => {
    const { conn, password } = make();
    const { run } = harness(conn, password);
    const done = await run("select x'00ff' as b");
    expect(done.result.statements[0]?.sets[0]?.rows).toEqual([["0x00FF"]]);
  });
});
