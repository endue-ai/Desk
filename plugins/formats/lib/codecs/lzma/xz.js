// The .xz container: streams of blocks, each a filter chain ending in LZMA2 and followed by its
// check (CRC32 or CRC64; SHA-256 is passed over), an index of the blocks, and a footer.
import { at, u32 } from "../bytes.js";
import { crc32 } from "../checksums.js";
import { damaged, endsEarly } from "../input.js";
import { bcjX86, deltaDecode } from "./bcj.js";
import { Crc64 } from "./crc64.js";
import { lzma2Raw } from "./lzma2.js";

/** @typedef {import("../input.js").Input} Input */

const XZ = "xz";
/** Bytes of each check type's value. */
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];

/** A multibyte integer from `bytes` at `c.pos`. @param {Uint8Array} bytes @param {{ pos: number }} c */
function varint(bytes, c) {
  let value = 0;
  for (let i = 0; i < 9; i++) {
    if (c.pos >= bytes.length) throw damaged(XZ, "a block header ends early");
    const b = /** @type {number} */ (bytes[c.pos++]);
    value += (b & 0x7f) * 2 ** (7 * i);
    if (!(b & 0x80)) return value;
  }
  throw damaged(XZ, "a number is too long");
}

/** @param {Uint8Array} head the block header, its size byte included */
function blockHeader(head) {
  if (crc32(head.subarray(0, head.length - 4)) !== u32(head, head.length - 4))
    throw damaged(XZ, "a block header's CRC does not match");
  const flags = /** @type {number} */ (head[1]);
  if (flags & 0x3c) throw damaged(XZ, "a block header has unknown flags");
  const c = { pos: 2 };
  const packed = flags & 0x40 ? varint(head, c) : undefined;
  const unpacked = flags & 0x80 ? varint(head, c) : undefined;
  /** @type {Array<{ id: number, props: Uint8Array }>} */
  const filters = [];
  for (let i = 0; i <= (flags & 3); i++) {
    const id = varint(head, c);
    const size = varint(head, c);
    if (c.pos + size > head.length - 4) throw damaged(XZ, "a block header ends early");
    filters.push({ id, props: head.subarray(c.pos, c.pos + size) });
    c.pos += size;
  }
  for (; c.pos < head.length - 4; c.pos++)
    if (head[c.pos] !== 0) throw damaged(XZ, "a block header's padding is not zero");
  const last = filters.at(-1);
  if (last?.id !== 0x21 || last.props.length !== 1)
    throw damaged(XZ, "a block does not end its filters with LZMA2");
  for (const f of filters.slice(0, -1))
    if (f.id !== 0x03 && f.id !== 0x04)
      throw new Error(`The xz stream uses filter 0x${f.id.toString(16)}, which is not read here.`);
  return { packed, unpacked, filters };
}

/** A check that keeps up with the data: CRC32, CRC64, or nothing it verifies. @param {number} type */
function checker(type) {
  if (type === 1) {
    let crc = 0;
    return {
      update: (/** @type {Uint8Array} */ b) => {
        crc = crc32(b, crc);
      },
      matches: (/** @type {Uint8Array} */ stored) => u32(stored, 0) === crc,
    };
  }
  if (type === 4) return new Crc64();
  return { update: () => {}, matches: () => true };
}

