// VMDK (VMware's Virtual Disk Format 1.1): a hosted sparse extent ("KDMV": a grain directory of
// grain tables of grain offsets, with its descriptor embedded) for monolithicSparse and
// streamOptimized disks (deflated grains behind markers, the grain directory in the footer), or a
// text descriptor whose one FLAT or SPARSE extent lives in a file beside it (opened through
// `options.open`). Split disks (several extent files) and child disks are refused.
import { row } from "./archive.js";
import { at, formatSize, latin1, sizeDetail, u16, u32, u64 } from "./bytes.js";
import { inflateZlib } from "./inflate.js";
import { lru } from "./lru.js";
import { extentSource, readExact } from "./source.js";
import { damaged, Refusal } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */
/** @typedef {{ access: string, sectors: number, type: string, file: string, offset: number }} Extent */
/**
 * @typedef {{ version: number, flags: number, capacity: number, grainSize: number,
 *   descriptorOffset: number, descriptorSize: number, perTable: number, rgdOffset: number,
 *   gdOffset: number, gdAtEnd: boolean, compression: number }} Header
 */

const FORMAT = "VMDK";
const COMPRESSED = 1 << 16;
const ZEROED_GTE = 1 << 2;
const DIFFERENCING =
  "This is a differencing disk: its files need its parent image, which is not read here.";

/** @param {Uint8Array} b @returns {Header} */
const headerOf = (b) => ({
  version: u32(b, 4),
  flags: u32(b, 8),
  capacity: u64(b, 12),
  grainSize: u64(b, 20),
  descriptorOffset: u64(b, 28),
  descriptorSize: u64(b, 36),
  perTable: u32(b, 44),
  rgdOffset: u64(b, 48),
  gdOffset: u64(b, 56),
  gdAtEnd: u32(b, 56) === 0xffffffff && u32(b, 60) === 0xffffffff,
  compression: u16(b, 77),
});

/** The descriptor's create type, parent and extents. @param {string} text */
function descriptorOf(text) {
  /** @type {Extent[]} */
  const extents = [];
  const line =
    /^[ \t]*(RW|RDONLY|NOACCESS)[ \t]+(\d+)[ \t]+(\w+)(?:[ \t]+"([^"]*)"(?:[ \t]+(\d+))?)?/gm;
  for (const m of text.matchAll(line))
    extents.push({
      access: m[1] ?? "",
      sectors: Number(m[2]),
      type: (m[3] ?? "").toUpperCase(),
      file: m[4] ?? "",
      offset: Number(m[5] ?? 0),
    });
  const parent = /^[ \t]*parentCID[ \t]*=[ \t]*([0-9a-f]+)/im.exec(text)?.[1]?.toLowerCase();
  return {
    type: /createType[ \t]*=[ \t]*"([^"]*)"/i.exec(text)?.[1] ?? "",
    version: /^[ \t]*version[ \t]*=[ \t]*(\d+)/m.exec(text)?.[1] ?? "",
    child: !!parent && parent !== "ffffffff",
    extents,
  };
}

/**
 * @param {Source} source
 * @param {import("./containers.js").ContainerOptions} [options]
 * @returns {Promise<import("./containers.js").Container>}
 */
export async function openVmdk(source, options = {}) {
  const head = await source.read(0, 512);
  if (at(head, 0, "COWD"))
    throw new Refusal("ESX sparse (COWD) VMDK extents are not read here.", FORMAT);
  if (at(head, 0, "KDMV")) return hosted(source, head);
  const text = latin1(await source.read(0, Math.min(source.size, 64 * 1024))).replace(
    /\0[\s\S]*$/,
    "",
  );
  const descriptor = descriptorOf(text);
  const size = descriptor.extents.reduce((n, e) => n + e.sectors * 512, 0);
  /** @type {Detail[]} */
  const details = [row("Virtual size", sizeDetail(size))];
  if (descriptor.type) details.push(row("Type", descriptor.type));
  if (descriptor.version) details.push(row("Version", descriptor.version));
  if (descriptor.child) throw new Refusal(DIFFERENCING, FORMAT, details);
  const files = descriptor.extents.filter((e) => e.file);
  if (files.length > 1)
    throw new Refusal(
      `This VMDK is split into ${files.length} extent files, which are not read here.`,
      FORMAT,
      details,
    );
  const unread = descriptor.extents.find(
    (e) => !["FLAT", "VMFS", "ZERO", "SPARSE"].includes(e.type),
  );
  if (unread)
    throw new Refusal(`VMDK extents of type ${unread.type} are not read here.`, FORMAT, details);
  const [extent] = files;
  if (!extent)
    return {
      format: FORMAT,
      details,
      disk: extentSource(source, size, async (o) => ({ length: size - o }), FORMAT),
    };
  const file = await options.open?.(extent.file);
  if (!file)
    throw new Refusal(
      `The disk's data is in its extent file “${extent.file}”, which was not opened.`,
      FORMAT,
      details,
    );
  if (extent.type === "SPARSE") {
    if (descriptor.extents.length > 1)
      throw new Refusal(
        "VMDK disks that mix sparse and other extents are not read here.",
        FORMAT,
        details,
      );
    const sparseHead = await file.read(0, 512);
    if (!at(sparseHead, 0, "KDMV"))
      throw damaged(`The VMDK extent “${extent.file}” is not a sparse extent.`);
    return { format: FORMAT, details, disk: await sparse(file, headerOf(sparseHead)) };
  }
  return { format: FORMAT, details, disk: flat(file, descriptor.extents, size) };
}

