// The remux engine in Node: a MediaSource, a SourceBuffer and a media element stand-in that keep the
// ranges a test's fragments cover, so the pump's appends, its stop ahead of the position, a seek
// outside what is buffered, a full buffer and closing can be watched without WebKit.
import { describe, expect, it, vi } from "vitest";
import { createEngines } from "../ui/engines.js";
import type { Model } from "../ui/player.js";
import type { Fragment, Remuxed } from "../ui/remux/index.js";
import { playRemuxed } from "../ui/remux/mse.js";
import { memorySource } from "../ui/source.js";
import { fixture } from "./harness";
import { FakeWorker } from "./software-fakes";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (done: () => boolean) => {
  for (let i = 0; i < 400 && !done(); i++) await tick();
  expect(done()).toBe(true);
};

/** Fragment i covers [i, i + 1) s; its one byte says which. */
const ranges = new Map<number, [number, number]>();

class FakeBuffer extends EventTarget {
  updating = false;
  covered: [number, number][] = [];
  appended: number[] = [];
  removed: [number, number][] = [];
  full = 0;
  fails = false;
  constructor(readonly mime: string) {
    super();
  }
  get buffered() {
    const sorted = [...this.covered].sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [s, e] of sorted) {
      const last = merged.at(-1);
      if (last && s <= last[1] + 1e-6) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    return {
      length: merged.length,
      start: (i: number) => merged[i]?.[0] ?? 0,
      end: (i: number) => merged[i]?.[1] ?? 0,
    };
  }
  #finish(type = "updateend") {
    this.updating = true;
    setTimeout(() => {
      this.updating = false;
      this.dispatchEvent(new Event(type));
    }, 0);
  }
  appendBuffer(data: Uint8Array) {
    if (this.full > 0) {
      this.full--;
      throw new DOMException("full", "QuotaExceededError");
    }
    if (this.fails) return this.#finish("error");
    const index = data.length === 1 ? (data[0] ?? -1) : -1;
    this.appended.push(index);
    const range = ranges.get(index);
    if (range) this.covered.push(range);
    this.#finish();
  }
  remove(start: number, end: number) {
    this.removed.push([start, end]);
    this.covered = this.covered.filter(([s]) => s >= end || s < start);
    this.#finish();
  }
  abort() {}
}

class FakeMediaSource extends EventTarget {
  static refuse = /mp4a\.6B/;
  static isTypeSupported = (type: string) => !FakeMediaSource.refuse.test(type);
  static last: FakeMediaSource | null = null;
  readyState = "closed";
  duration = Number.NaN;
  buffers: FakeBuffer[] = [];
  ended = false;
  constructor() {
    super();
    FakeMediaSource.last = this;
  }
  addSourceBuffer(mime: string) {
    const buffer = new FakeBuffer(mime);
    this.buffers.push(buffer);
    return buffer;
  }
  endOfStream() {
    this.ended = true;
    this.readyState = "ended";
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("sourceopen"));
  }
}

