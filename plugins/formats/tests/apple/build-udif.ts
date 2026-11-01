// Small UDIF images built in the tests, for what the hdiutil fixtures cannot show cheaply: a disk
// of hundreds of MiB, damaged chunks, and the image's own structures bent one at a time.
import { deflateSync } from "node:zlib";

const ZERO = 0x00000002;
const RAW = 0x00000001;
const ZLIB = 0x80000005;

const be32 = (b: Uint8Array, o: number, v: number) =>
  new DataView(b.buffer, b.byteOffset).setUint32(o, v);
const be64 = (b: Uint8Array, o: number, v: number) => {
  be32(b, o, Math.floor(v / 2 ** 32));
  be32(b, o + 4, v >>> 0);
};

export interface Built {
  image: Uint8Array;
  /** Where each chunk's bytes are in the image. */
  chunks: { type: number; sector: number; at: number; length: number }[];
}

/** A classic resource fork holding `tables` as 'blkx' resources, as images before the XML list kept them. */
function resourceFork(tables: Uint8Array[]) {
  const data = tables.map((t) => {
    const r = new Uint8Array(4 + t.length);
    be32(r, 0, t.length);
    r.set(t, 4);
    return r;
  });
  const dataLength = data.reduce((n, r) => n + r.length, 0);
  const map = new Uint8Array(30 + 8 + 12 * tables.length);
  map.set([0, 0x1c], 24); // the type list, right after the map's header
  map.set([0x62, 0x6c, 0x6b, 0x78], 30); // one type, 'blkx'
  map.set([0, tables.length - 1, 0, 10], 34);
  let offset = 0;
  data.forEach((r, i) => {
    const ref = 38 + 12 * i;
    map.set([0, i, 0xff, 0xff], ref);
    be32(map, ref + 4, offset);
    offset += r.length;
  });
  const fork = new Uint8Array(0x100 + dataLength + map.length);
  be32(fork, 0, 0x100);
  be32(fork, 4, 0x100 + dataLength);
  be32(fork, 8, dataLength);
  be32(fork, 12, map.length);
  let at = 0x100;
  for (const r of data) {
    fork.set(r, at);
    at += r.length;
  }
  fork.set(map, at);
  return fork;
}

/**
 * A UDIF image of `disk`: one block table, chunks of `sectors` sectors, zlib-compressed (or raw),
 * zero runs left out as "ignore" chunks; the table in the XML list, or with `fork` in a resource fork.
 */
export function buildUdif(
  disk: Uint8Array,
  { sectors = 2048, method = "zlib", fork = false } = {},
): Built {
  const parts: Uint8Array[] = [];
  const chunks: Built["chunks"] = [];
  let at = 0;
  for (let sector = 0; sector * 512 < disk.length; sector += sectors) {
    const bytes = disk.subarray(sector * 512, Math.min(disk.length, (sector + sectors) * 512));
    const zero = bytes.every((b) => b === 0);
    const packed = zero
      ? new Uint8Array(0)
      : method === "zlib"
        ? new Uint8Array(deflateSync(bytes))
        : bytes;
    chunks.push({
      type: zero ? ZERO : method === "zlib" ? ZLIB : RAW,
      sector,
      at,
      length: packed.length,
    });
    parts.push(packed);
    at += packed.length;
  }
  const mish = new Uint8Array(204 + 40 * (chunks.length + 1));
  mish.set([0x6d, 0x69, 0x73, 0x68]);
  be32(mish, 4, 1);
  be64(mish, 16, Math.ceil(disk.length / 512));
  be32(mish, 200, chunks.length + 1);
  chunks.forEach((c, i) => {
    const o = 204 + 40 * i;
    be32(mish, o, c.type);
    be64(mish, o + 8, c.sector);
    be64(mish, o + 16, Math.min(sectors, Math.ceil(disk.length / 512) - c.sector));
    be64(mish, o + 24, c.at);
    be64(mish, o + 32, c.length);
  });
  be32(mish, 204 + 40 * chunks.length, 0xffffffff);
  const xml = new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>resource-fork</key>\n\t<dict>\n\t\t<key>blkx</key>\n\t\t<array>\n\t\t\t<dict>\n\t\t\t\t<key>Attributes</key>\n\t\t\t\t<string>0x0050</string>\n\t\t\t\t<key>Data</key>\n\t\t\t\t<data>\n\t\t\t\t${Buffer.from(
      mish,
    )
      .toString("base64")
      .replace(
        /(.{68})/g,
        "$1\n\t\t\t\t",
      )}\n\t\t\t\t</data>\n\t\t\t\t<key>Name</key>\n\t\t\t\t<string>whole disk (Apple_HFS : 0)</string>\n\t\t\t</dict>\n\t\t</array>\n\t</dict>\n</dict>\n</plist>\n`,
  );
  const tables = fork ? resourceFork([mish]) : xml;
  const koly = new Uint8Array(512);
  koly.set([0x6b, 0x6f, 0x6c, 0x79]);
  be32(koly, 4, 4);
  be32(koly, 8, 512);
  be32(koly, 12, 1);
  be64(koly, 32, at);
  be32(koly, 56, 1);
  be32(koly, 60, 1);
  if (fork) {
    be64(koly, 40, at);
    be64(koly, 48, tables.length);
  } else {
    be64(koly, 216, at);
    be64(koly, 224, xml.length);
  }
  be32(koly, 488, 1);
  be64(koly, 492, Math.ceil(disk.length / 512));
  const image = new Uint8Array(at + tables.length + 512);
  let o = 0;
  for (const p of parts) {
    image.set(p, o);
    o += p.length;
  }
  image.set(tables, o);
  image.set(koly, o + tables.length);
  return { image, chunks };
}
