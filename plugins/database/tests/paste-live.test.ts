// A paste against a real PostgreSQL (PG-43, #470), when ENDUE_DB_TEST_POSTGRES holds a scratch
// database's URI: 3 x 4 cells of tab-separated text pasted over two rows and two new ones of a table
// with an identity column, a numeric, a date and a jsonb column, submitted in one transaction and
// read back equal; a bad date refused before anything is pending; a duplicated row given a new
// identity by the server.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCatalog } from "../ui/catalog.js";
import { readTypes } from "../ui/cell-editors/pg-types.js";
import { attachEditors } from "../ui/cell-editors/resolve.js";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { applyCells, planCells, refusalOf } from "../ui/edit/cells.js";
import { duplicateRows } from "../ui/edit/duplicate.js";
import { readPaste } from "../ui/edit/paste-text.js";
import { countChanges, emptyChanges, targetOf } from "../ui/edit/pending.js";
import { submitChanges } from "../ui/edit/submit.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";

function liveHarness(given: string) {
  const { fields, password } = parseUri(given);
  const conn = normalize({ ...fields, id: "c-live", name: "live", readOnly: false });
  const runner = createRunner(nodeBridge());
  const settings = fromValues({ "endue.database.max-rows": 100 });
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  return { conn, execute: executor.execute };
}

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

describe.skipIf(!uri)("a paste on a real server", () => {
  let made: ReturnType<typeof liveHarness> | undefined;
  const live = () => {
    made ??= liveHarness(uri ?? "");
    return made;
  };
  const run = (sql: string) => live().execute(live().conn, sql);
  const table = "t470_paste";
  const select = `select id, amount, due, doc from ${table} order by id`;

  beforeAll(async () => {
    await run(
      `drop table if exists ${table};\n` +
        `create table ${table} (id int generated always as identity primary key, ` +
        "amount numeric(8,2), due date, doc jsonb);\n" +
        `insert into ${table} (amount, due, doc) values (1, '2026-01-01', '{"a": 1}'), (2, '2026-01-02', '[]')`,
    );
  });
  afterAll(async () => {
    await run(`drop table if exists ${table}`);
  });

  const target = async () => {
    const { conn, execute } = live();
    const catalog = createCatalog(execute, () => false);
    const columns = await catalog.columns(conn, "public", table);
    const types = await readTypes(execute, conn, "public", table);
    const set = (await run(select)).result.statements[0]?.sets[0];
    if (!set) throw new Error("no rows");
    const found = targetOf("postgresql", { schema: "public", name: table }, set.columns, columns);
    if (!found.target) throw new Error(found.reason);
    return { set, target: attachEditors(found.target, columns, types) };
  };
  /** From the amount of the first row, every column shown, the rows as the server sent them. */
  const from = (rows: number) => ({ order: [...Array(rows).keys()], columns: [0, 1, 2, 3] });

  it("refuses a bad date before anything is pending", async () => {
    const { set, target: t } = await target();
    const changes = emptyChanges();
    const text = "5\t2026-02-01\t{}\n6\t2026-13-01\t{}\n";
    const plan = planCells({
      target: t,
      set,
      changes,
      at: { ...from(set.rows.length), top: 0, left: 1, bottom: 0, right: 1 },
      values: readPaste(text).rows,
    });
    expect(refusalOf(plan, "pasted")).toBe(
      "Nothing pasted: row 2, due: Month 13 does not exist: a month is 01 to 12.",
    );
    expect(countChanges(changes)).toBe(0);
  });

  it("pastes 3 x 4 cells over two rows and two new ones, submits and reads them back", async () => {
    const { set, target: t } = await target();
    const changes = emptyChanges();
    const text = [
      "10.5\t2026-11-21\t" + '{"b": [1, 2]}',
      "\t2026-11-22\tnull",
      "1234.56\t2026-11-23\t[3]",
      `7\t\t{"tab": "a\\tb"}`,
    ].join("\r\n");
    const plan = planCells({
      target: t,
      set,
      changes,
      at: { ...from(set.rows.length), top: 0, left: 1, bottom: 0, right: 1 },
      values: readPaste(text).rows,
    });
    expect(plan.bad).toEqual([]);
    expect(plan).toMatchObject({ rows: 4, width: 3, added: 2 });
    applyCells(changes, t, set, plan);
    const done = await submitChanges({
      execute: live().execute,
      conn: live().conn,
      target: t,
      set,
      changes,
    });
    expect(done.message).toBe("Committed 4 changes in one transaction.");
    const back = (await run(select)).result.statements[0]?.sets[0]?.rows;
    expect(back).toEqual([
      ["1", "10.50", "2026-11-21", '{"b": [1, 2]}'],
      ["2", null, "2026-11-22", "null"],
      ["3", "1234.56", "2026-11-23", "[3]"],
      ["4", "7.00", null, '{"tab": "a\\tb"}'],
    ]);
  });

  it("duplicates a row, the server giving it a new identity", async () => {
    const { set, target: t } = await target();
    const changes = emptyChanges();
    expect(duplicateRows(changes, t, set, [2])).toEqual({ added: 1, left: ["id"], keys: [] });
    const done = await submitChanges({
      execute: live().execute,
      conn: live().conn,
      target: t,
      set,
      changes,
    });
    expect(done.ok).toBe(true);
    const back = (await run(`${select} desc limit 1`)).result.statements[0]?.sets[0]?.rows;
    expect(back).toEqual([["5", "1234.56", "2026-11-23", "[3]"]]);
  });
});
