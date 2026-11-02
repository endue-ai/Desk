// A WIM writer for the tests: images of folders, files (with alternate streams) and symbolic links,
// stored, XPRESS or LZX, in the layout the WIM documentation gives: header, resources, metadata,
// lookup table, XML. LZMS and solid resources are only flagged, for the refusals.
import { createHash } from "node:crypto";
import { type BlockKind, lzx, xpress } from "./ms-encoders";

export type Node =
  | { name: string; dir: Node[] }
  | { name: string; data: Uint8Array; ads?: { name: string; data: Uint8Array }[] }
  | { name: string; link: string; relative?: boolean };
export type Image = { name: string; description?: string; root: Node[] };
export type Options = {
  compression: "none" | "xpress" | "lzx" | "lzms";
  images: Image[];
  chunk?: number;
  parts?: number;
  solid?: boolean;
  lzxKinds?: BlockKind[];
  lzxBlockBytes?: number;
};

export const DATE = new Date("2026-10-01T12:00:00Z");
const FLAG = { none: 0, xpress: 0x20002, lzx: 0x40002, lzms: 0x80002 };
const align8 = (n: number) => Math.ceil(n / 8) * 8;
export const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest();
const utf16 = (s: string) => new Uint8Array(Buffer.from(s, "utf16le"));

class Out {
  bytes: number[] = [];
  get size() {
    return this.bytes.length;
  }
  put(b: Uint8Array | number[]) {
    const at = this.bytes.length;
    for (const v of b) this.bytes.push(v);
    return at;
  }
  u64(at: number, v: number) {
    for (let i = 0; i < 8; i++) this.bytes[at + i] = Math.floor(v / 2 ** (8 * i)) & 0xff;
  }
}

function view(n: number) {
  const b = new Uint8Array(n);
  return { b, d: new DataView(b.buffer) };
}