class FakeElement extends EventTarget {
  currentTime = 0;
  paused = true;
  volume = 1;
  muted = false;
  playbackRate = 1;
  src = "";
  #object: FakeMediaSource | null = null;
  get srcObject() {
    return this.#object;
  }
  set srcObject(value: FakeMediaSource | null) {
    this.#object = value;
    if (value) setTimeout(() => value.open(), 0);
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
  load() {}
}

const win = {
  MediaSource: FakeMediaSource,
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  URL,
  location: { href: "desk-plugin://localhost/endue.player/ui/index.html" },
};

/** A remuxed stream of `count` one-second fragments; `from` is what each fragments() asked for. */
function stream(count: number) {
  const from: number[] = [];
  for (let i = 0; i < count; i++) ranges.set(i, [i, i + 1]);
  const remuxed: Remuxed = {
    duration: count,
    tracks: [{ id: 1, kind: "video", codec: "H.264", codecString: "avc1.64000A" }],
    choices: [],
    mime: 'video/mp4; codecs="avc1.64000A"',
    init: new Uint8Array([1, 2, 3]),
    async *fragments(start: number): AsyncGenerator<Fragment> {
      from.push(start);
      for (let i = Math.floor(start); i < count; i++)
        yield { data: Uint8Array.of(i), start: i, end: i + 1 };
    },
    keyframe: async (time: number) => Math.floor(time),
  };
  return { remuxed, from };
}

const hooks = () => ({ busy: vi.fn(), fail: vi.fn() });

describe("the remux engine feeds Media Source Extensions", () => {
  it("attaches with srcObject, appends the init and stays about 30 s ahead", async () => {
    const element = new FakeElement();
    const { remuxed } = stream(100);
    const h = hooks();
    const fed = playRemuxed(element as unknown as HTMLMediaElement, remuxed, { win, ...h });
    expect(element.srcObject).toBeInstanceOf(FakeMediaSource);
    await until(() => (FakeMediaSource.last?.buffers[0]?.appended.length ?? 0) > 30);
    const ms = FakeMediaSource.last as FakeMediaSource;
    const buffer = ms.buffers[0] as FakeBuffer;
    expect(buffer.mime).toBe(remuxed.mime);
    expect(ms.duration).toBe(100);
    expect(buffer.appended[0]).toBe(-1);
    for (let i = 0; i < 20; i++) await tick();
    expect(buffer.appended.length).toBeLessThan(36);
    expect(h.busy).toHaveBeenLastCalledWith(null);
    fed.close();
    expect(element.srcObject).toBeNull();
  });

  it("a seek outside what is buffered starts again from there; one inside does not", async () => {
    const element = new FakeElement();
    const { remuxed, from } = stream(100);
    const fed = playRemuxed(element as unknown as HTMLMediaElement, remuxed, { win, ...hooks() });
    await until(() => (FakeMediaSource.last?.buffers[0]?.appended.length ?? 0) > 30);
    element.currentTime = 10;
    element.dispatchEvent(new Event("seeking"));
    await tick();
    expect(from).toEqual([0]);
    element.currentTime = 70.5;
    element.dispatchEvent(new Event("seeking"));
    const buffer = FakeMediaSource.last?.buffers[0] as FakeBuffer;
    await until(() => buffer.appended.includes(70));
    expect(from).toEqual([0, 70.5]);
    fed.close();
  });

  it("a full buffer is trimmed behind the position, and the end ends the stream", async () => {
    const element = new FakeElement();
    const { remuxed } = stream(40);
    const fed = playRemuxed(element as unknown as HTMLMediaElement, remuxed, { win, ...hooks() });
    await until(() => (FakeMediaSource.last?.buffers[0]?.appended.length ?? 0) > 3);
    const buffer = FakeMediaSource.last?.buffers[0] as FakeBuffer;
    element.currentTime = 25;
    buffer.full = 1;
    await until(() => buffer.removed.length > 0);
    expect(buffer.removed[0]).toEqual([0, 5]);
    await until(() => FakeMediaSource.last?.ended === true);
    fed.close();
  });

  it("a fragment WebKit refuses is said as the engine's failure", async () => {
    const element = new FakeElement();
    const { remuxed } = stream(5);
    const h = hooks();
    playRemuxed(element as unknown as HTMLMediaElement, remuxed, { win, ...h });
    await until(() => FakeMediaSource.last?.buffers.length === 1);
    (FakeMediaSource.last?.buffers[0] as FakeBuffer).fails = true;
    await until(() => h.fail.mock.calls.length > 0);
    expect(h.fail).toHaveBeenCalledWith("WebKit could not decode the remuxed stream.");
  });
});

describe("a remuxed picture whose sound MSE refuses", () => {
  const model = (path: string, format: string): Model => ({
    buffer: `file:${path}`,
    path,
    name: path,
    size: 0,
    format,
    mode: "media",
    element: "video",
    src: "/_desk/file/t/clip.avi",
    engine: "remux",
    target: { path, size: fixture("remux/h264-mp3.avi").length, format },
  });
  const open = (deps: Parameters<typeof createEngines>[1]) => {
    const element = new FakeElement();
    const say = vi.fn();
    const engines = createEngines(win, {
      source: async () => memorySource(fixture("remux/h264-mp3.avi")),
      ...deps,
    });
    engines.open(
      model("~/Movies/clip.avi", "avi"),
      element as unknown as HTMLMediaElement,
      {} as HTMLCanvasElement,
      {
        busy: () => {},
        fail: (reason) => say(`failed: ${reason}`),
        say,
        listen: () => {},
      },
    );
    return { element, say };
  };

  it("plays the picture and decodes the sound beside it", async () => {
    const worker = new FakeWorker();
    open({ startWorker: () => worker as unknown as Worker, wasm: "./vendor/ffmpeg/ffmpeg.wasm" });
    await until(() => FakeMediaSource.last?.buffers.length === 1 && worker.posted.length > 0);
    expect(FakeMediaSource.last?.buffers[0]?.mime).toMatch(/^video\/mp4; codecs="avc1\.[^,]+"$/);
    expect(worker.sent("open")[0]).toMatchObject({
      video: false,
      url: expect.stringMatching(/^desk-plugin:/),
    });
  });

  it("without the decoder the picture plays alone, and that is said", async () => {
    const { say } = open({});
    await until(() => say.mock.calls.length > 0);
    expect(say).toHaveBeenCalledWith(
      "The sound (MP3) cannot be played here: the picture plays without it.",
    );
  });
});
