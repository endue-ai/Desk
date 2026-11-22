// @vitest-environment jsdom
// An export read back by a real PostgreSQL (PG-61, ui/export/), on the desk core's sessions
// (core-bridge.ts), no psql. It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch
// database. Typed values with every awkward character are exported as CSV with options and as
// TSV, and read back by COPY ... FROM STDIN with the same options; INSERT batches run on the
// server; each copy equals the source, EXCEPT ALL both ways. The .xlsx's number cells hold the
// server's values exactly. Every table is a temporary one of this session.

import { afterAll, describe, expect, it } from "vitest";
import type { DbOpenResult, DbPage } from "../../../packages/bridge/src/index";
import { parseUri } from "../ui/connections.js";
import { optionsOf } from "../ui/export/options.js";
import { exportText } from "../ui/export/text.js";
import { xlsxOf } from "../ui/export/xlsx.js";
import { sharedCore } from "./core-bridge";
import { readXlsx } from "./export-reader";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
let sessionId = "";
const call = (method: string, params: Record<string, unknown>) =>
  sharedCore().call(method, { sessionId, ...params }) as Promise<DbPage>;

async function open() {
  if (sessionId) return;
  const { fields, password } = parseUri(uri);
  const host = fields.host || "localhost";
  const port = fields.port ?? 5432;
  const opened = (await sharedCore().call("db.open", {
    engine: "postgresql",
    host,
    port,
    database: fields.database || fields.user,
    user: fields.user,
    ...(password ? { password } : {}),
    ...(fields.ssl && fields.ssl !== "default" ? { tls: { mode: fields.ssl } } : {}),
    settings: { application_name: "export live" },
    scope: { permission: "db:connect", hosts: [`${host}:${port}`] },
  })) as DbOpenResult;
  if (!opened.sessionId) throw new Error(`no session: ${JSON.stringify(opened.error ?? opened)}`);
  sessionId = opened.sessionId;
}
afterAll(async () => {
  if (sessionId)
    await sharedCore()
      .call("db.close", { sessionId })
      .catch(() => {});
});

async function run(sql: string) {
  await open();
  const page = await call("db.run", { sql });
  if (page.error) throw new Error(`${sql}: ${page.error.message}`);
  return page;
}

/** COPY a text into a table, the way the file would be read. */
async function copyIn(sql: string, text: string) {
  const first = await run(sql);
  expect(first.more).toBe(true);
  const done = await call("db.copy", { data: text, done: true });
  if (done.error) throw new Error(`${sql}: ${done.error.message}`);
}

const COLUMNS = "id int8, n numeric, f float8, label text, d date, ts timestamp, note text";
const SOURCE = `INSERT INTO src VALUES
  (9007199254740993, 123456789012345678901234567890.123456789, 0.1, 'semi;colon "quoted"', '2026-11-07', '2026-11-07 09:05:03.25', NULL),
  (2, -0.000125, 1e20, E'line\\nbreak\\r\\nand\\ttab \\\\ back', '1900-03-01', '1999-12-31 23:59:59', ''),
  (3, 19.99, -1.5e-7, 'NULL', '2000-02-29', '2026-01-01 00:00:00.123456', 'x'),
  (NULL, NULL, NULL, NULL, NULL, NULL, 'NULL')`;

/** The source as the grid holds it. */
async function source() {
  await run("DROP TABLE IF EXISTS src, t_csv, t_tsv, t_ins");
  await run(`CREATE TEMP TABLE src (${COLUMNS})`);
  await run(SOURCE);
  const page = await run("SELECT * FROM src ORDER BY id");
  return {
    columns: (page.columns ?? []).map((c) => c.name),
    types: (page.columns ?? []).map((c) => c.typeOid),
    rows: page.rows,
    truncated: false,
  };
}

/** Rows in one table and not the other, both ways. */
const differences = async (table: string) =>
  (
    await run(
      `SELECT (SELECT count(*) FROM (TABLE src EXCEPT ALL TABLE ${table}) a) + (SELECT count(*) FROM (TABLE ${table} EXCEPT ALL TABLE src) b)`,
    )
  ).rows[0]?.[0];

describe.skipIf(!uri)("an export read back by PostgreSQL", () => {
  it("CSV with options and TSV read back by COPY equal the source", async () => {
    const set = await source();
    const csv = exportText(
      set,
      "csv",
      optionsOf("csv", { delimiter: ";", quote: "always", null: "NULL", lineEnding: "crlf" }),
    );
    await run(`CREATE TEMP TABLE t_csv (${COLUMNS})`);
    await copyIn(
      "COPY t_csv FROM STDIN (FORMAT csv, DELIMITER ';', NULL 'NULL', HEADER true)",
      csv,
    );
    expect(await differences("t_csv")).toBe("0");
    const tsv = exportText(set, "tsv", optionsOf("tsv"));
    await run(`CREATE TEMP TABLE t_tsv (${COLUMNS})`);
    await copyIn("COPY t_tsv FROM STDIN", tsv);
    expect(await differences("t_tsv")).toBe("0");
  });

  it("INSERT batches run on the server and equal the source", async () => {
    const set = await source();
    await run(`CREATE TEMP TABLE t_ins (${COLUMNS})`);
    const sql = exportText(set, "insert", optionsOf("insert", { batch: 3, table: "t_ins" }), {
      dialect: "postgresql",
    });
    expect(sql.match(/^INSERT INTO/gmu)).toHaveLength(2);
    // One statement a call, as the session takes them.
    for (const statement of sql.split(/(?<=;)\n(?=INSERT)/u)) await run(statement);
    expect(await differences("t_ins")).toBe("0");
  });

  it("the .xlsx's number cells hold the server's values exactly", async () => {
    const set = await source();
    const [sheet] = readXlsx(
      await xlsxOf([{ name: "src", columns: set.columns, rows: set.rows, oids: set.types }], {
        header: true,
        null: "",
      }),
    );
    const checks: string[] = [];
    for (const [r, row] of set.rows.entries())
      for (const [c, value] of row.entries()) {
        const cell = sheet?.cells.get(`${String.fromCharCode(65 + c)}${r + 2}`);
        if (cell?.t !== "n" || value === null) continue;
        // The double a spreadsheet holds, printed back, is the server's number.
        checks.push(`'${String(Number(cell.v))}'::numeric = '${value}'::numeric`);
      }
    expect(checks.length).toBeGreaterThanOrEqual(6);
    expect((await run(`SELECT ${checks.join(" AND ")}`)).rows[0]?.[0]).toBe("t");
    // Past 15 digits the cell is text, as the server printed it.
    expect(sheet?.cells.get("A4")).toMatchObject({ t: "s", v: "9007199254740993" });
    expect(sheet?.cells.get("B4")).toMatchObject({
      t: "s",
      v: "123456789012345678901234567890.123456789",
    });
  });
});
