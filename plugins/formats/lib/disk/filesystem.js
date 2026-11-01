// Which file system a volume holds, told by its signatures, and opening the ones read here: FAT,
// exFAT, ext2/3/4 and NTFS. Others are named so a person knows what the volume is.
import { at, u16, u32 } from "./bytes.js";
import { openExfat } from "./exfat.js";
import { openExt } from "./ext.js";
import { openFat } from "./fat.js";
import { openNtfs } from "./ntfs.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").FileSystem} FileSystem */
/** @typedef {{ kind: "fat" | "exfat" | "ext" | "ntfs" | undefined, name: string }} Kind */

const OPEN = { fat: openFat, exfat: openExfat, ext: openExt, ntfs: openNtfs };

/** Whether a first sector is a FAT, exFAT or NTFS boot sector (so not an MBR). @param {Uint8Array} b */
export function bootSector(b) {
  if (at(b, 3, "NTFS    ") || at(b, 3, "EXFAT   ")) return true;
  return isFat(b);
}

/** @param {Uint8Array} b */
function isFat(b) {
  if (u16(b, 510) !== 0xaa55 && !(b[0] === 0xeb || b[0] === 0xe9)) return false;
  if (at(b, 54, "FAT1") || at(b, 54, "FAT ") || at(b, 82, "FAT32")) return true;
  const bytes = u16(b, 11);
  const cluster = b[13] ?? 0;
  return (
    (b[0] === 0xeb || b[0] === 0xe9) &&
    [512, 1024, 2048, 4096].includes(bytes) &&
    cluster > 0 &&
    (cluster & (cluster - 1)) === 0 &&
    u16(b, 14) > 0 &&
    (b[16] === 1 || b[16] === 2) &&
    (b[21] ?? 0) >= 0xf0
  );
}

/** What the volume holds, or undefined when nothing is recognised. @param {Source} volume @returns {Promise<Kind | undefined>} */
export async function identify(volume) {
  const b = await volume.read(0, 4096);
  if (at(b, 3, "NTFS    ")) return { kind: "ntfs", name: "NTFS" };
  if (at(b, 3, "EXFAT   ")) return { kind: "exfat", name: "exFAT" };
  if (isFat(b)) return { kind: "fat", name: "FAT" };
  if (u16(b, 1024 + 56) === 0xef53) return { kind: "ext", name: "ext" };
  /** @type {[boolean, string][]} */
  const others = [
    [at(b, 3, "-FVE-FS-"), "BitLocker-encrypted"],
    [at(b, 3, "ReFS"), "ReFS"],
    [at(b, 0, "XFSB"), "XFS"],
    [at(b, 0, "LUKS\xba\xbe"), "LUKS-encrypted"],
    [at(b, 512, "LABELONE"), "LVM physical volume"],
    [at(b, 0, "hsqs"), "SquashFS"],
    [at(b, 1024, "H+") || at(b, 1024, "HX"), "HFS+"],
    [at(b, 32, "NXSB"), "APFS"],
    [at(b, 4086, "SWAPSPACE2") || at(b, 4086, "SWAP-SPACE"), "Linux swap"],
    [u32(b, 1024) === 0xf2f52010, "F2FS"],
  ];
  for (const [match, name] of others) if (match) return { kind: undefined, name };
  if (volume.size > 65536 + 72 && at(await volume.read(65536 + 64, 8), 0, "_BHRfS_M"))
    return { kind: undefined, name: "Btrfs" };
  if (volume.size > 32774 && at(await volume.read(32769, 5), 0, "CD001"))
    return { kind: undefined, name: "ISO 9660" };
  return undefined;
}

/**
 * Open a volume `identify` found readable.
 * @param {Source} volume @param {Kind} kind @param {import("./work.js").Work} work
 * @returns {Promise<FileSystem>}
 */
export function mount(volume, kind, work) {
  if (!kind.kind) throw new Error(`${kind.name} volumes are not read here.`);
  return OPEN[kind.kind](volume, work);
}
