// A plugin's microphone ends with its page (#311, ADR 0245): a window closing, a frame loading again
// or unloaded out of sight stops every capture its plugin holds, and nobody else's.
import type { BridgeEvent } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { pluginMic } from "./plugin-mic";

function bridge() {
  let listener: ((event: BridgeEvent) => void) | undefined;
  const call = vi.fn(async (_method: string, _params: unknown) => ({}));
  const fake = {
    call,
    onEvent: (l: (event: BridgeEvent) => void) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
  };
  const capturing = (captures: { captureId: string; caller: string }[]) =>
    listener?.({ event: "audio.capturing", data: { captures } });
  const stopped = () =>
    call.mock.calls
      .filter(([method]) => method === "audio.capture.stop")
      .map(([, params]) => (params as { captureId: string }).captureId);
  return { fake: fake as never, capturing, stopped, listening: () => listener !== undefined };
}

const CAPTURES = [
  { captureId: "a-1", caller: "example.notes" },
  { captureId: "a-2", caller: "example.other" },
  { captureId: "a-3", caller: "example.notes" },
];

describe("a plugin's microphone ends with its page", () => {
  it("a closing window stops its plugin's captures, then closes", () => {
    const b = bridge();
    const mic = pluginMic(b.fake);
    b.capturing(CAPTURES);
    const close = vi.fn();
    mic.ending(close)("example.notes@2");
    expect(b.stopped()).toEqual(["a-1", "a-3"]);
    expect(close).toHaveBeenCalledWith("example.notes@2");
  });

  it("a frame loading again stops them too", () => {
    const b = bridge();
    const mic = pluginMic(b.fake);
    b.capturing(CAPTURES);
    const reload = vi.fn();
    mic.ending(reload)("example.other", "plugin://example.other/index.html");
    expect(b.stopped()).toEqual(["a-2"]);
    expect(reload).toHaveBeenCalledWith("example.other", "plugin://example.other/index.html");
  });

  it("a frame unloaded out of sight stops them before the host hears it", () => {
    const b = bridge();
    const mic = pluginMic(b.fake);
    b.capturing(CAPTURES);
    const host = {
      unloaded: vi.fn(),
      greeted: (id: string) => id === "example.notes",
    };
    const wrapped = mic.host(host);
    expect(mic.host(host)).toBe(wrapped);
    expect(wrapped?.greeted("example.notes")).toBe(true);
    wrapped?.unloaded("example.notes", { kept: 1 });
    expect(b.stopped()).toEqual(["a-1", "a-3"]);
    expect(host.unloaded).toHaveBeenCalledWith("example.notes", { kept: 1 });
    expect(mic.host(undefined)).toBeUndefined();
  });

  it("stops nothing for a plugin that captures nothing, and stops listening when disposed", () => {
    const b = bridge();
    const mic = pluginMic(b.fake);
    b.capturing([]);
    mic.gone("example.notes");
    expect(b.stopped()).toEqual([]);
    mic.dispose();
    expect(b.listening()).toBe(false);
  });
});
