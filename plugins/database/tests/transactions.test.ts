// A console can hold a transaction open (PG-20): Manual mode begins one at the first statement and
// keeps it across runs until Commit or Rollback; the header counts its statements and its time and
// flags it idle after the person's minutes; the isolation level and read-only go into the next
// BEGIN; savepoints are commands; a failed transaction refuses Commit and offers Rollback.
import { afterEach, describe, expect, it, vi } from "vitest";
import { transactionLine } from "../ui/session/transaction-words.js";
import { messages, ranOn, run, sessionOf, shop, state } from "./session-helpers";

const manual = async (m: Awaited<ReturnType<typeof shop>>) =>
  m.host.command("endue.database.transaction-mode", { mode: "manual" });

afterEach(() => vi.restoreAllMocks());

describe("a console's manual transaction", () => {
  it("manual mode begins a transaction at the first statement and keeps it across runs until Commit", async () => {
    const m = await shop();
    await manual(m);
    expect(m.shown()?.session).toMatchObject({ mode: "manual" });
    await run(m, "insert into seen values (1)");
    await run(m, "insert into seen values (2)");
    const id = sessionOf(m, "insert into seen values (1)");
    expect(ranOn(m, id)).toEqual([
      "BEGIN",
      "insert into seen values (1)",
      "insert into seen values (2)",
    ]);
    expect(state(m)).toBe("open");
    // The plugin's BEGIN is not one of the run's statements.
    expect(m.shown()?.execution?.result.statements).toHaveLength(1);
    expect(m.shown()?.execution?.result.statements[0]?.index).toBe(0);
    expect(m.shown()?.session).toMatchObject({ statements: 2 });

    await m.host.command("endue.database.commit");
    await m.settle();
    expect(ranOn(m, id).at(-1)).toBe("COMMIT");
    expect(state(m)).toBe("idle");
    expect(m.view.said.at(-1)).toMatch(/Committed: 2 statements/u);

    await run(m, "select 1");
    expect(ranOn(m, id).slice(-2)).toEqual(["BEGIN", "select 1"]);
    // The person's own transaction control is left alone.
    await m.host.command("endue.database.rollback");
    await run(m, "begin");
    expect(ranOn(m, id).slice(-2)).toEqual(["ROLLBACK", "begin"]);
  });

  it("Rollback undoes both runs: ROLLBACK on the same session, and the next run begins again", async () => {
    const m = await shop();
    await manual(m);
    await run(m, "insert into seen values (1)");
    await run(m, "insert into seen values (2)");
    const id = sessionOf(m, "insert into seen values (1)");
    await m.host.command("endue.database.rollback");
    await m.settle();
    expect(ranOn(m, id).at(-1)).toBe("ROLLBACK");
    expect(state(m)).toBe("idle");
    expect(m.view.said.at(-1)).toMatch(/Rolled back: 2 statements/u);
    await expect(m.host.command("endue.database.rollback")).rejects.toThrow(/no open transaction/u);
    // Auto mode: each statement commits by itself, as before.
    await m.host.command("endue.database.transaction-mode", { mode: "auto" });
    await run(m, "insert into seen values (3)");
    expect(ranOn(m, id).at(-1)).toBe("insert into seen values (3)");
    expect(state(m)).toBe("idle");
  });

  it("the header counts statements and time, and flags an idle open transaction after the setting's minutes", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const m = await shop({ settings: { "transaction-idle-minutes": 5 } });
    await manual(m);
    await run(m, "insert into seen values (1);\ninsert into seen values (2)");
    now += 1000;
    await run(m, "select * from seen");
    const model = m.shown()?.session;
    expect(model).toMatchObject({
      state: "open",
      statements: 3,
      since: 1_000_000,
      flagMs: 300_000,
    });
    const soon = transactionLine(model as never, 1_000_000 + 65_000);
    expect(soon).toMatchObject({ text: "3 statements · 1:05", flagged: false });
    expect(soon.detail).toMatch(/Commit.*Rollback.*quitting the desk rolls it back/su);
    const late = transactionLine(model as never, 1_001_000 + 6 * 60_000);
    expect(late).toMatchObject({ flagged: true, tone: "danger" });
    expect(late.text).toMatch(/idle 6 min/u);
    // Outside a transaction there is nothing to show.
    await m.host.command("endue.database.commit");
    await m.settle();
    expect(transactionLine(m.shown()?.session as never, now).text).toBe("");
  });

  it("isolation level and read-only go into the next BEGIN", async () => {
    const answers = ["serializable", "read-only"];
    const m = await shop({ pick: () => answers.shift() ?? "" });
    await m.host.command("endue.database.transaction-options");
    expect(m.picks.map((p) => p.title)).toEqual([
      "Database: isolation level of the next transaction",
      "Database: read-only or read-write?",
    ]);
    expect(m.shown()?.session).toMatchObject({ mode: "manual", next: "Serializable, read only" });
    await run(m, "select 1");
    const id = sessionOf(m, "select 1");
    expect(ranOn(m, id)).toEqual(["BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY", "select 1"]);
    await m.host.command("endue.database.rollback");
    await m.host.command("endue.database.transaction-options", {
      isolation: "repeatable-read",
      readOnly: false,
    });
    await run(m, "select 2");
    expect(ranOn(m, id).slice(-2)).toEqual(["BEGIN ISOLATION LEVEL REPEATABLE READ", "select 2"]);
    await expect(
      m.host.command("endue.database.transaction-options", { isolation: "chaos" }),
    ).rejects.toThrow(/isolation level/u);
  });

  it("savepoints: set, roll back to, release, as commands, refused outside a transaction", async () => {
    const answers: string[] = [];
    const m = await shop({ pick: () => answers.shift() ?? "" });
    await expect(m.host.command("endue.database.savepoint", { name: "a" })).rejects.toThrow(
      /no open transaction/u,
    );
    await manual(m);
    await run(m, "insert into seen values (1)");
    const id = sessionOf(m, "insert into seen values (1)");
    await m.host.command("endue.database.savepoint", { name: "a" });
    answers.push("My point");
    await m.host.command("endue.database.savepoint");
    await m.settle();
    expect(ranOn(m, id).slice(-2)).toEqual(["SAVEPOINT a", 'SAVEPOINT "My point"']);
    expect(m.shown()?.session).toMatchObject({ savepoints: ["a", "My point"] });
    await run(m, "insert into seen values (2)");
    answers.push("a");
    await m.host.command("endue.database.rollback-to-savepoint");
    await m.settle();
    expect(m.picks.at(-1)?.items.map((i) => i.id)).toEqual(["My point", "a"]);
    expect(ranOn(m, id).at(-1)).toBe("ROLLBACK TO SAVEPOINT a");
    expect(m.shown()?.session).toMatchObject({ savepoints: ["a"], state: "open" });
    await m.host.command("endue.database.release-savepoint", { name: "a" });
    await m.settle();
    expect(ranOn(m, id).at(-1)).toBe("RELEASE SAVEPOINT a");
    expect(m.shown()?.session).toMatchObject({ savepoints: [] });
    // A savepoint the person typed is known too.
    await run(m, "savepoint typed");
    expect(m.shown()?.session).toMatchObject({ savepoints: ["typed"] });
  });

  it("a failed transaction says so, refuses Commit and offers Rollback", async () => {
    const m = await shop();
    await manual(m);
    await run(m, "insert into seen values (1)");
    await run(m, "select 1/0");
    expect(m.shown()?.session).toMatchObject({
      state: "failed",
      detail: expect.stringMatching(/ROLLBACK/u),
    });
    expect(transactionLine(m.shown()?.session as never, Date.now()).detail).toMatch(/Rollback/u);
    await expect(m.host.command("endue.database.commit")).rejects.toThrow(
      /failed: only Rollback ends it/u,
    );
    await run(m, "select 1");
    expect(messages(m).join("\n")).toMatch(/25P02/u);
    expect(state(m)).toBe("failed");
    await m.host.command("endue.database.rollback");
    await m.settle();
    expect(state(m)).toBe("idle");
  });
});
