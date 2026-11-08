// An executor whose client is scripted: the fake sqlite3 and psql of the harness answer in their
// real protocol, so a test sees exactly what a run would send (the invocation) and get back,
// without the bridge or the SDK host. The real ones: realProcs serves proc.* with Node's processes.
import type { Connection } from "../ui/engines/common.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { type Handlers, psqlRun, type Script, sqliteRun } from "./harness";
import { nodeBridge } from "./node-bridge";

export interface Ran {
  command: string;
  args: string[];
}

export function scriptedExecutor(
  script: Script,
  options: { confirm?: () => boolean; asked?: string[] } = {},
) {
  const ran: Ran[] = [];
  const runner = {
    run: async (invocation: { command: string; args: string[]; env: Record<string, string> }) => {
      ran.push({ command: invocation.command, args: invocation.args });
      const reply =
        invocation.command === "psql"
          ? psqlRun(invocation.args, script, invocation.env)
          : sqliteRun(invocation.args, script, invocation.env);
      return {
        code: reply.code,
        signal: null,
        stdout: reply.stdout,
        stderr: reply.stderr,
        stopped: false,
        cancelled: false,
        timedOut: false,
        overflow: false,
        ms: 3,
      };
    },
  };
  const clients = {
    get: async (engine: string) =>
      engine === "postgresql"
        ? { command: "psql", flavor: "postgresql" as const, version: "17.6" }
        : { command: "sqlite3", flavor: "sqlite" as const, version: "3.50.6" },
  };
  const settings = fromValues({});
  const executor = createExecutor({
    runner: runner as never,
    clients,
    settings: () => settings,
    confirm: async (title: string) => {
      options.asked?.push(title);
      return options.confirm?.() ?? true;
    },
    passwords: { get: () => undefined, set: () => {}, ask: async () => undefined },
    cancelled: (message) => Object.assign(new Error(message), { code: "cancelled" }),
  });
  return { execute: executor.execute, ran };
}

/** proc.spawn and proc.kill served by real processes, their events sent to the host. */
export function realProcs(): { handlers: Handlers; attach(emit: (event: never) => void): void } {
  const bridge = nodeBridge();
  return {
    handlers: {
      "proc.spawn": (params) => bridge.call("proc.spawn", params),
      "proc.kill": (params) => bridge.call("proc.kill", params),
    },
    attach: (emit) => {
      bridge.onEvent((event) => emit(event as never));
    },
  };
}

export const lite = (fields: Partial<Connection> = {}): Connection => ({
  id: "c-lite",
  name: "Notes",
  engine: "sqlite",
  host: "",
  port: null,
  database: "",
  user: "",
  ssl: "default",
  sslCa: "",
  file: "/tmp/notes.db",
  tag: "none",
  readOnly: false,
  ...fields,
});
