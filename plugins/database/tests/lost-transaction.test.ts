// A session lost inside a transaction (PG-105, ADR 0355): the status line, the header and the next
// run's Messages say the server rolled the transaction back, with the statements it held, and that
// none was run again; the next run runs its own statements alone, on a new session.
import { describe, expect, it } from "vitest";
import { createTransactions } from "../ui/session/transactions.js";
import { messages, ranOn, run, sessionOf, shop, state } from "./session-helpers";

describe("a transaction lost with its session", () => {
  it("is said with its statements on the status line, in the header and in the next run, and never replayed", async () => {
    const m = await shop();
    await run(m, "begin");
    await run(m, "insert into seen values (1)");
    await run(m, "update seen set id = 2 where id = 1");
    const first = sessionOf(m, "begin");
    m.host.emit({
      event: "db.closed",
      data: {
        sessionId: first ?? "",
        reason: "server",
        error: {
          severity: "FATAL",
          code: "57P01",
          message: "terminating connection due to administrator command",
        },
      },
    });
    await m.settle();
    expect(state(m)).toBe("lost");
    expect(m.view.said.at(-1)).toMatch(
      /Shop.*lost.*rolled back its open transaction with its 2 statements; none was run again/su,
    );
    expect(m.shown()?.session?.detail).toMatch(
      /2 statements.*insert into seen values \(1\).*update seen set id = 2 where id = 1/su,
    );

    await run(m, "select * from seen");
    const second = sessionOf(m, "select * from seen");
    expect(second).not.toBe(first);
    expect(ranOn(m, second)).toEqual(["select * from seen"]);
    const said = messages(m).join("\n");
    expect(said).toMatch(/A new session/u);
    expect(said).toMatch(
      /held 2 statements.*not run again:\n1\. insert into seen values \(1\)\n2\. update seen set id = 2 where id = 1/su,
    );
    // Said once: the run after does not say it again.
    await run(m, "select * from seen");
    expect(messages(m).join("\n")).not.toMatch(/held 2 statements/u);
  });

  it("keeps the statements' text short and at most fifty of them", async () => {
    let held = true;
    const t = createTransactions({
      chosen: () => ({ mode: "auto", isolation: "default", readOnly: false }),
      held: () => held,
      flagMs: () => 0,
      now: () => 1,
    });
    const statement = (text: string) => ({
      text,
      start: 0,
      end: text.length,
      line: 1,
      column: 1,
      tokens: [],
    });
    const plan = (texts: string[]) => ({
      statements: texts.map(statement),
      maxRows: 10,
      timeoutMs: 0,
      mode: "run" as const,
      session: { owner: "console:1", kind: "console" as const },
    });
    const ok = (n: number) => async () => ({
      statements: Array.from({ length: n }, (_, index) => ({
        index,
        ran: true,
        sets: [],
        affected: 1,
        warnings: 0,
        notices: [],
      })),
      notices: [],
      ms: 0,
    });
    const conn = {} as never;
    await t.run(conn, plan(["begin"]), ok(1));
    const many = Array.from(
      { length: 60 },
      (_, i) => `insert into seen values (${i}) ${"x".repeat(i === 0 ? 300 : 0)}`,
    );
    await t.run(conn, plan(many), ok(60));
    held = false;
    const lost = t.lose("console:1");
    expect(lost?.statements).toBe(60);
    expect(lost?.texts).toHaveLength(50);
    expect(lost?.texts[0]?.length).toBeLessThanOrEqual(201);
    expect(lost?.texts[0]?.endsWith("…")).toBe(true);
    expect(t.lose("console:1")).toBeUndefined();
  });
});
