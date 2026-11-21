// PostgreSQL on the desk core's sessions against a real server (PG-01c, ADR 0281): what the psql path
// could not say and the sessions do (the columns' type OIDs, the SQLSTATE and position), the session
// read-only on the server as well as in the plugin's guard, and the password file the core reads.
// It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database, as live.test.ts does; the
// statements go through crates/desk-core/examples/db-bridge.rs (core-bridge.ts).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { coreBridge, sharedCore } from "./core-bridge";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const homes: string[] = [];
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** The plugin's executor on a core's sessions; the core already holds db:connect on `*`. */
function onCore(core: { call(method: string, params: unknown): Promise<never>; onEvent: never }) {
  const bridge = { call: core.call, onEvent: core.onEvent } as never;
  const settings = fromValues({ "endue.database.max-rows": 100_000 });
  const sessions = createSessions(bridge);
  let typed: string | undefined;
  const executor = createExecutor({
    runner: { run: async () => Promise.reject(new Error("no client runs for PostgreSQL")) },
    output: { read: async () => Promise.reject(new Error("nothing to read")) },
    clients: { get: async () => Promise.reject(new Error("no client")) },
    sessions,
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => typed, set: () => {}, ask: async () => undefined },
    cancelled: (message: string) => new Error(message),
  } as never);
  return {
    sessions,
    run: (target: Connection, sql: string, secret?: string) => {
      typed = secret;
      return executor.execute(target, sql);
    },
  };
}

const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const conn = (more: Partial<Connection> = {}) =>
  ({ ...normalize({ ...fields, id: "c-live", name: "live" }), ...more }) as Connection;

describe.skipIf(!uri)("PostgreSQL sessions of the desk core, on a real server", () => {
  it("a result carries its columns' type OIDs and the server's text, NULL apart", async () => {
    const { run } = onCore(sharedCore() as never);
    const done = await run(
      conn(),
      "select 1::int4 as a, 'x'::text as b, null::text as c, ''::text as d, 2.50::numeric as e, true as f",
      password,
    );
    const set = done.result.statements[0]?.sets[0];
    expect(set?.types).toEqual([23, 25, 25, 25, 1700, 16]);
    expect(set?.rows).toEqual([["1", "x", null, "", "2.50", "t"]]);
  });

  it("an error has its SQLSTATE and its position in the statement", async () => {
    const { run } = onCore(sharedCore() as never);
    const sql = "select '😀' as a,\n  nope";
    const done = await run(conn(), sql, password);
    expect(done.result.statements[0]?.error).toMatchObject({
      kind: "sql",
      code: "42703",
      position: sql.indexOf("nope"),
    });
  });

  it("a read-only connection's session refuses what the plugin's guard lets through", async () => {
    const { run } = onCore(sharedCore() as never);
    await run(conn(), "create sequence if not exists endue_seq", password);
    const done = await run(conn({ readOnly: true }), "select nextval('endue_seq')", password);
    expect(done.result.statements[0]?.error).toMatchObject({ kind: "sql", code: "25006" });
  });

  it("signs in from the password file in the core's home when no password is typed", async () => {
    const home = mkdtempSync(join(tmpdir(), "endue-db-pgpass-"));
    homes.push(home);
    const c = conn();
    const line = [c.host || "localhost", c.port ?? 5432, c.database, c.user, password ?? ""];
    writeFileSync(join(home, ".pgpass"), `${line.join(":")}\n`, { mode: 0o600 });
    const core = coreBridge(home);
    try {
      const { run } = onCore(core as never);
      const done = await run(c, "select current_user");
      expect(done.result.error).toBeUndefined();
      expect(done.result.statements[0]?.sets[0]?.rows).toEqual([[c.user]]);
    } finally {
      core.close();
    }
  });
});
