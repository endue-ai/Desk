// PostgreSQL on the core's sessions (PG-01c, ADR 0281): the executor opens a session per run over
// db.*, runs each statement, reads pages up to the row limit and closes the session, with the
// guards, passwords, TLS, timeouts and cancel of the psql path it replaces. A scripted server
// (the bridge stub's StubDatabase) stands in for PostgreSQL.
import { describe, expect, it } from "vitest";
import type { DbColumn, StubDatabase } from "../../../packages/bridge/src/index";
import type { Connection } from "../ui/engines/common.js";
import { Refusal } from "../ui/execute.js";
import { sessionExecutor } from "./pg-host";

const PG: Connection = {
  id: "c-pg",
  name: "Shop",
  engine: "postgresql",
  host: "db.example",
  port: 6543,
  database: "shop",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};
const col = (name: string, typeOid = 25): DbColumn => ({
  name,
  typeOid,
  typeModifier: -1,
  typeSize: -1,
  tableOid: 0,
  columnNumber: 0,
});
const error = (code: string, message: string, more: Record<string, unknown> = {}) => ({
  severity: "ERROR",
  localSeverity: "ERROR",
  code,
  message,
  ...more,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => [String(i + 1)]);
const grant = [{ permission: "db:connect" as const, hosts: ["*"] }];

describe("PostgreSQL on a session through the bridge", () => {
  it("opens a session per run, runs each statement through db.run and closes it", async () => {
    const db: StubDatabase = {
      statements: [
        { sql: "select 1 as one", columns: [col("one", 23)], rows: [["1"]] },
        { sql: "update t set a = 1", tag: "UPDATE 3" },
        { sql: "create table x (id int)", tag: "CREATE TABLE" },
      ],
    };
    const t = sessionExecutor(db, { grants: grant });
    const run = await t.execute(
      PG,
      "select 1 as one;\nupdate t set a = 1;\ncreate table x (id int)",
    );
    const [one, update, create] = run.result.statements;
    expect(one?.sets[0]).toEqual({
      columns: ["one"],
      rows: [["1"]],
      truncated: false,
      types: [23],
    });
    expect([update?.affected, create?.affected, create?.error]).toEqual([3, null, undefined]);
    expect(t.calls.some((c) => c.method === "proc.spawn")).toBe(false);
    expect(t.made("db.open")).toEqual([
      {
        engine: "postgresql",
        host: "db.example",
        port: 6543,
        database: "shop",
        user: "app",
        settings: { application_name: "endue Desk", DateStyle: "ISO" },
        timeoutMs: 10_000,
        scope: { permission: "db:connect", hosts: ["db.example:6543"] },
      },
    ]);
    expect(t.made("db.run").map((p) => p.sql)).toEqual([
      "select 1 as one",
      "update t set a = 1",
      "create table x (id int)",
    ]);
    expect(t.made("db.close")).toEqual([{ sessionId: "d-1" }]);
    await t.execute(PG, "select 1 as one");
    expect(t.made("db.close")).toEqual([{ sessionId: "d-1" }, { sessionId: "d-2" }]);
  });

  it("pages up to the row limit, closes the rest and keeps NULL, '' and 'NULL' apart", async () => {
    const rows = [
      ["1", null],
      ["2", ""],
      ["3", "NULL"],
      ...many(24_997).map(([n]) => [n ?? "", "x"]),
    ];
    const db: StubDatabase = {
      statements: [{ sql: "select id, v from t", columns: [col("id", 23), col("v")], rows }],
    };
    const t = sessionExecutor(db, {
      grants: grant,
      settings: { "endue.database.max-rows": 20_000 },
    });
    const run = await t.execute(PG, "select id, v from t");
    const set = run.result.statements[0]?.sets[0];
    expect([set?.rows.length, set?.truncated, set?.types]).toEqual([20_000, true, [23, 25]]);
    expect(set?.rows.slice(0, 3)).toEqual([
      ["1", null],
      ["2", ""],
      ["3", "NULL"],
    ]);
    expect(t.made("db.run")[0]).toMatchObject({ pageRows: 10_000 });
    expect(t.made("db.fetch")).toEqual([
      { sessionId: "d-1", pageRows: 10_000 },
      { sessionId: "d-1", close: true },
    ]);
    const all = await t.execute(PG, "select id, v from t", { maxRows: 100_000 });
    expect([
      all.result.statements[0]?.sets[0]?.rows.length,
      all.result.statements[0]?.sets[0]?.truncated,
    ]).toEqual([25_000, false]);
  });

  it("a statement's error carries its code, its DETAIL and HINT lines and its position as an offset", async () => {
    const sql = "select '😀' as a,\n  nope";
    const db: StubDatabase = {
      statements: [
        {
          sql,
          error: error("42703", 'column "nope" does not exist', {
            position: 20,
            detail: "There is no such column.",
            hint: "Perhaps you meant nape.",
          }),
        },
      ],
    };
    const t = sessionExecutor(db, { grants: grant });
    const run = await t.execute(PG, `${sql};\nselect 2`);
    const [failed, after] = run.result.statements;
    expect(failed?.error).toEqual({
      kind: "sql",
      code: "42703",
      message: 'column "nope" does not exist',
      detail: "DETAIL:  There is no such column.\nHINT:  Perhaps you meant nape.",
      position: sql.indexOf("nope"),
    });
    expect(after?.ran).toBe(false);
    // Both went in one db.script batch (ADR 0344), which stopped at the error; nothing after it.
    expect(t.calls.map((c) => c.method)).toEqual(["db.open", "db.script", "db.close"]);
  });

  it("a script in one transaction and a dry run", async () => {
    const db: StubDatabase = {
      statements: [
        { sql: "insert into t values (1)", tag: "INSERT 0 1" },
        { sql: "insert into t values (x)", error: error("42703", 'column "x" does not exist') },
      ],
    };
    const t = sessionExecutor(db, { grants: grant });
    await t.execute(PG, "insert into t values (1);\ninsert into t values (1)", {
      mode: "transaction",
    });
    expect(t.made("db.run").map((p) => p.sql)).toEqual([
      "BEGIN",
      "insert into t values (1)",
      "insert into t values (1)",
      "COMMIT",
    ]);
    const failed = await t.execute(PG, "insert into t values (1);\ninsert into t values (x)", {
      mode: "transaction",
    });
    expect(failed.result.statements.map((s) => s.error?.code)).toEqual([undefined, "42703"]);
    expect(
      t
        .made("db.run")
        .slice(4)
        .map((p) => p.sql),
    ).toEqual(["BEGIN", "insert into t values (1)", "insert into t values (x)", "ROLLBACK"]);
    await t.execute(PG, "insert into t values (1)", { mode: "dry-run" });
    expect(
      t
        .made("db.run")
        .slice(8)
        .map((p) => p.sql),
    ).toEqual(["BEGIN", "insert into t values (1)", "ROLLBACK"]);
  });

  it("read-only, the statement timeout, cancel", async () => {
    const db: StubDatabase = {
      statements: [
        { sql: "select 1", columns: [col("?column?", 23)], rows: [["1"]] },
        {
          sql: "select slow()",
          error: error("57014", "canceling statement due to statement timeout"),
        },
        { sql: "select pg_sleep(60)", waits: true },
      ],
    };
    const t = sessionExecutor(db, {
      grants: grant,
      settings: { "endue.database.timeout-seconds": 30 },
    });
    await t.execute({ ...PG, readOnly: true }, "select 1");
    expect(t.made("db.open")[0]).toMatchObject({
      readOnly: true,
      settings: { application_name: "endue Desk", DateStyle: "ISO", statement_timeout: "30000" },
    });
    await expect(t.execute({ ...PG, readOnly: true }, "delete from t")).rejects.toBeInstanceOf(
      Refusal,
    );
    expect(t.made("db.open")).toHaveLength(1);
    const slow = await t.execute(PG, "select slow()");
    expect(slow.result.statements[0]?.error).toMatchObject({
      kind: "timeout",
      message: "Stopped after 30 s (the statement timeout).",
    });
    const sleeping = t.execute(PG, "select pg_sleep(60);\nselect 1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.sessions.running()).toBe(1);
    t.sessions.cancel();
    const stopped = await sleeping;
    expect(stopped.result.statements.map((s) => [s.ran, s.error?.kind])).toEqual([
      [true, "cancelled"],
      [false, undefined],
    ]);
    expect(stopped.result.statements[0]?.error?.message).toBe("Cancelled.");
    expect(t.made("db.cancel")).toHaveLength(1);
  });

  it("TLS modes and the CA file map to db.open's tls", async () => {
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    const db: StubDatabase = { statements: [{ sql: "select 1", tag: "SELECT 0" }] };
    const t = sessionExecutor(db, { grants: grant, files: { "~/certs/ca.pem": pem } });
    await t.execute(PG, "select 1");
    await t.execute({ ...PG, ssl: "require" }, "select 1");
    await t.execute({ ...PG, ssl: "verify-full", sslCa: "~/certs/ca.pem" }, "select 1");
    expect(t.made("db.open").map((p) => p.tls)).toEqual([
      undefined,
      { mode: "require" },
      { mode: "verify-full", ca: pem },
    ]);
    expect(t.made("perm.request").map((p) => p.permission)).toEqual([
      { permission: "fs:read", paths: ["~/certs/ca.pem"] },
    ]);
    const missing = await t.execute(
      { ...PG, ssl: "verify-ca", sslCa: "~/certs/none.pem" },
      "select 1",
    );
    expect(missing.result.error).toMatchObject({
      kind: "connect",
      message: expect.stringMatching(/none\.pem/u),
    });
    const socket = await t.execute({ ...PG, host: "/var/run/postgresql" }, "select 1");
    expect(socket.result.error?.message).toMatch(/host name or an IPv4 address/u);
  });

  it("asks for db:connect once when the grant is missing, and for a password when the server needs one", async () => {
    const db: StubDatabase = {
      password: "s3cret",
      statements: [{ sql: "select 1", columns: [col("?column?", 23)], rows: [["1"]] }],
    };
    const t = sessionExecutor(db, { typed: "s3cret" });
    const run = await t.execute(PG, "select 1");
    expect(run.result.statements[0]?.sets[0]?.rows).toEqual([["1"]]);
    expect(t.made("perm.request")).toEqual([
      expect.objectContaining({
        permission: { permission: "db:connect", hosts: ["db.example:6543"] },
      }),
    ]);
    expect(t.asked).toHaveLength(1);
    expect(t.kept).toEqual(["s3cret"]);
    expect(t.made("db.open").map((p) => p.password)).toEqual([undefined, undefined, "s3cret"]);
    const wrong = sessionExecutor(db, { grants: grant, typed: "nope" });
    const refused = await wrong.execute(PG, "select 1");
    expect(refused.result.error).toMatchObject({
      kind: "auth",
      message: expect.stringMatching(/password authentication failed/u),
    });
    expect(wrong.kept).toEqual([]);
  });

  it("a statement that starts with a backslash is refused with the same words and nothing is sent", async () => {
    const t = sessionExecutor({ statements: [] }, { grants: grant });
    await expect(t.execute(PG, "\\! ls")).rejects.toThrow(
      "Statement 1: psql meta-commands (\\...) do not run here; use the terminal.",
    );
    expect(t.calls).toEqual([]);
  });
});
