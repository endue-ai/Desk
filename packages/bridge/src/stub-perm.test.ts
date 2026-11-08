import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type Permission,
  type PermRequestResult,
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

function last<N extends BridgeEvent["event"]>(events: BridgeEvent[], name: N) {
  const event = events.findLast((e) => e.event === name);
  if (!event) throw new Error(`no ${name} event`);
  return event as Extract<BridgeEvent, { event: N }>;
}

const A = { caller: "example.a" };
const B = { caller: "example.b" };
const PERMS = { caller: "endue.permissions" };
const MANAGE = { permission: "perm:manage" } as const;
const NOTIFY = { permission: "ui:notify" } as const;
const LOG = { permission: "log:read" } as const;

describe("the stub's grants", () => {
  it("perm.list needs perm:manage and lists every caller's grants", async () => {
    const { client } = setup({ grants: { "endue.permissions": [MANAGE], "example.a": [NOTIFY] } });
    await expect(client.call("perm.list", { scope: MANAGE }, A)).rejects.toMatchObject({
      code: "permission_denied",
      permission: MANAGE,
    });
    const { grants } = await client.call("perm.list", { scope: MANAGE }, PERMS);
    expect(grants).toEqual([
      {
        caller: "endue.permissions",
        grant: {
          grantId: "g-1",
          permission: MANAGE,
          duration: "session",
          grantedAt: expect.any(String),
        },
      },
      {
        caller: "example.a",
        grant: {
          grantId: "g-2",
          permission: NOTIFY,
          duration: "session",
          grantedAt: expect.any(String),
        },
      },
    ]);
    const one = await client.call("perm.list", { caller: "example.a", scope: MANAGE }, PERMS);
    expect(one.grants.map((g) => g.caller)).toEqual(["example.a"]);
  });

  it("perm.request prompts perm:manage holders and the first perm.answer decides", async () => {
    const { client, core, events, settle } = setup({ grants: { "endue.permissions": [MANAGE] } });
    let result: PermRequestResult | undefined;
    const asked = client
      .call("perm.request", { permission: NOTIFY, reason: "to say hello", duration: "once" }, A)
      .then((r) => {
        result = r;
        return r;
      });
    await settle();
    const prompt = last(events, "perm.prompt");
    expect(prompt.data).toEqual({
      promptId: expect.any(String),
      caller: "example.a",
      permission: NOTIFY,
      reason: "to say hello",
      duration: "once",
    });
    expect(core.audience(prompt)).toEqual(["endue.permissions"]);
    expect(result).toBeUndefined();
    const { promptId } = prompt.data;
    await expect(
      client.call("perm.answer", { promptId, granted: true, scope: MANAGE }, A),
    ).rejects.toMatchObject({ code: "permission_denied", permission: MANAGE });
    await client.call(
      "perm.answer",
      { promptId, granted: true, duration: "session", scope: MANAGE },
      PERMS,
    );
    await expect(asked).resolves.toMatchObject({
      granted: true,
      grant: { permission: NOTIFY, duration: "session" },
    });
    await settle();
    const changed = last(events, "perm.changed");
    expect(changed.data).toEqual({ grantId: result?.grant?.grantId, change: "granted" });
    expect(core.audience(changed)).toEqual(["example.a"]);
    await expect(
      client.call("perm.answer", { promptId, granted: false, scope: MANAGE }, PERMS),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("without a prompter the prompt option decides, granted by default", async () => {
    const open = setup();
    await expect(
      open.client.call("perm.request", { permission: NOTIFY, reason: "r", duration: "always" }, A),
    ).resolves.toMatchObject({ granted: true, grant: { permission: NOTIFY, duration: "always" } });
    await open.settle();
    expect(open.events.map((e) => e.event)).toEqual(["perm.changed"]);

    const refusing = setup({ prompt: () => false });
    await expect(
      refusing.client.call("perm.request", { permission: NOTIFY, reason: "r" }, A),
    ).resolves.toEqual({ granted: false });
    expect((await refusing.client.call("perm.query", {}, A)).grants).toEqual([]);

    const held = setup({
      grants: { "example.a": [{ permission: "cmd:invoke", ids: ["desk.*"] }] },
      prompt: () => false,
    });
    const permission: Permission = { permission: "cmd:invoke", ids: ["desk.theme.toggle"] };
    const answer = await held.client.call("perm.request", { permission, reason: "r" }, A);
    expect(answer).toMatchObject({ granted: true, grant: { grantId: "g-1" } });
    await held.settle();
    expect(held.events).toEqual([]);
  });

  it("a once grant expires after the call it allows", async () => {
    const { client, core, events, settle } = setup();
    const { grant } = await client.call(
      "perm.request",
      { permission: LOG, reason: "r", duration: "once" },
      A,
    );
    await expect(client.call("log.tail", { scope: LOG }, A)).resolves.toEqual({ entries: [] });
    await settle();
    const expired = last(events, "perm.changed");
    expect(expired.data).toEqual({ grantId: grant?.grantId, change: "expired" });
    expect(core.audience(expired)).toEqual(["example.a"]);
    await expect(client.call("log.tail", { scope: LOG }, A)).rejects.toMatchObject({
      code: "permission_denied",
      permission: LOG,
    });
  });

  it("perm.revoke gives back own grants, and any grant with perm:manage", async () => {
    const { client, core, events, settle } = setup({
      grants: { "endue.permissions": [MANAGE], "example.a": [NOTIFY, LOG], "example.b": [NOTIFY] },
    });
    await expect(client.call("perm.revoke", { grantId: "g-2" }, A)).resolves.toEqual({});
    await settle();
    expect(last(events, "perm.changed").data).toEqual({ grantId: "g-2", change: "revoked" });
    await expect(client.call("perm.revoke", { grantId: "g-4" }, A)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      client.call("perm.revoke", { grantId: "g-4", scope: MANAGE }, A),
    ).rejects.toMatchObject({ code: "permission_denied", permission: MANAGE });
    await expect(
      client.call("perm.revoke", { grantId: "g-4", scope: MANAGE }, PERMS),
    ).resolves.toEqual({});
    await settle();
    const revoked = last(events, "perm.changed");
    expect(revoked.data).toEqual({ grantId: "g-4", change: "revoked" });
    expect(core.audience(revoked)).toContain("example.b");
    await expect(client.call("perm.revoke", { grantId: "g-99" }, A)).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await client.call("perm.query", {}, A)).grants.map((g) => g.grantId)).toEqual(["g-3"]);
    expect((await client.call("perm.query", {}, B)).grants).toEqual([]);
  });

  it("perm.query filters by a covering permission", async () => {
    const { client } = setup({
      grants: {
        "example.a": [
          { permission: "cmd:invoke", ids: ["desk.*"] },
          { permission: "fs:read", paths: ["~/Notes/**"] },
        ],
      },
    });
    const query = (permission: Permission) =>
      client.call("perm.query", { permission }, A).then((r) => r.grants.map((g) => g.grantId));
    expect(await query({ permission: "cmd:invoke", ids: ["desk.theme.toggle"] })).toEqual(["g-1"]);
    expect(await query({ permission: "cmd:invoke", ids: ["eris.say"] })).toEqual([]);
    expect(await query({ permission: "fs:read", paths: ["~/Notes/a.md"] })).toEqual(["g-2"]);
    expect(await query({ permission: "fs:read", paths: ["~/Mail/a.eml"] })).toEqual([]);
    expect(await query(NOTIFY)).toEqual([]);
  });
});
