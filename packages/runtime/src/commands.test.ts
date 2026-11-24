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
  it("offers a built-in to agents with what it says of itself (ADR 0088)", async () => {
    const { commands, client } = setup();
    commands.define("desk.buffers.list", {
      title: "List open buffers",
      owner: "desk",
      run: () => [],
      agent: { description: "What is open on the desk.", readOnly: true },
    });
    commands.define("desk.keys.quit", { title: "Quit", owner: "desk", run: () => null });
    await commands.settled();
    const { tools } = await client.call("cmd.tools", {});
    expect(tools).toEqual([
      {
        name: "desk_buffers_list",
        command: "desk.buffers.list",
        title: "List open buffers",
        description: "What is open on the desk.",
        readOnly: true,
        provider: "desk",
        granted: true,
      },
    ]);
  });

  it("knows which registered commands only read, as a proposed view's source must (ADR 0367)", async () => {
    const { commands, client } = setup();
    const notes = { caller: "example.notes" };
    await client.call(
      "cmd.register",
      { id: "example.notes.list", title: "List", readOnly: true },
      notes,
    );
    await client.call("cmd.register", { id: "example.notes.send", title: "Send" }, notes);
    commands.retitle();
    await commands.settled();
    expect(commands.has("example.notes.send")).toBe(true);
    expect(commands.readOnly("example.notes.list")).toBe(true);
    expect(commands.readOnly("example.notes.send")).toBe(false);
    expect(commands.readOnly("example.notes.gone")).toBe(false);
  });

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

  it("tells a watcher of each built-in the core asks it to run, who asked, and what it answered", async () => {
    const { commands, client } = setup();
    commands.define("desk.windows.move", {
      title: "Move",
      owner: "desk",
      run: (args) => ({ window: (args as { window?: string }).window ?? "in-use", x: 40 }),
    });
    commands.define("desk.files.save", {
      title: "Save",
      owner: "desk",
      run: () => {
        throw new Error("disk full");
      },
    });
    await commands.settled();
    const seen: unknown[] = [];
    const off = commands.watchRuns((run) => {
      seen.push(run);
      return (result) => seen.push(result);
    });
    const all = { permission: "cmd:invoke" as const, ids: ["*"] };
    const ask = (id: string, args: Record<string, unknown>, caller: string) =>
      client.call("cmd.invoke", { id, args, scope: all }, { caller });
    await ask("desk.windows.move", { window: "w1", x: 40 }, "agent:eris");
    await expect.poll(() => seen.length).toBe(2);
    expect(seen).toEqual([
      { id: "desk.windows.move", args: { window: "w1", x: 40 }, caller: "agent:eris" },
      { window: "w1", x: 40 },
    ]);
    // The person's own run is heard too, as the desk's; a command that fails answers nothing.
    await commands.run("desk.windows.move");
    await commands.run("desk.files.save").catch(() => undefined);
    expect(seen.slice(2)).toEqual([
      { id: "desk.windows.move", args: undefined, caller: "desk" },
      { window: "in-use", x: 40 },
      { id: "desk.files.save", args: undefined, caller: "desk" },
    ]);
    off();
    await commands.run("desk.windows.move");
    expect(seen).toHaveLength(5);
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
