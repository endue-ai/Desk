import {
  BridgeClient,
  browserStub,
  type PluginManifest,
  stubCommands,
  type UniversalView,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { renderPlugin } from "./template";

const manifestOf = (files: Record<string, string>) =>
  JSON.parse(files["plugin.json"] ?? "null") as PluginManifest;

describe("renderPlugin with kind view", () => {
  const files = renderPlugin({ id: "example.my-view", name: "My view", kind: "view" });
  const manifest = manifestOf(files);

  it("lays out a manifest, a README and one test, and no code", () => {
    expect(Object.keys(files).sort()).toEqual(["README.md", "plugin.json", "tests/view.test.js"]);
    expect(manifest.entry).toBeUndefined();
  });

  it("writes a universal view the desk keeps, never an item view (ADR 0103)", async () => {
    const view = manifest.view as UniversalView;
    expect(view).toMatchObject({ id: "example.my-view", title: "My view", type: "list" });
    expect(view.source).toEqual({
      items: { kinds: ["note"], sort: [{ field: "updatedAt", dir: "desc" }], limit: 20 },
    });
    expect("layout" in view || "version" in view).toBe(false);
    const desk = new BridgeClient(browserStub(stubCommands(() => {}).handlers));
    const scope = { permission: "view:manage" } as const;
    await expect(desk.call("view.save", { view, scope })).resolves.toBeDefined();
    const { views } = await desk.call("view.list", { scope });
    expect(views.find((v) => v.id === "example.my-view")).toMatchObject({ type: "list" });
  });

  it("offers a command that opens the view", () => {
    expect(manifest.contributes?.commands).toEqual([
      {
        id: "example.my-view.open",
        title: "Open My view",
        runs: { command: "desk.views.open", args: { id: "example.my-view" } },
      },
    ]);
  });
});

describe("renderPlugin with kind policy", () => {
  const files = renderPlugin({ id: "example.my-policy", name: "My policy", kind: "policy" });
  const manifest = manifestOf(files);

  it("lays out a manifest, a README and one test, and no code", () => {
    expect(Object.keys(files).sort()).toEqual(["README.md", "plugin.json", "tests/policy.test.js"]);
    expect(manifest.entry).toBeUndefined();
  });

  it("binds its keys to commands it contributes, each an alias of a desk command", () => {
    const commands = manifest.contributes?.commands ?? [];
    const keys = manifest.contributes?.keys ?? [];
    expect(keys.length).toBeGreaterThan(0);
    const own = new Set(commands.map((command) => command.id));
    for (const key of keys) expect(own.has(key.command)).toBe(true);
    for (const command of commands) {
      expect(command.id.startsWith("example.my-policy.")).toBe(true);
      expect(command.runs?.command).toMatch(/^desk\./);
    }
  });
});
