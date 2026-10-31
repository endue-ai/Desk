// WIM (Windows imaging): the header's compression and image count, and the image names from its
// XML resource (UTF-16). The images' files are not browsed.
import { at, sizeDetail, u16, u32, u64, utf16le } from "../bytes.js";
import { detailsOnly, row } from "./archive.js";
import { child, children, parseXml, textOf } from "./xml.js";

/** @typedef {import("../source.js").Source} Source */

const NOTE = "Browsing the files inside a WIM is not available.";

/** @param {number} flags */
function compression(flags) {
  if (!(flags & 0x2)) return "None";
  if (flags & 0x40000) return "LZX";
  if (flags & 0x20000) return "XPRESS";
  if (flags & 0x80000) return "LZMS";
  return "Unknown";
}

/** @param {Source} source @param {string} _name */
export async function openWim(source, _name) {
  const head = await source.read(0, 208);
  if (!at(head, 0, "MSWIM\0\0\0")) throw new Error("This is not a WIM image.");
  const flags = u32(head, 16);
  const count = u32(head, 44);
  const details = [
    row("Images", count),
    row("Compression", compression(flags)),
    row("Part", `${u16(head, 40)} of ${u16(head, 42)}`),
  ];
  // The XML resource: 7 bytes of size, 1 of flags, then its offset and original size.
  const size = u32(head, 72) + (head[76] ?? 0) * 0x100000000 + (head[77] ?? 0) * 0x10000000000;
  const resourceFlags = head[79] ?? 0;
  const offset = u64(head, 80);
  if (size > 0 && size < 16 * 1024 * 1024 && offset + size <= source.size && !(resourceFlags & 4)) {
    const xml = utf16le(await source.read(offset, size)).replace(/^﻿/, "");
    const root = parseXml(xml);
    const total = textOf(root, "TOTALBYTES");
    if (total) details.push(row("Total size", sizeDetail(Number(total))));
    for (const image of children(root, "IMAGE")) {
      const index = image.attrs.INDEX ?? String(details.length);
      const name = textOf(image, "NAME") || textOf(image, "DISPLAYNAME") || "(unnamed)";
      const description = textOf(image, "DESCRIPTION");
      const windows = child(image, "WINDOWS");
      const edition = textOf(windows, "EDITIONID");
      const extra = [description, edition].filter(Boolean).join(", ");
      details.push(row(`Image ${index}`, extra ? `${name} (${extra})` : name));
    }
  }
  return detailsOnly("WIM", details, NOTE);
}
