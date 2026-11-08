// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { HostMessage, PluginMessage, Transport } from "./protocol";
import { watchStart } from "./ready";
import { defineUiPlugin } from "./sdk";

function fakeHost() {
  const sent: PluginMessage[] = [];
  let handler: ((message: HostMessage) => void) | undefined;
  const transport: Transport = {
    send: (message) => void sent.push(message),
    listen: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
  };
  const init = () => handler?.({ type: "desk:init", pluginId: "example.a", state: undefined });
  return { transport, sent, init };
}

const kinds = (sent: PluginMessage[]) => sent.map((message) => message.type);

describe("defineUiPlugin and the first ready", () => {
  it("sends desk:ready once mount resolved", async () => {
    const host = fakeHost();
    const done = defineUiPlugin({ mount: async () => {} }, host.transport);
    host.init();
    await done;
    expect(kinds(host.sent)).toEqual(["desk:hello", "desk:ready"]);
  });

  it("sends desk:failed with the message, and no ready, when mount throws", async () => {
    const host = fakeHost();
    const done = defineUiPlugin(
      {
        mount: () => {
          throw new Error("boom");
        },
      },
      host.transport,
    );
    host.init();
    await expect(done).rejects.toThrow("boom");
    expect(host.sent).toContainEqual({ type: "desk:failed", message: "boom" });
    expect(kinds(host.sent)).not.toContain("desk:ready");
  });
});

/** A frame's window: errors are dispatched on it, and its parent hears what it posts. */
function frame() {
  const posted: unknown[] = [];
  const win = new EventTarget() as EventTarget & { parent: { postMessage(m: unknown): void } };
  win.parent = { postMessage: (message: unknown) => void posted.push(message) };
  return { win, posted };
}

describe("watchStart", () => {
  it("reports an uncaught error before ready as desk:failed, once", () => {
    const { win, posted } = frame();
    watchStart(win as unknown as Window);
    win.dispatchEvent(new ErrorEvent("error", { message: "main.js threw" }));
    win.dispatchEvent(new ErrorEvent("error", { message: "and again" }));
    expect(posted).toEqual([{ type: "desk:failed", message: "main.js threw" }]);
  });

  it("reports an unhandled rejection before ready", () => {
    const { win, posted } = frame();
    watchStart(win as unknown as Window);
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("never resolved");
    win.dispatchEvent(event);
    expect(posted).toEqual([{ type: "desk:failed", message: "never resolved" }]);
  });

  it("says nothing about errors after ready", () => {
    const { win, posted } = frame();
    const watch = watchStart(win as unknown as Window);
    watch.ready();
    win.dispatchEvent(new ErrorEvent("error", { message: "a command threw later" }));
    expect(posted).toEqual([{ type: "desk:ready" }]);
  });
});
