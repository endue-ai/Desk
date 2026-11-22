// A pg_service.conf read for an import (#452, PG-15): each service a PostgreSQL connection named
// after it, its keys mapped, the password and every other key left out and said, and a bad line or
// value refused with its line and field.
import { describe, expect, it } from "vitest";
import { readFile } from "../ui/features/connections-file/file.js";

const SERVICE = `# the team's services
[shop]
host=db.example
port=5433
dbname=shop
user=app
password=service-secret
sslmode=verify-full
sslrootcert=~/certs/ca.pem
sslcert=~/certs/client.crt
sslkey=~/certs/client.key
connect_timeout=10

[local]
hostaddr=127.0.0.1
sslmode=allow
`;

describe("a pg_service.conf", () => {
  it("reads a pg_service.conf", () => {
    const read = readFile(SERVICE);
    expect(read.kind).toBe("service");
    expect(read.entries.map((e) => e.conn)).toMatchObject([
      {
        name: "shop",
        engine: "postgresql",
        host: "db.example",
        port: 5433,
        database: "shop",
        user: "app",
        ssl: "verify-full",
        sslCa: "~/certs/ca.pem",
        sslCert: "~/certs/client.crt",
        sslKey: "~/certs/client.key",
        tag: "none",
      },
      { name: "local", host: "127.0.0.1", port: null, ssl: "prefer" },
    ]);
    expect(read.entries[0]?.notes).toEqual(["Left out: password, connect_timeout."]);
    expect(read.entries[1]?.notes).toEqual([]);
    expect(JSON.stringify(read)).not.toContain("service-secret");
    expect(read.entries.map((e) => e.conn.id)).toEqual([
      expect.stringMatching(/^c-/u),
      expect.stringMatching(/^c-/u),
    ]);
  });

  it("refuses a bad line or value with its line and field", () => {
    const cases: Array<[string, RegExp]> = [
      ["host=a\n[x]\n", /Line 1: a setting before the first \[service\]/u],
      ["[x]\nnot a setting\n", /Line 2: key=value expected/u],
      ["[ ]\nhost=a\n", /Line 1: a service needs a name/u],
      ["[x]\nport=99999\n", /Service x \(line 1\): Port: a number from 1 to 65535/u],
      ["[x]\nhost=a,b\n", /Service x \(line 1\): Host: one host/u],
      ["[x]\nsslmode=sometimes\n", /Service x \(line 1\): SSL: pick one of the modes/u],
      ["[x]\nsslrootcert=ca.pem\n", /Service x \(line 1\): CA file: a full path/u],
      ["[x]\n[X]\n", /Service X \(line 2\): Name: the service is in the file twice/u],
    ];
    for (const [text, why] of cases) expect(() => readFile(text), text).toThrow(why);
  });
});
