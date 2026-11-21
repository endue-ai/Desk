// The maintenance form against a real PostgreSQL, through the plugin's commands and the real psql.
// It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database it may write in, for
// example postgresql://postgres:pw@db/scratch: VACUUM, ANALYZE, REINDEX and CLUSTER of a small
// table (half its rows deleted), of one of its indexes, of schema public and of the database, with
// and without options, each sent alone so the server runs it outside a transaction block; a
// VACUUM FULL that waits behind another session's lock, seen waiting in the progress read and
// cancelled on the server; and a read-only connection that refuses.
import { spawn, spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { type Handlers, type Mounted, mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const TABLE = "endue_maintenance_live";
const INDEX = `${TABLE}_v`;

type Ran = {
  statement: string;
  status: string;
  error?: string;
  output: string[];
  before: Record<string, number | string | null>;
  after: Record<string, number | string | null> | null;
};

/** psql on the scratch database as the URI's role, unaligned, for what the test sets up. */
const admin = (sql: string) => {
  const done = spawnSync(
    "psql",
    ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", uri, "-c", sql],
    // A statement of the test's own never waits forever behind a lock left by another run.
    { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c lock_timeout=30s" } },
  );
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout.trim();
};

const children: Array<ReturnType<typeof spawn>> = [];
/** A session of its own, named, fed statements on its standard input, which stays open. */
function session(name: string, sql: string) {
  const child = spawn("psql", ["-X", "-q", "-d", uri], {
    env: { ...process.env, PGAPPNAME: name },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  child.stdin?.write(`${sql}\n`);
  return child;
}

/** Do again until `ok` holds, every 200 ms, for 20 s at most. */
async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > end) throw new Error(`never held: ${JSON.stringify(value).slice(0, 2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The plugin with two connections to the scratch database: `live`, and `live-ro`, read-only. */
async function plugin() {
  const { fields, password } = parseUri(uri);
  const conn = (id: string, name: string, more: Partial<Connection> = {}) =>
    normalize({ ...fields, id, name, ...more });
  const procs = realProcs();
  const spawnReal = procs.handlers["proc.spawn"] as unknown as (
    params: Record<string, unknown>,
    caller?: string,
  ) => unknown;
  const sent: string[][] = [];
  const handlers = {
    ...procs.handlers,
    // The password reaches psql as the person's typed one would, never through the store.
    "proc.spawn": (params: Record<string, unknown>, caller?: string) => {
      sent.push((params.args as string[]) ?? []);
      return spawnReal(
        {
          ...params,
          env: { ...(params.env as object), ...(password ? { PGPASSWORD: password } : {}) },
        },
        caller,
      );
    },
  } as unknown as Handlers;
  const store = {
    connections: [conn("c-live", "live"), conn("c-live-ro", "live-ro", { readOnly: true })],
  };
  const m = await mount({ store, handlers, pick: () => "yes" });
  procs.attach((event) => m.host.emit(event));
  return { m, sent };
}
const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const maintain = (m: Mounted, args: Record<string, unknown>) =>
  m.host.command("endue.database.maintenance", { connection: "live", ...args }) as Promise<Ran>;
const MAINTENANCE = /^(VACUUM|ANALYZE|REINDEX|CLUSTER)\b/u;

/** End this database's sessions the tests started (other runs use the same server, each in a
 * database of its own): a killed psql leaves its backend in pg_sleep holding its lock, and an
 * attempt that timed out never killed its psql. */
const endSessions = () =>
  admin(
    "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND application_name LIKE 'maintenance %'",
  );

function setUp() {
  endSessions();
  admin(`DROP TABLE IF EXISTS ${TABLE}`);
  admin(
    `CREATE TABLE ${TABLE} (id int PRIMARY KEY, note text, v int) WITH (autovacuum_enabled = off)`,
  );
  admin(`CREATE INDEX ${INDEX} ON ${TABLE} (v)`);
  admin(`INSERT INTO ${TABLE} SELECT g, repeat('x', 50), g % 97 FROM generate_series(1, 5000) g`);
  admin(`DELETE FROM ${TABLE} WHERE id % 2 = 0`);
}

afterAll(() => {
  for (const child of children) child.kill();
  if (!uri) return;
  endSessions();
  admin(`DROP TABLE IF EXISTS ${TABLE}`);
});

describe.skipIf(!uri)("maintenance on a real PostgreSQL", () => {
  it("runs each operation on a small table with and without options, outside a transaction block", async () => {
    setUp();
    const { m, sent } = await plugin();
    const table = { schema: "public", table: TABLE, run: true };
    // VACUUM, VERBOSE by default: the server's INFO lines, and the run in the table's statistics.
    const plain = await maintain(m, { ...table, operation: "vacuum" });
    expect(plain).toMatchObject({ statement: `VACUUM (VERBOSE) public.${TABLE}`, status: "done" });
    expect(plain.output.join("\n")).toMatch(/vacuuming "[^"]*endue_maintenance_live"/u);
    expect(plain.before.dead).toBeGreaterThan(0);
    // Another session's snapshot in the same database (other live test files run at once) keeps
    // dead rows a VACUUM may not remove yet: the run is seen in its time, never in more dead rows.
    expect(plain.after).toMatchObject({ lastVacuum: expect.any(String) });
    expect(Number(plain.after?.dead)).toBeLessThanOrEqual(Number(plain.before.dead));
    const runs: Array<[string, Record<string, unknown>, string]> = [
      [
        "vacuum",
        { verbose: false, freeze: true, analyze: true, skipLocked: true, indexCleanup: "on" },
        `VACUUM (FREEZE, ANALYZE, SKIP_LOCKED, INDEX_CLEANUP ON) public.${TABLE}`,
      ],
      [
        "vacuum",
        { truncate: "off", parallel: 0, processToast: false, bufferUsageLimit: "256kB" },
        `VACUUM (VERBOSE, TRUNCATE OFF, PARALLEL 0, PROCESS_TOAST OFF, BUFFER_USAGE_LIMIT '256kB') public.${TABLE}`,
      ],
      ["vacuum", { full: true }, `VACUUM (FULL, VERBOSE) public.${TABLE}`],
      ["analyze", {}, `ANALYZE (VERBOSE) public.${TABLE}`],
      [
        "analyze",
        { verbose: false, skipLocked: true, bufferUsageLimit: "1MB" },
        `ANALYZE (SKIP_LOCKED, BUFFER_USAGE_LIMIT '1MB') public.${TABLE}`,
      ],
      ["reindex", {}, `REINDEX (VERBOSE) TABLE CONCURRENTLY public.${TABLE}`],
      [
        "reindex",
        { concurrently: false, verbose: false, tablespace: "pg_default" },
        `REINDEX (TABLESPACE pg_default) TABLE public.${TABLE}`,
      ],
      ["cluster", {}, `CLUSTER (VERBOSE) public.${TABLE} USING ${TABLE}_pkey`],
      ["cluster", { verbose: false, using: INDEX }, `CLUSTER public.${TABLE} USING ${INDEX}`],
    ];
    for (const [operation, options, statement] of runs) {
      const ran = await maintain(m, { ...table, operation, options });
      expect(ran, statement).toMatchObject({ statement, status: "done" });
      expect(ran.error, statement).toBeUndefined();
    }
    // An index, the schema and the database.
    const index = { schema: "public", index: INDEX, run: true };
    await expect(maintain(m, { ...index, operation: "reindex" })).resolves.toMatchObject({
      statement: `REINDEX (VERBOSE) INDEX CONCURRENTLY public.${INDEX}`,
      status: "done",
    });
    await expect(
      maintain(m, { ...index, operation: "cluster", options: { verbose: false } }),
    ).resolves.toMatchObject({
      statement: `CLUSTER public.${TABLE} USING ${INDEX}`,
      status: "done",
    });
    expect(
      admin(`SELECT indisclustered FROM pg_index WHERE indexrelid = '${INDEX}'::regclass`),
    ).toBe("t");
    const schema = await maintain(m, {
      schema: "public",
      operation: "vacuum",
      options: { verbose: false },
      run: true,
    });
    expect(schema.statement).toMatch(new RegExp(`^VACUUM .*public\\.${TABLE}\\b`, "u"));
    expect(schema.status).toBe("done");
    const database = admin("SELECT current_database()");
    for (const [operation, statement] of [
      ["vacuum", "VACUUM"],
      ["analyze", "ANALYZE"],
      ["reindex", `REINDEX DATABASE CONCURRENTLY ${database}`],
      ["cluster", "CLUSTER"],
    ]) {
      const ran = await maintain(m, { operation, options: { verbose: false }, run: true });
      expect(ran, statement).toMatchObject({ statement, status: "done" });
    }
    // Each one went alone in its psql run: the server never answered that a transaction block
    // refuses it.
    const said = m.view.said.join("\n");
    expect(said).not.toMatch(/transaction block/u);
    const maintenance = sent.filter((args) => args.some((a) => MAINTENANCE.test(a)));
    expect(maintenance).toHaveLength(runs.length + 8);
    for (const args of maintenance) {
      expect(args).not.toContain("--single-transaction");
      expect(args.filter((a, i) => args[i - 1] === "-c" && !a.startsWith("\\"))).toHaveLength(1);
    }
  }, 120_000);

  it("shows a VACUUM FULL waiting for another session's lock and cancels it", async () => {
    setUp();
    const holder = session(
      "maintenance holder",
      `BEGIN;\nLOCK TABLE ${TABLE} IN ACCESS SHARE MODE;\nSELECT pg_sleep(600);`,
    );
    const pid = Number(
      await until(
        () =>
          admin(
            "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'maintenance holder' AND wait_event = 'PgSleep'",
          ),
        (found) => found !== "",
      ),
    );
    const { m } = await plugin();
    await maintain(m, {
      schema: "public",
      table: TABLE,
      operation: "vacuum",
      options: { full: true },
    });
    const id = m.shown()?.id as string;
    const running = m.host.command("endue.database.maintenance-run") as Promise<Ran>;
    const waiting = await until(
      async () => {
        await acts(m).maintenanceProgress?.(id);
        return m.shown()?.maintenance.run;
      },
      (run) => run?.progress?.wait === "Lock: relation",
    );
    expect(waiting.progress.blockedBy).toContain(pid);
    expect(waiting.status).toBe("running");
    await m.host.command("endue.database.maintenance-cancel");
    expect(m.view.said).toContain("Cancel sent to the server.");
    const ended = await running;
    expect(ended).toMatchObject({
      statement: `VACUUM (FULL, VERBOSE) public.${TABLE}`,
      status: "cancelled",
    });
    expect(ended.error).toMatch(/canceling statement due to user request/u);
    expect(m.shown()?.maintenance.run).toMatchObject({ status: "cancelled", cancelling: false });
    // The holder is still there, its transaction untouched.
    expect(admin(`SELECT state FROM pg_stat_activity WHERE pid = ${pid}`)).toBe("active");
    holder.kill();
    admin(`SELECT pg_terminate_backend(${pid})`);
  }, 60_000);

  it("a read-only connection refuses", async () => {
    setUp();
    const { m, sent } = await plugin();
    const args = { connection: "live-ro", schema: "public", table: TABLE, operation: "vacuum" };
    await expect(
      m.host.command("endue.database.maintenance", { ...args, run: true }),
    ).rejects.toThrow(
      "live-ro is read-only: VACUUM, ANALYZE, REINDEX and CLUSTER do not run on it.",
    );
    // The form still reads and shows what it would run.
    await m.host.command("endue.database.maintenance", args);
    expect(m.shown()?.maintenance.read.stats.dead).toBeGreaterThan(0);
    await expect(m.host.command("endue.database.maintenance-run")).rejects.toThrow(
      "live-ro is read-only: VACUUM",
    );
    expect(sent.filter((a) => a.some((x) => MAINTENANCE.test(x)))).toEqual([]);
    expect(
      admin(
        `SELECT coalesce(last_vacuum::text, '') FROM pg_stat_user_tables WHERE relname = '${TABLE}'`,
      ),
    ).toBe("");
  }, 60_000);
});
