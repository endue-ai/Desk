// A cmd.invoked the host cannot deliver is answered, never dropped (#1): the provider went before
// the core heard it, or it sleeps and its frame cannot load. One that can still load waits for it.
import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "./plugins";

const NOTES: PluginInfo = {
  id: "test.notes",
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 1,
  manifest: {
    id: "test.notes",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: "Notes", placement: "center" }],
    contributes: { commands: [{ id: "test.notes.open", title: "Open" }] },
  },
} as PluginInfo;

function invoked(invocationId: string): BridgeEvent {
  const data = { invocationId, id: "test.notes.open", caller: "desk" };
  return { event: "cmd.invoked", data } as unknown as BridgeEvent;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function host(options: { wake?: () => boolean; register?: () => Promise<object> } = {}) {
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [NOTES] }),
    "cmd.register": options.register ?? (() => ({})),
    "cmd.unregister": () => ({}),
    "cmd.answer": () => ({}),
  });
  let receive = (_event: MessageEvent) => {};
  const win = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener() {},
  } as unknown as Window;
  const frame = { postMessage: vi.fn() } as unknown as Window & {
    postMessage: ReturnType<typeof vi.fn>;
  };
  const wake = vi.fn(options.wake ?? (() => true));
  const plugins = new PluginHost(
    {
      bridge: new BridgeClient(stub),
      win,
      open() {},
      close() {},
      reload() {},
      frame: () => frame,
      wake,
    },
    { url: () => "about:blank" },
  );
  await plugins.start();
  const hello = () =>
    receive({ source: frame, data: { type: "desk:hello" } } as unknown as MessageEvent);
  const calls = (method: string) =>
    stub.log
      .filter((l) => l.request.method === method)
      .map((l) => ({
        caller: l.caller,
        params: l.request.params as Record<string, unknown>,
      }));
  const delivered = () =>
    frame.postMessage.mock.calls
      .map(([message]) => (message as { event?: BridgeEvent }).event)
      .flatMap((event) => (event?.event === "cmd.invoked" ? [event.data.invocationId] : []));
  return { stub, plugins, frame, wake, hello, calls, delivered };
}

describe("a cmd.invoked the host cannot deliver (#1)", () => {
  it("is answered when its provider went before the core heard it", async () => {
    const { stub, plugins, hello, calls } = await host();
    hello();
    await settle();
    plugins.unmount(NOTES.id);
    stub.emit(invoked("i-1"));
    await settle();
    expect(calls("cmd.answer")).toEqual([
      {
        caller: NOTES.id,
        params: {
          invocationId: "i-1",
          error: { code: "failed", message: "test.notes is not running" },
        },
      },
    ]);
    plugins.stop();
  });

  it("goes back to the core when the registration came back after the plugin went", async () => {
    let registered = () => {};
    const register = () => new Promise<object>((resolve) => (registered = () => resolve({})));
    const { plugins, calls } = await host({ register });
    plugins.unmount(NOTES.id);
    registered();
    await settle();
    expect(calls("cmd.unregister")).toEqual([
      { caller: NOTES.id, params: { id: "test.notes.open" } },
    ]);
    plugins.stop();
  });

  it("is answered for a sleeping plugin whose frame cannot load, and not kept for later", async () => {
    const { stub, plugins, hello, calls, delivered, wake } = await host({ wake: () => false });
    hello();
    await settle();
    plugins.unloaded(NOTES.id, undefined);
    stub.emit(invoked("i-1"));
    await settle();
    expect(wake).toHaveBeenCalledWith(NOTES.id);
    expect(calls("cmd.answer")).toEqual([
      {
        caller: NOTES.id,
        params: {
          invocationId: "i-1",
          error: { code: "failed", message: "test.notes is asleep and its frame cannot load" },
        },
      },
    ]);
    hello();
    expect(delivered()).toEqual([]);
    plugins.stop();
  });

  it("waits while the frame loads: one wake, and every invocation reaches it after its hello", async () => {
    // The policy answers true once: the frame it loads is live from then on, before its hello.
    let loads = 0;
    const { stub, plugins, hello, calls, delivered, wake } = await host({
      wake: () => ++loads === 1,
    });
    hello();
    await settle();
    plugins.unloaded(NOTES.id, undefined);
    stub.emit(invoked("i-1"));
    stub.emit(invoked("i-2"));
    await settle();
    expect(wake).toHaveBeenCalledTimes(1);
    expect(calls("cmd.answer")).toEqual([]);
    hello();
    expect(delivered()).toEqual(["i-1", "i-2"]);
    plugins.stop();
  });
});
