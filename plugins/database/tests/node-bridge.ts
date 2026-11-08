// The core's proc.* played by Node's child_process, so the live tests run the real clients the way
// the desk runs them: no shell, extra environment over the inherited one, a missing program is
// not_found at once, output and the exit as events by process id, signals by name.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { BridgeEvent } from "../../../packages/bridge/src/index";

type Listener = (event: BridgeEvent) => void;
const SIGNALS = { int: "SIGINT", kill: "SIGKILL", term: "SIGTERM", hup: "SIGHUP" } as const;

/** Whether `command` is a program on `path`. */
function found(command: string, path: string) {
  if (command.includes("/")) return true;
  return path.split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function nodeBridge() {
  const listeners = new Set<Listener>();
  const children = new Map<string, ChildProcess>();
  let n = 0;
  const emit = (event: BridgeEvent) => {
    for (const listener of listeners) listener(event);
  };
  const call = async (method: string, params: Record<string, unknown>): Promise<never> => {
    if (method === "proc.spawn") {
      const env = { ...process.env, ...(params.env as Record<string, string>) };
      const command = params.command as string;
      if (!found(command, env.PATH ?? ""))
        throw Object.assign(new Error("no such program"), { code: "not_found" });
      const procId = `p-${++n}`;
      const cwd =
        typeof params.cwd === "string" ? params.cwd.replace(/^~(?=\/|$)/u, homedir()) : homedir();
      const child = spawn(command, (params.args as string[]) ?? [], { cwd, env, stdio: "pipe" });
      children.set(procId, child);
      const forward = (stream: "stdout" | "stderr") => (chunk: Buffer) =>
        emit({
          event: "proc.output",
          data: { procId, stream, data: chunk.toString("base64"), encoding: "base64" },
        });
      child.stdout?.on("data", forward("stdout"));
      child.stderr?.on("data", forward("stderr"));
      child.on("close", (code, signal) => {
        children.delete(procId);
        const name = Object.entries(SIGNALS).find(([, s]) => s === signal)?.[0];
        emit({
          event: "proc.exit",
          data: { procId, code, ...(name ? { signal: name } : {}) },
        } as BridgeEvent);
      });
      return { procId, pid: child.pid ?? 0 } as never;
    }
    if (method === "proc.kill") {
      children
        .get(params.procId as string)
        ?.kill(SIGNALS[(params.signal as keyof typeof SIGNALS) ?? "term"]);
      return {} as never;
    }
    if (method === "perm.request") return { granted: true } as never;
    throw Object.assign(new Error(`${method} is not served here`), { code: "unsupported" });
  };
  return {
    call: call as never as (method: string, params: unknown) => Promise<never>,
    onEvent(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The version a client's `--version` prints, or undefined when it does not run. */
export function clientVersion(command: string): string | undefined {
  const out = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (out.status !== 0) return undefined;
  return out.stdout.trim().split("\n")[0];
}
