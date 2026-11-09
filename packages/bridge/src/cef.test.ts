import { describe, expect, it } from "vitest";
import { cefAdapter, cefHost, type DeskNative, deskNative } from "./cef";

/** A native channel that records what the page sends and lets the test answer. */
function fakeNative() {
  const sent: Array<{ id: number; cmd: string; args: Record<string, unknown> }> = [];
  const native: DeskNative = { send: (text) => void sent.push(JSON.parse(text)) };
  const reply = (text: object) => native.onMessage?.(JSON.stringify(text));
  return { native, sent, reply };
}

describe("cefHost", () => {
  it("sends calls shaped like invoke and resolves or rejects them by id", async () => {
    const { native, sent, reply } = fakeNative();
    const host = cefHost(native);
    const ready = host.invoke("desk_ready", { status: "desk ready · bridge: cef" });
    const start = host.invoke("desk_start", {});
    expect(sent).toEqual([
      { id: 1, cmd: "desk_ready", args: { status: "desk ready · bridge: cef" } },
      { id: 2, cmd: "desk_start", args: {} },
    ]);
    reply({ id: 2, error: "no start" });
    reply({ id: 1, ok: true });
    await expect(ready).resolves.toBe(true);
    await expect(start).rejects.toThrow("no start");
  });

  it("hands events to their listeners until they stop listening", async () => {
    const { native, reply } = fakeNative();
    const host = cefHost(native);
    const heard: unknown[] = [];
    const off = await host.listen("bridge://event", (event) => heard.push(event.payload));
    reply({ event: "bridge://event", payload: { event: "cmd.changed" } });
    reply({ event: "other", payload: 1 });
    off();
    reply({ event: "bridge://event", payload: { event: "late" } });
    expect(heard).toEqual([{ event: "cmd.changed" }]);
  });

  it("ignores text that is not a message and replies to calls it never made", () => {
    const { native } = fakeNative();
    cefHost(native);
    expect(() => native.onMessage?.("not json")).not.toThrow();
    expect(() => native.onMessage?.(JSON.stringify({ id: 99, ok: 1 }))).not.toThrow();
  });
});

describe("cefAdapter", () => {
  it("calls bridge_call with the caller and is named cef", async () => {
    const { native, sent, reply } = fakeNative();
    const adapter = cefAdapter(cefHost(native));
    expect(adapter.name).toBe("cef");
    const answer = adapter.call({ method: "plugin.list", params: {} } as never, "endue.notes");
    expect(sent[0]).toMatchObject({
      cmd: "bridge_call",
      args: { request: { method: "plugin.list" }, caller: "endue.notes" },
    });
    reply({ id: sent[0]?.id, ok: { ok: true, result: [] } });
    await expect(answer).resolves.toEqual({ ok: true, result: [] });
  });
});

describe("deskNative", () => {
  it("finds the channel only when the shell put one there", () => {
    expect(deskNative({})).toBeUndefined();
    expect(deskNative({ __deskNative: { send: "no" } })).toBeUndefined();
    const native = { send: () => {} };
    expect(deskNative({ __deskNative: native })).toBe(native);
  });
});
