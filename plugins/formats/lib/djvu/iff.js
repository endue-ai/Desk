// The IFF 85 structure DjVu files use (DjVu v3 specification, section 8.2): chunks of a four-letter
// id, a 32-bit big-endian length and data padded to an even length; FORM chunks hold a secondary
// id and further chunks. Files may start with the four octets "AT&T".

/**
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * @typedef {{ id: string, start: number, size: number, kind?: string }} Chunk
 * `start` is where the chunk's data begins in the bytes it was found in; `kind` is a FORM's
 * secondary id (its data then starts 4 bytes later).
 */

const latin1 = (/** @type {Uint8Array} */ bytes, /** @type {number} */ at) =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** @param {Uint8Array} bytes @param {number} at */
export const u32 = (bytes, at) =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
/** @param {Uint8Array} bytes @param {number} at */
export const u24 = (bytes, at) => (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
/** @param {Uint8Array} bytes @param {number} at */
export const u16 = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];

/**
 * The chunks of one level, from `start` to `end`. A chunk running past `end` is cut to it, and
 * marked `cut` so callers can say the file is truncated.
 * @param {Uint8Array} bytes @param {number} [start] @param {number} [end]
 * @returns {(Chunk & { cut?: boolean })[]}
 */
export function chunksIn(bytes, start = 0, end = bytes.length) {
  /** @type {(Chunk & { cut?: boolean })[]} */
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    const id = latin1(bytes, at);
    if (!/^[\x20-\x7e]{4}$/.test(id)) throw new Error("The file's chunk structure is damaged.");
    const declared = u32(bytes, at + 4);
    const size = Math.min(declared, end - at - 8);
    /** @type {Chunk & { cut?: boolean }} */
    const chunk = { id, start: at + 8, size };
    if (size < declared) chunk.cut = true;
    if (id === "FORM" && size >= 4) chunk.kind = latin1(bytes, at + 8);
    out.push(chunk);
    at += 8 + size + (size & 1);
  }
  return out;
}

/** A chunk's data. @param {Uint8Array} bytes @param {Chunk} chunk */
export const dataOf = (bytes, chunk) =>
  bytes.subarray(chunk.kind ? chunk.start + 4 : chunk.start, chunk.start + chunk.size);

/**
 * The FORM at `offset` of a source: its kind and its bytes (from the FORM's id on).
 * @param {Source} source @param {number} offset
 */
export async function readForm(source, offset) {
  const head = await source.read(offset, 12);
  if (head.length < 12 || latin1(head, 0) !== "FORM") {
    throw new Error("A part of the document is not where its directory says.");
  }
  const size = u32(head, 4);
  const length = Math.min(8 + size, source.size - offset);
  const bytes = await source.read(offset, length);
  return { kind: latin1(head, 8), bytes, cut: length < 8 + size };
}

/**
 * Where a DjVu file's outer FORM starts (after the optional "AT&T"), and its kind.
 * @param {Source} source
 */
export async function outerForm(source) {
  const head = await source.read(0, 16);
  const at = head.length >= 4 && latin1(head, 0) === "AT&T" ? 4 : 0;
  if (head.length < at + 12 || latin1(head, at) !== "FORM") {
    throw new Error("This is not a DjVu file: it does not start with an IFF FORM.");
  }
  return { offset: at, kind: latin1(head, at + 8), size: u32(head, at + 4) };
}
