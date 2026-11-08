// ext2/3/4 directories: their entries read block by block (an htree's index blocks hold no names,
// so a linear read gives every entry), or from the inode's inline data. From the ext4 disk layout
// documentation.
import { text, u16, u32 } from "./bytes.js";
import { FLAG_INLINE, readData, systemData } from "./ext-inode.js";

/** @typedef {import("./ext-inode.js").Volume & { fileType: boolean }} DirVolume */
/** @typedef {import("./ext-inode.js").Inode} Inode */
/** @typedef {{ ino: number, name: string }} DirEntry */

/**
 * The entries in `bytes`, in pieces of `piece` bytes that no entry crosses. Empty slots (inode 0,
 * the checksum tail, htree index blocks) and "." and ".." are left out; a damaged entry ends its
 * piece.
 * @param {Uint8Array} bytes @param {number} piece @param {DirVolume} vol @param {DirEntry[]} out
 */
function parse(bytes, piece, vol, out) {
  for (let base = 0; base < bytes.length; base += piece) {
    const end = Math.min(bytes.length, base + piece);
    for (let pos = base; pos + 8 <= end; ) {
      const ino = u32(bytes, pos);
      let length = u16(bytes, pos + 4);
      if (vol.bs >= 65536)
        length =
          length === 65535 || length === 0 ? vol.bs : (length & 65532) | ((length & 3) << 16);
      const nameLength = vol.fileType ? (bytes[pos + 6] ?? 0) : u16(bytes, pos + 6);
      if (length < 8 || pos + length > end || 8 + nameLength > length) break;
      if (ino && nameLength) {
        const name = text(bytes.subarray(pos + 8, pos + 8 + nameLength));
        if (name !== "." && name !== "..") out.push({ ino, name });
      }
      pos += length;
    }
  }
}

/**
 * The entries of a directory.
 * @param {DirVolume} vol @param {Inode} inode @param {import("./work.js").Work} work
 * @returns {Promise<DirEntry[]>}
 */
export async function readDirectory(vol, inode, work) {
  /** @type {DirEntry[]} */
  const out = [];
  if (inode.flags & FLAG_INLINE) {
    // Four bytes of parent inode, then entries in the rest of i_block and in system.data.
    parse(inode.block.subarray(4), 56, vol, out);
    const more = systemData(inode.raw);
    if (more?.length) parse(more, more.length, vol, out);
    return out;
  }
  parse(await readData(vol, inode, inode.size, work), vol.bs, vol, out);
  return out;
}
