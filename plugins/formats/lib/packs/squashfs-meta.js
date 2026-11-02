// SquashFS metadata: blocks of at most 8 KiB, each behind a 16-bit header (its stored size, the top
// bit set when it is stored as it is), that the inode and directory tables run through, and the
// lookup tables (ids, fragments, the export table) whose blocks a list of 64-bit offsets finds.
import { u16, u64 } from "../disk/bytes.js";
import { lru } from "../disk/lru.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("./squashfs-codec.js").BlockDecoder} BlockDecoder */
/** @typedef {{ bytes: Uint8Array, next: number }} Block a decoded block and where the next starts */

const BLOCK = 8192;

/** @param {string} why */
export const damaged = (why) => new Error(`The SquashFS image is damaged: ${why}.`);

export class Metadata {
  /** @param {Source} source the file system, read from its superblock on @param {BlockDecoder} decoder @param {number} end the bytes it uses */
  constructor(source, decoder, end) {
    this.source = source;
    this.end = end;
    /** @type {(at: number) => Promise<Block>} */
    this.block = lru(1024, async (at) => {
      if (at + 2 > end) throw damaged("a metadata block lies past the end of the file system");
      const head = await this.source.read(at, 2);
      const word = u16(head, 0);
      const size = word & 0x7fff;
      if (head.length < 2 || size === 0 || at + 2 + size > end)
        throw damaged("a metadata block lies past the end of the file system");
      const stored = await this.source.read(at + 2, size);
      const bytes = word & 0x8000 ? stored : await decoder(stored, BLOCK);
      if (bytes.length === 0) throw damaged("a metadata block holds nothing");
      return { bytes, next: at + 2 + size };
    });
  }

  /**
   * `length` bytes from `offset` into the block at `at`, going on into the blocks after it.
   * @param {number} at @param {number} offset @param {number} length @param {string} what
   */
  async read(at, offset, length, what) {
    const out = new Uint8Array(length);
    if (length === 0) return out;
    let done = 0;
    let block = await this.block(at);
    if (offset > block.bytes.length) throw damaged(`${what} starts past the end of its block`);
    while (done < length) {
      if (offset >= block.bytes.length) {
        block = await this.block(block.next);
        offset = 0;
      }
      const n = Math.min(length - done, block.bytes.length - offset);
      out.set(block.bytes.subarray(offset, offset + n), done);
      done += n;
      offset += n;
    }
    return out;
  }

  /**
   * A reader that goes forward from `offset` in the block at `at`.
   * @param {number} at @param {number} offset @param {string} what
   */
  cursor(at, offset, what) {
    const meta = this;
    return {
      at,
      offset,
      /** The next `n` bytes. @param {number} n */
      async take(n) {
        let block = await meta.block(this.at);
        if (this.offset > block.bytes.length) throw damaged(`${what} starts past its block`);
        if (this.offset + n <= block.bytes.length) {
          this.offset += n;
          return block.bytes.subarray(this.offset - n, this.offset);
        }
        const out = new Uint8Array(n);
        let done = 0;
        while (done < n) {
          if (this.offset >= block.bytes.length) {
            this.at = block.next;
            this.offset = 0;
            block = await meta.block(this.at);
          }
          const step = Math.min(n - done, block.bytes.length - this.offset);
          out.set(block.bytes.subarray(this.offset, this.offset + step), done);
          done += step;
          this.offset += step;
        }
        return out;
      },
    };
  }

  /**
   * A lookup table of `count` entries of `size` bytes whose block offsets start at `start`: an
   * entry by its index, its block read when first asked for.
   * @param {number} start @param {number} count @param {number} size @param {string} what
   * @returns {Promise<(index: number) => Promise<Uint8Array>>}
   */
  async table(start, count, size, what) {
    const perBlock = BLOCK / size;
    const blocks = Math.ceil(count / perBlock);
    if (start + blocks * 8 > this.end) throw damaged(`the ${what} lies past the end`);
    const list = await this.source.read(start, blocks * 8);
    const offsets = Array.from({ length: blocks }, (_, i) => u64(list, i * 8));
    for (const at of offsets)
      if (at >= start) throw damaged(`the ${what} points past its own list of blocks`);
    return async (index) => {
      if (index < 0 || index >= count) throw damaged(`the ${what} has no entry ${index}`);
      const at = /** @type {number} */ (offsets[Math.floor(index / perBlock)]);
      const { bytes } = await this.block(at);
      const o = (index % perBlock) * size;
      if (o + size > bytes.length) throw damaged(`an entry of the ${what} is cut short`);
      return bytes.subarray(o, o + size);
    };
  }
}
