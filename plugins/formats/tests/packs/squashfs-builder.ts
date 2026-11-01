// A SquashFS 4.0 writer for the tests, from the format: data blocks and fragments first, then the
// inode table (children before their folder), the directory table, and the fragment, export and id
// tables, each a run of metadata blocks; basic or extended inodes, hard links, devices, sparse files.
import { COMPRESSORS, type Compressor } from "./pack-encoders";

export type Meta = { mtime?: number; mode?: number; uid?: number; gid?: number };
export type SqFile = Meta & { kind: "file"; name: string; data: Uint8Array };
export type SqNode =
  | (Meta & { kind: "dir"; name: string; children: SqNode[]; loop?: boolean })
  | SqFile
  | (Meta & { kind: "symlink"; name: string; target: string })
  | (Meta & { kind: "char" | "block"; name: string; device: number })
  | (Meta & { kind: "fifo" | "socket"; name: string })
  | { kind: "hardlink"; name: string; to: SqFile };
export type SqDir = Extract<SqNode, { kind: "dir" }>;
export interface SqOptions {
  compressor: Compressor;
  blockSize?: number;
  fragments?: boolean;
  extended?: boolean;
  exportTable?: boolean;
  options?: boolean;
  /** Keep a compressed block even when it is not smaller (xz streams of stored chunks are not). */
  keepLarger?: boolean;
  sparse?: boolean;
  mtime?: number;
}

const BASIC = { dir: 1, file: 2, symlink: 3, block: 4, char: 5, fifo: 6, socket: 7 } as const;
const NONE = 0xffffffff;
const le = (n: number, bytes: number) =>
  Array.from({ length: bytes }, (_, i) => Math.floor(n / 2 ** (8 * i)) & 255);

/** Bytes that grow as they are pushed. */
export class Grow {
  buf = new Uint8Array(1 << 16);
  length = 0;
  push(bytes: ArrayLike<number>) {
    while (this.length + bytes.length > this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf.subarray(0, this.length));
      this.buf = next;
    }
    this.buf.set(bytes, this.length);
    this.length += bytes.length;
  }
  bytes() {
    return this.buf.subarray(0, this.length);
  }
}

/** Metadata blocks of 8 KiB, compressed when that is smaller; positions as (block, offset). */
class MetaWriter {
  blocks = new Grow();
  pending: number[] = [];
  constructor(
    private pack: (b: Uint8Array) => Uint8Array,
    private keep: boolean,
  ) {}
  get ref() {
    return this.blocks.length * 65536 + this.pending.length;
  }
  write(bytes: ArrayLike<number>) {
    for (let i = 0; i < bytes.length; i++) {
      this.pending.push(bytes[i] ?? 0);
      if (this.pending.length === 8192) this.flush();
    }
  }
  flush() {
    if (!this.pending.length) return;
    const raw = Uint8Array.from(this.pending);
    this.pending = [];
    const packed = this.pack(raw);
    const small = this.keep || packed.length < raw.length;
    const body = small ? packed : raw;
    this.blocks.push(le(body.length | (small ? 0 : 0x8000), 2));
    this.blocks.push(body);
  }
  bytes() {
    this.flush();
    return this.blocks.bytes();
  }
}

