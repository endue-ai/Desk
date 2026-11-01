// VHDX (Microsoft's VHDX Format Specification 1.0): "vhdxfile", two headers (the valid one with the
// higher sequence number is current, each checked by CRC-32C), a region table pointing to the block
// allocation table and the metadata (block size, virtual size, sector size). Payload blocks are
// interleaved in the BAT with one sector-bitmap entry after every chunk. A log that was never
// applied is reported and the image read as it is; differencing disks need their parent.
import { row } from "./archive.js";
import { at, big64, crc32c, formatSize, guid, sizeDetail, u16, u32, u64, utf16z } from "./bytes.js";
import { lru } from "./lru.js";
import { extentSource, readExact } from "./source.js";
import { damaged, Refusal } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */

const KIB = 1024;
const MIB = 1024 * 1024;
const BAT = "2DC27766-F623-4200-9D64-115E9BFD4A08";
const METADATA = "8B7CA206-4790-4B9A-B8FE-575F050F886E";
const FILE_PARAMETERS = "CAA16737-FA36-4D43-B3B6-33F0AA44E76B";
const VIRTUAL_SIZE = "2FA54224-CD1B-4876-B211-5DBED83BF4B8";
const PAGE_83 = "BECA12AB-B2E6-4523-93EF-C309E000C746";
const LOGICAL_SECTOR = "8141BF1D-A96F-4709-BA47-F233A8FAAB5F";
const PHYSICAL_SECTOR = "CDA348C7-445D-4471-9CC9-E9885251C556";
const PARENT_LOCATOR = "A8D35F2D-B30B-454D-ABF7-D3D84834AB0C";
const KNOWN = new Set([
  FILE_PARAMETERS,
  VIRTUAL_SIZE,
  PAGE_83,
  LOGICAL_SECTOR,
  PHYSICAL_SECTOR,
  PARENT_LOCATOR,
]);
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

// Payload block states (the low three bits of a BAT entry).
const FULLY_PRESENT = 6;
const PARTIALLY_PRESENT = 7;

/** Whether a structure's CRC-32C (in its bytes 4 to 8) holds. @param {Uint8Array} b */
function checksumHolds(b) {
  const copy = b.slice();
  copy.fill(0, 4, 8);
  return crc32c(copy) === u32(b, 4);
}

/** The current header. @param {Source} source */
async function headerOf(source) {
  const valid = [];
  for (const offset of [64 * KIB, 128 * KIB]) {
    const head = await source.read(offset, 4 * KIB);
    if (head.length === 4 * KIB && at(head, 0, "head") && checksumHolds(head)) valid.push(head);
  }
  const header = valid.sort((a, b) => u64(b, 8) - u64(a, 8))[0];
  if (!header) throw damaged("The VHDX headers are damaged: neither passes its checksum.");
  return header;
}

/** The region table's BAT and metadata regions. @param {Source} source */
async function regionsOf(source) {
  for (const offset of [192 * KIB, 256 * KIB]) {
    const table = await source.read(offset, 64 * KIB);
    if (table.length < 64 * KIB || !at(table, 0, "regi") || !checksumHolds(table)) continue;
    /** @type {Map<string, { offset: number, length: number }>} */
    const regions = new Map();
    for (let i = 0; i < Math.min(u32(table, 8), 2047); i++) {
      const e = table.subarray(16 + i * 32, 48 + i * 32);
      const id = guid(e.subarray(0, 16));
      if (id !== BAT && id !== METADATA && u32(e, 28) & 1)
        throw new Refusal("The VHDX needs a region that is not read here.", "VHDX");
      regions.set(id, { offset: u64(e, 16), length: u32(e, 24) });
    }
    return regions;
  }
  throw damaged("The VHDX region table is damaged: neither copy passes its checksum.");
}

/** The metadata items by GUID, their values read. @param {Source} source @param {{ offset: number, length: number }} region */
async function metadataOf(source, region) {
  const table = await readExact(source, region.offset, 64 * KIB, "The VHDX metadata table");
  if (!at(table, 0, "metadata")) throw damaged("The VHDX metadata table is damaged.");
  /** @type {Map<string, Uint8Array>} */
  const items = new Map();
  for (let i = 0; i < Math.min(u16(table, 10), 2047); i++) {
    const e = table.subarray(32 + i * 32, 64 + i * 32);
    const id = guid(e.subarray(0, 16));
    if (!KNOWN.has(id) && u32(e, 24) & 4)
      throw new Refusal("The VHDX needs metadata that is not read here.", "VHDX");
    const length = Math.min(u32(e, 20), 64 * KIB);
    items.set(
      id,
      await readExact(source, region.offset + u32(e, 16), length, "A VHDX metadata item"),
    );
  }
  return items;
}

