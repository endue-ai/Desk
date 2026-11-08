// The decode worker's file, read synchronously as FFmpeg asks for it: Range requests with a
// synchronous XMLHttpRequest (allowed in workers) to the file's fs.url URL, in blocks of 256 KiB
// kept in a small cache, or the whole file in memory when the URL cannot be read here.

const BLOCK = 256 * 1024;
const KEEP = 64;

/** A reader that failed: the worker answers with code "read" and the page sends the bytes. */
export class ReadError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.code = "read";
  }
}

/**
 * @param {ArrayBuffer} buffer the whole file
 * @returns {import("./ffmpeg.js").SyncFile}
 */
export function bytesReader(buffer) {
  const bytes = new Uint8Array(buffer);
  return {
    size: bytes.length,
    read: (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
  };
}

/**
 * @param {string} url the file's absolute fs.url URL
 * @param {number} size the file's size
 * @param {{ fetchRange?: (url: string, start: number, end: number) => { status: number, body: ArrayBuffer } }} [options]
 * @returns {import("./ffmpeg.js").SyncFile}
 */
export function urlReader(url, size, options = {}) {
  const fetchRange = options.fetchRange ?? syncRange;
  /** Blocks by index, the most recently used last. @type {Map<number, Uint8Array>} */
  const blocks = new Map();
  /** The whole file, when the server answered a range with all of it. @type {Uint8Array | undefined} */
  let whole;

  const block = (/** @type {number} */ index) => {
    const kept = blocks.get(index);
    if (kept) {
      blocks.delete(index);
      blocks.set(index, kept);
      return kept;
    }
    const start = index * BLOCK;
    const end = Math.min(size, start + BLOCK) - 1;
    let answer;
    try {
      answer = fetchRange(url, start, end);
    } catch (error) {
      throw new ReadError(`The file could not be read: ${String(error)}`);
    }
    if (answer.status === 200 && answer.body.byteLength >= size) {
      whole = new Uint8Array(answer.body);
      return whole.subarray(start, end + 1);
    }
    if (answer.status !== 206)
      throw new ReadError(`The file could not be read (${answer.status}).`);
    const got = new Uint8Array(answer.body);
    blocks.set(index, got);
    while (blocks.size > KEEP) blocks.delete(/** @type {number} */ (blocks.keys().next().value));
    return got;
  };

  return {
    size,
    read(offset, length) {
      const start = Math.max(0, Math.min(size, offset));
      const end = Math.min(size, start + length);
      if (whole) return whole.subarray(start, end);
      const out = new Uint8Array(end - start);
      let filled = 0;
      for (let at = start; at < end; ) {
        const index = Math.floor(at / BLOCK);
        const part = whole ? whole.subarray(index * BLOCK) : block(index);
        const from = at - index * BLOCK;
        const piece = part.subarray(from, Math.min(part.length, from + end - at));
        if (piece.length === 0) break;
        out.set(piece, filled);
        filled += piece.length;
        at += piece.length;
      }
      return filled === out.length ? out : out.subarray(0, filled);
    },
  };
}

/** One synchronous ranged GET. */
function syncRange(
  /** @type {string} */ url,
  /** @type {number} */ start,
  /** @type {number} */ end,
) {
  const request = new XMLHttpRequest();
  request.open("GET", url, false);
  request.responseType = "arraybuffer";
  request.setRequestHeader("Range", `bytes=${start}-${end}`);
  request.send();
  return { status: request.status, body: /** @type {ArrayBuffer} */ (request.response) };
}
