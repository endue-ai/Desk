// End to end against a temporary SQLite database and the real sqlite3: run a query, edit a cell,
// submit the pending changes in one transaction and read the row back; a failing change rolls the
// whole transaction back; a table without a primary key refuses edits. Once through the executor
// and the edit modules, once through the whole plugin (its commands and the grid's actions).
// Skipped when sqlite3 (3.37 or newer) is missing.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCatalog } from "../ui/catalog.js";
import { compareVersions, createClients, parseVersion } from "../ui/clients.js";
import { normalize } from "../ui/connections.js";
import { addRow, editCell, emptyChanges, refusalOf, targetOf } from "../ui/edit/pending.js";
import { sourceOf } from "../ui/edit/source.js";
import { submitChanges } from "../ui/edit/submit.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { mount } from "./harness";
import { clientVersion, nodeBridge } from "./node-bridge";
import { realProcs } from "./scripted";

const line = process.platform === "win32" ? undefined : clientVersion("sqlite3");
const usable = line && compareVersions(parseVersion(line)?.version ?? "0", "3.37") >= 0;
const scratch = mkdtempSync(join(tmpdir(), "endue-db-e2e-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SETUP =
  "create table items (id integer primary key, name text not null unique, qty int default 0);\n" +
  "insert into items (id, name, qty) values (1, 'apple', 3), (2, 'pear', 5);\n" +
  "create table log (at text, what text);\ninsert into log values ('now', 'x')";

function plugin(file: string) {
  const conn = normalize({ engine: "sqlite", file, id: "c-e2e", name: "Items" });
  const runner = createRunner(nodeBridge());
  const settings = fromValues({});
  const executor = createExecutor({
    runner,
    clients: createClients(runner, () => settings),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => undefined, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const catalog = createCatalog(executor.execute, () => false);
  return { conn, execute: executor.execute, catalog };
}

describe.skipIf(!usable)("sqlite3 end to end", () => {
  it("runs a query, edits a cell, submits in one transaction and reads the row back", async () => {
    const { conn, execute, catalog } = plugin(join(scratch, "edit.db"));
    expect((await execute(conn, SETUP)).result.statements.every((s) => !s.error)).toBe(true);
    const read = await execute(conn, "select id, name, qty from items order by id");
    const set = read.result.statements[0]?.sets[0];
    if (!set) throw new Error("no rows");
    const source = sourceOf(read.statements[0] as never, "sqlite");
    expect(source).toEqual({ schema: null, name: "items" });
    const columns = await catalog.columns(conn, "main", "items");
    const { target } = targetOf("sqlite", { schema: "main", name: "items" }, set.columns, columns);
    if (!target) throw new Error("no target");
    expect(refusalOf(conn, target)).toBe("");
    const changes = emptyChanges();
    editCell(changes, target, set, 0, 1, "apple's");
    editCell(changes, target, set, 1, 2, null);
    const added = addRow(changes, target, set);
    editCell(changes, target, set, added, 1, "plum");
    const done = await submitChanges({ execute, conn, target, set, changes });
    expect(done.message).toBe("Committed 3 changes in one transaction.");
    const back = await execute(conn, "select id, name, qty from items order by id");
    expect(back.result.statements[0]?.sets[0]?.rows).toEqual([
      ["1", "apple's", "3"],
      ["2", "pear", null],
      ["3", "plum", "0"],
    ]);
  });

  it("rolls every change back when one fails", async () => {
    const { conn, execute, catalog } = plugin(join(scratch, "rollback.db"));
    await execute(conn, SETUP);
    const read = await execute(conn, "select * from items order by id");
    const set = read.result.statements[0]?.sets[0];
    if (!set) throw new Error("no rows");
    const columns = await catalog.columns(conn, "main", "items");
    const { target } = targetOf("sqlite", { schema: "main", name: "items" }, set.columns, columns);
    if (!target) throw new Error("no target");
    const changes = emptyChanges();
    editCell(changes, target, set, 0, 2, "100");
    editCell(changes, target, set, 1, 1, "apple");
    const done = await submitChanges({ execute, conn, target, set, changes });
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/^Rolled back, nothing was changed: row 2 \(update\): .*UNIQUE/u);
    const back = await execute(conn, "select qty from items where id = 1");
    expect(back.result.statements[0]?.sets[0]?.rows).toEqual([["3"]]);
  });

  it("refuses edits of a table without a primary key", async () => {
    const { conn, execute, catalog } = plugin(join(scratch, "nokey.db"));
    await execute(conn, SETUP);
    const columns = await catalog.columns(conn, "main", "log");
    const { target } = targetOf("sqlite", { schema: "main", name: "log" }, ["at", "what"], columns);
    expect(refusalOf(conn, target)).toMatch(/log has no primary key/u);
  });

  it("does it all through the plugin: open the table, edit in the grid, submit, see the new row", async () => {
    const file = join(scratch, "plugin.db");
    await plugin(file).execute(plugin(file).conn, SETUP);
    const procs = realProcs();
    const conn = normalize({ engine: "sqlite", file, id: "c-e2e", name: "Items" });
    const m = await mount({ store: { connections: [conn] }, handlers: procs.handlers });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.open-table", {
      connection: "Items",
      schema: "main",
      table: "items",
    });
    await m.settle();
    expect(m.shown()?.shown?.tabs[0]?.set?.rows[0]).toEqual(["1", "apple", "3"]);
    await m.app.editCell(0, 1, "green apple");
    await m.app.deleteRows([1]);
    await m.settle();
    expect(m.shown()?.edit).toMatchObject({ status: "ready", count: 2 });
    const preview = await m.host.command("endue.database.preview-changes");
    expect(preview).toBe(
      'DELETE FROM "items" WHERE "id" = 2;\nUPDATE "items" SET "name" = \'green apple\' WHERE "id" = 1;',
    );
    const said = await m.host.command("endue.database.submit-changes");
    await m.settle();
    expect(said).toBe("Committed 2 changes in one transaction.");
    expect(m.shown()?.edit?.count ?? 0).toBe(0);
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["1", "green apple", "3"]]);
    const readOnly = await mount({
      store: { connections: [{ ...conn, readOnly: true }] },
      handlers: procs.handlers,
    });
    procs.attach((event) => readOnly.host.emit(event));
    await readOnly.host.command("endue.database.open-table", {
      connection: "Items",
      schema: "main",
      table: "items",
    });
    await readOnly.settle();
    await readOnly.app.editCell(0, 1, "nope");
    expect(readOnly.view.said.at(-1)).toBe("Items is read-only: its rows cannot be changed here.");
  });
});
