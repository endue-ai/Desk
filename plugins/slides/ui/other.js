// Presentations shown without slides: a Keynote package's preview image, and a Google Drive shortcut
// to a Google Slides presentation as a card with its URL.
import { imageUrl, utf8 } from "./bytes.js";

/** @typedef {import("./open.js").Opened} Opened */

export const KEYNOTE = "Keynote presentations show their preview image.";
const PREVIEWS = [
  "preview.jpg",
  "preview-web.jpg",
  "QuickLook/Preview.jpg",
  "QuickLook/Thumbnail.jpg",
  "preview-micro.jpg",
];

/** @param {import("./zip.js").Zip} zip @returns {Promise<Opened>} */
export async function keynotePreview(zip) {
  const format = "Keynote presentation";
  for (const name of PREVIEWS) {
    if (!zip.has(name)) continue;
    const url = imageUrl(await zip.bytes(name).catch(() => new Uint8Array()));
    if (url) return { kind: "preview", format, images: [url], sentence: KEYNOTE };
  }
  // Themes and some documents carry only slide thumbnails (Data/st-*.jpg).
  const thumbs = zip.names.filter((n) => /^Data\/st-[^/]*\.(jpe?g|png)$/i.test(n)).slice(0, 24);
  const images = [];
  for (const name of thumbs) {
    const url = imageUrl(await zip.bytes(name).catch(() => new Uint8Array()));
    if (url) images.push(url);
  }
  if (images.length) return { kind: "preview", format, images, sentence: KEYNOTE };
  return {
    kind: "details",
    format,
    reason: "This Keynote package has no preview image, and Keynote's own format is not read here.",
  };
}

/** A .gslides file: JSON with a url or a doc_id. @param {Uint8Array} bytes @returns {Opened} */
export function shortcutCard(bytes) {
  const format = "Google Slides shortcut";
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(utf8(bytes));
  } catch {
    return {
      kind: "details",
      format,
      reason: "This Google Drive shortcut is damaged: it is not JSON.",
    };
  }
  const { url, doc_id: docId } = /** @type {{ url?: unknown, doc_id?: unknown }} */ (data ?? {});
  const link =
    typeof url === "string" && url !== ""
      ? url
      : typeof docId === "string" && /^[\w-]+$/.test(docId)
        ? `https://docs.google.com/presentation/d/${docId}/edit`
        : "";
  if (!link)
    return { kind: "details", format, reason: "This Google Drive shortcut names no presentation." };
  return {
    kind: "card",
    format,
    url: link,
    sentence:
      "This file is a Google Drive shortcut: the presentation itself lives in Google Slides. Open the address below in a browser.",
  };
}
