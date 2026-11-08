// Encoders for the tests, written from the same documents as the decoders: XPRESS Huffman as
// [MS-XCA] 2.1 writes it, and LZX as WIM chunks hold it ([MS-PATCH] 2.1-2.7 with WIM's framing:
// no E8 header bit, a one-bit default block size, repeated offsets and trees fresh in every chunk).
import { canonical, codeLengths, lz77, type Token, WordBits } from "./huffman-codes";

const highBit = (n: number) => 31 - Math.clz32(n);

/** XPRESS Huffman, one table for all of `tokens` (a WIM chunk is at most 64 KiB). */
export function xpressTokens(tokens: Token[]): Uint8Array {
  const counts = new Array(512).fill(0);
  const symbolOf = (t: Token) =>
    "lit" in t ? t.lit : 256 + Math.min(t.len - 3, 15) + 16 * highBit(t.off);
  for (const t of tokens) counts[symbolOf(t)]++;
  counts[256]++;
  const lens = codeLengths(counts, 15);
  const codes = canonical(lens);
  const out = new Uint8Array(1024 + tokens.length * 12);
  for (let i = 0; i < 256; i++)
    out[i] = (lens[2 * i] as number) | ((lens[2 * i + 1] as number) << 4);
  let free = 16;
  let word = 0;
  let pos1 = 256;
  let pos2 = 258;
  let pos = 260;
  const bits = (n: number, v: number) => {
    if (free >= n) {
      free -= n;
      word = ((word << n) | v) >>> 0;
      return;
    }
    word = ((word << free) | (v >>> (n - free))) >>> 0;
    free -= n;
    out[pos1] = word & 0xff;
    out[pos1 + 1] = (word >>> 8) & 0xff;
    pos1 = pos2;
    pos2 = pos;
    pos += 2;
    free += 16;
    word = v;
  };
  const byte = (v: number) => {
    out[pos++] = v;
  };
  const u16 = (v: number) => {
    byte(v & 0xff);
    byte(v >>> 8);
  };
  for (const t of tokens) {
    const s = symbolOf(t);
    bits(lens[s] as number, codes[s] as number);
    if ("lit" in t) continue;
    let length = t.len - 3;
    if (length >= 15) {
      length -= 15;
      if (length < 255) byte(length);
      else {
        byte(255);
        length += 15;
        if (length < 65536) u16(length);
        else {
          u16(0);
          u16(length & 0xffff);
          u16(length >>> 16);
        }
      }
    }
    const hb = highBit(t.off);
    bits(hb, t.off - (1 << hb));
  }
  bits(lens[256] as number, codes[256] as number);
  word = (word << free) >>> 0;
  out[pos1] = word & 0xff;
  out[pos1 + 1] = (word >>> 8) & 0xff;
  out[pos2] = 0;
  out[pos2 + 1] = 0;
  return out.slice(0, pos);
}

/** XPRESS Huffman of `data` (at most 64 KiB), with greedy matches. */
export const xpress = (data: Uint8Array) =>
  xpressTokens(lz77(data, 0, data.length, { min: 3, max: 65535, window: 65535 }));

const E8_SIZE = 12000000;
const FOOTER = Array.from({ length: 51 }, (_, s) => (s < 4 ? 0 : Math.min(17, (s - 2) >> 1)));
const BASE = FOOTER.reduce<number[]>((b, _, s) => {
  b.push(s ? (b[s - 1] as number) + 2 ** (FOOTER[s - 1] as number) : 0);
  return b;
}, []);
const slotsFor = (window: number) => BASE.findIndex((b) => b >= window);

/** The E8 call translation a compressor applies before LZX ([MS-PATCH] 2.2.2). */
export function e8Translate(data: Uint8Array): Uint8Array {
  const b = data.slice();
  if (b.length <= 10) return b;
  for (let i = 0; i < b.length - 10; i++) {
    if (b[i] !== 0xe8) continue;
    const disp =
      (b[i + 1] as number) |
      ((b[i + 2] as number) << 8) |
      ((b[i + 3] as number) << 16) |
      ((b[i + 4] as number) << 24);
    let target = i + disp;
    if (target >= 0 && target < E8_SIZE + i) {
      if (target >= E8_SIZE) target = disp - E8_SIZE;
      b[i + 1] = target & 0xff;
      b[i + 2] = (target >>> 8) & 0xff;
      b[i + 3] = (target >>> 16) & 0xff;
      b[i + 4] = (target >>> 24) & 0xff;
    }
    i += 4;
  }
  return b;
}

export type BlockKind = "verbatim" | "aligned" | "uncompressed";

