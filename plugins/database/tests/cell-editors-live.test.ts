// Typed cell editors (PG-40, #467) against a real PostgreSQL, when ENDUE_DB_TEST_POSTGRES holds a
// scratch database's URI: a table of every kind of value, its types read from the catalog, each cell
// given through its editor's check and written with its literal, submitted in one transaction and
// read back equal; DEFAULT apart from NULL; a value the server refuses named by its cell.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCatalog } from "../ui/catalog.js";
import { readTypes } from "../ui/cell-editors/pg-types.js";
import { attachEditors } from "../ui/cell-editors/resolve.js";
import { checkValue } from "../ui/cell-editors/values.js";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { editCell, emptyChanges, targetOf } from "../ui/edit/pending.js";
import { submitChanges } from "../ui/edit/submit.js";
import { DEFAULT } from "../ui/edit/values.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";

/** The executor over the real psql, as live.test.ts makes it. */
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
  const execute = executor.execute;
  return { conn, execute, run: (sql: string) => execute(conn, sql) };
}

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

describe.skipIf(!uri)("typed cell editors on a real server", () => {
  // Made when the first test runs, so a skipped suite parses no URI.
  let made: ReturnType<typeof liveHarness> | undefined;
  const live = {
    get conn() {
      made ??= liveHarness(uri ?? "");
      return made.conn;
    },
    run: (sql: string) => {
      made ??= liveHarness(uri ?? "");
      return made.run(sql);
    },
  };
  const execute: ReturnType<typeof liveHarness>["execute"] = (...args) => {
    made ??= liveHarness(uri ?? "");
    return made.execute(...args);
  };
  const table = "t467_cells";
  const select = `select * from ${table} order by id`;

  beforeAll(async () => {
    await live.run(
      `drop table if exists ${table};\ndrop type if exists t467_mood;\n` +
        "create type t467_mood as enum ('sad', 'ok', 'so so');\n" +
        `create table ${table} (id int primary key, flag boolean, mood t467_mood not null default 'ok', ` +
        "day date, at_time time, at timestamptz, span interval, j json, jb jsonb, ints int[], " +
        "tags text[], bytes bytea, n int default 42, u uuid, total numeric(8,2), " +
        "twice int generated always as (id * 2) stored, num int generated always as identity);\n" +
        `insert into ${table} (id, n, flag) values (1, 5, true), (2, 7, true)`,
    );
  });
  afterAll(async () => {
    await live.run(`drop table if exists ${table};\ndrop type if exists t467_mood`);
  });

  const target = async () => {
    const catalog = createCatalog(execute, () => false);
    const columns = await catalog.columns(live.conn, "public", table);
    const types = await readTypes(execute, live.conn, "public", table);
    const set = (await live.run(select)).result.statements[0]?.sets[0];
    if (!set) throw new Error("no rows");
    const made = targetOf("postgresql", { schema: "public", name: table }, set.columns, columns);
    if (!made.target) throw new Error(made.reason);
    return { set, target: attachEditors(made.target, columns, types) };
  };

  it("reads each column's editor from the catalog", async () => {
    const { target: t } = await target();
    const kinds = Object.fromEntries(t.columns.map((c) => [c.name, c.editor?.kind]));
    expect(kinds).toEqual({
      id: "number",
      flag: "boolean",
      mood: "enum",
      day: "date",
      at_time: "time",
      at: "timestamp",
      span: "interval",
      j: "json",
      jb: "json",
      ints: "array",
      tags: "array",
      bytes: "bytes",
      n: "number",
      u: "uuid",
      total: "number",
      twice: "number",
      num: "number",
    });
    const mood = t.columns.find((c) => c.name === "mood")?.editor;
    expect(mood).toMatchObject({
      labels: ["sad", "ok", "so so"],
      nullable: false,
      hasDefault: true,
    });
    expect(t.columns.find((c) => c.name === "twice")?.editor?.fixed).toMatch(/generated/u);
    expect(t.columns.find((c) => c.name === "num")?.editor?.fixed).toMatch(/GENERATED ALWAYS/u);
    expect(t.columns.find((c) => c.name === "at")?.editor?.timeZone).toBeTruthy();
  });

  it("edits every type, submits in one transaction and reads it back equal", async () => {
    const { set, target: t } = await target();
    const typed: Record<string, string> = {
      flag: "no",
      mood: "so so",
      day: "2026-11-21",
      at_time: "10:20:30.5",
      at: "2026-11-21 10:00:00+09",
      span: "1 day 02:00:00",
      j: '{"a": [1, 2.0, 12345678901234567890], "b": "it\'s"}',
      jb: '{"z": 1, "a": {"b": null}}',
      ints: "{1, 2,3}",
      tags: '{plain,"with space","q\\"uote",NULL,"NULL"}',
      bytes: "\\x00FF7f",
      u: "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11",
      total: "1234.5",
    };
    const changes = emptyChanges();
    const col = (name: string) => set.columns.indexOf(name);
    for (const [name, text] of Object.entries(typed)) {
      const editor = t.columns[col(name)]?.editor;
      if (!editor) throw new Error(`no editor for ${name}`);
      const checked = checkValue(editor, text);
      if ("error" in checked) throw new Error(`${name}: ${checked.error}`);
      editCell(changes, t, set, 0, col(name), checked.value);
    }
    editCell(changes, t, set, 0, col("n"), DEFAULT);
    editCell(changes, t, set, 1, col("flag"), null);
    const done = await submitChanges({ execute, conn: live.conn, target: t, set, changes });
    expect(done.message).toBe("Committed 2 changes in one transaction.");
    const back = (await live.run(select)).result.statements[0]?.sets[0];
    const row = Object.fromEntries((back?.columns ?? []).map((c, i) => [c, back?.rows[0]?.[i]]));
    const zone = (await live.run("select '2026-11-21 10:00:00+09'::timestamptz::text")).result
      .statements[0]?.sets[0]?.rows[0]?.[0];
    expect(row).toMatchObject({
      flag: "f",
      mood: "so so",
      day: "2026-11-21",
      at_time: "10:20:30.5",
      at: zone,
      span: "1 day 02:00:00",
      j: typed.j,
      jb: '{"a": {"b": null}, "z": 1}',
      ints: "{1,2,3}",
      tags: '{plain,"with space","q\\"uote",NULL,"NULL"}',
      bytes: "\\x00ff7f",
      u: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      total: "1234.50",
      n: "42",
    });
    expect(back?.rows[1]?.[col("flag")]).toBeNull();
    expect(back?.rows[1]?.[col("n")]).toBe("7");
  });

  it("refuses a fixed column in the cell and names a refused value's cell", async () => {
    const { set, target: t } = await target();
    const col = (name: string) => set.columns.indexOf(name);
    expect(() => editCell(emptyChanges(), t, set, 0, col("twice"), "3")).toThrow(/generated/u);
    const changes = emptyChanges();
    editCell(changes, t, set, 1, col("day"), "2026-01-01");
    // Past the editor's check, as text the server alone can refuse.
    editCell(changes, t, set, 1, col("mood"), "nope");
    const done = await submitChanges({ execute, conn: live.conn, target: t, set, changes });
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(
      /^Rolled back, nothing was changed: row 2 \(update\), column mood: invalid input value for enum t467_mood: "nope"/u,
    );
    const back = (await live.run(`select day from ${table} where id = 2`)).result.statements[0];
    expect(back?.sets[0]?.rows).toEqual([[null]]);
  });
});
