// What the plugin host keeps for one plugin's windows (ADR 0398): sent now to that plugin only, and
// again after each of its hellos, after what every plugin gets.
import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "./plugins";

const info = (id: string) =>
  ({
    id,
    status: "ready",
    enabled: true,
    builtIn: false,
    revision: 1,
    manifest: {
      id,
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", title: id, placement: "center" }],
    },
  }) as PluginInfo;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
type Frame = Window & { postMessage: ReturnType<typeof vi.fn> };

async function host() {
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [info("test.notes"), info("test.other")] }),
    "cmd.register": () => ({}),
    "cmd.unregister": () => ({}),
  });
  let receive = (_event: MessageEvent) => {};
  const win = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener() {},
  } as unknown as Window;
  const frames = new Map<string, Frame>();
  const frame = (id: string) => {
    if (!frames.has(id)) frames.set(id, { postMessage: vi.fn() } as unknown as Frame);
    return frames.get(id) as Frame;
  };
  const plugins = new PluginHost(
    { bridge: new BridgeClient(stub), win, open() {}, close() {}, reload() {}, frame },
    { url: () => "about:blank" },
  );
  await plugins.start();
  const hello = async (id: string) => {
    frame(id).postMessage.mockClear();
    receive({ source: frame(id), data: { type: "desk:hello" } } as unknown as MessageEvent);
    await settle();
  };
  const types = (id: string) =>
    frame(id).postMessage.mock.calls.map(([m]) => (m as { type: string }).type);
  return { plugins, frame, hello, types };
}

describe("messages kept for one plugin (ADR 0398)", () => {
  it("go to that plugin's windows only, now and after its every hello, after the shared ones", async () => {
    const h = await host();
    await h.hello("test.notes");
    await h.hello("test.other");
    h.plugins.share({ type: "desk:theme" });
    h.frame("test.other").postMessage.mockClear();
    h.plugins.share({ type: "desk:custom", custom: { css: "a {}" } }, "test.notes");
    expect(h.frame("test.notes").postMessage).toHaveBeenLastCalledWith(
      { type: "desk:custom", custom: { css: "a {}" } },
      "*",
    );
    expect(h.types("test.other")).toEqual([]);
    await h.hello("test.notes");
    expect(h.types("test.notes")).toEqual(["desk:init", "desk:theme", "desk:custom"]);
    await h.hello("test.other");
    expect(h.types("test.other")).toEqual(["desk:init", "desk:theme"]);
  });

  it("are sent once and forgotten when dropped, so the next page hears none", async () => {
    const h = await host();
    await h.hello("test.notes");
    h.plugins.share({ type: "desk:custom", custom: { css: "a {}" } }, "test.notes");
    h.plugins.share({ type: "desk:custom", custom: {} }, "test.notes", true);
    expect(h.frame("test.notes").postMessage).toHaveBeenLastCalledWith(
      { type: "desk:custom", custom: {} },
      "*",
    );
    await h.hello("test.notes");
    expect(h.types("test.notes")).toEqual(["desk:init"]);
  });
});
