// Stand-ins for the software player's surroundings in Node: a worker that records what it is sent
// and answers what a test says, an AudioContext whose time a test moves, a screen that records the
// pictures, and a frame scheduler and wall clock the test drives. No timers run by themselves.

import { createSoftwareMedia } from "../ui/software/element.js";
import type { Picture, Screen } from "../ui/software/screen.js";

export class FakeWorker extends EventTarget {
  posted: { message: Record<string, unknown>; transfer?: Transferable[] }[] = [];
  terminated = false;
  postMessage(message: Record<string, unknown>, transfer?: Transferable[]) {
    this.posted.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  /** The worker answers. */
  send(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  /** Every message of one type the element sent. */
  sent(type: string) {
    return this.posted.map((p) => p.message).filter((m) => m.type === type);
  }
}

export interface FakeSource {
  buffer: FakeBuffer | null;
  playbackRate: { value: number };
  started: [number, number] | null;
  stopped: boolean;
  connect(): void;
  disconnect(): void;
  start(when: number, offset: number): void;
  stop(): void;
}

export interface FakeBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  copyToChannel(samples: Float32Array, channel: number): void;
}

export class FakeAudioContext {
  state: "suspended" | "running" | "closed" = "suspended";
  currentTime = 0;
  resumes = true;
  destination = {};
  gains: { gain: { value: number } }[] = [];
  sources: FakeSource[] = [];
  createGain() {
    const gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
    this.gains.push(gain);
    return gain;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      copyToChannel() {},
    };
  }
  createBufferSource() {
    const source: FakeSource = {
      buffer: null,
      playbackRate: { value: 1 },
      started: null,
      stopped: false,
      connect() {},
      disconnect() {},
      start(when, offset) {
        source.started = [when, offset];
      },
      stop() {
        source.stopped = true;
      },
    };
    this.sources.push(source);
    return source;
  }
  resume() {
    if (this.resumes) this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  /** The sources started and not stopped. */
  playing() {
    return this.sources.filter((s) => s.started && !s.stopped);
  }
}

export const EVENTS = [
  "loadedmetadata",
  "durationchange",
  "loadeddata",
  "play",
  "playing",
  "pause",
  "waiting",
  "seeking",
  "seeked",
  "ended",
  "error",
  "ratechange",
  "volumechange",
  "dropping",
];

export interface Setup {
  canvas?: boolean;
  audio?: boolean;
  readAll?: () => Promise<ArrayBuffer>;
}

/** An element on fakes; `pass(seconds)` moves both clocks and runs the waiting frame callbacks. */
export function setup(options: Setup = {}) {
  let ms = 0;
  const workers: FakeWorker[] = [];
  let frames: (() => void)[] = [];
  const draws: Picture[] = [];
  const screen: Screen & { closed: number } = {
    closed: 0,
    draw: (picture) => draws.push(picture),
    clear() {},
    close() {
      screen.closed++;
    },
  };
  let screens = 0;
  const ctx = new FakeAudioContext();
  const events: string[] = [];
  const media = createSoftwareMedia({
    canvas: options.canvas === false ? undefined : ({} as HTMLCanvasElement),
    startWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    wasm: "desk-plugin://endue.player/ui/vendor/ffmpeg/ffmpeg.wasm",
    url: "desk-plugin://desk/_desk/file/abc/clip.wmv",
    size: 1234,
    readAll: options.readAll,
    audioContext: options.audio === false ? undefined : () => ctx as unknown as AudioContext,
    screen: () => {
      screens++;
      return screen;
    },
    now: () => ms,
    frame: (callback) => {
      frames.push(callback);
      return () => {
        frames = frames.filter((f) => f !== callback);
      };
    },
  });
  for (const type of EVENTS) media.addEventListener(type, () => events.push(type));
  const run = () => {
    const due = frames;
    frames = [];
    for (const callback of due) callback();
  };
  return {
    media,
    workers,
    ctx,
    draws,
    screen,
    events,
    screens: () => screens,
    frames: () => frames.length,
    worker: () => workers.at(-1) as FakeWorker,
    run,
    /** Let `seconds` pass on the wall clock and the audio context, then run one frame. */
    pass(seconds: number, clocks: { wall?: boolean; audio?: boolean } = {}) {
      if (clocks.wall !== false) ms += seconds * 1000;
      if (clocks.audio !== false) ctx.currentTime += seconds;
      run();
    },
  };
}

export const READY = {
  type: "ready",
  duration: 10,
  video: { width: 4, height: 2, codec: "wmv3" },
  audio: { sampleRate: 1000, channels: 1, codec: "wmav2" },
};

/** A 4x2 picture at `time` whose Y plane holds round(time * 10). */
export const picture = (time: number, seq = 0) => ({
  type: "video",
  seq,
  time,
  width: 4,
  height: 2,
  planes: [
    new Uint8Array(8).fill(Math.round(time * 10)).buffer,
    new ArrayBuffer(2),
    new ArrayBuffer(2),
  ],
  widths: [4, 2, 2],
  heights: [2, 1, 1],
  full: false,
  matrix: "bt601",
});

/** `seconds` of mono sound at 1 kHz from `time`. */
export const sound = (time: number, seconds: number, seq = 0) => ({
  type: "audio",
  seq,
  time,
  sampleRate: 1000,
  data: [new Float32Array(Math.round(seconds * 1000)).buffer],
});

/** The total the element acknowledged, of pictures and of seconds of sound. */
export function acked(worker: FakeWorker) {
  let video = 0;
  let audio = 0;
  for (const ack of worker.sent("ack")) {
    video += (ack.video as number | undefined) ?? 0;
    audio += (ack.audio as number | undefined) ?? 0;
  }
  return { video, audio: Math.round(audio * 1000) / 1000 };
}
