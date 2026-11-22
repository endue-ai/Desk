// A client certificate on a real PostgreSQL through the desk core (PG-11, ADR 0331): the plugin
// reads the connection's certificate and key files, the core decodes them (an encrypted key with
// the passphrase the prompt was answered with) and presents them, and a server whose pg_hba says
// clientcert=verify-full lets the session in; without them it refuses. It runs when
// ENDUE_DB_TEST_POSTGRES_CLIENT_CERT holds such a server's URI with sslmode, sslrootcert, sslcert
// and sslkey (and sslpassword for an encrypted key). fs.read is served from the disk here; the
// statements go through crates/desk-core/examples/db-bridge.rs (core-bridge.ts).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { createSessions } from "../ui/engines/pg-session.js";
import type { Passphrases } from "../ui/engines/pg-tls.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { sharedCore } from "./core-bridge";

const uri = process.env.ENDUE_DB_TEST_POSTGRES_CLIENT_CERT ?? "";
const home = (path: string) => (path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path);

/** The plugin's executor on the core's sessions, files read from the disk, `typed` the passphrase. */
function onCore(typed: string | undefined) {
  const core = sharedCore() as never as {
    call(method: string, params: unknown): Promise<never>;
    onEvent: never;
  };
  const call = async (method: string, params: Record<string, unknown>) => {
    if (method === "fs.read") return { content: readFileSync(home(String(params.path)), "utf8") };
    if (method === "perm.request") return { granted: true };
    return core.call(method, params);
  };
  const asked: string[] = [];
  const held = new Map<string, string>();
  const passphrases: Passphrases = {
    get: (conn) => held.get(conn.id),
    set: (conn, value) => void held.set(conn.id, value),
    forget: (conn) => void held.delete(conn.id),
    ask: async (_conn, why) => {
      asked.push(why);
      return typed;
    },
  };
  const bridge = { call, onEvent: core.onEvent } as never;
  const settings = fromValues({});
  const executor = createExecutor({
    runner: { run: async () => Promise.reject(new Error("no client runs for PostgreSQL")) },
    output: { read: async () => Promise.reject(new Error("nothing to read")) },
    clients: { get: async () => Promise.reject(new Error("no client")) },
    sessions: createSessions(bridge, { passphrases }),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message: string) => new Error(message),
  } as never);
  return { execute: executor.execute, asked };
}

const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const passphrase = uri ? (new URL(uri).searchParams.get("sslpassword") ?? undefined) : undefined;
const conn = (more: Partial<Connection> = {}) =>
  ({ ...normalize({ ...fields, id: "c-cert", name: "certified" }), ...more }) as Connection;

describe.skipIf(!uri)("a client certificate on a real PostgreSQL that requires one", () => {
  it("with the certificate the session opens and the server sees it; without it the server refuses", {
    timeout: 60_000,
  }, async () => {
    const live = onCore(passphrase);
    const sql = "select client_dn from pg_stat_ssl where pid = pg_backend_pid()";
    const done = await live.execute(conn(), sql);
    expect(done.result.error).toBeUndefined();
    const dn = String(done.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "");
    expect(dn).toContain(`CN=${conn().user}`);
    expect(live.asked).toHaveLength(passphrase ? 1 : 0);

    const again = await live.execute(conn(), "select 1");
    expect(again.result.error).toBeUndefined();
    expect(live.asked).toHaveLength(passphrase ? 1 : 0);

    const bare = await onCore(undefined).execute(conn({ sslCert: "", sslKey: "" }), "select 1");
    expect(bare.result.error?.message).toMatch(/certificate/u);
  });
});
