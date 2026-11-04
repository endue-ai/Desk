/**
 * The browser stub's cmd.list, which checks no grant, and cmd.tools (ADR 0088), as the core answers
 * it: the registered commands marked `agent`, in registration order, that the caller may see (an
 * agent sees every one, as with an empty allowlist; anyone else those its grants cover), narrowed
 * by every word of `query` and cut at `limit` (50). A tool's name is its command id with every dot
 * an underscore.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { CmdRegisterParams, CommandInfo, CommandTool, Permission } from "./generated";
import { starMatch } from "./stub-covers";

export type ToolsServed = "cmd.list" | "cmd.tools";

const NAME_MAX = 64;

interface ToolsDeps {
  commands: Map<string, CommandInfo>;
  /** Whether the caller holds a grant covering `permission`. */
  may(caller: string | undefined, permission: Permission): boolean;
}

/** A command's tool name, when its id fits a brain turn. */
export function toolName(id: string): string | undefined {
  return id.length <= NAME_MAX ? id.replaceAll(".", "_") : undefined;
}

/** cmd.register's rule for agent commands: they need a description. */
export function checkDescribed(params: CmdRegisterParams): void {
  if (params.agent && !params.description)
    throw new StubError(
      "invalid_params",
      `${params.id} is offered to agents without a description`,
    );
}

export function stubTools({ commands, may }: ToolsDeps) {
  const handlers: Required<Pick<StubHandlers, ToolsServed>> = {
    "cmd.list": ({ scope }) => ({
      commands: [...commands.values()].filter((c) => scope.ids.some((p) => starMatch(p, c.id))),
    }),
    "cmd.tools": ({ query, limit = 50 }, caller) => {
      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const agent = (caller ?? "desk").startsWith("agent:");
      const tools: CommandTool[] = [];
      for (const info of commands.values()) {
        if (!info.agent || !info.description) continue;
        const text = [info.id, info.title, info.description, ...(info.keywords ?? [])]
          .join(" ")
          .toLowerCase();
        if (!words.every((word) => text.includes(word))) continue;
        const granted = may(caller, { permission: "cmd:invoke", ids: [info.id] });
        if (!agent && !granted) continue;
        const name = toolName(info.id);
        tools.push({
          ...(name ? { name } : {}),
          command: info.id,
          title: info.title,
          description: info.description,
          ...(info.argsSchema ? { argsSchema: info.argsSchema } : {}),
          ...(info.resultSchema ? { resultSchema: info.resultSchema } : {}),
          ...(info.readOnly ? { readOnly: true } : {}),
          ...(info.irreversible ? { irreversible: true } : {}),
          provider: info.provider,
          granted,
        });
      }
      return { tools: structuredClone(tools.slice(0, limit)) };
    },
  };
  return { handlers };
}
