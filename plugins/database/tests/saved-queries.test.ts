// Starred queries per connection, and the history searched and starred from the palette.
import { describe, expect, it } from "vitest";
import { clearHistory, readSaved, removeSaved, saveQuery } from "../ui/history.js";
import { mount, SAVED } from "./harness";

const storeBridge = () => {
  const store: Record<string, unknown> = {};
  return {
    store,
    call: async (method: string, params: { key: string; value?: unknown }) => {
      if (method === "store.get") return params.key in store ? { value: store[params.key] } : {};
      store[params.key] = params.value;
      return {};
    },
  };
};

describe("starred queries", () => {
  it("are kept by name per connection, replaced under the same name, and removed", async () => {
    const bridge = storeBridge();
    await saveQuery(bridge as never, "c-1", { name: "late orders", sql: "select 1", at: "t1" });
    await saveQuery(bridge as never, "c-1", { name: "big", sql: "select 2", at: "t2" });
    await saveQuery(bridge as never, "c-1", { name: "late orders", sql: "select 3", at: "t3" });
    await saveQuery(bridge as never, "c-2", { name: "other", sql: "select 4", at: "t4" });
    expect(await readSaved(bridge as never, "c-1")).toEqual([
      { name: "big", sql: "select 2", at: "t2" },
      { name: "late orders", sql: "select 3", at: "t3" },
    ]);
    await expect(
      saveQuery(bridge as never, "c-1", { name: "pw", sql: "alter user x password 'y'" }),
    ).rejects.toThrow(/password/u);
    await removeSaved(bridge as never, "c-1", "big");
    expect((await readSaved(bridge as never, "c-1")).map((s) => s.name)).toEqual(["late orders"]);
    await clearHistory(bridge as never, "c-1");
    expect(await readSaved(bridge as never, "c-1")).toEqual([]);
    expect(await readSaved(bridge as never, "c-2")).toHaveLength(1);
  });

  it("are starred from the console, listed with a star in the history and put into the editor", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: () => ({ rows: [["n"], ["1"]] }),
      pick: (asked) =>
        asked.title === "Database: star the query as"
          ? "ones"
          : asked.title === "Database: history"
            ? (asked.items.find((i) => i.label.startsWith("★"))?.id ?? "")
            : (asked.items[0]?.id ?? ""),
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select 1 as n;\nselect 2 as n";
    await m.host.command("endue.database.run-all");
    await m.settle();
    m.view.caret = 3;
    expect(await m.host.command("endue.database.star")).toBe("ones");
    expect(m.store["saved:c-lite"]).toMatchObject([{ name: "ones", sql: "select 1 as n" }]);
    expect(await m.host.command("endue.database.history")).toBe("select 1 as n");
    const shown = m.picks.find((p) => p.title === "Database: history")?.items.map((i) => i.label);
    expect(shown).toEqual(["select 2 as n", "★ select 1 as n"]);
    await m.host.command("endue.database.history", { query: "2 AS" });
    expect(m.picks.at(-1)?.items.map((i) => i.label)).toEqual(["select 2 as n"]);
    expect(await m.host.command("endue.database.starred")).toBe("select 1 as n");
    expect(m.view.inserted.at(-1)).toBe("select 1 as n");
  });
});
