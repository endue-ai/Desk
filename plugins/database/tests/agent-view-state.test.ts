import { expect, it } from "vitest";
import { asAgent, auditMount } from "./audit-fixture";

const state = "endue.database.view-state";

it("only reads the requested console state and caps and masks the shown rows", async () => {
  const { m, seen } = await auditMount();
  await m.host.command("endue.database.agent-access", { connection: "shop", add: "people.email" });
  await m.host.command("endue.database.console", { connection: "shop" });
  m.view.text = "select id, name, email from people";
  await m.host.command("endue.database.run");
  const before = seen.length;
  const answer = await asAgent(m, state, { include: ["result"], maxRows: 1 });
  expect(answer).toEqual({
    result: { columns: ["id", "name", "email"], rows: [["1", "Ada", "(masked)"]], truncated: true },
  });
  expect(seen).toHaveLength(before);
});

it("omits derived sensitive values and does not return a credential-bearing draft", async () => {
  const { m } = await auditMount();
  await m.host.command("endue.database.agent-access", { connection: "shop", add: "people.email" });
  await m.host.command("endue.database.console", { connection: "shop" });
  m.view.text = "select id, upper(email) from people";
  await m.host.command("endue.database.run");
  m.view.text = "ALTER ROLE reports PASSWORD 'fixture-secret'";
  const answer = await asAgent(m, state, { include: ["console", "result"] });
  expect(JSON.stringify(answer)).not.toMatch(/FIXTURE-SECRET|EXAMPLE\.TEST/i);
  expect(answer).toMatchObject({ result: { rows: [] } });
});

it("puts SQL into the named console without sending it to the database", async () => {
  const { m, seen } = await auditMount();
  const sql = "select 17 as drafted";
  const drafted = await asAgent(m, "endue.database.write-console", {
    connection: "shop",
    sql,
    newTab: true,
  });
  expect(drafted).toMatchObject({ connection: "c-shop" });
  expect(m.view.text).toBe(sql);
  expect(seen.some((s) => s.sql === sql)).toBe(false);
});
