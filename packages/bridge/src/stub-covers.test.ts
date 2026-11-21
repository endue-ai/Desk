import { describe, expect, it } from "vitest";
import { covers } from "./stub-covers";

const connect = (...hosts: string[]) => ({ permission: "net:connect" as const, hosts });

describe("the stub's covers, as desk-core judges it", () => {
  it("net:connect: a host without a port covers every port of it, one with a port that port only", () => {
    expect(covers(connect("studio.local"), connect("studio.local:5900"))).toBe(true);
    expect(covers(connect("studio.local:5900"), connect("studio.local:5900"))).toBe(true);
    expect(covers(connect("studio.local:5900"), connect("studio.local:5901"))).toBe(false);
    expect(covers(connect("studio.local:5900"), connect("studio.local"))).toBe(false);
    expect(covers(connect("*.example.com"), connect("mac.example.com:5900"))).toBe(true);
    expect(covers(connect("192.0.2.10"), connect("192.0.2.11:5900"))).toBe(false);
    expect(
      covers({ permission: "net:fetch", hosts: ["studio.local"] }, connect("studio.local")),
    ).toBe(false);
  });

  it("db:connect: hosts and ports as net:connect, and neither covers the other", () => {
    const db = (...hosts: string[]) => ({ permission: "db:connect" as const, hosts });
    expect(covers(db("db.example.test"), db("db.example.test:5432"))).toBe(true);
    expect(covers(db("db.example.test:5432"), db("db.example.test:6432"))).toBe(false);
    expect(covers(db("*"), db("db.example.test:5432"))).toBe(true);
    expect(covers(connect("db.example.test"), db("db.example.test:5432"))).toBe(false);
    expect(covers(db("db.example.test"), connect("db.example.test:5432"))).toBe(false);
  });
});
