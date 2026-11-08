import { describe, expect, it } from "vitest";
import { probe } from "../ui/probe/index.js";
import { memorySource } from "../ui/source.js";
import { fixture } from "./harness";

/** The facts the player reads from a fixture of make-fixtures.sh. */
const read = (name: string) => probe(memorySource(fixture(name)), name);

/** The fixtures last about a second; muxers round it to their own clocks. */
const aboutOneSecond = (duration: number | undefined) => {
  expect(duration).toBeGreaterThan(0.7);
  expect(duration).toBeLessThan(1.3);
};

const BARS = { kind: "video", width: 176, height: 144 };

describe("containers: duration, codecs and dimensions", () => {
  it("MP4", async () => {
    const info = await read("clip.mp4");
    expect(info).toMatchObject({ format: "mp4", container: "MP4", video: true, mime: "video/mp4" });
    aboutOneSecond(info.duration);
    expect(info.tracks).toEqual([
      expect.objectContaining({
        ...BARS,
        codec: "H.264",
        codecId: expect.stringMatching(/^avc1\./),
      }),
      expect.objectContaining({ kind: "audio", codec: "AAC", codecId: "mp4a.40.2", channels: 1 }),
    ]);
    expect(info.tracks[1]?.sampleRate).toBe(44100);
  });

  it("QuickTime", async () => {
    const info = await read("clip.mov");
    expect(info).toMatchObject({ format: "mp4", container: "QuickTime", mime: "video/quicktime" });
    aboutOneSecond(info.duration);
    expect(info.tracks.map((t) => t.codec)).toEqual(["H.264", "AAC"]);
  });

  it("Matroska", async () => {
    const info = await read("clip.mkv");
    expect(info).toMatchObject({ format: "matroska", container: "Matroska", video: true });
    aboutOneSecond(info.duration);
    expect(info.tracks).toEqual([
      expect.objectContaining({ ...BARS, codec: "HEVC", codecId: "V_MPEGH/ISO/HEVC" }),
      expect.objectContaining({ kind: "audio", codec: "AC-3", channels: 1, language: "kor" }),
    ]);
  });

  it("WebM", async () => {
    const info = await read("clip.webm");
    expect(info).toMatchObject({ format: "webm", container: "WebM", mime: "video/webm" });
    aboutOneSecond(info.duration);
    expect(info.tracks).toEqual([
      expect.objectContaining({ ...BARS, codec: "VP9" }),
      expect.objectContaining({ kind: "audio", codec: "Opus", language: "eng" }),
    ]);
  });

  it("AVI", async () => {
    const info = await read("clip.avi");
    expect(info).toMatchObject({ format: "avi", container: "AVI", video: true });
    aboutOneSecond(info.duration);
    expect(info.tracks).toEqual([
      expect.objectContaining({ ...BARS, codec: "MPEG-4 Part 2", codecId: "XVID" }),
      expect.objectContaining({ kind: "audio", codec: "MP3", sampleRate: 44100, channels: 1 }),
    ]);
  });

  it("WMV (ASF)", async () => {
    const info = await read("clip.wmv");
    expect(info).toMatchObject({ format: "asf", container: "Windows Media", video: true });
    aboutOneSecond(info.duration);
    expect(info.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...BARS, codec: "Windows Media Video 8", codecId: "WMV2" }),
        expect.objectContaining({ kind: "audio", codec: "Windows Media Audio 2", channels: 1 }),
      ]),
    );
  });

  it("FLV", async () => {
    const info = await read("clip.flv");
    expect(info).toMatchObject({ format: "flv", container: "Flash Video", video: true });
    aboutOneSecond(info.duration);
    expect(info.tracks).toEqual([
      expect.objectContaining({ ...BARS, codec: "H.264" }),
      expect.objectContaining({ kind: "audio", codec: "AAC" }),
    ]);
  });

  it("MPEG-TS", async () => {
    const info = await read("clip.mpegts");
    expect(info).toMatchObject({ format: "mpegts", container: "MPEG transport stream" });
    aboutOneSecond(info.duration);
    expect(info.tracks).toEqual([
      expect.objectContaining({ ...BARS, codec: "H.264" }),
      expect.objectContaining({ kind: "audio", codec: "AAC" }),
    ]);
  });

  it("Ogg Vorbis and Ogg Opus", async () => {
    const vorbis = await read("tone.ogg");
    expect(vorbis).toMatchObject({ format: "ogg", container: "Ogg", video: false });
    aboutOneSecond(vorbis.duration);
    expect(vorbis.tracks).toEqual([
      expect.objectContaining({ kind: "audio", codec: "Vorbis", channels: 2, sampleRate: 8000 }),
    ]);
    const opus = await read("tone.opus");
    aboutOneSecond(opus.duration);
    expect(opus.tracks).toEqual([
      expect.objectContaining({ kind: "audio", codec: "Opus", channels: 1, sampleRate: 48000 }),
    ]);
  });

  it("FLAC", async () => {
    const info = await read("tone.flac");
    expect(info).toMatchObject({ format: "flac", container: "FLAC", video: false });
    expect(info.duration).toBeCloseTo(1, 3);
    expect(info.tracks).toEqual([
      expect.objectContaining({
        kind: "audio",
        codec: "FLAC",
        channels: 1,
        sampleRate: 8000,
        bits: 16,
      }),
    ]);
  });

  it("MP3, VBR with a Xing header and CBR", async () => {
    for (const name of ["tone-v23.mp3", "tone-v24.mp3"]) {
      const info = await read(name);
      expect(info, name).toMatchObject({ format: "mp3", container: "MP3", video: false });
      aboutOneSecond(info.duration);
      expect(info.tracks).toEqual([
        expect.objectContaining({ kind: "audio", codec: "MP3", sampleRate: 44100, channels: 1 }),
      ]);
    }
  });

  it("WAV", async () => {
    const info = await read("tone.wav");
    expect(info).toMatchObject({ format: "wav", container: "WAV", video: false });
    expect(info.duration).toBeCloseTo(1, 3);
    expect(info.tracks).toEqual([
      expect.objectContaining({
        kind: "audio",
        codec: "PCM",
        channels: 1,
        sampleRate: 8000,
        bits: 16,
      }),
    ]);
  });

  it("AIFF", async () => {
    const info = await read("tone.aiff");
    expect(info).toMatchObject({ format: "aiff", container: "AIFF", video: false });
    expect(info.duration).toBeCloseTo(1, 3);
    expect(info.tracks).toEqual([
      expect.objectContaining({
        kind: "audio",
        codec: "PCM",
        channels: 1,
        sampleRate: 8000,
        bits: 16,
      }),
    ]);
  });

  it("reads only what it needs from a large file", async () => {
    const bytes = fixture("clip.mp4");
    let read = 0;
    const big = 4 * 1024 ** 3;
    // The fixture's header, then gigabytes of nothing: the reader must not walk them.
    const source = memorySource(bytes, {
      size: big,
      onRead: (_offset, length) => (read += length),
    });
    const info = await probe(source, "film.mp4");
    expect(info.tracks.map((t) => t.codec)).toEqual(["H.264", "AAC"]);
    expect(read).toBeLessThan(4 << 20);
  });
});
