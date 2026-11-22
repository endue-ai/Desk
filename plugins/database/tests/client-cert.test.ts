// A PostgreSQL connection's client certificate (PG-11, ADR 0331): the form's two paths, the URI's
// sslcert and sslkey, what reaches the core's session (db.open's tls.cert and tls.key, read with
// fs.read) and the client programs (PGSSLCERT, PGSSLKEY), a file that cannot be read said with its
// field's name before anything connects, and an encrypted key's passphrase asked, used and held in
// memory only. A scripted server (the bridge stub's StubDatabase) stands in for PostgreSQL.
import { describe, expect, it } from "vitest";
import type { StubDatabase } from "../../../packages/bridge/src/index";
import { formatUri, normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { createPassphrases, type Passphrases } from "../ui/engines/pg-tls.js";
import { connectionEnv } from "../ui/features/backup/args.js";
import { sessionExecutor } from "./pg-host";

const PG: Connection = {
  id: "c-pg",
  name: "Shop",
  engine: "postgresql",
  host: "db.example",
  port: 6543,
  database: "shop",
  user: "app",
  ssl: "verify-full",
  sslCa: "",
  sslCert: "~/certs/client.crt",
  sslKey: "~/certs/client.key",
  file: "",
  tag: "none",
  readOnly: false,
};
// Placeholders in PEM's shape, built from the label so a secret scanner does not read them as keys.
const pem = (label: string) => `-----BEGIN ${label}-----\nMIIB\n-----END ${label}-----\n`;
const CERT = pem("CERTIFICATE");
const KEY = pem("PRIVATE KEY");
const LOCKED = pem("ENCRYPTED PRIVATE KEY");
const grant = [{ permission: "db:connect" as const, hosts: ["*"] }];
const db = (more: Partial<StubDatabase> = {}): StubDatabase => ({
  statements: [{ sql: "select 1", tag: "SELECT 0" }],
  ...more,
});

/** A passphrase holder like the manager's, answering the prompt with `typed` in turn. */
function phrases(...typed: (string | undefined)[]) {
  const held = new Map<string, string>();
  const asked: string[] = [];
  const passphrases: Passphrases = {
    get: (conn) => held.get(conn.id),
    set: (conn, value) => void held.set(conn.id, value),
    forget: (conn) => void held.delete(conn.id),
    ask: async (_conn, why) => {
      asked.push(why);
      return typed.shift();
    },
  };
  return { passphrases, held, asked };
}

describe("a client certificate on a PostgreSQL connection", () => {
  it("a URI reads and writes sslcert and sslkey", () => {
    const uri =
      "postgresql://app@db.example:6543/shop?sslmode=verify-full&sslcert=%7E%2Fcerts%2Fclient.crt&sslkey=%7E%2Fcerts%2Fclient.key";
    const { fields } = parseUri(uri);
    expect(fields).toMatchObject({ sslCert: "~/certs/client.crt", sslKey: "~/certs/client.key" });
    const conn = normalize({ ...fields, id: "c-pg", name: "Shop" });
    expect(formatUri(conn)).toBe(uri);
    expect(parseUri(formatUri(conn)).fields).toEqual(fields);
    expect(normalize({ ...fields, id: "c-pg" })).toMatchObject({ sslCert: "~/certs/client.crt" });
  });

  it("the form's fields are full paths, both or neither, PostgreSQL only", () => {
    const fields = { engine: "postgresql" as const, id: "c-pg", user: "app" };
    expect(normalize(fields)).toMatchObject({ sslCert: "", sslKey: "" });
    expect(() => normalize({ ...fields, sslCert: "client.crt", sslKey: "/k" })).toThrow(
      /^Certificate file: a full path/u,
    );
    expect(() => normalize({ ...fields, sslCert: "/c", sslKey: "client.key" })).toThrow(
      /^Key file: a full path/u,
    );
    expect(() => normalize({ ...fields, sslCert: "/c" })).toThrow(/^Key file:/u);
    expect(() => normalize({ ...fields, sslKey: "/k" })).toThrow(/^Certificate file:/u);
    const mysql = normalize({ engine: "mysql", id: "c-my", sslCert: "/c", sslKey: "/k" });
    expect([mysql.sslCert, mysql.sslKey]).toEqual(["", ""]);
  });

  it("what reaches the client: the files' text in db.open's tls, the paths for pg_dump", async () => {
    const files = { "~/certs/client.crt": CERT, "~/certs/client.key": KEY };
    const t = sessionExecutor(db(), { grants: grant, files });
    await t.execute(PG, "select 1");
    await t.execute({ ...PG, ssl: "default" }, "select 1");
    await t.execute({ ...PG, ssl: "disable" }, "select 1");
    expect(t.made("db.open").map((p) => p.tls)).toEqual([
      { mode: "verify-full", cert: CERT, key: KEY },
      { mode: "prefer", cert: CERT, key: KEY },
      { mode: "disable" },
    ]);
    expect(t.made("perm.request").map((p) => p.permission)).toEqual([
      { permission: "fs:read", paths: ["~/certs/client.crt", "~/certs/client.key"] },
    ]);
    expect(connectionEnv(PG, undefined)).toMatchObject({
      PGSSLMODE: "verify-full",
      PGSSLCERT: "~/certs/client.crt",
      PGSSLKEY: "~/certs/client.key",
    });
    expect(connectionEnv({ ...PG, sslCert: "", sslKey: "" }, undefined)).not.toHaveProperty(
      "PGSSLCERT",
    );
  });

  it("a missing file is said with its field's name before anything connects", async () => {
    const t = sessionExecutor(db(), {
      grants: [...grant, { permission: "fs:read", paths: ["/**", "~/**"] }],
      files: { "~/certs/client.crt": CERT, "~/certs/plain.txt": "not a key" },
    });
    const noKey = await t.execute(PG, "select 1");
    expect(noKey.result.error).toMatchObject({ kind: "connect" });
    expect(noKey.result.error?.message).toMatch(/^Key file: .*client\.key/u);
    const noCert = await t.execute({ ...PG, sslCert: "~/certs/none.crt" }, "select 1");
    expect(noCert.result.error?.message).toMatch(/^Certificate file: .*none\.crt/u);
    const notKey = await t.execute({ ...PG, sslKey: "~/certs/plain.txt" }, "select 1");
    expect(notKey.result.error?.message).toBe(
      "Key file: ~/certs/plain.txt holds no PEM private key.",
    );
    expect(t.made("db.open")).toEqual([]);
  });

  it("an encrypted key's passphrase is asked, used and never kept", async () => {
    const files = { "~/certs/client.crt": CERT, "~/certs/client.key": LOCKED };
    const { passphrases, held, asked } = phrases("not it", "fixture-passphrase");
    const t = sessionExecutor(db({ keyPassword: "fixture-passphrase" }), {
      grants: grant,
      files,
      passphrases,
    });
    const wrong = await t.execute(PG, "select 1");
    expect(wrong.result.error?.message).toBe(
      "Key file: the passphrase does not decrypt ~/certs/client.key.",
    );
    expect(held.size).toBe(0);
    const right = await t.execute(PG, "select 1");
    expect(right.result.error).toBeUndefined();
    expect(held.get("c-pg")).toBe("fixture-passphrase");
    const again = await t.execute(PG, "select 1");
    expect(again.result.error).toBeUndefined();
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/client\.key is encrypted: type its passphrase/u);
    expect(t.made("db.open").map((p) => (p.tls as { keyPassword?: string }).keyPassword)).toEqual([
      undefined,
      "not it",
      undefined,
      "fixture-passphrase",
      "fixture-passphrase",
    ]);
    const quiet = sessionExecutor(db({ keyPassword: "fixture-passphrase" }), {
      grants: grant,
      files,
      passphrases: phrases("never asked").passphrases,
    });
    const agent = await quiet.execute(PG, "select 1", { interactive: false });
    expect(agent.result.error?.message).toBe(
      "Key file: ~/certs/client.key is encrypted, and its passphrase was not typed.",
    );
    const stored = [...t.made("store.set"), ...t.made("log.write"), ...t.made("db.passwords.set")];
    expect(JSON.stringify(stored)).not.toContain("fixture-passphrase");
  });

  it("a passphrase is held by connection and key path, and Disconnect's forget drops them all", () => {
    const held = createPassphrases(async () => undefined);
    held.set(PG, "fixture-passphrase");
    expect(held.get(PG)).toBe("fixture-passphrase");
    expect(held.get({ ...PG, sslKey: "~/certs/other.key" })).toBeUndefined();
    held.set({ ...PG, id: "c-other" }, "other-passphrase");
    held.forgetAll(PG.id);
    expect(held.get(PG)).toBeUndefined();
    expect(held.get({ ...PG, id: "c-other" })).toBe("other-passphrase");
  });
});
