// An executor whose clients are scripted: the fake sqlite3 of the harness answers in its real
// protocol and PostgreSQL runs on sessions of the scripted server (db.*), so a test sees exactly what
// a run would send (the invocation, or each session's statements as `db`) and get back, without the
// SDK host. The real ones: realProcs serves proc.* with Node's processes and db.* with the desk core.
import type { Connection } from "../ui/engines/common.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { type Handlers, type Script, scriptedDb, sessionsOf, sqliteRun } from "./harness";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { dbBridge } from "./pg-host";

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
      const reply = sqliteRun(invocation.args, script, invocation.env);
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
    get: async () => ({ command: "sqlite3", flavor: "sqlite" as const, version: "3.50.6" }),
  };
  const grants = [{ permission: "db:connect" as const, hosts: ["*"] }];
  const db = dbBridge(scriptedDb(script), { grants });
  const settings = fromValues({});
  const executor = createExecutor({
    runner: runner as never,
    output: inProcessOutput(),
    clients,
    sessions: createSessions(db.bridge),
    settings: () => settings,
    confirm: async (title: string) => {
      options.asked?.push(title);
      return options.confirm?.() ?? true;
    },
    passwords: { get: () => undefined, set: () => {}, ask: async () => undefined },
    cancelled: (message) => Object.assign(new Error(message), { code: "cancelled" }),
  });
  /** Each PostgreSQL run's session joins `ran` as `db` with its statements, once it is done. */
  const execute: typeof executor.execute = async (conn, sql, opts) => {
    const before = sessionsOf(db.calls).length;
    try {
      return await executor.execute(conn, sql, opts);
    } finally {
      for (const args of sessionsOf(db.calls).slice(before)) ran.push({ command: "db", args });
    }
  };
  return { execute, ran };
}

/** proc.spawn and proc.kill served by real processes, db.* by the desk core, their events sent to
 * the host. */
/**
 * The real proc.* and db.*; `password` signs a db.open in that has none, as the person's typed one
 * would, never through the store.
 */
export function realProcs(options: { password?: string } = {}): {
  handlers: Handlers;
  attach(emit: (event: never) => void): void;
} {
  const bridge = nodeBridge();
  const signed = (name: string, params: Record<string, unknown>) =>
    name === "open" && options.password && params.password === undefined
      ? { ...params, password: options.password }
      : params;
  const db = ["open", "run", "script", "fetch", "copy", "cancel", "close", "list"].map((name) => [
    `db.${name}`,
    (params: Record<string, unknown>) => bridge.call(`db.${name}`, signed(name, params)),
  ]);
  return {
    handlers: {
      "proc.spawn": (params) => bridge.call("proc.spawn", params),
      "proc.kill": (params) => bridge.call("proc.kill", params),
      ...(Object.fromEntries(db) as Handlers),
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
