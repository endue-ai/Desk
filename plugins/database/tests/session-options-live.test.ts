// A connection's session options on a real server (PG-12), through the desk core's sessions
// (core-bridge.ts): the server reports the search path, the role, the time zone, the timeouts, the
// application name and what the startup script set in a console's session, a table view's, an
// agent's short run and the console's session opened again after pg_terminate_backend; a name
// without a schema resolves on the path; a startup script that fails is said with the server's
// message. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database (live.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { type Mounted, mount } from "./harness";
import { databaseOf, liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { messages, run, state } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const PREFIX = "endue session-options";
const server = liveSessions(uri, PREFIX);
const ROLE = `t449_${databaseOf(uri)}_reader`.slice(0, 63);
const READ =
  "current_setting('search_path') AS path, current_setting('TimeZone') AS zone, " +
  "current_setting('lock_timeout') AS lock, " +
  "current_setting('idle_in_transaction_session_timeout') AS idle, " +
  "current_setting('application_name') AS app, current_user::text AS who, " +
  "current_setting('work_mem') AS mem";
const SET = (uri
  ? normalize({
      ...fields,
      id: "c-live-options",
      name: "live",
      searchPath: "so_app, public",
      role: ROLE,
      timeZone: "Asia/Seoul",
      lockTimeout: "4s",
      idleTimeout: "90s",
      applicationName: `${PREFIX} live`,
      startup: "set work_mem = '7MB'",
    } as Partial<Connection>)
  : {}) as Connection;
const BROKEN = (uri
  ? normalize({
      ...fields,
      id: "c-live-broken",
      name: "broken",
      applicationName: `${PREFIX} broken`,
      startup: "set work_mem = '7MB';\nselect * from so_missing_table",
    } as Partial<Connection>)
  : {}) as Connection;
const EXPECTED = ["so_app, public", "Asia/Seoul", "4s", "90s", `${PREFIX} live`, ROLE, "7MB"];

async function live(): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const m = await mount({ store: { connections: [SET, BROKEN] }, handlers: procs.handlers });
  procs.attach((event) => m.host.emit(event));
  return m;
}

/** The first row of the result on screen. */
const firstRow = (m: Mounted) =>
  m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0];

const until = async (test: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe.skipIf(!uri)("a connection's session options on a real server", () => {
  beforeAll(async () => {
    await server.end();
    await server.admin("DROP SCHEMA IF EXISTS so_app CASCADE");
    await server.admin(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE "${ROLE}" NOLOGIN; END IF; END $$`,
    );
    await server.admin(`GRANT "${ROLE}" TO current_user`);
    await server.admin("CREATE SCHEMA so_app");
    await server.admin(`GRANT USAGE ON SCHEMA so_app TO "${ROLE}"`);
    await server.admin("CREATE TABLE so_app.so_items AS SELECT 42 AS id");
    await server.admin(`CREATE VIEW so_app.so_probe AS SELECT ${READ}`);
    await server.admin(`GRANT SELECT ON so_app.so_items, so_app.so_probe TO "${ROLE}"`);
  });
  afterAll(async () => {
    await server.end();
    await server.admin("DROP SCHEMA IF EXISTS so_app CASCADE");
    await server.admin(`DROP ROLE IF EXISTS "${ROLE}"`);
  });

  it("a console's session, a table view's, a short run and the session after a loss", async () => {
    const m = await live();
    await m.host.command("endue.database.console", { connection: "live" });
    await run(m, `select ${READ}`);
    expect(firstRow(m)).toEqual(EXPECTED);
    // A name without a schema is found on the connection's path.
    await run(m, "select id from so_items");
    expect(firstRow(m)).toEqual(["42"]);

    // The table view's own session reads the view that reports its settings.
    await m.host.command("endue.database.open-table", {
      connection: "live",
      schema: "so_app",
      table: "so_probe",
    });
    await m.settle();
    expect(firstRow(m)).toEqual(EXPECTED);

    // An agent's run opens a short session of its own.
    const answer = (await m.host.invoke("endue.database.query", {
      connection: "live",
      sql: `select ${READ}`,
    })) as { statements: { results?: { rows: string[][] }[] }[] };
    expect(answer.statements[0]?.results?.[0]?.rows[0]).toEqual(EXPECTED);

    // The console's session ends on the server: the next run signs in again with the same options.
    await m.host.command("endue.database.consoles", { console: "live" });
    await m.settle();
    const pid = m.shown()?.session?.pid;
    expect(pid).toBeGreaterThan(0);
    await server.admin(`select pg_terminate_backend(${pid})`);
    await until(() => state(m) === "lost");
    await run(m, `select ${READ}`);
    expect(firstRow(m)).toEqual(EXPECTED);
    expect(m.shown()?.session?.pid).not.toBe(pid);
    await m.host.command("endue.database.disconnect", { connection: "live" });
  });

  it("a startup script that fails is said with the server's message", async () => {
    const m = await live();
    await m.host.command("endue.database.console", { connection: "broken" });
    await run(m, "select 1");
    expect(messages(m).join("\n")).toMatch(
      /broken's startup script, statement 2: relation "so_missing_table" does not exist/u,
    );
    expect(firstRow(m)).toBeUndefined();
    await m.host.command("endue.database.disconnect", { connection: "broken" });
  });
});
