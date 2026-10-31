import { FIXTURE_CONNECTOR, type Item, type ItemChange } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { BridgeCallError, defineUiPlugin } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.a", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

const READ_ALL = { permission: "data:read" } as const;
const source = { connector: FIXTURE_CONNECTOR, instance: "default" };
const plants: Item = {
  kind: "task",
  id: "task-plants",
  source,
  title: "Water the plants",
  updatedAt: "2026-10-30T08:59:00+09:00",
  status: "open",
  due: "2026-10-30T18:00:00+09:00",
};

describe("ctx.data", () => {
  it("query sends data.query with the narrowest data:read scope and resolves the page", async () => {
    const { host, ctx } = await mounted({ grants: [READ_ALL] });
    const query = {
      kinds: ["task" as const],
      sources: ["desk.fixtures/default", "desk.fixtures"],
      where: [{ field: "status", op: "eq" as const, value: "open" }],
    };
    const page = await ctx.data.query(query);
    expect(page.items.map((item) => item.id)).toEqual(["task-report", "task-groceries"]);
    expect(host.calls[0]).toMatchObject({
      method: "data.query",
      params: {
        query,
        scope: { permission: "data:read", kinds: ["task"], sources: ["desk.fixtures"] },
      },
    });

    // A query without kinds or sources asks for every one; text passes through.
    const found = await ctx.data.query({ text: "kimchi" });
    expect(found.items.map((item) => item.id)).toEqual(["note-stew"]);
    expect(host.calls[1]?.params).toEqual({ query: { text: "kimchi" }, scope: READ_ALL });

    const given = { permission: "data:read" as const, kinds: ["task" as const, "note" as const] };
    await ctx.data.query({ kinds: ["task"] }, { scope: given });
    expect(host.calls[2]?.params).toMatchObject({ scope: given });
  });

  it("query is refused without a covering grant, naming the scope", async () => {
    const { ctx } = await mounted({ grants: [{ permission: "data:read", kinds: ["note"] }] });
    const refused = await ctx.data.query({ kinds: ["task"] }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BridgeCallError);
    expect(refused).toMatchObject({
      code: "permission_denied",
      permission: { permission: "data:read", kinds: ["task"] },
    });
    const notes = await ctx.data.query({ kinds: ["note"] });
    expect(notes.items).toHaveLength(2);
  });

  it("get resolves the item, or undefined when there is none", async () => {
    const { host, ctx } = await mounted({ grants: [READ_ALL] });
    const item = await ctx.data.get(source, "task-report");
    expect(item).toMatchObject({ id: "task-report", title: "Send the weekly report" });
    expect(await ctx.data.get(source, "task-nothing")).toBeUndefined();
    expect(host.calls[0]?.params).toEqual({
      source,
      id: "task-report",
      scope: { permission: "data:read", sources: [FIXTURE_CONNECTOR] },
    });
  });

  it("subscribe delivers its own changes until the returned function unsubscribes, once", async () => {
    const { host, ctx } = await mounted({ grants: [READ_ALL] });
    const heard: ItemChange[][] = [];
    const off = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => heard.push(changes));
    expect(host.calls[0]).toMatchObject({
      method: "data.subscribe",
      params: { query: { kinds: ["task"] }, scope: { permission: "data:read", kinds: ["task"] } },
    });

    host.upsert(plants);
    await host.settle();
    host.remove(source, plants.id);
    await host.settle();
    expect(heard).toEqual([
      [{ change: "upserted", item: plants }],
      [{ change: "removed", source, id: plants.id }],
    ]);

    // Another subscription's changes are not this listener's.
    const other = { subscriptionId: "dsub-other", changes: [{ change: "upserted", item: plants }] };
    host.emit({ event: "data.changed", data: other as never });
    await host.settle();
    expect(heard).toHaveLength(2);

    off();
    off();
    await host.settle();
    expect(host.calls.filter((call) => call.method === "data.unsubscribe")).toHaveLength(1);
    host.upsert({ ...plants, id: "task-later" });
    await host.settle();
    expect(heard).toHaveLength(2);
  });
});
