/**
 * Aliases: a contributed command with `runs` (specs/plugin/v0) is a built-in owned by its plugin, so
 * the desk registers it while that plugin is on and data-only plugins (`view`, `policy`) can offer
 * commands. It runs `runs.command` as the desk, with `runs.args` and the caller's object args merged
 * over them key by key. A UI plugin's command with `runs` is the desk's too (plugin-commands.ts).
 */
import type { CommandCall } from "@endue-ai/bridge";
import type { PolicySet } from "../policy";
import type { DeskContext, Installed } from "./context";

/** The args an alias passes: its own, with the caller's top-level keys over them. */
export function aliasArgs(call: CommandCall, args: unknown): Record<string, unknown> {
  const given =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  return { ...(call.args ?? {}), ...given };
}

export function installAliases(ctx: Pick<DeskContext, "hub">): Installed {
  const { hub } = ctx;
  const { commands } = hub;
  const defined: Array<() => void> = [];
  const undefine = () => {
    for (const off of defined.splice(0)) off();
  };

  const apply = (policy: PolicySet) => {
    undefine();
    for (const command of policy.commands) {
      const { runs } = command;
      // An alias of itself would only call itself.
      if (!runs || runs.command === command.id) continue;
      defined.push(
        commands.define(command.id, {
          title: command.title,
          ...(command.keywords ? { keywords: command.keywords } : {}),
          owner: command.owner,
          run: (args) => commands.run(runs.command, aliasArgs(runs, args)),
        }),
      );
    }
  };
  const off = hub.onPolicy(apply);

  return {
    dispose: () => {
      off();
      undefine();
    },
  };
}
