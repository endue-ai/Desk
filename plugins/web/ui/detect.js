// Which format a file is: from its first bytes, then its extension.
import { latin1, startsWith } from "./bytes.js";

/**
 * @typedef {"html" | "xhtml" | "mhtml" | "webarchive" | "warc" | "warc.gz" | "maff" | "url" |
 *   "webloc" | "desktop" | "lnk" | "rss" | "atom" | "opml" | "plist" | "gzip" | "zip" | "unknown"} Format
 */

/** What each format is called on the surface. */
export const LABELS = /** @type {Record<Format, string>} */ ({
  html: "HTML page",
  xhtml: "XHTML page",
  mhtml: "MHTML archive",
  webarchive: "Safari web archive",
  warc: "WARC archive",
  "warc.gz": "Compressed WARC archive",
  maff: "MAFF archive",
  url: "Internet shortcut",
  webloc: "Website location",
  desktop: "Desktop entry",
  lnk: "Windows shortcut",
  rss: "RSS feed",
  atom: "Atom feed",
  opml: "OPML outline",
  plist: "Property list",
  gzip: "gzip data",
  zip: "ZIP archive",
  unknown: "Unknown format",
});

const EXTENSIONS = /** @type {Record<string, Format>} */ ({
  html: "html",
  htm: "html",
  shtml: "html",
  xhtml: "xhtml",
  xht: "xhtml",
  mhtml: "mhtml",
  mht: "mhtml",
  webarchive: "webarchive",
  warc: "warc",
  maff: "maff",
  url: "url",
  webloc: "webloc",
  desktop: "desktop",
  lnk: "lnk",
  rss: "rss",
  atom: "atom",
  opml: "opml",
});

/** The format the name says. */
export function byExtension(/** @type {string} */ path) {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name.endsWith(".warc.gz")) return "warc.gz";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return EXTENSIONS[ext] ?? "unknown";
}

/** The root element of markup, past the XML declaration, comments and the doctype. */
function rootElement(/** @type {string} */ head) {
  const rest = head.replace(
    /^(\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>)*/i,
    "",
  );
  return /^<([A-Za-z][\w:.-]*)/.exec(rest)?.[1];
}

/**
 * @param {Uint8Array} bytes
 * @param {string} path
 * @returns {Format}
 */
export function detect(bytes, path) {
  const named = byExtension(path);
  if (startsWith(bytes, "bplist00"))
    return named === "webloc" || named === "webarchive" ? named : "plist";
  if (bytes[0] === 0x1f && bytes[1] === 0x8b)
    return named === "warc" || named === "warc.gz" || named === "unknown" ? "warc.gz" : "gzip";
  if (startsWith(bytes, "PK\x03\x04") || startsWith(bytes, "PK\x05\x06"))
    return named === "maff" ? "maff" : "zip";
  if (startsWith(bytes, "L\0\0\0\x01\x14\x02\0")) return "lnk";
  if (startsWith(bytes, "WARC/")) return "warc";
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const utf16 =
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  const head = utf16
    ? new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes.subarray(2, 8192))
    : latin1(bytes, start, Math.min(bytes.length, 8192));
  const trimmed = head.trimStart();
  if (/^\[InternetShortcut\]|^\[\{000214A0-/i.test(trimmed)) return "url";
  if (/^(#[^\n]*\n\s*)*\[Desktop Entry\]/.test(trimmed)) return "desktop";
  const headers = trimmed.split(/\r?\n\r?\n/, 1)[0] ?? "";
  if (
    /^[A-Za-z-]+:/.test(trimmed) &&
    /^content-type:\s*multipart\/related/im.test(headers.replace(/\r?\n[ \t]+/g, " "))
  )
    return "mhtml";
  if (trimmed.startsWith("<")) {
    const root = rootElement(trimmed)?.toLowerCase();
    if (root === "rss" || root === "rdf:rdf" || root === "rdf") return "rss";
    if (root === "feed") return "atom";
    if (root === "opml") return "opml";
    if (root === "plist")
      return named === "webarchive" ? "webarchive" : named === "webloc" ? "webloc" : "plist";
    if (named === "xhtml") return "xhtml";
    if (root === "html" || /^<!doctype html/i.test(trimmed)) return "html";
    if (named !== "unknown") return named;
    return "html";
  }
  return named;
}
