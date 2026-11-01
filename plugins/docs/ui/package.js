// The two files that open as something other than pages: a Pages package shows the largest preview
// image it carries (its IWA content is not read), and a .gdoc is a Google Drive shortcut card.
import { pictureUrl } from "./bytes.js";
import { DocError, ENCRYPTED } from "./model.js";

const PREVIEW = /(^|\/)(preview[^/]*|thumbnail[^/]*)\.(jpe?g|png|tiff?)$/i;

/**
 * @param {import("./zip.js").Zip} zip
 * @returns {Promise<import("./model.js").Details>}
 */
export async function readPages(zip) {
  const names = zip.names();
  const candidates = names
    .filter((n) => PREVIEW.test(n))
    .sort((a, b) => (zip.entry(b)?.size ?? 0) - (zip.entry(a)?.size ?? 0));
  for (const name of candidates) {
    const bytes = await zip.read(name).catch(() => undefined);
    const src = bytes ? pictureUrl(bytes) : null;
    if (src)
      return {
        kind: "details",
        format: "pages",
        formatName: "Pages document",
        reason: "Pages documents show their preview image.",
        preview: { src, alt: "The document's preview image" },
      };
  }
  if (names.some((n) => /\.iwp[hv]/.test(n))) throw new DocError(ENCRYPTED);
  if (zip.has("index.xml")) {
    const head = (await zip.read("index.xml").catch(() => undefined))?.subarray(0, 8);
    if (head && head[0] !== 0x3c && head[0] !== 0x1f && head[0] !== 0xef)
      throw new DocError(ENCRYPTED);
  }
  throw new DocError("This Pages document holds no preview image.");
}

/**
 * A Google Drive shortcut: JSON with the document's URL (older Drive) or only its id (Drive for
 * desktop). The card shows the address as selectable text, never as a link that navigates.
 * @param {string} text
 * @returns {import("./model.js").Details}
 */
export function readGdoc(text) {
  /** @type {Record<string, unknown>} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DocError("This Google Drive shortcut is damaged: it is not JSON.");
  }
  const id = typeof json.doc_id === "string" ? json.doc_id : "";
  const given = typeof json.url === "string" && /^https:\/\//.test(json.url) ? json.url : "";
  const url = given || (/^[\w-]+$/.test(id) ? `https://docs.google.com/document/d/${id}/edit` : "");
  if (!url) throw new DocError("This Google Drive shortcut names no document.");
  return {
    kind: "details",
    format: "gdoc",
    formatName: "Google Docs shortcut",
    reason: "This is a Google Drive shortcut: the document itself lives in Google Docs.",
    url,
  };
}
