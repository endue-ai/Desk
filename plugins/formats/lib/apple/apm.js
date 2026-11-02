// The Apple Partition Map of older Macs and of many DMGs: a driver descriptor ("ER") in block 0
// with the block size, then one "PM" entry per block from block 1, each naming a partition, its
// type and where it lies. The map's own entry, free space and drivers are left out.
import { row } from "../disk/archive.js";
import { at, latin1, u16be, u32be } from "../disk/bytes.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/partitions.js").Partition} Partition */
/** @typedef {import("../disk/archive.js").Detail} Detail */
/** @typedef {{ table: string, details: Detail[], partitions: Partition[] }} Map */

const SKIP =
  /^(Apple_partition_map|Apple_Free|Apple_Void|Apple_Driver.*|Apple_Patches|Apple_Boot_RAID)$/i;

/** A NUL-padded name. @param {Uint8Array} b */
const name = (b) =>
  latin1(b)
    .replace(/\0[\s\S]*$/, "")
    .trim();

/**
 * The disk's Apple Partition Map, or undefined when it has none.
 * @param {Source} disk @param {import("../disk/work.js").Work} work @returns {Promise<Map | undefined>}
 */
export async function readApm(disk, work) {
  await work.tick();
  const head = await disk.read(0, 4096);
  const ddm = at(head, 0, "ER") ? u16be(head, 2) : 512;
  let block = [512, 1024, 2048, 4096].includes(ddm) ? ddm : 512;
  if (!at(head, block, "PM")) {
    if (!at(head, 512, "PM")) return undefined;
    block = 512;
  }
  const count = u32be(head, block + 4);
  if (!count || count > 256) return undefined;
  const map = await disk.read(block, count * block);
  /** @type {Partition[]} */
  const partitions = [];
  for (let i = 0; i < count; i++) {
    const e = map.subarray(i * block, i * block + block);
    if (!at(e, 0, "PM")) break;
    const type = name(e.subarray(48, 80));
    const start = u32be(e, 8) * block;
    const size = Math.min(u32be(e, 12) * block, Math.max(0, disk.size - start));
    if (SKIP.test(type) || !size || start >= disk.size) continue;
    partitions.push({
      number: i + 1,
      start,
      size,
      name: name(e.subarray(16, 48)),
      type,
      code: type,
    });
  }
  const details = [
    row("Partition table", "Apple Partition Map"),
    row("Partitions", partitions.length),
  ];
  return { table: "APM", details, partitions };
}