/** The reparse data of a symbolic link: the reparse buffer after its tag and length. */
export function symlinkData(target: string, relative: boolean) {
  const print = utf16(target.replace(/\//g, "\\"));
  const sub = relative ? print : utf16(`\\??\\${target.replace(/\//g, "\\")}`);
  const { b, d } = view(12 + sub.length + print.length);
  d.setUint16(0, 0, true);
  d.setUint16(2, sub.length, true);
  d.setUint16(4, sub.length, true);
  d.setUint16(6, print.length, true);
  d.setUint32(8, relative ? 1 : 0, true);
  b.set(sub, 12);
  b.set(print, 12 + sub.length);
  return b;
}

function dentry(
  name: string,
  attributes: number,
  hash: Uint8Array | undefined,
  tag: number,
  streams: { name: string; hash: Uint8Array }[] = [],
) {
  const n = utf16(name);
  const length = align8(0x66 + (n.length ? n.length + 2 : 0));
  const extra = streams.map((s) => {
    const sn = utf16(s.name);
    const { b, d } = view(align8(38 + (sn.length ? sn.length + 2 : 0)));
    d.setBigUint64(0, BigInt(b.length), true);
    b.set(s.hash, 16);
    d.setUint16(36, sn.length, true);
    b.set(sn, 38);
    return b;
  });
  const { b, d } = view(length + extra.reduce((t, e) => t + e.length, 0));
  d.setBigUint64(0, BigInt(length), true);
  d.setUint32(8, attributes, true);
  d.setInt32(12, -1, true);
  const time = BigInt(DATE.getTime() + 11644473600000) * 10000n;
  for (const o of [0x28, 0x30, 0x38]) d.setBigUint64(o, time, true);
  if (hash) b.set(hash, 0x40);
  if (tag) d.setUint32(0x58, tag, true);
  d.setUint16(0x60, streams.length, true);
  d.setUint16(0x64, n.length, true);
  b.set(n, 0x66);
  let at = length;
  for (const e of extra) {
    b.set(e, at);
    at += e.length;
  }
  return b;
}

/** An image's metadata resource; `blobs` collects the data every hash names. */
export function metadata(root: Node[], blobs: Map<string, Uint8Array>): Uint8Array {
  const out = new Out();
  const keep = (data: Uint8Array) => {
    if (!data.length) return undefined;
    const h = sha1(data);
    blobs.set(h.toString("hex"), data);
    return h;
  };
  out.put([8, 0, 0, 0, 0, 0, 0, 0]);
  const rootAt = out.put(dentry("", 0x10, undefined, 0));
  out.put(new Uint8Array(8));
  const list = (nodes: Node[]): number => {
    const start = out.size;
    const folders: [number, Node[]][] = [];
    for (const node of nodes) {
      if ("dir" in node) folders.push([out.put(dentry(node.name, 0x10, undefined, 0)), node.dir]);
      else if ("link" in node)
        out.put(
          dentry(node.name, 0x400, keep(symlinkData(node.link, node.relative ?? true)), 0xa000000c),
        );
      else if (node.ads) {
        const streams = [{ name: "", hash: keep(node.data) ?? new Uint8Array(20) }];
        for (const s of node.ads)
          streams.push({ name: s.name, hash: keep(s.data) ?? new Uint8Array(20) });
        out.put(dentry(node.name, 0x20, undefined, 0, streams));
      } else out.put(dentry(node.name, 0x20, keep(node.data), 0));
    }
    out.put(new Uint8Array(8));
    for (const [at, kids] of folders) out.u64(at + 16, list(kids));
    return start;
  };
  out.u64(rootAt + 16, list(root));
  return Uint8Array.from(out.bytes);
}

/** A resource header: 7 bytes of stored size, flags, offset, original size. */
function reshdr(size: number, flags: number, offset: number, original: number) {
  const { b, d } = view(24);
  d.setBigUint64(0, BigInt(size), true);
  b[7] = flags;
  d.setBigUint64(8, BigInt(offset), true);
  d.setBigUint64(16, BigInt(original), true);
  return b;
}

/** Build a WIM. Answers its bytes and every resource's decoded data by SHA-1. */
export function buildWim(o: Options) {
  const chunk = o.chunk ?? 32768;
  const out = new Out();
  out.put(new Uint8Array(208));
  const compress = (data: Uint8Array) => {
    if (o.compression === "xpress") return xpress(data);
    return lzx(data, {
      window: Math.max(32768, chunk),
      kinds: o.lzxKinds,
      blockBytes: o.lzxBlockBytes,
    });
  };
  /** Write a resource, answering its header. */
  const write = (data: Uint8Array, flags: number) => {
    const offset = out.size;
    if (o.compression === "none" || !data.length) {
      out.put(data);
      return reshdr(data.length, flags, offset, data.length);
    }
    if (o.compression === "lzms") {
      out.put(data);
      return reshdr(data.length, flags | 4, offset, data.length);
    }
    const chunks: Uint8Array[] = [];
    for (let at = 0; at < data.length; at += chunk) {
      const raw = data.subarray(at, at + chunk);
      const packed = compress(raw);
      chunks.push(packed.length < raw.length ? packed : raw);
    }
    const width = data.length > 0xffffffff ? 8 : 4;
    const table = view((chunks.length - 1) * width);
    let start = 0;
    chunks.forEach((c, i) => {
      if (i) table.d.setUint32((i - 1) * 4, start, true);
      start += c.length;
    });
    out.put(table.b);
    for (const c of chunks) out.put(c);
    return reshdr(out.size - offset, flags | 4, offset, data.length);
  };
  const blobs = new Map<string, Uint8Array>();
  const metas = o.images.map((image) => metadata(image.root, blobs));
  const entries: Uint8Array[] = [];
  const entry = (header: Uint8Array, hash: Uint8Array) => {
    const { b, d } = view(50);
    b.set(header);
    d.setUint16(24, 1, true);
    d.setUint32(26, 1, true);
    b.set(hash, 30);
    entries.push(b);
  };
  for (const meta of metas) entry(write(meta, 2), sha1(meta));
  for (const [hex, data] of blobs) {
    const header = write(data, 0);
    if (o.solid) header[7] = (header[7] ?? 0) | 0x10;
    entry(header, Buffer.from(hex, "hex"));
  }
  const lookupAt = out.put(entries.flatMap((e) => [...e]));
  const lookup = reshdr(entries.length * 50, 2, lookupAt, entries.length * 50);
  const images = o.images
    .map((im, i) => {
      const about = im.description ? `<DESCRIPTION>${im.description}</DESCRIPTION>` : "";
      return `<IMAGE INDEX="${i + 1}"><NAME>${im.name}</NAME>${about}</IMAGE>`;
    })
    .join("");
  const xml = utf16(
    `${String.fromCharCode(0xfeff)}<WIM><TOTALBYTES>${out.size}</TOTALBYTES>${images}</WIM>`,
  );
  const xmlAt = out.put(xml);
  const head = new Uint8Array(out.bytes.slice(0, 208));
  const d = new DataView(head.buffer);
  head.set(Buffer.from("MSWIM\0\0\0", "latin1"));
  d.setUint32(8, 208, true);
  d.setUint32(12, o.solid ? 0xe00 : 0x10d00, true);
  d.setUint32(16, FLAG[o.compression] | (o.parts && o.parts > 1 ? 8 : 0), true);
  d.setUint32(20, o.compression === "none" ? 0 : chunk, true);
  d.setUint16(40, 1, true);
  d.setUint16(42, o.parts ?? 1, true);
  d.setUint32(44, o.images.length, true);
  head.set(lookup, 48);
  head.set(reshdr(xml.length, 0, xmlAt, xml.length), 72);
  const bytes = Uint8Array.from(out.bytes);
  bytes.set(head);
  return { bytes, blobs, metas };
}
