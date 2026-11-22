// A restore onto an older PostgreSQL with newer client tools (#647): pg_restore 17 and later set
// transaction_timeout at the start of every session, which servers before 17 refuse; pg_restore goes
// on, restores every entry and exits 1. The stderr below is what pg_restore 18 wrote onto real
// PostgreSQL 15 and 16 servers. Only those settings are skipped; any other error still fails, and a
// single transaction, which that first SET would undo, is refused before pg_restore runs.
import { describe, expect, it } from "vitest";
import type { LogState } from "../ui/features/backup/job.js";
import { oneTransactionRefusal, skippedSettings } from "../ui/features/backup/restore-outcome.js";
import { start } from "./backup-harness";
import type { Handlers, Mounted } from "./harness";

const SET_ERROR = [
  'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"',
  "Command was: SET transaction_timeout = 0;",
];
/** One job: the main connection's SET, then every entry restored. */
const ONE_JOB = [
  "pg_restore: connecting to database for restore",
  "pg_restore: while INITIALIZING:",
  ...SET_ERROR,
  'pg_restore: creating TABLE "public.t"',
  'pg_restore: processing data for table "public.t"',
  "pg_restore: warning: errors ignored on restore: 1",
].join("\n");
/** Two jobs and create: each connection's SET, said in the entry it was opened for. */
const TWO_JOBS = [
  "pg_restore: while INITIALIZING:",
  ...SET_ERROR,
  "pg_restore: entering main parallel loop",
  "pg_restore: while PROCESSING TOC:",
  "pg_restore: from TOC entry 215; 1259 16393 VIEW v postgres",
  ...SET_ERROR,
  "pg_restore: while PROCESSING TOC:",
  "pg_restore: from TOC entry 3452; 1262 16384 DATABASE src postgres",
  ...SET_ERROR,
  "pg_restore: warning: errors ignored on restore: 2",
].join("\n");
const MISSING_TABLE = [
  "pg_restore: while INITIALIZING:",
  ...SET_ERROR,
  "pg_restore: while PROCESSING TOC:",
  "pg_restore: from TOC entry 3446; 0 16386 TABLE DATA t postgres",
  'pg_restore: error: could not execute query: ERROR:  relation "public.t" does not exist',
  "Command was: COPY public.t (a, b) FROM stdin;",
  "pg_restore: warning: errors ignored on restore: 2",
].join("\n");

