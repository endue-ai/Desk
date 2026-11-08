// Partition tables: GPT (its header and entries checked by CRC-32, the backup header when the first
// one fails) and MBR with the logical partitions of its extended chain, numbered as Linux numbers
// them (primaries 1 to 4 by slot, logical ones from 5). A disk whose first sector is a file system's
// boot sector, or that has no table, answers undefined.

import { row } from "./archive.js";
import { at, crc32, guid, u16, u32, u64, utf16z } from "./bytes.js";
import { bootSector } from "./filesystem.js";
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */
/**
 * @typedef {{ number: number, start: number, size: number, name: string, type: string, code: string }} Partition
 * `start` and `size` in bytes; `type` the type's name, `code` its MBR byte ("0x83") or GPT GUID.
 * @typedef {{ table: "GPT" | "MBR", details: Detail[], partitions: Partition[] }} Table
 */

const MBR_TYPES = /** @type {Record<number, string>} */ ({
  1: "FAT12",
  4: "FAT16",
  6: "FAT16",
  7: "NTFS or exFAT",
  11: "FAT32",
  12: "FAT32 (LBA)",
  14: "FAT16 (LBA)",
  23: "Hidden NTFS",
  27: "Hidden FAT32",
  39: "Windows recovery",
  130: "Linux swap",
  131: "Linux",
  142: "Linux LVM",
  165: "FreeBSD",
  166: "OpenBSD",
  168: "Apple UFS",
  171: "Apple boot",
  175: "HFS+",
  191: "Solaris",
  222: "Dell utility",
  239: "EFI system",
  251: "VMware VMFS",
  253: "Linux RAID",
});
const EXTENDED = new Set([0x05, 0x0f, 0x85]);

const GPT_TYPES = /** @type {Record<string, string>} */ ({
  "C12A7328-F81F-11D2-BA4B-00A0C93EC93B": "EFI system",
  "21686148-6449-6E6F-744E-656564454649": "BIOS boot",
  "0FC63DAF-8483-4772-8E79-3D69D8477DE4": "Linux filesystem",
  "0657FD6D-A4AB-43C4-84E5-0933C84B4F4F": "Linux swap",
  "E6D6D379-F507-44C2-A23C-238F2A3DF928": "Linux LVM",
  "A19D880F-05FC-4D3B-A006-743F0F84911E": "Linux RAID",
  "4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709": "Linux root (x86-64)",
  "B921B045-1DF0-41C3-AF44-4C6F280D3FAE": "Linux root (ARM64)",
  "933AC7E1-2EB4-4F13-B844-0E14E2AEF915": "Linux home",
  "BC13C2FF-59E6-4262-A352-B275FD6F7172": "Linux extended boot",
  "CA7D7CCB-63ED-4C53-861C-1742536059CC": "Linux LUKS",
  "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7": "Microsoft basic data",
  "E3C9E316-0B5C-4DB8-817D-F92DF00215AE": "Microsoft reserved",
  "DE94BBA4-06D1-4D40-A16A-BFD50179D6AC": "Windows recovery",
  "5808C8AA-7E8F-42E0-85D2-E1E90434CFB3": "Windows LDM metadata",
  "AF9B60A0-1431-4F62-BC68-3311714A69AD": "Windows LDM data",
  "E75CAF8F-F680-4CEE-AFA3-B001E56EFC2D": "Windows storage spaces",
  "48465300-0000-11AA-AA11-00306543ECAC": "Apple HFS+",
  "7C3457EF-0000-11AA-AA11-00306543ECAC": "Apple APFS",
  "426F6F74-0000-11AA-AA11-00306543ECAC": "Apple boot",
  "516E7CB4-6ECF-11D6-8FF8-00022D09712B": "FreeBSD data",
  "516E7CBA-6ECF-11D6-8FF8-00022D09712B": "FreeBSD ZFS",
  "6A898CC3-1DD2-11B2-99A6-080020736631": "ZFS",
  "3B8F8425-20E0-4F3B-907F-1A25A76F98E8": "Linux server data",
});

/** A GPT header at `lba` when it holds together, with its entries. @param {Source} disk @param {number} lba @param {number} sector */
async function gptAt(disk, lba, sector) {
  if (lba <= 0 || (lba + 1) * sector > disk.size) return undefined;
  const head = await disk.read(lba * sector, sector);
  if (!at(head, 0, "EFI PART")) return undefined;
  const headerSize = u32(head, 12);
  if (headerSize < 92 || headerSize > sector) return undefined;
  const check = head.slice(0, headerSize);
  check.fill(0, 16, 20);
  if (crc32(check) !== u32(head, 16)) return undefined;
  const first = u64(head, 72);
  const count = u32(head, 80);
  const size = u32(head, 84);
  if (size < 128 || size % 8 || count > 16384 || first * sector + count * size > disk.size)
    return undefined;
  const table = await disk.read(first * sector, count * size);
  if (crc32(table) !== u32(head, 88)) return undefined;
  return { head, table, count, size };
}

