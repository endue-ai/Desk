// A table view's quick filters and sort keys as the real clients run them (ui/grid/filters.js,
// ADR 0288): each filter's SQL after a typed WHERE, the keys as ORDER BY, on values that hold the
// LIKE wildcards, the escape character, a quote, NULL, '' and 'NULL'. sqlite3 runs when it is on PATH
// (3.37 or newer), psql and mysql when ENDUE_DB_TEST_POSTGRES and ENDUE_DB_TEST_MYSQL hold a URI of a
// scratch database, as live.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareVersions, createClients, parseVersion } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { createExecutor } from "../ui/execute.js";
import { type Filter, orderSql, whereWith } from "../ui/grid/filters.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import type { Dialect } from "../ui/sql/lexer.js";
import { clientVersion, nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";

const sqliteLine = process.platform === "win32" ? undefined : clientVersion("sqlite3");
const sqliteOk =
  sqliteLine && compareVersions(parseVersion(sqliteLine)?.version ?? "0", "3.37") >= 0;
const scratch = mkdtempSync(join(tmpdir(), "endue-grid-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function runner(conn: Connection, password?: string) {
  const bridge = nodeBridge();
  const run = createRunner(bridge);
  const settings = fromValues({ "endue.database.max-rows": 100 });
  const executor = createExecutor({
    runner: run,
    output: inProcessOutput(),
    clients: createClients(run, () => settings),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  return (sql: string) => executor.execute(conn, sql, {});
}

const ROWS: [number, string | null, number][] = [
  [1, "50%_a!", 3],
  [2, "plain", 10],
  [3, null, 2],
  [4, "", 2],
  [5, "NULL", 7],
  [6, "it's 50%", 10],
  [7, "Plain text", 1],
];
const f = (name: string, op: Filter["op"], value: string | null = null, numeric = false) => ({
  key: name,
  name,
  op,
  value,
  numeric,
});

function scenarios(make: () => { conn: Connection; password?: string }, dialect: Dialect) {
  const table = dialect === "mysql" ? "`t469_grid`" : '"t469_grid"';
  const ids = async (where: string, order = "") => {
    const { conn, password } = make();
    const run = runner(conn, password);
    const sql = `select id from ${table}${where ? ` where ${where}` : ""} order by ${order ? `${order}, ` : ""}id`;
    const done = await run(sql);
    const statement = done.result.statements[0];
    expect(statement?.error, sql).toBeUndefined();
    return (statement?.sets[0]?.rows ?? []).map((row) => Number(row[0]));
  };

  it("makes the scratch table", async () => {
    const { conn, password } = make();
    const run = runner(conn, password);
    const values = ROWS.map(
      ([id, note, n]) =>
        `(${id}, ${note === null ? "NULL" : `'${note.replaceAll("'", "''")}'`}, ${n})`,
    ).join(", ");
    const done = await run(
      `drop table if exists ${table};\ncreate table ${table} (id integer primary key, note varchar(40), n integer);\ninsert into ${table} (id, note, n) values ${values}`,
    );
    for (const statement of done.result.statements) expect(statement.error).toBeUndefined();
  });

  it("contains finds the wildcards and the escape character as text, in any case", async () => {
    expect(await ids(whereWith(dialect, "", [f("note", "contains", "50%_a!")]))).toEqual([1]);
    expect(await ids(whereWith(dialect, "", [f("note", "contains", "50%")]))).toEqual([1, 6]);
    expect(await ids(whereWith(dialect, "", [f("note", "contains", "PLAIN")]))).toEqual([2, 7]);
    expect(await ids(whereWith(dialect, "", [f("note", "contains", "'s")]))).toEqual([6]);
  });

  it("equals, not equals, greater and less, numbers bare in a numeric column", async () => {
    expect(await ids(whereWith(dialect, "", [f("n", "eq", "10", true)]))).toEqual([2, 6]);
    expect(await ids(whereWith(dialect, "", [f("n", "gt", "2", true)]))).toEqual([1, 2, 5, 6]);
    expect(await ids(whereWith(dialect, "", [f("n", "lt", "3", true)]))).toEqual([3, 4, 7]);
    expect(await ids(whereWith(dialect, "", [f("note", "eq", "it's 50%")]))).toEqual([6]);
    // <> leaves NULL out, as SQL does.
    expect(await ids(whereWith(dialect, "", [f("note", "ne", "plain")]))).toEqual([1, 4, 5, 6, 7]);
  });

  it("keeps NULL, '' and 'NULL' apart", async () => {
    expect(await ids(whereWith(dialect, "", [f("note", "null")]))).toEqual([3]);
    expect(await ids(whereWith(dialect, "", [f("note", "empty")]))).toEqual([4]);
    expect(await ids(whereWith(dialect, "", [f("note", "eq", "NULL")]))).toEqual([5]);
    expect(await ids(whereWith(dialect, "", [f("note", "notNull")]))).toHaveLength(6);
  });

  it("joins the quick filters after a typed WHERE, which keeps its own OR", async () => {
    const where = whereWith(dialect, "n = 10 or n = 2", [f("note", "notNull")]);
    expect(await ids(where)).toEqual([2, 4, 6]);
  });

  it("orders by the sort keys, the first key first", async () => {
    const keys = [
      { key: "n", name: "n", direction: "desc" as const },
      { key: "id", name: "id", direction: "asc" as const },
    ];
    expect(await ids("", orderSql(dialect, keys))).toEqual([2, 6, 5, 1, 3, 4, 7]);
  });

  it("drops the scratch table", async () => {
    const { conn, password } = make();
    const done = await runner(conn, password)(`drop table ${table}`);
    expect(done.result.statements[0]?.error).toBeUndefined();
  });
}

describe.skipIf(!sqliteOk)("a table view's quick filters in sqlite3, for real", () => {
  scenarios(
    () => ({ conn: normalize({ engine: "sqlite", file: join(scratch, "grid.db"), id: "c-live" }) }),
    "sqlite",
  );
});

const live = (uri: string) => () => {
  const { fields, password } = parseUri(uri);
  return { conn: normalize({ ...fields, id: "c-live", name: "live" }), password };
};

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
describe.skipIf(!pgUri)("a table view's quick filters in psql, for real", () => {
  scenarios(live(pgUri ?? ""), "postgresql");
});

const myUri = process.env.ENDUE_DB_TEST_MYSQL;
describe.skipIf(!myUri)("a table view's quick filters in mysql, for real", () => {
  scenarios(live(myUri ?? ""), "mysql");
});
