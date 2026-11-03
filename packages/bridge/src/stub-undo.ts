/**
 * The stub's undo stack (ADR 0077), one for the desk as the core keeps it: an ok answer of a command
 * that names an `undo` lands on it, and so does a write that kept a version (stub-history.ts);
 * cmd.undo runs the newest entry's inverse with `{ args, result }` (a write: restores its version)
 * and cmd.redo runs it again. A new entry clears what is left to redo; 200 entries at most.
 */
import type { StubHandlers } from "./adapters";
import type { BridgeEvent, CmdInvokePermission, Permission, UndoEntry } from "./generated";
import { starMatch } from "./stub-covers";

export type UndoServed = "cmd.undo" | "cmd.redo";
/** Why an invocation runs: asked for, or the stack's inverse or redo. */
export type InvocationKind = "command" | "undo" | "redo";

/** An invocation as the registry keeps it until its answer. */
export interface Invoked {
  id: string;
  caller: string;
  args?: Record<string, unknown>;
  undo?: string;
  kind: InvocationKind;
}

interface Host {
  /** The stub's grant check: permission_denied unless a grant covers `scope` and it `fits`. */
  check(caller: string | undefined, scope: Permission, fits: boolean): void;
  later(event: BridgeEvent): void;
  now(): string;
  me(caller: string | undefined): string;
  /** Invoke a command as the registry does; answers the invocation id. */
  invoke(
    caller: string | undefined,
    id: string,
    args: Record<string, unknown> | undefined,
    kind: InvocationKind,
  ): string;
  /** Restore a version of a file the stub holds; answers the version that keeps what it replaced. */
  restore(path: string, version: string): Promise<string | undefined>;
}

const MAX = 200;
const RESTORE = "fs.restore";
const isWrite = (e: UndoEntry) =>
  e.inverse === RESTORE && (e.command === "fs.write" || e.command === "fs.restore");
const field = (value: unknown, key: string) =>
  value && typeof value === "object" ? String((value as Record<string, unknown>)[key] ?? "") : "";
const covers = (scope: CmdInvokePermission, id: string) =>
  scope.ids.some((pattern) => starMatch(pattern, id));

export function stubUndo(host: Host) {
  const undo: UndoEntry[] = [];
  const redo: UndoEntry[] = [];
  /** Set while the stack restores a write itself, which pushes nothing. */
  let replaying = false;

  const push = (entry: UndoEntry, clearRedo: boolean) => {
    if (clearRedo) redo.length = 0;
    undo.push(entry);
    while (undo.length > MAX) undo.shift();
  };
  const entry = (
    command: string,
    args: Record<string, unknown> | undefined,
    result: unknown,
    caller: string,
    inverse: string,
  ): UndoEntry => ({
    command,
    ...(args ? { args } : {}),
    ...(result === undefined ? {} : { result }),
    caller,
    at: host.now(),
    inverse,
  });
  const restore = async (e: UndoEntry) => {
    replaying = true;
    try {
      return await host.restore(field(e.args, "path"), field(e.result, "version"));
    } finally {
      replaying = false;
    }
  };
  const withVersion = (e: UndoEntry, version: string): UndoEntry => ({ ...e, result: { version } });
  const done = (caller: string | undefined, e: UndoEntry, isRedo: boolean) =>
    host.later({ event: "cmd.undone", data: { entry: e, by: host.me(caller), redo: isRedo } });

  const handlers: Required<Pick<StubHandlers, UndoServed>> = {
    "cmd.undo": async ({ scope }, caller) => {
      const top = undo.at(-1);
      if (!top) return {};
      host.check(caller, scope, covers(scope, top.inverse));
      undo.pop();
      try {
        if (isWrite(top)) {
          const kept = await restore(top);
          if (kept) redo.push(withVersion(top, kept));
          done(caller, top, false);
          return { undone: top };
        }
        const args = { args: top.args ?? {}, result: top.result ?? null };
        const invocationId = host.invoke(caller, top.inverse, args, "undo");
        redo.push(top);
        done(caller, top, false);
        return { undone: top, invocationId };
      } catch (error) {
        undo.push(top);
        throw error;
      }
    },
    "cmd.redo": async ({ scope }, caller) => {
      const top = redo.at(-1);
      if (!top) return {};
      host.check(caller, scope, covers(scope, isWrite(top) ? RESTORE : top.command));
      redo.pop();
      try {
        if (isWrite(top)) {
          const kept = await restore(top);
          if (kept) push(withVersion(top, kept), false);
          done(caller, top, true);
          return { undone: top };
        }
        const invocationId = host.invoke(caller, top.command, top.args, "redo");
        done(caller, top, true);
        return { undone: top, invocationId };
      } catch (error) {
        redo.push(top);
        throw error;
      }
    },
  };

  return {
    handlers,
    /** An invocation was answered: an ok answer of an undoable command, not an inverse, lands. */
    answered(invoked: Invoked, result: unknown, ok: boolean) {
      if (!ok || !invoked.undo || invoked.kind === "undo") return;
      const e = entry(invoked.id, invoked.args, result, invoked.caller, invoked.undo);
      push(e, invoked.kind === "command");
    },
    /** A write over a file kept `version` (fs.write or fs.restore). */
    wrote(caller: string, command: string, path: string, version: string) {
      if (!replaying) push(entry(command, { path }, { version }, caller, RESTORE), true);
    },
  };
}