/** @param {Source} disk @param {number} sector @returns {Promise<Table>} */
async function gpt(disk, sector) {
  const last = Math.floor(disk.size / sector) - 1;
  const found = (await gptAt(disk, 1, sector)) ?? (await gptAt(disk, last, sector));
  if (!found)
    throw damaged(
      "The GPT partition table is damaged: its header and backup fail their checksums.",
    );
  const { head, table, count, size } = found;
  /** @type {Partition[]} */
  const partitions = [];
  for (let i = 0; i < count; i++) {
    const e = table.subarray(i * size, i * size + size);
    const code = guid(e.subarray(0, 16));
    if (code === "00000000-0000-0000-0000-000000000000") continue;
    const start = u64(e, 32) * sector;
    const end = Math.min(disk.size, (u64(e, 40) + 1) * sector);
    if (start >= end) continue;
    const name = utf16z(e.subarray(56, 128));
    partitions.push({
      number: i + 1,
      start,
      size: end - start,
      name,
      type: GPT_TYPES[code] ?? code,
      code,
    });
  }
  const details = [row("Partition table", "GPT"), row("Disk GUID", guid(head.subarray(56, 72)))];
  return { table: "GPT", details, partitions };
}

/** @param {Uint8Array} b @param {number} i the slot */
const slot = (b, i) => {
  const o = 446 + i * 16;
  return { status: b[o] ?? 0, type: b[o + 4] ?? 0, start: u32(b, o + 8), sectors: u32(b, o + 12) };
};

/** @param {Source} disk @param {Uint8Array} head @returns {Promise<Table>} */
async function mbr(disk, head) {
  /** @type {Partition[]} */
  const partitions = [];
  const add = (
    /** @type {number} */ number,
    /** @type {number} */ type,
    /** @type {number} */ lba,
    /** @type {number} */ sectors,
  ) => {
    const start = lba * 512;
    if (start >= disk.size) return;
    const size = Math.min(sectors * 512, disk.size - start);
    const code = `0x${type.toString(16).padStart(2, "0")}`;
    partitions.push({ number, start, size, name: "", type: MBR_TYPES[type] ?? "Unknown", code });
  };
  /** @type {number[]} */
  const extended = [];
  for (let i = 0; i < 4; i++) {
    const { type, start, sectors } = slot(head, i);
    if (!type || !sectors) continue;
    if (EXTENDED.has(type)) extended.push(start);
    else add(i + 1, type, start, sectors);
  }
  let number = 5;
  for (const first of extended) {
    const seen = new Set();
    for (
      let ebr = first;
      ebr && !seen.has(ebr) && seen.size < 256 && (ebr + 1) * 512 <= disk.size;
    ) {
      seen.add(ebr);
      const b = await disk.read(ebr * 512, 512);
      if (u16(b, 510) !== 0xaa55) break;
      const logical = slot(b, 0);
      if (logical.type && logical.sectors)
        add(number++, logical.type, ebr + logical.start, logical.sectors);
      const next = slot(b, 1);
      ebr = next.start && EXTENDED.has(next.type) ? first + next.start : 0;
    }
  }
  const signature = u32(head, 440);
  const details = [row("Partition table", "MBR")];
  if (signature)
    details.push(row("Disk signature", signature.toString(16).toUpperCase().padStart(8, "0")));
  return { table: "MBR", details, partitions };
}

/**
 * The disk's partition table, or undefined when it has none (a bare file system, or nothing).
 * @param {Source} disk @param {import("./work.js").Work} work @returns {Promise<Table | undefined>}
 */
export async function readTable(disk, work) {
  await work.tick();
  const head = await disk.read(0, 4096 + 512);
  const protective = [0, 1, 2, 3].some((i) => slot(head, i).type === 0xee);
  for (const sector of [512, 4096])
    if (at(head, sector, "EFI PART")) return withCount(await gpt(disk, sector));
  if (protective && u16(head, 510) === 0xaa55) return withCount(await gpt(disk, 512));
  if (bootSector(head)) return undefined;
  if (u16(head, 510) !== 0xaa55) return undefined;
  const slots = [0, 1, 2, 3].map((i) => slot(head, i));
  const valid =
    slots.every((s) => (s.status & 0x7f) === 0) && slots.some((s) => s.type && s.sectors);
  return valid ? withCount(await mbr(disk, head)) : undefined;
}

/** @param {Table} table */
const withCount = (table) => {
  table.details.push(row("Partitions", table.partitions.length));
  return table;
};
