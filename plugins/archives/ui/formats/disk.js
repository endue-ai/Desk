// Raw disk images (.img): the partition table, MBR or GPT, with each partition's type, name and
// size. The file systems are not browsed.
import { at, formatSize, u16, u32, u64, utf16le } from "../bytes.js";
import { detailsOnly, row } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */

const NOTE = "Browsing the files inside a disk image is not available.";

const MBR_TYPES = /** @type {Record<number, string>} */ ({
  1: "FAT12",
  4: "FAT16",
  5: "Extended",
  6: "FAT16",
  7: "NTFS, exFAT or HPFS",
  11: "FAT32",
  12: "FAT32 (LBA)",
  14: "FAT16 (LBA)",
  15: "Extended (LBA)",
  39: "Windows recovery",
  130: "Linux swap",
  131: "Linux",
  133: "Linux extended",
  142: "Linux LVM",
  165: "FreeBSD",
  166: "OpenBSD",
  168: "Apple UFS",
  171: "Apple boot",
  175: "HFS+",
  238: "GPT protective",
  239: "EFI system",
  253: "Linux RAID",
});

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
  "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7": "Microsoft basic data",
  "E3C9E316-0B5C-4DB8-817D-F92DF00215AE": "Microsoft reserved",
  "DE94BBA4-06D1-4D40-A16A-BFD50179D6AC": "Windows recovery",
  "48465300-0000-11AA-AA11-00306543ECAC": "Apple HFS+",
  "7C3457EF-0000-11AA-AA11-00306543ECAC": "Apple APFS",
  "426F6F74-0000-11AA-AA11-00306543ECAC": "Apple boot",
  "55465300-0000-11AA-AA11-00306543ECAC": "Apple UFS",
  "516E7CB4-6ECF-11D6-8FF8-00022D09712B": "FreeBSD data",
  "83BD6B9D-7F41-11DC-BE0B-001560B84F0F": "FreeBSD boot",
  "516E7CBA-6ECF-11D6-8FF8-00022D09712B": "FreeBSD ZFS",
  "6A898CC3-1DD2-11B2-99A6-080020736631": "ZFS",
  "3B8F8425-20E0-4F3B-907F-1A25A76F98E8": "Linux server data",
});

/** A GUID as written in its mixed-endian bytes. @param {Uint8Array} b */
export function guid(b) {
  const h = (/** @type {number} */ i) => (b[i] ?? 0).toString(16).padStart(2, "0");
  const run = (/** @type {number[]} */ is) => is.map(h).join("");
  return [run([3, 2, 1, 0]), run([5, 4]), run([7, 6]), run([8, 9]), run([10, 11, 12, 13, 14, 15])]
    .join("-")
    .toUpperCase();
}

/** @param {Source} source @param {number} lba the GPT header's sector @param {number} sector */
async function gpt(source, lba, sector) {
  const head = await source.read(lba * sector, 92);
  const first = u64(head, 72);
  const count = Math.min(u32(head, 80), 1024);
  const size = u32(head, 84);
  const table = await source.read(first * sector, count * size);
  /** @type {Detail[]} */
  const parts = [];
  for (let i = 0; i < count; i++) {
    const e = table.subarray(i * size, i * size + size);
    if (e.length < 128 || e.every((c) => c === 0)) continue;
    const type = guid(e.subarray(0, 16));
    if (type === "00000000-0000-0000-0000-000000000000") continue;
    const name = utf16le(e.subarray(56, 128)).replace(/\0[\s\S]*$/, "");
    const bytes = (u64(e, 40) - u64(e, 32) + 1) * sector;
    const kind = GPT_TYPES[type] ?? type;
    parts.push(
      row(
        `Partition ${parts.length + 1}`,
        [name, kind, formatSize(bytes)].filter(Boolean).join(", "),
      ),
    );
  }
  return [
    row("Partition table", "GPT"),
    row("Disk GUID", guid(head.subarray(56, 72))),
    row("Partitions", parts.length),
    ...parts,
  ];
}

/** The four primary entries and the logical ones in an extended chain. @param {Source} source @param {Uint8Array} mbr */
async function mbr(source, mbr) {
  /** @type {Detail[]} */
  const parts = [];
  /** @param {Uint8Array} b @param {number} i @param {number} base */
  const add = (b, i, base) => {
    const o = 446 + i * 16;
    const type = b[o + 4] ?? 0;
    const start = base + u32(b, o + 8);
    const sectors = u32(b, o + 12);
    if (type === 0 || sectors === 0) return undefined;
    const name = MBR_TYPES[type] ?? "Unknown";
    const hex = `0x${type.toString(16).padStart(2, "0")}`;
    if (type === 0x05 || type === 0x0f || type === 0x85) return start;
    parts.push(
      row(`Partition ${parts.length + 1}`, `${name} (${hex}), ${formatSize(sectors * 512)}`),
    );
    return undefined;
  };
  /** @type {number[]} */
  const extended = [];
  for (let i = 0; i < 4; i++) {
    const start = add(mbr, i, 0);
    if (start !== undefined) extended.push(start);
  }
  for (const first of extended) {
    let ebr = first;
    for (let guard = 0; guard < 128 && ebr * 512 + 512 <= source.size; guard++) {
      const b = await source.read(ebr * 512, 512);
      if (u16(b, 510) !== 0xaa55) break;
      add(b, 0, ebr);
      const next = u32(b, 446 + 16 + 8);
      if (!next) break;
      ebr = first + next;
    }
  }
  return [row("Partition table", "MBR"), row("Partitions", parts.length), ...parts];
}

/** @param {Source} source @param {string} _name */
export async function openDisk(source, _name) {
  const head = await source.read(0, Math.min(source.size, 4096 + 512));
  for (const sector of [512, 4096])
    if (at(head, sector, "EFI PART"))
      return detailsOnly("Disk image", await gpt(source, 1, sector), NOTE);
  const valid = [0, 1, 2, 3].every((i) => ((head[446 + i * 16] ?? 0) & 0x7f) === 0);
  const any = [0, 1, 2, 3].some((i) => (head[446 + i * 16 + 4] ?? 0) !== 0);
  if (u16(head, 510) === 0xaa55 && valid && any)
    return detailsOnly("Disk image", await mbr(source, head), NOTE);
  /** @type {Detail[]} */
  const details = [row("Size", formatSize(source.size))];
  if (at(head, 3, "NTFS    ")) details.push(row("File system", "NTFS"));
  else if (at(head, 82, "FAT32   ") || at(head, 54, "FAT")) details.push(row("File system", "FAT"));
  else if (at(head, 3, "EXFAT   ")) details.push(row("File system", "exFAT"));
  const note =
    details.length > 1
      ? "The image holds one file system without a partition table; browsing it is not available."
      : "No MBR or GPT partition table was found in the image.";
  return detailsOnly("Disk image", details, note);
}
