import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type FsReadPermission,
  type FsWritePermission,
  stubCommands,
} from "./index";

const READ: FsReadPermission = { permission: "fs:read", paths: ["~/Notes/**"] };
const WRITE: FsWritePermission = { permission: "fs:write", paths: ["~/Notes/**"] };
const NOTES = { caller: "example.notes" };
const ALL = { permission: "cmd:invoke" as const, ids: ["*"] };

function desk() {
  const events: BridgeEvent[] = [];
  const core = stubCommands((event) => events.push(event), {
    grants: { "example.notes": [READ, WRITE] },
    files: { "~/Notes/plan.md": "# one" },
  });
  const bridge = new BridgeClient(browserStub(core.handlers));
  return { bridge, events };
}

/** The args of the latest cmd.invoked of `id`, after the events of this tick have left. */
async function invoked(events: BridgeEvent[], id: string) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const last = events.filter((e) => e.event === "cmd.invoked" && e.data.id === id).at(-1);
  if (!last || last.event !== "cmd.invoked") throw new Error(`no cmd.invoked of ${id}`);
  return last.data;
}

describe("the stub's undo stack", () => {
  it("undoes an answered invocation with { args, result }, redoes it, and keeps no failure", async () => {
    const { bridge, events } = desk();
    await bridge.call(
      "cmd.register",
      { id: "example.notes.delete", title: "Delete", undo: "example.notes.restore" },
      NOTES,
    );
    await bridge.call("cmd.register", { id: "example.notes.restore", title: "Restore" }, NOTES);
    const listed = await bridge.call("cmd.list", { scope: ALL });
    expect(listed.commands.find((c) => c.id === "example.notes.delete")?.undo).toBe(
      "example.notes.restore",
    );

    const { invocationId } = await bridge.call("cmd.invoke", {
      id: "example.notes.delete",
      args: { name: "a" },
      scope: ALL,
    });
    await bridge.call("cmd.answer", { invocationId, result: { kept: "trash/a" } }, NOTES);

    const undone = await bridge.call("cmd.undo", { scope: ALL });
    expect(undone.undone).toMatchObject({
      command: "example.notes.delete",
      inverse: "example.notes.restore",
      caller: "desk",
    });
    expect((await invoked(events, "example.notes.restore")).args).toEqual({
      args: { name: "a" },
      result: { kept: "trash/a" },
    });
    expect(events.some((e) => e.event === "cmd.undone")).toBe(true);

    const redone = await bridge.call("cmd.redo", { scope: ALL });
    expect(redone.undone?.command).toBe("example.notes.delete");
    expect((await invoked(events, "example.notes.delete")).args).toEqual({ name: "a" });
    expect(await bridge.call("cmd.redo", { scope: ALL })).toEqual({});

    const failing = await bridge.call("cmd.invoke", {
      id: "example.notes.delete",
      args: { name: "b" },
      scope: ALL,
    });
    await bridge.call(
      "cmd.answer",
      { invocationId: failing.invocationId, error: { code: "failed", message: "no" } },
      NOTES,
    );
    expect(await bridge.call("cmd.undo", { scope: ALL })).toEqual({});
  });

  it("undoes a write by restoring the version it kept, and redoes it", async () => {
    const { bridge } = desk();
    await bridge.call(
      "fs.write",
      { path: "~/Notes/plan.md", content: "# two", scope: WRITE },
      NOTES,
    );
    const read = async () =>
      (await bridge.call("fs.read", { path: "~/Notes/plan.md", scope: READ }, NOTES)).content;
    const undone = await bridge.call("cmd.undo", { scope: ALL });
    expect(undone.undone).toMatchObject({ command: "fs.write", inverse: "fs.restore" });
    expect(await read()).toBe("# one");
    await bridge.call("cmd.redo", { scope: ALL });
    expect(await read()).toBe("# two");
  });

  it("drops an entry whose inverse is gone, so the one before is next", async () => {
    const { bridge } = desk();
    for (const [id, undo] of [
      ["example.notes.delete", "example.notes.restore"],
      ["example.notes.pin", "example.notes.unpin"],
    ] as const) {
      await bridge.call("cmd.register", { id, title: id, undo }, NOTES);
      await bridge.call("cmd.register", { id: undo, title: undo }, NOTES);
      const { invocationId } = await bridge.call("cmd.invoke", { id, scope: ALL });
      await bridge.call("cmd.answer", { invocationId, result: id }, NOTES);
    }
    await bridge.call("cmd.unregister", { id: "example.notes.unpin" }, NOTES);
    await expect(bridge.call("cmd.undo", { scope: ALL })).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("example.notes.pin cannot be undone"),
    });
    expect((await bridge.call("cmd.undo", { scope: ALL })).undone?.command).toBe(
      "example.notes.delete",
    );
  });

  it("needs a scope covering the inverse, and the entry stays", async () => {
    const { bridge } = desk();
    await bridge.call(
      "fs.write",
      { path: "~/Notes/plan.md", content: "# two", scope: WRITE },
      NOTES,
    );
    const narrow = { permission: "cmd:invoke" as const, ids: ["example.*"] };
    await expect(bridge.call("cmd.undo", { scope: narrow }, NOTES)).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect((await bridge.call("cmd.undo", { scope: ALL })).undone?.command).toBe("fs.write");
  });
});
