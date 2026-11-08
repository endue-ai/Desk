import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type PluginContributes,
  type PluginInfo,
  stubCommands,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PolicyHub } from "../hub";
import { installPalette } from "./palette";

/** An installed plugin, on unless said otherwise, contributing `contributes`. */
function plugin(id: string, contributes: PluginContributes, enabled = true): PluginInfo {
  const ui = id === "desk.palette";
  return {
    id,
    status: "ready",
    enabled,
    builtIn: id.startsWith("desk."),
    revision: 1,
    manifest: {
      id,
      version: "0.1.0",
      kind: ui ? "ui" : "policy",
      ...(ui ? { entry: "ui/index.html" } : {}),
      contributes,
    },
  };
}

describe("desk.palette's policy", () => {
  it("desk.palette.providers answers the enabled plugins' providers in layer order while desk.palette is on", async () => {
    const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
    const stub = browserStub({ ...registry.handlers });
    const hub = new PolicyHub(new BridgeClient(stub));
    const files = plugin("example.files", {
      paletteProviders: [{ command: "example.files.find", title: "Files" }],
    });
    const off = plugin(
      "example.off",
      {
        paletteProviders: [{ command: "example.off.find", title: "Off" }],
      },
      false,
    );
    const palette = (enabled: boolean) =>
      plugin(
        "desk.palette",
        { paletteProviders: [{ command: "desk.palette.items", title: "Items" }] },
        enabled,
      );
    const policy = installPalette({ hub });
    hub.apply([files, off, palette(true)]);
    await hub.commands.settled();
    expect(registry.providerOf("desk.palette.providers")).toBe("desk");
    expect(await hub.commands.run("desk.palette.providers")).toEqual([
      { command: "desk.palette.items", title: "Items", owner: "desk.palette" },
      { command: "example.files.find", title: "Files", owner: "example.files" },
    ]);

    // Without desk.palette nobody asks the providers, so the command goes.
    hub.apply([files, palette(false)]);
    await hub.commands.settled();
    expect(hub.commands.has("desk.palette.providers")).toBe(false);
    await expect(hub.commands.run("desk.palette.providers")).rejects.toMatchObject({
      code: "unknown_command",
    });
    policy.dispose();
  });
});
