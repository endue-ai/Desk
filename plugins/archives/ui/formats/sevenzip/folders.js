// Decoding a 7z folder: its coders chained by their binds, from the pack streams to the one output
// stream. Copy, LZMA, LZMA2, BCJ x86, Delta, Deflate and BZip2; AES means encrypted.
import { decodeStream } from "../../codecs/index.js";
import { inflateRaw } from "../../codecs/inflate.js";
import { inputFrom, inputOfChunks } from "../../codecs/input.js";
import { bcjX86, deltaDecode, lzma2Raw, lzmaRaw } from "../../codecs/lzma/index.js";
import { sliceSource } from "../../source.js";
import { ENCRYPTED } from "../archive.js";
import { mainOut } from "./header.js";

/** @typedef {import("../../source.js").Source} Source */
/** @typedef {import("../../codecs/input.js").Input} Input */
/** @typedef {import("./header.js").Folder} Folder */
/** @typedef {import("./header.js").Streams} Streams */

/** Methods by coder id, as 7-Zip names them. */
const METHODS = /** @type {Record<string, string>} */ ({
  "00": "Copy",
  "03": "Delta",
  "030101": "LZMA",
  21: "LZMA2",
  "03030103": "BCJ",
  "0303011b": "BCJ2",
  "03030205": "PPC",
  "03030401": "IA64",
  "03030501": "ARM",
  "03030701": "ARMT",
  "03030805": "SPARC",
  "0a": "ARM64",
  "040108": "Deflate",
  "040109": "Deflate64",
  "040202": "BZip2",
  "030401": "PPMd",
  "06f10701": "AES",
  "04f71101": "Zstandard",
});
const AES = "06f10701";

/** Where each coder's in- and out-streams start in the folder's numbering. @param {Folder} folder */
function starts(folder) {
  let ins = 0;
  let outs = 0;
  return folder.coders.map((c) => {
    const at = { in: ins, out: outs };
    ins += c.ins;
    outs += c.outs;
    return at;
  });
}

/** The coder that writes out-stream `out`. @param {Folder} folder @param {number} out */
function coderOf(folder, out) {
  const at = starts(folder);
  const index = at.findIndex((s, i) => out >= s.out && out < s.out + (folder.coders[i]?.outs ?? 0));
  if (index < 0) throw new Error("The 7z header is damaged.");
  return index;
}

/** The coders from the folder's output back to its pack stream, along each coder's first input. @param {Folder} folder */
export function chain(folder) {
  const at = starts(folder);
  /** @type {number[]} */
  const order = [];
  for (let c = coderOf(folder, mainOut(folder)); order.length <= folder.coders.length; ) {
    order.push(c);
    const bind = folder.binds.find((b) => b.in === at[c]?.in);
    if (!bind) break;
    c = coderOf(folder, bind.out);
  }
  return order;
}

/** "BCJ, LZMA2": the methods in the order the data comes back through them. @param {Folder} folder */
export const methodOf = (folder) =>
  chain(folder)
    .map((c) => {
      const id = folder.coders[c]?.id ?? "";
      return METHODS[id] ?? `method ${id}`;
    })
    .join(", ");

/** @param {Folder} folder */
export const encrypted = (folder) => folder.coders.some((c) => c.id === AES);

/** All of an input's bytes, at most `size`, as chunks. @param {Input} input @param {number} size */
async function* copied(input, size) {
  let left = size;
  while (left > 0 && (await input.need(1))) {
    const n = Math.min(left, input.available);
    left -= n;
    yield input.take(n).slice();
  }
}

/** At most `size` bytes of `chunks`; fewer is damage. @param {AsyncIterable<Uint8Array>} chunks @param {number} size */
async function* limited(chunks, size) {
  let left = size;
  for await (const chunk of chunks) {
    if (left <= 0) return;
    const part = chunk.length > left ? chunk.subarray(0, left) : chunk;
    left -= part.length;
    yield part;
  }
  if (left > 0) throw new Error("The 7z block ends early.");
}

/**
 * The decoded output of folder `index` of `streams`, whose pack streams start at `base` in `source`.
 * @param {Source} source @param {Streams} streams @param {number} index @param {number} base
 * @returns {AsyncGenerator<Uint8Array>}
 */
export function folderChunks(source, streams, index, base) {
  const folder = /** @type {Folder} */ (streams.folders[index]);
  if (encrypted(folder)) throw new Error(ENCRYPTED);
  // The folder's pack streams follow those of the folders before it.
  let first = 0;
  for (let f = 0; f < index; f++) first += streams.folders[f]?.packed.length ?? 0;
  let offset = base + streams.packPos;
  for (let p = 0; p < first; p++) offset += streams.packSizes[p] ?? 0;
  /** @type {Array<[number, number]>} */
  const packs = folder.packed.map((_, j) => {
    const at = offset;
    offset += streams.packSizes[first + j] ?? 0;
    return [at, streams.packSizes[first + j] ?? 0];
  });
  const at = starts(folder);

  /** The chunks feeding in-stream `inIndex`: another coder's output, or a pack stream. @param {number} inIndex */
  const feed = (inIndex) => {
    const bind = folder.binds.find((b) => b.in === inIndex);
    if (bind) return { chunks: () => out(coderOf(folder, bind.out)) };
    const j = folder.packed.indexOf(inIndex);
    const pack = packs[j];
    if (!pack) throw new Error("The 7z header is damaged.");
    return { input: () => inputFrom(sliceSource(source, pack[0], pack[1])) };
  };

  /** The decoded chunks of coder `c`. @param {number} c @returns {AsyncGenerator<Uint8Array>} */
  const out = (c) => {
    const coder = /** @type {import("./header.js").Coder} */ (folder.coders[c]);
    if (coder.ins !== 1 || coder.outs !== 1)
      throw new Error(`The 7z method ${METHODS[coder.id] ?? coder.id} is not read here.`);
    const size = folder.sizes[at[c]?.out ?? 0] ?? 0;
    const from = feed(at[c]?.in ?? 0);
    const input = () =>
      from.input ? from.input() : inputOfChunks(/** @type {any} */ (from).chunks());
    const chunks = () => (from.chunks ? from.chunks() : copied(input(), Number.POSITIVE_INFINITY));
    switch (coder.id) {
      case "00":
        return copied(input(), size);
      case "030101":
        return lzmaRaw(input(), { props: coder.props, size, codec: "7z" });
      case "21":
        return lzma2Raw(input(), { dictProp: coder.props[0] ?? 0, size, codec: "7z" });
      case "03030103":
        return bcjX86(
          chunks(),
          coder.props.length >= 4
            ? new DataView(coder.props.buffer, coder.props.byteOffset).getUint32(0, true)
            : 0,
        );
      case "03":
        return deltaDecode(chunks(), (coder.props[0] ?? 0) + 1);
      case "040108":
        return inflateRaw(input());
      case "040202":
        return decodeStream("bzip2", input());
      default:
        throw new Error(`The 7z method ${METHODS[coder.id] ?? coder.id} is not read here.`);
    }
  };

  const size = folder.sizes[mainOut(folder)] ?? 0;
  return limited(out(coderOf(folder, mainOut(folder))), size);
}
