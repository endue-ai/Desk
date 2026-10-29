import { describe, expect, it } from "vitest";
import { CommandFailed, defineUiPlugin, isDeskKey } from "./index";
import { createTestHost } from "./testing/index";

describe("commands", () => {
  it("answers a request the desk sends with what the handler returns", async () => {
    const host = createTestHost({ pluginId: "desk.palette" });
    await defineUiPlugin(
      {
        mount(ctx) {
          ctx.commands.on("desk.files.visit", async (args) => (args as { path: string }).path);
        },
      },
      host.transport,
    );
    expect(await host.command("desk.files.visit", { path: "~/a.md" })).toBe("~/a.md");
    await expect(host.command("desk.files.nothing")).rejects.toThrow(/unknown_command/);
  });

  it("answers its own registered commands through the registry (cmd.invoked, cmd.answer)", async () => {
    const host = createTestHost({ pluginId: "desk.palette" });
    const ctx = await defineUiPlugin(
      {
        mount(ctx) {
          ctx.commands.on("desk.palette.pick", (args) => (args as { items: string[] }).items[1]);
        },
      },
      host.transport,
    );
    await ctx.bridge.call("cmd.register", { id: "desk.palette.pick", title: "Pick one" });
    expect(await host.invoke("desk.palette.pick", { items: ["a", "b"] })).toBe("b");
    expect(host.calls.map((c) => c.method)).toEqual(["cmd.register", "cmd.answer"]);
  });

  it("runs and lists the registry's commands (cmd.invoke, cmd.list)", async () => {
    const host = createTestHost({
      pluginId: "endue.eris",
      commands: { "desk.theme.toggle": () => "light" },
    });
    const ctx = await defineUiPlugin({ mount() {} }, host.transport);
    expect(await ctx.commands.run("desk.theme.toggle")).toBe("light");
    expect(await ctx.commands.list()).toEqual([
      { id: "desk.theme.toggle", title: "desk.theme.toggle", keywords: [], provider: "desk" },
    ]);
    const failure = await ctx.commands.run("desk.nope.run").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CommandFailed);
    expect(failure).toMatchObject({ code: "unknown_command" });
    expect(host.ran.map((r) => r.name)).toEqual(["desk.theme.toggle", "desk.nope.run"]);
  });
});

describe("surface and theme", () => {
  it("shows and hides its surface", async () => {
    const host = createTestHost({ pluginId: "desk.palette" });
    const ctx = await defineUiPlugin({ mount() {} }, host.transport);
    expect(host.visible).toBeUndefined();
    ctx.surface.show();
    expect(host.visible).toBe(true);
    ctx.surface.hide();
    expect(host.visible).toBe(false);
  });

  it("hands listeners the theme in force", async () => {
    const host = createTestHost({ pluginId: "example.notes" });
    const ctx = await defineUiPlugin({ mount() {} }, host.transport);
    const seen: string[] = [];
    ctx.theme.on((theme) => seen.push(theme.scheme));
    host.theme({ scheme: "light", contrast: "high", reducedMotion: true, variables: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["light"]);
    expect(ctx.theme.get()?.contrast).toBe("high");
  });
});

describe("isDeskKey", () => {
  const key = (
    k: string,
    mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
  ) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("passes chords and Escape to the desk and keeps typing in the plugin", () => {
    expect(isDeskKey(key("k", { metaKey: true }))).toBe(true);
    expect(isDeskKey(key("Escape"))).toBe(true);
    expect(isDeskKey(key("k"))).toBe(false);
    expect(isDeskKey(key("K", { shiftKey: true }))).toBe(false);
  });
});
