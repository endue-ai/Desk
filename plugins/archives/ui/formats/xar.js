// xar, and the flat macOS installer packages built on it: a header, a zlib-compressed XML table of
// contents, then the heap where each file's data sits (gzip as xar names zlib, bzip2, or stored).
import { at, fromBase64, u16be, u64be, utf8 } from "../bytes.js";
import { collect, decode, decodeStream } from "../codecs/index.js";
import { inputFrom } from "../codecs/input.js";
import { sliceSource } from "../source.js";
import { cleanPath, row, withFolders } from "./archive.js";
import { child, children, parseXml, textOf } from "./xml.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./xml.js").XmlNode} XmlNode */
/** @typedef {Entry & { offset?: number, length?: number, codec?: string }} XarEntry */

/** Encoding styles to codecs ("" for stored) and the method people read. */
const ENCODINGS = /** @type {Record<string, [string, string]>} */ ({
  "application/octet-stream": ["", "Stored"],
  "application/x-gzip": ["zlib", "gzip"],
  "application/x-bzip2": ["bzip2", "bzip2"],
  "application/x-lzma": ["lzma", "LZMA"],
  "application/x-xz": ["xz", "xz"],
});

/** A TOC date: ISO 8601, UTC when it names no zone. @param {string} value */
function tocDate(value) {
  if (!value) return undefined;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1970 ? undefined : d;
}

/** The text of a <name>, decoded when the TOC stores it as base64. @param {XmlNode | undefined} node */
function nameOf(node) {
  if (!node) return "";
  const raw = node.text.trim();
  return node.attrs.enctype === "base64" ? utf8(fromBase64(raw)) : raw;
}

/**
 * Every <file> under `node`, depth first, with its path.
 * @param {XmlNode} node @param {string} parent @param {XarEntry[]} into
 */
function walk(node, parent, into) {
  for (const file of children(node, "file")) {
    const name = nameOf(child(file, "name"));
    const path = parent ? `${parent}/${name}` : name;
    const type = textOf(file, "type");
    /** @type {XarEntry} */
    const entry = {
      path: cleanPath(path),
      kind: type === "directory" ? "folder" : type === "symlink" ? "link" : "file",
      size: 0,
    };
    const date = tocDate(textOf(file, "mtime"));
    if (date) entry.date = date;
    if (type === "symlink") entry.link = textOf(file, "link");
    const data = child(file, "data");
    if (data && entry.kind === "file") {
      const style = child(data, "encoding")?.attrs.style ?? "application/octet-stream";
      const known = ENCODINGS[style];
      entry.size = Number(textOf(data, "size")) || 0;
      entry.packed = Number(textOf(data, "length")) || 0;
      entry.offset = Number(textOf(data, "offset")) || 0;
      entry.length = entry.packed;
      if (known) {
        entry.codec = known[0];
        entry.method = known[1];
      } else entry.refusal = `Data encoded as ${style} is not read.`;
      if (child(data, "encryption") || textOf(data, "encryption")) entry.encrypted = true;
    }
    if (entry.path) into.push(entry);
    if (entry.kind === "folder") walk(file, path, into);
  }
}

/** @param {Source} source @param {string} name @param {{ label: string }} [kind] @returns {Promise<Archive>} */
export async function openXar(source, name, kind) {
  const head = await source.read(0, 28);
  if (!at(head, 0, "xar!") || head.length < 28) throw new Error(`${name} has no xar header.`);
  const headerSize = u16be(head, 4);
  const tocPacked = u64be(head, 8);
  const tocSize = u64be(head, 16);
  if (headerSize < 28 || headerSize + tocPacked > source.size || tocSize > 256 * 1024 * 1024)
    throw new Error(`The xar header of ${name} is damaged.`);
  const toc = await decode("zlib", await source.read(headerSize, tocPacked));
  const xar = parseXml(utf8(toc));
  const tocNode = child(xar, "toc");
  if (!tocNode) throw new Error(`The xar table of contents of ${name} has no files.`);
  /** @type {XarEntry[]} */
  const listed = [];
  walk(tocNode, "", listed);
  const heap = headerSize + tocPacked;
  const details = [];
  const created = tocDate(textOf(tocNode, "creation-time"));
  if (created) details.push(row("Created", created.toISOString().replace("T", " ").slice(0, 19)));
  const signature = child(tocNode, "signature") ?? child(tocNode, "x-signature");
  if (signature) details.push(row("Signature", signature.attrs.style ?? "yes"));
  return {
    format: kind?.label ?? "xar",
    entries: withFolders(listed),
    details,
    read: async (e, limit = Number.POSITIVE_INFINITY) => {
      const entry = /** @type {XarEntry} */ (e);
      if (entry.kind !== "file") return new Uint8Array(0);
      if (entry.refusal) throw new Error(entry.refusal);
      const slice = sliceSource(source, heap + (entry.offset ?? 0), entry.length ?? 0);
      if (!entry.codec) return slice.read(0, Math.min(slice.size, limit));
      return collect(decodeStream(entry.codec, inputFrom(slice)), limit);
    },
  };
}
