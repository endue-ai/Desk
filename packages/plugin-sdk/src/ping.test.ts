// The SDK answers the desk's pings by itself (#39): from its import, whatever the plugin does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerPings } from "./ping";
import type { HostMessage, PluginMessage, Transport } from "./protocol";

/** A frame's window: messages are dispatched on it, and its parent hears what it posts. */
function frame() {
  const posted: unknown[] = [];
  const parent = { postMessage: (message: unknown) => void posted.push(message) };
  const win = new EventTarget() as EventTarget & { parent: typeof parent };
  win.parent = parent;
  const from = (source: unknown, data: unknown) =>
    win.dispatchEvent(Object.assign(new Event("message"), { data, source }));
  return { win, parent, posted, from };
}

describe("answerPings", () => {
  it("answers each ping from the parent with a pong of the same number", () => {
    const { win, parent, posted, from } = frame();
    answerPings(win);
    from(parent, { type: "desk:ping", n: 1 });
    from(parent, { type: "desk:ping", n: 2 });
    expect(posted).toEqual([
      { type: "desk:pong", n: 1 },
      { type: "desk:pong", n: 2 },
    ]);
  });

  it("answers no one but the parent, and nothing but pings", () => {
    const { win, parent, posted, from } = frame();
    answerPings(win);
    from({}, { type: "desk:ping", n: 1 });
    from(parent, { type: "desk:init", pluginId: "example.a", state: undefined });
    from(parent, null);
    expect(posted).toEqual([]);
  });

  it("stops answering once stopped", () => {
    const { win, parent, posted, from } = frame();
    answerPings(win)();
    from(parent, { type: "desk:ping", n: 1 });
    expect(posted).toEqual([]);
  });
});

describe("the SDK in a frame", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("answers pings from its import, while the plugin awaits a call the desk never answers", async () => {
    const { win, parent, posted, from } = frame();
    vi.stubGlobal("window", win);
    vi.resetModules();
    const sdk = await import("./sdk");
    from(parent, { type: "desk:ping", n: 7 });
    expect(posted).toContainEqual({ type: "desk:pong", n: 7 });

    // A plugin whose mount waits for ever on a bridge call: the transport never answers it.
    let init: ((message: HostMessage) => void) | undefined;
    const sent: PluginMessage[] = [];
    const transport: Transport = {
      send: (message) => void sent.push(message),
      listen: (handler) => {
        init = handler;
        return () => {};
      },
    };
    void sdk.defineUiPlugin(
      { mount: (ctx) => ctx.bridge.call("store.get", { key: "slow" }).then(() => {}) },
      transport,
    );
    init?.({ type: "desk:init", pluginId: "example.slow", state: undefined });
    await Promise.resolve();
    expect(sent.map((m) => m.type)).toContain("desk:hello");
    from(parent, { type: "desk:ping", n: 8 });
    expect(posted).toContainEqual({ type: "desk:pong", n: 8 });
  });
});
