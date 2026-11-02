// APFS containers, read only, after Apple's "Apple File System Reference" (developer.apple.com;
// no code from other implementations): the container superblock (nx_superblock_t) at block 0
// locates the checkpoint descriptor area, whose valid superblock with the highest transaction is
// the latest checkpoint; its object map finds each volume's superblock (apfs_superblock_t), whose
// own object map finds the file-system tree. Encrypted volumes are named and not read, Fusion
// containers refused, snapshots counted (the live file system is what is listed).
import { row } from "../disk/archive.js";
import { formatSize, sizeDetail, u16, u32, u64 } from "../disk/bytes.js";
import { Refusal } from "../disk/work.js";
import { ApfsTree } from "./apfs-fs.js";
import {
  broken,
  checksumOk,
  OBJ_PHYSICAL,
  ObjectMap,
  objectType,
  readObject,
  TYPE_FS,
  TYPE_NX_SUPERBLOCK,
  walkTree,
} from "./apfs-object.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/** @typedef {import("../disk/archive.js").Detail} Detail */
/** @typedef {import("../disk/archive.js").FileSystem} FileSystem */
/** @typedef {import("./volumes.js").Volume} Volume */

const NXSB = 0x4253584e;
const APSB = 0x42535041;
const NX_INCOMPAT_FUSION = 0x100;
const APFS_FS_UNENCRYPTED = 0x1;
const INCOMPAT_CASE_INSENSITIVE = 0x1;
const INCOMPAT_NORMALIZATION_INSENSITIVE = 0x8;
const INCOMPAT_SEALED = 0x20;
const ROLES = /** @type {Record<number, string>} */ ({
  1: "System",
  2: "User",
  4: "Recovery",
  8: "VM",
  16: "Preboot",
  32: "Installer",
  64: "Data",
  128: "Baseband",
  192: "Update",
  256: "xART",
  320: "Hardware",
  384: "Backup",
  576: "Enterprise",
  704: "Prelogin",
});

/** The container superblock of the latest checkpoint. @param {Source} source */
async function latest(source) {
  const head = await source.read(0, 4096);
  if (u32(head, 32) !== NXSB) throw broken("its superblock is missing");
  const blockSize = u32(head, 36);
  if (blockSize < 4096 || blockSize > 65536 || blockSize & (blockSize - 1))
    throw broken("its block size is not one APFS uses");
  const block0 = blockSize === 4096 ? head : await source.read(0, blockSize);
  /** @type {Uint8Array | undefined} */
  let best = checksumOk(block0) ? block0 : undefined;
  const descBase = u64(block0, 112);
  const descBlocks = u32(block0, 104);
  // A descriptor area that is a B-tree of its own (the high bit set) is passed over: block 0 then.
  if (!(descBlocks & 0x80000000) && descBlocks > 0 && descBlocks <= 65536) {
    const area = await source.read(descBase * blockSize, descBlocks * blockSize);
    for (let at = 0; at + blockSize <= area.length; at += blockSize) {
      const b = area.subarray(at, at + blockSize);
      if (objectType(b) !== TYPE_NX_SUPERBLOCK || u32(b, 32) !== NXSB || !checksumOk(b)) continue;
      if (!best || u64(b, 16) > u64(best, 16)) best = b;
    }
  }
  if (!best) throw broken("no checkpoint holds together");
  return { nx: best, blockSize };
}

/**
 * One volume: its superblock, and the FileSystem over it unless it is encrypted.
 * @param {Source} source @param {number} blockSize @param {number} block @param {number} size the
 * container's bytes @param {number} xid the checkpoint's transaction
 */
