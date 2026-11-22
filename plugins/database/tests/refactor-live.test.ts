// An object's rename against a real PostgreSQL (PG-33), when ENDUE_DB_TEST_POSTGRES holds the URI of
// a scratch database, on the desk core's sessions (no psql): a column used by a view, a PL/pgSQL
// function, a SQL function with a quoted body, a trigger function and a policy is renamed by running
// the script the rename writes, and every dependent still works under the new name; the dynamic
// SQL it could not prove is listed to check by hand (and breaks, as listed). A table and a function
// rename the same way.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import type { Aim } from "../ui/navigate/target.js";
import { factsOf, partsOf, renameOf } from "../ui/refactor/object.js";
import { renameReadSql } from "../ui/refactor/read-sql.js";
import { renameScript } from "../ui/refactor/script.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
const S = "t463_live";

describe.skipIf(!pgUri)("an object's rename on a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgres://");
  const conn = normalize({ ...fields, id: "c-live-463", name: "live" });
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
    return done.result.statements.map((s) => s.sets[0]?.rows ?? []);
  };
  const value = async (sql: string) =>
    (await run(`SET search_path TO ${S};\n${sql}`)).at(-1)?.[0]?.[0];

  /** The script the rename writes, read from the server as the feature reads it. */
  const scriptOf = async (aim: Aim, to: string) => {
    const done = await executor.execute(conn, renameReadSql(aim), { catalog: true, maxRows: 600 });
    const [factRows = [], bodies = [], catalog = []] = done.result.statements.map(
      (s) => s.sets[0]?.rows ?? [],
    );
    const facts = factsOf(factRows);
    if (!facts) throw new Error("no facts");
    const r = renameOf(aim, facts, to);
    const parts = partsOf(r, facts, bodies, catalog);
    return { script: renameScript(r, parts), parts };
  };

  beforeAll(async () => {
    await run(`SET lock_timeout = '10s'; DROP SCHEMA IF EXISTS ${S} CASCADE`);
    await run(
      `CREATE SCHEMA ${S};\nSET search_path TO ${S};\n` +
        "CREATE TABLE people (id int PRIMARY KEY, name text, owner text);\n" +
        "INSERT INTO people VALUES (1, 'ada', 'a'), (2, 'bob', 'b');\n" +
        "CREATE VIEW named AS SELECT id, name FROM people;\n" +
        "CREATE FUNCTION shout() RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN UPDATE people SET name = upper(name); RETURN (SELECT count(*) FROM people WHERE name IS NOT NULL); END $$;\n" +
        "CREATE FUNCTION names() RETURNS SETOF text LANGUAGE sql AS $$ SELECT p.name FROM people p ORDER BY p.id $$;\n" +
        "CREATE FUNCTION trim_name() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.name := trim(NEW.name); RETURN NEW; END $$;\n" +
        "CREATE TRIGGER people_trim BEFORE INSERT OR UPDATE ON people FOR EACH ROW EXECUTE FUNCTION trim_name();\n" +
        "CREATE POLICY named_rows ON people USING (name IS NOT NULL);\n" +
        `CREATE FUNCTION dyn() RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE n bigint; BEGIN EXECUTE 'select count(name) from ${S}.people' INTO n; RETURN n; END $$;\n` +
        "CREATE FUNCTION bump(x int) RETURNS int LANGUAGE sql AS $$ SELECT x + 1 $$;\n" +
        "CREATE FUNCTION use_bump() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN bump(1); END $$",
    );
  }, 60_000);
  afterAll(async () => {
    await run(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  }, 60_000);

  it("a column: the script keeps the view, the bodies, the trigger and the policy working", async () => {
    const { script, parts } = await scriptOf(
      { kind: "column", schema: S, table: "people", name: "name" },
      "full_name",
    );
    expect(parts.replaced.map((p) => p.label)).toEqual([
      `function ${S}.names(): 1 place`,
      `function ${S}.shout(): 3 places`,
      `function ${S}.trim_name(): 2 places`,
    ]);
    expect(parts.kept.map((u) => `${u.kind} ${u.name}`)).toEqual([
      "policy named_rows",
      "view named",
    ]);
    expect(parts.checks).toEqual([
      { label: `function ${S}.dyn()`, line: 1, why: "the name is in a string (dynamic SQL?)" },
    ]);
    // Nothing has run yet.
    expect(
      await value(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'name' AND table_name = 'people'",
      ),
    ).toBe("1");
    await run(script);
    expect(await value("SELECT string_agg(full_name, ',' ORDER BY id) FROM people")).toBe(
      "ada,bob",
    );
    expect(await value("SELECT string_agg(name, ',' ORDER BY id) FROM named")).toBe("ada,bob");
    expect(await value("SELECT shout()")).toBe("2");
    expect(await value("SELECT string_agg(n, ',') FROM names() n")).toBe("ADA,BOB");
    await run(
      `SET search_path TO ${S};\nINSERT INTO people (id, full_name, owner) VALUES (3, '  cy  ', 'c')`,
    );
    expect(await value("SELECT full_name FROM people WHERE id = 3")).toBe("cy");
    expect(
      await value(
        "SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'named_rows'",
      ),
    ).toBe("(full_name IS NOT NULL)");
    // What was listed to check by hand breaks, as it said.
    await expect(value("SELECT dyn()")).rejects.toThrow(/name/u);
  }, 60_000);

  it("a table and a function rename the same way", async () => {
    const table = await scriptOf(
      { kind: "relation", schema: S, name: "people", relkind: "table" },
      "buyers",
    );
    expect(table.parts.replaced.map((p) => p.label)).toEqual([
      `function ${S}.names(): 1 place`,
      `function ${S}.shout(): 2 places`,
    ]);
    await run(table.script);
    expect(await value("SELECT shout()")).toBe("3");
    expect(await value("SELECT count(*) FROM names()")).toBe("3");
    expect(await value("SELECT count(*) FROM named")).toBe("3");
    const fn = await scriptOf({ kind: "function", schema: S, name: "bump" }, "plus_one");
    expect(fn.parts.replaced.map((p) => p.label)).toEqual([`function ${S}.use_bump(): 1 place`]);
    await run(fn.script);
    expect(await value("SELECT use_bump()")).toBe("2");
    expect(await value("SELECT plus_one(2)")).toBe("3");
  }, 60_000);
});
