// One entry for every file: the format from the first bytes, then the extension; the reader for
// it; and, for a file that cannot be shown, the details view with one sentence saying why. Nothing
// a reader throws escapes: a parser error becomes that sentence.
import { readAbw } from "./abw/index.js";
import { decode, decodeText, inflate, pictureType, startsWith, startsWithText } from "./bytes.js";
import { Cfb, isCfb } from "./cfb.js";
import { readDoc } from "./doc/index.js";
import { FORMATS, formatName, noun } from "./formats.js";
import { readHwp } from "./hwp/index.js";
import { readHwpx } from "./hwpx/index.js";
import { DocError, ENCRYPTED } from "./model.js";
import { readOdfFlat, readOdfPackage } from "./odf/index.js";
import { readOoxml } from "./ooxml/index.js";
import { readGdoc, readPages } from "./package.js";
import { readRtf } from "./rtf/index.js";
import { readWpd } from "./text/wpd.js";
import { readWps } from "./text/wps.js";
import { isZip, Zip } from "./zip.js";

/** @typedef {import("./model.js").Opened} Opened */

const OOXML = ["docx", "docm", "dotx", "dotm"];

const extOf = (/** @type {string} */ path) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/**
 * @param {Uint8Array} bytes
 * @param {string} path
 * @returns {Promise<Opened>}
 */
export async function openDocument(bytes, path) {
  const ext = extOf(path);
  const state = { format: ext in FORMATS ? ext : "unknown" };
  try {
    return await read(bytes, ext, state);
  } catch (error) {
    const reason =
      error instanceof DocError
        ? error.message
        : "This file is damaged, or it is a variant Docs does not read.";
    return details(state.format, reason);
  }
}

/** @param {string} format @param {string} reason @returns {import("./model.js").Details} */
export const details = (format, reason) => ({
  kind: "details",
  format,
  formatName: formatName(format),
  reason,
});

/**
 * @param {Uint8Array} bytes
 * @param {string} ext
 * @param {{ format: string }} state
 * @returns {Promise<Opened>}
 */
async function read(bytes, ext, state) {
  const pick = (/** @type {string[]} */ family, /** @type {string} */ fallback) =>
    (state.format = family.includes(ext) ? ext : fallback);
  if (bytes.length === 0) throw new DocError("This file is empty.");
  if (isZip(bytes)) return readZip(new Zip(bytes), ext, state, pick);
  if (isCfb(bytes)) return readCompound(new Cfb(bytes), ext, state, pick);
  if (startsWithText(bytes, "{\\rtf")) return readRtf(bytes);
  if (startsWith(bytes, [0xff, 0x57, 0x50, 0x43])) {
    state.format = "wpd";
    return readWpd(bytes);
  }
  if (startsWith(bytes, [0x1f, 0x8b])) {
    const inner = await inflate(bytes, "gzip").catch(() => {
      throw new DocError("This file is damaged: it does not decompress.");
    });
    return readXml(decodeText(inner), state);
  }
  const head = decodeText(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith("<")) return readXml(decodeText(bytes), state);
  if (head.startsWith("{") && (ext === "gdoc" || /"doc_id"|"url"/.test(head))) {
    state.format = "gdoc";
    return readGdoc(decodeText(bytes));
  }
  if (ext === "wps") return readWps(null, bytes);
  throw new DocError(notThis(state.format, bytes));
}

/**
 * @param {Zip} zip
 * @param {string} ext
 * @param {{ format: string }} state
 * @param {(family: string[], fallback: string) => string} pick
 */
async function readZip(zip, ext, state, pick) {
  const mimetype = zip.has("mimetype") ? ((await zip.text("mimetype")) ?? "").trim() : "";
  if (zip.has("word/document.xml") || (zip.has("[Content_Types].xml") && OOXML.includes(ext)))
    return readOoxml(zip, pick(OOXML, "docx"));
  if (mimetype === "application/hwp+zip" || zip.has("Contents/header.xml")) {
    state.format = "hwpx";
    return readHwpx(zip);
  }
  if (
    mimetype.startsWith("application/vnd.oasis.opendocument") ||
    mimetype.startsWith("application/vnd.sun.xml") ||
    zip.has("content.xml")
  ) {
    const format = mimetype.includes("sun.xml")
      ? "sxw"
      : mimetype.endsWith("text-template")
        ? "ott"
        : mimetype === "" || mimetype.endsWith(".text") || mimetype.endsWith("text-master")
          ? pick(["odt", "ott", "sxw"], "odt")
          : "";
    if (!format)
      throw new DocError(`This OpenDocument package is not a text document (${mimetype}).`);
    state.format = format;
    return readOdfPackage(zip, format);
  }
  if (
    ext === "pages" ||
    zip.has("Index/Document.iwa") ||
    zip.names().some((n) => /^QuickLook\//.test(n))
  ) {
    state.format = "pages";
    return readPages(zip);
  }
  if (zip.has("[Content_Types].xml"))
    throw new DocError("This Office package is not a word-processing document.");
  throw new DocError(`This ZIP package holds no document Docs reads.`);
}

/**
 * @param {Cfb} cfb
 * @param {string} ext
 * @param {{ format: string }} state
 * @param {(family: string[], fallback: string) => string} pick
 */
function readCompound(cfb, _ext, state, pick) {
  if (cfb.has("EncryptedPackage") || cfb.has("EncryptionInfo")) throw new DocError(ENCRYPTED);
  if (cfb.has("WordDocument")) return readDoc(cfb, pick(["doc", "dot"], "doc"));
  if (cfb.has("FileHeader")) {
    state.format = "hwp";
    return readHwp(cfb);
  }
  if (cfb.has("CONTENTS") || cfb.has("MN0")) {
    state.format = "wps";
    return readWps(cfb, null);
  }
  if (cfb.has("Workbook") || cfb.has("Book"))
    throw new DocError("This compound file holds a spreadsheet, not a document.");
  if (cfb.has("PowerPoint Document"))
    throw new DocError("This compound file holds a presentation, not a document.");
  throw new DocError("This compound file holds no document Docs reads.");
}

/**
 * @param {string} text
 * @param {{ format: string }} state
 */
function readXml(text, state) {
  const root = /<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)[\s>/]/.exec(
    text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, ""),
  );
  const name = root?.[2] ?? "";
  if (name === "abiword" || name === "awml") {
    state.format = "abw";
    return readAbw(text);
  }
  if (name === "document" && /opendocument|openoffice/.test(text.slice(0, 4000))) {
    state.format = "fodt";
    return readOdfFlat(text, "fodt");
  }
  if (name === "html")
    throw new DocError(`This file is not ${noun(state.format)}: it is a web page.`);
  if (name === "package" || name === "wordDocument")
    throw new DocError(
      "Word XML documents (flat OPC and Word 2003 XML) are not read in this version.",
    );
  throw new DocError(`This file is not ${noun(state.format)}: it is an XML file.`);
}

/** Why bytes that are no document cannot be shown: what they look like instead. */
function notThis(/** @type {string} */ format, /** @type {Uint8Array} */ bytes) {
  const picture = pictureType(bytes);
  const what = picture
    ? `a ${picture.slice(6).toUpperCase()} image`
    : startsWithText(bytes, "%PDF")
      ? "a PDF document"
      : /^[\t\n\r\x20-\x7e -￿]*$/.test(decode(bytes.subarray(0, 256)))
        ? "plain text"
        : "";
  return `This file is not ${noun(format)}${what ? `: it looks like ${what}` : ""}.`;
}
