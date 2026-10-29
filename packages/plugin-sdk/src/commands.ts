// ctx.commands: the plugin's side of the core's command registry (bridge cmd.*, ADR 0017). `run`
// is cmd.invoke and waits for cmd.answered; `list` is cmd.list; `on` answers this plugin's commands
// when cmd.invoked arrives (with cmd.answer), and the desk's requests to it (desk.files.visit, ...).
import type { BridgeEvent, CmdAnsweredData, ParamsOf } from "@endue-ai/bridge";
import type { CommandOutcome } from "./protocol";

/** A registered command, as `ctx.commands.list()` returns it. */
export interface CommandInfo {
  id: string;
  title: string;
  keywords: string[];
  /** The caller that provides it: `desk` for the desk's built-ins, else a plugin id. */
  provider: string;
  description?: string;
}

/** A command that failed: unknown_command, failed or cancelled. */
export class CommandFailed extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(`${name}: ${code}: ${message}`);
    this.name = "CommandFailed";
    this.code = code;
  }
}

export interface PluginCommands {
  /** Answer a command this plugin provides, or a request the desk sends it, by name. */
  on(name: string, handler: (args: unknown) => unknown): () => void;
  /** Run any registered command (needs a `cmd:invoke` grant covering it) and get its answer. */
  run<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  list(): Promise<CommandInfo[]>;
}

/** The bridge calls the commands need, as the plugin makes them. */
interface Calls {
  call(method: "cmd.invoke", params: ParamsOf<"cmd.invoke">): Promise<{ invocationId: string }>;
  call(
    method: "cmd.list",
    params: ParamsOf<"cmd.list">,
  ): Promise<{
    commands: Array<{
      id: string;
      title: string;
      keywords?: string[];
      provider: string;
      description?: string;
    }>;
  }>;
  call(method: "cmd.answer", params: ParamsOf<"cmd.answer">): Promise<unknown>;
}

type Outcome = Omit<CommandOutcome, "call">;

export function commandsFor(
  bridge: Calls,
  /** Resolves once the plugin has mounted: commands that arrive earlier wait for their handler. */
  mounted: Promise<void>,
) {
  const handlers = new Map<string, Set<(args: unknown) => unknown>>();
  const waiting = new Map<string, (data: CmdAnsweredData) => void>();
  const early = new Map<string, CmdAnsweredData>();

  const handle = async (name: string, args: unknown): Promise<Outcome> => {
    if (!handlers.get(name)?.size) await mounted;
    const own = [...(handlers.get(name) ?? [])];
    try {
      if (own.length === 0) throw new CommandFailed(name, "unknown_command", "no handler");
      const results = await Promise.all(own.map((handler) => handler(args)));
      return { ok: true, result: results[0] };
    } catch (error) {
      const code = error instanceof CommandFailed ? error.code : "failed";
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code, message } };
    }
  };

  const answered = (name: string, data: CmdAnsweredData) => {
    if (data.ok) return data.result;
    throw new CommandFailed(name, data.error?.code ?? "failed", data.error?.message ?? "");
  };

  const api: PluginCommands = {
    on: (name, handler) => {
      const set = handlers.get(name) ?? new Set();
      set.add(handler);
      handlers.set(name, set);
      return () => set.delete(handler);
    },
    run: async <T>(name: string, args?: Record<string, unknown>) => {
      let invocationId: string;
      try {
        ({ invocationId } = await bridge.call("cmd.invoke", {
          id: name,
          ...(args ? { args } : {}),
          scope: { permission: "cmd:invoke", ids: [name] },
        }));
      } catch (error) {
        const code = (error as { code?: string }).code;
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandFailed(
          name,
          code === "not_found" ? "unknown_command" : (code ?? "failed"),
          message,
        );
      }
      const data =
        early.get(invocationId) ??
        (await new Promise<CmdAnsweredData>((resolve) => waiting.set(invocationId, resolve)));
      early.delete(invocationId);
      return answered(name, data) as T;
    },
    list: async () => {
      const { commands } = await bridge.call("cmd.list", {
        scope: { permission: "cmd:invoke", ids: ["*"] },
      });
      return commands.map((c) => ({
        id: c.id,
        title: c.title,
        keywords: c.keywords ?? [],
        provider: c.provider,
        ...(c.description ? { description: c.description } : {}),
      }));
    },
  };

  return {
    api,
    /** A request the desk sent by name; with a call id, the answer goes back with it. */
    request: (name: string, args: unknown) => handle(name, args),
    /** cmd.invoked for this plugin's commands, cmd.answered for its runs. */
    event: (event: BridgeEvent) => {
      if (event.event === "cmd.invoked") {
        const { invocationId, id, args } = event.data;
        void handle(id, args ?? {}).then((outcome) => {
          const params = outcome.ok
            ? { invocationId, ...(outcome.result === undefined ? {} : { result: outcome.result }) }
            : {
                invocationId,
                error: {
                  code:
                    outcome.error?.code === "cancelled"
                      ? ("cancelled" as const)
                      : ("failed" as const),
                  message: outcome.error?.message ?? "failed",
                },
              };
          return bridge.call("cmd.answer", params).catch(() => {});
        });
      } else if (event.event === "cmd.answered") {
        const resolve = waiting.get(event.data.invocationId);
        if (resolve) {
          waiting.delete(event.data.invocationId);
          resolve(event.data);
        } else {
          early.set(event.data.invocationId, event.data);
        }
      }
    },
  };
}
