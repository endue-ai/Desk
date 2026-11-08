import { describe, expect, it } from "vitest";
import { readMidi } from "../ui/midi.js";
import { render, waveFor } from "../ui/synth.js";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (id: string, data: number[]) => [...ascii(id), ...be32(data.length), ...data];
const END = [0x00, 0xff, 0x2f, 0x00];
/** A delta time as a variable-length quantity. */
const vlq = (n: number) => {
  const out = [n & 0x7f];
  for (let rest = n >>> 7; rest > 0; rest >>>= 7) out.unshift((rest & 0x7f) | 0x80);
  return out;
};
const smf = (format: number, division: number, tracks: number[][]) =>
  Uint8Array.from([
    ...chunk("MThd", [0, format, 0, tracks.length, division >> 8, division & 255]),
    ...tracks.flatMap((track) => chunk("MTrk", [...track, ...END])),
  ]);

// Format 1 at 480 ticks a beat: 120 bpm, then 240 bpm from tick 960 (one second in).
const TEMPO = [
  ...[0, 0xff, 0x03, 4, ...ascii("Song")],
  ...[0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20],
  ...[...vlq(960), 0xff, 0x51, 3, 0x03, 0xd0, 0x90],
];
// A violin (program 40) on channel 1: C4 for a beat, then D4 for a beat at the new tempo.
const MELODY = [
  ...[0, 0xc0, 40],
  ...[0, 0x90, 60, 100],
  ...[...vlq(480), 0x80, 60, 64],
  ...[...vlq(480), 0x90, 62, 100],
  // Running status: a note-on with velocity 0 ends the note.
  ...[...vlq(480), 62, 0],
];
// Channel 10: a kick and a snare, half a beat each.
const DRUMS = [
  ...[0, 0x99, 36, 127],
  ...[...vlq(240), 0x89, 36, 0],
  ...[...vlq(240), 0x99, 38, 100],
  ...[...vlq(240), 38, 0],
];
const SONG = smf(1, 480, [TEMPO, MELODY, DRUMS]);

describe("the Standard MIDI File reader", () => {
  it("a format 1 file's notes, tempo changes and channel 10 percussion become timed events", () => {
    const song = readMidi(SONG);
    expect(song).toMatchObject({ format: 1, tracks: 3, division: 480, title: "Song" });
    expect(song.tempos).toEqual([
      { tick: 0, time: 0, bpm: 120 },
      { tick: 960, time: 1, bpm: 240 },
    ]);
    expect(song.notes).toEqual([
      { channel: 0, key: 60, velocity: 100, program: 40, start: 0, end: 0.5 },
      { channel: 9, key: 36, velocity: 127, program: 0, start: 0, end: 0.25 },
      { channel: 9, key: 38, velocity: 100, program: 0, start: 0.5, end: 0.75 },
      { channel: 0, key: 62, velocity: 100, program: 40, start: 1, end: 1.25 },
    ]);
    expect(song.duration).toBe(1.25);
  });

  it("reads format 0 and refuses format 2 and damaged files in words", () => {
    const zero = readMidi(smf(0, 96, [[0, 0x90, 69, 80, ...vlq(96), 0x80, 69, 0]]));
    expect(zero.notes).toEqual([
      { channel: 0, key: 69, velocity: 80, program: 0, start: 0, end: 0.5 },
    ]);
    expect(() => readMidi(smf(2, 96, [[]]))).toThrow(/format 2/);
    expect(() => readMidi(Uint8Array.from(ascii("MThd")))).toThrow(/damaged/);
    expect(() => readMidi(SONG.slice(0, 40))).toThrow(/damaged/);
  });
});

type Call = [string, ...number[]];
const param = () => {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: number[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    value: 0,
    setValueAtTime: record("set"),
    linearRampToValueAtTime: record("linear"),
    exponentialRampToValueAtTime: record("exponential"),
    setTargetAtTime: record("target"),
  };
};

/** When a source node was started and stopped. */
interface Timed {
  start?: number;
  stop?: number;
}

/** A scheduled source node: it records its own start and stop times. */
const timed = <T extends object>(extra: T) => {
  const times: Timed = {};
  return Object.assign(times, extra, {
    connect: () => {},
    start: (t: number) => {
      times.start = t;
    },
    stop: (t: number) => {
      times.stop = t;
    },
  });
};

/** An OfflineAudioContext stand-in that records the graph the synth builds. */
class FakeContext {
  oscillators: Array<Timed & { type: string; frequency: ReturnType<typeof param> }> = [];
  sources: Array<Timed & { buffer: unknown }> = [];
  destination = {};
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  createOscillator() {
    const node = timed({ type: "sine", frequency: param() });
    this.oscillators.push(node);
    return node;
  }
  createGain() {
    return { connect: () => {}, gain: param() };
  }
  createBiquadFilter() {
    return { connect: () => {}, type: "lowpass", frequency: param(), Q: param() };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: (c: number) => data[c] ?? new Float32Array(0),
    };
  }
  createBufferSource() {
    const node = timed({ buffer: null as unknown });
    this.sources.push(node);
    return node;
  }
  startRendering() {
    const rendered = this.createBuffer(this.numberOfChannels, this.length, this.sampleRate);
    rendered.getChannelData(0).fill(0.5);
    return Promise.resolve(rendered);
  }
}

describe("the synthesizer", () => {
  it("schedules one oscillator per note and noise for channel 10 on an OfflineAudioContext", async () => {
    const contexts: FakeContext[] = [];
    const result = await render(readMidi(SONG), (channels, length, rate) => {
      const context = new FakeContext(channels, length, rate);
      contexts.push(context);
      return context;
    });
    const [context] = contexts;
    if (!context) throw new Error("no context");
    expect(context.oscillators.map((o) => [o.type, o.start])).toEqual([
      ["sawtooth", 0],
      ["sawtooth", 1],
    ]);
    const hz = context.oscillators.map((o) => o.frequency.calls[0]);
    expect(hz[0]?.[1]).toBeCloseTo(261.63, 1);
    expect(hz[1]?.[1]).toBeCloseTo(293.66, 1);
    for (const o of context.oscillators) expect(o.stop).toBeGreaterThan(o.start ?? 0);
    expect(context.sources.map((s) => s.start)).toEqual([0, 0.5]);
    expect(context.length).toBeGreaterThanOrEqual(1.25 * context.sampleRate);

    const wav = result.wav;
    const text = (from: number, to: number) => String.fromCharCode(...wav.slice(from, to));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 12)).toBe("WAVE");
    const view = new DataView(wav.buffer, wav.byteOffset);
    expect(view.getUint32(24, true)).toBe(context.sampleRate);
    expect(wav.length).toBe(44 + context.length * 2 * context.numberOfChannels);
    expect(result.duration).toBeCloseTo(context.length / context.sampleRate, 5);
  });

  it("maps program families to waveforms", () => {
    expect(waveFor(0)).toBe("triangle");
    expect(waveFor(16)).toBe("square");
    expect(waveFor(40)).toBe("sawtooth");
    expect(waveFor(73)).toBe("sine");
  });
});