/** Path lengths through a pretree, as deltas from the previous lengths, then `prev` updated. */
function writeLengths(w: WordBits, prev: Uint8Array, next: Uint8Array, from: number, to: number) {
  const items: { code: number; extra?: [number, number]; second?: number }[] = [];
  for (let i = from; i < to; ) {
    let run = 1;
    while (i + run < to && next[i + run] === next[i]) run++;
    if (next[i] === 0 && run >= 20) {
      const n = Math.min(run, 51);
      items.push({ code: 18, extra: [n - 20, 5] });
      i += n;
    } else if (next[i] === 0 && run >= 4) {
      const n = Math.min(run, 19);
      items.push({ code: 17, extra: [n - 4, 4] });
      i += n;
    } else if (run >= 4) {
      const n = Math.min(run, 5);
      items.push({
        code: 19,
        extra: [n - 4, 1],
        second: ((prev[i] as number) - (next[i] as number) + 17) % 17,
      });
      i += n;
    } else {
      items.push({ code: ((prev[i] as number) - (next[i] as number) + 17) % 17 });
      i++;
    }
  }
  const counts = new Array(20).fill(0);
  for (const it of items) {
    counts[it.code]++;
    if (it.second !== undefined) counts[it.second]++;
  }
  const lens = codeLengths(counts, 15);
  const codes = canonical(lens);
  for (let i = 0; i < 20; i++) w.write(lens[i] as number, 4);
  for (const it of items) {
    w.write(codes[it.code] as number, lens[it.code] as number);
    if (it.extra) w.write(it.extra[0], it.extra[1]);
    if (it.second !== undefined) w.write(codes[it.second] as number, lens[it.second] as number);
  }
  prev.set(next.subarray(from, to), from);
}

/**
 * One WIM chunk of LZX. Blocks of `blockBytes` take their kinds from `kinds` in turn.
 */
export function lzx(
  data: Uint8Array,
  opts: { window?: number; kinds?: BlockKind[]; blockBytes?: number } = {},
): Uint8Array {
  const window = opts.window ?? 32768;
  const kinds = opts.kinds ?? ["verbatim"];
  const blockBytes = opts.blockBytes ?? window;
  const slots = slotsFor(window);
  const src = e8Translate(data);
  const w = new WordBits();
  const mainPrev = new Uint8Array(256 + 8 * slots);
  const lenPrev = new Uint8Array(249);
  const r = [1, 1, 1];
  for (let from = 0, b = 0; from < src.length; from += blockBytes, b++) {
    const to = Math.min(src.length, from + blockBytes);
    const kind = kinds[b % kinds.length] ?? "verbatim";
    const size = to - from;
    w.write({ verbatim: 1, aligned: 2, uncompressed: 3 }[kind], 3);
    if (size === 32768) w.write(1, 1);
    else {
      w.write(0, 1);
      if (window >= 65536) {
        w.write(size >>> 8, 16);
        w.write(size & 0xff, 8);
      } else w.write(size, 16);
    }
    if (kind === "uncompressed") {
      w.align();
      for (const v of r) w.bytes([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24]);
      w.bytes(src.subarray(from, to));
      if (size & 1) w.bytes([0]);
      continue;
    }
    const before = r.slice();
    const tokens = lz77(src, from, to, { min: 3, max: 257, window: window - 3, repeats: r });
    // Pass one: symbols and counts, keeping repeated offsets as the decoder will.
    const rr = before;
    const enc = tokens.map((t) => {
      if ("lit" in t) return { main: t.lit };
      let slot: number;
      let footer = 0;
      const at = rr.indexOf(t.off);
      if (at >= 0) {
        slot = at;
        if (at > 0) [rr[0], rr[at]] = [t.off, rr[0] as number];
      } else {
        const formatted = t.off + 2;
        slot = BASE.findIndex(
          (base, s) => s >= 3 && formatted < (BASE[s + 1] as number) && formatted >= base,
        );
        footer = formatted - (BASE[slot] as number);
        rr.splice(0, 3, t.off, rr[0] as number, rr[1] as number);
      }
      const header = t.len <= 8 ? t.len - 2 : 7;
      return {
        main: 256 + slot * 8 + header,
        length: header === 7 ? t.len - 9 : undefined,
        slot,
        footer,
      };
    });
    const mainCounts = new Array(mainPrev.length).fill(0);
    const lenCounts = new Array(249).fill(0);
    const alignedCounts = new Array(8).fill(0);
    const isAligned = kind === "aligned";
    for (const e of enc) {
      mainCounts[e.main]++;
      if (e.length !== undefined) lenCounts[e.length]++;
      if (isAligned && e.slot !== undefined && (FOOTER[e.slot] as number) >= 3)
        alignedCounts[e.footer & 7]++;
    }
    const mainLens = codeLengths(mainCounts, 16);
    const lenLens = lenCounts.some(Boolean) ? codeLengths(lenCounts, 16) : new Uint8Array(249);
    const alignedLens = codeLengths(alignedCounts, 7);
    if (isAligned) for (let i = 0; i < 8; i++) w.write(alignedLens[i] as number, 3);
    writeLengths(w, mainPrev, mainLens, 0, 256);
    writeLengths(w, mainPrev, mainLens, 256, mainLens.length);
    writeLengths(w, lenPrev, lenLens, 0, 249);
    const mainCodes = canonical(mainLens);
    const lenCodes = canonical(lenLens);
    const alignedCodes = canonical(alignedLens);
    for (const e of enc) {
      w.write(mainCodes[e.main] as number, mainLens[e.main] as number);
      if (e.length !== undefined)
        w.write(lenCodes[e.length] as number, lenLens[e.length] as number);
      if (e.slot === undefined || e.slot < 3) continue;
      const fb = FOOTER[e.slot] as number;
      if (isAligned && fb >= 3) {
        w.write(e.footer >>> 3, fb - 3);
        w.write(alignedCodes[e.footer & 7] as number, alignedLens[e.footer & 7] as number);
      } else w.write(e.footer, fb);
    }
  }
  return w.finish();
}
