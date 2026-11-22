// A connection "through a pooler" in transaction mode on a scripted server (PG-14, ADR 0354): every
// session signs in with the application name alone (no statement timeout, date style or read-only
// default as startup parameters), a kept session takes no SET when the timeout changes, a statement
// that keeps session state is refused in words before anything is sent, and reads, writes in a
// transaction, SET LOCAL and the catalog still run. A connection that keeps session options cannot
// be marked.
import { describe, expect, it } from "vitest";
import { pooledRefusal } from "../ui/auth/pooler.js";
import { normalize } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { settingsOf } from "../ui/engines/pg-session.js";
import { split } from "../ui/sql/split.js";
import { made, PG, run, shop } from "./session-helpers";

const POOLED = { ...PG, pooler: true } as Connection;
const refusal = (sql: string, conn = POOLED) => pooledRefusal(conn, split(sql, "postgresql"));

describe("what a pooler in transaction mode does not keep", () => {
  it("refuses each statement that leaves state on the session, in words", () => {
    const kept = [
      ["set search_path = app", "SET"],
      ["SET SESSION work_mem = '1MB'", "SET"],
      ["reset all", "RESET"],
      ["listen jobs", "LISTEN"],
      ["prepare q as select 1", "PREPARE"],
      ["execute q", "a prepared statement"],
      ["declare c cursor with hold for select 1", "DECLARE WITH HOLD"],
      ["create temp table t (a int)", "CREATE TEMPORARY"],
      ["CREATE GLOBAL TEMPORARY TABLE t (a int)", "CREATE TEMPORARY"],
      ["discard all", "DISCARD or LOAD"],
      ["select pg_advisory_lock(7)", "a session advisory lock"],
    ];
    for (const [sql, verb] of kept)
      expect(refusal(`select 1; /* c */ ${sql}`), sql).toBe(
        `Shop goes through a pooler: statement 2 (${verb}) keeps state on the session, which the pooler may hand to someone else.${
          verb === "SET"
            ? " SET LOCAL inside a transaction lasts as long as it."
            : verb === "PREPARE"
              ? " Run the statement itself."
              : verb === "CREATE TEMPORARY"
                ? " Add ON COMMIT DROP and run it in a transaction with what uses it."
                : verb === "a session advisory lock"
                  ? " pg_advisory_xact_lock lasts as long as the transaction."
                  : ""
        }`,
      );
  });

  it("lets what lasts one transaction run, and refuses nothing off a pooler", () => {
    for (const sql of [
      "select 1",
      "begin; set local work_mem = '1MB'; update t set a = 1; commit",
      "set transaction isolation level serializable",
      "create temp table t (a int) on commit drop",
      "declare c cursor for select 1",
      "prepare transaction 'x'",
      "select pg_advisory_xact_lock(7)",
      "notify jobs",
    ])
      expect(refusal(sql), sql).toBe("");
    expect(refusal("set search_path = app", PG)).toBe("");
  });

  it("signs in with the application name alone", () => {
    expect(settingsOf(30_000, POOLED)).toEqual({ application_name: "endue Desk" });
    expect(settingsOf(30_000, { ...POOLED, applicationName: "shop" })).toEqual({
      application_name: "shop",
    });
    expect(settingsOf(30_000, PG)).toMatchObject({ DateStyle: "ISO", statement_timeout: "30000" });
  });

  it("a connection that keeps session options or a startup script cannot be marked", () => {
    const conn = { ...PG, pooler: true };
    expect(() => normalize({ ...conn, searchPath: "app" })).toThrow(
      /^Search path: a connection through a pooler keeps no session state/u,
    );
    expect(() => normalize({ ...conn, startup: "select 1" })).toThrow(/^Startup script: /u);
    expect(normalize({ ...conn, applicationName: "shop" })).toMatchObject({
      pooler: true,
      applicationName: "shop",
    });
  });
});

describe("a pooled connection's sessions", () => {
  it("open without the read-only default, take no SET for the timeout, and refuse SET in words", async () => {
    const ro = { ...POOLED, readOnly: true } as Connection;
    const m = await shop({ pick: () => "yes" }, [ro]);
    await run(m, "select 1");
    const opens = made(m, "db.open");
    expect(opens.length).toBeGreaterThan(0);
    for (const open of opens) {
      expect(open.settings).toEqual({ application_name: "endue Desk" });
      expect("readOnly" in open).toBe(false);
    }
    // A changed statement timeout: no SET reaches the kept session.
    await m.host.command("endue.database.console", { connection: "Shop" });
    await m.host.call(
      "settings.set",
      { key: "endue.database.timeout-seconds", value: 12 },
      "endue.database",
    );
    await m.settle();
    await run(m, "select 2");
    const sql = made(m, "db.run").map((p) => String(p.sql));
    expect(sql.filter((s) => /statement_timeout/u.test(s))).toEqual([]);
    expect(sql).toContain("select 2");

    await expect(run(m, "set search_path = app")).rejects.toThrow(
      "Shop goes through a pooler: statement 1 (SET)",
    );
    expect(made(m, "db.run").map((p) => p.sql)).not.toContain("set search_path = app");
    // The read-only guard still holds without the server's default.
    await expect(run(m, "update items set a = 1")).rejects.toThrow("Shop is read-only");
    expect(made(m, "db.run").map((p) => p.sql)).not.toContain("update items set a = 1");
  });
});
