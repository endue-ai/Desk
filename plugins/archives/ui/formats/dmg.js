// DMG (UDIF): the koly trailer in the last 512 bytes and its XML property list, whose blkx list
// names the partitions. The file system inside is not browsed.
import { at, fromBase64, sizeDetail, u32be, u64be, utf8 } from "../bytes.js";
import { detailsOnly, row } from "./archive.js";
import { parseXml, plistValue } from "./xml.js";

/** @typedef {import("../source.js").Source} Source */

const NOTE = "Browsing the files inside a DMG is not available.";
/** Chunk types in a blkx table, by what they compress with. */
const CHUNKS = /** @type {Record<number, string>} */ ({
  2147483652: "ADC",
  2147483653: "zlib",
  2147483654: "bzip2",
  2147483655: "LZFSE",
  2147483656: "LZMA",
});

/** The compressions a partition's blkx table uses. @param {string} data base64 mish @param {Set<string>} into */
function chunkTypes(data, into) {
  const mish = fromBase64(data);
  if (!at(mish, 0, "mish")) return;
  const count = u32be(mish, 200);
  for (let i = 0; i < count; i++) {
    const type = u32be(mish, 204 + i * 40);
    const name = CHUNKS[type];
    if (name) into.add(name);
    else if (type === 1) into.add("raw");
  }
}

/** @param {Source} source @param {string} _name */
export async function openDmg(source, _name) {
  if (source.size < 512) throw new Error("The DMG is too short to hold its trailer.");
  const koly = await source.read(source.size - 512, 512);
  if (!at(koly, 0, "koly")) throw new Error("The DMG has no UDIF trailer.");
  const xmlOffset = u64be(koly, 216);
  const xmlLength = u64be(koly, 224);
  const sectors = u64be(koly, 492);
  const details = [
    row("Format", "UDIF"),
    row("Size", sizeDetail(sectors * 512)),
    row("Sectors", sectors.toLocaleString("en-US")),
  ];
  if (xmlLength > 0 && xmlLength < 64 * 1024 * 1024 && xmlOffset + xmlLength <= source.size) {
    const plist = /** @type {{ "resource-fork"?: { blkx?: Array<Record<string, unknown>> } }} */ (
      plistValue(parseXml(utf8(await source.read(xmlOffset, xmlLength))))
    );
    const blkx = plist?.["resource-fork"]?.blkx ?? [];
    const kinds = new Set();
    for (const part of blkx) if (typeof part.Data === "string") chunkTypes(part.Data, kinds);
    if (kinds.size) details.push(row("Compression", [...kinds].join(", ")));
    details.push(row("Partitions", blkx.length));
    blkx.forEach((part, i) => {
      details.push(row(`Partition ${i + 1}`, String(part.Name || part.CFName || "(unnamed)")));
    });
  } else details.push(row("Partitions", 0));
  return detailsOnly("DMG", details, NOTE);
}
