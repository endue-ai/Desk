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
import { invokeAsEris } from "./agent-tool-test";
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

  it("the desk's Windows and Settings providers come before the plugins'", async () => {
    const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
    const stub = browserStub({ ...registry.handlers });
    const hub = new PolicyHub(new BridgeClient(stub));
    const files = plugin("example.files", {
      paletteProviders: [{ command: "example.files.find", title: "Files" }],
    });
    const palette = plugin("desk.palette", {});
    const policy = installPalette({ hub });
    hub.apply([files, palette]);
    await hub.commands.settled();
    // Only the desk's providers whose commands are there: the shell's windows define them.
    expect(await hub.commands.run("desk.palette.providers")).toEqual([
      { command: "example.files.find", title: "Files", owner: "example.files" },
    ]);
    const find = (id: string) =>
      hub.commands.define(id, { title: id, owner: "desk", run: () => ({ results: [] }) });
    const offs = [find("desk.settings.find"), find("desk.windows.find")];
    await hub.commands.settled();
    expect(await hub.commands.run("desk.palette.providers")).toEqual([
      { command: "desk.windows.find", title: "Windows", owner: "desk" },
      { command: "desk.settings.find", title: "Settings", owner: "desk" },
      { command: "example.files.find", title: "Files", owner: "example.files" },
    ]);
    for (const off of offs) off();
    policy.dispose();
  });
});

it("desk.search asks the selected palette providers and returns limited matches", async () => {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const client = new BridgeClient(stub);
  const hub = new PolicyHub(client);
  const asked: unknown[] = [];
  let activated = false;
  hub.apply([
    plugin("desk.palette", {}),
    plugin("example.files", {
      paletteProviders: [{ command: "example.files.find", title: "Files" }],
    }),
  ]);
  installPalette({ hub });
  hub.commands.define("example.files.find", {
    owner: "example.files",
    title: "Find files",
    agent: { description: "Read file search results", readOnly: true },
    run: (args, { caller }) => {
      asked.push({ args, caller });
      return {
        results: ["a", "b"].map((id) => ({
          id,
          title: id,
          actions: [{ command: "example.files.open", title: "Open" }],
        })),
      };
    },
  });
  hub.commands.define("example.files.open", {
    owner: "example.files",
    title: "Open a file",
    run: () => {
      activated = true;
    },
  });
  await hub.commands.settled();
  expect(hub.commands.readOnly("desk.search")).toBe(true);
  expect(
    await hub.commands.run("desk.search", { query: "  notes  ", groups: ["Files"], limit: 1 }),
  ).toMatchObject({
    groups: [{ provider: "example.files.find", title: "Files", results: [{ id: "a" }] }],
  });
  await invokeAsEris(client, "desk.search", { query: "notes", groups: ["Files"], limit: 1 });
  expect(asked).toEqual([
    { args: { query: "notes", limit: 1 }, caller: undefined },
    { args: { query: "notes", limit: 1 }, caller: "agent:eris" },
  ]);
  expect(activated).toBe(false);
});
