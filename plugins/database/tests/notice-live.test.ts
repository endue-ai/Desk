// Notices with the statements that raised them against a real PostgreSQL (#541, ADR 0334), when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database: RAISE NOTICE in the last statement of
// a script is on that statement and no other; a deferred trigger's notice at the plugin's COMMIT is
// the run's; a function run from the routine form shows its RAISE NOTICE. In a schema of its own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const S = "endue_notice_live";
const live = liveSessions(uri, "notice");

function executor() {
  const { fields, password } = parseUri(uri);
  const conn = normalize({ ...fields, id: "c-notice-live", name: "notice live" });
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({ "endue.database.max-rows": 1000 });
  const run = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    sessions: createSessions(bridge),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  return (sql: string, mode?: string) => run.execute(conn, sql, mode ? { mode } : {});
}

const SET_UP = [
  `DROP SCHEMA IF EXISTS ${S} CASCADE`,
  `CREATE SCHEMA ${S}`,
  `CREATE TABLE ${S}.stock (item text PRIMARY KEY, qty int NOT NULL)`,
  `CREATE FUNCTION ${S}.counted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE 'counted % at commit', NEW.item; RETURN NULL; END $$`,
  `CREATE CONSTRAINT TRIGGER counted AFTER INSERT ON ${S}.stock DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ${S}.counted()`,
  `CREATE FUNCTION ${S}.restock(item text) RETURNS int VOLATILE LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE 'restocking %', item; RETURN 5; END $$`,
];

beforeAll(async () => {
  if (!uri) return;
  await live.end();
  for (const sql of SET_UP) await live.admin(sql);
}, 60_000);

afterAll(async () => {
  if (!uri) return;
  await live.end();
  await live.admin(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
});

const said = (notices: string[] | undefined) => (notices ?? []).join("\n");

describe.skipIf(!uri)("notices with their statements on a real PostgreSQL", () => {
  it("RAISE NOTICE in a script's last statement is on that statement, each time", async () => {
    const run = executor();
    for (let i = 0; i < 20; i++) {
      const done = await run(
        `SELECT ${i};\nDO $$ BEGIN RAISE NOTICE 'last of run %', ${i}; END $$`,
      );
      const [first, last] = done.result.statements;
      expect(said(first?.notices)).toBe("");
      expect(said(last?.notices)).toBe(`NOTICE:  last of run ${i}`);
      expect(said(done.result.notices)).not.toMatch(/last of run/u);
    }
  });

  it("a deferred trigger's notice at the plugin's COMMIT is the run's, not a statement's", async () => {
    const run = executor();
    const done = await run(`INSERT INTO ${S}.stock VALUES ('bolt', 1);\nSELECT 1`, "transaction");
    expect(done.result.statements.map((s) => s.error)).toEqual([undefined, undefined]);
    expect(done.result.statements.flatMap((s) => s.notices)).toEqual([]);
    expect(said(done.result.notices)).toContain("counted bolt at commit");
  });

  it("a function run from the routine form shows its RAISE NOTICE", async () => {
    const { fields, password } = parseUri(uri);
    const procs = realProcs(password ? { password } : {});
    const store = { connections: [normalize({ ...fields, id: "c-live", name: "live" })] };
    const m = await mount({ store, handlers: procs.handlers, pick: () => "yes" });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.routine", {
      connection: "live",
      schema: S,
      name: "restock",
      arguments: { item: "nut" },
    });
    const ran = (await m.host.command("endue.database.routine-run")) as { notices: string[] };
    expect(said(ran.notices)).toContain("restocking nut");
  });
});
