// A PostgreSQL session through an SSH tunnel (PG-10, ADR 0359), against the bridge stub's scripted
// SSH servers (stub-db-ssh.ts): db.open's `ssh` with each hop, a host key shown with its fingerprint
// and trusted only on the person's yes, a changed one refused with the way out, a passphrase or a
// password asked and held in memory only, an error that names the hop, nothing asked in the
// background, and the forget-host-key command.
import { describe, expect, it } from "vitest";
import { STUB_HOST_KEY, type StubDatabase } from "../../../packages/bridge/src/index";
import type { Connection } from "../ui/engines/common.js";
import { createTunnel } from "../ui/tunnel/open.js";
import { sessionExecutor } from "./pg-host";

const OTHER_KEY = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PG: Connection = {
  id: "c-pg",
  name: "Shop",
  engine: "postgresql",
  host: "10.0.0.5",
  port: 5432,
  database: "shop",
  user: "app",
  ssl: "disable",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
  sshHost: "bastion.example.com",
  sshUser: "deploy",
  sshAuth: "key",
  sshKey: "~/.ssh/id_ed25519",
};
const grant = [{ permission: "db:connect" as const, hosts: ["*"] }];
const db = (ssh: StubDatabase["ssh"] = {}): StubDatabase => ({
  statements: [{ sql: "select 1", tag: "SELECT 0" }],
  ssh,
});

/** A tunnel whose confirm answers `yes` in turn and whose prompt types `typed` in turn. */
function person(yes: boolean[], ...typed: (string | undefined)[]) {
  const shown: { title: string; reasons: string[] }[] = [];
  const asked: string[] = [];
  const tunnel = createTunnel({
    confirm: async (title, reasons) => {
      shown.push({ title, reasons });
      return yes.shift() ?? false;
    },
    ask: async (_conn, why) => {
      asked.push(why);
      return typed.shift();
    },
  });
  return { tunnel, shown, asked };
}
const sshOf = (t: ReturnType<typeof sessionExecutor>) =>
  t.made("db.open").map((p) => p.ssh as Record<string, unknown> | undefined);