/** A disk of FLAT extents in one file, with ZERO extents between. @param {Source} file @param {Extent[]} extents @param {number} size */
function flat(file, extents, size) {
  const starts = [];
  let start = 0;
  for (const extent of extents) {
    starts.push(start);
    start += extent.sectors * 512;
  }
  return extentSource(
    file,
    size,
    async (offset) => {
      let i = extents.length - 1;
      while (i > 0 && (starts[i] ?? 0) > offset) i--;
      const extent = /** @type {Extent} */ (extents[i]);
      const from = starts[i] ?? 0;
      const length = from + extent.sectors * 512 - offset;
      return extent.file ? { at: extent.offset * 512 + offset - from, length } : { length };
    },
    FORMAT,
  );
}

/** A monolithicSparse or streamOptimized file: its embedded descriptor and its grains. @param {Source} source @param {Uint8Array} head */
async function hosted(source, head) {
  const header = headerOf(head);
  /** @type {Detail[]} */
  const details = [row("Virtual size", sizeDetail(header.capacity * 512))];
  let descriptor = descriptorOf("");
  if (header.descriptorOffset && header.descriptorSize) {
    const length = Math.min(header.descriptorSize * 512, 64 * 1024);
    const text = latin1(await source.read(header.descriptorOffset * 512, length));
    descriptor = descriptorOf(text.replace(/\0[\s\S]*$/, ""));
  }
  if (descriptor.type) details.push(row("Type", descriptor.type));
  details.push(row("Version", header.version));
  if (header.flags & COMPRESSED)
    details.push(
      row("Compression", header.compression === 1 ? "Deflate" : `Method ${header.compression}`),
    );
  details.push(row("Grain size", formatSize(header.grainSize * 512)));
  // An extent of a split disk carries no descriptor of its own (or an empty one).
  if (!descriptor.extents.length)
    throw new Refusal(
      "This is one extent of a split VMDK, which is not read here.",
      FORMAT,
      details,
    );
  const files = descriptor.extents.filter((e) => e.file).length;
  if (files > 1)
    throw new Refusal(
      `This VMDK is split into ${files} extent files, which are not read here.`,
      FORMAT,
      details,
    );
  if (descriptor.child) throw new Refusal(DIFFERENCING, FORMAT, details);
  return { format: FORMAT, details, disk: await sparse(source, header) };
}

/**
 * The grains of a sparse extent: the grain directory read once, grain tables and inflated grains
 * cached.
 * @param {Source} source @param {Header} header
 */
async function sparse(source, header) {
  let { gdOffset } = header;
  const { capacity, grainSize, perTable, flags } = header;
  if (header.gdAtEnd) {
    // streamOptimized: the real grain directory offset is in the footer before the end marker.
    const footer = await source.read(source.size - 1024, 512);
    if (!at(footer, 0, "KDMV")) throw damaged("The VMDK footer is damaged.");
    const real = headerOf(footer);
    if (real.gdAtEnd) throw damaged("The VMDK footer is damaged.");
    gdOffset = real.gdOffset;
  }
  if (!gdOffset && flags & 2) gdOffset = header.rgdOffset;
  const valid =
    grainSize >= 1 && (grainSize & (grainSize - 1)) === 0 && perTable >= 1 && perTable <= 65536;
  if (!valid || !gdOffset)
    throw damaged("The VMDK header is damaged: its grain size or grain directory is not possible.");
  if (header.compression > 1)
    throw new Refusal(
      `VMDK grains compressed by method ${header.compression} are not read here.`,
      FORMAT,
    );
  const size = capacity * 512;
  const grainBytes = grainSize * 512;
  const tableBytes = perTable * grainBytes;
  const directory = await readExact(
    source,
    gdOffset * 512,
    Math.ceil(size / tableBytes) * 4,
    "The VMDK grain directory",
  );
  const table = lru(32, (/** @type {number} */ sector) =>
    readExact(source, sector * 512, perTable * 4, "A VMDK grain table"),
  );
  const grain = lru(16, async (/** @type {number} */ sector) => {
    const marker = await readExact(source, sector * 512, 12, "A VMDK grain");
    const packed = await readExact(source, sector * 512 + 12, u32(marker, 8), "A VMDK grain");
    try {
      return inflateZlib(packed, grainBytes);
    } catch {
      throw damaged("A VMDK grain's compressed data is damaged.");
    }
  });
  return extentSource(
    source,
    size,
    async (offset) => {
      const index = Math.floor(offset / grainBytes);
      const within = offset - index * grainBytes;
      const rest = Math.min(grainBytes - within, size - offset);
      const gtSector = u32(directory, Math.floor(index / perTable) * 4);
      if (!gtSector) return { length: rest };
      const sector = u32(await table(gtSector), (index % perTable) * 4);
      if (sector === 0 || (sector === 1 && flags & ZEROED_GTE)) return { length: rest };
      if (!(flags & COMPRESSED)) return { at: sector * 512 + within, length: rest };
      const bytes = await grain(sector);
      if (bytes.length <= within) return { length: rest };
      return { bytes: bytes.subarray(within), length: Math.min(rest, bytes.length - within) };
    },
    FORMAT,
  );
}
