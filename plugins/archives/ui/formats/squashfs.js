// SquashFS, alone, as a Snap, or after an AppImage's ELF runtime: the superblock's compression,
// size, inode count, block size and creation time. The file system is not browsed.
import { at, formatSize, sizeDetail, u16, u32, u64 } from "../bytes.js";
import { detailsOnly, row } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */

const COMPRESSIONS = ["", "gzip", "LZMA", "LZO", "xz", "LZ4", "zstd"];

/** Where an ELF file ends: its section table, its last section, at least its header. @param {Source} source */
async function elfEnd(source) {
  const h = await source.read(0, 64);
  const wide = h[4] === 2;
  if (h[5] !== 1) return 0; // big-endian ELF: AppImages are little-endian
  const shoff = wide ? u64(h, 40) : u32(h, 32);
  const ehsize = u16(h, wide ? 52 : 40);
  const shentsize = u16(h, wide ? 58 : 46);
  const shnum = u16(h, wide ? 60 : 48);
  let end = Math.max(ehsize, shoff + shentsize * shnum);
  if (shnum > 0 && shnum < 4096 && shentsize >= (wide ? 64 : 40)) {
    const table = await source.read(shoff, shentsize * shnum);
    for (let i = 0; i < shnum; i++) {
      const s = table.subarray(i * shentsize, (i + 1) * shentsize);
      if (u32(s, 4) === 8) continue; // SHT_NOBITS takes no room in the file
      const offset = wide ? u64(s, 24) : u32(s, 16);
      const size = wide ? u64(s, 32) : u32(s, 20);
      end = Math.max(end, offset + size);
    }
  }
  return end;
}

/** The superblock's offset: right after the ELF, or found within its first 4 MiB. @param {Source} source */
async function superblockAt(source) {
  const end = await elfEnd(source);
  if (end && at(await source.read(end, 4), 0, "hsqs")) return end;
  const head = await source.read(0, Math.min(source.size, 4 * 1024 * 1024));
  for (
    let i = head.indexOf(0x68, 64);
    i >= 0 && i + 96 <= head.length;
    i = head.indexOf(0x68, i + 1)
  )
    if (at(head, i, "hsqs") && u16(head, i + 28) === 4) return i;
  throw new Error("The AppImage holds no SquashFS file system.");
}

/** @param {Source} source @param {string} _name @param {{ key: string, label: string }} [kind] */
export async function openSquashfs(source, _name, kind) {
  const format = kind?.label ?? "SquashFS";
  const offset = kind?.key === "appimage" ? await superblockAt(source) : 0;
  const s = await source.read(offset, 96);
  if (!at(s, 0, "hsqs")) throw new Error("The SquashFS superblock is missing.");
  const created = new Date(u32(s, 8) * 1000);
  const details = [
    row("Compression", COMPRESSIONS[u16(s, 20)] ?? `Unknown (${u16(s, 20)})`),
    row("Size", sizeDetail(u64(s, 40))),
    row("Inodes", u32(s, 4)),
    row("Block size", formatSize(u32(s, 12))),
    row("Version", `${u16(s, 28)}.${u16(s, 30)}`),
    row("Created", created.toISOString().slice(0, 19).replace("T", " ")),
  ];
  if (offset) details.push(row("Runtime", formatSize(offset)));
  const what = kind?.key === "squashfs" ? "SquashFS image" : format;
  return detailsOnly(
    format,
    details,
    `Browsing the files inside ${article(what)} ${what} is not available.`,
  );
}

const article = (/** @type {string} */ word) => (/^[AEIOU]/.test(word) ? "an" : "a");
