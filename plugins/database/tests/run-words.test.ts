// What a run and a check say (#564): a cancelled run says it was cancelled, not that it failed; a run
// that starts after a failed one clears that error at once rather than leaving it on screen while
// the new statement runs; and Check the clients says each client in a few words, so the footer's
// one line holds it (the command still answers every client's whole sentence).
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { show } from "../ui/tabs.js";
import { type Answer, mount, SAVED } from "./harness";
import { runsOf } from "./runs-of";

const LAB: Connection = { ...(SAVED[1] as Connection), id: "c-lab", name: "lab", tag: "none" };

function script(sql: string): Answer {
  if (/pg_sleep/u.test(sql)) return { waits: true };
  if (/^select nope/u.test(sql)) return { error: 'column "nope" does not exist', code: "42703" };
  return { rows: [["n"], ["1"]] };
}

/** A run is under way, waiting on the server (the host settles only once it ends). */
const started = (m: Awaited<ReturnType<typeof mount>>) =>
  vi.waitFor(() =>
    expect(
      runsOf(m.host.calls)
        .filter((c) => c.method === "db.run")
        .at(-1)?.params,
    ).toMatchObject({
      sql: "select pg_sleep(9)",
    }),
  );

describe("what a run says", () => {
  it("a cancelled run says it was cancelled", () => {
    const outcome = (index: number, error?: { kind: "cancelled"; message: string }) => ({
      index,
      ran: true,
      sets: [],
      affected: error ? null : 0,
      warnings: 0,
      notices: [],
      ...(error ? { error } : {}),
    });
    const shown = show({
      conn: LAB,
      sql: "",
      statements: [
        { text: "update a set b = 1", start: 0, end: 18, line: 1, column: 1, tokens: [] },
        { text: "select pg_sleep(9)", start: 19, end: 37, line: 2, column: 1, tokens: [] },
      ],
      classes: [{ verb: "UPDATE" }, { verb: "SELECT" }],
      mode: "run",
      at: 0,
      result: {
        statements: [outcome(0), outcome(1, { kind: "cancelled", message: "Cancelled." })],
        notices: [],
        ms: 1200,
      },
    } as never);
    expect(shown.summary).toBe("Cancelled: 1 of 2 statements finished in 1.2 s");
  });

  it("says Cancelled when the person cancels a statement that runs", async () => {
    const m = await mount({ store: { connections: [LAB] }, script });
    await m.host.command("endue.database.console", { connection: "lab" });
    m.view.text = "select pg_sleep(9)";
    const running = m.host.command("endue.database.run");
    await started(m);
    expect(m.shown()?.running).toBe(true);
    m.app.cancel();
    await running.catch(() => undefined);
    await m.settle();
    expect(m.shown()?.shown?.summary).toMatch(/^Cancelled: 0 of 1 statement finished in /u);
  });

  it("clears the last run's error when a run starts", async () => {
    const m = await mount({ store: { connections: [LAB] }, script });
    await m.host.command("endue.database.console", { connection: "lab" });
    m.view.text = "select nope";
    await m.host.command("endue.database.run").catch(() => undefined);
    await m.settle();
    expect(m.shown()?.shown?.summary).toMatch(/^Failed/u);
    m.view.text = "select pg_sleep(9)";
    const running = m.host.command("endue.database.run");
    await started(m);
    const during = m.view.consoles.filter((c) => c.model?.running).at(-1)?.model;
    expect(during?.shown ?? null).toBeNull();
    m.app.cancel();
    await running.catch(() => undefined);
    await m.settle();
    // A result that worked stays on screen while the next run goes.
    m.view.text = "select 1";
    await m.host.command("endue.database.run");
    await m.settle();
    m.view.text = "select pg_sleep(9)";
    const again = m.host.command("endue.database.run");
    await started(m);
    const kept = m.view.consoles.filter((c) => c.model?.running).at(-1)?.model;
    expect(kept?.shown?.summary).toMatch(/^Done/u);
    m.app.cancel();
    await again.catch(() => undefined);
  });
});

describe("Check the clients", () => {
  it("says each client in a few words in the footer, and answers every whole sentence", async () => {
    const m = await mount({ store: { connections: SAVED } });
    const lines = await m.host.command("endue.database.clients");
    expect(lines).toEqual([
      "PostgreSQL: built into the desk, no client program needed",
      "mysql 8.4.13 (mysql)",
      "sqlite3 3.50.6 (sqlite)",
    ]);
    expect(m.view.said.at(-1)).toBe("Clients: PostgreSQL built in · mysql 8.4.13 · sqlite3 3.50.6");
    const without = await mount({
      store: { connections: SAVED },
      missing: ["mysql", "mariadb", "sqlite3"],
    });
    const missing = (await without.host.command("endue.database.clients")) as string[];
    expect(missing[1]).toMatch(/Install mysql/u);
    expect(without.view.said.at(-1)).toBe(
      "Clients: PostgreSQL built in · mysql not found · sqlite3 not found",
    );
  });
});
