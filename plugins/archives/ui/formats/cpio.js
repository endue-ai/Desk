// cpio: the "new" ASCII format (070701, 070702, RPM's payload) and the old portable one (070707,
// macOS installer payloads), read from a stream as it decodes.
import { latin1, text, unixDate } from "../bytes.js";
import { inputSeekable } from "../codecs/input.js";
import { cleanPath, withFolders } from "./archive.js";
import { streamedArchive } from "./streamed.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("../codecs/input.js").Input} Input */
/** @typedef {import("./streamed.js").Placed} Placed */

/** Whether `head` starts with a cpio header. @param {Uint8Array} head */
export const isCpio = (head) => /^07070[127]$/.test(latin1(head.subarray(0, 6)));

const S_IFMT = 0o170000;

/**
 * @param {Input} input
 * @returns {AsyncGenerator<Placed>}
 */
export async function* cpioRecords(input) {
  for (;;) {
    if (!(await input.need(6))) return;
    const at = input.offset;
    const magic = latin1(input.take(6));
    const odc = magic === "070707";
    if (!odc && magic !== "070701" && magic !== "070702")
      throw new Error(`The cpio header at byte ${at} is damaged.`);
    const head = latin1(await input.read(odc ? 70 : 104));
    const hex = (/** @type {number} */ i) => Number.parseInt(head.slice(i * 8, i * 8 + 8), 16);
    const oct = (/** @type {number} */ o, /** @type {number} */ n) =>
      Number.parseInt(head.slice(o, o + n), 8);
    const mode = odc ? oct(12, 6) : hex(1);
    const mtime = odc ? oct(42, 11) : hex(5);
    const size = odc ? oct(59, 11) : hex(6);
    const nameSize = odc ? oct(53, 6) : hex(11);
    if (![mode, mtime, size, nameSize].every(Number.isFinite))
      throw new Error(`The cpio header at byte ${at} is damaged.`);
    const name = text((await input.read(nameSize)).subarray(0, nameSize - 1));
    if (!odc) await input.skip((4 - ((input.offset - at) % 4)) % 4);
    if (name === "TRAILER!!!") return;
    const start = input.offset;
    const type = mode & S_IFMT;
    /** @type {Placed} */
    const entry = {
      path: cleanPath(name, { relative: true }),
      kind: type === 0o040000 ? "folder" : type === 0o120000 ? "link" : "file",
      size: type === 0o100000 ? size : 0,
      date: unixDate(mtime),
      start,
    };
    if (entry.kind === "link") entry.link = text(await input.read(size));
    if (entry.path) yield entry;
    const skip = start + size - input.offset + (odc ? 0 : (4 - (size % 4)) % 4);
    if (skip > 0) await input.skip(skip);
  }
}

/** A cpio inside a stream. @param {() => Input} open @param {string} format */
export const openCpioIn = (open, format) => streamedArchive(format, open, cpioRecords, withFolders);

/** A plain cpio file. @param {Source} source @param {string} [format] */
export const openCpio = (source, format = "cpio") =>
  openCpioIn(() => inputSeekable(source), format);
