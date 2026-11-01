// PalmDB containers and the compressions MOBI uses, written for the fixtures: PalmDOC (LZ77 with
// literal runs, space pairs and back-references), a one-byte-code HUFF/CDIC table, KF8's INDX
// records with their TAGX tables, and the trailing entries of text records.
import { concat } from "./archive";

const single = (b: number) => b === 0 || (b >= 0x09 && b <= 0x7f);

/** PalmDOC compression: back-references of 3-10 bytes, space pairs, single bytes, literal runs. */
export function palmdoc(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    let best = 0;
    let distance = 0;
    for (let d = 1; d <= Math.min(i, 2047); d++) {
      let n = 0;
      while (n < 10 && i + n < input.length && input[i + n] === input[i - d + n]) n++;
      if (n > best) [best, distance] = [n, d];
    }
    const c = input[i] ?? 0;
    const next = input[i + 1] ?? 0;
    if (best >= 3) {
      const code = 0x8000 | (distance << 3) | (best - 3);
      out.push(code >> 8, code & 255);
      i += best;
    } else if (c === 0x20 && next >= 0x40 && next <= 0x7f) {
      out.push(next ^ 0x80);
      i += 2;
    } else if (single(c)) {
      out.push(c);
      i += 1;
    } else {
      const run: number[] = [];
      while (run.length < 8 && i < input.length && !single(input[i] ?? 0))
        run.push(input[i++] ?? 0);
      out.push(run.length, ...run);
    }
  }
  return new Uint8Array(out);
}

/** HUFF and CDIC records whose codes are one byte each: byte t stands for phrase 255 - t. */
export function huffcdic(phrases: Uint8Array[]): {
  huff: Uint8Array;
  cdic: Uint8Array;
  encode(indices: number[]): Uint8Array;
} {
  const huff = new DataView(new ArrayBuffer(24 + 1024 + 256));
  huff.setUint32(0, 0x48554646);
  huff.setUint32(4, 0x18);
  huff.setUint32(8, 24);
  huff.setUint32(12, 24 + 1024);
  for (let t = 0; t < 256; t++) huff.setUint32(24 + t * 4, (255 << 8) | 0x80 | 8);
  const offsets: number[] = [];
  const bodies: Uint8Array[] = [];
  let at = phrases.length * 2;
  for (const phrase of phrases) {
    offsets.push(at);
    const head = new Uint8Array([0x80 | (phrase.length >> 8), phrase.length & 255]);
    bodies.push(head, phrase);
    at += 2 + phrase.length;
  }
  const head = new DataView(new ArrayBuffer(16 + phrases.length * 2));
  head.setUint32(0, 0x43444943);
  head.setUint32(4, 0x10);
  head.setUint32(8, phrases.length);
  head.setUint32(12, 8);
  for (const [i, offset] of offsets.entries()) head.setUint16(16 + i * 2, offset);
  return {
    huff: new Uint8Array(huff.buffer),
    cdic: concat([new Uint8Array(head.buffer), ...bodies]),
    encode: (indices) => new Uint8Array(indices.map((j) => 255 - j)),
  };
}

/** A forward variable-width integer: seven bits a byte, the last byte's high bit set. */
export function vwi(value: number): number[] {
  const bytes = [value & 0x7f];
  for (let v = value >>> 7; v > 0; v >>>= 7) bytes.unshift(v & 0x7f);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) | 0x80;
  return bytes;
}

export interface Tag {
  tag: number;
  values: number;
  mask: number;
}

const INDX_HEADER = 0xc0;

function indxHeader(fields: { start: number; count: number; total?: number; cncx?: number }) {
  const view = new DataView(new ArrayBuffer(INDX_HEADER));
  view.setUint32(0, 0x494e4458);
  view.setUint32(4, INDX_HEADER);
  view.setUint32(20, fields.start);
  view.setUint32(24, fields.count);
  view.setUint32(28, 65001);
  view.setUint32(36, fields.total ?? 0);
  view.setUint32(52, fields.cncx ?? 0);
  return new Uint8Array(view.buffer);
}

/**
 * An index: its header record (with TAGX), one record of entries, and a CNCX record for strings.
 * Each entry's tags give values per tag; a tag's control bits say one value set follows.
 */
export function indx(
  tags: Tag[],
  entries: Array<{ name: string; tags: Record<number, number[]> }>,
  cncx?: Uint8Array,
): Uint8Array[] {
  const tagx = new DataView(new ArrayBuffer(12 + (tags.length + 1) * 4));
  tagx.setUint32(0, 0x54414758);
  tagx.setUint32(4, 12 + (tags.length + 1) * 4);
  tagx.setUint32(8, 1);
  tags.forEach((t, i) => {
    tagx.setUint8(12 + i * 4, t.tag);
    tagx.setUint8(13 + i * 4, t.values);
    tagx.setUint8(14 + i * 4, t.mask);
  });
  tagx.setUint8(12 + tags.length * 4 + 3, 1);
  const main = concat([
    indxHeader({ start: 0, count: 1, total: entries.length, cncx: cncx ? 1 : 0 }),
    new Uint8Array(tagx.buffer),
  ]);
  const bodies: number[][] = entries.map((entry) => {
    const name = [...new TextEncoder().encode(entry.name)];
    let control = 0;
    const values: number[] = [];
    for (const t of tags) {
      const given = entry.tags[t.tag];
      if (!given) continue;
      let shift = 0;
      while (((t.mask >> shift) & 1) === 0) shift++;
      control |= (given.length / t.values) << shift;
      for (const v of given) values.push(...vwi(v));
    }
    return [name.length, ...name, control, ...values];
  });
  const positions: number[] = [];
  let at = INDX_HEADER;
  for (const body of bodies) {
    positions.push(at);
    at += body.length;
  }
  const idxt = [0x49, 0x44, 0x58, 0x54, ...positions.flatMap((p) => [p >> 8, p & 255])];
  const record = concat([
    indxHeader({ start: at, count: entries.length }),
    new Uint8Array(bodies.flat()),
    new Uint8Array(idxt),
  ]);
  return cncx ? [main, record, cncx] : [main, record];
}

/** CNCX strings, and the offset of each. */
export function cncx(strings: string[]): { record: Uint8Array; offsets: number[] } {
  const bytes: number[] = [];
  const offsets: number[] = [];
  for (const text of strings) {
    offsets.push(bytes.length);
    const encoded = [...new TextEncoder().encode(text)];
    bytes.push(...vwi(encoded.length), ...encoded);
  }
  return { record: new Uint8Array(bytes), offsets };
}

/** A PalmDB file of the given type and creator ("BOOK", "MOBI") holding the records. */
export function pdb(
  name: string,
  type: string,
  creator: string,
  records: Uint8Array[],
): Uint8Array {
  const header = new Uint8Array(78 + records.length * 8 + 2);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode(name.slice(0, 31)), 0);
  header.set(new TextEncoder().encode(type), 60);
  header.set(new TextEncoder().encode(creator), 64);
  view.setUint16(76, records.length);
  let offset = header.length;
  records.forEach((record, i) => {
    view.setUint32(78 + i * 8, offset);
    view.setUint32(78 + i * 8 + 4, i * 2);
    offset += record.length;
  });
  return concat([header, ...records]);
}
