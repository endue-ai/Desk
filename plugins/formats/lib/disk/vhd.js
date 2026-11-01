// VHD (Microsoft's Virtual Hard Disk Image Format Specification): a 512-byte footer at the end
// ("conectix", a 511-byte one in old images, a copy at the start of dynamic ones). A fixed disk is
// its data then the footer; a dynamic disk has a header ("cxsparse") pointing to a block allocation
// table, each block a sector bitmap then its data. Differencing disks need their parent.
import { row } from "./archive.js";
import { at, formatSize, latin1, sizeDetail, u16be, u32be, u64be } from "./bytes.js";
import { lru } from "./lru.js";
import { extentSource, readExact } from "./source.js";
import { damaged, Refusal } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */

const TYPES = /** @type {Record<number, string>} */ ({
  2: "Fixed",
  3: "Dynamic",
  4: "Differencing",
});
const UNUSED = 0xffffffff;
const SECONDS_TO_2000 = 946684800;

/** Whether the footer's checksum (one's complement of the byte sum) holds. @param {Uint8Array} f */
function checksumHolds(f) {
  let sum = 0;
  for (let i = 0; i < f.length; i++) if (i < 64 || i >= 68) sum += f[i] ?? 0;
  return ~sum >>> 0 === u32be(f, 64);
}

/** The footer: at the end, at the end of a 511-byte one, or its copy at the start. @param {Source} source */
async function footerOf(source) {
  /** @type {Uint8Array[]} */
  const candidates = [];
  candidates.push(await source.read(Math.max(0, source.size - 512), 512));
  candidates.push(await source.read(Math.max(0, source.size - 511), 511));
  candidates.push(await source.read(0, 512));
  const found = candidates.filter((f) => at(f, 0, "conectix"));
  if (!found.length) throw damaged("The VHD footer is missing.");
  const good = found.find(checksumHolds);
  if (!good) throw damaged("The VHD footer is damaged: its checksum does not match.");
  return good;
}

/** @param {Uint8Array} footer */
function detailsOf(footer) {
  const type = u32be(footer, 60);
  const creator = latin1(footer.subarray(28, 32)).replace(/\0/g, "").trim();
  const seconds = u32be(footer, 24);
  /** @type {Detail[]} */
  const details = [
    row("Virtual size", sizeDetail(u64be(footer, 48))),
    row("Type", TYPES[type] ?? `Type ${type}`),
    row("Version", `${u16be(footer, 12)}.${u16be(footer, 14)}`),
  ];
  if (creator) details.push(row("Created by", creator));
  if (seconds)
    details.push(
      row("Created", new Date((seconds + SECONDS_TO_2000) * 1000).toISOString().slice(0, 10)),
    );
  return details;
}

/**
 * @param {Source} source
 * @returns {Promise<import("./containers.js").Container>}
 */
export async function openVhd(source) {
  const footer = await footerOf(source);
  const size = u64be(footer, 48);
  const type = u32be(footer, 60);
  const details = detailsOf(footer);
  if (type === 4)
    throw new Refusal(
      "This is a differencing disk: its files need its parent image, which is not read here.",
      "VHD",
      details,
    );
  if (type === 2) {
    const data =
      source.size - (at(await source.read(source.size - 511, 8), 0, "conectix") ? 511 : 512);
    if (data < size) throw damaged("The VHD is cut short: its data goes past the end of the file.");
    const disk = extentSource(
      source,
      size,
      async (offset) => ({ at: offset, length: size - offset }),
      "VHD",
    );
    return { format: "VHD", details, disk };
  }
  if (type !== 3) throw new Refusal(`VHD disks of type ${type} are not read here.`, "VHD", details);
  return { format: "VHD", details, disk: await dynamic(source, footer, size, details) };
}

/**
 * The block allocation table and the blocks it points to.
 * @param {Source} source @param {Uint8Array} footer @param {number} size @param {Detail[]} details
 */
async function dynamic(source, footer, size, details) {
  const header = await readExact(source, u64be(footer, 16), 1024, "The VHD's dynamic header");
  if (!at(header, 0, "cxsparse")) throw damaged("The VHD's dynamic header is damaged.");
  const tableOffset = u64be(header, 16);
  const entries = u32be(header, 28);
  const blockSize = u32be(header, 32);
  if (!blockSize || blockSize % 512 || blockSize & (blockSize - 1) || entries * blockSize < size)
    throw damaged("The VHD's dynamic header is damaged: its block size does not fit the disk.");
  const table = await readExact(source, tableOffset, entries * 4, "The VHD's block table");
  details.push(row("Block size", formatSize(blockSize)));
  const sectorsPerBlock = blockSize / 512;
  const bitmapBytes = Math.ceil(sectorsPerBlock / 8 / 512) * 512;
  const bitmap = lru(64, (/** @type {number} */ sector) =>
    readExact(source, sector * 512, bitmapBytes, "A VHD block's sector bitmap"),
  );
  return extentSource(
    source,
    size,
    async (offset) => {
      const block = Math.floor(offset / blockSize);
      const within = offset - block * blockSize;
      const rest = Math.min(blockSize - within, size - offset);
      const sector = u32be(table, block * 4);
      if (sector === UNUSED) return { length: rest };
      // Sectors whose bit is clear were never written: they read as zeros.
      const bits = await bitmap(sector);
      const first = Math.floor(within / 512);
      const set = (/** @type {number} */ s) => ((bits[s >> 3] ?? 0) >> (7 - (s & 7))) & 1;
      const state = set(first);
      let last = first + 1;
      while (last < sectorsPerBlock && set(last) === state) last++;
      const length = Math.min(rest, last * 512 - within);
      return state ? { at: sector * 512 + bitmapBytes + within, length } : { length };
    },
    "VHD",
  );
}
