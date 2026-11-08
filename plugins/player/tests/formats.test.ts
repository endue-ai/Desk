import { describe, expect, it } from "vitest";
import { decodeAu } from "../ui/au.js";
import { detect } from "../ui/format.js";
import { probe } from "../ui/probe/index.js";
import { memorySource } from "../ui/source.js";
import { fixture } from "./harness";

const read = (name: string, bytes = fixture(name)) => probe(memorySource(bytes), name);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];
const le64 = (n: number) => [...le32(n % 2 ** 32), ...le32(Math.floor(n / 2 ** 32))];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const be32 = (n: number) => [...be16(n >>> 16), ...be16(n & 0xffff)];
const be64 = (n: number) => [...be32(Math.floor(n / 2 ** 32)), ...be32(n % 2 ** 32)];
const between = (value: number | undefined, low: number, high: number) => {
  expect(value).toBeGreaterThan(low);
  expect(value).toBeLessThan(high);
};

/** An APEv2 tag (items then footer), as Monkey's Audio and WavPack files end. */
function apeTag(items: Record<string, string>) {
  const body = Object.entries(items).flatMap(([key, value]) => {
    const bytes = [...new TextEncoder().encode(value)];
    return [...le32(bytes.length), ...le32(0), ...ascii(key), 0, ...bytes];
  });
  const count = Object.keys(items).length;
  return [
    ...body,
    ...ascii("APETAGEX"),
    ...le32(2000),
    ...le32(body.length + 32),
    ...le32(count),
    ...le32(0),
    ...new Array(8).fill(0),
  ];
}

