// AMR (narrow and wide band: 20 ms frames counted from their headers), RealMedia (PROP, CONT and
// each stream's MDPR) and MXF, which the player recognises but does not read further.
import { Cursor, indexOf, latin1, startsWith } from "../bytes.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Track} Track
 */

// Frame sizes in bytes with the header byte, by frame type.
const NB = [13, 14, 16, 18, 20, 21, 27, 32, 6, 1, 1, 1, 1, 1, 1, 1];
const WB = [18, 24, 33, 37, 41, 47, 51, 59, 61, 6, 1, 1, 1, 1, 1, 1];

/** @type {Read} */
export async function readAmr(source, head) {
  const wide = startsWith(head, "#!AMR-WB\n");
  const start = wide ? 9 : startsWith(head, "#!AMR_MC1.0\n") ? 12 : 6;
  const sizes = wide ? WB : NB;
  const bytes = await source.read(start, 1 << 20);
  let frames = 0;
  let at = 0;
  while (at < bytes.length) {
    at += sizes[((bytes[at] ?? 0) >> 3) & 15] ?? 1;
    frames++;
  }
  const total = source.size - start;
  const count = at >= total || bytes.length >= total ? frames : (frames * total) / Math.max(1, at);
  return {
    duration: count * 0.02,
    tracks: [
      {
        kind: "audio",
        codec: wide ? "AMR-WB" : "AMR-NB",
        sampleRate: wide ? 16000 : 8000,
        channels: 1,
      },
    ],
  };
}

const REAL_VIDEO = {
  RV10: "RealVideo 1.0",
  RV20: "RealVideo 2.0",
  RV30: "RealVideo 3.0",
  RV40: "RealVideo 4.0",
};
const REAL_AUDIO = {
  cook: "Cook",
  dnet: "AC-3",
  sipr: "Sipro",
  atrc: "ATRAC3",
  raac: "AAC",
  racp: "HE-AAC",
  "28_8": "RealAudio 2.0",
  lpcJ: "RealAudio 1.0",
  ralf: "RealAudio Lossless",
};

/** @type {Read} */
export async function readRealMedia(source) {
  /** @type {Track[]} */
  const tracks = [];
  /** @type {import("./index.js").Tags} */
  const tags = {};
  let duration;
  for (let at = 0, n = 0; at + 10 <= source.size && n < 64; n++) {
    const h = new Cursor(await source.read(at, 10));
    const id = h.ascii(4);
    const size = h.u32();
    if (size < 10 || id === "DATA") break;
    const b = await source.read(at + 10, Math.min(size - 10, 1 << 20));
    const c = new Cursor(b);
    if (id === "PROP") {
      c.skip(20);
      duration = c.u32() / 1000;
    } else if (id === "CONT") {
      const [title, author, , comment] = [0, 1, 2, 3].map(() => latin1(c.take(c.u16())).trim());
      if (title) tags.title = title;
      if (author) tags.artist = author;
      if (comment) tags.comment = comment;
    } else if (id === "MDPR") {
      c.skip(30);
      c.skip(c.u8());
      const mime = latin1(c.take(c.u8()));
      const data = c.take(c.u32());
      if (mime.startsWith("video/")) {
        const v = indexOf(data, "VIDO");
        const fourcc = v >= 0 ? latin1(data.subarray(v + 4, v + 8)) : "";
        const s = new Cursor(data, v + 8);
        const name =
          /** @type {Record<string, string>} */ (REAL_VIDEO)[fourcc] ?? (fourcc || "RealVideo");
        tracks.push({
          kind: "video",
          codec: name,
          codecId: fourcc,
          width: s.u16(),
          height: s.u16(),
        });
      } else if (mime.startsWith("audio/")) {
        const text = latin1(data);
        const found = Object.keys(REAL_AUDIO).find((code) => text.includes(code));
        const name = found
          ? /** @type {Record<string, string>} */ (REAL_AUDIO[found] ?? found)
          : "RealAudio";
        tracks.push({ kind: "audio", codec: name, codecId: found });
      }
    }
    at += size;
  }
  tracks.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "video" ? -1 : 1));
  return { duration, tracks, tags };
}

/** @type {Read} */
export async function readMxf() {
  return { tracks: [] };
}
