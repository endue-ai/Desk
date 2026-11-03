import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "./plugins";

describe("plugin requests after a window recreates its frame", () => {
  it("waits for the current frame's hello before delivering a file request", async () => {
    const info: PluginInfo = {
      id: "endue.images",
      status: "ready",
      enabled: true,
      builtIn: true,
      revision: 1,
      manifest: { id: "endue.images", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
    };
    let receive = (_event: MessageEvent) => {};
    const win = {
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
      removeEventListener() {},
    } as unknown as Window;
    const frame = () => ({ postMessage: vi.fn() }) as unknown as Window;
    let current = frame();
    const host = new PluginHost(
      {
        bridge: new BridgeClient(browserStub({ "plugin.list": () => ({ plugins: [info] }) })),
        win,
        open() {},
        close() {},
        reload() {},
        frame: () => current,
      },
      { url: () => "about:blank" },
    );
    await host.start();
    const send = (data: unknown) => receive({ source: current, data } as MessageEvent);
    send({ type: "desk:hello" });
    expect(host.greeted(info.id)).toBe(true);
    current = frame();
    expect(host.greeted(info.id)).toBe(false);
    const answer = host.request(info.id, "desk.buffers.show", {
      buffer: "file:a.png",
      path: "a.png",
    });
    await Promise.resolve();
    expect(current.postMessage).not.toHaveBeenCalled();
    send({ type: "desk:hello" });
    await Promise.resolve();
    expect(current.postMessage).toHaveBeenLastCalledWith(
      {
        type: "desk:command",
        name: "desk.buffers.show",
        call: 1,
        args: { buffer: "file:a.png", path: "a.png" },
      },
      "*",
    );
    send({ type: "desk:reply", call: 1, ok: true, result: "shown" });
    await expect(answer).resolves.toBe("shown");
    const cancelled = host.request(info.id, "desk.buffers.show", { buffer: "file:b.png" });
    host.unmount(info.id);
    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    host.stop();
  });
});
