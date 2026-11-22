// A PostgreSQL connection through a real SSH tunnel (PG-10, ADR 0359), through the plugin and the
// desk core (core-bridge.ts): the first connect shows the SSH host's fingerprint and runs once the
// person trusts it, the next asks nothing, a password typed for the SSH host signs in, a key the
// server does not know is said with the hop, and forgetting the key makes the next connect ask
// again. Runs when ENDUE_DB_TEST_SSH (`ssh://user:password@host:port`), ENDUE_DB_TEST_SSH_KEY (a
// key file it accepts) and ENDUE_DB_TEST_SSH_POSTGRES (the database as the SSH host reaches it)
// are set; see crates/desk-core/tests/db_ssh_live.rs.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { createTunnel } from "../ui/tunnel/open.js";
import { sharedCore } from "./core-bridge";

const ssh = process.env.ENDUE_DB_TEST_SSH ?? "";
const key = process.env.ENDUE_DB_TEST_SSH_KEY ?? "";
const target = process.env.ENDUE_DB_TEST_SSH_POSTGRES ?? "";
const ready = Boolean(ssh && key && target);

/** The plugin's executor on the core's sessions; the person says `yes` and types `typed`. */
function onCore(yes: boolean, typed?: string) {
  const core = sharedCore() as never as {
    call(method: string, params: unknown): Promise<never>;
    onEvent: never;
  };
  const call = async (method: string, params: Record<string, unknown>) =>
    method === "perm.request" ? { granted: true } : core.call(method, params);
  const shown: string[] = [];
  const asked: string[] = [];
  const tunnel = createTunnel({
    confirm: async (title, reasons) => {
      shown.push(`${title} ${reasons[0]}`);
      return yes;
    },
    ask: async (_conn, why) => {
      asked.push(why);
      return typed;
    },
  });
  const bridge = { call, onEvent: core.onEvent } as never;
  const settings = fromValues({});
  const executor = createExecutor({
    runner: { run: async () => Promise.reject(new Error("no client runs for PostgreSQL")) },
    output: { read: async () => Promise.reject(new Error("nothing to read")) },
    clients: { get: async () => Promise.reject(new Error("no client")) },
    sessions: createSessions(bridge, { tunnel }),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message: string) => new Error(message),
  } as never);
  return { execute: executor.execute, shown, asked, core };
}

const { fields, password } = target ? parseUri(target) : { fields: {}, password: undefined };
const at = ssh ? new URL(ssh) : undefined;
const conn = (more: Record<string, unknown> = {}) =>
  normalize({
    ...fields,
    ssl: "disable",
    id: "c-ssh",
    name: "Tunnelled",
    sshHost: at?.hostname,
    sshPort: Number(at?.port || 22),
    sshUser: decodeURIComponent(at?.username ?? ""),
    sshKey: key,
    ...more,
  }) as Connection;
const answer = (done: Awaited<ReturnType<ReturnType<typeof onCore>["execute"]>>) =>
  done.result.statements[0]?.sets[0]?.rows[0]?.[0];

describe.skipIf(!ready)("a PostgreSQL connection through a real SSH tunnel", () => {
  it("trusts the host key on a yes, signs in with a key or a password, and names the hop", {
    timeout: 120_000,
  }, async () => {
    const no = onCore(false);
    const refused = await no.execute(conn(), "select 41 + 1");
    expect(no.shown[0]).toMatch(/^Trust the key of the SSH host .* SHA256:/u);
    expect(refused.result.error?.message).toMatch(/has not trusted yet/u);

    const yes = onCore(true);
    expect(answer(await yes.execute(conn(), "select 41 + 1"))).toBe("42");
    expect(yes.shown).toHaveLength(1);
    const again = onCore(false);
    expect(answer(await again.execute(conn({ id: "c-again" }), "select 1"))).toBe("1");
    expect(again.shown).toEqual([]);

    const secret = decodeURIComponent(at?.password ?? "");
    const typed = onCore(false, secret);
    const viaPassword = conn({ id: "c-pw", sshAuth: "password", sshKey: undefined });
    expect(answer(await typed.execute(viaPassword, "select 2"))).toBe("2");
    expect(typed.asked).toHaveLength(1);

    const dir = mkdtempSync(join(tmpdir(), "endue-tunnel-"));
    try {
      const stranger = join(dir, "not-authorised");
      writeFileSync(stranger, "not a key\n", { mode: 0o600 });
      const wrong = await onCore(false).execute(
        conn({ id: "c-wrong", sshKey: stranger }),
        "select 1",
      );
      expect(wrong.result.error?.message).toMatch(/^Tunnelled: .*not-authorised/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    await yes.core.call("db.hostKeys.delete", { host: at?.hostname, port: Number(at?.port || 22) });
    const forgotten = onCore(false);
    await forgotten.execute(conn({ id: "c-forgot" }), "select 1");
    expect(forgotten.shown).toHaveLength(1);
  });
});
