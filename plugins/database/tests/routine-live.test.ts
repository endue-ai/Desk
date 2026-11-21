// The routine forms against a real PostgreSQL, through the plugin's commands on the core's sessions.
// It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database it may write in, for
// example postgresql://postgres:pw@db/scratch. In a schema of its own: a function with named
// arguments and a default, an overloaded one, one returning a table, a VARIADIC one, a procedure
// with INOUT and OUT that raises a notice, a VOLATILE function run rolled back (its write gone
// after) and run for real, a procedure that commits, and a read-only connection that refuses a
// VOLATILE function and runs an IMMUTABLE one.
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const SCHEMA = "endue_routine_live";
// Other runs use the same server at once, each in a database of its own: only this database's
// sessions are looked up and ended.
const live = liveSessions(uri, "routine");
/** One statement as the URI's role, on a session of its own; its first value, as text. */
const admin = async (sql: string) => String(await live.admin(sql));
const S = SCHEMA;

/** The schema and its routines, a statement each (each one's own session: names are qualified). */
const SET_UP = [
  `DROP SCHEMA IF EXISTS ${S} CASCADE`,
  `CREATE SCHEMA ${S}`,
  `CREATE TABLE ${S}.archived (id serial PRIMARY KEY, before date NOT NULL, note text)`,
  `CREATE FUNCTION ${S}.add_tax(amount numeric, rate numeric DEFAULT 0.2) RETURNS numeric
  IMMUTABLE LANGUAGE sql AS 'SELECT round(amount * (1 + rate), 2)'`,
  `CREATE FUNCTION ${S}.area(r numeric) RETURNS numeric IMMUTABLE LANGUAGE sql AS 'SELECT round(3.14159 * r * r, 2)'`,
  `CREATE FUNCTION ${S}.area(w numeric, h numeric) RETURNS numeric IMMUTABLE LANGUAGE sql AS 'SELECT w * h'`,
  `CREATE FUNCTION ${S}.squares(upto integer, step integer DEFAULT 1) RETURNS TABLE(n integer, square integer)
  STABLE LANGUAGE sql AS 'SELECT g, g * g FROM generate_series(1, upto, step) g'`,
  `CREATE FUNCTION ${S}.total_of(VARIADIC amounts integer[]) RETURNS integer
  IMMUTABLE LANGUAGE sql AS 'SELECT coalesce(sum(a), 0)::integer FROM unnest(amounts) a'`,
  `CREATE PROCEDURE ${S}.restock(item text, OUT note text, INOUT qty integer DEFAULT 1) LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'restocking %', item;
  qty := qty + 5;
  note := 'restocked ' || item;
END $$`,
  `CREATE FUNCTION ${S}.archive_before(before date) RETURNS integer VOLATILE LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ${S}.archived (before) VALUES (before);
  RAISE NOTICE 'archived before %', before;
  RETURN (SELECT count(*) FROM ${S}.archived);
END $$`,
  `CREATE PROCEDURE ${S}.close_day() LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ${S}.archived (before, note) VALUES (current_date, 'closed');
  COMMIT;
END $$`,
];
async function setUp() {
  await live.end();
  for (const sql of SET_UP) await admin(sql);
}

type Ran = {
  statement: string;
  status: string;
  error?: string;
  columns?: string[];
  rows?: string[][];
  notices: string[];
  rolledBack: boolean;
};

/** The plugin with two connections to the scratch database: `live`, and `live-ro`, read-only. */
async function plugin() {
  const { fields, password } = parseUri(uri);
  const conn = (id: string, name: string, more: Partial<Connection> = {}) =>
    normalize({ ...fields, id, name, ...more });
  // The password reaches the core's session as the person's typed one would, never the store.
  const procs = realProcs(password ? { password } : {});
  const store = {
    connections: [conn("c-live", "live"), conn("c-live-ro", "live-ro", { readOnly: true })],
  };
  const m = await mount({ store, handlers: procs.handlers, pick: () => "yes" });
  procs.attach((event) => m.host.emit(event));
  /** Open a routine's form with the given arguments, then run it as the person would. */
  const call = async (name: string, args: Record<string, unknown> = {}, connection = "live") => {
    const shown = (await m.host.command("endue.database.routine", {
      connection,
      schema: SCHEMA,
      name,
      ...args,
    })) as { statement: string };
    const ran = (await m.host.command("endue.database.routine-run")) as Ran;
    expect(ran.statement).toBe(shown.statement);
    return ran;
  };
  return { m, call };
}

afterAll(async () => {
  if (!uri) return;
  await live.end();
  await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
});