describe("settings the server does not know", () => {
  it("are the only errors of a run that went on: their names", () => {
    expect(skippedSettings(ONE_JOB, 15)).toEqual(["transaction_timeout"]);
    expect(skippedSettings(ONE_JOB, 16)).toEqual(["transaction_timeout"]);
    expect(skippedSettings(TWO_JOBS, 15)).toEqual(["transaction_timeout"]);
    // The server's words may be in its own language: the command and the version decide.
    const localized = ONE_JOB.replace("unrecognized configuration parameter", "paramètre inconnu");
    expect(skippedSettings(localized, 16)).toEqual(["transaction_timeout"]);
  });

  it("are not skipped on a server that knows them, or beside any other error", () => {
    expect(skippedSettings(ONE_JOB, 17)).toBeNull();
    expect(skippedSettings(MISSING_TABLE, 15)).toBeNull();
    const other = ONE_JOB.replaceAll("transaction_timeout", "work_mem_typo");
    expect(skippedSettings(other, 15)).toBeNull();
    const connection =
      'pg_restore: error: connection to server at "db.example" failed: FATAL:  no such database';
    expect(skippedSettings(connection, 15)).toBeNull();
    // A run that stopped at the first error (no "errors ignored") restored nothing.
    expect(skippedSettings(SET_ERROR.join("\n"), 15)).toBeNull();
    expect(skippedSettings("", 15)).toBeNull();
  });

  it("one transaction with pg_restore 17 or later onto a server before 17 is refused, with how to fix it", () => {
    expect(oneTransactionRefusal("18", 15)).toBe(
      "pg_restore 18 sets transaction_timeout, which PostgreSQL 15 does not know, and in a single transaction that error undoes the whole restore: turn Single transaction off, or use pg_restore 15 or 16 (the setting endue.database.pg-restore).",
    );
    expect(oneTransactionRefusal("17.6", 16)).toMatch(/use pg_restore 16 \(the setting/u);
    expect(oneTransactionRefusal("18.1", 17)).toBeUndefined();
    expect(oneTransactionRefusal("16.4", 15)).toBeUndefined();
  });
});

/** pg_restore's restore run answered with `stderr` and `code`; its --version and --list stay scripted. */
function restoreRun(stderr: string, code: number) {
  let m: Mounted | undefined;
  const restores: string[][] = [];
  const handlers: Handlers = {
    "proc.spawn": (params, caller) => {
      const inner = m?.clients.handlers["proc.spawn"];
      if (!inner) throw Object.assign(new Error("not yet"), { code: "not_found" });
      const first = params.args?.[0];
      if (!params.command.endsWith("pg_restore") || first === "--version" || first === "--list")
        return inner(params, caller);
      restores.push(params.args ?? []);
      const procId = `restore-${restores.length}`;
      setTimeout(() => {
        const data = { procId, stream: "stderr", data: `${stderr}\n`, encoding: "utf8" };
        m?.host.emit({ event: "proc.output", data } as never);
        m?.host.emit({ event: "proc.exit", data: { procId, code } } as never);
      }, 0);
      return { procId, pid: 901 };
    },
  };
  return { handlers, restores, attach: (mounted: Mounted) => (m = mounted) };
}

const restoreOn = async (stderr: string, code: number, options: Record<string, unknown> = {}) => {
  const run = restoreRun(stderr, code);
  const { m } = await start({
    server: "150004",
    handlers: run.handlers,
    restore: { connection: "c-wh", options, chosen: null },
  });
  run.attach(m);
  const done = m.host.command("endue.database.restore", { path: "~/Backups/warehouse.dump" });
  return { m, run, done };
};
const log = (m: Mounted) => (m.shown() as unknown as { backup: LogState }).backup;

describe("a restore onto PostgreSQL 15 with pg_restore 17", () => {
  it("whose only errors are settings the server does not know is done, and names them", async () => {
    const { m, done } = await restoreOn(ONE_JOB, 1);
    expect(await done).toMatchObject({ status: "done", connection: "warehouse" });
    expect(log(m).status).toBe("done");
    expect(log(m).result).toMatch(
      /^Restored warehouse\.dump into warehouse in .* s: 9 entries\. PostgreSQL 15 does not know transaction_timeout, which pg_restore 17\.6 sets: skipped\.$/u,
    );
  });

  it("with any other error still fails, with pg_restore's lines", async () => {
    const { m, done } = await restoreOn(MISSING_TABLE, 1);
    expect(await done).toMatchObject({ status: "failed" });
    expect(log(m).result).toMatch(/^Restored into warehouse with 2 errors, in .* s: /u);
    expect(log(m).result).toContain('relation "public.t" does not exist');
  });

  it("in one transaction is refused before pg_restore runs", async () => {
    const { run, done } = await restoreOn(ONE_JOB, 1, { singleTransaction: true });
    await expect(done).rejects.toThrow(
      /pg_restore 17\.6 sets transaction_timeout, which PostgreSQL 15 does not know, .* use pg_restore 15 or 16 /u,
    );
    expect(run.restores).toEqual([]);
  });

  it("with a pg_restore older than the server is refused before it runs", async () => {
    const run = restoreRun(ONE_JOB, 1);
    const { m } = await start({
      server: "180001",
      handlers: run.handlers,
      restore: { connection: "c-wh", chosen: null },
    });
    run.attach(m);
    await expect(
      m.host.command("endue.database.restore", { path: "~/Backups/warehouse.dump" }),
    ).rejects.toThrow(/pg_restore 17\.6 is older than warehouse's server \(PostgreSQL 18\)/u);
    expect(run.restores).toEqual([]);
  });
});

/** A plain dump of pg_dump 18: its session settings, then a row. */
const PLAIN_18 = [
  "SET statement_timeout = 0;",
  "SET transaction_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "INSERT INTO public.orders VALUES (1, 'a');",
  "",
].join("\n");
const plainFile: Handlers = {
  "fs.read": (p: { offset?: number }) => {
    const bytes = Buffer.from(PLAIN_18, "utf8").subarray(p.offset ?? 0);
    return { content: bytes.toString("base64"), encoding: "base64", size: PLAIN_18.length };
  },
};

describe("a plain dump of pg_dump 18", () => {
  it("onto PostgreSQL 15 runs every statement but the setting the server does not know, and names it", async () => {
    const { m } = await start({
      server: "150004",
      handlers: plainFile,
      restore: { connection: "c-wh" },
    });
    const said = await m.host.command("endue.database.restore", { path: "~/Backups/w.sql" });
    expect(said).toMatch(
      /^w\.sql: done, 3 statements in .*; PostgreSQL 15 does not know transaction_timeout: skipped\.$/u,
    );
    const ran = m.sessions().flat().join("\n");
    expect(ran).not.toContain("transaction_timeout");
    expect(ran).toContain("SET client_encoding = 'UTF8'");
    expect(ran).toContain("INSERT INTO public.orders VALUES (1, 'a')");
  });

  it("onto PostgreSQL 17 runs it as written", async () => {
    const { m } = await start({
      server: "170006",
      handlers: plainFile,
      restore: { connection: "c-wh" },
    });
    const said = await m.host.command("endue.database.restore", { path: "~/Backups/w.sql" });
    expect(said).toMatch(/^w\.sql: done, 4 statements in [^;]*$/u);
    expect(m.sessions().flat().join("\n")).toContain("SET transaction_timeout = 0");
  });
});
