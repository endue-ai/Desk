import type { BridgeClient, PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PluginCommands } from "./plugin-commands";

function bridge() {
  const calls: Array<{ method: string; params: unknown; caller?: string }> = [];
  const client = {
    call: async (method: string, params: unknown, options?: { caller?: string }) => {
      calls.push({ method, params, caller: options?.caller });
      return {};
    },
  } as unknown as BridgeClient;
  return { client, calls };
}

const GIT = {
  id: "endue.git",
  manifest: {
    id: "endue.git",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    contributes: {
      commands: [
        {
          id: "endue.git.state",
          title: "Git: state",
          keywords: ["branch"],
          description: "The branch and the changed files.",
          args: { type: "object" },
          result: { type: "object" },
          agent: true,
          readOnly: true,
        },
        { id: "endue.git.open", title: "Git: open" },
        { id: "endue.git.alias", title: "Alias", runs: { command: "endue.git.open" } },
        { id: "other.thing", title: "Not its own" },
      ],
    },
  },
} as unknown as PluginInfo;

describe("PluginCommands", () => {
  it("registers a manifest's own commands with what agents read of them (ADR 0088)", async () => {
    const { client, calls } = bridge();
    new PluginCommands(client).mounted(GIT);
    await Promise.resolve();
    expect(calls).toEqual([
      {
        method: "cmd.register",
        caller: "endue.git",
        params: {
          id: "endue.git.state",
          title: "Git: state",
          keywords: ["branch"],
          description: "The branch and the changed files.",
          argsSchema: { type: "object" },
          resultSchema: { type: "object" },
          agent: true,
          readOnly: true,
        },
      },
      {
        method: "cmd.register",
        caller: "endue.git",
        params: { id: "endue.git.open", title: "Git: open" },
      },
    ]);
  });

  it("unregisters them when the plugin goes", async () => {
    const { client, calls } = bridge();
    const commands = new PluginCommands(client);
    commands.mounted(GIT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    commands.unmounted("endue.git");
    const gone = calls.filter((c) => c.method === "cmd.unregister").map((c) => c.params);
    expect(gone).toEqual([{ id: "endue.git.state" }, { id: "endue.git.open" }]);
  });
});
