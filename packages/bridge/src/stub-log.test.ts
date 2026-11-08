import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type EventsSubscribePermission,
  type StubOptions,
  stubCommands,
} from "./index";

function setup(options: StubOptions = {}) {
  const events: BridgeEvent[] = [];
  const core = stubCommands((event) => events.push(event), options);
  const client = new BridgeClient(browserStub(core.handlers));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { client, core, events, settle };
}

const A = { caller: "example.a" };
const B = { caller: "example.b" };
const C = { caller: "example.c" };
const LOG = { permission: "log:read" } as const;
const AT = "2026-10-30T09:00:00Z";

describe("the stub's log", () => {
  it("log.write stamps the time and the caller's channel; log.entry goes to subscribers holding log:read", async () => {
    const subscribe: EventsSubscribePermission = {
      permission: "events:subscribe",
      names: ["log.entry"],
    };
    const { client, core, events, settle } = setup({
      now: () => AT,
      grants: { "example.b": [subscribe, LOG], "example.c": [subscribe] },
    });
    for (const caller of [B, C])
      await client.call("events.subscribe", { names: ["log.entry"], scope: subscribe }, caller);
    await expect(
      client.call("log.write", { level: "info", message: "mounted", fields: { n: 1 } }, A),
    ).resolves.toEqual({});
    await client.call("log.write", { level: "warn", message: "slow" });
    await settle();
    const entries = events.flatMap((e) => (e.event === "log.entry" ? [e] : []));
    expect(entries.map((e) => e.data)).toEqual([
      { at: AT, channel: "example.a", level: "info", message: "mounted", fields: { n: 1 } },
      { at: AT, channel: "desk", level: "warn", message: "slow" },
    ]);
    expect(entries.map((e) => core.audience(e))).toEqual([["example.b"], ["example.b"]]);
  });

  it("log.tail needs log:read and returns the latest, oldest first", async () => {
    const { client } = setup({ grants: { "example.b": [LOG] } });
    await expect(client.call("log.tail", { scope: LOG }, A)).rejects.toMatchObject({
      code: "permission_denied",
      permission: LOG,
    });
    for (let n = 1; n <= 101; n++)
      await client.call("log.write", { level: "debug", message: `m${n}` }, n % 2 ? A : C);
    const messages = async (params: { channel?: string; count?: number }) =>
      (await client.call("log.tail", { ...params, scope: LOG }, B)).entries.map((e) => e.message);

    const latest = await messages({});
    expect(latest).toHaveLength(100);
    expect([latest[0], latest.at(-1)]).toEqual(["m2", "m101"]);
    expect(await messages({ count: 2 })).toEqual(["m100", "m101"]);
    const own = await client.call("log.tail", { channel: "example.a", scope: LOG }, B);
    expect(own.entries).toHaveLength(51);
    expect(new Set(own.entries.map((e) => e.channel))).toEqual(new Set(["example.a"]));
    await expect(client.call("log.tail", { count: 1001, scope: LOG }, B)).rejects.toMatchObject({
      code: "invalid_params",
    });
    await expect(client.call("log.tail", { count: 1000, scope: LOG })).resolves.toMatchObject({
      entries: expect.any(Array),
    });
  });
});