describe("more containers", () => {
  it("CAF, WavPack, WMA and ADTS AAC", async () => {
    const caf = await read("tone.caf");
    expect(caf).toMatchObject({ format: "caf", container: "CAF", video: false });
    expect(caf.duration).toBeCloseTo(1, 2);
    expect(caf.tracks).toEqual([
      expect.objectContaining({ codec: "Apple Lossless", sampleRate: 8000 }),
    ]);

    const wv = await read("tone.wv");
    expect(wv).toMatchObject({ format: "wavpack", container: "WavPack" });
    expect(wv.duration).toBeCloseTo(1, 2);

    const wma = await read("tone.wma");
    expect(wma).toMatchObject({ format: "asf", container: "Windows Media", video: false });
    expect(wma.tracks).toEqual([expect.objectContaining({ codec: "Windows Media Audio 2" })]);

    const aac = await read("tone.aac");
    expect(aac).toMatchObject({ format: "aac", container: "AAC", video: false });
    between(aac.duration, 0.7, 1.3);
    expect(aac.tracks).toEqual([expect.objectContaining({ codec: "AAC", sampleRate: 8000 })]);
  });

  it("MPEG program streams (VOB), M2TS and RealMedia", async () => {
    const vob = await read("clip.vob");
    expect(vob).toMatchObject({ format: "mpegps", container: "MPEG program stream", video: true });
    between(vob.duration, 0.5, 1.3);
    expect(vob.tracks).toEqual([
      expect.objectContaining({ codec: "MPEG-2 Video", width: 176, height: 144 }),
      expect.objectContaining({ codec: "MP2" }),
    ]);

    const m2ts = await read("clip.m2ts");
    expect(m2ts).toMatchObject({ format: "mpegts", container: "MPEG transport stream" });
    between(m2ts.duration, 0.7, 1.3);
    expect(m2ts.tracks.map((t) => t.codec)).toEqual(["H.264", "AC-3"]);

    const rm = await read("clip.rm");
    expect(rm).toMatchObject({ format: "realmedia", container: "RealMedia", video: true });
    between(rm.duration, 0.9, 1.1);
    expect(rm.tracks).toEqual([
      expect.objectContaining({ codec: "RealVideo 1.0", width: 176, height: 144 }),
      expect.objectContaining({ codec: "AC-3" }),
    ]);
  });

  it("Monkey's Audio with an APEv2 tag", async () => {
    const descriptor = [
      ...ascii("MAC "),
      ...le16(3990),
      ...le16(0),
      ...le32(52),
      ...le32(24),
      ...le32(4),
      ...le32(0),
      ...le32(0),
      ...le32(0),
      ...le32(0),
      ...new Array(16).fill(0),
    ];
    const header = [
      ...le16(2000),
      ...le16(0),
      ...le32(73728),
      ...le32(14472),
      ...le32(2),
      ...le16(16),
      ...le16(2),
      ...le32(44100),
    ];
    const bytes = Uint8Array.from([
      ...descriptor,
      ...header,
      0,
      0,
      0,
      0,
      ...apeTag({ Title: "Monkey", Artist: "Band" }),
    ]);
    const info = await read("song.ape", bytes);
    expect(info).toMatchObject({ format: "ape", container: "Monkey's Audio", video: false });
    expect(info.duration).toBeCloseTo(2, 5);
    expect(info.tracks).toEqual([
      expect.objectContaining({
        codec: "Monkey's Audio",
        channels: 2,
        sampleRate: 44100,
        bits: 16,
      }),
    ]);
    expect(info.tags).toMatchObject({ title: "Monkey", artist: "Band" });
  });

  it("DSF and DSDIFF", async () => {
    const dsf = Uint8Array.from([
      ...ascii("DSD "),
      ...le64(28),
      ...le64(92),
      ...le64(0),
      ...ascii("fmt "),
      ...le64(52),
      ...le32(1),
      ...le32(0),
      ...le32(2),
      ...le32(2),
      ...le32(2822400),
      ...le32(1),
      ...le64(2822400 * 3),
      ...le32(4096),
      ...le32(0),
      ...ascii("data"),
      ...le64(12),
    ]);
    const one = await read("song.dsf", dsf);
    expect(one).toMatchObject({ format: "dsf", container: "DSF", video: false });
    expect(one.duration).toBeCloseTo(3, 5);
    expect(one.tracks).toEqual([
      expect.objectContaining({ codec: "DSD", channels: 2, sampleRate: 2822400 }),
    ]);

    const chunk = (id: string, data: number[]) => [
      ...ascii(id),
      ...be64(data.length),
      ...data,
      ...(data.length % 2 ? [0] : []),
    ];
    const name = ascii("not compressed");
    const prop = [
      ...ascii("SND "),
      ...chunk("FS  ", be32(2822400)),
      ...chunk("CHNL", [...be16(2), ...ascii("SLFTSRGT")]),
      ...chunk("CMPR", [...ascii("DSD "), name.length, ...name]),
    ];
    const title = ascii("Dsd Title");
    const form = [
      ...ascii("DSD "),
      ...chunk("FVER", be32(0x01050000)),
      ...chunk("PROP", prop),
      ...chunk("DIIN", chunk("DITI", [...be32(title.length), ...title])),
      ...ascii("DSD "),
      ...be64(1411200),
    ];
    const dff = Uint8Array.from([...ascii("FRM8"), ...be64(form.length + 1411200), ...form]);
    const two = await read("song.dff", dff);
    expect(two).toMatchObject({ format: "dff", container: "DSDIFF", video: false });
    expect(two.duration).toBeCloseTo(2, 5);
    expect(two.tracks).toEqual([
      expect.objectContaining({ codec: "DSD", channels: 2, sampleRate: 2822400 }),
    ]);
    expect(two.tags).toMatchObject({ title: "Dsd Title" });
  });

  it("AMR, Ogg Theora and MXF", async () => {
    const frame = [0x3c, ...new Array(31).fill(0)];
    const amr = Uint8Array.from([
      ...ascii("#!AMR\n"),
      ...Array.from({ length: 50 }, () => frame).flat(),
    ]);
    const one = await read("voice.amr", amr);
    expect(one).toMatchObject({ format: "amr", container: "AMR", video: false });
    expect(one.duration).toBeCloseTo(1, 5);
    expect(one.tracks).toEqual([
      expect.objectContaining({ codec: "AMR-NB", sampleRate: 8000, channels: 1 }),
    ]);

    const theora = [
      0x80,
      ...ascii("theora"),
      3,
      2,
      1,
      ...be16(11),
      ...be16(9),
      0,
      0,
      176,
      0,
      0,
      144,
      0,
      0,
      ...be32(25),
      ...be32(1),
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0x00,
      0xc0,
    ];
    const page = (type: number, granule: number, data: number[]) => [
      ...ascii("OggS"),
      0,
      type,
      ...le64(granule),
      ...le32(7),
      ...le32(0),
      ...le32(0),
      1,
      data.length,
      ...data,
    ];
    const ogg = Uint8Array.from([...page(2, 0, theora), ...page(4, (49 << 6) | 1, [0x00])]);
    const two = await read("clip.ogv", ogg);
    expect(two).toMatchObject({ format: "ogg", container: "Ogg", video: true });
    between(two.duration, 1.9, 2.1);
    expect(two.tracks).toEqual([
      expect.objectContaining({ codec: "Theora", width: 176, height: 144 }),
    ]);

    const mxf = Uint8Array.from([
      0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02, 0x01, 0x01, 0x02, 0x04,
      0x00, 0x00, 0, 0, 0,
    ]);
    expect(await read("tape.mxf", mxf)).toMatchObject({
      format: "mxf",
      container: "MXF",
      tracks: [],
    });
  });
});

