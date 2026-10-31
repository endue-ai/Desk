// Microsoft Works (.wps), text only and best effort: Works 5 to 9 keep UTF-16 text in TEXT chunks
// that the CONTENTS stream's index points to; Works 3 and 4 keep 8-bit text in the MN0 stream after
// a 256-byte header; older DOS files are scanned for their printable text.
import { decode, Reader, startsWithText } from "../bytes.js";
import { DocError, documentOf, paragraphsOf, section } from "../model.js";

/** Text without the control characters (other than tab and line ends) Works leaves in it. */
const printableOnly = (/** @type {string} */ text) =>
  Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13 ? "" : ch;
  }).join("");

/**
 * @param {import("../cfb.js").Cfb | null} cfb
 * @param {Uint8Array | null} raw a Works file that is no compound file
 */
export function readWps(cfb, raw) {
  const text = cfb ? fromCompound(cfb) : printable(raw ?? new Uint8Array(0));
  const clean = printableOnly(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) throw new DocError("Docs found no text in this Works document.");
  return documentOf({
    format: "wps",
    formatName: "Microsoft Works document",
    textOnly: true,
    sections: [section({ blocks: paragraphsOf(clean) })],
  });
}

/** @param {import("../cfb.js").Cfb} cfb */
function fromCompound(cfb) {
  const contents = cfb.read("CONTENTS");
  if (contents && startsWithText(contents, "CHNK")) {
    const r = new Reader(contents);
    let out = "";
    // "CHNKWKS " and a 24-byte header, then 24-byte entries: flags, name, id, count, name, offset, length.
    for (let at = 32; at + 24 <= Math.min(contents.length, 0x200); at += 24) {
      if (!startsWithText(contents, "TEXT", at + 2)) continue;
      const offset = r.u32(at + 16);
      const length = r.u32(at + 20);
      out += decode(contents.subarray(offset, offset + length), "utf-16le");
    }
    if (out) return out;
  }
  const mn0 = cfb.read("MN0");
  if (mn0) {
    const body = mn0.subarray(0x100);
    const end = body.indexOf(0);
    return decode(end < 0 ? body : body.subarray(0, end), "windows-1252");
  }
  if (contents) return printable(contents);
  throw new DocError("This Works document is a variant Docs does not read.");
}

/** Runs of printable text (four characters or more), for files whose layout is unknown. */
function printable(/** @type {Uint8Array} */ bytes) {
  const text = decode(bytes, "windows-1252");
  return (text.match(/[\x20-\x7e -ÿ\r\n\t]{4,}/g) ?? []).join("\n");
}
