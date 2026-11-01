// A forward reader over a ranged source for the demuxers: it reads ahead in parts of at most 1 MiB,
// hands out views of what it holds, and jumps without reading what it skips.

/** @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source */

export const PART = 1 << 20;

export class Reader {
  /**
   * @param {Source} source
   * @param {number} [pos]
   */
  constructor(source, pos = 0) {
    this.source = source;
    this.size = source.size;
    /** The file offset of `buffer[0]`. */
    this.start = pos;
    this.buffer = new Uint8Array(0);
    this.pos = pos;
  }
  get eof() {
    return this.pos >= this.size;
  }
  /** Bytes held from `pos` on. */
  get held() {
    return Math.max(0, this.start + this.buffer.length - this.pos);
  }
  /**
   * Hold at least `n` bytes from `pos` (fewer at the end of the file); answers how many it holds.
   * @param {number} n
   */
  async need(n) {
    if (this.held >= n) return this.held;
    const keep = this.pos >= this.start && this.pos <= this.start + this.buffer.length;
    const have = keep ? this.buffer.subarray(this.pos - this.start) : new Uint8Array(0);
    const parts = [have];
    let at = this.pos + have.length;
    let total = have.length;
    const want = Math.min(this.size - this.pos, Math.max(n, 256 * 1024));
    while (total < want) {
      const length = Math.min(PART, want - total);
      const bytes = await this.source.read(at, length);
      if (bytes.length === 0) break;
      parts.push(bytes);
      total += bytes.length;
      at += bytes.length;
    }
    if (parts.length === 1) {
      this.start = this.pos;
      this.buffer = have;
      return have.length;
    }
    const joined = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.length;
    }
    this.start = this.pos;
    this.buffer = joined;
    return total;
  }
  /** A view of the `n` bytes at `pos` (call need first). @param {number} n */
  peek(n) {
    const from = this.pos - this.start;
    return this.buffer.subarray(from, from + n);
  }
  /** The next `n` bytes, and move past them. @param {number} n */
  async take(n) {
    await this.need(n);
    const out = this.peek(n);
    this.pos += out.length;
    return out;
  }
  /** @param {number} n */
  skip(n) {
    this.pos += n;
  }
  /** @param {number} pos */
  seek(pos) {
    this.pos = pos;
  }
}
