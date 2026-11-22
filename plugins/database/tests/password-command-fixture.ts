// A scripted password command behind proc.spawn (PG-14): each spawn answers the next of `replies`
// (the last one again once they run out) as the core's proc.* events, and is recorded with the
// program, its arguments and the scope it was asked under. A PostgreSQL connection that names it.
import type { TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { Connection } from "../ui/engines/common.js";
import type { Handlers } from "./harness";
import { PG } from "./session-helpers";

export type Reply = { stdout?: string; stderr?: string; code?: number };
export type Spawn = { command: string; args: string[]; scope: unknown };

export const COMMAND = '/opt/tokens/db-token --user app --label "shop db"';
export const ARGV = ["--user", "app", "--label", "shop db"];
export const TOKENS = { conn: { ...PG, passwordCommand: COMMAND } as Connection };

export function scriptedHelper(replies: Reply[]) {
  let host: TestHost | undefined;
  const spawned: Spawn[] = [];
  const handlers: Handlers = {
    "proc.spawn": (params) => {
      spawned.push({ command: params.command, args: params.args ?? [], scope: params.scope });
      const procId = `h-${spawned.length}`;
      const reply = replies[Math.min(spawned.length, replies.length) - 1] ?? {};
      setTimeout(() => {
        for (const stream of ["stdout", "stderr"] as const) {
          const data = reply[stream];
          if (data)
            host?.emit({ event: "proc.output", data: { procId, stream, data, encoding: "utf8" } });
        }
        host?.emit({ event: "proc.exit", data: { procId, code: reply.code ?? 0 } });
      }, 1);
      return { procId, pid: 4000 + spawned.length };
    },
    "proc.kill": () => ({}),
  };
  const attach = (h: TestHost) => {
    host = h;
  };
  return { handlers, spawned, attach };
}
