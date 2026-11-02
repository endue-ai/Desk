// A test-side reader for the fragmented MP4 the remuxer writes (ISO/IEC 14496-12): each track's
// sample entry and configuration boxes from the moov, and its samples from every moof and mdat with
// their decode and presentation times, durations, key flags and bytes. Written apart from the muxer.

export interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}

export interface Sample {
  dts: number;
  pts: number;
  duration: number;
  key: boolean;
  data: Uint8Array;
}

export interface Track {
  id: number;
  handler: string;
  timescale: number;
  entry: string;
  /** The sample entry's child boxes by type, as their contents. */
  boxes: Record<string, Uint8Array>;
  /** The sample entry's own fields: width and height, or channels, sample size and rate. */
  fields: { width?: number; height?: number; channels?: number; bits?: number; rate?: number };
  samples: Sample[];
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const type = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

export function boxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const out: Box[] = [];
  for (let at = start; at + 8 <= end; ) {
    const size = view(b).getUint32(at);
    if (size < 8 || at + size > end) throw new Error(`a box at ${at} runs past its parent`);
    out.push({ type: type(b, at + 4), start: at, body: at + 8, end: at + size });
    at += size;
  }
  return out;
}

const find = (b: Uint8Array, parent: Box, name: string) => {
  const box = boxes(b, parent.body, parent.end).find((x) => x.type === name);
  if (!box) throw new Error(`no ${name} in ${parent.type}`);
  return box;
};

/** Read an initialization segment followed by media segments. */
export function readFragmented(b: Uint8Array): { brands: string; tracks: Track[] } {
  const top = boxes(b);
  const ftyp = top.find((x) => x.type === "ftyp");
  const moov = top.find((x) => x.type === "moov");
  if (!ftyp || !moov) throw new Error("no ftyp or moov");
  const v = view(b);
  const tracks: Track[] = boxes(b, moov.body, moov.end)
    .filter((x) => x.type === "trak")
    .map((trak) => {
      const tkhd = find(b, trak, "tkhd");
      const mdia = find(b, trak, "mdia");
      const mdhd = find(b, mdia, "mdhd");
      const hdlr = find(b, mdia, "hdlr");
      const stsd = find(b, find(b, find(b, mdia, "minf"), "stbl"), "stsd");
      const entry = boxes(b, stsd.body + 8, stsd.end)[0];
      if (!entry) throw new Error("an empty stsd");
      const video = type(b, hdlr.body + 8) === "vide";
      const childStart = entry.body + (video ? 78 : 28);
      const fields = video
        ? { width: v.getUint16(entry.body + 24), height: v.getUint16(entry.body + 26) }
        : {
            channels: v.getUint16(entry.body + 16),
            bits: v.getUint16(entry.body + 18),
            rate: v.getUint32(entry.body + 24) / 0x10000,
          };
      const children: Record<string, Uint8Array> = {};
      for (const c of boxes(b, childStart, entry.end)) children[c.type] = b.subarray(c.body, c.end);
      return {
        id: v.getUint32(tkhd.body + 12),
        handler: type(b, hdlr.body + 8),
        timescale: v.getUint32(mdhd.body + 12),
        entry: entry.type,
        boxes: children,
        fields,
        samples: [],
      };
    });
  if (!boxes(b, moov.body, moov.end).some((x) => x.type === "mvex")) throw new Error("no mvex");
  for (let i = 0; i < top.length; i++) {
    const moof = top[i];
    if (moof?.type !== "moof") continue;
    const mdat = top[i + 1];
    if (mdat?.type !== "mdat") throw new Error("a moof without its mdat");
    for (const traf of boxes(b, moof.body, moof.end).filter((x) => x.type === "traf")) {
      const tfhd = find(b, traf, "tfhd");
      if ((v.getUint32(tfhd.body) & 0x020000) === 0)
        throw new Error("tfhd without default-base-is-moof");
      const track = tracks.find((t) => t.id === v.getUint32(tfhd.body + 4));
      if (!track) throw new Error("a traf for no track");
      const tfdt = find(b, traf, "tfdt");
      let dts =
        b[tfdt.body] === 1
          ? v.getUint32(tfdt.body + 4) * 2 ** 32 + v.getUint32(tfdt.body + 8)
          : v.getUint32(tfdt.body + 4);
      const trun = find(b, traf, "trun");
      const version = b[trun.body] ?? 0;
      const flags = v.getUint32(trun.body) & 0xffffff;
      const count = v.getUint32(trun.body + 4);
      let at = trun.body + 8;
      let offset = moof.start;
      if (flags & 1) {
        offset += v.getInt32(at);
        at += 4;
      }
      if (flags & 4) at += 4;
      for (let s = 0; s < count; s++) {
        const duration = flags & 0x100 ? v.getUint32(at) : 0;
        if (flags & 0x100) at += 4;
        const size = flags & 0x200 ? v.getUint32(at) : 0;
        if (flags & 0x200) at += 4;
        const sampleFlags = flags & 0x400 ? v.getUint32(at) : 0;
        if (flags & 0x400) at += 4;
        const cts = flags & 0x800 ? (version === 1 ? v.getInt32(at) : v.getUint32(at)) : 0;
        if (flags & 0x800) at += 4;
        if (offset < mdat.body || offset + size > mdat.end)
          throw new Error("a sample outside its mdat");
        track.samples.push({
          dts,
          pts: dts + cts,
          duration,
          key: (sampleFlags & 0x10000) === 0,
          data: b.subarray(offset, offset + size),
        });
        offset += size;
        dts += duration;
      }
    }
  }
  return { brands: type(b, ftyp.body), tracks };
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 (ISO 3309, as zlib and ffprobe's CRC32 hash compute it), as eight hex digits. */
export function crc32(b: Uint8Array): string {
  let c = 0xffffffff;
  for (const byte of b) c = (TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}
