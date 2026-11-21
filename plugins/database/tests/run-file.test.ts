// Run file (PG-24, ADR 0286): a script of any size runs from its file, never put in the editor. It is
// read in ranges and cut as the console cuts a script, statement by statement into parts (one run
// each until consoles keep a session, PG-02), with a progress line, and stops at the first error
// with its line in the file.
import { describe, expect, it } from "vitest";
import { EDITOR_MAX } from "../ui/console-files.js";
import { createParts, createScriptReader } from "../ui/features/consoles/script-parts.js";
import { split } from "../ui/sql/split.js";
import { type Handlers, type Mounted, mount, SAVED } from "./harness";

/** fs.read of `files` in byte ranges, as base64, keeping every call. */
function ranged(files: Record<string, string>) {
  const reads: Array<{ offset?: number; length?: number; encoding?: string }> = [];
  const handlers: Handlers = {
    "fs.read": ({ path, offset, length, encoding }) => {
      reads.push({ offset, length, encoding });
      const bytes = Buffer.from(files[path] ?? "", "utf8");
      const from = offset ?? 0;
      const part = bytes.subarray(from, length === undefined ? undefined : from + length);
      return { content: part.toString("base64"), encoding: "base64", size: bytes.length };
    },
  };
  return { handlers, reads };
}

/** The statements the scripted sqlite3 ran, in order. */
const ran = (m: Mounted) =>
  m.clients.spawned
    .filter((s) => s.command === "sqlite3" && s.args[0] !== "--version")
    .flatMap((s) =>
      s.args.filter((_arg, i) => /^SELECT total_changes\(\) AS /u.test(s.args[i + 1] ?? "")),
    );

const PAD = "x".repeat(200);
const script = (count: number, bad = -1) =>
  Array.from({ length: count }, (_, i) =>
    i === bad
      ? `insert into nope values (${i}, 'é ${PAD}');`
      : `insert into notes values (${i}, 'é ${PAD}');`,
  ).join("\n");

