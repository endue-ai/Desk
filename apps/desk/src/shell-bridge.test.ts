import {
  type BrainStatusResult,
  type BrainTurnKind,
  type BridgeAdapter,
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type StubHandlers,
} from "@endue-ai/bridge";
import { describe, expect, test } from "vitest";
import { shellBridge } from "./shell-bridge";

const SCOPE = { permission: "brain:converse" };
const READ_ONLY = "This conversation is open on another desk now, so this one is read-only.";

/** The shell bridge over the browser stub, counting the event listeners it holds. */
function setup(handlers: StubHandlers = {}) {
  const stub = browserStub(handlers);
  let listening = 0;
  const adapter: BridgeAdapter = {
    name: "test",
    call: (request, caller) => stub.call(request, caller),
    onEvent: (listener) => {
      listening += 1;
      const off = stub.onEvent(listener);
      return () => {
        listening -= 1;
        off();
      };
    },
  };
  const calls = () => stub.calls.map(({ method, params }) => ({ method, params }));
  return {
    stub,
    bridge: shellBridge(new BridgeClient(adapter)),
    calls,
    listening: () => listening,
  };
}

const turn = (turnId: string, kind: BrainTurnKind, text?: string): BridgeEvent => ({
  event: "brain.turn",
  data: text === undefined ? { turnId, kind } : { turnId, kind, text },
});

