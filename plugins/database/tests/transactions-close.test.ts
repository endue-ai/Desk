// Closing a console or disconnecting while a transaction is open asks: commit, roll back or stay
// (PG-20). Commit runs COMMIT before the session closes; roll back closes it, which rolls back; stay
// keeps everything. A failed transaction offers only roll back or stay.
import { describe, expect, it } from "vitest";
import { closed, ranOn, run, sessionOf, shop } from "./session-helpers";

const ids = (m: Awaited<ReturnType<typeof shop>>) => m.picks.at(-1)?.items.map((i) => i.id);

describe("the question before an open transaction closes", () => {
  it("closing the console with an open transaction asks commit, roll back or stay", async () => {
    const answers: string[] = [];
    const m = await shop({ pick: () => answers.shift() ?? "" });
    await m.host.command("endue.database.transaction-mode", { mode: "manual" });
    await run(m, "insert into seen values (1)");
    const id = sessionOf(m, "insert into seen values (1)");

    answers.push("stay");
    await expect(m.host.command("endue.database.close-console")).rejects.toThrow(/Not closed/u);
    expect(m.picks.at(-1)?.title).toBe("Close Shop?");
    expect(ids(m)).toEqual(["commit", "rollback", "stay"]);
    expect(JSON.stringify(m.picks.at(-1)?.items)).toMatch(/1 statement/u);
    expect(closed(m)).not.toContain(id);

    const asks = m.picks.length;
    answers.push("commit");
    await m.host.command("endue.database.close-console");
    await m.settle();
    expect(ranOn(m, id).at(-1)).toBe("COMMIT");
    expect(closed(m)).toContain(id);
    // One question, not a second one after it.
    expect(m.picks).toHaveLength(asks + 1);
  });

  it("Disconnect with an open transaction asks too; roll back closes the session without COMMIT", async () => {
    const answers: string[] = [];
    const m = await shop({ pick: () => answers.shift() ?? "" });
    await run(m, "begin");
    await run(m, "insert into seen values (1)");
    const id = sessionOf(m, "begin");
    answers.push("stay");
    await expect(
      m.host.command("endue.database.disconnect", { connection: "Shop" }),
    ).rejects.toThrow(/Not disconnected/u);
    expect(m.picks.at(-1)?.title).toBe("Disconnect Shop?");
    expect(closed(m)).not.toContain(id);

    const asks = m.picks.length;
    answers.push("rollback");
    await m.host.command("endue.database.disconnect", { connection: "Shop" });
    await m.settle();
    expect(closed(m)).toContain(id);
    expect(ranOn(m, id)).not.toContain("COMMIT");
    expect(m.picks).toHaveLength(asks + 1);
    expect(m.view.said.join("\n")).toMatch(/rolled back/u);
  });

  it("a failed transaction offers only roll back or stay", async () => {
    const answers: string[] = [];
    const m = await shop({ pick: () => answers.shift() ?? "" });
    await run(m, "begin");
    await run(m, "select 1/0");
    answers.push("stay");
    await expect(m.host.command("endue.database.close-console")).rejects.toThrow(/Not closed/u);
    expect(ids(m)).toEqual(["rollback", "stay"]);
    expect(JSON.stringify(m.picks.at(-1)?.items)).toMatch(/failed/u);
  });
});
