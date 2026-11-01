// The compressed bytes a decoder reads, pulled in chunks as it needs them, so a large stream never
// sits in memory whole. A decoder awaits `need(n)` at a safe point (a block header, every few
// thousand symbols), then reads synchronously from `buf` at `pos`.

/**
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * a file read by byte ranges: read answers exactly min(length, size - offset) bytes.
 */

export class Input {
  /** @param {() => Promise<Uint8Array | null>} pull the next chunk; null at the end */
  constructor(pull) {
    this.pull = pull;
    this.buf = new Uint8Array(0);
    this.pos = 0;
    this.done = false;
    /** Bytes dropped from before buf[0]. */
    this.dropped = 0;
  }

  /** Bytes buffered from pos on. */
  get available() {
    return this.buf.length - this.pos;
  }

  /** How far into the stream pos is. */
  get offset() {
    return this.dropped + this.pos;
  }

  /**
   * Keep at least `n` bytes buffered from pos on; false when the stream ends sooner (what is left
   * stays readable).
   * @param {number} n
   */
  async need(n) {
    while (this.buf.length - this.pos < n && !this.done) {
      const chunk = await this.pull();
      if (!chunk) {
        this.done = true;
        break;
      }
      if (chunk.length === 0) continue;
      const left = this.buf.length - this.pos;
      const next = new Uint8Array(left + chunk.length);
      next.set(this.buf.subarray(this.pos));
      next.set(chunk, left);
      this.dropped += this.pos;
      this.buf = next;
      this.pos = 0;
    }
    return this.buf.length - this.pos >= n;
  }

  /** Whether nothing is left. */
  async end() {
    return !(await this.need(1));
  }

  /** One byte; throws `ends` when none is buffered. */
  u8() {
    if (this.pos >= this.buf.length) throw this.ends();
    return /** @type {number} */ (this.buf[this.pos++]);
  }

  /** `n` buffered bytes, as a view that stays valid until the next `need`. @param {number} n */
  take(n) {
    if (this.pos + n > this.buf.length) throw this.ends();
    this.pos += n;
    return this.buf.subarray(this.pos - n, this.pos);
  }

  /** `n` bytes, pulled first when needed, as a copy. @param {number} n */
  async read(n) {
    if (!(await this.need(n))) throw this.ends();
    return this.take(n).slice();
  }

  /** @param {number} n */
  async skip(n) {
    while (n > 0) {
      if (!(await this.need(Math.min(n, 1 << 20)))) throw this.ends();
      const step = Math.min(n, this.available);
      this.pos += step;
      n -= step;
    }
  }

  /** The error for a stream that stops in the middle; decoders replace it with their own name. */
  ends() {
    return new Error("The stream ends early.");
  }
}

/** All of `bytes`, already buffered. @param {Uint8Array} bytes */
export function inputOf(bytes) {
  const input = new Input(async () => null);
  input.buf = bytes;
  input.done = true;
  return input;
}

/**
 * Part of a source, pulled `chunk` bytes at a time.
 * @param {Source} source @param {number} [offset] @param {number} [length] @param {number} [chunk]
 */
export function inputFrom(source, offset = 0, length = source.size - offset, chunk = 1 << 20) {
  let at = offset;
  const end = Math.min(source.size, offset + length);
  return new Input(async () => {
    if (at >= end) return null;
    const got = await source.read(at, Math.min(chunk, end - at));
    at += got.length;
    return got.length ? got : null;
  });
}

/** Chunks from any async iterable, as an Input. @param {AsyncIterable<Uint8Array>} chunks */
export function inputOfChunks(chunks) {
  const it = chunks[Symbol.asyncIterator]();
  return new Input(async () => {
    const { value, done } = await it.next();
    return done ? null : value;
  });
}

/** "The bzip2 stream is damaged: why." @param {string} codec @param {string} why */
export const damaged = (codec, why) => new Error(`The ${codec} stream is damaged: ${why}.`);
/** "The bzip2 stream ends early." @param {string} codec */
export const endsEarly = (codec) => new Error(`The ${codec} stream ends early.`);

/**
 * Re-throw a decoder's error with its codec's name: a read past the end becomes "ends early", and a
 * RangeError from damaged data becomes "damaged".
 * @param {string} codec @param {unknown} error
 */
export function named(codec, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "The stream ends early." || message === "The header ends early.")
    return endsEarly(codec);
  if (error instanceof RangeError || error instanceof TypeError)
    return damaged(codec, "a reference points outside the data");
  return error instanceof Error ? error : new Error(message);
}

/**
 * A source read forward `chunk` bytes at a time, where a skip past what is buffered moves the read
 * offset instead of reading: a plain tar's data is passed over without a single read.
 * @param {Source} source @param {number} [offset] @param {number} [chunk]
 */
export function inputSeekable(source, offset = 0, chunk = 64 * 1024) {
  let at = offset;
  const input = new Input(async () => {
    if (at >= source.size) return null;
    const got = await source.read(at, Math.min(chunk, source.size - at));
    at += got.length;
    return got.length ? got : null;
  });
  input.dropped = offset;
  input.skip = async (n) => {
    const buffered = input.available;
    if (n <= buffered) {
      input.pos += n;
      return;
    }
    input.dropped += input.buf.length + (n - buffered);
    input.buf = new Uint8Array(0);
    input.pos = 0;
    at += n - buffered;
    if (at > source.size) throw input.ends();
  };
  return input;
}