/**
 * @param {Input} input
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* unxz(input) {
  for (let streams = 0; ; streams++) {
    if (streams > 0) {
      // Stream padding: zero bytes in fours, then another stream or the end.
      for (;;) {
        if (!(await input.need(1))) return;
        if (!(await input.need(4))) throw damaged(XZ, "the padding after a stream is not whole");
        const four = input.buf.subarray(input.pos, input.pos + 4);
        if (four.some((b) => b !== 0)) break;
        input.pos += 4;
      }
    }
    if (!(await input.need(12))) throw endsEarly(XZ);
    const header = input.take(12).slice();
    if (!at(header, 0, "\xfd7zXZ\x00")) throw damaged(XZ, "it does not start with the xz magic");
    if (crc32(header.subarray(6, 8)) !== u32(header, 8))
      throw damaged(XZ, "the stream header's CRC does not match");
    if (header[6] !== 0 || (header[7] ?? 0) & 0xf0)
      throw damaged(XZ, "the stream flags are not valid");
    const checkType = (header[7] ?? 0) & 0x0f;
    const checkSize = /** @type {number} */ (CHECK_SIZES[checkType]);
    /** @type {Array<[number, number]>} */
    const records = [];
    for (;;) {
      if (!(await input.need(1))) throw endsEarly(XZ);
      const first = /** @type {number} */ (input.buf[input.pos]);
      if (first === 0) break;
      const headSize = (first + 1) * 4;
      if (!(await input.need(headSize))) throw endsEarly(XZ);
      const block = blockHeader(input.take(headSize).slice());
      const lzma2 = /** @type {{ props: Uint8Array }} */ (block.filters.at(-1));
      const start = input.offset;
      /** @type {AsyncIterable<Uint8Array>} */
      let chunks = lzma2Raw(input, {
        dictProp: /** @type {number} */ (lzma2.props[0]),
        size: block.unpacked,
        codec: XZ,
      });
      for (const f of block.filters.slice(0, -1).reverse())
        chunks =
          f.id === 0x04
            ? bcjX86(chunks, f.props.length === 4 ? u32(f.props, 0) : 0)
            : deltaDecode(chunks, (f.props[0] ?? 0) + 1);
      const check = checker(checkType);
      let unpacked = 0;
      for await (const chunk of chunks) {
        unpacked += chunk.length;
        check.update(chunk);
        yield chunk;
      }
      const packed = input.offset - start;
      if (block.packed !== undefined && block.packed !== packed)
        throw damaged(XZ, "a block's packed size does not match its header");
      if (block.unpacked !== undefined && block.unpacked !== unpacked)
        throw damaged(XZ, "a block's size does not match its header");
      const pad = (4 - (packed % 4)) % 4;
      if (!(await input.need(pad + checkSize))) throw endsEarly(XZ);
      if (input.take(pad).some((b) => b !== 0)) throw damaged(XZ, "a block's padding is not zero");
      if (!check.matches(input.take(checkSize)))
        throw damaged(XZ, "a block's check does not match its data");
      records.push([headSize + packed + checkSize, unpacked]);
    }
    const index = await readIndex(input);
    if (
      index.length !== records.length ||
      index.some(([a, b], i) => a !== records[i]?.[0] || b !== records[i]?.[1])
    )
      throw damaged(XZ, "the index does not match the blocks");
    if (!(await input.need(12))) throw endsEarly(XZ);
    const footer = input.take(12).slice();
    if (!at(footer, 10, "YZ")) throw damaged(XZ, "the stream footer is missing");
    if (crc32(footer.subarray(4, 10)) !== u32(footer, 0))
      throw damaged(XZ, "the stream footer's CRC does not match");
    if (footer[8] !== header[6] || footer[9] !== header[7])
      throw damaged(XZ, "the stream footer's flags do not match its header");
    if ((u32(footer, 4) + 1) * 4 !== index.size)
      throw damaged(XZ, "the stream footer's index size does not match");
  }
}

/**
 * The index: its records (unpadded size, uncompressed size) and its size in bytes.
 * @param {Input} input
 */
async function readIndex(input) {
  /** @type {number[]} */
  const seen = [];
  const byte = async () => {
    if (!(await input.need(1))) throw endsEarly(XZ);
    const b = input.u8();
    seen.push(b);
    return b;
  };
  const number = async () => {
    let value = 0;
    for (let i = 0; i < 9; i++) {
      const b = await byte();
      value += (b & 0x7f) * 2 ** (7 * i);
      if (!(b & 0x80)) return value;
    }
    throw damaged(XZ, "a number in the index is too long");
  };
  await byte();
  const count = await number();
  /** @type {Array<[number, number]> & { size?: number }} */
  const records = [];
  for (let i = 0; i < count; i++) records.push([await number(), await number()]);
  while (seen.length % 4)
    if ((await byte()) !== 0) throw damaged(XZ, "the index padding is not zero");
  if (!(await input.need(4))) throw endsEarly(XZ);
  const stored = u32(input.take(4), 0);
  if (crc32(Uint8Array.from(seen)) !== stored) throw damaged(XZ, "the index's CRC does not match");
  return Object.assign(records, { size: seen.length + 4 });
}
