import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type EventsSubscribePermission,
  type SettingsReadPermission,
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
const read = (...keys: string[]): SettingsReadPermission => ({ permission: "settings:read", keys });
const EVERY_A = read("example.a/*");
const VOICE = read("example.a/voice");
const MOTION = read("example.a/motion.reduce");

describe("the stub's settings", () => {
  it("keys belong to their owner", async () => {
    const { client } = setup();
    await expect(client.call("settings.set", { key: "voice", value: "calm" }, A)).resolves.toEqual(
      {},
    );
    await expect(client.call("settings.get", { key: "voice" }, B)).resolves.toEqual({});
    await expect(client.call("settings.get", { key: "voice" }, A)).resolves.toEqual({
      value: "calm",
    });
    await expect(client.call("settings.list", {}, B)).resolves.toEqual({ settings: [] });
    await expect(client.call("settings.list", {}, A)).resolves.toEqual({
      settings: [{ owner: "example.a", key: "voice", value: "calm" }],
    });
  });

  it("another owner's key needs a covering settings:read scope", async () => {
    const { client } = setup({
      grants: {
        "example.b": [read("example.a/*", "example.b/*")],
        "example.c": [VOICE],
      },
    });
    await client.call("settings.set", { key: "voice", value: "calm" }, A);
    await client.call("settings.set", { key: "motion.reduce", value: true }, A);
    await client.call("settings.set", { key: "voice", value: "bright" }, B);
    const get = (key: string, scope: SettingsReadPermission) => ({
      owner: "example.a",
      key,
      scope,
    });

    await expect(client.call("settings.get", get("voice", EVERY_A), A)).resolves.toEqual({
      value: "calm",
    });
    await expect(
      client.call("settings.get", get("voice", EVERY_A), { caller: "example.d" }),
    ).rejects.toMatchObject({ code: "permission_denied", permission: EVERY_A });
    await expect(client.call("settings.get", get("voice", EVERY_A), B)).resolves.toEqual({
      value: "calm",
    });
    await expect(client.call("settings.get", get("voice", VOICE), C)).resolves.toEqual({
      value: "calm",
    });
    await expect(
      client.call("settings.get", get("motion.reduce", MOTION), C),
    ).rejects.toMatchObject({ code: "permission_denied", permission: MOTION });
    await expect(client.call("settings.get", get("motion.reduce", VOICE), C)).rejects.toMatchObject(
      { code: "permission_denied", permission: VOICE },
    );
    await expect(client.call("settings.get", get("voice", EVERY_A), C)).rejects.toMatchObject({
      code: "permission_denied",
    });

    const scope = read("example.b/*", "example.a/*");
    await expect(client.call("settings.list", { scope }, B)).resolves.toEqual({
      settings: [
        { owner: "example.a", key: "motion.reduce", value: true },
        { owner: "example.a", key: "voice", value: "calm" },
        { owner: "example.b", key: "voice", value: "bright" },
      ],
    });
    await expect(client.call("settings.list", { scope: VOICE }, C)).resolves.toEqual({
      settings: [{ owner: "example.a", key: "voice", value: "calm" }],
    });
    await expect(client.call("settings.list", { scope }, C)).rejects.toMatchObject({
      code: "permission_denied",
      permission: scope,
    });
  });

  it("settings.changed reaches the owner and the covered subscribers", async () => {
    const subscribe: EventsSubscribePermission = {
      permission: "events:subscribe",
      names: ["settings.changed"],
    };
    const { client, core, events, settle } = setup({
      grants: { "example.b": [subscribe, EVERY_A], "example.c": [subscribe] },
    });
    for (const caller of [B, C])
      await client.call(
        "events.subscribe",
        { names: ["settings.changed"], scope: subscribe },
        caller,
      );
    await client.call("settings.set", { key: "voice", value: "calm" }, A);
    await settle();
    const changed = events.find((e) => e.event === "settings.changed");
    if (!changed) throw new Error("no settings.changed");
    expect(changed.data).toEqual({ owner: "example.a", key: "voice", value: "calm" });
    expect(core.audience(changed)).toEqual(["example.a", "example.b"]);
  });
});
