// A connection's password command and the pooler choice on a real server (PG-14, ADR 0354), through
// the desk core's sessions (core-bridge.ts) and real programs (node-bridge.ts): a role of the test's
// own whose password only a small program knows; that program, run without a shell, signs in a
// console's session and again an agent's short one; one that prints a stale password first is run
// once more and signs in; one that fails is said with its standard error's first line; and a
// connection marked "through a pooler" runs reads, a transaction and SET LOCAL on its kept session
// without any session state, refusing SET in words. It runs when ENDUE_DB_TEST_POSTGRES holds a
// URI of a scratch database (live.test.ts). No pooler runs here: ENDUE_DB_TEST_POOLER, a URI of one
// in transaction mode in front of the same database, adds the same runs through it.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quoted } from "../ui/auth/command.js";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { type Mounted, mount } from "./harness";
import { databaseOf, liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { messages, run } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const pooler = process.env.ENDUE_DB_TEST_POOLER ?? "";
const PREFIX = "endue password-command";
const server = liveSessions(uri, PREFIX);
const ROLE = `t451_${databaseOf(uri)}_tok`.slice(0, 63);
const SECRET = randomBytes(18).toString("base64url");
const folder = mkdtempSync(join(tmpdir(), "t451-helper-"));
const program = join(folder, "token.mjs");
// The program: prints the secret file's line; `stale` prints a wrong one at its first run (a count
// file says which run it is); `fail` says why on standard error and exits 4.
const SOURCE = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [mode, dir] = process.argv.slice(2);
const count = dir + "/runs";
const runs = existsSync(count) ? Number(readFileSync(count, "utf8")) + 1 : 1;
writeFileSync(count, String(runs));
if (mode === "fail") { process.stderr.write("token service: sign in first\\nmore\\n"); process.exit(4); }
if (mode === "stale" && runs === 1) { process.stdout.write("stale-token\\n"); process.exit(0); }
process.stdout.write(readFileSync(dir + "/secret", "utf8") + "\\n");
`;
const runsOf = () => Number(readFileSync(join(folder, "runs"), "utf8"));
const command = (mode: string) => [process.execPath, program, mode, folder].map(quoted).join(" ");

const connOf = (id: string, name: string, mode: string) => {
  const { fields } = uri ? parseUri(uri) : { fields: {} };
  return normalize({
    ...fields,
    id,
    name,
    user: ROLE,
    applicationName: `${PREFIX} ${name}`,
    passwordCommand: command(mode),
  } as Partial<Connection>);
};

async function live(conns: Connection[], password?: string): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const m = await mount({
    store: { connections: conns },
    handlers: procs.handlers,
    pick: () => "yes",
  });
  procs.attach((event) => m.host.emit(event));
  return m;
}

const firstRow = (m: Mounted) =>
  m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0];

describe.skipIf(!uri)("a password command and the pooler choice on a real server", () => {
  beforeAll(async () => {
    writeFileSync(program, SOURCE);
    writeFileSync(join(folder, "secret"), SECRET, { mode: 0o600 });
    await server.end();
    await server.admin(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE "${ROLE}" LOGIN; END IF; END $$`,
    );
    await server.admin(`ALTER ROLE "${ROLE}" LOGIN PASSWORD '${SECRET}'`);
  });
  afterAll(async () => {
    await server.end(`usename = '${ROLE}'`);
    await server.admin(`DROP ROLE IF EXISTS "${ROLE}"`);
    rmSync(folder, { recursive: true, force: true });
  });

  it("signs a console's session in with the program's password, and runs it again for the next", async () => {
    rmSync(join(folder, "runs"), { force: true });
    const m = await live([connOf("c-live-good", "good", "good")]);
    await m.host.command("endue.database.console", { connection: "good" });
    await run(m, "select current_user::text");
    expect(firstRow(m)).toEqual([ROLE]);
    const first = runsOf();
    expect(first).toBeGreaterThanOrEqual(1);
    // An agent's run is a short session of its own: the program runs again.
    const answer = (await m.host.invoke("endue.database.query", {
      connection: "good",
      sql: "select current_user::text",
    })) as { statements: { results?: { rows: string[][] }[] }[] };
    expect(answer.statements[0]?.results?.[0]?.rows[0]).toEqual([ROLE]);
    expect(runsOf()).toBe(first + 1);
    expect(JSON.stringify([m.store, m.view.said])).not.toContain(SECRET);
    await m.host.command("endue.database.disconnect", { connection: "good" });
  });

  it("runs a program that printed a stale password once more, and signs in", async () => {
    rmSync(join(folder, "runs"), { force: true });
    const m = await live([connOf("c-live-stale", "stale", "stale")]);
    await m.host.command("endue.database.console", { connection: "stale" });
    await run(m, "select current_user::text");
    expect(firstRow(m)).toEqual([ROLE]);
    expect(runsOf()).toBe(2);
    await m.host.command("endue.database.disconnect", { connection: "stale" });
  });

  it("says a failing program's standard error, and signs nothing in", async () => {
    rmSync(join(folder, "runs"), { force: true });
    const m = await live([connOf("c-live-fail", "fail", "fail")]);
    await m.host.command("endue.database.console", { connection: "fail" });
    await run(m, "select 1");
    expect(messages(m).join("\n")).toContain(
      "fail's password command exited with 4: token service: sign in first",
    );
    expect(firstRow(m)).toBeUndefined();
  });

  for (const [label, at] of [
    ["the server itself", uri],
    ["a pooler in transaction mode", pooler],
  ] as const)
    it.skipIf(!at)(
      `a connection through a pooler works without session state (${label})`,
      async () => {
        // The URI's own role and password: a pooler knows the roles it was set up with.
        const { fields, password } = parseUri(at);
        const pool = { ...fields, applicationName: `${PREFIX} pool` };
        const conns = [
          normalize({
            ...pool,
            id: "c-live-pool",
            name: "pool",
            pooler: true,
          } as Partial<Connection>),
          normalize({ ...pool, id: "c-live-plain", name: "plain" } as Partial<Connection>),
        ];
        const m = await live(conns, password);
        await m.host.command("endue.database.console", { connection: "pool" });
        await run(
          m,
          "select current_setting('application_name'), current_setting('statement_timeout')",
        );
        // The statement timeout is no startup parameter: the server's own stays.
        expect(firstRow(m)).toEqual([`${PREFIX} pool`, "0"]);
        await run(
          m,
          "begin; set local work_mem = '3MB'; select current_setting('work_mem'); commit",
        );
        expect(m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]).toEqual([
          "3MB",
        ]);
        await run(m, "select generate_series(1, 3)");
        expect(firstRow(m)).toEqual(["1"]);
        await expect(run(m, "set work_mem = '5MB'")).rejects.toThrow(
          "pool goes through a pooler: statement 1 (SET)",
        );
        await run(m, "select 7");
        expect(firstRow(m)).toEqual(["7"]);
        await m.host.command("endue.database.disconnect", { connection: "pool" });
        if (at !== pooler) return;
        // Not marked, the same pooler refuses the plugin's own startup parameters.
        await m.host.command("endue.database.console", { connection: "plain" });
        await run(m, "select 1");
        expect(messages(m).join("\n")).toMatch(/startup parameter/iu);
      },
    );
});
