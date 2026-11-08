// UDIF, the format of .dmg files: the disk's chunks first, then an XML property list whose
// "blkx" entries are the block tables ("mish") of each partition, then the 512-byte "koly"
// trailer that says where the list is. Older images keep the tables as 'blkx' resources in a
// resource fork instead. Encrypted images ("encrcdsa") and sparse images ("sprs") are refused with
// a sentence; a file with no trailer is taken as a raw disk.
import { row } from "../disk/archive.js";
import { at, latin1, sizeDetail, text, u16be, u32be, u64be } from "../disk/bytes.js";
import { damaged, Refusal } from "../disk/work.js";
import { COMMENT, chunkSource, END, IGNORE, METHODS, RAW, ZERO } from "./chunks.js";
import { parsePlist } from "./plist.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/archive.js").Detail} Detail */
/** @typedef {import("./chunks.js").Chunk} Chunk */
/** @typedef {{ format: string, details: Detail[], disk: Source }} Image */

export const ENCRYPTED =
  "The disk image is encrypted: it opens only with its password, which is not asked for here.";
const FORMATS = /** @type {Record<string, string>} */ ({
  zlib: "UDZO",
  bzip2: "UDBZ",
  LZFSE: "ULFO",
  LZMA: "ULMO",
  ADC: "UDCO",
});

/** The 'blkx' resources of a classic resource fork. @param {Uint8Array} fork */
function forkTables(fork) {
  const bad = () => damaged("The disk image is damaged: its resource fork does not hold together.");
  if (fork.length < 16) throw bad();
  const dataAt = u32be(fork, 0);
  const mapAt = u32be(fork, 4);
  if (mapAt + 30 > fork.length) throw bad();
  const types = mapAt + u16be(fork, mapAt + 24);
  /** @type {Uint8Array[]} */
  const tables = [];
  const typeCount = u16be(fork, types) + 1;
  for (let t = 0; t < typeCount; t++) {
    const entry = types + 2 + 8 * t;
    if (entry + 8 > fork.length) throw bad();
    if (!at(fork, entry, "blkx")) continue;
    const count = u16be(fork, entry + 4) + 1;
    const refs = types + u16be(fork, entry + 6);
    for (let r = 0; r < count; r++) {
      const ref = refs + 12 * r;
      if (ref + 12 > fork.length) throw bad();
      const offset = dataAt + (u32be(fork, ref + 4) & 0xffffff);
      const length = u32be(fork, offset);
      if (offset + 4 + length > fork.length) throw bad();
      tables.push(fork.subarray(offset + 4, offset + 4 + length));
    }
  }
  return tables;
}

/** The block tables, from the XML list or the resource fork. @param {Source} source @param {Uint8Array} koly @param {number} base */
async function blockTables(source, koly, base) {
  const xmlAt = u64be(koly, 216);
  const xmlLength = u64be(koly, 224);
  if (xmlLength > 0) {
    if (xmlAt + xmlLength > source.size || xmlLength > 256 * 1024 * 1024)
      throw damaged("The disk image is damaged: its property list goes past the end of the file.");
    const plist = /** @type {any} */ (parsePlist(text(await source.read(xmlAt, xmlLength))));
    const blkx = plist?.["resource-fork"]?.blkx;
    if (!Array.isArray(blkx))
      throw damaged("The disk image is damaged: its property list has no block tables.");
    return blkx
      .map((/** @type {any} */ entry) => entry?.Data)
      .filter((d) => d instanceof Uint8Array);
  }
  const forkAt = base + u64be(koly, 40);
  const forkLength = u64be(koly, 48);
  if (!forkLength) throw damaged("The disk image is damaged: it has no block tables.");
  if (forkAt + forkLength > source.size)
    throw damaged("The disk image is damaged: its resource fork goes past the end of the file.");
  return forkTables(await source.read(forkAt, forkLength));
}

/**
 * The chunks of the block tables, sorted on the disk.
 * @param {Uint8Array[]} tables @param {number} base the data fork's offset @param {number} size
 * @param {number} fileSize @returns {Chunk[]}
 */
