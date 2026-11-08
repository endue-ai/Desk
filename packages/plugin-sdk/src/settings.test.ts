import { describe, expect, it } from "vitest";
import { defineUiPlugin, type Setting } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.a", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

describe("ctx.settings", () => {
  it("reads, writes and lists the plugin's own settings over settings.*", async () => {
    const { host, ctx } = await mounted({
      settings: { voice: "calm", "example.b/voice": "bright" },
    });
    expect(await ctx.settings.get("voice")).toBe("calm");
    expect(await ctx.settings.get("motion.reduce")).toBeUndefined();
    await ctx.settings.set("motion.reduce", true);
    expect(host.settings).toEqual({
      voice: "calm",
      "motion.reduce": true,
      "example.b/voice": "bright",
    });
    expect(await ctx.settings.list()).toEqual([
      { owner: "example.a", key: "motion.reduce", value: true },
      { owner: "example.a", key: "voice", value: "calm" },
    ]);
    expect(host.calls.map((call) => [call.method, "scope" in call.params])).toEqual([
      ["settings.get", false],
      ["settings.get", false],
      ["settings.set", false],
      ["settings.list", false],
    ]);
  });

  it("onChange hears settings.changed for its own keys until it stops", async () => {
    const { host, ctx } = await mounted();
    const heard: Setting[] = [];
    const off = ctx.settings.onChange((setting) => heard.push(setting));
    await ctx.settings.set("voice", "calm");
    await host.settle();
    host.emit({
      event: "settings.changed",
      data: { owner: "example.a", key: "motion.reduce", value: true },
    });
    host.emit({ event: "settings.changed", data: { owner: "example.b", key: "voice", value: 1 } });
    expect(heard).toEqual([
      { owner: "example.a", key: "voice", value: "calm" },
      { owner: "example.a", key: "motion.reduce", value: true },
    ]);
    off();
    await ctx.settings.set("voice", "bright");
    await host.settle();
    host.emit({ event: "settings.changed", data: { owner: "example.a", key: "voice", value: 2 } });
    expect(heard).toHaveLength(2);
    expect(host.settings).toEqual({ voice: "bright" });
  });
});
