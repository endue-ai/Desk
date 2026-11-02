import { describe, expect, it } from "vitest";
import { BridgeClient } from "./client";
import { browserStub, stubCommands } from "./index";

const MANAGE = { permission: "perm:manage" as const };
const INVOKE = { permission: "cmd:invoke" as const, ids: ["*"] };

/** The stub with a clock the test moves, and the inspector holding perm:manage. */
function setup() {
  let ms = Date.parse("2026-11-02T09:00:00Z");
  const commands = stubCommands((event) => stub.emit(event), {
    grants: { "desk.inspector": [MANAGE] },
    now: () => new Date(ms).toISOString(),
  });
  const stub = browserStub({ ...commands.handlers }, commands.observe);
  const client = new BridgeClient(stub);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const advance = (by: number) => {
    ms += by;
  };
  const recent = async () =>
    (await client.call("cmd.recent", { scope: MANAGE }, { caller: "desk.inspector" })).invocations;
  return { client, settle, advance, recent };
}

describe("the stub's cmd.recent and plugin.stats", () => {
  it("lists invocations with caller, provider and milliseconds, the waiting ones without", async () => {
    const { client, settle, advance, recent } = setup();
    await client.call("cmd.register", { id: "desk.files.save", title: "Save" });
    await client.call(
      "cmd.register",
      { id: "desk.palette.pick", title: "Pick" },
      { caller: "desk.palette" },
    );
    advance(120);
    const saved = await client.call(
      "cmd.invoke",
      { id: "desk.files.save", scope: INVOKE },
      { caller: "desk.palette" },
    );
    advance(12);
    await client.call("cmd.answer", { invocationId: saved.invocationId, result: "ok" });
    advance(868);
    const picking = await client.call("cmd.invoke", { id: "desk.palette.pick", scope: INVOKE });
    await settle();
    expect(await recent()).toEqual([
      {
        invocationId: saved.invocationId,
        id: "desk.files.save",
        caller: "desk.palette",
        provider: "desk",
        at: "2026-11-02T09:00:00.120Z",
        durationMs: 12,
        ok: true,
      },
      {
        invocationId: picking.invocationId,
        id: "desk.palette.pick",
        caller: "desk",
        provider: "desk.palette",
        at: "2026-11-02T09:00:01.000Z",
      },
    ]);
    advance(40);
    await client.call(
      "cmd.answer",
      { invocationId: picking.invocationId, error: { code: "cancelled", message: "no" } },
      { caller: "desk.palette" },
    );
    expect((await recent())[1]).toMatchObject({ durationMs: 40, ok: false, error: "cancelled" });
  });

  it("keeps the last 200", async () => {
    const { client, recent } = setup();
    await client.call("cmd.register", { id: "desk.buffers.next", title: "Next" });
    for (let i = 0; i < 205; i++)
      await client.call("cmd.invoke", { id: "desk.buffers.next", scope: INVOKE });
    const listed = await recent();
    expect(listed).toHaveLength(200);
    expect(listed[0]?.invocationId).toBe("i-6");
  });

  it("counts every call the stub answered per caller over the last minute", async () => {
    const { client, advance } = setup();
    const query = (caller: string) => client.call("perm.query", {}, { caller });
    const stats = () =>
      client.call("plugin.stats", { scope: MANAGE }, { caller: "desk.inspector" });
    await query("example.a");
    await query("example.a");
    // Not served by stubCommands: unsupported, and counted as failed.
    await expect(
      client.call("store.get", { key: "k" }, { caller: "example.a" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await query("example.b");
    expect(await stats()).toEqual({
      windowSeconds: 60,
      callers: [
        { caller: "example.a", calls: 3, failed: 1 },
        { caller: "example.b", calls: 1, failed: 0 },
      ],
    });
    advance(61_000);
    await query("example.b");
    expect((await stats()).callers).toEqual([{ caller: "example.b", calls: 1, failed: 0 }]);
  });

  it("needs perm:manage", async () => {
    const { client } = setup();
    for (const method of ["cmd.recent", "plugin.stats"] as const)
      await expect(
        client.call(method, { scope: MANAGE }, { caller: "example.a" }),
      ).rejects.toMatchObject({ code: "permission_denied", permission: MANAGE });
  });
});