/**
 * @param {Source} source
 * @returns {Promise<import("./containers.js").Container>}
 */
export async function openVhdx(source) {
  const creator = utf16z(await source.read(8, 512));
  const header = await headerOf(source);
  const regions = await regionsOf(source);
  const batRegion = regions.get(BAT);
  const metaRegion = regions.get(METADATA);
  if (!batRegion || !metaRegion)
    throw damaged("The VHDX region table is damaged: a region is missing.");
  const items = await metadataOf(source, metaRegion);
  const parameters = items.get(FILE_PARAMETERS);
  const sizeItem = items.get(VIRTUAL_SIZE);
  if (!parameters || !sizeItem)
    throw damaged("The VHDX metadata is damaged: a required item is missing.");
  const blockSize = u32(parameters, 0);
  const flags = u32(parameters, 4);
  const size = u64(sizeItem, 0);
  const sector = items.has(LOGICAL_SECTOR)
    ? u32(/** @type {Uint8Array} */ (items.get(LOGICAL_SECTOR)), 0)
    : 512;
  if (
    blockSize < MIB ||
    blockSize > 256 * MIB ||
    blockSize & (blockSize - 1) ||
    (sector !== 512 && sector !== 4096)
  )
    throw damaged("The VHDX metadata is damaged: its block or sector size is not possible.");
  const type = flags & 2 ? "Differencing" : flags & 1 ? "Fixed" : "Dynamic";
  /** @type {Detail[]} */
  const details = [
    row("Virtual size", sizeDetail(size)),
    row("Type", type),
    row("Block size", formatSize(blockSize)),
    row("Sector size", `${sector} bytes`),
    row("Version", u16(header, 66)),
  ];
  if (creator) details.push(row("Created by", creator));
  if (guid(header.subarray(48, 64)) !== ZERO_GUID)
    details.push(
      row("Log", "The log holds changes that were never applied; the image is read as it is."),
    );
  if (flags & 2)
    throw new Refusal(
      "This is a differencing disk: its files need its parent image, which is not read here.",
      "VHDX",
      details,
    );
  const chunkRatio = (2 ** 23 * sector) / blockSize;
  const blocks = Math.ceil(size / blockSize);
  const entries = blocks + Math.max(0, Math.floor((blocks - 1) / chunkRatio));
  if (entries * 8 > batRegion.length)
    throw damaged("The VHDX block table is damaged: it is too short for the disk.");
  const bat = await readExact(source, batRegion.offset, entries * 8, "The VHDX block table");
  const chunkBytes = chunkRatio * blockSize;
  const bitmap = lru(4, (/** @type {number} */ chunk) => {
    const entry = big64(bat, (chunk * (chunkRatio + 1) + chunkRatio) * 8);
    if (Number(entry & 7n) !== FULLY_PRESENT) return Promise.resolve(new Uint8Array(MIB));
    return readExact(source, Number(entry >> 20n) * MIB, MIB, "A VHDX sector bitmap");
  });
  const disk = extentSource(
    source,
    size,
    async (offset) => {
      const block = Math.floor(offset / blockSize);
      const within = offset - block * blockSize;
      const rest = Math.min(blockSize - within, size - offset);
      const entry = big64(bat, (block + Math.floor(block / chunkRatio)) * 8);
      const state = Number(entry & 7n);
      const at = Number(entry >> 20n) * MIB + within;
      if (state === FULLY_PRESENT) return { at, length: rest };
      if (state !== PARTIALLY_PRESENT) return { length: rest };
      // The chunk's sector bitmap tells, sector by sector, which ones this file holds.
      const chunk = Math.floor(offset / chunkBytes);
      const bits = await bitmap(chunk);
      const first = Math.floor((offset - chunk * chunkBytes) / sector);
      const set = (/** @type {number} */ s) => ((bits[s >> 3] ?? 0) >> (s & 7)) & 1;
      const present = set(first);
      let count = 1;
      while (count * sector < rest && set(first + count) === present) count++;
      const length = Math.min(rest, count * sector - (offset % sector));
      return present ? { at, length } : { length };
    },
    "VHDX",
  );
  return { format: "VHDX", details, disk };
}
