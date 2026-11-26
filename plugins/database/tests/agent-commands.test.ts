import { expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import manifest from "../plugin.json";
import { asAgent, auditMount } from "./audit-fixture";
import { FIXTURE_PG_CONNECTION, fixtureScript } from "./fixtures";
import { mount } from "./harness";

it("offers the database read, proposal and export tools with their matching authority", () => {
  const command = (id: string) =>
    manifest.contributes.commands.find((c) => c.id === `endue.database.${id}`);
  for (const id of [
    "view-state",
    "test-connection",
    "find-objects",
    "er-diagram",
    "er-neighbours",
    "history-list",
    "overview",
    "preview-changes",
  ])
    expect(command(id), id).toMatchObject({
      agent: true,
      readOnly: true,
      args: { type: "object" },
    });
  for (const id of [
    "write-console",
    "export",
    "export-all",
    "export-tables",
    "import-file",
    "new-connection",
    "stage-cells",
    "stage-delete-rows",
    "generate-sql",
  ]) {
    expect(command(id), id).toMatchObject({ agent: true, args: { type: "object" } });
    expect(command(id)?.readOnly, id).not.toBe(true);
  }
  for (const id of ["restore", "cancel-session"])
    expect(command(id)?.irreversible, id).not.toBe(true);
});

it("reads connection history as data without opening a picker", async () => {
  const { m } = await auditMount();
  await m.host.command("endue.database.console", { connection: "shop" });
  m.view.text = "select id, name, email from people";
  await m.host.command("endue.database.run");
  const before = m.picks.length;
  const result = await asAgent(m, "endue.database.history-list", { connection: "shop", limit: 1 });
  expect(result).toMatchObject({ history: [{ sql: "select id, name, email from people" }] });
  expect(m.picks).toHaveLength(before);
});

it("a denied connection answers the agent without asking for a connection grant", async () => {
  const { m } = await auditMount({
    handlers: {
      "perm.query": () => ({ grants: [] }),
      "db.open": () => {
        throw new StubError("permission_denied", "Database connection not allowed");
      },
    },
  });
  await expect(
    asAgent(m, "endue.database.query", { connection: "shop", sql: "select 1" }),
  ).rejects.toThrow(/not allowed to connect/i);
  expect(m.host.calls.filter(({ method }) => method === "perm.request")).toEqual([]);
});

it("leaves credential fields empty and waits for the person to choose an import file", async () => {
  const { m, seen } = await auditMount({
    handlers: { "dialog.open": () => ({ cancelled: true, paths: [] }) },
  });
  await asAgent(m, "endue.database.new-connection", {
    name: "Draft",
    host: "db.example",
    password: "fixture-secret",
    passwordCommand: "fixture-helper",
  });
  const form = m.view.forms.at(-1);
  expect(form?.fields).toMatchObject({ name: "Draft", host: "db.example", engine: "postgresql" });
  expect(JSON.stringify(form)).not.toMatch(/fixture-(secret|helper)/);
  expect(seen).toEqual([]);
  const before = m.host.calls.filter(({ method }) => method === "fs.read").length;
  await expect(
    asAgent(m, "endue.database.import-file", {
      connection: "shop",
      path: "~/Downloads/draft.csv",
      schema: "public",
      table: "people",
      format: "csv",
    }),
  ).resolves.toBeNull();
  expect(m.host.calls.some(({ method }) => method === "dialog.open")).toBe(true);
  expect(m.host.calls.filter(({ method }) => method === "fs.read")).toHaveLength(before);
  expect(m.view.imports).toEqual([]);
});

it("stages grid changes without writing, and rolls back an invalid batch", async () => {
  const m = await mount({ store: { connections: [FIXTURE_PG_CONNECTION] }, script: fixtureScript });
  await m.host.command("endue.database.open-table", {
    connection: "fixture-pg",
    schema: "public",
    table: "items",
  });
  const change = (cells: unknown[]) => asAgent(m, "endue.database.stage-cells", { cells });
  await expect(
    change([
      { row: 0, column: 1, value: "Draft" },
      { row: 999, column: 1, value: "Invalid" },
    ]),
  ).rejects.toThrow();
  const preview = () => asAgent(m, "endue.database.preview-changes");
  expect(await preview()).toMatchObject({ count: 0 });
  const staged = await change([{ row: 0, column: 2, value: "{}" }]);
  expect(staged).toMatchObject({ pending: 1 });
  expect(await asAgent(m, "endue.database.stage-delete-rows", { rows: [1] })).toMatchObject({
    pending: 2,
  });
  expect(await preview()).toMatchObject({ count: 2, deletes: [1] });
  expect(
    m
      .sessions()
      .flat()
      .filter((sql) => /^\s*(UPDATE|DELETE|INSERT)\b/iu.test(sql)),
  ).toEqual([]);
});
