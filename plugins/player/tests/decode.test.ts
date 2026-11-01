// The vendored decoder (ui/vendor/ffmpeg/ffmpeg.wasm, built by scripts/vendor-ffmpeg.sh) in Node:
// the first frames and samples of each format WebKit cannot decode, their sizes and a checksum, and
// seeking. Fixtures: make-decode-fixtures.sh and make-fixtures.sh. The tones are FFmpeg's sine at
// an eighth of full scale (RMS 0.0884), the DSD ones half scale (RMS 0.3536); the pictures' mean
// luma was recorded from FFmpeg 9.0.2's decoders.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type AudioFrame,
  type Ffmpeg,
  type Frame,
  loadFfmpeg,
  type Media,
  type VideoFrame,
} from "../ui/software/ffmpeg.js";

const WASM = join(import.meta.dirname, "../ui/vendor/ffmpeg/ffmpeg.wasm");
const bytesOf = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
const fileOf = (bytes: Uint8Array) => ({
  size: bytes.length,
  read: (offset: number, length: number) => bytes.subarray(offset, offset + length),
});

let ffmpeg: Ffmpeg;
beforeAll(async () => {
  ffmpeg = await loadFfmpeg(readFileSync(WASM));
});

const open = (name: string, want = { video: true, audio: true }) =>
  ffmpeg.open(fileOf(bytesOf(name)), want);

/** The next frame of one kind, within `limit` frames. */
function first<K extends Frame["kind"]>(media: Media, kind: K, limit = 400) {
  for (let i = 0; i < limit; i++) {
    const frame = media.next();
    if (!frame) return null;
    if (frame.kind === kind) return frame as Extract<Frame, { kind: K }>;
  }
  return null;
}

const mean = (plane: Uint8Array) => plane.reduce((sum, v) => sum + v, 0) / plane.length;

/** The RMS of the first `seconds` of audio, every channel. */
function rms(media: Media, seconds: number) {
  let squares = 0;
  let count = 0;
  let rate = 0;
  let channels = 0;
  let start = Number.NaN;
  for (let frame = first(media, "audio"); frame; frame = first(media, "audio")) {
    const audio = frame as AudioFrame;
    rate = audio.sampleRate;
    channels = audio.channels.length;
    if (Number.isNaN(start)) start = audio.time;
    for (const channel of audio.channels) for (const v of channel) squares += v * v;
    count += audio.channels[0]?.length ?? 0;
    if (count >= rate * seconds) break;
  }
  return {
    value: Math.sqrt(squares / Math.max(1, count * channels)),
    rate,
    channels,
    count,
    start,
  };
}

const VIDEO = [
  { name: "decode/vc1.wmv", codec: "wmv3", width: 720, height: 480, luma: 34.11, seek: 0.1 },
  { name: "clip.avi", codec: "mpeg4", width: 176, height: 144, luma: 97.15, seek: 0.5 },
  { name: "decode/theora.ogv", codec: "theora", width: 1056, height: 594, luma: 93.31, seek: 0.25 },
  { name: "decode/clip.rmvb", codec: "rv20", width: 176, height: 144, luma: 97.41, seek: 0.5 },
];

describe("the first frames of what WebKit cannot decode", () => {
  for (const want of VIDEO)
    it(`${want.name} (${want.codec})`, () => {
      const media = open(want.name);
      expect(media.video).toEqual({ width: want.width, height: want.height, codec: want.codec });
      const frame = first(media, "video") as VideoFrame;
      expect(frame).toMatchObject({ kind: "video", width: want.width, height: want.height });
      const [cw, ch] = [Math.ceil(want.width / 2), Math.ceil(want.height / 2)];
      expect(frame.widths).toEqual([want.width, cw, cw]);
      expect(frame.heights).toEqual([want.height, ch, ch]);
      expect(frame.planes.map((p) => p.length)).toEqual([
        want.width * want.height,
        cw * ch,
        cw * ch,
      ]);
      expect(Math.abs(mean(frame.planes[0] as Uint8Array) - want.luma)).toBeLessThan(1.5);
      expect(frame.time).toBeCloseTo(0, 1);
      expect(frame.full).toBe(false);
      expect(frame.matrix).toBe("bt601");
      for (let i = 0; i < 3; i++) expect(first(media, "video")).not.toBeNull();
      media.close();
    });
});

