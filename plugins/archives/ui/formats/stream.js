// One compressed stream (.gz, .bz2, .xz, .lzma, .zst, .lz4, .Z): a tar or cpio inside it opens as
// that archive, anything else is one entry named after the file (gzip's stored name when it has one).
import { field, u32, u64, unixDate } from "../bytes.js";
import { CODEC_NAMES, collect, decodedInput, decodeStream } from "../codecs/index.js";
import { inputFrom } from "../codecs/input.js";
import { isCpio, openCpio, openCpioIn } from "./cpio.js";
import { isTar, openTarIn } from "./tar.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./archive.js").Entry} Entry */

/** Extensions of single streams, and the codec each names. */
export const STREAMS = /** @type {Record<string, string>} */ ({
  gz: "gzip",
  tgz: "gzip",
  bz2: "bzip2",
  tbz: "bzip2",
  tbz2: "bzip2",
  xz: "xz",
  txz: "xz",
  lzma: "lzma",
  zst: "zstd",
  tzst: "zstd",
  lz4: "lz4",
  z: "lzw",
});

/** The entry's name: the file's without the stream's extension (x.tgz holds x.tar). @param {string} name */
function inner(name) {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const m = /^(.*)\.([^.]+)$/.exec(base);
  if (!m) return `${base}.out`;
  const ext = (m[2] ?? "").toLowerCase();
  if (ext.startsWith("t") && ext !== "txt" && STREAMS[ext]) return `${m[1]}.tar`;
  return STREAMS[ext] ? (m[1] ?? base) : `${base}.out`;
}

/** What the stream's own header or trailer tells of the entry: gzip's name and time, sizes. @param {string} codec @param {Source} source */
async function described(codec, source) {
  /** @type {{ name?: string, date?: Date, size: number }} */
  const out = { size: -1 };
  if (codec === "gzip") {
    const head = await source.read(0, Math.min(source.size, 1024));
    const flags = head[3] ?? 0;
    out.date = unixDate(u32(head, 4));
    let at = 10;
    if (flags & 4) at += 2 + (head[at] ?? 0) + ((head[at + 1] ?? 0) << 8);
    if (flags & 8) out.name = field(head, at, head.length - at);
    // ISIZE is the size modulo 2^32: trusted below 4 GiB of input only.
    if (source.size < 0xffffffff) out.size = u32(await source.read(source.size - 4, 4), 0);
  } else if (codec === "lzma") {
    const head = await source.read(0, 13);
    const size = u64(head, 5);
    if (u32(head, 5) !== 0xffffffff || u32(head, 9) !== 0xffffffff) out.size = size;
  } else if (codec === "lz4") {
    const head = await source.read(0, 14);
    if (u32(head, 0) === 0x184d2204 && (head[4] ?? 0) & 8) out.size = u64(head, 6);
  } else if (codec === "zstd") {
    const head = await source.read(0, 18);
    const fhd = head[4] ?? 0;
    const fcs = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const at = 5 + (single ? 0 : 1) + [0, 1, 2, 4][fhd & 3];
    if (u32(head, 0) === 0xfd2fb528 && (fcs || single)) {
      const width = [1, 2, 4, 8][fcs] ?? 1;
      let size = width === 8 ? u64(head, at) : width === 4 ? u32(head, at) : 0;
      if (width === 1) size = head[at] ?? 0;
      if (width === 2) size = ((head[at] ?? 0) | ((head[at + 1] ?? 0) << 8)) + 256;
      out.size = size;
    }
  }
  return out;
}

/**
 * @param {Source} source @param {string} name @param {{ key: string, label: string }} kind
 * @returns {Promise<Archive>}
 */
export async function openStream(source, name, kind) {
  if (kind.key === "cpio") return openCpio(source);
  const codec = kind.key;
  const label = CODEC_NAMES[codec] ?? codec;
  const peek = await collect(
    decodeStream(codec, inputFrom(source, 0, source.size, 64 * 1024)),
    512,
  );
  const open = () => decodedInput(codec, source);
  if (isTar(peek)) return openTarIn(open, `tar (${label})`);
  if (isCpio(peek)) return openCpioIn(open, `cpio (${label})`);
  const about = await described(codec, source);
  /** @type {Entry} */
  const entry = {
    path: about.name || inner(name),
    kind: "file",
    size: about.size,
    packed: source.size,
    method: label,
  };
  if (about.date) entry.date = about.date;
  return {
    format: label,
    entries: [entry],
    details: [],
    read: (_entry, limit = Number.POSITIVE_INFINITY) =>
      collect(decodeStream(codec, inputFrom(source)), limit),
  };
}
