// Which format a file is, from its first bytes (a few known places further in: an ISO's
// descriptors, a DMG's or VHD's trailer), then its extension; and the reader that opens it.
import { at, u16 } from "../bytes.js";
import { openArj } from "./arj.js";
import { openCab } from "./cab.js";
import { isCpio } from "./cpio.js";
import { openDeb } from "./deb.js";
import { openDisk } from "./disk.js";
import { openDmg } from "./dmg.js";
import { openGem } from "./gem.js";
import { openIso } from "./iso.js";
import { openLha } from "./lha.js";
import { openMsi } from "./msi.js";
import { openRar } from "./rar.js";
import { openRpm } from "./rpm.js";
import { openSevenZip } from "./sevenzip/index.js";
import { openSquashfs } from "./squashfs.js";
import { openStream } from "./stream.js";
import { isTar, openTar } from "./tar.js";
import { openTorrent } from "./torrent.js";
import { openVirtualDisk } from "./vdisk.js";
import { openWim } from "./wim.js";
import { openXar } from "./xar.js";
import { openZip } from "./zip.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {(source: Source, name: string, kind: Kind) => Promise<Archive>} Opener */
/** @typedef {{ key: string, label: string }} Kind */

/** @type {Record<string, [string, Opener]>} */
const FORMATS = {
  zip: ["ZIP", openZip],
  tar: ["tar", openTar],
  cpio: ["cpio", (source, name, kind) => openStream(source, name, kind)],
  gzip: ["gzip", openStream],
  bzip2: ["bzip2", openStream],
  xz: ["xz", openStream],
  lzma: ["LZMA", openStream],
  zstd: ["Zstandard", openStream],
  lz4: ["LZ4", openStream],
  lzw: ["compress", openStream],
  "7z": ["7z", openSevenZip],
  rar: ["RAR", openRar],
  iso: ["ISO 9660", openIso],
  deb: ["Debian package", openDeb],
  rpm: ["RPM package", openRpm],
  gem: ["Ruby gem", openGem],
  xar: ["xar", openXar],
  pkg: ["Installer package", openXar],
  cab: ["Cabinet", openCab],
  msi: ["MSI", openMsi],
  arj: ["ARJ", openArj],
  lha: ["LHA", openLha],
  dmg: ["DMG", openDmg],
  img: ["Disk image", openDisk],
  vhd: ["VHD", openVirtualDisk],
  vhdx: ["VHDX", openVirtualDisk],
  vmdk: ["VMDK", openVirtualDisk],
  qcow2: ["QCOW2", openVirtualDisk],
  wim: ["WIM", openWim],
  squashfs: ["SquashFS", openSquashfs],
  snap: ["Snap", openSquashfs],
  appimage: ["AppImage", openSquashfs],
  torrent: ["Torrent", openTorrent],
};

/** Extensions to formats, when the bytes alone do not say (or say too little). */
const EXTENSIONS = /** @type {Record<string, string>} */ ({
  gem: "gem",
  pkg: "pkg",
  mpkg: "pkg",
  lzma: "lzma",
  snap: "snap",
  appimage: "appimage",
  torrent: "torrent",
  dmg: "dmg",
  img: "img",
  iso: "iso",
  vhd: "vhd",
  vhdx: "vhdx",
  vmdk: "vmdk",
  qcow2: "qcow2",
  wim: "wim",
  esd: "wim",
  swm: "wim",
});

const extensionOf = (/** @type {string} */ name) =>
  /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** The format the first bytes name, or "". @param {Uint8Array} h */