export function buildSquashfs(root: SqDir, o: SqOptions): Uint8Array {
  const { id, encode } = COMPRESSORS[o.compressor];
  const blockSize = o.blockSize ?? 4096;
  const keep = o.keepLarger ?? o.compressor === "xz";
  const fragmentsOn = o.fragments ?? true;
  const mtime = o.mtime ?? 1790856000;
  const out = new Grow();
  out.push(new Uint8Array(96));
  if (o.options) {
    const opts: Record<Compressor, number[]> = {
      gzip: [...le(9, 4), ...le(15, 2), 0, 0],
      xz: [...le(blockSize, 4), ...le(1, 4)],
      lz4: [...le(1, 4), ...le(1, 4)],
      zstd: le(15, 4),
      lzo: [...le(4, 4), ...le(8, 4)],
    };
    out.push([...le(opts[o.compressor].length | 0x8000, 2), ...opts[o.compressor]]);
  }
  // Numbers: every node once (a hard link shares its file's), the root first.
  const numbers = new Map<SqNode, number>();
  const links = new Map<SqNode, number>();
  const number = (node: SqNode) => {
    const real = node.kind === "hardlink" ? node.to : node;
    links.set(real, (links.get(real) ?? 0) + 1);
    if (!numbers.has(real)) numbers.set(real, numbers.size + 1);
    if (real.kind === "dir") for (const child of real.children) number(child);
  };
  number(root);
  const ids: number[] = [];
  const idOf = (v: number) => (ids.includes(v) ? ids.indexOf(v) : ids.push(v) - 1);

  // Data: whole blocks in place, tails gathered into fragment blocks.
  const fragments: { start: number; word: number }[] = [];
  let fragment = new Grow();
  const store = (raw: Uint8Array) => {
    const packed = encode(raw);
    const small = keep || packed.length < raw.length;
    const start = out.length;
    out.push(small ? packed : raw);
    return { start, word: (small ? packed.length : raw.length) | (small ? 0 : 0x1000000) };
  };
  const flushFragment = () => {
    if (!fragment.length) return;
    fragments.push(store(fragment.bytes().slice()));
    fragment = new Grow();
  };
  const files = new Map<
    SqNode,
    { start: number; words: number[]; frag: number; offset: number; sparse: number }
  >();
  for (const node of numbers.keys()) {
    if (node.kind !== "file") continue;
    const { data } = node;
    const whole = fragmentsOn
      ? Math.floor(data.length / blockSize)
      : Math.ceil(data.length / blockSize);
    const words: number[] = [];
    let start = -1;
    let sparse = 0;
    for (let b = 0; b < whole; b++) {
      const raw = data.subarray(b * blockSize, Math.min(data.length, (b + 1) * blockSize));
      if (o.sparse && raw.every((x) => x === 0)) {
        words.push(0);
        sparse += raw.length;
        continue;
      }
      const stored = store(raw);
      if (start < 0) start = stored.start;
      words.push(stored.word);
    }
    if (start < 0) start = out.length;
    const tail = data.subarray(whole * blockSize);
    let frag = NONE;
    let offset = 0;
    if (tail.length) {
      if (fragment.length + tail.length > blockSize) flushFragment();
      frag = fragments.length;
      offset = fragment.length;
      fragment.push(tail);
    }
    files.set(node, { start, words, frag, offset, sparse });
  }
  flushFragment();

  // Inodes, children before their folder; each folder's listing goes to the directory table.
  const inodes = new MetaWriter(encode, keep);
  const dirs = new MetaWriter(encode, keep);
  const refs = new Map<SqNode, number>();
  const header = (node: SqNode & Meta, type: number) => [
    ...le(type, 2),
    ...le(node.mode ?? 0o755, 2),
    ...le(idOf(node.uid ?? 0), 2),
    ...le(idOf(node.gid ?? 0), 2),
    ...le(node.mtime ?? mtime, 4),
    ...le(numbers.get(node) ?? 0, 4),
  ];
  const ext = o.extended ?? false;
  const writeLeaf = (node: SqNode) => {
    if (node.kind === "hardlink" || node.kind === "dir" || refs.has(node)) return;
    refs.set(node, inodes.ref);
    const nlink = links.get(node) ?? 1;
    const x = ext ? 7 : 0;
    if (node.kind === "file") {
      const f = files.get(node);
      if (!f) throw new Error("no data for a file");
      const long = ext || nlink > 1 || f.sparse > 0;
      if (long)
        inodes.write([
          ...header(node, 9),
          ...le(f.start, 8),
          ...le(node.data.length, 8),
          ...le(f.sparse, 8),
          ...le(nlink, 4),
          ...le(f.frag, 4),
          ...le(f.offset, 4),
          ...le(NONE, 4),
        ]);
      else
        inodes.write([
          ...header(node, 2),
          ...le(f.start, 4),
          ...le(f.frag, 4),
          ...le(f.offset, 4),
          ...le(node.data.length, 4),
        ]);
      inodes.write(f.words.flatMap((w) => le(w, 4)));
    } else if (node.kind === "symlink") {
      const target = new TextEncoder().encode(node.target);
      inodes.write([
        ...header(node, BASIC.symlink + x),
        ...le(nlink, 4),
        ...le(target.length, 4),
        ...target,
      ]);
      if (ext) inodes.write(le(NONE, 4));
    } else if (node.kind === "char" || node.kind === "block") {
      inodes.write([...header(node, BASIC[node.kind] + x), ...le(nlink, 4), ...le(node.device, 4)]);
      if (ext) inodes.write(le(NONE, 4));
    } else {
      inodes.write([...header(node, BASIC[node.kind] + x), ...le(nlink, 4)]);
      if (ext) inodes.write(le(NONE, 4));
    }
  };
  const writeDir = (dir: SqDir, parent: number) => {
    const sorted = [...dir.children].sort((a, b) =>
      Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)),
    );
    for (const child of sorted) {
      if (child.kind === "dir") writeDir(child, numbers.get(dir) ?? 0);
      else writeLeaf(child.kind === "hardlink" ? child.to : child);
    }
    const listing: number[] = [];
    let run: { start: number; base: number; at: number; count: number } | undefined;
    for (const child of sorted) {
      const real = child.kind === "hardlink" ? child.to : child;
      const ref = refs.get(real) ?? 0;
      const block = Math.floor(ref / 65536);
      const num = numbers.get(real) ?? 0;
      if (!run || run.count === 256 || run.start !== block || Math.abs(num - run.base) > 32767) {
        run = { start: block, base: num, at: listing.length, count: 0 };
        listing.push(...le(0, 4), ...le(block, 4), ...le(num, 4));
      }
      run.count++;
      listing.splice(run.at, 4, ...le(run.count - 1, 4));
      const name = new TextEncoder().encode(child.name);
      const type = real.kind === "dir" ? 1 : BASIC[real.kind as keyof typeof BASIC];
      listing.push(
        ...le(ref % 65536, 2),
        ...le((num - run.base) & 0xffff, 2),
        ...le(type, 2),
        ...le(name.length - 1, 2),
        ...name,
      );
    }
    if (dir.loop) {
      // A damaged listing for the tests: an entry that is this folder itself.
      const self = inodes.ref;
      const num = numbers.get(dir) ?? 0;
      listing.push(...le(0, 4), ...le(Math.floor(self / 65536), 4), ...le(num, 4));
      listing.push(
        ...le(self % 65536, 2),
        0,
        0,
        ...le(1, 2),
        ...le(3, 2),
        ...new TextEncoder().encode("loop"),
      );
    }
    const at = dirs.ref;
    dirs.write(listing);
    refs.set(dir, inodes.ref);
    const nlink = 2 + dir.children.filter((c) => c.kind === "dir").length;
    const size = listing.length + 3;
    const start = Math.floor(at / 65536);
    if (ext || size >= 65536)
      inodes.write([
        ...header(dir, 8),
        ...le(nlink, 4),
        ...le(size, 4),
        ...le(start, 4),
        ...le(parent, 4),
        0,
        0,
        ...le(at % 65536, 2),
        ...le(NONE, 4),
      ]);
    else
      inodes.write([
        ...header(dir, 1),
        ...le(start, 4),
        ...le(nlink, 4),
        ...le(size, 2),
        ...le(at % 65536, 2),
        ...le(parent, 4),
      ]);
  };
  writeDir(root, numbers.size + 1);
  const rootRef = refs.get(root) ?? 0;
  const inodeTable = out.length;
  out.push(inodes.bytes());
  const dirTable = out.length;
  out.push(dirs.bytes());
  /** A lookup table: its metadata blocks, then the list of where they start. */
  const table = (entries: number[][]) => {
    const meta = new MetaWriter(encode, keep);
    const starts: number[] = [];
    const base = out.length;
    for (const entry of entries) {
      if (meta.pending.length === 0) starts.push(base + meta.blocks.length);
      meta.write(entry);
    }
    out.push(meta.bytes());
    const at = out.length;
    for (const s of starts) out.push(le(s, 8));
    return at;
  };
  const fragmentTable = fragments.length
    ? table(fragments.map((f) => [...le(f.start, 8), ...le(f.word, 4), 0, 0, 0, 0]))
    : 2 ** 64 - 1;
  const byNumber = [...numbers.keys()].sort(
    (a, b) => (numbers.get(a) ?? 0) - (numbers.get(b) ?? 0),
  );
  const exportTable =
    o.exportTable === false ? 2 ** 64 - 1 : table(byNumber.map((n) => le(refs.get(n) ?? 0, 8)));
  const idTable = table(ids.map((v) => le(v, 4)));
  const used = out.length;
  const flags =
    0x200 |
    (o.exportTable === false ? 0 : 0x80) |
    (o.options ? 0x400 : 0) |
    (fragmentsOn ? 0 : 0x10);
  const sb = [
    ...[0x68, 0x73, 0x71, 0x73],
    ...le(numbers.size, 4),
    ...le(mtime, 4),
    ...le(blockSize, 4),
    ...le(fragments.length, 4),
    ...le(id, 2),
    ...le(Math.log2(blockSize), 2),
    ...le(flags, 2),
    ...le(ids.length, 2),
    ...le(4, 2),
    ...le(0, 2),
    ...le(rootRef, 8),
    ...le(used, 8),
    ...le(idTable, 8),
    ...[255, 255, 255, 255, 255, 255, 255, 255],
    ...le(inodeTable, 8),
    ...le(dirTable, 8),
    ...(fragments.length ? le(fragmentTable, 8) : new Array(8).fill(255)),
    ...(o.exportTable === false ? new Array(8).fill(255) : le(exportTable, 8)),
  ];
  const image = new Uint8Array(Math.ceil(used / 4096) * 4096);
  image.set(out.bytes());
  image.set(sb, 0);
  return image;
}
