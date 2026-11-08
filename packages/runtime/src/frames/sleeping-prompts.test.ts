import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "../plugins";

/** The permissions plugin: ready, enabled, holding perm:manage, with a right-hand surface. */
const permissions: PluginInfo = {
  id: "endue.permissions",
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest: {
    id: "endue.permissions",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    permissions: [{ permission: "perm:manage" }],
    surfaces: [{ id: "main", title: "Permissions", placement: "right" }],
  },
} as PluginInfo;

const prompt = {
  event: "perm.prompt",
  data: {
    promptId: "p-1",
    caller: "endue.images",
    permission: { permission: "fs:read", paths: ["~/Documents/Research/**"] },
    reason: "To open ~/Documents/Research/a.gif in Images",
    duration: "session",
  },
} as unknown as BridgeEvent;

async function host() {
  const stub = browserStub({ "plugin.list": () => ({ plugins: [permissions] }) });
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
  const wake = vi.fn(() => true);
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
  hello();
  const events = () =>
    frame.postMessage.mock.calls
      .map(([message]) => message as { type: string; event?: BridgeEvent })
      .filter((message) => message.type === "desk:event")
      .map((message) => message.event?.event);
  return { stub, plugins, frame, wake, hello, events };
}

describe("a permission prompt for an unloaded prompter (ADR 0070)", () => {
  it("wakes the frame and reaches it after its hello, so the request that asked is answered", async () => {
    const { stub, plugins, frame, wake, hello, events } = await host();
    plugins.unloaded(permissions.id, undefined);
    frame.postMessage.mockClear();

    stub.emit(prompt);
    expect(wake).toHaveBeenCalledWith(permissions.id);
    expect(events()).toEqual([]);

    hello();
    expect(events()).toEqual(["perm.prompt"]);
    plugins.stop();
  });

  it("keeps the prompt while the frame cannot load: the person may open the window later (#1)", async () => {
    const { stub, plugins, frame, wake, hello, events } = await host();
    wake.mockReturnValue(false);
    plugins.unloaded(permissions.id, undefined);
    frame.postMessage.mockClear();

    stub.emit(prompt);
    expect(wake).toHaveBeenCalledWith(permissions.id);
    expect(events()).toEqual([]);

    hello();
    expect(events()).toEqual(["perm.prompt"]);
    plugins.stop();
  });

  it("wakes it for an agent's approval too, and still drops what needs no answer", async () => {
    const { stub, plugins, frame, wake, hello, events } = await host();
    plugins.unloaded(permissions.id, undefined);
    frame.postMessage.mockClear();

    stub.emit({ event: "perm.changed", data: {} } as unknown as BridgeEvent);
    expect(wake).not.toHaveBeenCalled();
    const approval = { event: "perm.approval", data: { approvalId: "a-1" }, to: [permissions.id] };
    stub.emit(approval as unknown as BridgeEvent);
    expect(wake).toHaveBeenCalledWith(permissions.id);

    hello();
    expect(events()).toEqual(["perm.approval"]);
    plugins.stop();
  });
});
