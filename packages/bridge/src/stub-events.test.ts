import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type EventName,
  type EventsSubscribePermission,
  type StubOptions,
  stubCommands,
} from "./index";

function setup(options: StubOptions = {}) {
  const events: BridgeEvent[] = [];
  const core = stubCommands((event) => events.push(event), options);
  const client = new BridgeClient(browserStub(core.handlers));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const changed = () => {
    const event = events.findLast((e) => e.event === "cmd.changed");
    if (!event) throw new Error("no cmd.changed");
    return event;
  };
  return { client, core, changed, settle };
}

const A = { caller: "example.a" };
const B = { caller: "example.b" };
const subscribing = (...names: EventName[]): EventsSubscribePermission => ({
  permission: "events:subscribe",
  names,
});
const BOTH = subscribing("cmd.changed", "log.entry");
const COMMANDS = subscribing("cmd.changed");

describe("the stub's subscriptions", () => {
  it("events.subscribe needs a scope covering every name and delivers each event once", async () => {
    const refused = setup({ grants: { "example.a": [COMMANDS] } });
    await expect(
      refused.client.call(
        "events.subscribe",
        { names: ["cmd.changed", "log.entry"], scope: BOTH },
        A,
      ),
    ).rejects.toMatchObject({ code: "permission_denied", permission: BOTH });
    await expect(
      refused.client.call("events.subscribe", { names: ["log.entry"], scope: COMMANDS }, A),
    ).rejects.toMatchObject({ code: "permission_denied", permission: COMMANDS });

    const { client, core, changed, settle } = setup({ grants: { "example.a": [BOTH] } });
    const first = await client.call(
      "events.subscribe",
      { names: ["cmd.changed", "log.entry"], scope: BOTH },
      A,
    );
    expect(first).toEqual({ subscriptionId: expect.any(String) });
    const second = await client.call(
      "events.subscribe",
      { names: ["cmd.changed"], scope: COMMANDS },
      A,
    );
    expect(second.subscriptionId).not.toBe(first.subscriptionId);
    await client.call("cmd.register", { id: "example.b.go", title: "Go" }, B);
    await settle();
    expect(core.audience(changed())).toEqual(["example.a"]);
  });

  it("events.unsubscribe ends one of the caller's subscriptions", async () => {
    const { client, core, changed, settle } = setup({
      grants: { "example.a": [COMMANDS], "example.b": [COMMANDS] },
    });
    const subscribe = (caller: { caller: string }) =>
      client.call("events.subscribe", { names: ["cmd.changed"], scope: COMMANDS }, caller);
    const mine = await subscribe(A);
    const theirs = await subscribe(B);
    await expect(
      client.call("events.unsubscribe", { subscriptionId: "sub-99" }, A),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      client.call("events.unsubscribe", { subscriptionId: theirs.subscriptionId }, A),
    ).rejects.toMatchObject({ code: "not_found" });
    await client.call("cmd.register", { id: "example.c.go", title: "Go" }, { caller: "example.c" });
    await settle();
    expect(core.audience(changed())).toEqual(["example.a", "example.b"]);

    await expect(
      client.call("events.unsubscribe", { subscriptionId: mine.subscriptionId }, A),
    ).resolves.toEqual({});
    expect(core.audience(changed())).toEqual(["example.b"]);
    await expect(
      client.call("events.unsubscribe", { subscriptionId: mine.subscriptionId }, A),
    ).rejects.toMatchObject({ code: "not_found" });
    core.drop("example.b");
    expect(core.audience(changed())).toEqual([]);
  });

  it("a revoked events:subscribe grant ends the subscriptions it covered", async () => {
    const { client, core, changed, settle } = setup({ grants: { "example.a": [COMMANDS, BOTH] } });
    await client.call("events.subscribe", { names: ["cmd.changed"], scope: COMMANDS }, A);
    await client.call("events.subscribe", { names: ["log.entry"], scope: BOTH }, A);
    await client.call("cmd.register", { id: "example.b.go", title: "Go" }, B);
    await settle();
    await client.call("perm.revoke", { grantId: "g-1" }, A);
    expect(core.audience(changed())).toEqual(["example.a"]);
    await client.call("perm.revoke", { grantId: "g-2" }, A);
    expect(core.audience(changed())).toEqual([]);
  });
});
