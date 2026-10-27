import { describe, expect, it } from "vitest";
import { BridgeCallError, connect, type HostMessage, type PluginMessage, type Transport } from "./index";

function fakeHost() {
  const sent: PluginMessage[] = [];
  let handler: ((message: HostMessage) => void) | undefined;
  const transport: Transport = {
    send: (message) => void sent.push(message),
    listen: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
  };
  const reply = (message: HostMessage) => handler?.(message);
  return { transport, sent, reply };
}

async function connected(state: unknown = undefined) {
  const host = fakeHost();
  const ready = connect(host.transport);
  host.reply({ type: "desk:init", pluginId: "example.a", state });
  return { host, ctx: await ready };
}

describe("connect", () => {
  it("says hello and waits for the host's init", async () => {
    const host = fakeHost();
    const ready = connect(host.transport);
    expect(host.sent).toEqual([{ type: "desk:hello" }]);
    host.reply({ type: "desk:init", pluginId: "example.a", state: { count: 2 } });
    const ctx = await ready;
    expect(ctx.pluginId).toBe("example.a");
    expect(ctx.state.get()).toEqual({ count: 2 });
  });
});

describe("bridge calls", () => {
  it("leave in one message per tick, and results resolve their calls", async () => {
    const { host, ctx } = await connected();
    const first = ctx.bridge.call("perm.query", {});
    const second = ctx.bridge.call("perm.revoke", { grantId: "g1" });
    await Promise.resolve();
    const batches = host.sent.filter((m) => m.type === "desk:calls");
    expect(batches).toHaveLength(1);
    const [batch] = batches;
    if (batch?.type !== "desk:calls") throw new Error("no batch");
    expect(batch.calls.map((c) => c.method)).toEqual(["perm.query", "perm.revoke"]);
    const [a, b] = batch.calls;
    host.reply({
      type: "desk:results",
      results: [
        { id: b?.id ?? 0, response: { id: b?.id ?? 0, ok: true, result: {} } },
        { id: a?.id ?? 0, response: { id: a?.id ?? 0, ok: true, result: { grants: [] } } },
      ],
    });
    await expect(first).resolves.toEqual({ grants: [] });
    await expect(second).resolves.toEqual({});
  });

  it("reject with the code when the core says no", async () => {
    const { host, ctx } = await connected();
    const call = ctx.bridge.call("perm.revoke", { grantId: "g9" });
    await Promise.resolve();
    const batch = host.sent.find((m) => m.type === "desk:calls");
    if (batch?.type !== "desk:calls") throw new Error("no batch");
    const id = batch.calls[0]?.id ?? 0;
    host.reply({
      type: "desk:results",
      results: [{ id, response: { id, ok: false, error: { code: "not_found", message: "no grant g9" } } }],
    });
    await expect(call).rejects.toBeInstanceOf(BridgeCallError);
    await expect(call).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("state and events", () => {
  it("sends state to the host and delivers host events", async () => {
    const { host, ctx } = await connected();
    ctx.state.set({ count: 3 });
    expect(ctx.state.get()).toEqual({ count: 3 });
    expect(host.sent).toContainEqual({ type: "desk:state", state: { count: 3 } });
    const seen: string[] = [];
    const off = ctx.bridge.onEvent((event) => seen.push(event.event));
    host.reply({
      type: "desk:event",
      event: { event: "plugin.changed", data: { plugin: "example.b", change: "updated", revision: 2 } },
    });
    off();
    host.reply({
      type: "desk:event",
      event: { event: "plugin.changed", data: { plugin: "example.b", change: "updated", revision: 3 } },
    });
    expect(seen).toEqual(["plugin.changed"]);
  });
});
