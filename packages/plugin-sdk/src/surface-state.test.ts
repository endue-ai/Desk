// ui.surface.state (ADR 0070): the runtime asks a plugin for the state to keep before it unloads a
// surface nobody sees, and hands it back as ctx.surface.restored when the surface shows again.
import { describe, expect, it } from "vitest";
import { defineUiPlugin, type PluginContext } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(
  options: Omit<TestHostOptions, "pluginId"> = {},
  mount: (ctx: PluginContext) => void = () => {},
) {
  const host = createTestHost({ pluginId: "example.notes", ...options });
  const ctx = await defineUiPlugin({ mount }, host.transport);
  return { host, ctx };
}

describe("ui.surface.state", () => {
  it("answers with what the plugin's provider returns, asked as the runtime asks", async () => {
    let asked = 0;
    const { host } = await mounted({}, (ctx) => {
      ctx.surface.onUnload(() => {
        asked++;
        return { open: ["~/Notes/a.md"], caret: [4, 4], scroll: 120 };
      });
    });
    await expect(host.surfaceState()).resolves.toEqual({
      state: { open: ["~/Notes/a.md"], caret: [4, 4], scroll: 120 },
    });
    expect(asked).toBe(1);
  });

  it("waits for a provider that answers later", async () => {
    const { host } = await mounted({}, (ctx) => {
      ctx.surface.onUnload(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { count: 3 };
      });
    });
    await expect(host.surfaceState("main")).resolves.toEqual({ state: { count: 3 } });
  });

  it("answers without state when the provider keeps nothing", async () => {
    const { host } = await mounted({}, (ctx) => {
      ctx.surface.onUnload(() => undefined);
    });
    await expect(host.surfaceState()).resolves.toEqual({});
  });

  it("is unknown_command without a provider, so the surface comes back cold", async () => {
    const { host } = await mounted();
    await expect(host.surfaceState()).rejects.toThrow(/unknown_command/);
  });

  it("fails rather than send more than 64 KiB", async () => {
    const { host } = await mounted({}, (ctx) => {
      ctx.surface.onUnload(() => ({ text: "x".repeat(64 * 1024) }));
    });
    await expect(host.surfaceState()).rejects.toThrow(/failed: .*64 KiB/);
  });

  it("removes a provider with the function onUnload returns", async () => {
    const { host } = await mounted({}, (ctx) => {
      const off = ctx.surface.onUnload(() => ({ count: 1 }));
      off();
    });
    await expect(host.surfaceState()).rejects.toThrow(/unknown_command/);
  });

  it("hands the kept state back as ctx.surface.restored; a cold start has none", async () => {
    const { ctx: warm } = await mounted({ restored: { count: 3 }, state: { saved: true } });
    expect(warm.surface.restored).toEqual({ count: 3 });
    // ctx.state is the plugin's own reload state, apart from what ui.surface.state kept.
    expect(warm.state.get()).toEqual({ saved: true });
    const { ctx: cold } = await mounted();
    expect(cold.surface.restored).toBeUndefined();
  });
});
