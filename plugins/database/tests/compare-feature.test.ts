// Two results compared through the plugin's commands (PG-26, ADR 0329), on the SDK's test host with
// a scripted sqlite3 whose `stock` changes from one read to the next (compare-fixture.ts): compare
// takes the result on screen and a pinned one, asks for the key with the primary key first, and
// opens the comparison's panel; run again and compare is one command, in a console and in a table
// view; the difference copies and exports in the plugin's formats.
import { describe, expect, it } from "vitest";
import type { Script } from "./clients";
import { stockScript } from "./compare-fixture";
import { type Mounted, mount, SAVED } from "./harness";

type Pick = (args: { title: string; items: Array<{ id: string; label: string }> }) => string;
const TIME = /\d\d:\d\d:\d\d/u.source;
const t1: Script = (sql) =>
  /^select \* from t1/u.test(sql) ? { rows: [["n"], ["1"], ["2"], ["3"]] } : {};

async function shop(pick?: Pick) {
  const written: Array<{ path: string; content: string }> = [];
  const m = await mount({
    store: { connections: SAVED },
    script: stockScript(t1),
    ...(pick ? { pick } : {}),
    handlers: {
      "fs.write": ({ path, content }) => {
        written.push({ path, content });
        return { bytesWritten: content.length };
      },
    },
  });
  await m.host.command("endue.database.console", { connection: "Notes" });
  return Object.assign(m, { written });
}
const run = async (m: Mounted, text: string) => {
  m.view.text = text;
  m.view.caret = text.length;
  m.app.edited(text);
  await m.host.command("endue.database.run");
  await m.settle();
};
const state = (m: Mounted) => m.shown()?.compare;

describe("two results compared through the plugin", () => {
  it("compare picks two results and a key, the primary key first, and opens the panel", async () => {
    const asked: Array<{ title: string; labels: string[] }> = [];
    const m = await shop(({ title, items }) => {
      asked.push({ title, labels: items.map((i) => i.label) });
      return items[0]?.id ?? "";
    });
    await run(m, "select * from stock");
    await m.host.command("endue.database.pin-result");
    await run(m, "select * from stock");
    await m.host.command("endue.database.compare-results");
    await m.settle();
    // One other result to compare with is taken as it is; the key is asked for.
    expect(asked).toEqual([
      {
        title: "Database: compare the two results by which key?",
        labels: ["The primary key (id)", "Row position", "id", "item", "price"],
      },
    ]);
    expect(m.shown()).toMatchObject({ kind: "compare", name: "compare: Notes · results" });
    expect(state(m)).toMatchObject({
      by: "key",
      key: ["id"],
      counts: { added: 1, removed: 1, changed: 1, same: 2 },
      onlyBefore: [],
      onlyAfter: ["shelf"],
      before: {
        label: expect.stringMatching(new RegExp(`^select \\* from stock · ${TIME}$`, "u")),
      },
      after: { label: "Result", console: "Notes" },
    });
    expect(m.view.said.at(-1)).toBe(
      "Compared by the primary key (id): 1 changed, 1 added, 1 removed, 2 the same.",
    );

    // Named in its arguments: by row position, without asking.
    await m.host.command("endue.database.console", { connection: "Notes" });
    await m.host.command("endue.database.compare-results", { key: "position" });
    await m.settle();
    expect(state(m)).toMatchObject({
      by: "position",
      counts: { changed: 3, added: 0, removed: 0 },
    });
    expect(asked).toHaveLength(1);
  });

  it("run again and compare is one command: the last run again, compared with before", async () => {
    const m = await shop();
    await run(m, "select * from stock");
    expect(await m.host.command("endue.database.run-again-and-compare")).toBe(
      "Compared by the primary key (id): 1 changed, 1 added, 1 removed, 2 the same.",
    );
    await m.settle();
    expect(
      state(m)?.rows.map((r: { change: string; at: string }) => `${r.change} ${r.at}`),
    ).toEqual(["changed 2", "added 5", "removed 3"]);
    // The console holds the new run.
    await m.host.command("endue.database.console", { connection: "Notes" });
    expect(m.shown()?.shown?.tabs[0]?.set?.columns).toEqual(["id", "item", "price", "shelf"]);

    // No primary key: by row position, and it says why.
    await run(m, "select * from t1");
    expect(await m.host.command("endue.database.run-again-and-compare")).toBe(
      "Compared by row position, as the results do not both carry a primary key: no difference, 3 rows the same.",
    );

    // A table view runs its page again.
    await m.host.command("endue.database.open-table", {
      connection: "Notes",
      schema: "main",
      table: "stock",
    });
    await m.settle();
    expect(await m.host.command("endue.database.run-again-and-compare")).toMatch(
      /^Compared by the primary key \(id\): 1 changed, 1 added, 1 removed, 2 the same\.$/u,
    );
  });

  it("the difference copies and exports in the plugin's formats", async () => {
    const m = await shop();
    await expect(
      m.host.command("endue.database.copy-difference", { format: "csv" }),
    ).rejects.toThrow("Nothing is compared yet: Database: compare two results first.");
    await run(m, "select * from stock");
    await m.host.command("endue.database.run-again-and-compare");
    await m.settle();
    await m.host.command("endue.database.copy-difference", { format: "csv" });
    expect(m.view.copied.at(-1)?.split("\r\n")).toEqual([
      "change,id,item,price,shelf",
      "changed (before),2,ink,4.75,",
      "changed (after),2,ink,4.95,A",
      "added,5,tape,1.95,B",
      "removed,3,pad,3.25,",
    ]);
    // From the console, the last comparison.
    await m.host.command("endue.database.console", { connection: "Notes" });
    const path = await m.host.command("endue.database.export-difference", { format: "json" });
    expect(path).toMatch(/^~\/Downloads\/difference-\d{8}-\d{6}\.json$/u);
    const written = m.written.at(-1);
    expect(written?.path).toBe(path);
    expect(JSON.parse(written?.content ?? "[]").map((r: { change: string }) => r.change)).toEqual([
      "changed (before)",
      "changed (after)",
      "added",
      "removed",
    ]);
    expect(m.view.said.at(-1)).toBe(`Exported 4 rows of the difference to ${path}.`);
    await expect(
      m.host.command("endue.database.export-difference", { format: "yaml" }),
    ).rejects.toThrow(/Database: export the difference as: pick tsv, csv/u);
  });
});
