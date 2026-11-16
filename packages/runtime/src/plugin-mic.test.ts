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
  it("stops every capture of the plugin a window or frame key names, and nobody else's", () => {
    const b = bridge();
    const mic = pluginMic(b.fake);
    b.capturing(CAPTURES);
    mic.gone("example.notes@2");
    expect(b.stopped()).toEqual(["a-1", "a-3"]);
    mic.gone("example.other");
    expect(b.stopped()).toEqual(["a-1", "a-3", "a-2"]);
  });

  it("follows the list in force: a capture that ended is not stopped again", () => {
    const b = bridge();
    const mic = pluginMic(b.fake);
    b.capturing(CAPTURES);
    b.capturing([{ captureId: "a-2", caller: "example.other" }]);
    mic.gone("example.notes");
    expect(b.stopped()).toEqual([]);
  });

  it("stops listening when disposed", () => {
    const b = bridge();
    const mic = pluginMic(b.fake);
    mic.dispose();
    expect(b.listening()).toBe(false);
  });
});
