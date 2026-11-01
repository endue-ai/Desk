// WIM (Windows imaging) files opened as their images' files: the header, the lookup table of
// resources by SHA-1, the XML image list and each image's metadata as a directory tree. Every image
// is a top folder named by its index and name; a file's data is found by its hash and read by chunk.
import { part, row } from "../disk/archive.js";
import { at, formatSize, sizeDetail, u16, u32 } from "../disk/bytes.js";
import { Work } from "../disk/work.js";
import { hashAt, linkTarget, parseMetadata } from "./wim-meta.js";
import {
  COMPRESSED,
  compressionOf,
  METADATA,
  Resources,
  refusalOf,
  resourceAt,
  SOLID,
  SPANNED,
} from "./wim-resource.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/archive.js").Archive} Archive */
/** @typedef {import("../disk/archive.js").Entry} Entry */
/** @typedef {import("./wim-resource.js").Resource} Resource */

export const SPLIT = "Split WIMs (.swm) are not read: open a WIM that is one file.";
const HEADER = 208;
const ENTRY = 50;

/** @param {string} s */
const entities = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, name) => {
    const named = /** @type {Record<string, string>} */ ({
      lt: "<",
      gt: ">",
      amp: "&",
      quot: '"',
      apos: "'",
    });
    if (named[name]) return /** @type {string} */ (named[name]);
    const code =
      name[1] === "x" || name[1] === "X"
        ? Number.parseInt(name.slice(2), 16)
        : Number(name.slice(1));
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });

/** A tag's text inside `xml`, "" when it is not there. @param {string} xml @param {string} name */
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? entities(/** @type {string} */ (m[1]).trim()) : "";
};

/** The image names and descriptions, and the total size, from the XML resource. @param {string} xml */
function readXml(xml) {
  /** @type {Map<number, { name: string, about: string }>} */
  const images = new Map();
  for (const m of xml.matchAll(/<IMAGE\b([^>]*)>([\s\S]*?)<\/IMAGE>/g)) {
    const index = Number(/INDEX="(\d+)"/.exec(/** @type {string} */ (m[1]))?.[1] ?? 0);
    const body = /** @type {string} */ (m[2]);
    const name = tag(body, "NAME") || tag(body, "DISPLAYNAME");
    const about = [tag(body, "DESCRIPTION"), tag(body, "EDITIONID")].filter(Boolean).join(", ");
    if (index) images.set(index, { name, about });
  }
  const total = Number(tag(xml.replace(/<IMAGE\b[\s\S]*?<\/IMAGE>/g, ""), "TOTALBYTES"));
  return { images, total: Number.isFinite(total) && total > 0 ? total : 0 };
}

/**
 * Open a WIM as an Archive. Split WIMs are refused; LZMS and solid resources (ESD files) are listed
 * with a refusal, and an image whose metadata is LZMS shows as an empty folder.
 * @param {Source} source @param {{ signal?: AbortSignal }} [options] @returns {Promise<Archive>}
 */
