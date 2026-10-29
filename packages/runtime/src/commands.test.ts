import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type StubCommands,
  stubCommands,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { CommandError, Commands } from "./commands";

/** A runtime-side Commands on a stub core that keeps the registry, and a client for plugins. */
function setup(): { commands: Commands; client: BridgeClient; registry: StubCommands } {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const client = new BridgeClient(stub);
  return { commands: new Commands(client), client, registry };
}

/** A plugin that provides `id` and answers every invocation with `answer(args)`. */
async function provide(
  client: BridgeClient,
  plugin: string,
  id: string,
  answer: (args: unknown) => unknown,
) {
  await client.call("cmd.register", { id, title: id }, { caller: plugin });
  client.onEvent((event) => {
    if (event.event !== "cmd.invoked" || event.data.id !== id) return;
    const { invocationId, args } = event.data;
    void Promise.resolve()
      .then(() => answer(args))
      .then(
        (result) => client.call("cmd.answer", { invocationId, result }, { caller: plugin }),
        (e: Error) =>
          client.call(
            "cmd.answer",
            { invocationId, error: { code: "cancelled", message: e.message } },
            { caller: plugin },
          ),
      );
  });
}

describe("Commands", () => {
  it("registers a built-in while its owner is on, and runs it through the registry", async () => {
    const { commands, registry } = setup();
    commands.define("desk.buffers.next", { title: "Next", owner: "desk.buffers", run: () => 1 });
    commands.define("desk.keys.quit", { title: "Quit", owner: "desk", run: (_args, from) => from });
    await commands.settled();
    expect(commands.list().map((c) => [c.id, c.provider])).toEqual([["desk.keys.quit", "desk"]]);
    await expect(commands.run("desk.buffers.next")).rejects.toMatchObject({
      code: "unknown_command",
    });
    commands.setActive(["desk.buffers"]);
    await commands.settled();
    expect(registry.providerOf("desk.buffers.next")).toBe("desk");
    expect(await commands.run("desk.buffers.next")).toBe(1);
    expect(await commands.run("desk.keys.quit")).toEqual({});
    commands.setActive([]);
    await commands.settled();
    expect(commands.has("desk.buffers.next")).toBe(false);
  });

  it("runs a plugin's command and hands back its answer", async () => {
    const { commands, client } = setup();
    await provide(client, "example.notes", "example.notes.new", (args) => ({ made: args }));
    await commands.settled();
    expect(commands.providerOf("example.notes.new")).toBe("example.notes");
    const runs: unknown[] = [];
    commands.onRun((run) => runs.push(run));
    expect(await commands.run("example.notes.new", { title: "a" })).toEqual({
      made: { title: "a" },
    });
    expect(runs).toEqual([{ id: "example.notes.new", args: { title: "a" }, ok: true }]);
  });

  it("tells a built-in which plugin invoked it", async () => {
    const { commands, client } = setup();
    commands.define("desk.buffers.open", {
      title: "Open",
      owner: "desk",
      run: (_args, from) => from.caller,
    });
    await commands.settled();
    const answers: Array<{ invocationId: string }> = [];
    client.onEvent((e) => {
      if (e.event === "cmd.answered") answers.push(e.data);
    });
    const { invocationId } = await client.call(
      "cmd.invoke",
      { id: "desk.buffers.open", scope: { permission: "cmd:invoke", ids: ["*"] } },
      { caller: "example.notes" },
    );
    await expect.poll(() => answers.length).toBe(1);
    const answer = answers[0];
    expect(answer?.invocationId).toBe(invocationId);
    expect(answer).toMatchObject({ ok: true, result: "example.notes", caller: "example.notes" });
  });

  it("turns a failed or cancelled answer into a CommandError with its code", async () => {
    const { commands, client } = setup();
    commands.define("desk.files.save", {
      title: "Save",
      owner: "desk",
      run: () => {
        throw new Error("disk full");
      },
    });
    await provide(client, "desk.palette", "desk.palette.pick", () => {
      throw new Error("nothing was picked");
    });
    await commands.settled();
    const failed = await commands.run("desk.files.save").catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(CommandError);
    expect(failed).toMatchObject({ code: "failed", message: "desk.files.save: disk full" });
    await expect(commands.run("desk.palette.pick")).rejects.toMatchObject({ code: "cancelled" });
  });
});
