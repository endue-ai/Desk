// EBML (RFC 8794) for the Matroska demuxer: element IDs and sizes as variable-length integers,
// elements inside bytes already read, and their values as numbers and text.

/** @typedef {{ id: number, at: number, size: number, end: number, head: number }} Element */

/** A size (marker removed; all ones means unknown) at `at`, or null. */
export function vint(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  const first = b[at] ?? 0;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > b.length) return null;
  let value = first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = b[at + i] ?? 0;
    if (byte !== 0xff) unknown = false;
    value = value * 256 + byte;
  }
  return { value, length, unknown };
}

/** An element ID (marker kept) at `at`, or null. */
export function idAt(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  const first = b[at] ?? 0;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || first === 0 || at + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + (b[at + i] ?? 0);
  return { value, length };
}

/**
 * The element whose header is at `at`; an unknown size is -1 and runs to `end`.
 * @param {Uint8Array} b
 * @param {number} at
 * @param {number} [end]
 * @returns {Element | null}
 */
export function elementAt(b, at, end = b.length) {
  const id = idAt(b, at);
  if (!id) return null;
  const size = vint(b, at + id.length);
  if (!size) return null;
  const head = id.length + size.length;
  const start = at + head;
  const length = size.unknown ? -1 : size.value;
  return { id: id.value, at: start, size: length, end: length < 0 ? end : start + length, head };
}

/** The elements inside [start, end) of bytes already read. */
export function children(/** @type {Uint8Array} */ b, start = 0, end = b.length) {
  /** @type {Element[]} */
  const out = [];
  for (let at = start; at < end; ) {
    const e = elementAt(b, at, end);
    if (!e || e.end > end) break;
    out.push(e);
    at = e.end;
  }
  return out;
}

export const uint = (/** @type {Uint8Array} */ b, /** @type {Element} */ e) => {
  let value = 0;
  for (let i = e.at; i < e.end; i++) value = value * 256 + (b[i] ?? 0);
  return value;
};

export const float = (/** @type {Uint8Array} */ b, /** @type {Element} */ e) => {
  const view = new DataView(b.buffer, b.byteOffset + e.at, Math.max(0, e.end - e.at));
  return e.size === 4 ? view.getFloat32(0) : e.size === 8 ? view.getFloat64(0) : 0;
};

export const text = (/** @type {Uint8Array} */ b, /** @type {Element} */ e) =>
  new TextDecoder().decode(b.subarray(e.at, e.end)).replace(/\0+$/, "");

/** The first child with `id`, or undefined. */
export const child = (
  /** @type {Uint8Array} */ b,
  /** @type {Element} */ e,
  /** @type {number} */ id,
) => children(b, e.at, e.end).find((c) => c.id === id);
