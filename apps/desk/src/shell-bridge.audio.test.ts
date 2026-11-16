// The shell bridge's microphone over the core (#311): audio.capture.start and stop as the runtime,
// audio.frame decoded for the listener, and audio.capturing for the chrome's indicator.
import { type BridgeAdapter, BridgeClient, browserStub } from "@endue-ai/bridge";
import type { ShellBridge } from "@endue-ai/runtime";
import { describe, expect, test } from "vitest";
import { shellBridge } from "./shell-bridge";

const SCOPE = { permission: "audio:capture" };

type Audio = Required<ShellBridge["audio"]>;
type CaptureFrame = Parameters<Parameters<Audio["capture"]>[0]>[0];
type CaptureInForce = Parameters<Parameters<Audio["captures"]>[0]>[0][number];

function setup() {
  const stub = browserStub({
    "audio.capture.start": () => ({ captureId: "c1" }),
    "audio.capture.stop": () => ({}),
  });
  const adapter: BridgeAdapter = {
    name: "test",
    call: (request, caller) => stub.call(request, caller),
    onEvent: (listener) => stub.onEvent(listener),
  };
  const calls = () => stub.log.map(({ caller, request }) => ({ caller, request }));
  return { stub, bridge: shellBridge(new BridgeClient(adapter)), calls };
}

/** Two LINEAR16 samples, 0x7fff and -0x8000, little-endian, as base64. */
const PCM = btoa(String.fromCharCode(0xff, 0x7f, 0x00, 0x80));

describe("the shell bridge's microphone", () => {
  test("capture goes over the core", async () => {
    const { bridge, calls, stub } = setup();
    const frames: CaptureFrame[] = [];
    const capture = await bridge.audio.capture?.((frame) => frames.push(frame));
    expect(capture?.captureId).toBe("c1");
    const [start] = calls();
    expect(start?.request).toMatchObject({
      method: "audio.capture.start",
      params: { scope: SCOPE },
    });

    stub.emit({
      event: "audio.frame",
      data: { captureId: "c1", atMs: 20, sampleRate: 16000, pcm: PCM, rmsDb: -3, peakDb: 0 },
    });
    stub.emit({
      event: "audio.frame",
      data: { captureId: "other", atMs: 0, sampleRate: 16000, pcm: PCM, rmsDb: -9, peakDb: -6 },
    });
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0]?.samples ?? [])).toEqual([32767, -32768]);
    expect(frames[0]).toMatchObject({ atMs: 20, sampleRate: 16000, rmsDb: -3, peakDb: 0 });

    await capture?.stop();
    expect(calls().at(-1)?.request).toMatchObject({
      method: "audio.capture.stop",
      params: { captureId: "c1", scope: SCOPE },
    });
    stub.emit({
      event: "audio.frame",
      data: { captureId: "c1", atMs: 40, sampleRate: 16000, pcm: PCM, rmsDb: -3, peakDb: 0 },
    });
    expect(frames).toHaveLength(1);
  });

  test("a refused capture is null", async () => {
    const stub = browserStub({});
    const adapter: BridgeAdapter = {
      name: "test",
      call: (request, caller) => stub.call(request, caller),
      onEvent: (listener) => stub.onEvent(listener),
    };
    const bridge = shellBridge(new BridgeClient(adapter));
    await expect(bridge.audio.capture?.(() => {})).resolves.toBeNull();
  });

  test("captures() follows audio.capturing and stopCapture stops any one", async () => {
    const { bridge, calls, stub } = setup();
    const seen: Array<readonly CaptureInForce[]> = [];
    const off = bridge.audio.captures?.((list) => seen.push(list));
    stub.emit({
      event: "audio.capturing",
      data: { captures: [{ captureId: "c9", caller: "example.notes" }] },
    });
    expect(seen).toEqual([[{ captureId: "c9", caller: "example.notes" }]]);
    await bridge.audio.stopCapture?.("c9");
    expect(calls().at(-1)?.request).toMatchObject({
      method: "audio.capture.stop",
      params: { captureId: "c9", scope: SCOPE },
    });
    off?.();
    stub.emit({ event: "audio.capturing", data: { captures: [] } });
    expect(seen).toHaveLength(1);
  });
});
