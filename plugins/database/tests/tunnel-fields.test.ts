// A PostgreSQL connection's SSH tunnel fields (PG-10, ADR 0359): what the form keeps, what it
// refuses with the field's name, the jump host's `user@host:port`, the hops db:connect lists, and a
// connections file that carries the fields but never a key, a passphrase or a password.
import { describe, expect, it } from "vitest";
import { normalize } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { FIELDS } from "../ui/features/connections-file/file.js";
import { jumpOf, tunneled, tunnelOf } from "../ui/tunnel/fields.js";
import { hopsOf, scopeOf } from "../ui/tunnel/open.js";

const PG = { engine: "postgresql" as const, id: "c-pg", name: "Shop", user: "app" };

describe("an SSH tunnel on a PostgreSQL connection", () => {
  it("is kept only with an SSH host, and only for PostgreSQL", () => {
    expect(tunneled(normalize(PG))).toBe(false);
    expect(normalize(PG)).not.toHaveProperty("sshHost");
    const conn = normalize({
      ...PG,
      sshHost: "bastion.example.com",
      sshUser: "deploy",
      sshKey: "~/.ssh/id_ed25519",
    });
    expect(conn).toMatchObject({
      sshHost: "bastion.example.com",
      sshUser: "deploy",
      sshAuth: "key",
      sshKey: "~/.ssh/id_ed25519",
    });
    expect(tunneled(conn)).toBe(true);
    const mysql = normalize({ engine: "mysql", id: "c-my", sshHost: "bastion.example.com" });
    expect(mysql).not.toHaveProperty("sshHost");
  });

  it("refuses what cannot sign in, naming the field", () => {
    const base = { ...PG, sshHost: "bastion.example.com", sshUser: "deploy" };
    expect(() => normalize({ ...base, sshUser: "" })).toThrow(/^SSH user:/u);
    expect(() => normalize({ ...base, sshHost: "bad host" })).toThrow(/^SSH host:/u);
    expect(() => normalize({ ...base, sshPort: 70000, sshKey: "/k" })).toThrow(/^SSH port:/u);
    expect(() => normalize(base)).toThrow(/^SSH key file: the private key/u);
    expect(() => normalize({ ...base, sshKey: "id_ed25519" })).toThrow(/^SSH key file: a full/u);
    expect(() => normalize({ ...base, sshAuth: "token" as never })).toThrow(/^Sign in with:/u);
    expect(() => normalize({ ...base, sshAuth: "agent", sshJump: "a b" })).toThrow(/^Jump host:/u);
    const agent = normalize({ ...base, sshAuth: "agent", sshKey: "/ignored" });
    expect(agent).toMatchObject({ sshAuth: "agent" });
    expect(agent).not.toHaveProperty("sshKey");
  });

  it("a jump host reads user@host:port, the SSH host's user and port 22 by default", () => {
    expect(jumpOf("gate.example.com", "deploy")).toEqual({
      host: "gate.example.com",
      port: 22,
      user: "deploy",
    });
    expect(jumpOf("ops@gate.example.com:2222", "deploy")).toEqual({
      host: "gate.example.com",
      port: 2222,
      user: "ops",
    });
    expect(() => jumpOf("ops@", "deploy")).toThrow(/^Jump host:/u);
  });

  it("db:connect lists the database, the jump host and the SSH host", () => {
    const conn = normalize({
      ...PG,
      host: "10.0.0.5",
      sshHost: "bastion.example.com",
      sshPort: 2200,
      sshUser: "deploy",
      sshAuth: "agent",
      sshJump: "gate.example.com",
    }) as Connection;
    expect(hopsOf(conn).map((h) => `${h.user}@${h.host}:${h.port}`)).toEqual([
      "deploy@gate.example.com:22",
      "deploy@bastion.example.com:2200",
    ]);
    expect(scopeOf("10.0.0.5:5432", conn)).toEqual({
      permission: "db:connect",
      hosts: ["10.0.0.5:5432", "gate.example.com:22", "bastion.example.com:2200"],
    });
    expect(scopeOf("10.0.0.5:5432", normalize(PG)).hosts).toEqual(["10.0.0.5:5432"]);
  });

  it("a connections file carries the tunnel's fields and no secret", () => {
    for (const field of ["sshHost", "sshPort", "sshUser", "sshAuth", "sshKey", "sshJump"])
      expect(FIELDS).toContain(field);
    expect(FIELDS.some((f) => /password|passphrase|secret/iu.test(f) && f.startsWith("ssh"))).toBe(
      false,
    );
    expect(tunnelOf({ sshHost: "h", sshUser: "u", sshAuth: "password" }, normalize(PG))).toEqual({
      sshHost: "h",
      sshUser: "u",
      sshAuth: "password",
    });
  });
});
