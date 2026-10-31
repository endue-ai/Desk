// Pages inside archives: a resolver over the archive's resources by URL, and Safari's .webarchive,
// MHTML and MAFF read into page models. Their resources resolve inside the archive; anything
// else on http(s) is remote and left out.
import { charsetOf, decodeText, imageType } from "./bytes.js";
import { isoDate, parameter, readMultipart, typeOf } from "./mime.js";
import { readPlist } from "./plist.js";
import { readZip } from "./zip.js";

/**
 * @typedef {import("./formats.js").PageInput} PageInput
 * @typedef {import("./formats.js").Resolver} Resolver
 * @typedef {{ bytes?: Uint8Array, read?: () => Uint8Array, type?: string }} Stored
 */

/** A URL without its fragment, in the URL parser's own spelling; undefined when it is not one. */
export function urlKey(/** @type {string} */ url, /** @type {string} */ base = "") {
  try {
    const parsed = base ? new URL(url, base) : new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
}

/**
 * A resolver over an archive's resources, by URL (and `cid:` for MHTML's Content-IDs).
 * @param {string} base
 * @param {Map<string, Stored>} stored keys made by urlKey
 * @returns {Resolver}
 */
export function archiveResolver(base, stored) {
  return {
    base,
    load: async (url) => {
      const key = urlKey(url);
      const found = key === undefined ? undefined : stored.get(key);
      if (found) {
        const bytes = found.bytes ?? found.read?.();
        if (bytes) return { bytes, type: found.type };
      }
      return /^(https?|ftp):/i.test(url) ? "remote" : "missing";
    },
  };
}

const escapeHtml = (/** @type {string} */ text) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The page for an archive's main resource: HTML as it is, an image or text inside a small page.
 * @param {Uint8Array} bytes @param {string} type @param {string} url @param {Resolver} resolver
 * @param {string} [charset]
 * @returns {PageInput}
 */
export function pageOf(bytes, type, url, resolver, charset) {
  const kind = typeOf(type);
  if (kind === "application/xhtml+xml" || kind === "text/html" || kind === "") {
    const { text } = decodeText(bytes, { declared: charset });
    return { text, mime: kind === "application/xhtml+xml" ? kind : "text/html", resolver };
  }
  if (imageType(bytes, type, url))
    return { text: `<img src="${escapeHtml(url)}" alt="">`, mime: "text/html", resolver };
  const { text } = decodeText(bytes, { declared: charset, sniff: false });
  return { text: `<pre>${escapeHtml(text)}</pre>`, mime: "text/html", resolver };
}

const asDict = (/** @type {unknown} */ value) =>
  value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array)
    ? /** @type {Record<string, unknown>} */ (value)
    : undefined;
const asText = (/** @type {unknown} */ value) => (typeof value === "string" ? value : undefined);

/** Safari's .webarchive: WebMainResource and WebSubresources, by WebResourceURL. */
export function openWebarchive(/** @type {Uint8Array} */ bytes) {
  const root = asDict(readPlist(bytes));
  const main = asDict(root?.WebMainResource);
  const data = main?.WebResourceData;
  if (!main || !(data instanceof Uint8Array))
    throw new Error("The web archive has no main resource.");
  const url = asText(main.WebResourceURL) || "http://archive.invalid/";
  /** @type {Map<string, Stored>} */
  const stored = new Map();
  const add = (/** @type {Record<string, unknown> | undefined} */ resource) => {
    const key = urlKey(asText(resource?.WebResourceURL) ?? "");
    const resourceData = resource?.WebResourceData;
    if (key && resourceData instanceof Uint8Array && !stored.has(key))
      stored.set(key, { bytes: resourceData, type: asText(resource?.WebResourceMIMEType) });
  };
  add(main);
  const subresources = Array.isArray(root?.WebSubresources) ? root.WebSubresources : [];
  for (const resource of subresources) add(asDict(resource));
  const type = asText(main.WebResourceMIMEType) ?? "text/html";
  const page = pageOf(
    data,
    type,
    url,
    archiveResolver(url, stored),
    asText(main.WebResourceTextEncodingName),
  );
  return { page, source: page.text };
}

