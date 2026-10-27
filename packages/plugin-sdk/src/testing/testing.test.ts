import { describe, expect, it } from "vitest";
import { defineUiPlugin } from "../index";
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

  it("denies methods without a handler, as the core would", async () => {
    const host = createTestHost({ pluginId: "example.hello-ui" });
    let code: unknown;
    await defineUiPlugin(
      {
        async mount(ctx) {
          await ctx.bridge
            .call("plugin.list", { scope: { permission: "plugin:manage" } })
            .catch((error: { code?: string }) => {
              code = error.code;
            });
        },
      },
      host.transport,
    );
    expect(code).toBe("permission_denied");
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
    host.emit({ event: "plugin.changed", data: { plugin: "example.a", change: "disabled", revision: 1 } });
    expect(seen).toEqual(["plugin.changed"]);
  });
});