describe("format detection", () => {
  it("reads the first bytes before the extension", () => {
    const head = (name: string) => fixture(name).slice(0, 4096);
    expect(detect(head("clip.mkv"), "film.mp4")).toMatchObject({
      format: "matroska",
      family: "media",
    });
    expect(detect(head("tone.flac"), "TONE.MP3")).toMatchObject({
      format: "flac",
      family: "media",
    });
    expect(detect(head("tone.au"), "tone.snd")).toMatchObject({ format: "au", family: "au" });
    const midi = Uint8Array.from([...ascii("MThd"), 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]);
    expect(detect(midi, "song.mp3")).toMatchObject({ format: "midi", family: "midi" });
    expect(detect(new TextEncoder().encode("WEBVTT\n\n"), "a.txt")).toMatchObject({
      family: "subtitles",
    });
    expect(detect(new TextEncoder().encode("#EXTM3U\n"), "a.m3u8")).toMatchObject({
      family: "playlist",
    });
    expect(detect(Uint8Array.from([1, 2, 3]), "x.srt")).toMatchObject({ family: "subtitles" });
    expect(detect(Uint8Array.from([1, 2, 3]), "x.mov")).toMatchObject({
      format: "",
      family: "media",
    });
    expect(detect(Uint8Array.from([1, 2, 3]), "x.bin")).toMatchObject({ format: "", family: "" });
  });
});

describe("AU and SND", () => {
  it.each([
    ["tone.au", "μ-law"],
    ["tone-alaw.au", "A-law"],
    ["tone-pcm.au", "16-bit PCM"],
  ])("%s decodes into a WAV", (name, encoding) => {
    const au = decodeAu(fixture(name));
    expect(au).toMatchObject({ encoding, sampleRate: 8000, channels: 1 });
    expect(au.duration).toBeCloseTo(1, 3);
    const wav = au.wav;
    expect(String.fromCharCode(...wav.slice(0, 4), ...wav.slice(8, 12))).toBe("RIFFWAVE");
    expect(wav.length).toBe(44 + 8000 * 2);
    const samples = new Int16Array(
      wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length),
    );
    const peak = samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    // ffmpeg's sine source peaks at one eighth of full scale.
    between(peak, 3500, 4700);
  });

  it("refuses an encoding it does not decode, in words", () => {
    const bytes = Uint8Array.from([
      ...ascii(".snd"),
      ...be32(24),
      ...be32(4),
      ...be32(23),
      ...be32(8000),
      ...be32(1),
      1,
      2,
      3,
      4,
    ]);
    expect(() => decodeAu(bytes)).toThrow(/encoding 23/);
  });
});