/** MHTML: the root part (the `start` parameter, else the first HTML part) and the rest by URL. */
export function openMhtml(/** @type {Uint8Array} */ bytes) {
  const { headers, parts } = readMultipart(bytes);
  const type = headers.get("content-type");
  const bare = (/** @type {string | undefined} */ id) => id?.trim().replace(/^<(.*)>$/, "$1");
  const start = bare(parameter(type, "start"));
  const id = (/** @type {Map<string, string>} */ h) => bare(h.get("content-id"));
  const main =
    parts.find((part) => start && id(part.headers) === start) ??
    parts.find((part) =>
      /^(text\/html|application\/xhtml\+xml)$/.test(typeOf(part.headers.get("content-type"))),
    ) ??
    parts[0];
  if (!main) throw new Error("The archive holds no parts.");
  const top = headers.get("snapshot-content-location") ?? headers.get("content-location");
  const base =
    urlKey(main.headers.get("content-location") ?? "", top ?? "http://archive.invalid/") ??
    "http://archive.invalid/";
  /** @type {Map<string, Stored>} */
  const stored = new Map();
  for (const part of parts) {
    const resource = { bytes: part.body, type: part.headers.get("content-type") };
    const location = part.headers.get("content-location");
    const key = location ? urlKey(location, base) : undefined;
    if (key && !stored.has(key)) stored.set(key, resource);
    const cid = id(part.headers);
    if (cid) stored.set(`cid:${cid}`, resource);
  }
  const mainType = main.headers.get("content-type") ?? "text/html";
  const page = pageOf(
    main.body,
    mainType,
    base,
    archiveResolver(base, stored),
    charsetOf(mainType),
  );
  return { page, source: page.text };
}

const INDEX = /^index\.(html?|xhtml|xht|shtml|svg|txt)$/i;

/** MAFF: a ZIP with one folder per page, each with its index file and an optional index.rdf. */
export function openMaff(/** @type {Uint8Array} */ bytes) {
  const entries = readZip(bytes);
  /** @type {Map<string, Stored>} */
  const stored = new Map();
  /** @type {Map<string, Map<string, import("./zip.js").ZipEntry>>} */
  const folders = new Map();
  for (const entry of entries) {
    const slash = entry.name.indexOf("/");
    if (slash <= 0 || entry.name.endsWith("/")) continue;
    const folder = entry.name.slice(0, slash);
    const inside = folders.get(folder) ?? new Map();
    inside.set(entry.name.slice(slash + 1), entry);
    folders.set(folder, inside);
    const key = urlKey(
      `http://maff.invalid/${entry.name.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (key) stored.set(key, { read: () => entry.read() });
  }
  const pages = [];
  for (const [folder, inside] of folders) {
    const rdf = inside.get("index.rdf");
    const meta = rdf && !rdf.encrypted ? metadata(new TextDecoder().decode(rdf.read())) : {};
    const index =
      meta.indexfilename && inside.has(meta.indexfilename)
        ? meta.indexfilename
        : [...inside.keys()].find((name) => INDEX.test(name));
    const entry = index ? inside.get(index) : undefined;
    if (!index || !entry) continue;
    if (entry.encrypted) throw new Error("The MAFF archive is encrypted.");
    const url = `http://maff.invalid/${encodeURIComponent(folder)}/${encodeURIComponent(index)}`;
    const type = /\.x?html?$|\.shtml$|\.xht$/i.test(index)
      ? /\.xht(ml)?$/i.test(index)
        ? "application/xhtml+xml"
        : "text/html"
      : "text/plain";
    const page = pageOf(entry.read(), type, url, archiveResolver(url, stored));
    pages.push({
      title: meta.title || folder,
      detail: meta.originalurl || index,
      date: isoDate(meta.archivetime),
      page,
      source: page.text,
    });
  }
  if (pages.length === 0) throw new Error("The MAFF archive holds no page.");
  return pages;
}

/** The MAF: fields of an index.rdf: title, originalurl, indexfilename, archivetime. */
function metadata(/** @type {string} */ rdf) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [, name, value] of rdf.matchAll(/<MAF:(\w+)\s+RDF:resource="([^"]*)"/g))
    if (name && value !== undefined)
      fields[name] = value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
  return fields;
}
