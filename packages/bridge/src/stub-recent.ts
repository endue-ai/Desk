/**
 * The browser stub's cmd.recent and plugin.stats, as the core keeps them (specs/bridge/v0/README.md):
 * the last 200 invocations with their caller, provider and duration on the stub's clock, and the
 * calls each caller made over the last minute, counted by `observe` (browserStub's observer). Both
 * need perm:manage.
 */
import type { StubHandlers } from "./adapters";
import type { CallerStats, CommandFailureCode, CommandInvocation, Permission } from "./generated";

export type RecentServed = "cmd.recent" | "plugin.stats";

const KEPT = 200;
const WINDOW_MS = 60_000;

interface RecentDeps {
  now(): string;
  me(caller: string | undefined): string;
  check(caller: string | undefined, scope: Permission): void;
}

/** A waiting invocation as the registry keeps it. */
export interface Pending {
  id: string;
  caller: string;
  provider: string;
}

export function stubRecent({ now, me, check }: RecentDeps) {
  const invocations: CommandInvocation[] = [];
  const calls: Array<{ caller: string; at: number; ok: boolean }> = [];
  const since = (at: string) => Math.max(0, Date.parse(now()) - Date.parse(at));
  const handlers: Required<Pick<StubHandlers, RecentServed>> = {
    "cmd.recent": ({ scope }, caller) => {
      check(caller, scope);
      return { invocations: structuredClone(invocations) };
    },
    "plugin.stats": ({ scope }, caller) => {
      check(caller, scope);
      const from = Date.parse(now()) - WINDOW_MS;
      const by = new Map<string, CallerStats>();
      for (const call of calls.filter((c) => c.at > from)) {
        const stats = by.get(call.caller) ?? { caller: call.caller, calls: 0, failed: 0 };
        stats.calls++;
        if (!call.ok) stats.failed++;
        by.set(call.caller, stats);
      }
      const callers = [...by.values()].sort(
        (a, b) => b.calls - a.calls || (a.caller < b.caller ? -1 : a.caller > b.caller ? 1 : 0),
      );
      return { windowSeconds: WINDOW_MS / 1000, callers };
    },
  };
  return {
    handlers,
    /** cmd.invoke handed a command to its provider: noted as waiting; the invocation to keep. */
    invoked(invocationId: string, id: string, caller: string, provider: string): Pending {
      invocations.push({ invocationId, id, caller, provider, at: now() });
      if (invocations.length > KEPT) invocations.shift();
      return { id, caller, provider };
    },
    /** An invocation was answered, with a result or the failure's code. */
    answered(invocationId: string, error?: CommandFailureCode): void {
      const noted = invocations.findLast((i) => i.invocationId === invocationId);
      if (!noted) return;
      noted.durationMs = since(noted.at);
      noted.ok = error === undefined;
      if (error) noted.error = error;
    },
    /** A call the stub answered, for plugin.stats; older than the window is forgotten. */
    observe(caller: string | undefined, ok: boolean): void {
      const at = Date.parse(now());
      while (calls.length > 0 && (calls[0]?.at ?? at) <= at - WINDOW_MS) calls.shift();
      calls.push({ caller: me(caller), at, ok });
    },
  };
}
