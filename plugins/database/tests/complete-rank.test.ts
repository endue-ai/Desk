// The person's picks (PG-31, ADR 0327): a candidate picked more often, then more lately, ranks first
// among equals; the picks live in the plugin's store under one small key, at most MAX_PICKS, the one
// picked longest ago going first; a store that fails leaves the ranking as it is.
import { describe, expect, it } from "vitest";
import { createPicks, MAX_PICKS, PICKS_KEY, picksOf } from "../ui/features/completion/picks.js";
import { completer, labelsOf } from "./complete-fixture";

/** A bridge over an in-memory store. */
function storeBridge(initial: Record<string, unknown> = {}, broken = false) {
  const store = new Map(Object.entries(initial));
  const calls: string[] = [];
  return {
    store,
    calls,
    call: async (method: string, params: { key: string; value?: unknown }) => {
      calls.push(method);
      if (broken) throw new Error("store unavailable");
      if (method === "store.get") return { value: store.get(params.key) };
      store.set(params.key, structuredClone(params.value));
      return {};
    },
  };
}

describe("picks", () => {
  it("a candidate picked before ranks first among equals, more picks first, then the latest", async () => {
    const c = await completer();
    const plain = labelsOf(c.at("select | from orders"), "column");
    expect(plain.slice(0, 2)).toEqual(["customer_id", "id"]);
    const picks = {
      "column:total": [3, 10] as [number, number],
      "column:note": [3, 20] as [number, number],
    };
    expect(labelsOf(c.at("select | from orders", { picks }), "column").slice(0, 3)).toEqual([
      "note",
      "total",
      "customer_id",
    ]);
    // A pick never lifts a candidate over a better match or a nearer scope.
    expect(c.at("select id| from orders", { picks }).items[0]?.label).toBe("id");
    const kinds = c.at("select | from orders", { picks: { "keyword:SELECT": [50, 1] } }).items;
    expect(kinds[0]?.kind).toBe("column");
  });

  it("are kept in the plugin's store, at most MAX_PICKS, the oldest going first", async () => {
    let now = 0;
    const bridge = storeBridge({ [PICKS_KEY]: { "column:id": [2, 5], bad: "x", "": [1, 1] } });
    const picks = createPicks(bridge as never, () => ++now);
    expect(await picks.get()).toEqual({ "column:id": [2, 5] });
    await picks.record("column:id");
    await picks.record("table:orders");
    expect(bridge.store.get(PICKS_KEY)).toEqual({ "column:id": [3, 1], "table:orders": [1, 2] });
    for (let i = 0; i < MAX_PICKS + 10; i++) await picks.record(`column:c${i}`);
    const kept = bridge.store.get(PICKS_KEY) as Record<string, [number, number]>;
    expect(Object.keys(kept)).toHaveLength(MAX_PICKS);
    expect(kept["column:id"]).toBeUndefined();
    expect(kept[`column:c${MAX_PICKS + 9}`]).toEqual([1, MAX_PICKS + 12]);
    // The store is read once.
    expect(bridge.calls.filter((m) => m === "store.get")).toHaveLength(1);
    expect(JSON.stringify(kept).length).toBeLessThan(16 * 1024);
  });

  it("a store that fails leaves the ranking as it is", async () => {
    const picks = createPicks(storeBridge({}, true) as never);
    await picks.record("column:id");
    expect(await picks.get()).toEqual({ "column:id": [1, expect.any(Number)] });
    expect(picksOf(null)).toEqual({});
    expect(picksOf({ k: [1.5, 2] })).toEqual({});
  });
});