describe("a PostgreSQL connection through an SSH tunnel", () => {
  it("shows a new host key's fingerprint and trusts it only on a yes", async () => {
    const no = person([false]);
    const refused = sessionExecutor(db(), { grants: grant, tunnel: no.tunnel });
    const r = await refused.execute(PG, "select 1");
    expect(r.result.error?.message).toMatch(/^Shop: The SSH host bastion\.example\.com:22/u);
    expect(no.shown[0]?.title).toBe("Trust the key of the SSH host bastion.example.com:22?");
    expect(no.shown[0]?.reasons[0]).toBe(`ssh-ed25519 ${STUB_HOST_KEY}`);
    const yes = person([true]);
    const t = sessionExecutor(db(), { grants: grant, tunnel: yes.tunnel });
    expect((await t.execute(PG, "select 1")).result.error).toBeUndefined();
    expect(sshOf(t)).toEqual([
      { host: "bastion.example.com", port: 22, user: "deploy", keyFile: "~/.ssh/id_ed25519" },
      {
        host: "bastion.example.com",
        port: 22,
        user: "deploy",
        keyFile: "~/.ssh/id_ed25519",
        hostKey: STUB_HOST_KEY,
      },
    ]);
    expect(t.made("perm.request")).toEqual([]);
  });

  it("refuses a changed host key and says how to forget the old one", async () => {
    const hostKeys: Record<string, string> = {};
    const { tunnel } = person([true, true]);
    const t = sessionExecutor(db({ hostKeys }), { grants: grant, tunnel });
    expect((await t.execute(PG, "select 1")).result.error).toBeUndefined();
    hostKeys["bastion.example.com:22"] = OTHER_KEY;
    const changed = await t.execute({ ...PG, id: "c-2" }, "select 1");
    expect(changed.result.error?.kind).toBe("connect");
    expect(changed.result.error?.message).toContain(
      `${OTHER_KEY}, not the trusted ${STUB_HOST_KEY}`,
    );
    expect(changed.result.error?.message).toContain("Database: forget the SSH host key");
  });

  it("asks an encrypted key's passphrase and the SSH password, and keeps neither", async () => {
    const locked = { ...PG, sshKey: "~/.ssh/encrypted_key" };
    const p = person([true], "not it", "fixture-ssh-phrase");
    const t = sessionExecutor(db({ keyPassword: "fixture-ssh-phrase" }), {
      grants: grant,
      tunnel: p.tunnel,
    });
    expect((await t.execute(locked, "select 1")).result.error).toBeUndefined();
    expect(p.asked[0]).toMatch(/encrypted_key is encrypted: type its passphrase/u);
    expect(p.asked[1]).toMatch(/^the passphrase does not decrypt/u);
    const pw = person([true], "fixture-ssh-password");
    const s = sessionExecutor(db({ password: "fixture-ssh-password" }), {
      grants: grant,
      tunnel: pw.tunnel,
    });
    const viaPassword = { ...PG, sshAuth: "password" as const, sshKey: undefined };
    expect((await s.execute(viaPassword, "select 1")).result.error).toBeUndefined();
    expect(pw.asked).toHaveLength(1);
    expect(pw.asked[0]).toMatch(/asks for deploy's password/u);
    const stored = [...t.made("store.set"), ...t.made("log.write"), ...s.made("store.set")];
    expect(JSON.stringify(stored)).not.toMatch(/fixture-ssh/u);
  });

  it("names the hop that failed, and asks nothing in the background", async () => {
    const p = person([true, true]);
    const t = sessionExecutor(db({ unreachable: ["10.0.0.5:5432"] }), {
      grants: grant,
      tunnel: p.tunnel,
    });
    const jumped = { ...PG, sshJump: "ops@gate.example.com" };
    const forward = await t.execute(jumped, "select 1");
    expect(p.shown.map((s) => s.title)).toEqual([
      "Trust the key of the jump host gate.example.com:22?",
      "Trust the key of the SSH host bastion.example.com:22?",
    ]);
    expect(forward.result.error?.message).toBe(
      "Shop: The SSH host bastion.example.com:22 could not reach 10.0.0.5:5432.",
    );
    const quiet = person([true]);
    const q = sessionExecutor(db(), { grants: grant, tunnel: quiet.tunnel });
    const agent = await q.execute(PG, "select 1", { interactive: false });
    expect(agent.result.error?.message).toMatch(/has not trusted yet/u);
    expect(quiet.shown).toEqual([]);
    const pw = await q.execute({ ...PG, sshAuth: "password" }, "select 1", { interactive: false });
    expect(pw.result.error?.message).toMatch(/needs deploy's password, and it was not typed/u);
    expect(quiet.asked).toEqual([]);
  });

  it("Test connection's run goes through the tunnel", async () => {
    const version = {
      sql: "SELECT version()",
      columns: [{ name: "version", type: "text" }],
      rows: [["PostgreSQL 17.6"]],
    };
    const t = sessionExecutor(
      { statements: [version as never], ssh: {} },
      { grants: grant, tunnel: person([true]).tunnel },
    );
    // What manage.js's test runs: the engine's version query as a catalog read.
    const done = await t.execute(PG, "SELECT version()", { catalog: true });
    expect(done.result.error).toBeUndefined();
    expect(done.result.statements[0]?.sets[0]?.rows[0]?.[0]).toBe("PostgreSQL 17.6");
    expect(sshOf(t).at(-1)).toMatchObject({ host: "bastion.example.com", hostKey: STUB_HOST_KEY });
  });

  it("asks db:connect for every hop", async () => {
    const asked: string[][] = [];
    const t = sessionExecutor(db(), {
      grants: [],
      prompt: (data) => {
        asked.push((data.permission as { hosts: string[] }).hosts);
        return false;
      },
      tunnel: person([]).tunnel,
    });
    const denied = await t.execute(PG, "select 1");
    expect(asked[0]).toEqual(["10.0.0.5:5432", "bastion.example.com:22"]);
    expect(denied.result.error).toBeDefined();
    expect(denied.result.error?.kind).toBe("refused");
    expect(t.calls.filter((c) => c.method === "db.close")).toEqual([]);
  });
});
