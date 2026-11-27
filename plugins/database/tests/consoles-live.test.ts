// Many consoles and .sql files on the real clients (PG-24, ADR 0286): two consoles of one SQLite
// database each keep their own results, and Database: run a .sql file runs a script larger than a
// part from disk on the desk core's sessions, the SET statements carried into every part, stopping at
// the first error with its line. sqlite3 runs when it is on PATH (3.37 or newer); PostgreSQL when
// ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database.
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareVersions, parseVersion } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import type { Handlers, Mounted } from "./harness";
import { mount } from "./harness";
import { clientVersion } from "./node-bridge";
import { realProcs } from "./scripted";

const sqliteLine = process.platform === "win32" ? undefined : clientVersion("sqlite3");
const sqliteOk =
  sqliteLine && compareVersions(parseVersion(sqliteLine)?.version ?? "0", "3.37") >= 0;
const postgres = process.env.ENDUE_DB_TEST_POSTGRES;
const scratch = mkdtempSync(join(tmpdir(), "endue-db-consoles-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** fs.read of real files in byte ranges, as the core answers it. */
const files: Handlers = {
  "fs.read": ({ path, offset, length, encoding }) => {
    const size = statSync(path).size;
    const from = Math.min(offset ?? 0, size);
    const buffer = Buffer.alloc(Math.min(length ?? size, size - from));
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, from);
    } finally {
      closeSync(fd);
    }
    const base64 = encoding === "base64";
    return {
      content: buffer.toString(base64 ? "base64" : "utf8"),
      encoding: base64 ? "base64" : "utf8",
      size,
    };
  },
};

async function live(store: Record<string, unknown>) {
  const procs = realProcs();
  const m = await mount({ store, handlers: { ...procs.handlers, ...files }, pick: () => "yes" });
  procs.attach((event) => m.host.emit(event));
  return m;
}

/** Run a command, answering the password prompt it raises, if any. */
async function answering(m: Mounted, password: string | undefined, done: Promise<unknown>) {
  let settled = false;
  const result = done.finally(() => {
    settled = true;
  });
  while (!settled) {
    if (m.view.passwords.at(-1)) m.app.password(password);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return result;
}

const typeAndRun = async (m: Mounted, sql: string, password?: string) => {
  m.view.text = sql;
  m.view.caret = sql.length;
  m.app.edited(sql);
  await answering(m, password, m.host.command("endue.database.run-all"));
  await m.settle();
};

describe.skipIf(!sqliteOk)("many consoles on a real SQLite database", () => {
  it("keeps each console's own text and rows", { timeout: 60_000 }, async () => {
    const file = join(scratch, "notes.db");
    const conn = normalize({ engine: "sqlite", file, id: "c-notes", name: "Notes" });
    const m = await live({ connections: [conn] });
    await m.host.command("endue.database.console", { connection: "Notes" });
    await typeAndRun(m, "create table n (v text); insert into n values ('one'); select v from n;");
    await m.host.command("endue.database.new-console", { connection: "Notes" });
    await typeAndRun(m, "select count(*) as c from n;");
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["1"]]);
    await m.host.command("endue.database.consoles", { console: "Notes" });
    expect(m.shown()?.text).toMatch(/^create table n/u);
    expect(m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows).toEqual([["one"]]);
  });

  it("runs a .sql file from disk in parts, PRAGMA carried, stopping at its first error", {
    timeout: 60_000,
  }, async () => {
    const file = join(scratch, "file.db");
    const conn = normalize({ engine: "sqlite", file, id: "c-file", name: "File" });
    const rows = Array.from({ length: 4000 }, (_, i) => `insert into t values (${i}, 'é ${i}');`);
    const script = [
      "pragma foreign_keys = on;",
      "create table t (id integer primary key, v text);",
      "create table c (t_id integer references t (id));",
      ...rows,
      "insert into c values (-1);",
      "insert into t values (-1, 'never');",
    ].join("\n");
    const path = join(scratch, "load.sql");
    writeFileSync(path, script);
    const m = await live({ connections: [conn] });
    await m.host.command("endue.database.console", { connection: "File" });
    const said = await m.host.command("endue.database.run-file", { path });
    expect(said).toMatch(/^load\.sql: stopped at line 4,004: .*FOREIGN KEY/u);
    await typeAndRun(m, "select count(*) from t;");
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["4000"]]);
  });
});

describe.skipIf(!postgres)("Database: run a .sql file on PostgreSQL", () => {
  it("runs a script larger than a part, SET carried into each part, and stops at the first error", {
    timeout: 60_000,
  }, async () => {
    const { fields, password } = parseUri(postgres ?? "");
    const conn = normalize({ ...fields, id: "c-pg", name: "Scratch" });
    const m = await live({ connections: [conn] });
    await m.host.command("endue.database.console", { connection: "Scratch" });
    await typeAndRun(m, "drop schema if exists endue_run_file cascade;", password);

    const rows = Array.from({ length: 3200 }, (_, i) => `insert into t values (${i}, 'é ${i}');`);
    const script = [
      "create schema endue_run_file;",
      "set search_path = endue_run_file;",
      "create table t (id int primary key, v text);",
      ...rows.slice(0, 1600),
      "begin;",
      ...rows.slice(1600),
      "commit;",
      "create function f() returns int language plpgsql as $$ begin return 1; end $$;",
      "insert into missing values (1);",
      "insert into t values (-1, 'never');",
    ].join("\n");
    const path = join(scratch, "load.sql");
    writeFileSync(path, script);
    const said = await answering(m, password, m.host.command("endue.database.run-file", { path }));
    // Line 3,207: after 3 statements, 3,200 inserts, begin, commit and the function.
    expect(said).toMatch(/^load\.sql: stopped at line 3,207: .*"missing" does not exist/u);

    await typeAndRun(
      m,
      "select count(*), min(id) from endue_run_file.t; select endue_run_file.f();",
      password,
    );
    const sets = (m.shown()?.shown?.tabs ?? []).filter((t) => t.kind === "rows");
    expect(sets[0]?.set?.rows).toEqual([["3200", "0"]]);
    expect(sets[1]?.set?.rows).toEqual([["1"]]);
    await typeAndRun(m, "drop schema endue_run_file cascade;", password);
  });
});