function byMagic(h) {
  if (at(h, 0, "PK\x03\x04") || at(h, 0, "PK\x05\x06") || at(h, 0, "PK\x07\x08")) return "zip";
  if (at(h, 0, "Cr24")) return "zip";
  if (h[0] === 0x1f && h[1] === 0x8b) return "gzip";
  if (h[0] === 0x1f && h[1] === 0x9d) return "lzw";
  if (at(h, 0, "BZh") && (h[3] ?? 0) >= 0x31 && (h[3] ?? 0) <= 0x39) return "bzip2";
  if (at(h, 0, "\xfd7zXZ\x00")) return "xz";
  if (at(h, 0, "\x28\xb5\x2f\xfd")) return "zstd";
  if ((h[0] ?? 0) >= 0x50 && (h[0] ?? 0) <= 0x5f && at(h, 1, "\x2a\x4d\x18")) return "zstd";
  if (at(h, 0, "\x04\x22\x4d\x18") || at(h, 0, "\x02\x21\x4c\x18")) return "lz4";
  if (at(h, 0, "7z\xbc\xaf\x27\x1c")) return "7z";
  if (at(h, 0, "Rar!\x1a\x07")) return "rar";
  if (at(h, 0, "!<arch>\n")) return "deb";
  if (at(h, 0, "\xed\xab\xee\xdb")) return "rpm";
  if (at(h, 0, "xar!")) return "xar";
  if (at(h, 0, "MSCF")) return "cab";
  if (at(h, 0, "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")) return "msi";
  if (h[0] === 0x60 && h[1] === 0xea) return "arj";
  if (
    h[2] === 0x2d &&
    h[6] === 0x2d &&
    /^(lh|lz|pm)[0-9a-z]$/.test(String.fromCharCode(...h.subarray(3, 6)))
  )
    return "lha";
  if (at(h, 0, "QFI\xfb")) return "qcow2";
  if (at(h, 0, "KDMV") || at(h, 0, "# Disk DescriptorFile")) return "vmdk";
  if (at(h, 0, "vhdxfile")) return "vhdx";
  if (at(h, 0, "conectix")) return "vhd";
  if (at(h, 0, "MSWIM\x00\x00\x00")) return "wim";
  if (at(h, 0, "hsqs")) return "squashfs";
  if (at(h, 0, "\x7fELF") && at(h, 8, "AI\x02")) return "appimage";
  if (isCpio(h)) return "cpio";
  if (isTar(h)) return "tar";
  return "";
}

/**
 * What `source` is, from its bytes and then `name`; null when this plugin does not read it.
 * @param {Source} source @param {string} name
 * @returns {Promise<Kind | null>}
 */
export async function detectFormat(source, name) {
  const head = await source.read(0, Math.min(source.size, 4096));
  const ext = extensionOf(name);
  let key = byMagic(head);
  if (key === "xar" && (ext === "pkg" || ext === "mpkg")) key = "pkg";
  if (key === "tar" && ext === "gem") key = "gem";
  if (key === "squashfs" && ext === "snap") key = "snap";
  if (!key && source.size >= 34816) {
    const descriptor = await source.read(32769, 5);
    if (at(descriptor, 0, "CD001")) key = "iso";
  }
  if (!key && source.size >= 512) {
    const tail = await source.read(source.size - 512, 512);
    if (at(tail, 0, "koly")) key = "dmg";
    else if (at(tail, 0, "conectix") || at(tail, 1, "conectix")) key = "vhd";
  }
  if (!key && head.length >= 512 && (at(head, 512, "EFI PART") || u16(head, 510) === 0xaa55))
    key = ext === "img" || ext === "" || !EXTENSIONS[ext] ? "img" : "";
  if (!key && ext === "torrent" && head[0] === 0x64) key = "torrent";
  if (
    !key &&
    head[0] === 0x64 &&
    /^d\d+:(announce|info|created|comment)/.test(String.fromCharCode(...head.subarray(0, 20)))
  )
    key = "torrent";
  if (!key && ext === "lzma" && head[0] !== undefined && head[0] < 225) key = "lzma";
  if (!key) return null;
  const label = FORMATS[key]?.[0] ?? key;
  return { key, label };
}

/** Open what `detectFormat` found. @param {Source} source @param {string} name @param {Kind} kind */
export async function openDetected(source, name, kind) {
  const format = FORMATS[kind.key];
  if (!format) throw new Error(`${kind.label} is not read here.`);
  return format[1](source, name, kind);
}

/**
 * Open `source` as whatever archive, package or disk image it is. Throws a sentence when it is
 * none this plugin reads, or a damaged one.
 * @param {Source} source @param {string} name
 */
export async function openArchive(source, name) {
  const kind = await detectFormat(source, name);
  if (!kind) throw new Error("This is not an archive, package or disk image that Archives reads.");
  return openDetected(source, name, kind);
}