const AUDIO = [
  { name: "tone.wma", codec: "wmav2", rate: 8000, channels: 1, rms: 0.0884 },
  { name: "decode/tone.ape", codec: "ape", rate: 44100, channels: 2, rms: 0.0884 },
  { name: "tone.wv", codec: "wavpack", rate: 8000, channels: 1, rms: 0.0884 },
  { name: "decode/tone.amr", codec: "amrnb", rate: 8000, channels: 1, rms: 0.0884, loose: true },
  // DSD decodes at 352.8 kHz; the decoder averages it down to 176.4 kHz.
  { name: "decode/tone.dsf", codec: "dsd_lsbf_planar", rate: 176400, channels: 2, rms: 0.3536 },
  { name: "decode/tone.dff", codec: "dsd_msbf", rate: 176400, channels: 2, rms: 0.3536 },
];

describe("the first samples of what WebKit cannot decode", () => {
  for (const want of AUDIO)
    it(`${want.name} (${want.codec})`, () => {
      const media = open(want.name);
      expect(media.video).toBeNull();
      expect(media.audio).toEqual({
        sampleRate: want.rate,
        channels: want.channels,
        codec: want.codec,
      });
      const got = rms(media, 0.2);
      expect(got).toMatchObject({ rate: want.rate, channels: want.channels });
      expect(got.count).toBeGreaterThanOrEqual(want.rate * 0.2);
      // Lossy speech coding keeps a tone's level only roughly.
      expect(Math.abs(got.value - want.rms) / want.rms).toBeLessThan(want.loose ? 0.25 : 0.05);
      media.close();
    });
});

describe("seeking", () => {
  for (const want of VIDEO)
    it(`${want.name} goes to ${want.seek} s`, () => {
      const media = open(want.name);
      media.seek(want.seek);
      const frame = first(media, "video");
      expect(frame?.time).toBeGreaterThanOrEqual(want.seek - 0.05);
      expect(frame?.time).toBeLessThan(want.seek + 0.2);
      media.close();
    });

  it("audio lands on the target, trimmed to it", () => {
    const media = open("tone.wv");
    media.seek(0.5);
    expect(first(media, "audio")?.time).toBeCloseTo(0.5, 2);
    media.seek(0);
    expect(first(media, "audio")?.time).toBeCloseTo(0, 2);
    media.close();
  });

  it("only what was asked for is decoded", () => {
    const media = open("clip.avi", { video: false, audio: true });
    expect(media.video).toBeNull();
    expect(first(media, "video", 50)).toBeNull();
    media.close();
  });
});

describe("what the decoder refuses, in words", () => {
  it("a codec it has no decoder for (HEVC goes to Media Source Extensions instead)", () => {
    expect(() => open("clip.mkv")).toThrow(
      expect.objectContaining({
        code: "open",
        message: "The player's decoders cannot decode hevc.",
      }),
    );
  });

  it("bytes that are no media file", () => {
    const noise = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251);
    expect(() => ffmpeg.open(fileOf(noise), { video: true, audio: true })).toThrow(
      expect.objectContaining({ code: "open" }),
    );
  });

  it("a file that cannot be read says so, with the reader's error as its cause", () => {
    const cause = new Error("gone");
    const broken = {
      size: 4096,
      read: () => {
        throw cause;
      },
    };
    expect(() => ffmpeg.open(broken, { video: true, audio: true })).toThrow(
      expect.objectContaining({ code: "read", cause }),
    );
  });

  it("a file cut short ends cleanly", () => {
    const whole = bytesOf("clip.avi");
    const media = ffmpeg.open(fileOf(whole.subarray(0, whole.length >> 1)), {
      video: true,
      audio: true,
    });
    let frames = 0;
    while (media.next() && frames < 1000) frames++;
    expect(frames).toBeGreaterThan(0);
    expect(media.next()).toBeNull();
    media.close();
  });
});
