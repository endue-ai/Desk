import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { Commands } from "./commands";

const IDS = ["desk.files.open", "desk.files.save", "desk.files.recent"];

/** Commands on a stub core whose cmd.register waits for `release()`, counting the calls in flight. */
function gated(refuse = new Set<string>()) {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const flight = { now: 0, most: 0 };
  const stub = browserStub({
    ...registry.handlers,
    "cmd.register": async (params, caller) => {
      flight.now++;
      flight.most = Math.max(flight.most, flight.now);
      await gate;
      flight.now--;
      if (refuse.has(params.id)) throw new Error(`${params.id} refused`);
      return registry.handlers["cmd.register"]?.(params, caller) ?? {};
    },
  });
  const commands = new Commands(new BridgeClient(stub));
  for (const id of IDS) commands.define(id, { title: id, owner: "desk.files", run: () => id });
  return {
    commands,
    registry,
    flight,
    open: () => release(),
  };
}

describe("Commands: a pass of the registry", () => {
  it("sends the registrations of every built-in it turns on together, and settles once all are in", async () => {
    const { commands, registry, flight, open } = gated();
    await commands.settled();
    commands.setActive(["desk.files"]);
    await vi.waitFor(() => expect(flight.now).toBe(IDS.length));
    let settled = false;
    const done = commands.settled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    open();
    await done;
    expect(flight.most).toBe(IDS.length);
    expect(commands.list().map((c) => [c.id, c.provider])).toEqual(
      [...IDS].sort().map((id) => [id, "desk"]),
    );
    for (const id of IDS) expect(registry.providerOf(id)).toBe("desk");
    expect(await commands.run("desk.files.save")).toBe("desk.files.save");
  });

  it("leaves a refused registration out and tries it again on the next pass", async () => {
    const refuse = new Set(["desk.files.save"]);
    const { commands, open } = gated(refuse);
    open();
    commands.setActive(["desk.files"]);
    await commands.settled();
    expect(commands.has("desk.files.open")).toBe(true);
    expect(commands.has("desk.files.recent")).toBe(true);
    expect(commands.has("desk.files.save")).toBe(false);
    refuse.clear();
    commands.define("desk.files.revert", { title: "Revert", owner: "desk.files", run: () => 0 });
    await commands.settled();
    expect(commands.has("desk.files.save")).toBe(true);
    expect(commands.has("desk.files.revert")).toBe(true);
  });
});
