// A run while a table view is on screen (#611): Run, Mod+Enter and Run all read the table's page
// again, as Refresh does, and say no error.
import { describe, expect, it } from "vitest";
import { actionFor } from "../ui/keys.js";
import { type Mounted, mount, SAVED } from "./harness";

const PAGE = 'SELECT * FROM "notes" LIMIT 500 OFFSET 0';
const pageReads = (m: Mounted) =>
  m.clients.spawned.filter((s) => s.command === "sqlite3" && s.args.some((a) => a.includes(PAGE)))
    .length;

const tableView = async () => {
  const m = await mount({
    store: { connections: SAVED },
    script: () => ({ rows: [["id"], ["1"]] }),
  });
  await m.host.command("endue.database.open-table", {
    connection: "Notes",
    schema: "main",
    table: "notes",
  });
  await m.settle();
  expect(m.shown()).toMatchObject({ kind: "table" });
  expect(pageReads(m)).toBe(1);
  return m;
};

const runs: Array<[string, (m: Mounted) => Promise<unknown>]> = [
  ["Run (the command)", (m) => m.host.command("endue.database.run")],
  ["Run all (the command)", (m) => m.host.command("endue.database.run-all")],
  [
    "Mod+Enter",
    async (m) => {
      const action = actionFor("editor", { key: "Enter", mod: true, shift: false, alt: false });
      expect(action).toBe("run");
      return (m.app as unknown as Record<string, () => Promise<unknown>>)[action as string]?.();
    },
  ],
  ["Run all (the button)", (m) => m.app.runAll()],
];

describe("a run while a table view is on screen", () => {
  it.each(runs)("%s reads the table's page again", async (_, start) => {
    const m = await tableView();
    const said = m.view.said.length;
    await start(m);
    await m.settle();
    expect(m.view.said.slice(said).join("\n")).not.toMatch(/is not defined/u);
    expect(pageReads(m)).toBe(2);
    expect(m.shown()).toMatchObject({ kind: "table" });
  });
});
