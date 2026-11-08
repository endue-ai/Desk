// A command run for a person's gesture says why it failed (#582): one error notice naming the
// command and the reason, and a log line; `cancelled` (the person backed out) says nothing.
import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandError, Commands } from "./commands";
import { runGesture } from "./gesture";
import type { NoticeInput } from "./notify";

/** A real registry on the browser stub, and a notice sink that keeps what it is told. */
async function desk(run: () => unknown) {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const commands = new Commands(new BridgeClient(stub));
  commands.define("desk.files.save", { title: "Save the file", owner: "desk", run });
  await commands.settled();
  const notices: NoticeInput[] = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  return { commands, notices, log, notify: (input: NoticeInput) => void notices.push(input) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runGesture", () => {
  it("a failing command posts one error notice naming the command and the reason, and logs it", async () => {
    const d = await desk(() => {
      throw new Error("disk is full");
    });
    await expect(runGesture(d, "desk.files.save")).resolves.toBe(false);
    expect(d.notices).toEqual([
      { caller: "desk", title: "Save the file failed", body: "disk is full", level: "error" },
    ]);
    expect(d.log).toHaveBeenCalledOnce();
    expect(String(d.log.mock.calls[0]?.[0])).toContain("desk.files.save");
  });

  it("a cancelled command posts nothing and logs nothing", async () => {
    const d = await desk(() => {
      throw new CommandError("cancelled", "the person closed the pick");
    });
    await expect(runGesture(d, "desk.files.save")).resolves.toBe(false);
    expect(d.notices).toEqual([]);
    expect(d.log).not.toHaveBeenCalled();
  });

  it("a command that answers posts nothing, and one the registry does not know is named by its id", async () => {
    const d = await desk(() => "saved");
    await expect(runGesture(d, "desk.files.save", { buffer: "b1" })).resolves.toBe(true);
    expect(d.notices).toEqual([]);
    await expect(runGesture(d, "example.nowhere")).resolves.toBe(false);
    expect(d.notices).toHaveLength(1);
    expect(d.notices[0]).toMatchObject({
      caller: "desk",
      title: "example.nowhere failed",
      level: "error",
    });
    expect(d.notices[0]?.body).toBeTruthy();
  });
});
