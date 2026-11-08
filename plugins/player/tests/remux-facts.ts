// What make-remux-fixtures.sh recorded about each fixture's source (ffprobe's packets and streams)
// and how remux.test.ts compares a remuxed track with it: the same bytes after the same rewriting,
// times, durations and key flags. Written apart from the remuxer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { crc32, type Track } from "./fmp4";

export const DIR = join(import.meta.dirname, "fixtures", "remux");
export const file = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));

export interface Stream {
  index: number;
  type: string;
  codec: string;
  mime: string;
  rate: number;
  channels: number;
  extradata: string;
}
/** stream, pts, dts, duration (seconds), size, key, CRC-32, position */
export type Packet = [
  number,
  number | null,
  number | null,
  number | null,
  number,
  boolean,
  string,
  number,
];
export interface Facts {
  streams: Stream[];
  packets: Packet[];
}
export const facts = (name: string): Facts =>
  JSON.parse(readFileSync(join(DIR, `${name}.facts`), "utf8"));

/** A source over bytes that remembers every read's length. */
export function source(bytes: Uint8Array) {
  const reads: number[] = [];
  return {
    size: bytes.length,
    reads,
    read: async (offset: number, length: number) => {
      reads.push(length);
      return bytes.slice(offset, Math.min(bytes.length, offset + length));
    },
  };
}

/** Annex B to four-byte lengths without access unit delimiters: what the remuxer writes for AVI and MXF. */
export function prefixed(b: Uint8Array) {
  const nals: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] !== 0 || b[i + 1] !== 0 || b[i + 2] !== 1) continue;
    if (start >= 0) nals.push(b.subarray(start, i - (b[i - 1] === 0 ? 1 : 0)));
    start = i + 3;
    i += 2;
  }
  if (start >= 0) nals.push(b.subarray(start));
  const kept = nals.filter((n) => ((n[0] ?? 0) & 0x1f) !== 9);
  const out = new Uint8Array(kept.reduce((n, x) => n + x.length + 4, 0));
  let at = 0;
  for (const n of kept) {
    new DataView(out.buffer).setUint32(at, n.length);
    out.set(n, at + 4);
    at += 4 + n.length;
  }
  return { nals, out };
}

/** A packet's bytes in the source: ffprobe gives an AVI chunk's data and an MXF KLV's key. */
export function payload(bytes: Uint8Array, p: Packet, kind: "avi" | "mxf") {
  const pos = p[7];
  if (kind === "avi") return bytes.subarray(pos, pos + p[4]);
  const ber = bytes[pos + 16] ?? 0;
  const head = 17 + (ber & 0x80 ? ber & 0x7f : 0);
  return bytes.subarray(pos + head, pos + head + p[4]);
}

/** Presentation times for containers that store none: the decode times, in ffprobe's frame order. */
function displayTimes(name: string, packets: Packet[]) {
  const order = readFileSync(join(DIR, `${name}.order`), "utf8")
    .trim()
    .split(/\s+/)
    .map(Number);
  const times = packets.map((p) => p[2] ?? 0).sort((a, b) => a - b);
  return new Map(order.map((pos, rank) => [pos, times[rank] ?? 0]));
}

/**
 * The track's samples are the stream's packets that end after zero, with the same bytes, times
 * within a millisecond (Matroska and FLV round to one), durations and key flags.
 */
export function matches(
  track: Track,
  name: string,
  index: number,
  rewrite?: "avi" | "mxf" | Uint8Array[],
  zero = 0,
) {
  const all = facts(name).packets.filter((p) => p[0] === index);
  const shown = rewrite === "avi" || rewrite === "mxf" ? displayTimes(name, all) : null;
  const time = (p: Packet) => (shown?.get(p[7]) ?? p[1] ?? p[2] ?? 0) - zero;
  const kept = all.filter((p) => time(p) + (p[3] ?? 0) > 1e-6);
  expect(track.samples).toHaveLength(kept.length);
  const bytes = file(name);
  const video = track.handler === "vide";
  kept.forEach((p, i) => {
    const s = track.samples[i];
    if (!s) throw new Error(`sample ${i} is missing`);
    const source = Array.isArray(rewrite)
      ? rewrite[all.indexOf(p)]
      : rewrite
        ? payload(bytes, p, rewrite)
        : null;
    const crc = source && video ? crc32(prefixed(source).out) : p[6];
    expect(crc32(s.data), `${name} sample ${i} bytes`).toBe(crc);
    expect(
      Math.abs(s.pts / track.timescale - Math.max(0, time(p))),
      `${name} sample ${i} time`,
    ).toBeLessThan(0.0015);
    if (video) expect(s.key, `${name} sample ${i} key`).toBe(p[5]);
    if (i < kept.length - 1 && i > 0 && p[3])
      expect(
        Math.abs(s.duration / track.timescale - p[3]),
        `${name} sample ${i} duration`,
      ).toBeLessThan(0.0015);
  });
}

/** The PES payloads of one PID of a transport stream (192-byte packets), in order. */
export function pesPayloads(bytes: Uint8Array, pid: number) {
  const out: Uint8Array[] = [];
  let parts: number[] | null = null;
  for (let at = 4; at + 188 <= bytes.length; at += 192) {
    if (((((bytes[at + 1] ?? 0) & 0x1f) << 8) | (bytes[at + 2] ?? 0)) !== pid) continue;
    const control = ((bytes[at + 3] ?? 0) >> 4) & 3;
    const start = at + 4 + (control & 2 ? 1 + (bytes[at + 4] ?? 0) : 0);
    const payload = bytes.subarray(start, at + 188);
    if ((bytes[at + 1] ?? 0) & 0x40) {
      if (parts) out.push(Uint8Array.from(parts));
      parts = [...payload.subarray(9 + (payload[8] ?? 0))];
    } else parts?.push(...payload);
  }
  if (parts) out.push(Uint8Array.from(parts));
  return out;
}