describe("run file", () => {
  it("runs a script larger than the editor's limit from the file in ranges, without putting it in the editor, with a progress line", async () => {
    const count = 14_000;
    const text = script(count);
    expect(Buffer.byteLength(text)).toBeGreaterThan(3 * EDITOR_MAX);
    const disk = ranged({ "/work/big.sql": text });
    const m = await mount({
      store: { connections: SAVED },
      handlers: disk.handlers,
      script: () => ({ changes: 1 }),
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "-- mine";
    m.app.edited("-- mine");
    const said = await m.host.command("endue.database.run-file", { path: "/work/big.sql" });
    await m.settle();
    expect(said).toMatch(/^big\.sql: done, 14,000 statements in /u);
    expect(ran(m)).toHaveLength(count);
    expect(ran(m)[count - 1]).toBe(`insert into notes values (${count - 1}, 'é ${PAD}')`);
    // Read in ranges, never whole, as bytes (a range may cut a character).
    expect(disk.reads.length).toBeGreaterThan(10);
    for (const read of disk.reads) {
      expect(read.encoding).toBe("base64");
      expect(read.length).toBeGreaterThan(0);
      expect(read.length).toBeLessThanOrEqual(EDITOR_MAX);
    }
    // The editor keeps its own text.
    expect(m.shown()?.text).toBe("-- mine");
    expect(
      m.view.said.some((s) => /^big\.sql: [\d,]+ statements run · line [\d,]+ · \d+%$/u.test(s)),
    ).toBe(true);
    expect(m.shown()?.shown?.summary).toMatch(/^big\.sql: done, 14,000 statements/u);
  });

  it("stops at the first error and names its line in the file", async () => {
    const bad = 9_000;
    const disk = ranged({ "/work/big.sql": script(12_000, bad) });
    const answered: string[] = [];
    const m = await mount({
      store: { connections: SAVED },
      handlers: disk.handlers,
      script: (sql) => {
        answered.push(sql);
        return sql.includes("into nope") ? { error: "no such table: nope" } : { changes: 1 };
      },
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    const said = await m.host.command("endue.database.run-file", { path: "/work/big.sql" });
    await m.settle();
    expect(said).toBe("big.sql: stopped at line 9,001: no such table: nope");
    expect(m.view.said.at(-1)).toBe(said);
    // Nothing after it ran; the parts after its part never started.
    expect(answered.at(-1)).toBe(`insert into nope values (${bad}, 'é ${PAD}')`);
    expect(answered).toHaveLength(bad + 1);
    expect(ran(m)).toContain(answered.at(-1));
    expect(ran(m).length).toBeLessThan(bad + 1_500);
    const messages = m.shown()?.shown?.tabs.find((t) => t.kind === "messages");
    expect(messages?.lines?.[0]).toMatchObject({ level: "error", text: said });
    expect(m.shown()?.shown?.tabs.some((t) => t.kind === "rows")).toBe(false);
  });

  it("reads a script in ranges and cuts it as the console does, wherever a range ends", () => {
    const pieces = [
      "select 1; sel",
      "ect 2;\ncreate function f() returns int as $$ begin; ",
      "return 1; end $$ language plpgsql;\n-- a comment\nselect 'a;",
      "b';",
    ];
    const whole = pieces.join("");
    const reader = createScriptReader("postgresql");
    const got = [...pieces.flatMap((p) => reader.push(p)), ...reader.end()];
    const want = split(whole, "postgresql");
    expect(got.map((s) => [s.text, s.start, s.line, s.column])).toEqual(
      want.map((s) => [s.text, s.start, s.line, s.column]),
    );

    // MySQL: a DELIMITER line read in an earlier range still holds.
    const my = [
      "DELIMITER //\ncreate procedure p() begin select 1; end//\nsel",
      "ect 2//\n",
      "DELIMITER ;\nselect 3;",
    ];
    const mysql = createScriptReader("mysql");
    const cut = [...my.flatMap((p) => mysql.push(p)), ...mysql.end()];
    expect(cut.map((s) => [s.text, s.line])).toEqual([
      ["create procedure p() begin select 1; end", 2],
      ["select 2", 3],
      ["select 3", 5],
    ]);
  });

  it("cuts a script into parts only between statements outside a transaction, and each part carries the SET statements before it", () => {
    const sql = [
      "set search_path = app;",
      "select pg_catalog.set_config('check_function_bodies', 'false', false);",
      "create table a (x int);",
      "begin;",
      "set local lock_timeout = 1;",
      "insert into a values (1), (2), (3), (4);",
      "insert into a values (5), (6), (7), (8);",
      "commit;",
      "reset search_path;",
      "create table b (x int);",
    ].join("\n");
    const parts = createParts({ dialect: "postgresql", bytes: 100, statements: 100, max: 1000 });
    const out = [...split(sql, "postgresql").flatMap((s) => parts.add(s)), ...parts.end()];
    expect(out.map((p) => [p.replayed, p.statements.map((s) => s.text.split(" ")[0])])).toEqual([
      [0, ["set", "select", "create"]],
      [2, ["set", "select", "begin", "set", "insert", "insert", "commit"]],
      [2, ["set", "select", "reset", "create"]],
    ]);
    // RESET takes a setting out of what the next parts replay; SET LOCAL is never replayed.
    const each = createParts({ dialect: "postgresql", bytes: 1, statements: 100, max: 1000 });
    const one = split("set a = 1; set b to 2; reset a; set local c = 3; select 1;", "postgresql");
    const replayed = [...one.flatMap((s) => each.add(s)), ...each.end()];
    expect(replayed.map((p) => p.statements.map((s) => s.text))).toEqual([
      ["set a = 1"],
      ["set a = 1", "set b to 2"],
      ["set a = 1", "set b to 2", "reset a"],
      ["set b to 2", "set local c = 3"],
      ["set b to 2", "select 1"],
    ]);
    // The statement count bounds a part too.
    const few = createParts({ dialect: "postgresql", bytes: 1e6, statements: 2, max: 1e6 });
    const three = split("select 1; select 2; select 3;", "postgresql");
    const counted = [...three.flatMap((s) => few.add(s)), ...few.end()];
    expect(counted.map((p) => p.statements.length)).toEqual([2, 1]);
    // A transaction past the largest part cannot be cut: it is refused at its line.
    const small = createParts({ dialect: "postgresql", bytes: 10, statements: 100, max: 40 });
    const long = split(
      "begin;\ninsert into a values (1);\ninsert into a values (2);\ncommit;",
      "postgresql",
    );
    expect(() => long.flatMap((s) => small.add(s))).toThrow(/line 1 holds a transaction/u);
  });
});