function chunksOf(tables, base, size, fileSize) {
  /** @type {Chunk[]} */
  const chunks = [];
  for (const table of tables) {
    if (!at(table, 0, "mish") || table.length < 204)
      throw damaged("The disk image is damaged: a block table does not start with “mish”.");
    const first = u64be(table, 8);
    const data = u64be(table, 24);
    const count = u32be(table, 200);
    if (204 + 40 * count > table.length)
      throw damaged("The disk image is damaged: a block table is cut short.");
    for (let i = 0; i < count; i++) {
      const o = 204 + 40 * i;
      const type = u32be(table, o);
      if (type === END || type === COMMENT) continue;
      const start = (first + u64be(table, o + 8)) * 512;
      const end = start + u64be(table, o + 16) * 512;
      if (end <= start || type === ZERO || type === IGNORE) continue;
      if (!METHODS[type])
        throw new Refusal(
          `The disk image holds chunks of type 0x${type.toString(16).padStart(8, "0")}, which are not read here.`,
        );
      const chunk = {
        start,
        end,
        type,
        at: base + data + u64be(table, o + 24),
        length: u64be(table, o + 32),
      };
      if (end > size)
        throw damaged("The disk image is damaged: a block table reaches past the end of the disk.");
      if (chunk.at + chunk.length > fileSize)
        throw damaged("The disk image is cut short: its data goes past the end of the file.");
      chunks.push(chunk);
    }
  }
  chunks.sort((a, b) => a.start - b.start);
  for (let i = 1; i < chunks.length; i++)
    if ((chunks[i]?.start ?? 0) < (chunks[i - 1]?.end ?? 0))
      throw damaged("The disk image is damaged: two block tables cover the same sectors.");
  return chunks;
}

/** "UDZO", "UDBZ", ... from the methods the chunks use. @param {Chunk[]} chunks */
function formatOf(chunks) {
  const methods = new Set(chunks.map((c) => METHODS[c.type]).filter((m) => m && m !== "raw"));
  if (!methods.size) return { code: "UDRO", method: "not compressed" };
  if (methods.size === 1) {
    const [method] = /** @type {string[]} */ ([...methods]);
    return { code: FORMATS[method] ?? "UDIF", method: `${method}-compressed` };
  }
  return { code: "UDIF", method: `compressed with ${[...methods].join(", ")}` };
}

/**
 * The disk inside a DMG. A file with no "koly" trailer is the disk itself (a raw image).
 * @param {Source} source @param {import("../disk/work.js").Work} work @returns {Promise<Image>}
 */
export async function readUdif(source, work) {
  await work.tick();
  const head = await source.read(0, 8);
  const tail = await source.read(Math.max(0, source.size - 512), 512);
  const sizeRow = row("Image size", sizeDetail(source.size));
  if (at(head, 0, "encrcdsa") || latin1(tail).includes("cdsaencr"))
    throw new Refusal(ENCRYPTED, "Apple disk image (encrypted)", [
      row("Format", "UDIF, encrypted"),
      sizeRow,
    ]);
  if (at(head, 0, "sprs"))
    throw new Refusal("Sparse disk images (UDSP) are not read here.", "Apple sparse disk image", [
      sizeRow,
    ]);
  if (!at(tail, 0, "koly") || source.size < 512)
    return { format: "Disk image", details: [row("Size", sizeDetail(source.size))], disk: source };
  if (u32be(tail, 8) !== 512)
    throw damaged("The disk image is damaged: its “koly” trailer has the wrong size.");
  const segments = u32be(tail, 60);
  if (segments > 1)
    throw new Refusal(
      `The disk image is split into ${segments} segments, which are not read here.`,
      "Apple disk image",
      [sizeRow],
    );
  const base = u64be(tail, 24);
  const size = u64be(tail, 492) * 512;
  await work.tick();
  const tables = await blockTables(source, tail, base);
  await work.tick();
  const chunks = chunksOf(tables, base, size, source.size);
  const { code, method } = formatOf(chunks);
  const details = [
    row("Format", `UDIF, ${method} (${code})`),
    row("Disk size", sizeDetail(size)),
    sizeRow,
  ];
  if (chunks.some((c) => c.type !== RAW)) details.push(row("Chunks", chunks.length));
  return { format: `Apple disk image (${code})`, details, disk: chunkSource(source, chunks, size) };
}
