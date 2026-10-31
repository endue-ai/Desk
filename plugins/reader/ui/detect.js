// Which reader opens a file: its first bytes decide, then its extension. A ZIP is looked into: an
// EPUB has its mimetype or container.xml, an XPS its FixedDocumentSequence, a CBZ images.
import { ascii, decode, extensionOf, indexOf, isImage } from "./formats/bytes.js";
import { is7z, isDjvu, rarVersion } from "./formats/describe.js";
import { isTar } from "./formats/tar.js";
import { isZip, readZip } from "./formats/zip.js";

/**
 * @typedef {"pdf" | "xps" | "epub" | "mobi" | "fb2" | "cbz" | "cbt" | "cbr" | "cb7" | "djvu" | "unknown"} Format
 * @typedef {{ format: Format, zip?: import("./formats/zip.js").Zip }} Detected
 */

/** @type {Record<string, Format>} */
const BY_EXTENSION = {
  pdf: "pdf",
  xps: "xps",
  oxps: "xps",
  epub: "epub",
  mobi: "mobi",
  azw: "mobi",
  azw3: "mobi",
  prc: "mobi",
  fb2: "fb2",
  cbz: "cbz",
  cbt: "cbt",
  cbr: "cbr",
  cb7: "cb7",
  djvu: "djvu",
  djv: "djvu",
};

/** The format a name says, for the details view of a file whose bytes say nothing. */
export const formatOfName = (/** @type {string} */ name) =>
  BY_EXTENSION[extensionOf(name)] ?? "unknown";

/** @param {Uint8Array} bytes @returns {boolean} */
const isPalmBook = (bytes) => {
  const id = ascii(bytes, 60, 8);
  return id === "BOOKMOBI" || id === "TEXtREAd" || id === "TEXtTlDc";
};

/** @param {Uint8Array} bytes @param {string} name @returns {Promise<Detected>} */
export async function detect(bytes, name) {
  const pdf = indexOf(bytes.subarray(0, 1024), "%PDF-");
  if (pdf >= 0) return { format: "pdf" };
  if (isZip(bytes)) {
    const zip = await readZip(bytes);
    const mimetype = zip.has("mimetype") ? (await zip.text("mimetype")).trim() : "";
    if (mimetype === "application/epub+zip" || zip.has("META-INF/container.xml"))
      return { format: "epub", zip };
    const xps = zip.names.some(
      (n) => /\.f(doc|page)$/i.test(n) || /fixeddocumentsequence|\.fdseq$/i.test(n),
    );
    if (xps) return { format: "xps", zip };
    if (zip.names.some(isImage)) return { format: "cbz", zip };
    const named = formatOfName(name);
    return { format: named === "epub" || named === "xps" ? named : "cbz", zip };
  }
  if (rarVersion(bytes)) return { format: "cbr" };
  if (is7z(bytes)) return { format: "cb7" };
  if (isDjvu(bytes)) return { format: "djvu" };
  if (isPalmBook(bytes)) return { format: "mobi" };
  if (isTar(bytes)) return { format: "cbt" };
  const head = decode(bytes.subarray(0, 4096));
  if (/<FictionBook[\s>]/.test(head)) return { format: "fb2" };
  return { format: formatOfName(name) };
}