async function volume(source, blockSize, block, size, xid) {
  const sb = await readObject(source, block, blockSize, "a volume superblock");
  if (objectType(sb) !== TYPE_FS || u32(sb, 32) !== APSB)
    throw broken("a volume superblock is not one");
  const label = new TextDecoder().decode(sb.subarray(704, 960)).replace(/\0[\s\S]*$/, "");
  const incompat = u32(sb, 56);
  const flags = u32(sb, 264);
  const used = u64(sb, 88) * blockSize;
  const snapshots = u64(sb, 216);
  const role = ROLES[u16(sb, 962)];
  const insensitive = !!(incompat & INCOMPAT_CASE_INSENSITIVE);
  const details = [row("Case sensitivity", insensitive ? "Case-insensitive" : "Case-sensitive")];
  if (role) details.push(row("Role", role));
  const created = u64(sb, 304) / 1e6;
  if (created > 0) details.push(row("Created", new Date(created).toISOString()));
  details.push(row("Files", u64(sb, 184).toLocaleString("en-US")));
  details.push(row("Folders", u64(sb, 192).toLocaleString("en-US")));
  if (snapshots) details.push(row("Snapshots", `${snapshots}, not read here`));
  if (incompat & INCOMPAT_SEALED) details.push(row("Sealed", "Yes"));
  const summary = `“${label}”, ${formatSize(used)} used, ${insensitive ? "case-insensitive" : "case-sensitive"}`;
  if (!(flags & APFS_FS_UNENCRYPTED)) {
    const refusal = `The volume “${label}” is encrypted: it is not read here.`;
    return { volume: { name: label, refusal }, summary: `“${label}”, encrypted: not read here` };
  }
  const omap = await ObjectMap.open(source, blockSize, u64(sb, 128), "a volume's object map");
  const physical = !!(u32(sb, 116) & OBJ_PHYSICAL);
  const resolve = physical
    ? async (/** @type {number} */ oid) => oid
    : (/** @type {number} */ oid) => omap.lookup(oid, xid);
  const hashed = !!(incompat & (INCOMPAT_CASE_INSENSITIVE | INCOMPAT_NORMALIZATION_INSENSITIVE));
  const tree = new ApfsTree(source, blockSize, hashed);
  /** @type {Promise<void> | undefined} */
  let walked;
  const walk = async (/** @type {Work} */ work) => {
    const root = await resolve(u64(sb, 136));
    if (root === undefined) throw broken("a volume's file-system tree is missing");
    await walkTree(source, root, blockSize, resolve, (r) => tree.visit(r), work);
    const fext = u64(sb, 1032);
    if (fext && incompat & INCOMPAT_SEALED)
      await walkTree(
        source,
        fext,
        blockSize,
        async (oid) => oid,
        (records) => {
          for (const { key, value } of records)
            if (value && value.length >= 16)
              tree.extent(
                u64(key, 0),
                u64(key, 8),
                u32(value, 0) + (u32(value, 4) & 0xffffff) * 0x100000000,
                u64(value, 8),
              );
        },
        work,
        { key: 16, value: 16 },
      );
  };
  /** @type {FileSystem} */
  const fs = {
    type: "APFS",
    label,
    size,
    used,
    details,
    list: async (work) => {
      walked ??= walk(work);
      try {
        await walked;
      } catch (error) {
        walked = undefined;
        tree.inodes.clear();
        tree.children.clear();
        tree.extents.clear();
        throw error;
      }
      return tree.list(work);
    },
    read: (ref, limit, work) => tree.read(ref, limit, work),
  };
  return { volume: { name: label, fs }, summary };
}

/**
 * Open an APFS container: the latest valid checkpoint, the container object map, each volume.
 * @param {Source} source the container (a cached Source, read by ranges)
 * @param {Work} work
 * @returns {Promise<{ details: Detail[], volumes: Volume[] }>}
 */
export async function openApfsContainer(source, work) {
  await work.tick();
  const { nx, blockSize } = await latest(source);
  const size = Math.min(source.size, u64(nx, 40) * blockSize);
  if (u32(nx, 64) & NX_INCOMPAT_FUSION)
    throw new Refusal("The container is half of a Fusion drive, which is not read here.", "APFS");
  const xid = u64(nx, 16);
  const omap = await ObjectMap.open(source, blockSize, u64(nx, 160), "the container's object map");
  const details = [
    row("Container", `APFS, ${sizeDetail(size)}`),
    row("Block size", sizeDetail(blockSize)),
  ];
  /** @type {Volume[]} */
  const volumes = [];
  /** @type {Detail[]} */
  const rows = [];
  const max = Math.min(100, u32(nx, 180) || 100);
  for (let i = 0; i < max; i++) {
    const oid = u64(nx, 184 + 8 * i);
    if (!oid) continue;
    await work.tick();
    const block = await omap.lookup(oid, xid);
    if (block === undefined) throw broken("a volume is missing from the object map");
    const found = await volume(source, blockSize, block, size, xid);
    volumes.push(found.volume);
    rows.push(row(`Volume ${volumes.length}`, found.summary));
  }
  details.push(row("Volumes", volumes.length), ...rows);
  return { details, volumes };
}