export async function openWim(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  const head = await source.read(0, HEADER);
  if (head.length < HEADER || !at(head, 0, "MSWIM\0\0\0"))
    throw new Error("This is not a WIM image.");
  if (u32(head, 8) < HEADER) throw new Error("The WIM header is damaged: its size is wrong.");
  const flags = u32(head, 16);
  const parts = u16(head, 42);
  if (parts > 1 || flags & 8) throw new Error(SPLIT);
  const compression = compressionOf(flags);
  const chunk = u32(head, 20) || 32768;
  if (compression !== "None" && (chunk & (chunk - 1) || chunk < 4096 || chunk > 2 ** 26))
    throw new Error("The WIM header is damaged: its chunk size is not a power of two.");
  const count = u32(head, 44);
  const resources = new Resources(source, compression, chunk);
  const details = [row("Images", count), row("Compression", compression)];
  if (compression !== "None") details.push(row("Chunk size", formatSize(chunk)));
  details.push(row("Part", `${u16(head, 40)} of ${parts}`));

  const lookup = resourceAt(head, 48);
  if (lookup.original > 256 << 20 || lookup.original % ENTRY)
    throw new Error("The WIM lookup table is damaged: its size is not a whole number of entries.");
  const table = await resources.read(lookup, 0, lookup.original, work, "the lookup table");
  /** @type {Map<string, Resource>} */
  const byHash = new Map();
  /** @type {Resource[]} */
  const metadata = [];
  for (let o = 0; o + ENTRY <= table.length; o += ENTRY) {
    const res = resourceAt(table, o);
    if (res.flags & METADATA) metadata.push(res);
    else byHash.set(hashAt(table, o + 30), res);
    if (o % (ENTRY * 4096) === 0) await work.tick();
  }

  let xml = { images: new Map(), total: 0 };
  const xmlRes = resourceAt(head, 72);
  if (xmlRes.original > 0 && xmlRes.original < 64 << 20 && !refusalOf(xmlRes, compression)) {
    const bytes = await resources.read(xmlRes, 0, xmlRes.original, work, "the XML data");
    xml = readXml(new TextDecoder("utf-16le").decode(bytes));
  }
  if (xml.total) details.push(row("Total size", sizeDetail(xml.total)));
  const boot = u32(head, 120);
  if (boot) details.push(row("Boot image", boot));

  /** @type {Entry[]} */
  const entries = [];
  /** @type {Map<string, { entry: Entry, res?: Resource }>} */
  const refs = new Map();
  let refusal = "";
  for (let image = 1; image <= count; image++) {
    const about = xml.images.get(image);
    const name = about?.name || `Image ${image}`;
    details.push(row(`Image ${image}`, about?.about ? `${name} (${about.about})` : name));
    const folder = part(`${image} ${name}`);
    /** @type {Entry} */
    const top = { path: folder, kind: "folder", size: 0 };
    entries.push(top);
    refs.set(folder, { entry: top });
    const meta = metadata[image - 1];
    if (!meta) throw new Error(`The WIM is damaged: image ${image} has no metadata.`);
    const why = refusalOf(meta, compression);
    if (why) {
      refusal = why;
      continue;
    }
    if (meta.original > 1 << 30)
      throw new Error(`The WIM metadata of image ${image} is too large to read.`);
    const what = `the metadata of image ${image}`;
    const buf = await resources.read(meta, 0, meta.original, work, what);
    for (const node of await parseMetadata(buf, image, work)) {
      const res = node.hash ? byHash.get(node.hash) : undefined;
      /** @type {Entry} */
      const entry = { path: `${folder}/${node.path}`, kind: node.kind, size: 0 };
      if (node.date) entry.date = node.date;
      if (node.kind === "file" && node.hash) {
        if (!res) entry.refusal = "The data of this file is not in the WIM.";
        else {
          entry.size = res.original;
          entry.method = res.flags & SOLID ? "LZMS" : res.flags & COMPRESSED ? compression : "None";
          if (!(res.flags & SOLID)) entry.packed = res.size;
          const why = refusalOf(res, compression) || (res.flags & SPANNED ? SPLIT : "");
          if (why) entry.refusal = why;
        }
      } else if (node.kind === "link") {
        entry.link = await target(resources, node.tag, res, work);
        entry.size = new TextEncoder().encode(entry.link).length;
      }
      entries.push(entry);
      refs.set(entry.path, { entry, res: node.kind === "file" ? res : undefined });
      if (entries.length % 4096 === 0) await work.tick();
    }
  }
  return {
    format: "WIM",
    entries,
    details,
    ...(refusal ? { refusal, note: refusal } : {}),
    read: async (entry, limit = Number.POSITIVE_INFINITY, options = {}) => {
      const found = refs.get(entry.path);
      if (!found) throw new Error(`“${entry.path}” is not in this WIM.`);
      if (found.entry.refusal) throw new Error(found.entry.refusal);
      if (found.entry.kind === "folder") throw new Error(`“${entry.path}” is a folder.`);
      if (found.entry.kind === "link") return new TextEncoder().encode(found.entry.link ?? "");
      const reading = new Work(options.signal);
      await reading.tick();
      const res = found.res;
      if (!res) return new Uint8Array(0);
      const n = Math.min(res.original, Math.max(0, limit));
      return resources.read(res, 0, n, reading, `“${entry.path}”`);
    },
  };
}

/**
 * A link's target from its reparse data, "" when that cannot be read.
 * @param {Resources} resources @param {number} tag @param {Resource | undefined} res @param {Work} work
 */
async function target(resources, tag, res, work) {
  if (!res || res.original > 65536 || refusalOf(res, resources.compression)) return "";
  try {
    return linkTarget(tag, await resources.read(res, 0, res.original, work, "a link"));
  } catch (error) {
    if (work.signal?.aborted) throw error;
    return "";
  }
}
