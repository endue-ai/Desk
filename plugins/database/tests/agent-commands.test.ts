import { expect, it } from "vitest";
import manifest from "../plugin.json";
import { asAgent, auditMount } from "./audit-fixture";

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
