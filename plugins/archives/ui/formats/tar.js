// tar: ustar, GNU long names and links, PAX extended headers; a plain file read header by header
// (the data skipped by offset), or a tar inside a compressed stream read as it decodes.
import { field, text, unixDate } from "../bytes.js";
import { inputSeekable } from "../codecs/input.js";
import { cleanPath, withFolders } from "./archive.js";
import { streamedArchive } from "./streamed.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("../codecs/input.js").Input} Input */
/** @typedef {import("./streamed.js").Placed} Placed */

/** An octal field, or GNU's base-256 when its first byte has the high bit. @param {Uint8Array} b @param {number} o @param {number} n */
function number(b, o, n) {
  if ((b[o] ?? 0) & 0x80) {
    let v = (b[o] ?? 0) & 0x7f;
    for (let i = 1; i < n; i++) v = v * 256 + (b[o + i] ?? 0);
    return v;
  }
  const digits = field(b, o, n).trim();
  return digits ? Number.parseInt(digits, 8) : 0;
}

/** Whether the block's checksum field matches its bytes. @param {Uint8Array} b */
function checked(b) {
  const stored = number(b, 148, 8);
  let sum = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const c = i >= 148 && i < 156 ? 32 : (b[i] ?? 0);
    sum += c;
    signed += c > 127 ? c - 256 : c;
  }
  return stored === sum || stored === signed;
}

/** Whether `head` starts with a tar header. @param {Uint8Array} head */
export function isTar(head) {
  if (head.length < 512 || head[0] === 0) return false;
  if (!checked(head)) return false;
  const magic = field(head, 257, 6);
  return (
    magic === "ustar" ||
    magic.startsWith("ustar") ||
    /^[0-7 ]+\0?$/.test(field(head, 100, 8) || "0")
  );
}

/** PAX records: "<length> <key>=<value>\n". @param {Uint8Array} data @param {Record<string, string>} into */
function pax(data, into) {
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number.parseInt(text(data.subarray(at, space)), 10);
    if (!(length > 0)) break;
    const record = text(data.subarray(space + 1, at + length - 1));
    const equals = record.indexOf("=");
    if (equals > 0) into[record.slice(0, equals)] = record.slice(equals + 1);
    at += length;
  }
}

/**
 * Every entry in stream order: a generator that, after each yield, skips the data the reader left.
 * @param {Input} input
 * @returns {AsyncGenerator<Placed>}
 */
export async function* tarRecords(input) {
  /** @type {Record<string, string>} */
  let extended = {};
  /** @type {Record<string, string>} */
  const global = {};
  let longName = "";
  let longLink = "";
  for (;;) {
    if (!(await input.need(512))) return;
    const at = input.offset;
    const head = input.take(512).slice();
    if (head.every((b) => b === 0)) return;
    if (!checked(head)) throw new Error(`The tar header at byte ${at} is damaged.`);
    const type = String.fromCharCode(head[156] ?? 0);
    let size = number(head, 124, 12);
    const start = input.offset;
    const end = start + Math.ceil(size / 512) * 512;
    if ("LKxgX".includes(type) && type !== "") {
      const data = await input.read(size);
      if (type === "L") longName = field(data, 0, data.length);
      else if (type === "K") longLink = field(data, 0, data.length);
      else if (type === "g") pax(data, global);
      else pax(data, extended);
    } else {
      const ustar = field(head, 257, 6) === "ustar" && head[262] === 0;
      const prefix = ustar ? field(head, 345, 155) : "";
      const all = { ...global, ...extended };
      const raw =
        all.path ??
        (longName || (prefix ? `${prefix}/${field(head, 0, 100)}` : field(head, 0, 100)));
      const target = all.linkpath ?? (longLink || field(head, 157, 100));
      if (all.size) size = Number(all.size);
      const mtime = all.mtime ? Number(all.mtime) : number(head, 136, 12);
      const folder = type === "5" || (type !== "2" && type !== "1" && raw.endsWith("/"));
      const link = type === "1" || type === "2";
      /** @type {Placed} */
      const entry = {
        path: cleanPath(raw),
        kind: folder ? "folder" : link ? "link" : "file",
        size: folder || link ? 0 : size,
        date: unixDate(Math.floor(mtime)),
        start,
      };
      if (link) entry.link = target;
      if (type === "S") entry.refusal = "Sparse tar entries are not read.";
      if ("346".includes(type) && type !== "") entry.refusal = "Devices and pipes hold no data.";
      extended = {};
      longName = "";
      longLink = "";
      if (entry.path) yield entry;
      // a PAX size wins over the header's, for both the data and the skip
      const skip = start + Math.ceil(size / 512) * 512 - input.offset;
      if (skip > 0) await input.skip(skip);
      continue;
    }
    const skip = end - input.offset;
    if (skip > 0) await input.skip(skip);
  }
}

/**
 * A tar inside a stream: `open` makes a fresh decoded input from the start.
 * @param {() => Input} open @param {string} format
 */
export const openTarIn = (open, format) => streamedArchive(format, open, tarRecords, withFolders);

/** A plain tar file, header by header. @param {Source} source @param {string} _name @param {{ label: string }} [kind] */
export const openTar = (source, _name, kind) =>
  openTarIn(() => inputSeekable(source), kind?.label ?? "tar");
