/** The desk's undo stack and the runs shown by Fleet. */
import type { BridgeClient, RunState } from "@endue-ai/bridge";
import { WORKSPACE_TOOLS } from "../agent-specs";
import type { Commands } from "../commands";

export function installWorkspaceTools(commands: Commands, bridge: BridgeClient): void {
  for (const [id, method, title, agent] of [
    ["desk.undo", "cmd.undo", "Undo the last desk action", WORKSPACE_TOOLS.undo],
    ["desk.redo", "cmd.redo", "Redo the last desk action", WORKSPACE_TOOLS.redo],
  ] as const) {
    commands.define(id, {
      owner: "desk",
      title,
      agent,
      run: async () => {
        const entry = await commands.stack(method);
        return entry ? { command: entry.command, inverse: entry.inverse } : null;
      },
    });
  }
  commands.define("desk.runs.list", {
    owner: "desk",
    title: "List agent runs",
    agent: WORKSPACE_TOOLS.runs,
    run: async (args) => {
      const state = (args as { state?: RunState } | undefined)?.state;
      const { items } = await bridge.call("data.query", {
        scope: { permission: "data:read", kinds: ["run"] },
        query: {
          kinds: ["run"],
          limit: 100,
          sort: [{ field: "startedAt", dir: "desc" }],
          ...(state ? { where: [{ field: "state", op: "eq", value: state }] } : {}),
        },
      });
      return {
        runs: items.flatMap((item) => {
          if (item.kind !== "run") return [];
          const { id, source, title, agent, state, startedAt, endedAt, command, result } = item;
          return [
            {
              id,
              source,
              title,
              agent,
              state,
              startedAt,
              ...(endedAt ? { endedAt } : {}),
              ...(command ? { command } : {}),
              ...(result ? { result } : {}),
            },
          ];
        }),
      };
    },
  });
}
