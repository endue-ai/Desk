/**
 * The browser stub's log, as the core keeps it (specs/bridge/v0/README.md): log.write adds an entry to
 * the caller's own channel, stamped by the core's clock, and log.tail, under `log:read`, returns the
 * latest entries of one channel or of all, oldest first.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { BridgeEvent, LogEntry, Permission } from "./generated";

export type LogServed = "log.write" | "log.tail";

export const LOG: Permission = { permission: "log:read" };

interface LogDeps {
  log: LogEntry[];
  now(): string;
  me(caller: string | undefined): string;
  later(event: BridgeEvent): void;
  check(caller: string | undefined, scope: Permission): void;
}

export function stubLog(deps: LogDeps): Required<Pick<StubHandlers, LogServed>> {
  const { log, now, me, later, check } = deps;
  return {
    "log.write": ({ level, message, fields }, caller) => {
      const entry: LogEntry = { at: now(), channel: me(caller), level, message };
      if (fields) entry.fields = structuredClone(fields);
      log.push(structuredClone(entry));
      later({ event: "log.entry", data: entry });
      return {};
    },
    "log.tail": ({ channel, count = 100, scope }, caller) => {
      if (!Number.isInteger(count) || count < 1 || count > 1000)
        throw new StubError("invalid_params", `count is ${count}; it must be 1 to 1000`);
      check(caller, scope ?? LOG);
      const entries = log.filter((e) => (channel ?? e.channel) === e.channel);
      return { entries: structuredClone(entries.slice(-count)) };
    },
  };
}
