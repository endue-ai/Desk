// db.* served by the desk core itself for the live tests: crates/desk-core/examples/db-bridge.rs runs
// Core::handle as the plugin (holding db:connect on `*`) and speaks bridge requests, answers and the
// plugin's db.* events as JSON lines, so a live test's PostgreSQL goes through the core's sessions
// (desk-pg, ADR 0281) exactly as the desk's does. Built with cargo once per run of the tests.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { BridgeEvent, DbOpenResult, DbPage } from "../../../packages/bridge/src/index";
import { parseUri } from "../ui/connections.js";

const root = join(import.meta.dirname, "../../..");
let built: string | undefined;

/** Build the test bridge (a no-op when it is up to date) and answer its path. */
export function buildCoreBridge(): string {
  if (built) return built;
  const cargo = spawnSync(
    "cargo",
    ["build", "-q", "-p", "desk-core", "--example", "db-bridge", "--message-format=json"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (cargo.status !== 0) throw new Error(`cargo build of db-bridge failed:\n${cargo.stderr}`);
  for (const line of cargo.stdout.split("\n")) {
    if (!line.includes('"executable"')) continue;
    const message = JSON.parse(line) as { target?: { name?: string }; executable?: string | null };
    if (message.target?.name === "db-bridge" && message.executable) built = message.executable;
  }
  if (!built) throw new Error("cargo built db-bridge but named no executable");
  return built;
}

type Listener = (event: BridgeEvent) => void;
type Waiter = { resolve(value: unknown): void; reject(error: unknown): void };

/** One core for this test file; `home` is its home (a `.pgpass` there is the password file). */
export function coreBridge(home = mkdtempSync(join(tmpdir(), "endue-db-core-"))) {
  const listeners = new Set<Listener>();
  const waiting = new Map<number, Waiter>();
  let child: ChildProcess | undefined;
  let next = 0;
  const started = () => {
    if (child) return child;
    const fresh = spawn(buildCoreBridge(), ["endue.database", home], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    createInterface({ input: fresh.stdout as NodeJS.ReadableStream }).on("line", (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if ("event" in message) {
        for (const listener of listeners) listener(message as unknown as BridgeEvent);
        return;
      }
      const waiter = waiting.get(message.id as number);
      waiting.delete(message.id as number);
      if (message.ok) waiter?.resolve(message.result);
      else {
        const { code, message: text } = message.error as { code: string; message: string };
        waiter?.reject(Object.assign(new Error(text), { code }));
      }
    });
    fresh.on("exit", () => {
      for (const waiter of waiting.values()) waiter.reject(new Error("the core bridge ended"));
      waiting.clear();
      child = undefined;
    });
    // Its standard input closing ends it, also when this process ends without closing it.
    fresh.unref();
    (fresh.stdin as NodeJS.WritableStream & { unref?(): void }).unref?.();
    child = fresh;
    return fresh;
  };
  return {
    home,
    call(method: string, params: unknown): Promise<never> {
      const id = ++next;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve: resolve as never, reject });
        started().stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    onEvent(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      child?.stdin?.end();
    },
  };
}

let shared: ReturnType<typeof coreBridge> | undefined;
/** The core this test file's db.* goes to, started at its first call. */
export const sharedCore = () => {
  shared ??= coreBridge();
  return shared;
};

/**
 * A session of a live test's own on the server a URI names, opened by the shared core under
 * `application` (pg_stat_activity.application_name), for what the test sets up and watches.
 */
export async function serverSession(uri: string, application = "endue tests") {
  const { fields, password } = parseUri(uri);
  const core = sharedCore();
  const host = fields.host || "localhost";
  const port = fields.port ?? 5432;
  const opened = (await core.call("db.open", {
    engine: "postgresql",
    host,
    port,
    database: fields.database || fields.user,
    user: fields.user,
    ...(password ? { password } : {}),
    ...(fields.ssl && fields.ssl !== "default" ? { tls: { mode: fields.ssl } } : {}),
    settings: { application_name: application },
    scope: { permission: "db:connect", hosts: [`${host}:${port}`] },
  })) as DbOpenResult;
  const sessionId = opened.sessionId;
  if (!sessionId) throw new Error(`no session: ${JSON.stringify(opened.error ?? opened)}`);
  /** One statement's first page, its error included. */
  const page = (sql: string) => core.call("db.run", { sessionId, sql }) as Promise<DbPage>;
  return {
    page,
    /** Statements one by one; the first error throws. The last one's first value, as text. */
    async run(...sqls: string[]) {
      let last: DbPage | undefined;
      for (const sql of sqls) {
        last = await page(sql);
        if (last.error) throw new Error(`${sql}: ${last.error.message}`);
      }
      return last?.rows[0]?.[0] ?? "";
    },
    close: () => core.call("db.close", { sessionId }).catch(() => {}),
  };
}