describe.skipIf(!uri)("routine forms on a real PostgreSQL", () => {
  it("calls functions by name with defaults, an overload by its signature, a table, VARIADIC and a procedure's INOUT and OUT", async () => {
    await setUp();
    const { m, call } = await plugin();
    const s = SCHEMA;
    // Named, the default left out, then given.
    await expect(call("add_tax", { arguments: { amount: 100 } })).resolves.toMatchObject({
      statement: `SELECT ${s}.add_tax(amount => 100::numeric)`,
      status: "done",
      columns: ["add_tax"],
      rows: [["120.00"]],
    });
    await expect(
      call("add_tax", { arguments: { amount: "19.99", rate: "0.075" } }),
    ).resolves.toMatchObject({
      statement: `SELECT ${s}.add_tax(amount => 19.99::numeric, rate => 0.075::numeric)`,
      rows: [["21.49"]],
    });
    await expect(call("add_tax", { arguments: { amount: "-5" } })).resolves.toMatchObject({
      statement: `SELECT ${s}.add_tax(amount => '-5'::numeric)`,
      rows: [["-6.00"]],
    });
    // Overloaded: refused without a signature when run, then each by its own.
    await expect(
      m.host.command("endue.database.routine", {
        connection: "live",
        schema: s,
        name: "area",
        run: true,
      }),
    ).rejects.toThrow(`${s}.area has 2 signatures`);
    await expect(call("area", { signature: "r numeric", arguments: [2] })).resolves.toMatchObject({
      statement: `SELECT ${s}.area(r => 2::numeric)`,
      rows: [["12.57"]],
    });
    await expect(
      call("area", { signature: "w numeric, h numeric", arguments: { w: 3, h: 4 } }),
    ).resolves.toMatchObject({
      statement: `SELECT ${s}.area(w => 3::numeric, h => 4::numeric)`,
      rows: [["12"]],
    });
    // A table: SELECT * FROM, its columns.
    await expect(call("squares", { arguments: { upto: 7, step: 3 } })).resolves.toMatchObject({
      statement: `SELECT * FROM ${s}.squares(upto => 7::integer, step => 3::integer)`,
      columns: ["n", "square"],
      rows: [
        ["1", "1"],
        ["4", "16"],
        ["7", "49"],
      ],
    });
    // VARIADIC: the array of its elements, and an empty one.
    await expect(call("total_of", { arguments: { amounts: [4, 5, 6] } })).resolves.toMatchObject({
      statement: `SELECT ${s}.total_of(VARIADIC amounts => '{4,5,6}'::integer[])`,
      rows: [["15"]],
    });
    await expect(call("total_of", { arguments: { amounts: [] } })).resolves.toMatchObject({
      rows: [["0"]],
    });
    // A procedure: OUT passed as NULL, INOUT and OUT back as the result's columns, its notice.
    const restocked = await call("restock", { arguments: { item: "bolt's", qty: 2 } });
    expect(restocked).toMatchObject({
      statement: `CALL ${s}.restock(item => 'bolt''s'::text, note => NULL::text, qty => 2::integer)`,
      status: "done",
      columns: ["note", "qty"],
      rows: [["restocked bolt's", "7"]],
    });
    expect(restocked.notices.join("\n")).toContain("restocking bolt's");
    await expect(call("restock", { arguments: { item: "nut" } })).resolves.toMatchObject({
      statement: `CALL ${s}.restock(item => 'nut'::text, note => NULL::text)`,
      rows: [["restocked nut", "6"]],
    });
  });

  it("runs a VOLATILE function rolled back, its write gone after, then for real, and a procedure that commits alone", async () => {
    await setUp();
    const { m, call } = await plugin();
    const count = () => admin(`SELECT count(*) FROM ${SCHEMA}.archived`);
    const rolled = await call("archive_before", {
      arguments: { before: "2026-01-01" },
      rollback: true,
    });
    expect(rolled).toMatchObject({
      statement: `SELECT ${SCHEMA}.archive_before(before => '2026-01-01'::date)`,
      status: "done",
      rows: [["1"]],
      rolledBack: true,
    });
    expect(rolled.notices.join("\n")).toContain("archived before 2026-01-01");
    expect(await count()).toBe("0");
    await expect(
      call("archive_before", { arguments: { before: "2026-01-01" }, rollback: false }),
    ).resolves.toMatchObject({
      status: "done",
      rows: [["1"]],
      rolledBack: false,
    });
    expect(await count()).toBe("1");

    // A procedure that commits: no rollback offered, and it runs outside a transaction block.
    const shown = (await m.host.command("endue.database.routine", {
      connection: "live",
      schema: SCHEMA,
      name: "close_day",
      rollback: true,
    })) as { runs: string; rollback: boolean };
    expect(shown.rollback).toBe(false);
    expect(shown.runs).toMatch(/outside a transaction block, and cannot be rolled back\.$/u);
    await expect(m.host.command("endue.database.routine-run")).resolves.toMatchObject({
      statement: `CALL ${SCHEMA}.close_day()`,
      status: "done",
    });
    expect(await count()).toBe("2");
  });

  it("a read-only connection refuses a VOLATILE function and a procedure, and runs an IMMUTABLE one", async () => {
    await setUp();
    const { m, call } = await plugin();
    await m.host.command("endue.database.routine", {
      connection: "live-ro",
      schema: SCHEMA,
      name: "archive_before",
      arguments: { before: "2026-01-01" },
      rollback: true,
    });
    await expect(m.host.command("endue.database.routine-run")).rejects.toThrow(
      `live-ro is read-only: ${SCHEMA}.archive_before is VOLATILE, so it may change data; it does not run there, not even rolled back.`,
    );
    await m.host.command("endue.database.routine", {
      connection: "live-ro",
      schema: SCHEMA,
      name: "restock",
      arguments: { item: "x" },
    });
    await expect(m.host.command("endue.database.routine-run")).rejects.toThrow(
      `live-ro is read-only: ${SCHEMA}.restock is a procedure`,
    );
    expect(await admin(`SELECT count(*) FROM ${SCHEMA}.archived`)).toBe("0");
    await expect(call("add_tax", { arguments: { amount: 10 } }, "live-ro")).resolves.toMatchObject({
      status: "done",
      rows: [["12.00"]],
    });
  });
});
