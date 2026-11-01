// A file's bytes as the model the view draws: a page, a list of entries (feeds, WARC records,
// MAFF pages), a link card, an outline (OPML), or the details of a file Web cannot show.
import { openMaff, openMhtml, openWebarchive } from "./archive.js";
import { decodeText } from "./bytes.js";
import { byExtension, detect, LABELS } from "./detect.js";
import { readFeed, readOpml } from "./feeds.js";
import { localPath, readDesktopEntry, readLnk, readUrlFile, readWebloc } from "./links.js";
import { readPlist } from "./plist.js";
import { openWarc } from "./warc.js";

/**
 * Where a page's resources come from. `load` takes an absolute URL and answers its bytes, or
 * "remote" (never fetched: Web does not reach the network) or "missing".
 * @typedef {{ bytes: Uint8Array, type?: string }} Loaded
 * `local` is the path of a page read from disk, whose resolver reads the files around it.
 * @typedef {{ base: string, local?: string, load(url: string): Promise<Loaded | "remote" | "missing"> }} Resolver
 * @typedef {{ text: string, mime: string, resolver: Resolver }} PageInput
 * @typedef {{ title: string, detail?: string, date?: string, author?: string, link?: string,
 *   page?: PageInput, text?: string, source?: string }} Entry
 * @typedef {{ title: string, url?: string, path?: string, fields: Array<[string, string]> }} Card
 * @typedef {{ text: string, feed?: string, page?: string, children: Outline[] }} Outline
 * @typedef {{ kind: "page", format: string, page: PageInput, source?: string }
 *   | { kind: "entries", format: string, title?: string, label: string, entries: Entry[], selected: number, source?: string }
 *   | ({ kind: "card", format: string, source?: string } & Card)
 *   | { kind: "outline", format: string, title?: string, outlines: Outline[], source?: string }
 *   | { kind: "details", format: string, reason: string }} Model
 * @typedef {{ read(path: string): Promise<Uint8Array | null> }} Disk
 */

/** A file: URL for a desk path (`~/x` or `/x`), so a page's relative references resolve. */
export function fileUrl(/** @type {string} */ path) {
  const rooted = path.startsWith("/") ? path : `/${path}`;
  return `file://${rooted
    .split("/")
    .map((part) => (part === "~" ? part : encodeURIComponent(part)))
    .join("/")}`;
}

/**
 * A resolver over the disk around a page: file: URLs are read with `disk.read`; http(s), and
 * file: URLs on another host (what `//cdn.example.com/x` becomes next to a saved page), are
 * remote; anything else is missing.
 * @param {string} path @param {Disk} disk @returns {Resolver}
 */
export function diskResolver(path, disk) {
  return {
    base: fileUrl(path),
    local: path,
    load: async (url) => {
      if (/^(https?|ftp):/i.test(url) || /^file:\/\/(?!\/|localhost\/)/i.test(url)) return "remote";
      const local = localPath(url);
      const bytes = local ? await disk.read(local).catch(() => null) : null;
      return bytes ? { bytes } : "missing";
    },
  };
}

/** The text of a text file, for the source view. */
const sourceOf = (/** @type {Uint8Array} */ bytes) => decodeText(bytes).text;

/**
 * @param {Uint8Array} bytes
 * @param {string} path
 * @param {Disk} disk
 * @returns {Promise<Model>}
 */
export async function openFile(bytes, path, disk) {
  const found = detect(bytes, path);
  const format = LABELS[found];
  try {
    return await open(found, bytes, path, disk);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "details", format, reason: /[.!?]$/.test(reason) ? reason : `${reason}.` };
  }
}

/** @param {import("./detect.js").Format} found @param {Uint8Array} bytes @param {string} path @param {Disk} disk @returns {Promise<Model>} */
async function open(found, bytes, path, disk) {
  const format = LABELS[found];
  switch (found) {
    case "html":
    case "xhtml": {
      const { text } = decodeText(bytes);
      const mime = found === "xhtml" ? "application/xhtml+xml" : "text/html";
      return {
        kind: "page",
        format,
        page: { text, mime, resolver: diskResolver(path, disk) },
        source: text,
      };
    }
    case "mhtml":
      return { kind: "page", format, ...openMhtml(bytes) };
    case "webarchive":
      return { kind: "page", format, ...openWebarchive(bytes) };
    case "warc":
    case "warc.gz":
      return { kind: "entries", format, label: "Records", ...openWarc(bytes, found === "warc.gz") };
    case "maff": {
      const pages = openMaff(bytes);
      const only = pages.length === 1 ? pages[0] : undefined;
      if (only?.page) return { kind: "page", format, page: only.page, source: only.source };
      return { kind: "entries", format, label: "Pages", entries: pages, selected: 0 };
    }
    case "url":
      return { kind: "card", format, ...readUrlFile(bytes, path), source: sourceOf(bytes) };
    case "webloc": {
      const text = bytes[0] === 0x62 ? undefined : sourceOf(bytes);
      return {
        kind: "card",
        format,
        ...readWebloc(bytes, path),
        ...(text ? { source: text } : {}),
      };
    }
    case "desktop":
      return { kind: "card", format, ...readDesktopEntry(bytes, path), source: sourceOf(bytes) };
    case "lnk":
      return { kind: "card", format, ...readLnk(bytes, path) };
    case "rss":
    case "atom": {
      const source = sourceOf(bytes);
      const feed = readFeed(source);
      const label = found === "rss" ? "Items" : "Entries";
      return { kind: "entries", format, label, ...feed, selected: 0, source };
    }
    case "opml": {
      const source = sourceOf(bytes);
      return { kind: "outline", format, ...readOpml(source), source };
    }
    case "plist": {
      // A property list under another name: a web archive or a website location by its keys.
      const value = readPlist(bytes);
      if (value && typeof value === "object" && "WebMainResource" in value)
        return { kind: "page", format: LABELS.webarchive, ...openWebarchive(bytes) };
      if (value && typeof value === "object" && "URL" in value)
        return { kind: "card", format: LABELS.webloc, ...readWebloc(bytes, path) };
      throw new Error("The property list is neither a web archive nor a website location.");
    }
    case "gzip":
      throw new Error("The file is gzip-compressed, and only a compressed WARC opens here.");
    case "zip":
      throw new Error(
        `The file is a ZIP archive, not the ${LABELS[byExtension(path)]} its name says.`,
      );
    default:
      throw new Error("Web does not recognise this file's format.");
  }
}
