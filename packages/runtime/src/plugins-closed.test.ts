// A plugin whose last window closed is closed for the session, not gone (#565): the commands its
// manifest declares stay in the core's registry, so the palette lists them and their keys still
// work, and running one opens the plugin's window again. Turning it off takes them away.
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

async function host() {
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [NOTES] }),
    "cmd.register": () => ({}),
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
  const open = vi.fn();
  const show = vi.fn();
  const plugins = new PluginHost(
    {
      bridge: new BridgeClient(stub),
      win,
      open,
      close() {},
      reload() {},
      frame: () => frame,
      show,
    },
    { url: () => "about:blank" },
  );
  await plugins.start();
  const message = (data: unknown) => receive({ source: frame, data } as unknown as MessageEvent);
  const hello = () => message({ type: "desk:hello" });
  const calls = (method: string) =>
    stub.log
      .filter((l) => l.request.method === method)
      .map((l) => ({ caller: l.caller, params: l.request.params as Record<string, unknown> }));
  const delivered = () =>
    frame.postMessage.mock.calls
      .map(([m]) => (m as { event?: BridgeEvent }).event)
      .flatMap((event) => (event?.event === "cmd.invoked" ? [event.data.invocationId] : []));
  return { stub, plugins, open, show, hello, message, calls, delivered };
}

describe("a plugin whose last window closed (#565)", () => {
  it("keeps the commands its manifest declares", async () => {
    const { plugins, hello, calls } = await host();
    hello();
    await settle();
    plugins.unmount(NOTES.id);
    await settle();
    expect(calls("cmd.unregister")).toEqual([]);
    plugins.stop();
  });

  it("opens its window when one of them runs, and the invocation reaches the new page", async () => {
    const { stub, plugins, open, show, hello, calls, delivered } = await host();
    hello();
    await settle();
    plugins.unmount(NOTES.id);
    stub.emit(invoked("i-1"));
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenCalledWith(NOTES.id, true);
    expect(plugins.mounted()).toEqual([NOTES.id]);
    expect(delivered()).toEqual([]);
    hello();
    expect(delivered()).toEqual(["i-1"]);
    expect(calls("cmd.answer")).toEqual([]);
    plugins.stop();
  });

  it("takes back a command its page registered itself", async () => {
    const { plugins, hello, message, calls } = await host();
    hello();
    const request = {
      id: "r-1",
      method: "cmd.register",
      params: { id: "test.notes.later", title: "Later" },
    };
    message({ type: "desk:calls", calls: [request] });
    await settle();
    plugins.unmount(NOTES.id);
    await settle();
    expect(calls("cmd.unregister")).toEqual([
      { caller: NOTES.id, params: { id: "test.notes.later" } },
    ]);
    plugins.stop();
  });

  it("takes them all away when it is turned off afterwards", async () => {
    const { stub, plugins, hello, calls } = await host();
    hello();
    await settle();
    plugins.unmount(NOTES.id);
    stub.emit({
      event: "plugin.changed",
      data: { plugin: NOTES.id, change: "disabled", revision: 1 },
    } as unknown as BridgeEvent);
    await settle();
    expect(calls("cmd.unregister")).toEqual([
      { caller: NOTES.id, params: { id: "test.notes.open" } },
    ]);
    plugins.stop();
  });
});
