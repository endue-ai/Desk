import { describe, expect, it } from "vitest";
import { BridgeCallError, defineUiPlugin } from "../index";
import { createTestHost } from "./index";

describe("createTestHost", () => {
  it("runs a plugin against a mock bridge, without a browser", async () => {
    const host = createTestHost({
      pluginId: "example.hello-ui",
      state: { count: 1 },
      handlers: { "perm.query": () => ({ grants: [] }) },
    });
    let answer: unknown;
    await defineUiPlugin(
      {
        async mount(ctx) {
          answer = await ctx.bridge.call("perm.query", {});
          const previous = ctx.state.get<{ count: number }>();
          ctx.state.set({ count: (previous?.count ?? 0) + 1 });
        },
      },
      host.transport,
    );
    await host.settle();
    expect(answer).toEqual({ grants: [] });
    expect(host.state).toEqual({ count: 2 });
    expect(host.calls.map((call) => call.method)).toEqual(["perm.query"]);
    expect(host.batches).toBe(1);
  });

  it("answers unsupported for a method nobody serves", async () => {
    const host = createTestHost({ pluginId: "example.hello-ui" });
    let failure: unknown;
    await defineUiPlugin(
      {
        async mount(ctx) {
          await ctx.bridge
            .call("plugin.list", { scope: { permission: "plugin:manage" } })
            .catch((error: unknown) => {
              failure = error;
            });
        },
      },
      host.transport,
    );
    expect(failure).toBeInstanceOf(BridgeCallError);
    expect(failure).toMatchObject({ code: "unsupported", permission: undefined });
  });

  it("refuses a method the test names", async () => {
    const host = createTestHost({
      pluginId: "example.hello-ui",
      grants: [{ permission: "ui:surface" }],
      refuse: { "ui.surface.open": "unsupported" },
    });
    const ctx = await defineUiPlugin({ mount() {} }, host.transport);
    await expect(ctx.surface.open("main")).rejects.toMatchObject({ code: "unsupported" });
    expect(host.surfaces).toEqual([]);
  });

  it("lets the test act as the desk or another caller", async () => {
    const host = createTestHost({
      pluginId: "example.hello-ui",
      grants: [{ permission: "ui:notify" }],
    });
    await defineUiPlugin({ mount() {} }, host.transport);
    await host.call("log.write", { level: "info", message: "hi" }, "example.b");
    expect(host.logged).toMatchObject([{ channel: "example.b", message: "hi" }]);
    await expect(host.call("perm.query", {})).resolves.toEqual({ grants: [] });
    expect(host.grants).toMatchObject([{ permission: { permission: "ui:notify" } }]);
    expect(host.calls).toEqual([]);
  });

  it("delivers events the test emits", async () => {
    const host = createTestHost({ pluginId: "endue.sidebar" });
    const seen: string[] = [];
    await defineUiPlugin(
      {
        mount(ctx) {
          ctx.bridge.onEvent((event) => seen.push(event.event));
        },
      },
      host.transport,
    );
    host.emit({
      event: "plugin.changed",
      data: { plugin: "example.a", change: "disabled", revision: 1 },
    });
    expect(seen).toEqual(["plugin.changed"]);
  });
});
