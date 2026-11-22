// A connections file and a connection's SSH tunnel (PG-10, ADR 0359): the file carries the SSH host,
// port, user, way to sign in, key file path and jump host, and reads them back; a connection without a
// tunnel writes none of them; no secret field is ever written, and a file's bad tunnel field is said
// with the entry and the field.
import { describe, expect, it } from "vitest";
import { normalize } from "../ui/connections.js";
import { fileText, readFile } from "../ui/features/connections-file/file.js";

const TUNNELLED = normalize({
  engine: "postgresql",
  id: "c-shop",
  name: "Shop",
  host: "10.0.0.5",
  database: "shop",
  user: "app",
  sshHost: "bastion.example.com",
  sshPort: 2200,
  sshUser: "deploy",
  sshAuth: "key",
  sshKey: "~/.ssh/id_ed25519",
  sshJump: "ops@gate.example.com",
});
const PLAIN = normalize({ engine: "postgresql", id: "c-plain", name: "Plain", user: "app" });

describe("a connections file and SSH tunnels", () => {
  it("writes the tunnel's fields and reads them back", () => {
    const text = fileText([TUNNELLED, PLAIN], new Date(0));
    const [shop, plain] = JSON.parse(text).connections;
    expect(shop).toMatchObject({
      sshHost: "bastion.example.com",
      sshPort: 2200,
      sshUser: "deploy",
      sshAuth: "key",
      sshKey: "~/.ssh/id_ed25519",
      sshJump: "ops@gate.example.com",
    });
    expect(Object.keys(plain).filter((key) => key.startsWith("ssh"))).toEqual([]);
    expect(text).not.toMatch(/"ssh\w*(pass|secret|phrase)/iu);
    const read = readFile(text, () => 0.5);
    expect(read.entries[0]?.conn).toMatchObject({
      sshHost: "bastion.example.com",
      sshAuth: "key",
      sshJump: "ops@gate.example.com",
    });
  });

  it("a bad tunnel field is said with its entry", () => {
    const text = fileText([TUNNELLED], new Date(0)).replace('"~/.ssh/id_ed25519"', '"id_ed25519"');
    expect(() => readFile(text)).toThrow(/SSH key file: a full path/u);
  });
});
