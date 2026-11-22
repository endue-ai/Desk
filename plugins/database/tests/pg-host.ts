// The plugin's bridge over the stub's copy of the core with a scripted database server (db.*, ADR
// 0281), for tests of the PostgreSQL sessions without the SDK host: every call the plugin made, its
// db.* events, grants asked for with perm.request and answered by `prompt`, and fs.* over `files`.
// The executor on it runs PostgreSQL as the plugin does (engines/pg-session.js).
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type Permission,
  type PermPromptData,
  type StubDatabase,
  type StubFiles,
  stubCommands,
} from "../../../packages/bridge/src/index";
import { createSessions } from "../ui/engines/pg-session.js";
import type { Passphrases } from "../ui/engines/pg-tls.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import type { createTunnel } from "../ui/tunnel/open.js";
import { runsOf } from "./runs-of";

export const ME = "endue.database";

export interface Call {
  method: string;
  params: Record<string, unknown>;
}

export function dbBridge(
  db: StubDatabase,
  options: {
    grants?: Permission[];
    prompt?: (data: PermPromptData) => boolean;
    files?: StubFiles;
  } = {},
) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const core = stubCommands(
    (event) => {
      if (core.audience(event).includes(ME)) for (const listener of listeners) listener(event);
    },
    {
      grants: { [ME]: options.grants ?? [] },
      db,
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.files ? { files: options.files } : {}),
    },
  );
  const client = new BridgeClient(browserStub(core.handlers));
  const calls: Call[] = [];
  const bridge = {
    call: (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params: structuredClone(params) });
      return client.call(method as never, params as never, { caller: ME });
    },
    onEvent: (listener: (event: BridgeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { bridge: bridge as never, calls, core };
}

/** The executor over db.*: PostgreSQL runs on sessions; nothing else is served. */
export function sessionExecutor(
  db: StubDatabase,
  options: {
    grants?: Permission[];
    settings?: Record<string, unknown>;
    password?: () => string | undefined;
    typed?: string;
    files?: StubFiles;
    prompt?: (data: PermPromptData) => boolean;
    passphrases?: Passphrases;
    tunnel?: ReturnType<typeof createTunnel>;
  } = {},
) {
  const { bridge, calls, core } = dbBridge(db, options);
  const sessions = createSessions(bridge, {
    ...(options.passphrases ? { passphrases: options.passphrases } : {}),
    ...(options.tunnel ? { tunnel: options.tunnel } : {}),
  });
  const settings = fromValues(options.settings ?? {});
  const asked: string[] = [];
  const kept: string[] = [];
  const unused = async () => {
    throw new Error("PostgreSQL runs no client program");
  };
  const executor = createExecutor({
    runner: { run: unused },
    output: { read: unused },
    clients: { get: unused },
    sessions,
    settings: () => settings,
    confirm: async () => true,
    passwords: {
      get: () => options.password?.(),
      set: (_id, value) => void kept.push(value),
      ask: async (_conn, why) => {
        asked.push(why);
        return options.typed;
      },
    },
    cancelled: (message) => Object.assign(new Error(message), { code: "cancelled" }),
  });
  /** Every call of `method`, in order. */
  const made = (method: string) =>
    (method === "db.run" ? runsOf(calls) : calls)
      .filter((c) => c.method === method)
      .map((c) => c.params);
  return { execute: executor.execute, sessions, calls, made, core, asked, kept };
}
