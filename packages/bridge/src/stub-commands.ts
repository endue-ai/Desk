/**
 * The core's command registry (cmd.*, ADR 0017) for the browser stub, so the runtime and plugins can
 * be tested without the core. It keeps the core's rules: a command belongs to the caller that
 * registered it, the provider hears cmd.invoked and its cmd.answer reaches the caller as
 * cmd.answered. It checks no grants: the stub trusts every caller.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { BridgeEvent, CommandFailure, CommandInfo } from "./generated";

type CmdMethods = "cmd.register" | "cmd.unregister" | "cmd.list" | "cmd.invoke" | "cmd.answer";

export interface StubCommands {
  handlers: Pick<StubHandlers, CmdMethods>;
  /** The caller providing a command, or undefined. */
  providerOf(id: string): string | undefined;
  /** A provider stopped: its commands go and its waiting invocations are cancelled. */
  drop(provider: string): void;
}

/** `*` matches any run of characters, dots included. */
function starMatch(pattern: string, text: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(text);
}

/** `emit` delivers an event as the core would (the stub's `emit`); events leave after the answer. */
export function stubCommands(emit: (event: BridgeEvent) => void): StubCommands {
  const commands = new Map<string, CommandInfo>();
  const pending = new Map<string, { id: string; caller: string; provider: string }>();
  let next = 0;
  const later = (event: BridgeEvent) => queueMicrotask(() => emit(event));
  const me = (caller: string | undefined) => caller ?? "desk";

  const answered = (
    invocationId: string,
    result: unknown,
    error: CommandFailure | undefined,
  ): void => {
    const invocation = pending.get(invocationId);
    if (!invocation) return;
    pending.delete(invocationId);
    later({
      event: "cmd.answered",
      data: {
        invocationId,
        id: invocation.id,
        caller: invocation.caller,
        ok: error === undefined,
        ...(error ? { error } : result === undefined ? {} : { result }),
      },
    });
  };

  const remove = (id: string) => {
    const info = commands.get(id);
    if (!info) return;
    commands.delete(id);
    later({ event: "cmd.changed", data: { id, change: "unregistered", provider: info.provider } });
  };

  return {
    providerOf: (id) => commands.get(id)?.provider,
    drop: (provider) => {
      for (const info of [...commands.values()]) if (info.provider === provider) remove(info.id);
      for (const [invocationId, invocation] of [...pending]) {
        if (invocation.provider !== provider) continue;
        answered(invocationId, undefined, {
          code: "cancelled",
          message: `${provider} stopped before it answered`,
        });
      }
    },
    handlers: {
      "cmd.register": (params, caller) => {
        const provider = me(caller);
        const existing = commands.get(params.id);
        if (existing && existing.provider !== provider)
          throw new StubError("already_exists", `${params.id} is provided by ${existing.provider}`);
        commands.set(params.id, { ...params, provider });
        const change = existing ? "updated" : "registered";
        later({ event: "cmd.changed", data: { id: params.id, change, provider } });
        return {};
      },
      "cmd.unregister": ({ id }, caller) => {
        if (commands.get(id)?.provider !== me(caller))
          throw new StubError("not_found", `${me(caller)} provides no command ${id}`);
        remove(id);
        return {};
      },
      "cmd.list": ({ scope }) => ({
        commands: [...commands.values()].filter((c) => scope.ids.some((p) => starMatch(p, c.id))),
      }),
      "cmd.invoke": ({ id, args }, caller) => {
        const info = commands.get(id);
        if (!info) throw new StubError("not_found", `no command ${id}`);
        const invocationId = `i-${++next}`;
        pending.set(invocationId, { id, caller: me(caller), provider: info.provider });
        later({
          event: "cmd.invoked",
          data: { invocationId, id, caller: me(caller), ...(args ? { args } : {}) },
        });
        return { invocationId };
      },
      "cmd.answer": ({ invocationId, result, error }, caller) => {
        if (pending.get(invocationId)?.provider !== me(caller))
          throw new StubError("not_found", `${me(caller)} has no invocation ${invocationId}`);
        answered(invocationId, result, error);
        return {};
      },
    },
  };
}
