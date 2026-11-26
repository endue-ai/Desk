/**
 * The desk registers a plugin's `runs` aliases while it is on. Agent aliases can also open a
 * dormant built-in that is set to autoload. Forwarding preserves the agent's identity and the
 * preset arguments. Palette callers can still supply overrides.
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
    const aliases = [...policy.commands];
    for (const plugin of hub.plugins) {
      if (!plugin.builtIn || plugin.enabled || plugin.status !== "ready" || !plugin.autoStart)
        continue;
      for (const command of plugin.manifest?.contributes?.commands ?? []) {
        if (command.agent && command.runs && command.id.startsWith(`${plugin.id}.`))
          aliases.push({ ...command, owner: "desk" });
      }
    }
    const targets = new Map(aliases.flatMap(({ id, runs }) => (runs ? [[id, runs.command]] : [])));
    const loops = (id: string) => {
      const seen = new Set<string>();
      let target = targets.get(id);
      while (target !== undefined) {
        if (seen.has(target)) return true;
        seen.add(target);
        target = targets.get(target);
      }
      return false;
    };
    for (const command of aliases) {
      const { runs } = command;
      if (!runs || loops(command.id)) continue;
      defined.push(
        commands.define(command.id, {
          title: command.title,
          ...(command.keywords ? { keywords: command.keywords } : {}),
          owner: command.owner,
          ...(command.description ? { description: command.description } : {}),
          ...(command.args ? { argsSchema: command.args } : {}),
          ...(command.result ? { resultSchema: command.result } : {}),
          ...(command.irreversible ? { irreversible: true } : {}),
          ...(command.agent
            ? {
                agent: {
                  description: command.description ?? command.title,
                  ...(command.readOnly ? { readOnly: true } : {}),
                },
              }
            : {}),
          run: (args, { caller }) => {
            const forwarded = caller?.startsWith("agent:") ? caller : undefined;
            const merged = aliasArgs(runs, args);
            return commands.run(
              runs.command,
              forwarded ? { ...merged, ...runs.args } : merged,
              forwarded,
            );
          },
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
