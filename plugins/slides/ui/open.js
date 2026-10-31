// Opens a file's bytes: picks the format from the first bytes, then the extension, and hands the file
// to its reader. Whatever happens the answer is something to show: a deck, a Keynote preview, a
// Google Slides card, or the details view with one sentence saying why.
import { utf8 } from "./bytes.js";
import { isCfb, readCfb } from "./cfb.js";
import { readOdp, readOdpZip } from "./odp/read.js";
import { keynotePreview, shortcutCard } from "./other.js";
import { EncryptedError, readPpt } from "./ppt/read.js";
import { readPptx } from "./pptx/read.js";
import { parseXml } from "./xml.js";
import { isZip, readZip } from "./zip.js";

/**
 * @typedef {import("./deck.js").Deck} Deck
 * @typedef {{ kind: "deck", format: string, deck: Deck }
 *   | { kind: "details", format: string, reason: string }
 *   | { kind: "card", format: string, url: string, sentence: string }
 *   | { kind: "preview", format: string, images: string[], sentence: string }} Opened
 */

const FORMATS = /** @type {Record<string, string>} */ ({
  pptx: "PowerPoint presentation",
  pptm: "PowerPoint presentation with macros",
  ppsx: "PowerPoint slide show",
  ppsm: "PowerPoint slide show with macros",
  potx: "PowerPoint template",
  potm: "PowerPoint template with macros",
  ppt: "PowerPoint 97-2003 presentation",
  pps: "PowerPoint 97-2003 slide show",
  pot: "PowerPoint 97-2003 template",
  odp: "OpenDocument presentation",
  otp: "OpenDocument presentation template",
  fodp: "Flat OpenDocument presentation",
  key: "Keynote presentation",
  gslides: "Google Slides shortcut",
});

export const ENCRYPTED = "This presentation is encrypted.";

const extensionOf = (/** @type {string} */ name) => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/** The format's name for an extension, with a fallback for the family the bytes showed. */
const formatFor = (
  /** @type {string} */ ext,
  /** @type {string[]} */ family,
  /** @type {string} */ fallback,
) => (family.includes(ext) ? (FORMATS[ext] ?? fallback) : fallback);

const why = (/** @type {unknown} */ error) => {
  const message = error instanceof Error ? error.message : String(error);
  return `The file is damaged and cannot be shown (${message}).`;
};

/** @param {string} format @param {string} reason @returns {Opened} */
const details = (format, reason) => ({ kind: "details", format, reason });

/** A deck to show, or the details view when it has no slides. @param {string} format @param {Deck} deck @returns {Opened} */
const deckOrEmpty = (format, deck) =>
  deck.slides.length
    ? { kind: "deck", format, deck }
    : details(format, "This presentation has no slides.");

/**
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {Promise<Opened>}
 */
export async function openFile(bytes, name) {
  const ext = extensionOf(name);
  if (bytes.length === 0) return details(FORMATS[ext] ?? "Empty file", "The file is empty.");
  try {
    if (isZip(bytes)) return await openZip(bytes, ext);
    if (isCfb(bytes)) return openCompound(bytes, ext);
    const head = utf8(bytes.subarray(0, 2048)).replace(/^﻿/, "").trimStart();
    if (head.startsWith("{") || ext === "gslides") return shortcutCard(bytes);
    if (head.startsWith("<")) return await openXml(bytes, ext);
  } catch (error) {
    return details(FORMATS[ext] ?? "Unknown format", why(error));
  }
  return details(
    FORMATS[ext] ?? "Unknown format",
    "This file is not a presentation Slides can read.",
  );
}

/** @param {Uint8Array} bytes @param {string} ext @returns {Promise<Opened>} */
async function openZip(bytes, ext) {
  let zip;
  try {
    zip = readZip(bytes);
  } catch (error) {
    return details(
      "ZIP archive",
      `The file is damaged: ${error instanceof Error ? error.message : error}.`,
    );
  }
  if (
    zip.has("ppt/presentation.xml") ||
    (zip.has("[Content_Types].xml") && zip.names.some((n) => /^ppt\//i.test(n)))
  ) {
    const format = formatFor(
      ext,
      ["pptx", "pptm", "ppsx", "ppsm", "potx", "potm"],
      "PowerPoint presentation",
    );
    try {
      return deckOrEmpty(format, await readPptx(zip, format));
    } catch (error) {
      return details(format, why(error));
    }
  }
  const mimetype = zip.has("mimetype") ? (await zip.text("mimetype").catch(() => "")).trim() : "";
  if (
    mimetype.startsWith("application/vnd.oasis.opendocument.presentation") ||
    zip.has("content.xml")
  ) {
    const format = mimetype.endsWith("-template")
      ? (FORMATS.otp ?? "")
      : formatFor(ext, ["odp", "otp"], "OpenDocument presentation");
    if (!mimetype.includes("presentation") && mimetype !== "")
      return details("OpenDocument file", "This OpenDocument file is not a presentation.");
    try {
      const manifest = zip.has("META-INF/manifest.xml")
        ? await zip.text("META-INF/manifest.xml")
        : "";
      if (
        manifest.includes("encryption-data") ||
        (zip.has("content.xml") && zip.encrypted("content.xml"))
      )
        return details(format, ENCRYPTED);
      return deckOrEmpty(format, await readOdpZip(zip, format));
    } catch (error) {
      return details(format, why(error));
    }
  }
  const keynote = ["Index/Document.iwa", "index.apxl", "index.apxl.gz", "Index.zip", "preview.jpg"];
  if (keynote.some((n) => zip.has(n)) || ext === "key") return keynotePreview(zip);
  return details("ZIP archive", "This ZIP archive holds no presentation.");
}

/** @param {Uint8Array} bytes @param {string} ext @returns {Opened} */
function openCompound(bytes, ext) {
  let cfb;
  try {
    cfb = readCfb(bytes);
  } catch (error) {
    return details(
      "Compound file",
      `The file is damaged: ${error instanceof Error ? error.message : error}.`,
    );
  }
  if (cfb.has("EncryptionInfo") || cfb.has("EncryptedPackage"))
    return details("Encrypted Office document", ENCRYPTED);
  if (!cfb.has("PowerPoint Document"))
    return details("Compound file", "This compound file holds no PowerPoint presentation.");
  const format = formatFor(ext, ["ppt", "pps", "pot"], FORMATS.ppt ?? "");
  try {
    return deckOrEmpty(format, readPpt(cfb, format));
  } catch (error) {
    if (error instanceof EncryptedError) return details(format, ENCRYPTED);
    return details(format, why(error));
  }
}

/** A flat ODF presentation (.fodp). @param {Uint8Array} bytes @param {string} ext @returns {Promise<Opened>} */
async function openXml(bytes, ext) {
  const root = parseXml(utf8(bytes));
  const presentation = root.getElementsByTagNameNS("*", "presentation")[0];
  if (root.localName !== "document" || !presentation)
    return details(
      FORMATS[ext] ?? "XML document",
      "This XML file is not an OpenDocument presentation.",
    );
  const format = FORMATS.fodp ?? "";
  return deckOrEmpty(format, await readOdp({ content: root, styles: root, files: null }, format));
}
