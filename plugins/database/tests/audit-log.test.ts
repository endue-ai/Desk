// The agents' audit list (ui/features/audit/log.js and gate.js, PG-91): every call recorded on its
// connection with the caller, the time, the command, the statement, the rows and whether the person
// was asked and allowed it; kept apart from the person's history; cut to its size, newest first;
// exported as JSON into ~/Downloads; cleared after a question.
import { describe, expect, it } from "vitest";
import { AUDIT_MAX, createLog, keptStatement } from "../ui/features/audit/log.js";
import { asAgent, auditMount, auditOf, SHOP } from "./audit-fixture";

describe("the list", () => {
  it("records who ran what, when, the rows and the person's answer", async () => {
    const { m } = await auditMount({ pick: () => "yes" });
    await asAgent(
      m,
      "endue.database.query",
      { connection: "shop", sql: "select id, name, email from people" },
      "agent:reader",
    );
    await asAgent(m, "endue.database.query", {
      connection: "shop",
      sql: "insert into people (name) values ('Dee')",
    });
    await asAgent(m, "endue.database.sample-rows", {
      connection: "shop",
      schema: "public",
      table: "people",
      limit: 2,
    });
    const list = auditOf(m);
    expect(
      list.map((e) => [e.caller, e.command, e.statement, e.rows, e.asked, e.allowed, e.outcome]),
    ).toEqual([
      [
        "agent:helper",
        "endue.database.sample-rows",
        'SELECT * FROM "public"."people" LIMIT 2 OFFSET 0',
        2,
        false,
        null,
        "ran",
      ],
      [
        "agent:helper",
        "endue.database.query",
        "insert into people (name) values ('Dee')",
        1,
        true,
        true,
        "ran",
      ],
      [
        "agent:reader",
        "endue.database.query",
        "select id, name, email from people",
        3,
        false,
        null,
        "ran",
      ],
    ]);
    expect(Number.isNaN(Date.parse(String(list[0]?.at)))).toBe(false);
  });

  it("records a declined write, a refusal and a failure", async () => {
    const { m } = await auditMount({ pick: () => "no" });
    await expect(
      asAgent(m, "endue.database.query", { connection: "shop", sql: "delete from people" }),
    ).rejects.toThrow();
    await expect(
      asAgent(m, "endue.database.sample-rows", {
        connection: "shop",
        schema: "public",
        table: "nosuch",
      }),
    ).rejects.toThrow();
    await m.host.command("endue.database.agent-access", { connection: "shop", closed: true });
    await expect(asAgent(m, "endue.database.schema", { connection: "shop" })).rejects.toThrow();
    expect(auditOf(m).map((e) => [e.command, e.outcome, e.asked, e.allowed])).toEqual([
      ["endue.database.schema", "refused", false, null],
      ["endue.database.sample-rows", "failed", false, null],
      ["endue.database.query", "declined", true, false],
    ]);
    expect(auditOf(m)[0]?.error).toBe("shop is closed to agents.");
  });

  it("is kept apart from the person's history", async () => {
    const { m } = await auditMount();
    await asAgent(m, "endue.database.query", { connection: "shop", sql: "select 1" });
    expect(auditOf(m)).toHaveLength(1);
    expect(m.store[`history:${SHOP.id}`]).toBeUndefined();
    // The person's own runs are not on it.
    await m.host.command("endue.database.console", { connection: "shop" });
    m.view.text = "select 1";
    await m.host.command("endue.database.run");
    await m.settle();
    expect(auditOf(m)).toHaveLength(1);
  });

  it("is cut to its size, newest first, and keeps no password", async () => {
    const store: Record<string, unknown> = {};
    const bridge = {
      call: async (method: string, params: { key: string; value?: unknown }) => {
        if (method === "store.get") return params.key in store ? { value: store[params.key] } : {};
        store[params.key] = params.value;
        return {};
      },
    };
    const log = createLog(bridge as never);
    const entry = (n: number) => ({
      at: new Date(n * 1000).toISOString(),
      caller: "agent:x",
      command: "endue.database.query",
      statement: `select ${n}`,
      rows: 1,
      asked: false,
      allowed: null,
      outcome: "ran" as const,
    });
    await Promise.all(Array.from({ length: AUDIT_MAX + 5 }, (_, i) => log.add("c-1", [entry(i)])));
    const list = await log.read("c-1");
    expect(list).toHaveLength(AUDIT_MAX);
    expect(list[0]?.statement).toBe(`select ${AUDIT_MAX + 4}`);
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(60 * 1024);
    expect(keptStatement("ALTER ROLE app PASSWORD 'x'")).not.toContain("'x'");
    expect(keptStatement("x".repeat(5000))).toHaveLength(2000);
  });
});

describe("export and clear", () => {
  it("writes the list as JSON into ~/Downloads", async () => {
    const written: Array<{ path: string; content: string }> = [];
    const { m } = await auditMount({
      handlers: {
        "fs.write": (params) => {
          written.push({ path: params.path, content: String(params.content) });
          return { bytesWritten: String(params.content).length };
        },
      },
    });
    await asAgent(m, "endue.database.query", { connection: "shop", sql: "select 1" });
    const answer = (await m.host.command("endue.database.agent-audit-export", {
      connection: "shop",
    })) as { path: string; entries: number };
    expect(answer.entries).toBe(1);
    expect(answer.path).toMatch(/^~\/Downloads\/agent-audit-shop-\d{8}-\d{6}\.json$/u);
    expect(written.map((w) => w.path)).toEqual([answer.path]);
    const file = JSON.parse(written[0]?.content ?? "{}");
    expect(file).toMatchObject({
      format: "endue.database.agent-audit",
      version: 1,
      connection: "shop",
    });
    expect(file.entries).toMatchObject([{ caller: "agent:helper", statement: "select 1" }]);
  });

  it("asks before it clears", async () => {
    let answer = "no";
    const { m } = await auditMount({ pick: () => answer });
    await asAgent(m, "endue.database.query", { connection: "shop", sql: "select 1" });
    await expect(
      m.host.command("endue.database.agent-audit-clear", { connection: "shop" }),
    ).rejects.toThrow(/Not cleared/u);
    expect(auditOf(m)).toHaveLength(1);
    expect(m.picks.at(-1)?.title).toBe("Clear the agent audit list of shop?");
    answer = "yes";
    await m.host.command("endue.database.agent-audit-clear", { connection: "shop" });
    expect(auditOf(m)).toEqual([]);
  });
});
