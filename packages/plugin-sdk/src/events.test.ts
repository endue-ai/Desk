import { describe, expect, it } from "vitest";
import { BridgeCallError, type BridgeEvent, defineUiPlugin } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.a", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

describe("ctx.events", () => {
  it("subscribe delivers the named events of other callers, once, until unsubscribe", async () => {
    const { host, ctx } = await mounted({
      grants: [
        { permission: "events:subscribe", names: ["settings.changed"] },
        { permission: "settings:read", keys: ["example.b/*"] },
      ],
    });
    const arrived: string[] = [];
    ctx.bridge.onEvent((event) => arrived.push(event.event));
    const change = async (value: string) => {
      await host.call("settings.set", { key: "voice", value }, "example.b");
      await host.settle();
    };
    await change("early");
    const heard: BridgeEvent[] = [];
    const off = await ctx.events.subscribe(["settings.changed"], (event) => heard.push(event));
    expect(heard).toEqual([]);
    await change("calm");
    expect(heard).toEqual([
      { event: "settings.changed", data: { owner: "example.b", key: "voice", value: "calm" } },
    ]);
    host.emit({
      event: "plugin.changed",
      data: { plugin: "example.b", change: "disabled", revision: 1 },
    });
    expect(heard).toHaveLength(1);

    off();
    await host.settle();
    const subscribed = host.calls.find((call) => call.method === "events.subscribe");
    expect(subscribed?.params).toEqual({
      names: ["settings.changed"],
      scope: { permission: "events:subscribe", names: ["settings.changed"] },
    });
    const unsubscribed = host.calls.filter((call) => call.method === "events.unsubscribe");
    expect(unsubscribed.map((call) => call.params)).toEqual([
      { subscriptionId: expect.any(String) },
    ]);
    await change("late");
    expect(heard).toHaveLength(1);
    expect(arrived).toEqual(["settings.changed", "plugin.changed"]);
  });

  it("subscribe is refused without the grant", async () => {
    const { ctx } = await mounted();
    const refused = await ctx.events.subscribe(["log.entry"], () => {}).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(BridgeCallError);
    expect(refused).toMatchObject({
      code: "permission_denied",
      permission: { permission: "events:subscribe", names: ["log.entry"] },
    });
  });
});
