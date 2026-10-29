import { describe, expect, it } from "vitest";
import { BridgeClient } from "./client";
import { type BridgeEvent, browserStub, stubCommands } from "./index";

function setup() {
  const events: BridgeEvent[] = [];
  const commands = stubCommands((event) => {
    events.push(event);
    stub.emit(event);
  });
  const stub = browserStub({ ...commands.handlers });
  const client = new BridgeClient(stub);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { client, commands, events, settle };
}
const scope = { permission: "cmd:invoke" as const, ids: ["*"] };

describe("stubCommands", () => {
  it("keeps the core's rules: one provider per id, answers reach the caller", async () => {
    const { client, events, settle } = setup();
    await client.call(
      "cmd.register",
      { id: "desk.palette.pick", title: "Pick" },
      { caller: "desk.palette" },
    );
    await expect(
      client.call(
        "cmd.register",
        { id: "desk.palette.pick", title: "Mine" },
        { caller: "example.x" },
      ),
    ).rejects.toMatchObject({ code: "already_exists" });
    const { invocationId } = await client.call("cmd.invoke", {
      id: "desk.palette.pick",
      args: { n: 1 },
      scope,
    });
    await settle();
    expect(events.at(-1)).toEqual({
      event: "cmd.invoked",
      data: { invocationId, id: "desk.palette.pick", caller: "desk", args: { n: 1 } },
    });
    await expect(client.call("cmd.answer", { invocationId, result: "b" })).rejects.toMatchObject({
      code: "not_found",
    });
    await client.call("cmd.answer", { invocationId, result: "b" }, { caller: "desk.palette" });
    await settle();
    expect(events.at(-1)).toEqual({
      event: "cmd.answered",
      data: { invocationId, id: "desk.palette.pick", caller: "desk", ok: true, result: "b" },
    });
  });

  it("drops a stopped provider's commands and cancels what waited on it", async () => {
    const { client, commands, events, settle } = setup();
    await client.call(
      "cmd.register",
      { id: "example.notes.new", title: "New" },
      { caller: "example.notes" },
    );
    const { invocationId } = await client.call("cmd.invoke", { id: "example.notes.new", scope });
    commands.drop("example.notes");
    await settle();
    expect(commands.providerOf("example.notes.new")).toBeUndefined();
    expect(events.find((e) => e.event === "cmd.answered")).toMatchObject({
      data: { invocationId, ok: false, error: { code: "cancelled" } },
    });
    expect((await client.call("cmd.list", { scope })).commands).toEqual([]);
  });
});
