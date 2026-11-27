// A console's single read on PostgreSQL goes through a scroll cursor on its kept session (PG-22, ADR
// 0352), on the browser stub's cursors (stub-db-cursor.ts): what is sent, what the result holds,
// and how the cursor ends at the next run, inside the person's transaction and at an error.
import { describe, expect, it } from "vitest";
import type { Script } from "./harness";
import { rawRunsOf } from "./runs-of";
import { script as base, messages, PG, run, shop, state } from "./session-helpers";

/** `count` rows of one column n, 1 to count, as the scripted server answers them. */
const numbers = (count: number) => [
  ["n"],
  ...Array.from({ length: count }, (_, i) => [String(i + 1)]),
];

const script: Script = (sql, who) => {
  if (sql === "select n from big") return { rows: numbers(1200) };
  if (sql === "select n from small") return { rows: numbers(3) };
  if (sql === "select nope from big")
    return { error: 'column "nope" does not exist', code: "42703", position: 8 };
  return base(sql, who);
};

type Mounted = Awaited<ReturnType<typeof shop>>;
/** Every statement the console's sessions were sent, the cursor's own included. */
const sent = (m: Mounted) =>
  rawRunsOf(m.host.calls)
    .filter((c) => c.method === "db.run")
    .map((c) => (c.params as { sql: string }).sql);
const set = (m: Mounted) => m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set;

describe("a console's read through a cursor", () => {
  it("opens a scroll cursor in a transaction of its own; a read that fits one page ends it at once", async () => {
    const m = await shop({ script });
    await run(m, "select n from small");
    expect(sent(m)).toEqual([
      "START TRANSACTION",
      "DECLARE endue_desk_rows SCROLL CURSOR FOR\nselect n from small",
      "FETCH FORWARD 500 FROM endue_desk_rows",
      "END",
    ]);
    expect(set(m)?.rows).toEqual([["1"], ["2"], ["3"]]);
    expect(set(m)?.truncated).toBe(false);
    expect(set(m)?.window).toBeUndefined();
    expect(state(m)).toBe("idle");
  });

  it("a result past its page keeps the cursor, says at least n rows, and the next run ends it first", async () => {
    const m = await shop({ script });
    await run(m, "select n from big");
    expect(set(m)?.rows).toHaveLength(500);
    expect(set(m)?.window).toMatchObject({ first: 0, known: 500, done: false, page: 500 });
    expect(messages(m).join("\n")).toMatch(/at least 500 rows/u);
    // The plugin's own transaction is not the person's: the header says idle.
    expect(state(m)).toBe("idle");
    const before = sent(m).length;
    await run(m, "select 1");
    expect(sent(m).slice(before, before + 2)).toEqual(["END", "START TRANSACTION"]);
    expect(state(m)).toBe("idle");
  });

  it("inside the person's transaction the cursor is theirs: no transaction of its own, CLOSE before the next run", async () => {
    const m = await shop({ script });
    await run(m, "begin");
    await run(m, "select n from big");
    expect(sent(m)).toEqual([
      "begin",
      "DECLARE endue_desk_rows SCROLL CURSOR FOR\nselect n from big",
      "FETCH FORWARD 500 FROM endue_desk_rows",
    ]);
    expect(state(m)).toBe("open");
    await run(m, "commit");
    expect(sent(m).slice(-2)).toEqual(["CLOSE endue_desk_rows", "commit"]);
    expect(state(m)).toBe("idle");
  });

  it("an error in the read points at the statement, not at the DECLARE, and its own transaction rolls back", async () => {
    const m = await shop({ script });
    await run(m, "select nope from big");
    expect(messages(m).join("\n")).toMatch(/42703/u);
    // The error's place is in the statement as typed: "nope" at offset 7.
    expect(m.shown()?.shown?.error?.offset).toBe(7);
    expect(sent(m).at(-1)).toBe("ABORT");
    expect(state(m)).toBe("idle");
  });

  it("several statements, a write, and a table view read as before, without a cursor", async () => {
    const m = await shop({ script });
    await run(m, "select n from small;\nselect 1");
    await run(m, "insert into seen values (1)");
    expect(sent(m).some((sql) => sql.startsWith("DECLARE"))).toBe(false);
  });

  it("through a pooler a read outside the person's transaction reads one page, as before; inside it, a cursor", async () => {
    const m = await shop({ script }, [{ ...PG, pooler: true } as typeof PG]);
    await run(m, "select n from big");
    // A pooler in transaction mode may hand the next call to another server: nothing is kept.
    expect(sent(m).some((sql) => /DECLARE|START TRANSACTION/u.test(sql))).toBe(false);
    expect(set(m)?.rows).toHaveLength(500);
    expect(set(m)?.window).toBeUndefined();
    await run(m, "begin");
    await run(m, "select n from big");
    expect(sent(m).slice(-2)).toEqual([
      "DECLARE endue_desk_rows SCROLL CURSOR FOR\nselect n from big",
      "FETCH FORWARD 500 FROM endue_desk_rows",
    ]);
    expect(set(m)?.window).toMatchObject({ known: 500, done: false });
  });

  it("in manual commit the BEGIN goes first and the cursor is the person's; Commit ends it", async () => {
    const m = await shop({ script });
    await m.host.command("endue.database.transaction-mode", { mode: "manual" });
    await run(m, "select n from big");
    expect(sent(m)).toEqual([
      "BEGIN",
      "DECLARE endue_desk_rows SCROLL CURSOR FOR\nselect n from big",
      "FETCH FORWARD 500 FROM endue_desk_rows",
    ]);
    expect(set(m)?.window).toMatchObject({ known: 500, done: false });
    expect(state(m)).toBe("open");
    expect(m.shown()?.session).toMatchObject({ statements: 1 });
    await m.host.command("endue.database.commit");
    await m.settle();
    expect(sent(m).slice(-2)).toEqual(["CLOSE endue_desk_rows", "COMMIT"]);
    expect(state(m)).toBe("idle");
  });
});