/** Let pending bridge answers arrive. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the shell bridge over the core", () => {
  test("storage maps get and set onto the desk store under the shell prefix", async () => {
    const data = new Map<string, unknown>();
    const { bridge, calls } = setup({
      "store.get": ({ key }) => (data.has(key) ? { value: data.get(key) } : {}),
      "store.set": ({ key, value }) => {
        data.set(key, value);
        return {};
      },
    });
    const layout = { desktop: 2, drawer: ["notes"] };
    await bridge.storage.set("layout", layout);
    expect(calls()).toEqual([
      { method: "store.set", params: { key: "shell.layout", value: layout } },
    ]);
    await expect(bridge.storage.get("layout")).resolves.toEqual(layout);
    expect(calls()[1]).toEqual({ method: "store.get", params: { key: "shell.layout" } });
    await expect(bridge.storage.get("never")).resolves.toBeUndefined();
  });

  test("perm.request maps mic and fs.read scopes and refuses the rest without a call", async () => {
    const { bridge, calls } = setup({
      "perm.request": ({ permission }) => ({ granted: permission.permission === "audio:capture" }),
    });
    await expect(bridge.perm.request("mic")).resolves.toBe(true);
    await expect(bridge.perm.request("fs.read:~/Documents")).resolves.toBe(false);
    expect(calls().map((c) => c.method)).toEqual(["perm.request", "perm.request"]);
    const [mic, documents] = calls().map((c) => c.params as Record<string, unknown>);
    expect(mic).toEqual({
      permission: { permission: "audio:capture" },
      reason: expect.any(String),
    });
    expect(documents).toEqual({
      permission: { permission: "fs:read", paths: ["~/Documents/**"] },
      reason: expect.any(String),
    });

    await expect(bridge.perm.request("calendar")).resolves.toBe(false);
    await expect(bridge.perm.request("mail")).resolves.toBe(false);
    expect(calls()).toHaveLength(2);
  });

  test("brain.say collects its turn's deltas into one reply", async () => {
    const { stub, bridge, calls, listening } = setup({ "brain.say": () => ({ turnId: "t7" }) });
    const reply = bridge.brain.say("hello?");
    await tick();
    stub.emit(turn("t7", "started"));
    stub.emit(turn("t7", "delta", "hel"));
    stub.emit(turn("t8", "delta", "nope"));
    stub.emit(turn("t7", "delta", "lo"));
    stub.emit(turn("t7", "completed"));
    const answer = await reply;
    expect(answer).toEqual({ text: "hello" });
    expect(answer).not.toHaveProperty("words");
    expect(calls()).toEqual([{ method: "brain.say", params: { text: "hello?", scope: SCOPE } }]);
    expect(listening()).toBe(0);
  });

  test("brain.say keeps its turn's events that arrive before the call answers", async () => {
    let emit: (event: BridgeEvent) => void = () => undefined;
    const { stub, bridge } = setup({
      // The core's events and its answer travel apart: the whole turn can come first.
      "brain.say": () => {
        for (const kind of ["started", "delta", "completed"] as const)
          emit(turn("t7", kind, kind === "delta" ? "early" : undefined));
        emit(turn("t6", "delta", "an older turn"));
        return { turnId: "t7" };
      },
    });
    emit = (event) => stub.emit(event);
    await expect(bridge.brain.say("hello?")).resolves.toEqual({ text: "early" });
  });

  test("brain.say waits through offline and answers the error sentence when the turn fails", async () => {
    const { stub, bridge, listening } = setup({ "brain.say": () => ({ turnId: "t7" }) });
    let settled = false;
    const reply = bridge.brain.say("hello?").finally(() => {
      settled = true;
    });
    await tick();
    stub.emit(turn("t7", "offline", "I can't reach endue right now."));
    stub.emit(turn("t7", "online"));
    await tick();
    expect(settled).toBe(false);
    stub.emit(turn("t7", "error", READ_ONLY));
    await expect(reply).resolves.toEqual({ text: READ_ONLY });
    expect(listening()).toBe(0);

    // A refused call rejects as the bridge answered it.
    const refused = setup();
    await expect(refused.bridge.brain.say("hello?")).rejects.toMatchObject({ code: "unsupported" });
    expect(refused.listening()).toBe(0);
  });

  test("brain.status maps brain.status and brain.use answers it unchanged", async () => {
    let status: BrainStatusResult = { mode: "cloud", credits: 12 };
    const { bridge, calls } = setup({ "brain.status": () => status });
    await expect(bridge.brain.status()).resolves.toEqual({ mode: "cloud", credits: 12 });
    status = { mode: "cloud" };
    await expect(bridge.brain.status()).resolves.toEqual({ mode: "cloud", credits: 0 });
    await expect(bridge.brain.use("local")).resolves.toEqual({ mode: "cloud", credits: 0 });
    status = { mode: "local", model: "llama-3.2-3b" };
    await expect(bridge.brain.status()).resolves.toEqual(status);
    status = { mode: "offline" };
    await expect(bridge.brain.use("cloud")).resolves.toEqual({ mode: "offline" });
    expect(calls()).toEqual(Array(5).fill({ method: "brain.status", params: { scope: SCOPE } }));
  });

  test("audio.levels is nine silent bands for both voices", () => {
    const { bridge, calls } = setup();
    const levels = bridge.audio.levels();
    expect(levels).not.toBeInstanceOf(Promise);
    expect(levels).toEqual({ user: Array(9).fill(0), eris: Array(9).fill(0) });
    expect(calls()).toEqual([]);
  });

  test("the directory methods pass their queries through under brain:converse", async () => {
    const page = { total: 0, page: 2, limit: 5, hasNextPage: false };
    const list = { items: [], pagination: page };
    const card = {
      agentId: "ag_1",
      name: "Mira",
      enabled: true,
      skills: [],
      capabilities: { streaming: true, maxConcurrentTasks: 2 },
    };
    const spaces = { items: [] };
    const tasks = { items: [], pagination: { ...page, page: 1 } };
    const { bridge, calls } = setup({
      "brain.agents.list": () => list,
      "brain.agents.card": () => card,
      "brain.spaces.list": () => spaces,
      "brain.tasks.list": () => tasks,
    });
    const query = { spaceId: "sp_home", status: "inactive", page: 2, limit: 5 } as const;
    await expect(bridge.agents.list(query)).resolves.toEqual(list);
    await expect(bridge.agents.list()).resolves.toEqual(list);
    await expect(bridge.agents.card("ag_1")).resolves.toEqual(card);
    await expect(bridge.spaces.list()).resolves.toEqual(spaces);
    await expect(bridge.a2a.tasks({ targetAgentId: "ag_1", status: "working" })).resolves.toEqual(
      tasks,
    );
    expect(calls()).toEqual([
      { method: "brain.agents.list", params: { ...query, scope: SCOPE } },
      { method: "brain.agents.list", params: { scope: SCOPE } },
      { method: "brain.agents.card", params: { agentId: "ag_1", scope: SCOPE } },
      { method: "brain.spaces.list", params: { scope: SCOPE } },
      {
        method: "brain.tasks.list",
        params: { targetAgentId: "ag_1", status: "working", scope: SCOPE },
      },
    ]);
  });
});
