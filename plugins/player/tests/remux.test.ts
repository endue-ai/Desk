// Remuxing to fragmented MP4 (ui/remux): fixtures made by make-remux-fixtures.sh come out with the
// same samples, times, key frames and codec configurations as ffprobe read from their source, and a
// seek starts at the key frame at or before the time asked for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openRemux, REMUX_CODECS, REMUX_FORMATS } from "../ui/remux/index.js";
import { crc32, readFragmented, type Track } from "./fmp4";
import {
  facts,
  file,
  matches,
  type Packet,
  payload,
  pesPayloads,
  prefixed,
  source,
} from "./remux-facts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
const hex = (b: Uint8Array | undefined) => Buffer.from(b ?? []).toString("hex");

async function remux(name: string, format: string, from = 0, options = {}) {
  const src = source(file(name));
  const remuxed = await openRemux(src, format, options);
  const parts = [remuxed.init];
  const fragments = [];
  for await (const f of remuxed.fragments(from)) {
    parts.push(f.data);
    fragments.push(f);
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return { remuxed, mp4: readFragmented(all), fragments, reads: src.reads };
}

const descriptor = (esds: Uint8Array | undefined, tag: number) => {
  const b = esds ?? new Uint8Array(0);
  const at = b.indexOf(tag, 4);
  return b.subarray(at + 2, at + 2 + (b[at + 1] ?? 0));
};

describe("remuxing to fragmented MP4", () => {
  it("names the formats and codecs it carries", () => {
    expect(REMUX_FORMATS).toEqual(
      expect.arrayContaining(["matroska", "webm", "avi", "flv", "ogg", "mxf", "mpegts"]),
    );
    expect(REMUX_CODECS.video).toEqual(expect.arrayContaining(["H.264", "HEVC", "VP9", "AV1"]));
    expect(REMUX_CODECS.audio).toEqual(
      expect.arrayContaining(["AAC", "MP3", "Opus", "FLAC", "AC-3", "E-AC-3"]),
    );
  });

  it("MKV with H.264 and AAC: avcC and the AAC config as written, every sample in its place", async () => {
    const { remuxed, mp4, reads } = await remux("h264-aac.mkv", "matroska");
    const [video, audio] = facts("h264-aac.mkv").streams;
    expect(remuxed.mime).toBe(
      `video/mp4; codecs="${video?.mime.toUpperCase().replace("AVC1", "avc1")}, mp4a.40.2"`,
    );
    expect(remuxed.duration).toBeCloseTo(3, 1);
    const [v, a] = mp4.tracks;
    expect(v).toMatchObject({ handler: "vide", entry: "avc1", fields: { width: 96, height: 64 } });
    expect(hex(v?.boxes.avcC)).toBe(video?.extradata);
    expect(a).toMatchObject({
      handler: "soun",
      entry: "mp4a",
      timescale: 44100,
      fields: { channels: 1 },
    });
    expect(hex(descriptor(a?.boxes.esds, 5))).toBe(audio?.extradata);
    matches(v as Track, "h264-aac.mkv", 0);
    matches(a as Track, "h264-aac.mkv", 1);
    expect(Math.max(...reads)).toBeLessThanOrEqual(1 << 20);
  });

  it("MKV with HEVC and AC-3: hvcC as written and a dac3 from the first frame", async () => {
    const { remuxed, mp4 } = await remux("hevc-ac3.mkv", "matroska");
    const [video, audio] = facts("hevc-ac3.mkv").streams;
    const [v, a] = mp4.tracks;
    const hvcC = v?.boxes.hvcC ?? new Uint8Array(13);
    expect(remuxed.tracks.map((t) => t.codecString)).toEqual([`hvc1.1.6.L${hvcC[12]}.90`, "ac-3"]);
    expect(v?.entry).toBe("hvc1");
    expect(hex(v?.boxes.hvcC)).toBe(video?.extradata);
    expect(a?.entry).toBe("ac-3");
    const dac3 = a?.boxes.dac3 ?? new Uint8Array(3);
    expect((dac3[0] ?? 0) >> 6).toBe(audio?.rate === 48000 ? 0 : 1);
    expect(((dac3[1] ?? 0) >> 3) & 7).toBe(audio?.channels === 1 ? 1 : 2);
    matches(v as Track, "hevc-ac3.mkv", 0);
    matches(a as Track, "hevc-ac3.mkv", 1);
  });

  it("WebM with VP9 and Opus: a vpcC from the key frame and a dOps from OpusHead", async () => {
    const { remuxed, mp4 } = await remux("vp9-opus.webm", "webm");
    const [video, audio] = facts("vp9-opus.webm").streams;
    expect(remuxed.mime).toBe('video/mp4; codecs="vp09.00.10.08, Opus"');
    expect(video?.mime).toMatch(/^vp09\.00\.\d\d\.08/);
    const [v, a] = mp4.tracks;
    const vpcC = v?.boxes.vpcC ?? new Uint8Array(12);
    expect([vpcC[0], vpcC[4], (vpcC[6] ?? 0) >> 4, ((vpcC[6] ?? 0) >> 1) & 7]).toEqual([
      1, 0, 8, 1,
    ]);
    const head = Buffer.from(audio?.extradata ?? "", "hex");
    const dOps = Buffer.from(a?.boxes.dOps ?? []);
    expect(a?.entry).toBe("Opus");
    expect([dOps[1], dOps.readUInt16BE(2), dOps.readUInt32BE(4)]).toEqual([
      head[9],
      head.readUInt16LE(10),
      head.readUInt32LE(12),
    ]);
    matches(v as Track, "vp9-opus.webm", 0);
    matches(a as Track, "vp9-opus.webm", 1);
  });

  it("FLV with H.264 and AAC: decode times and composition offsets as the tags have them", async () => {
    const { mp4 } = await remux("h264-aac.flv", "flv");
    const [video, audio] = facts("h264-aac.flv").streams;
    const [v, a] = mp4.tracks;
    expect(hex(v?.boxes.avcC)).toBe(video?.extradata);
    expect(hex(descriptor(a?.boxes.esds, 5))).toBe(audio?.extradata);
    matches(v as Track, "h264-aac.flv", 0);
    matches(a as Track, "h264-aac.flv", 1);
    const first = v?.samples[0];
    expect((first?.pts ?? 0) - (first?.dts ?? 0)).toBe(200);
  });

  it("AVI with H.264 and MP3: Annex B to lengths, avcC from the stream, order from picture order counts", async () => {
    const { remuxed, mp4 } = await remux("h264-mp3.avi", "avi");
    const [video] = facts("h264-mp3.avi").streams;
    expect(remuxed.tracks.map((t) => [t.codec, t.codecString])).toEqual([
      ["H.264", video?.mime.toUpperCase().replace("AVC1", "avc1")],
      ["MP3", "mp4a.6B"],
    ]);
    const [v, a] = mp4.tracks;
    const key = facts("h264-mp3.avi").packets.find((p) => p[0] === 0) as Packet;
    const nals = prefixed(payload(file("h264-mp3.avi"), key, "avi")).nals;
    const avcC = v?.boxes.avcC ?? new Uint8Array(0);
    const sps = nals.find((n) => ((n[0] ?? 0) & 0x1f) === 7);
    const pps = nals.find((n) => ((n[0] ?? 0) & 0x1f) === 8);
    expect(hex(avcC.subarray(8, 8 + (sps?.length ?? 0)))).toBe(hex(sps));
    expect(
      hex(avcC.subarray(11 + (sps?.length ?? 0), 11 + (sps?.length ?? 0) + (pps?.length ?? 0))),
    ).toBe(hex(pps));
    expect(descriptor(a?.boxes.esds, 4)[0]).toBe(0x6b);
    matches(v as Track, "h264-mp3.avi", 0, "avi");
    matches(a as Track, "h264-mp3.avi", 1);
  });

  it("Ogg Opus and Ogg FLAC: granule times less the pre-skip, FLAC's STREAMINFO in dfLa", async () => {
    const opus = await remux("opus.ogg", "ogg");
    expect(opus.remuxed.mime).toBe('audio/mp4; codecs="Opus"');
    matches(opus.mp4.tracks[0] as Track, "opus.ogg", 0);
    const flac = await remux("flac.oga", "ogg");
    const [stream] = facts("flac.oga").streams;
    expect(flac.remuxed.mime).toBe('audio/mp4; codecs="fLaC"');
    expect(hex(flac.mp4.tracks[0]?.boxes.dfLa?.subarray(8))).toBe(stream?.extradata);
    matches(flac.mp4.tracks[0] as Track, "flac.oga", 0);
  });

  it("MXF with H.264 and PCM: frame-wrapped elements, PCM as ipcm", async () => {
    const { remuxed, mp4 } = await remux("h264-pcm.mxf", "mxf");
    expect(remuxed.mime).toMatch(/^video\/mp4; codecs="avc1\.\w+, ipcm"$/);
    const [v, a] = mp4.tracks;
    expect(a).toMatchObject({ entry: "ipcm", timescale: 48000, fields: { channels: 1, bits: 16 } });
    expect([...(a?.boxes.pcmC ?? [])]).toEqual([0, 0, 0, 0, 1, 16]);
    matches(v as Track, "h264-pcm.mxf", 0, "mxf");
    matches(a as Track, "h264-pcm.mxf", 1);
  });
});

describe("transport streams, as AVCHD writes them", () => {
  it("M2TS with H.264 and AC-3: PES times from the earliest decode time, AC-3 frames apart", async () => {
    const { remuxed, mp4 } = await remux("h264-ac3.m2ts", "mpegts");
    expect(remuxed.mime).toMatch(/^video\/mp4; codecs="avc1\.\w+, ac-3"$/);
    const all = facts("h264-ac3.m2ts").packets;
    const zero = Math.min(...all.map((p) => p[2] ?? p[1] ?? 0));
    const [v, a] = mp4.tracks;
    const pid = remuxed.tracks[0]?.id ?? 0;
    matches(v as Track, "h264-ac3.m2ts", 0, pesPayloads(file("h264-ac3.m2ts"), pid), zero);
    matches(a as Track, "h264-ac3.m2ts", 1, undefined, zero);
    expect(await remuxed.keyframe(1.5)).toBeCloseTo(1.2, 3);
  });
});

describe("seeking by the container's index", () => {
  const cases: Array<[string, string, number[]]> = [
    ["h264-aac.mkv", "matroska", [0, 1, 2]],
    ["hevc-ac3.mkv", "matroska", [0, 1, 2]],
    ["vp9-opus.webm", "webm", [0, 1, 2]],
    ["h264-aac.flv", "flv", [0.2, 1.2, 2.2]],
    ["h264-mp3.avi", "avi", [0, 1, 2]],
    ["h264-pcm.mxf", "mxf", [0, 0.4, 0.8]],
    ["h264-ac3.m2ts", "mpegts", [0.2, 1.2, 2.2]],
  ];
  for (const [name, format, keys] of cases)
    it(`${name}: the key frame at or before the time, and fragments from it`, async () => {
      const remuxed = await openRemux(source(file(name)), format);
      const last = keys.at(-1) ?? 0;
      for (const [time, key] of [
        [0, keys[0]],
        [(keys[1] ?? 0) - 0.05, keys[0]],
        [(keys[1] ?? 0) + 0.05, keys[1]],
        [last + 0.35, last],
      ] as const)
        expect(await remuxed.keyframe(time), `${name} at ${time}`).toBeCloseTo(key ?? 0, 3);
      const { mp4, fragments } = await remux(name, format, (keys[1] ?? 0) + 0.3);
      const video = mp4.tracks[0] as Track;
      expect(video.samples[0]?.key).toBe(true);
      expect((video.samples[0]?.pts ?? 0) / video.timescale).toBeCloseTo(keys[1] ?? 0, 3);
      expect(fragments[0]?.start).toBeLessThanOrEqual((keys[1] ?? 0) + 0.001);
      const whole = await remux(name, format);
      const from = (whole.mp4.tracks[0] as Track).samples.findIndex(
        (s) => s.dts === video.samples[0]?.dts,
      );
      expect(video.samples.map((s) => crc32(s.data))).toEqual(
        (whole.mp4.tracks[0] as Track).samples.slice(from).map((s) => crc32(s.data)),
      );
    });

  it("an FLV without onMetaData's key frame index is bisected on tag times instead", async () => {
    const bytes = file("h264-aac.flv");
    const at = Buffer.from(bytes).indexOf("keyframes");
    const unindexed = bytes.slice();
    unindexed[at + 8] = 0x58; // "keyframeX": the index is not one any more
    const remuxed = await openRemux(source(unindexed), "flv");
    expect(await remuxed.keyframe(1.5)).toBeCloseTo(1.2, 3);
    expect(await remuxed.keyframe(2.95)).toBeCloseTo(2.2, 3);
    expect(await remuxed.keyframe(0)).toBeCloseTo(0.2, 3);
  });

  it("an Ogg Opus seek starts on a page before the time, with 80 ms to decode into", async () => {
    const { mp4 } = await remux("opus.ogg", "ogg", 2);
    const first = (mp4.tracks[0]?.samples[0]?.pts ?? 0) / 48000;
    expect(first).toBeLessThanOrEqual(2 - 0.08 + 0.001);
    expect(first).toBeGreaterThanOrEqual(0);
  });
});

describe("what it does not remux", () => {
  it("says which codec in words", async () => {
    await expect(openRemux(source(fixture("tone.ogg")), "ogg")).rejects.toThrow(
      "This Ogg's audio is Vorbis, which the player cannot remux.",
    );
    await expect(openRemux(source(fixture("clip.avi")), "avi")).rejects.toThrow(
      "This AVI's video is MPEG-4 Part 2, which the player cannot remux.",
    );
    await expect(openRemux(source(file("mpeg2.mxf")), "mxf")).rejects.toThrow(
      "This MXF's video is MPEG-2 Video, which the player cannot remux.",
    );
    await expect(openRemux(source(fixture("clip.wmv")), "asf")).rejects.toThrow(
      "The player cannot remux Windows Media files.",
    );
  });

  it("carries the video alone when asked, for audio the player decodes another way", async () => {
    const { remuxed, mp4 } = await remux("h264-mp3.avi", "avi", 0, { audio: null });
    expect(remuxed.mime).toMatch(/^video\/mp4; codecs="avc1\.\w+"$/);
    expect(mp4.tracks.map((t) => t.handler)).toEqual(["vide"]);
  });

  it("a damaged file is refused with a sentence", async () => {
    const whole = file("h264-aac.mkv");
    await expect(openRemux(source(whole.slice(0, 40)), "matroska")).rejects.toThrow(/\.$/);
    const garbage = new Uint8Array(4096).map((_, i) => (i * 7919) & 255);
    for (const format of ["matroska", "avi", "flv", "ogg", "mxf", "mpegts"])
      await expect(openRemux(source(garbage), format)).rejects.toThrow(/\.$/);
  });
});
