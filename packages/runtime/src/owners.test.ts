import type { BridgeEvent, BridgeRequest, BridgeResponse } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { eventKey, Owners } from "./owners";

const fsWatch: BridgeRequest = {
  id: 1,
  method: "fs.watch",
  params: { path: "~/Documents", scope: { permission: "fs:read", paths: ["~/Documents/**"] } },
};
const procSpawn: BridgeRequest = {
  id: 2,
  method: "proc.spawn",
  params: { command: "sh", scope: { permission: "proc:spawn", commands: ["sh"] } },
};
const ok = (id: number, result: unknown): BridgeResponse => ({ id, ok: true, result });

const changed = (watchId: string): BridgeEvent => ({
  event: "fs.changed",
  data: { watchId, path: "~/Documents/a.md", change: "modified" },
});
const output = (procId: string, data: string): BridgeEvent => ({
  event: "proc.output",
  data: { procId, stream: "stdout", data, encoding: "utf8" },
});
const exit = (procId: string): BridgeEvent => ({ event: "proc.exit", data: { procId, code: 0 } });

const route = (owners: Owners, event: BridgeEvent) => {
  const key = eventKey(event);
  return key === undefined ? "everyone" : owners.route(event, key);
};

describe("Owners", () => {
  it("sends a watch's changes only to the plugin that started it", () => {
    const owners = new Owners();
    owners.claim(fsWatch, ok(1, { watchId: "w1" }), "example.notes");
    expect(route(owners, changed("w1"))).toBe("example.notes");
    expect(route(owners, changed("w2"))).toBeUndefined();
  });

  it("holds output that arrives before the spawn answer, then hands it over in order", () => {
    const owners = new Owners();
    expect(route(owners, output("p1", "a"))).toBeUndefined();
    expect(route(owners, output("p1", "b"))).toBeUndefined();
    const early = owners.claim(procSpawn, ok(2, { procId: "p1" }), "example.term");
    expect(early).toEqual([output("p1", "a"), output("p1", "b")]);
    expect(route(owners, output("p1", "c"))).toBe("example.term");
  });

  it("forgets a process after its exit, and an owner after it is dropped", () => {
    const owners = new Owners();
    owners.claim(procSpawn, ok(2, { procId: "p1" }), "example.term");
    expect(route(owners, exit("p1"))).toBe("example.term");
    expect(route(owners, output("p1", "late"))).toBeUndefined();

    owners.claim(fsWatch, ok(1, { watchId: "w1" }), "example.notes");
    owners.drop("example.notes");
    expect(route(owners, changed("w1"))).toBeUndefined();
  });

  it("ignores failed calls and leaves unowned events to everyone", () => {
    const owners = new Owners();
    const failed: BridgeResponse = {
      id: 1,
      ok: false,
      error: { code: "permission_denied", message: "no" },
    };
    expect(owners.claim(fsWatch, failed, "example.notes")).toEqual([]);
    expect(
      route(owners, { event: "perm.changed", data: { grantId: "g1", change: "revoked" } }),
    ).toBe("everyone");
  });
});
