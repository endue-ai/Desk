import { describe, expect, it } from "vitest";
import { probe } from "../ui/probe/index.js";
import { memorySource } from "../ui/source.js";
import { fixture } from "./harness";

const read = (name: string, bytes = fixture(name)) => probe(memorySource(bytes), name);
const TAGS = { title: "Test Tone", artist: "Endue Player", album: "Fixtures" };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const expectPngCover = (cover: { type: string; bytes: Uint8Array } | undefined) => {
  expect(cover?.type).toBe("image/png");
  expect([...(cover?.bytes ?? []).slice(0, 8)]).toEqual(PNG);
};

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const syncsafe = (n: number) => [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127];
/** One MPEG-1 Layer III frame header (128 kb/s, 44.1 kHz) and silence, so the tag has audio after it. */
const FRAME = [0xff, 0xfb, 0x90, 0x64, ...new Array(413).fill(0)];

/** An ID3v2 tag of the given version around frames, followed by one MP3 frame. */
function id3(version: 2 | 3, frames: number[][]): Uint8Array {
  const body = frames.flat();
  return Uint8Array.from([
    ...ascii("ID3"),
    version,
    0,
    0,
    ...syncsafe(body.length),
    ...body,
    ...FRAME,
  ]);
}
/** A v2.2 frame: three-letter id, 24-bit size. */
const frame22 = (id: string, data: number[]) => [
  ...ascii(id),
  (data.length >>> 16) & 255,
  (data.length >>> 8) & 255,
  data.length & 255,
  ...data,
];
/** A v2.3 frame: four-letter id, 32-bit size, two flag bytes. */
const frame23 = (id: string, data: number[]) => [...ascii(id), ...be32(data.length), 0, 0, ...data];
const utf16 = (text: string) => [0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0), 0])];

describe("ID3", () => {
  it("ID3v2.3 with a cover", async () => {
    const info = await read("tone-v23.mp3");
    expect(info.tags).toMatchObject({ ...TAGS, track: "3", year: "2026" });
    expectPngCover(info.cover);
  });

  it("ID3v2.4 with a cover, ahead of the ID3v1 tag at the end", async () => {
    const info = await read("tone-v24.mp3");
    expect(info.tags).toMatchObject(TAGS);
    expectPngCover(info.cover);
  });

  it("ID3v2.2 with three-letter frames and a PIC", async () => {
    const bytes = id3(2, [
      frame22("TT2", [0, ...ascii("Two Two")]),
      frame22("TP1", [0, ...ascii("Old Player")]),
      frame22("TAL", [0, ...ascii("Archive")]),
      frame22("PIC", [0, ...ascii("PNG"), 3, 0, ...PNG, 1, 2, 3]),
    ]);
    const info = await read("old.mp3", bytes);
    expect(info.tags).toMatchObject({ title: "Two Two", artist: "Old Player", album: "Archive" });
    expectPngCover(info.cover);
  });

  it("ID3v2.3 text in UTF-16 and a genre by number", async () => {
    const bytes = id3(3, [
      frame23("TIT2", [1, ...utf16("Café")]),
      frame23("TCON", [0, ...ascii("(13)")]),
    ]);
    const info = await read("cafe.mp3", bytes);
    expect(info.tags).toMatchObject({ title: "Café", genre: "Pop" });
  });

  it("ID3v1 alone, at the end of the file", async () => {
    const field = (text: string, size: number) => [
      ...ascii(text),
      ...new Array(size - text.length).fill(0),
    ];
    const tag = [
      ...ascii("TAG"),
      ...field("Old Tag", 30),
      ...field("Somebody", 30),
      ...field("Record", 30),
      ...ascii("1999"),
      ...field("", 28),
      0,
      7,
      13,
    ];
    const info = await read("v1.mp3", Uint8Array.from([...FRAME, ...FRAME, ...tag]));
    expect(info.tags).toMatchObject({
      title: "Old Tag",
      artist: "Somebody",
      album: "Record",
      year: "1999",
      track: "7",
      genre: "Pop",
    });
  });
});

describe("other tag formats", () => {
  it("MP4 ilst with a cover", async () => {
    const info = await read("tone.m4a");
    expect(info).toMatchObject({ container: "MP4", video: false, mime: "audio/mp4" });
    expect(info.tags).toMatchObject(TAGS);
    expectPngCover(info.cover);
  });

  it("Vorbis comments with METADATA_BLOCK_PICTURE, in Ogg and in FLAC", async () => {
    for (const name of ["tone.ogg", "tone.flac"]) {
      const info = await read(name);
      expect(info.tags, name).toMatchObject(TAGS);
      expectPngCover(info.cover);
    }
    expect((await read("tone.opus")).tags).toMatchObject(TAGS);
  });

  it("RIFF INFO in WAV and AVI", async () => {
    expect((await read("tone.wav")).tags).toMatchObject({ ...TAGS, genre: "Test" });
    expect((await read("clip.avi")).tags).toMatchObject(TAGS);
  });

  it("Matroska tags, ASF content descriptions, AIFF's ID3 chunk and APEv2", async () => {
    for (const name of ["clip.mkv", "clip.wmv", "tone.wma", "tone.aiff", "tone.wv"])
      expect((await read(name)).tags, name).toMatchObject(TAGS);
  });
});
