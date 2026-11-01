// Test-side helpers for the XPRESS and LZX encoders: length-limited Huffman code lengths from symbol
// counts, canonical codes in the order both formats assign them, greedy LZ77 matching and a writer
// of bits into 16-bit little-endian words, most significant bit first.

/** Huffman code lengths for `counts`, none longer than `limit`; at least two symbols get a code. */
export function codeLengths(counts: number[], limit: number): Uint8Array {
  let f = counts.slice();
  const used = f.filter((x) => x > 0).length;
  if (used === 0) return new Uint8Array(f.length);
  if (used === 1) f[f[0] ? 1 : 0] = 1;
  for (;;) {
    const lens = plain(f);
    if (Math.max(...lens) <= limit) return lens;
    f = f.map((x) => (x > 0 ? Math.max(1, x >> 1) : 0));
  }
}

function plain(f: number[]): Uint8Array {
  type Node = { w: number; kids?: [Node, Node]; sym?: number };
  let nodes: Node[] = [];
  f.forEach((w, sym) => {
    if (w > 0) nodes.push({ w, sym });
  });
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.w - b.w);
    const [a, b] = nodes as [Node, Node];
    nodes = [{ w: a.w + b.w, kids: [a, b] }, ...nodes.slice(2)];
  }
  const lens = new Uint8Array(f.length);
  const walk = (n: Node, depth: number) => {
    if (n.kids) {
      walk(n.kids[0], depth + 1);
      walk(n.kids[1], depth + 1);
    } else lens[n.sym ?? 0] = Math.max(1, depth);
  };
  if (nodes[0]) walk(nodes[0], 0);
  return lens;
}

/** Canonical codes: by length, then by symbol. */
export function canonical(lens: Uint8Array): Uint32Array {
  const max = Math.max(0, ...lens);
  const count = new Uint32Array(max + 2);
  for (const n of lens) if (n) count[n] = (count[n] ?? 0) + 1;
  const next = new Uint32Array(max + 2);
  let code = 0;
  for (let n = 1; n <= max; n++) {
    code = (code + (count[n - 1] ?? 0)) << 1;
    next[n] = code;
  }
  const codes = new Uint32Array(lens.length);
  lens.forEach((n, s) => {
    if (n) {
      codes[s] = next[n] ?? 0;
      next[n] = (next[n] ?? 0) + 1;
    }
  });
  return codes;
}

export type Token = { lit: number } | { len: number; off: number };

/**
 * Greedy LZ77 over data[from, to), matches reaching back as far as `window` into data[0, ...).
 * `repeats` (LZX) offers the three last offsets first and keeps them as the decoder will.
 */
export function lz77(
  data: Uint8Array,
  from: number,
  to: number,
  opts: { min: number; max: number; window: number; repeats?: number[] },
): Token[] {
  const tokens: Token[] = [];
  const head = new Map<number, number[]>();
  const key = (i: number) =>
    ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
  const remember = (i: number) => {
    if (i + 3 > data.length) return;
    const k = key(i);
    const list = head.get(k) ?? [];
    list.push(i);
    if (list.length > 24) list.shift();
    head.set(k, list);
  };
  for (let i = Math.max(0, from - opts.window); i < from; i++) remember(i);
  const matchLength = (i: number, off: number) => {
    let n = 0;
    const cap = Math.min(opts.max, to - i);
    while (n < cap && data[i + n] === data[i - off + n]) n++;
    return n;
  };
  const r = opts.repeats;
  for (let i = from; i < to; ) {
    let best = 0;
    let off = 0;
    if (r) {
      for (const o of r)
        if (o <= i) {
          const n = matchLength(i, o);
          if (n >= 2 && n > best) {
            best = n;
            off = o;
          }
        }
    }
    if (i + 3 <= to) {
      for (const j of (head.get(key(i)) ?? []).slice().reverse()) {
        const o = i - j;
        if (o > opts.window) continue;
        const n = matchLength(i, o);
        if (n >= opts.min && n > best + 1) {
          best = n;
          off = o;
        }
      }
    }
    if (best >= (r?.includes(off) ? 2 : opts.min)) {
      tokens.push({ len: best, off });
      if (r) {
        const at = r.indexOf(off);
        if (at > 0) [r[0], r[at]] = [off, r[0] as number];
        else if (at < 0) r.splice(0, 3, off, r[0] as number, r[1] as number);
      }
      for (let k = 0; k < best; k++) remember(i + k);
      i += best;
    } else {
      tokens.push({ lit: data[i] as number });
      remember(i);
      i++;
    }
  }
  return tokens;
}

/** Bits into 16-bit little-endian words, most significant bit first (LZX). */
export class WordBits {
  out: number[] = [];
  acc = 0;
  n = 0;
  write(bits: number, count: number) {
    for (let i = count - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | (Math.floor(bits / 2 ** i) & 1);
      if (++this.n === 16) {
        this.out.push(this.acc & 0xff, (this.acc >>> 8) & 0xff);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  /** 1 to 16 zero bits, to the next word. */
  align() {
    this.write(0, 16 - this.n);
  }
  bytes(b: Uint8Array | number[]) {
    for (const v of b) this.out.push(v);
  }
  finish(): Uint8Array {
    if (this.n) this.write(0, 16 - this.n);
    return Uint8Array.from(this.out);
  }
}
