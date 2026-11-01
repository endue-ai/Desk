// ISO base media boxes, for HEIC and AVIF (the meta box: items, their locations and properties)
// and for Canon's CR3. Only what the viewer needs: the primary item's size, bit depth and
// transforms, and the data of an item by its type (the Exif item).
import { ascii, reader } from "../bytes.js";

/**
 * @typedef {{ type: string, start: number, body: number, end: number }} Box
 * @typedef {{ id: number, type: string, method: number, extents: Array<[number, number]>, base: number }} Item
 */

/**
 * The boxes between `start` and `end`.
 * @param {Uint8Array} bytes
 * @param {number} [start]
 * @param {number} [end]
 * @returns {Box[]}
 */
export function boxes(bytes, start = 0, end = bytes.length) {
  const r = reader(bytes, false);
  /** @type {Box[]} */
  const out = [];
  let at = start;
  while (at + 8 <= end && out.length < 4096) {
    let size = r.u32(at);
    let body = at + 8;
    if (size === 1 && at + 16 <= end) {
      size = r.u64(at + 8);
      body = at + 16;
    } else if (size === 0) size = end - at;
    if (size < body - at || at + size > end) break;
    out.push({ type: ascii(bytes, at + 4, 4), start: at, body, end: at + size });
    at += size;
  }
  return out;
}

/** The first child box of a type. */
export const child = (
  /** @type {Uint8Array} */ bytes,
  /** @type {Box | undefined} */ parent,
  /** @type {string} */ type,
  skip = 0,
) =>
  parent ? boxes(bytes, parent.body + skip, parent.end).find((b) => b.type === type) : undefined;

/** Read an unsigned integer of 0, 4 or 8 bytes. */
const sized = (
  /** @type {ReturnType<typeof reader>} */ r,
  /** @type {number} */ at,
  /** @type {number} */ n,
) => (n === 0 ? 0 : n === 4 ? r.u32(at) : n === 8 ? r.u64(at) : n === 2 ? r.u16(at) : 0);

/**
 * The HEIF meta box: items, the primary item, and each item's properties in association order.
 * @param {Uint8Array} bytes
 */
export function heif(bytes) {
  const r = reader(bytes, false);
  const meta = boxes(bytes).find((b) => b.type === "meta");
  if (!meta) return null;
  const inMeta = boxes(bytes, meta.body + 4, meta.end);
  const find = (/** @type {string} */ type) => inMeta.find((b) => b.type === type);
  /** @type {Map<number, Item>} */
  const items = new Map();

  const iinf = find("iinf");
  if (iinf) {
    const version = r.u8(iinf.body);
    const skip = 4 + (version === 0 ? 2 : 4);
    for (const infe of boxes(bytes, iinf.body + skip, iinf.end)) {
      if (infe.type !== "infe") continue;
      const v = r.u8(infe.body);
      if (v < 2) continue;
      const id = v === 2 ? r.u16(infe.body + 4) : r.u32(infe.body + 4);
      const typeAt = infe.body + 4 + (v === 2 ? 2 : 4) + 2;
      items.set(id, { id, type: ascii(bytes, typeAt, 4), method: 0, extents: [], base: 0 });
    }
  }

  const iloc = find("iloc");
  if (iloc) {
    const v = r.u8(iloc.body);
    const sizes = r.u16(iloc.body + 4);
    const [offsetSize, lengthSize, baseSize] = [sizes >> 12, (sizes >> 8) & 15, (sizes >> 4) & 15];
    const indexSize = v === 1 || v === 2 ? sizes & 15 : 0;
    let at = iloc.body + 6;
    const count = v < 2 ? r.u16(at) : r.u32(at);
    at += v < 2 ? 2 : 4;
    for (let i = 0; i < count && at < iloc.end; i++) {
      const id = v < 2 ? r.u16(at) : r.u32(at);
      at += v < 2 ? 2 : 4;
      const method = v === 1 || v === 2 ? r.u16(at) & 15 : 0;
      if (v === 1 || v === 2) at += 2;
      at += 2;
      const base = sized(r, at, baseSize);
      at += baseSize;
      const extents = r.u16(at);
      at += 2;
      /** @type {Array<[number, number]>} */
      const list = [];
      for (let e = 0; e < extents; e++) {
        at += indexSize;
        const offset = sized(r, at, offsetSize);
        const length = sized(r, at + offsetSize, lengthSize);
        at += offsetSize + lengthSize;
        list.push([offset, length]);
      }
      const item = items.get(id) ?? { id, type: "", method: 0, extents: [], base: 0 };
      Object.assign(item, { method, extents: list, base });
      items.set(id, item);
    }
  }

  const pitm = find("pitm");
  const primary = pitm ? (r.u8(pitm.body) === 0 ? r.u16(pitm.body + 4) : r.u32(pitm.body + 4)) : 0;

  const iprp = find("iprp");
  const ipco = child(bytes, iprp, "ipco");
  const properties = ipco ? boxes(bytes, ipco.body, ipco.end) : [];
  /** @type {Map<number, Box[]>} */
  const associated = new Map();
  const ipma = child(bytes, iprp, "ipma");
  if (ipma) {
    const v = r.u8(ipma.body);
    const flags = r.u8(ipma.body + 3);
    let at = ipma.body + 4;
    const count = r.u32(at);
    at += 4;
    for (let i = 0; i < count && at < ipma.end; i++) {
      const id = v < 1 ? r.u16(at) : r.u32(at);
      at += v < 1 ? 2 : 4;
      const n = r.u8(at++);
      /** @type {Box[]} */
      const list = [];
      for (let k = 0; k < n; k++) {
        const index = flags & 1 ? r.u16(at) & 0x7fff : r.u8(at) & 0x7f;
        at += flags & 1 ? 2 : 1;
        const property = properties[index - 1];
        if (property) list.push(property);
      }
      associated.set(id, list);
    }
  }

  const idat = find("idat");
  /** The bytes of an item: its extents, in the file or in idat. */
  const data = (/** @type {Item} */ item) => {
    const from = item.method === 1 ? (idat?.body ?? 0) : 0;
    const parts = item.extents.map(([offset, length]) => {
      const start = from + item.base + offset;
      return bytes.subarray(start, length === 0 ? bytes.length : start + length);
    });
    if (parts.length === 1) return parts[0] ?? new Uint8Array();
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };

  /** The primary item's properties: size, bits per channel, and its transforms as an orientation. */
  const primaryInfo = () => {
    const props = associated.get(primary) ?? [];
    const ispe = props.find((p) => p.type === "ispe");
    const pixi = props.find((p) => p.type === "pixi");
    let rotation = 0;
    let flipped = false;
    for (const p of props) {
      if (p.type === "irot") rotation = (rotation - 90 * (r.u8(p.body) & 3) + 360) % 360;
      else if (p.type === "imir") {
        const axis = r.u8(p.body) & 1;
        rotation = ((axis ? 180 : 0) - rotation + 360) % 360;
        flipped = !flipped;
      }
    }
    return {
      width: ispe ? r.u32(ispe.body + 4) : undefined,
      height: ispe ? r.u32(ispe.body + 8) : undefined,
      channels: pixi ? r.u8(pixi.body + 4) : undefined,
      bits: pixi ? r.u8(pixi.body + 5) : undefined,
      rotation,
      flipped,
      type: items.get(primary)?.type,
    };
  };

  return {
    items,
    primary,
    data,
    primaryInfo,
    byType: (/** @type {string} */ t) => [...items.values()].find((i) => i.type === t),
  };
}
