import type { BridgeEvent, BridgeRequest, BridgeResponse } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { claimKey, eventKey, Owners } from "./owners";

const fsWatch: BridgeRequest = {
  id: 1,
  method: "fs.watch",
  params: { path: "~/Documents", scope: { permission: "fs:read", paths: ["~/Documents/**"] } },
};
const procSpawn: BridgeRequest = {
  id: 2,
  method: "proc.spawn",
  params: {
    command: "zsh",
    pty: { cols: 80, rows: 24 },
    scope: { permission: "proc:spawn", commands: ["zsh"], pty: true },
  },
};
const brainSay: BridgeRequest = {
  id: 3,
  method: "brain.say",
  params: { text: "hi", scope: { permission: "brain:converse" } },
};
const ok = (id: number, result: unknown): BridgeResponse => ({ id, ok: true, result });

const changed = (watchId: string): BridgeEvent => ({
  event: "fs.changed",
  data: { watchId, path: "~/Documents/a.md", change: "modified" },
});
const output = (procId: string, data: string): BridgeEvent => ({
  event: "proc.output",
  data: { procId, stream: "pty", data, encoding: "utf8" },
});
const exit = (procId: string): BridgeEvent => ({ event: "proc.exit", data: { procId, code: 0 } });
const turn = (turnId: string, kind: "started" | "completed"): BridgeEvent => ({
  event: "brain.turn",
  data: { turnId, kind },
});

const route = (owners: Owners, event: BridgeEvent) => {
  const key = eventKey(event);
  return key === undefined ? "everyone" : owners.route(event, key);
};

describe("Owners", () => {
  it("names the key of every owned event and of the call that starts it", () => {
    expect(eventKey(changed("w1"))).toBe("watch:w1");
    expect(eventKey(output("p1", "a"))).toBe("proc:p1");
    expect(eventKey(exit("p1"))).toBe("proc:p1");
    expect(eventKey(turn("t1", "started"))).toBe("turn:t1");
    expect(eventKey({ event: "perm.changed", data: { grantId: "g1", change: "revoked" } })).toBe(
      undefined,
    );
    expect(claimKey(fsWatch, ok(1, { watchId: "w1" }))).toBe("watch:w1");
    expect(claimKey(procSpawn, ok(2, { procId: "p1", pid: 4 }))).toBe("proc:p1");
    expect(claimKey(brainSay, ok(3, { turnId: "t1" }))).toBe("turn:t1");
  });

  it("sends a watch's changes only to the plugin that started it", () => {
    const owners = new Owners();
    owners.claim(fsWatch, ok(1, { watchId: "w1" }), "endue.notes");
    expect(route(owners, changed("w1"))).toBe("endue.notes");
    expect(route(owners, changed("w2"))).toBeUndefined();
  });

  it("holds output that arrives before the spawn's answer, then hands it over in order", () => {
    const owners = new Owners();
    expect(route(owners, output("p1", "a"))).toBeUndefined();
    expect(route(owners, output("p1", "b"))).toBeUndefined();
    const early = owners.claim(procSpawn, ok(2, { procId: "p1" }), "endue.terminal");
    expect(early).toEqual([output("p1", "a"), output("p1", "b")]);
    expect(route(owners, output("p1", "c"))).toBe("endue.terminal");
  });

  it("forgets a process after its exit and a turn after its end", () => {
    const owners = new Owners();
    owners.claim(procSpawn, ok(2, { procId: "p1" }), "endue.terminal");
    expect(route(owners, exit("p1"))).toBe("endue.terminal");
    expect(route(owners, output("p1", "late"))).toBeUndefined();

    owners.claim(brainSay, ok(3, { turnId: "t1" }), "endue.eris");
    expect(route(owners, turn("t1", "started"))).toBe("endue.eris");
    expect(route(owners, turn("t1", "completed"))).toBe("endue.eris");
    expect(route(owners, turn("t1", "started"))).toBeUndefined();
  });

  it("a process that exits before the spawn's answer is handed over whole, then forgotten", () => {
    const owners = new Owners();
    route(owners, output("p1", "a"));
    route(owners, exit("p1"));
    expect(owners.claim(procSpawn, ok(2, { procId: "p1" }), "endue.terminal")).toEqual([
      output("p1", "a"),
      exit("p1"),
    ]);
    expect(route(owners, output("p1", "late"))).toBeUndefined();
  });

  it("drops an owner's keys with it and ignores failed calls", () => {
    const owners = new Owners();
    owners.claim(fsWatch, ok(1, { watchId: "w1" }), "endue.notes");
    owners.claim(procSpawn, ok(2, { procId: "p1" }), "endue.terminal");
    owners.drop("endue.notes");
    expect(route(owners, changed("w1"))).toBeUndefined();
    expect(route(owners, output("p1", "a"))).toBe("endue.terminal");

    const failed: BridgeResponse = {
      id: 2,
      ok: false,
      error: { code: "permission_denied", message: "no" },
    };
    expect(owners.claim(procSpawn, failed, "endue.terminal")).toEqual([]);
  });

  it("keeps the early events of at most 32 keys", () => {
    const owners = new Owners();
    for (let i = 0; i < 33; i++) route(owners, output(`p${i}`, "x"));
    expect(owners.claim(procSpawn, ok(2, { procId: "p0" }), "endue.terminal")).toEqual([]);
    expect(owners.claim(procSpawn, ok(2, { procId: "p32" }), "endue.terminal")).toEqual([
      output("p32", "x"),
    ]);
  });
});
