import { describe, expect, it, vi } from "vitest";
import type { Invocation } from "../../../packages/plugin-sdk/src/index";
import { wireCommands } from "../ui/commands.js";
import { container } from "../ui/parse.js";
import { createStore } from "../ui/store.js";

const web = container({ Id: "b".repeat(64), Name: "/web", State: { Status: "running" } });

function setup() {
  const store = createStore((fn) => fn());
  store.set({ containers: [web], engine: { status: "up", problem: "", kind: "", info: null } });
  const handlers = new Map<string, (args: unknown, invocation?: Partial<Invocation>) => unknown>();
  const act = { container: vi.fn(async () => true) };
  const engine = { load: vi.fn(async () => {}) };
  wireCommands(
    {
      commands: {
        on: (name: string, fn: typeof handlers extends Map<string, infer F> ? F : never) =>
          handlers.set(name, fn),
      },
    },
    { store, act, engine } as never,
  );
  return {
    act,
    engine,
    invoke: (id: string, args: unknown = {}, invocation?: Partial<Invocation>) => {
      const run = handlers.get(`endue.docker-studio.${id}`);
      if (!run) throw new Error(`Unknown Studio tool ${id}`);
      return run(args, invocation);
    },
  };
}

describe("Docker Studio agent operations", () => {
  it("reads volume and network collections as data", async () => {
    const { invoke, engine } = setup();
    await expect(invoke("volumes")).resolves.toEqual([]);
    await expect(invoke("networks")).resolves.toEqual([]);
    expect(engine.load.mock.calls).toEqual([["volumes"], ["networks"]]);
  });

  it("starts or stops through exact named commands and reuses a remove review", async () => {
    const { invoke, act } = setup();
    const args = { containers: ["web"] };
    await invoke("start", args);
    expect(act.container).toHaveBeenLastCalledWith(
      "start",
      [expect.objectContaining({ name: "web" })],
      false,
    );
    await invoke("stop", args);
    expect(act.container).toHaveBeenLastCalledWith(
      "stop",
      [expect.objectContaining({ name: "web" })],
      false,
    );
    await invoke("remove", args, { caller: "agent:eris", approved: true });
    expect(act.container).toHaveBeenLastCalledWith(
      "remove",
      [expect.objectContaining({ name: "web" })],
      true,
    );
  });
});
