// Eris's ear without Web Speech (#311): inside CEF the page may have no speech recognition, so she
// listens through the bridge's audio.capture and shows the input level; nothing is recognised.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureFrame, MicCapture, ShellBridge } from "../bridge/types";
import { openMic } from "./ear";

/** A bridge microphone the test plays: it hands frames to the ear's listener. */
function fakeMic(refuse = false) {
  let onFrame: ((frame: CaptureFrame) => void) | undefined;
  let onEnded: (() => void) | undefined;
  const stop = vi.fn(async () => {});
  const audio: ShellBridge["audio"] = {
    levels: () => ({ user: [], eris: [] }),
    capture: vi.fn(async (listener: (frame: CaptureFrame) => void, ended?: () => void) => {
      if (refuse) return null;
      onFrame = listener;
      onEnded = ended;
      return { captureId: "c1", stop } satisfies MicCapture;
    }),
  };
  const frame = (samples: Int16Array, rmsDb: number) =>
    onFrame?.({ samples, sampleRate: 16000, rmsDb, peakDb: rmsDb + 3, atMs: 0 });
  return { audio, stop, frame, end: () => onEnded?.() };
}

/** 20 ms of a 500 Hz tone at `amplitude` (0..1), 16 kHz. */
const tone = (amplitude: number) =>
  Int16Array.from({ length: 320 }, (_, i) =>
    Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 500 * i) / 16000)),
  );

const sum = (bands: readonly number[]) => bands.reduce((a, b) => a + b, 0);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Eris's ear through audio.capture", () => {
  it("without Web Speech the ear listens through audio.capture", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const mic = fakeMic();
    const ear = await openMic("en", undefined, mic.audio);
    expect(ear?.live).toBe(true);
    expect(mic.audio.capture).toHaveBeenCalledTimes(1);

    mic.frame(tone(0.5), -9);
    const loud = sum(ear?.bands(0) ?? []);
    expect(loud).toBeGreaterThan(0);
    mic.frame(new Int16Array(320), -100);
    expect(sum(ear?.bands(20) ?? [])).toBe(0);

    await expect(ear?.close()).resolves.toBe("");
    expect(mic.stop).toHaveBeenCalledTimes(1);
  });

  it("an ended capture goes silent at once", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const mic = fakeMic();
    const ear = await openMic("en", undefined, mic.audio);
    mic.frame(tone(0.5), -9);
    expect(sum(ear?.bands(0) ?? [])).toBeGreaterThan(0);
    mic.end();
    expect(sum(ear?.bands(20) ?? [])).toBe(0);
  });

  it("a refused capture is no ear", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const mic = fakeMic(true);
    await expect(openMic("en", undefined, mic.audio)).resolves.toBeNull();
    expect(mic.audio.capture).toHaveBeenCalledTimes(1);
  });

  it("with Web Speech but no microphone of the page's own, the ear captures for the level", async () => {
    vi.stubGlobal(
      "SpeechRecognition",
      class {
        start() {}
        stop() {}
      },
    );
    const mic = fakeMic();
    // No AudioContext and no getUserMedia here, as in a CEF page that names Web Speech only.
    const ear = await openMic("en", undefined, mic.audio);
    expect(ear?.live).toBe(true);
    expect(mic.audio.capture).toHaveBeenCalledTimes(1);
  });

  it("with no microphone anywhere there is no ear", async () => {
    vi.stubGlobal("SpeechRecognition", class {});
    await expect(openMic("en", undefined, undefined)).resolves.toBeNull();
  });
});
