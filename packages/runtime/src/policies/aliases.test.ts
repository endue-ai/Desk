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
import { PluginCommands } from "../plugin-commands";
import { installAliases } from "./aliases";

/** An installed plugin of a kind, on, with what it contributes. */
function plugin(
  id: string,
  kind: "ui" | "view",
  contributes: PluginContributes,
  enabled = true,
): PluginInfo {
  const view = { id, version: "0.1.0", title: id, layout: { type: "list" as const } };
  return {
    id,
    status: "ready",
    enabled,
    builtIn: id.startsWith("desk."),
    revision: 1,
    manifest: {
      id,
      version: "0.1.0",
      kind,
      ...(kind === "ui" ? { entry: "ui/index.html" } : { view }),
      contributes,
    },
  };
}

/** The runtime's hub on a stub core with the registry, desk.views providing desk.views.open. */
async function setup() {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const client = new BridgeClient(stub);
  const hub = new PolicyHub(client);
  const opened: Array<{ args: unknown; caller: string }> = [];
  await client.call(
    "cmd.register",
    { id: "desk.views.open", title: "Open a view" },
    { caller: "desk.views" },
  );
  client.onEvent((event) => {
    if (event.event !== "cmd.invoked" || event.data.id !== "desk.views.open") return;
    const { invocationId, args, caller } = event.data;
    opened.push({ args: args ?? {}, caller });
    void client.call(
      "cmd.answer",
      { invocationId, result: { shown: true } },
      { caller: "desk.views" },
    );
  });
  return { client, hub, registry, opened, aliases: installAliases({ hub }) };
}

const today = (enabled = true) =>
  plugin(
    "desk.today",
    "view",
    {
      commands: [
        {
          id: "desk.today.open",
          title: "Open today",
          keywords: ["today"],
          runs: { command: "desk.views.open", args: { id: "desk.today", params: { days: 1 } } },
        },
      ],
    },
    enabled,
  );

describe("aliases", () => {
  it("a contributed command with runs is the desk's while its plugin is on, and runs its target with its args, the caller's merged over them", async () => {
    const { hub, registry, opened } = await setup();
    hub.apply([today()]);
    await hub.commands.settled();
    expect(registry.providerOf("desk.today.open")).toBe("desk");
    expect(hub.commands.list().find((c) => c.id === "desk.today.open")).toEqual({
      id: "desk.today.open",
      title: "Open today",
      keywords: ["today"],
      provider: "desk",
    });

    expect(await hub.commands.run("desk.today.open")).toEqual({ shown: true });
    await hub.commands.run("desk.today.open", { params: { days: 3 }, focus: true });
    // Not an object: the alias's own args.
    await hub.commands.run("desk.today.open", "today");
    expect(opened).toEqual([
      { args: { id: "desk.today", params: { days: 1 } }, caller: "desk" },
      { args: { id: "desk.today", params: { days: 3 }, focus: true }, caller: "desk" },
      { args: { id: "desk.today", params: { days: 1 } }, caller: "desk" },
    ]);
  });

  it("it goes when its plugin is turned off, and PluginCommands does not register it as a UI plugin's", async () => {
    const { client, hub, registry, opened, aliases } = await setup();
    hub.apply([today()]);
    await hub.commands.settled();
    expect(hub.commands.has("desk.today.open")).toBe(true);
    hub.apply([today(false)]);
    await hub.commands.settled();
    expect(hub.commands.has("desk.today.open")).toBe(false);
    expect(registry.providerOf("desk.today.open")).toBeUndefined();

    // A UI plugin's command with runs is the desk's too; its other commands are the plugin's.
    const board = plugin("example.board", "ui", {
      commands: [
        {
          id: "example.board.open",
          title: "Open the board",
          runs: { command: "desk.views.open", args: { id: "example.board" } },
        },
        { id: "example.board.refresh", title: "Refresh the board" },
      ],
    });
    new PluginCommands(client).mounted(board);
    hub.apply([board]);
    await hub.commands.settled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await hub.commands.settled();
    expect(registry.providerOf("example.board.open")).toBe("desk");
    expect(registry.providerOf("example.board.refresh")).toBe("example.board");
    await hub.commands.run("example.board.open");
    expect(opened.at(-1)).toEqual({ args: { id: "example.board" }, caller: "desk" });

    aliases.dispose();
    await hub.commands.settled();
    expect(hub.commands.has("example.board.open")).toBe(false);
  });
});
