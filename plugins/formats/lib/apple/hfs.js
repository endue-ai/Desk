// HFS+ and HFSX volumes, read only, after Apple's Technical Note TN1150: the volume header at
// 1024, the catalog B-tree (folders, files and their threads by parent and name), the extents-
// overflow file for fragmented forks, and the attributes file for files kept compressed (decmpfs).
// Hard links resolve to the "iNode" files of the private folder, symlinks to the path in their
// data fork. The journal is not replayed: a volume that was not unmounted cleanly reads as it was.
import { row } from "../disk/archive.js";
import { at, u16be, u32be } from "../disk/bytes.js";
import { sliceSource } from "../disk/source.js";
import { damaged, Refusal } from "../disk/work.js";
import { openTree } from "./hfs-btree.js";
import { list, readFile } from "./hfs-catalog.js";
import { forkData, forkSource, overflow } from "./hfs-fork.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/** @typedef {import("../disk/archive.js").FileSystem} FileSystem */
/** @typedef {import("./hfs-fork.js").Fork} Fork */

/** HFS+ dates count seconds from 1904. @param {number} seconds */
export const hfsDate = (seconds) => (seconds ? new Date((seconds - 2082844800) * 1000) : undefined);

/**
 * Where the HFS+ volume starts in `volume`: 0, or past an HFS wrapper; undefined when it is not
 * HFS+. Plain HFS (Mac OS Standard) is refused with a sentence.
 * @param {Source} volume @param {Uint8Array} head its first 4 KiB
 */
export async function hfsOffset(volume, head) {
  if (at(head, 1024, "H+") || at(head, 1024, "HX")) return 0;
  if (!at(head, 1024, "BD")) return undefined;
  if (!at(head, 1024 + 0x7c, "H+"))
    throw new Refusal("The volume is HFS (Mac OS Standard), which is not read here.", "HFS");
  const blockSize = u32be(head, 1024 + 0x14);
  const offset = u16be(head, 1024 + 0x1c) * 512 + u16be(head, 1024 + 0x7e) * blockSize;
  if (offset + 1536 > volume.size)
    throw damaged("The HFS wrapper is damaged: its HFS+ volume lies past its end.");
  return offset;
}

/**
 * Open an HFS+ or HFSX volume.
 * @param {Source} volume @param {Work} work @returns {Promise<FileSystem>}
 */
export async function openHfsVolume(volume, work) {
  await work.tick();
  const vh = await volume.read(1024, 512);
  const hfsx = at(vh, 0, "HX");
  if (!hfsx && !at(vh, 0, "H+")) throw new Error("No HFS+ volume header was found.");
  const blockSize = u32be(vh, 40);
  if (blockSize < 512 || blockSize & (blockSize - 1) || blockSize > 1 << 24)
    throw damaged("The HFS+ volume is damaged: its block size is not a power of two.");
  const totalBlocks = u32be(vh, 44);
  const size = totalBlocks * blockSize;
  const disk = size && size < volume.size ? sliceSource(volume, 0, size) : volume;
  const attributes = u32be(vh, 4);
  const extentsFile = forkData(vh, 192);
  const catalogFork = forkData(vh, 272);
  const attributesFork = forkData(vh, 352);
  const more = overflow(disk, blockSize, extentsFile, work);
  /** A fork with all its extents, as a Source. @param {number} id @param {number} type @param {Fork} fork @param {string} what */
  const open = async (id, type, fork, what) =>
    forkSource(disk, blockSize, { size: fork.size, extents: await more(id, type, fork) }, what);
  const catalog = await openTree(await open(4, 0, catalogFork, "catalog file"), "catalog");
  const attrs = attributesFork.size
    ? openTree(await open(8, 0, attributesFork, "attributes file"), "attributes")
    : undefined;
  const ctx = { disk, blockSize, open, catalog, attrs, journaled: !!(attributes & 0x2000) };
  const label = await volumeName(ctx);
  const details = [];
  if (hfsx) details.push(row("Case-sensitive", "yes"));
  details.push(row("Journaled", ctx.journaled ? "yes" : "no"));
  details.push(row("Files", u32be(vh, 32).toLocaleString("en-US")));
  details.push(row("Folders", u32be(vh, 36).toLocaleString("en-US")));
  details.push(row("Block size", `${blockSize.toLocaleString("en-US")} bytes`));
  if (!(attributes & 0x100)) details.push(row("Unmounted cleanly", "no"));
  return {
    type: hfsx ? "HFSX" : "HFS+",
    label,
    size,
    used: (totalBlocks - u32be(vh, 48)) * blockSize,
    details,
    list: (w) => list(ctx, w),
    read: (ref, limit, w) =>
      readFile(ctx, /** @type {import("./hfs-catalog.js").Ref} */ (ref), limit, w),
  };
}

/** The volume's name: the root folder's, whose key has parent 1. @param {{ catalog: import("./hfs-btree.js").Tree }} ctx */
async function volumeName({ catalog }) {
  const node = await catalog.node(catalog.first);
  for (const record of node.records) {
    if (u32be(record, 2) !== 1) continue;
    const length = u16be(record, 6);
    let name = "";
    for (let i = 0; i < length; i++) name += String.fromCharCode(u16be(record, 8 + 2 * i));
    return name.normalize("NFC");
  }
  return "";
}
