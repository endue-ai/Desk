// Virtual disks: VHD, VHDX, VMDK and QCOW2 headers give the virtual size, the format version and
// the kind of image. The disks' file systems are not browsed.
import {
  at,
  formatSize,
  latin1,
  sizeDetail,
  u16,
  u16be,
  u32,
  u32be,
  u64,
  u64be,
  unixDate,
  utf16le,
} from "../bytes.js";
import { detailsOnly, row } from "./archive.js";
import { guid } from "./disk.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */

const VHD_TYPES = /** @type {Record<number, string>} */ ({
  2: "Fixed",
  3: "Dynamic",
  4: "Differencing",
});

/** @param {Source} source */
async function vhd(source) {
  let footer = await source.read(Math.max(0, source.size - 512), 512);
  if (!at(footer, 0, "conectix")) footer = await source.read(Math.max(0, source.size - 511), 511);
  if (!at(footer, 0, "conectix")) footer = await source.read(0, 512);
  if (!at(footer, 0, "conectix")) throw new Error("The VHD footer is missing.");
  const type = u32be(footer, 60);
  const creator = latin1(footer.subarray(28, 32)).replace(/\0/g, "").trim();
  const created = unixDate(u32be(footer, 24) + 946684800);
  /** @type {Detail[]} */
  const details = [
    row("Virtual size", sizeDetail(u64be(footer, 48))),
    row("Type", VHD_TYPES[type] ?? `Type ${type}`),
    row("Version", `${u16be(footer, 12)}.${u16be(footer, 14)}`),
  ];
  if (creator) details.push(row("Created by", creator));
  if (created) details.push(row("Created", created.toISOString().slice(0, 10)));
  return details;
}

const METADATA_REGION = "8B7CA206-4790-4B9A-B8FE-575F050F886E";
const FILE_PARAMETERS = "CAA16737-FA36-4D43-B3B6-33F0AA44E76B";
const VIRTUAL_SIZE = "2FA54224-CD1B-4876-B211-5DBED83BF4B8";
const LOGICAL_SECTOR = "8141BF1D-A96F-4709-BA47-F233A8FAAB5F";

/** @param {Source} source */
async function vhdx(source) {
  const creator = utf16le(await source.read(8, 512)).replace(/\0[\s\S]*$/, "");
  // Two headers; the one with the higher sequence number is current.
  const one = await source.read(64 * 1024, 80);
  const two = await source.read(128 * 1024, 80);
  const valid = [one, two].filter((h) => at(h, 0, "head"));
  const header = valid.sort((a, b) => u64(b, 8) - u64(a, 8))[0];
  if (!header) throw new Error("The VHDX headers are damaged.");
  /** @type {Detail[]} */
  const details = [];
  const regions = await source.read(192 * 1024, 64 * 1024);
  if (!at(regions, 0, "regi")) throw new Error("The VHDX region table is damaged.");
  for (let i = 0; i < Math.min(u32(regions, 8), 2047); i++) {
    const e = regions.subarray(16 + i * 32, 48 + i * 32);
    if (guid(e.subarray(0, 16)) !== METADATA_REGION) continue;
    const base = u64(e, 16);
    const table = await source.read(base, 64 * 1024);
    if (!at(table, 0, "metadata")) throw new Error("The VHDX metadata table is damaged.");
    for (let j = 0; j < Math.min(u16(table, 10), 2047); j++) {
      const item = table.subarray(32 + j * 32, 64 + j * 32);
      const id = guid(item.subarray(0, 16));
      const value = await source.read(base + u32(item, 16), Math.min(u32(item, 20), 64));
      if (id === VIRTUAL_SIZE) details.unshift(row("Virtual size", sizeDetail(u64(value, 0))));
      else if (id === FILE_PARAMETERS) {
        const flags = u32(value, 4);
        details.push(row("Type", flags & 2 ? "Differencing" : flags & 1 ? "Fixed" : "Dynamic"));
        details.push(row("Block size", formatSize(u32(value, 0))));
      } else if (id === LOGICAL_SECTOR) details.push(row("Sector size", `${u32(value, 0)} bytes`));
    }
  }
  details.push(row("Version", u16(header, 66)));
  if (creator) details.push(row("Created by", creator));
  return details;
}

/** @param {Source} source */
async function vmdk(source) {
  const head = await source.read(0, 512);
  let descriptor = "";
  /** @type {Detail[]} */
  const details = [];
  if (at(head, 0, "KDMV")) {
    details.push(row("Virtual size", sizeDetail(u64(head, 12) * 512)));
    details.push(row("Version", u32(head, 4)));
    const offset = u64(head, 28) * 512;
    const size = Math.min(u64(head, 36) * 512, 64 * 1024);
    if (offset && size) descriptor = latin1(await source.read(offset, size));
    if (u16(head, 77) === 1) details.push(row("Compression", "Deflate"));
  } else {
    descriptor = latin1(await source.read(0, Math.min(source.size, 64 * 1024)));
    let sectors = 0;
    for (const m of descriptor.matchAll(/^\s*(?:RW|RDONLY|NOACCESS)\s+(\d+)\s/gm))
      sectors += Number(m[1]);
    details.push(row("Virtual size", sizeDetail(sectors * 512)));
    const version = /^\s*version\s*=\s*(\d+)/m.exec(descriptor)?.[1];
    if (version) details.push(row("Version", version));
  }
  const type = /createType\s*=\s*"([^"]*)"/.exec(descriptor)?.[1];
  if (type) details.push(row("Type", type));
  return details;
}

/** @param {Source} source */
async function qcow2(source) {
  const head = await source.read(0, 112);
  const version = u32be(head, 4);
  /** @type {Detail[]} */
  const details = [row("Virtual size", sizeDetail(u64be(head, 24))), row("Version", version)];
  if (version >= 2) {
    details.push(row("Cluster size", formatSize(2 ** u32be(head, 20))));
    const crypt = u32be(head, 32);
    if (crypt) details.push(row("Encryption", crypt === 2 ? "LUKS" : "AES"));
    const backing = u64be(head, 8);
    const length = u32be(head, 16);
    if (backing && length && length < 1024)
      details.push(row("Backing file", latin1(await source.read(backing, length))));
    if (version >= 3 && u32be(head, 100) > 104)
      details.push(row("Compression", head[104] === 1 ? "zstd" : "zlib"));
  }
  return details;
}

const READERS = /** @type {Record<string, (source: Source) => Promise<Detail[]>>} */ ({
  vhd,
  vhdx,
  vmdk,
  qcow2,
});

/** @param {Source} source @param {string} _name @param {{ key: string, label: string }} kind */
export async function openVirtualDisk(source, _name, kind) {
  const read = READERS[kind.key];
  if (!read) throw new Error(`${kind.label} is not read here.`);
  return detailsOnly(
    kind.label,
    await read(source),
    `Browsing the files inside a ${kind.label} is not available.`,
  );
}
