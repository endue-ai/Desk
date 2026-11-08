// MOBI, AZW, AZW3 and PRC books: the PalmDB records (palm.js), the MOBI header and EXTH, PalmDOC or
// HUFF/CDIC text, then either MOBI 6 HTML (chapters at <mbp:pagebreak>, filepos links, recindex
// images) or KF8 (kf8.js: skeletons, fragments and flows). A book with DRM opens as details.
import { ascii, dataUrl, u16, u32 } from "./bytes.js";
import { Unreadable } from "./errors.js";
import { readIndex } from "./indx.js";
import { assembleKf8 } from "./kf8.js";
import { huffcdic, palmdoc, readPdb, trailing } from "./palm.js";
import { parseMarkup, sanitizeHtml, wrap } from "./sanitize.js";
import { nest } from "./toc.js";

/**
 * @typedef {import("./toc.js").Toc} Toc
 * @typedef {{ html: string, css: string[], fonts: import("./css.js").Font[], text: string }} Chapter
 * @typedef {ReturnType<typeof header>} Header
 */

const NULL = 0xffffffff;
const COVER =
  '<html><body><p style="text-align: center; margin: 0"><img src="cover:book" alt="Cover"/></p></body></html>';
const valid = (/** @type {number} */ n) => n !== NULL && n > 0;

/** Record 0: the PalmDOC header, the MOBI header and its EXTH records. */
function header(/** @type {Uint8Array} */ r) {
  const mobi = ascii(r, 16, 4) === "MOBI";
  const length = mobi ? u32(r, 20) : 0;
  const at = (/** @type {number} */ offset) =>
    mobi && offset + 4 <= 16 + length ? u32(r, offset) : NULL;
  /** @type {Map<number, Uint8Array>} */
  const exth = new Map();
  if (mobi && at(0x80) !== NULL && at(0x80) & 0x40 && ascii(r, 16 + length, 4) === "EXTH") {
    const count = u32(r, 16 + length + 8);
    for (let i = 0, o = 16 + length + 12; i < count && o + 8 <= r.length; i++) {
      const size = u32(r, o + 4);
      exth.set(u32(r, o), r.subarray(o + 8, o + size));
      o += Math.max(8, size);
    }
  }
  const version = mobi ? u32(r, 0x24) : 0;
  return {
    compression: u16(r, 0),
    textLength: u32(r, 4),
    textRecords: u16(r, 8),
    encryption: u16(r, 12),
    mobi,
    encoding: mobi && u32(r, 0x1c) === 65001 ? "utf-8" : "windows-1252",
    version,
    title: mobi ? r.subarray(u32(r, 0x54), u32(r, 0x54) + u32(r, 0x58)) : new Uint8Array(),
    firstImage: at(0x6c),
    huff: [at(0x70), at(0x74)],
    extraFlags: mobi && length >= 0xe4 ? u16(r, 0xf2) : 0,
    ncx: at(0xf4),
    fdst: version >= 8 ? at(0xc0) : NULL,
    frag: version >= 8 ? at(0xf8) : NULL,
    skel: version >= 8 ? at(0xfc) : NULL,
    exth,
  };
}

/** The decompressed text of the records after `base`, as the header says. */
function textOf(
  /** @type {Uint8Array[]} */ records,
  /** @type {number} */ base,
  /** @type {Header} */ h,
) {
  /** @type {(data: Uint8Array) => Uint8Array} */
  let decompress = (data) => data;
  if (h.compression === 2) decompress = palmdoc;
  else if (h.compression === 17480) {
    const [offset, count] = h.huff;
    if (!valid(offset ?? NULL)) throw new Unreadable("The book's HUFF table is missing.");
    decompress = huffcdic(records.slice(base + (offset ?? 0), base + (offset ?? 0) + (count ?? 0)));
  } else if (h.compression !== 1)
    throw new Unreadable(
      `The book uses a compression the reader does not know (${h.compression}).`,
    );
  const parts = [];
  let size = 0;
  for (let i = 1; i <= h.textRecords; i++) {
    const record = records[base + i];
    if (!record) break;
    const part = decompress(
      record.subarray(0, record.length - (h.mobi ? trailing(record, h.extraFlags) : 0)),
    );
    parts.push(part);
    size += part.length;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return h.textLength && h.textLength < out.length ? out.subarray(0, h.textLength) : out;
}

/** An image record's media type from its first bytes. */
export function imageType(/** @type {Uint8Array} */ b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (ascii(b, 1, 3) === "PNG") return "image/png";
  if (ascii(b, 0, 3) === "GIF") return "image/gif";
  if (ascii(b, 0, 2) === "BM") return "image/bmp";
  return undefined;
}

/** Bytes as a string of one character each, so offsets stay byte offsets. */
export const latin1 = (/** @type {Uint8Array} */ b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
export const bytesOf = (/** @type {string} */ s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Put `<a id="...">` at each byte offset (before the tag the offset falls in, if any). */
export function anchor(/** @type {string} */ text, /** @type {Map<number, string>} */ at) {
  let out = text;
  for (const pos of [...at.keys()].sort((a, b) => b - a)) {
    let p = Math.min(pos, out.length);
    const lt = out.lastIndexOf("<", p - 1);
    if (lt > out.lastIndexOf(">", p - 1)) p = lt;
    out = `${out.slice(0, p)}<a id="${at.get(pos)}"></a>${out.slice(p)}`;
  }
  return out;
}

/** Parts with no text and no image join the part after them, so no chapter is blank. */
export function merge(/** @type {string[]} */ parts) {
  const out = [];
  let carry = "";
  for (const part of parts) {
    const joined = carry + part;
    if (/<img\b/i.test(joined) || joined.replace(/<[^>]*>/g, "").trim()) {
      out.push(joined);
      carry = "";
    } else carry = joined;
  }
  if (carry && out.length) out[out.length - 1] += carry;
  return out.length ? out : [carry];
}

/** The book's chapters as a reader book: sanitized when first shown, links resolved by anchor. */
export function chaptersBook(
  /** @type {{ format: string, title: string, parts: string[], decode(part: string): string, image(src: string): string | undefined, link(href: string): string | undefined, css(i: number): Promise<{ css: string[], fonts: import("./css.js").Font[] }>, toc: Array<{ title: string, anchor: string, depth: number }>, firstTitle?: string }} */ o,
) {
  /** @type {Map<string, number>} */
  const anchors = new Map();
  o.parts.forEach((part, unit) => {
    for (const m of part.matchAll(/\bid="([^"]+)"/g))
      if (!anchors.has(m[1] ?? "")) anchors.set(m[1] ?? "", unit);
  });
  /** @type {Map<number, Promise<Chapter>>} */
  const cache = new Map();
  const build = async (/** @type {number} */ i) => {
    const doc = parseMarkup(o.decode(o.parts[i] ?? ""));
    const body = doc.getElementsByTagNameNS("*", "body")[0] ?? doc.documentElement;
    const result = sanitizeHtml(body, {
      image: o.image,
      link: o.link,
      style: { url: () => undefined, font: () => undefined },
    });
    const { css, fonts } = await o.css(i);
    return { html: wrap(body, result.html), css, fonts, text: result.text };
  };
  const chapter = (/** @type {number} */ i) => {
    let found = cache.get(i);
    if (!found) {
      found = build(i);
      cache.set(i, found);
    }
    return found;
  };
  const headings = o.parts.map((part) => {
    const m = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(part);
    return m
      ? o
          .decode(m[1] ?? "")
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  });
  const flat = o.toc.flatMap((entry) => {
    const unit = anchors.get(entry.anchor);
    return unit === undefined
      ? []
      : [{ title: entry.title, unit, anchor: entry.anchor, depth: entry.depth }];
  });
  const chapters = o.parts.map((_, unit) => ({
    title:
      (unit === 0 && o.firstTitle) ||
      (flat.find((e) => e.unit === unit)?.title ?? (headings[unit] || `Part ${unit + 1}`)),
  }));
  return {
    kind: /** @type {const} */ ("chapters"),
    format: o.format,
    title: o.title,
    chapters,
    toc: flat.length
      ? nest(flat)
      : chapters.map((c, unit) => ({ title: c.title, unit, children: [] })),
    chapter,
    target: (/** @type {string} */ href, /** @type {number} */ from) => {
      const id = href.replace(/^#/, "");
      const unit = anchors.get(id);
      return unit === undefined
        ? href.startsWith("#")
          ? { unit: from, anchor: id }
          : undefined
        : { unit, anchor: id };
    },
    text: async (/** @type {number} */ i) => (await chapter(i)).text,
  };
}

/** @param {Uint8Array} bytes */
export async function readMobi(bytes) {
  if (ascii(bytes, 0, 3) === "TPZ")
    throw new Unreadable("This is a Topaz book, a Kindle format the reader does not read.", {
      format: "Topaz",
    });
  if (ascii(bytes, 0, 4) === "CONT" || ascii(bytes, 1, 6) === "DRMION")
    throw new Unreadable("This is a KFX book, a Kindle format the reader does not read.", {
      format: "KFX",
    });
  const { records, type, creator } = readPdb(bytes);
  const first = records[0];
  if (!first) throw new Unreadable("The book is damaged: it has no header record.");
  let base = 0;
  const opening = header(first);
  let h = opening;
  const boundary = h.exth.get(121);
  if (h.version < 8 && boundary && boundary.length >= 4) {
    const k8 = u32(boundary, 0);
    const kf8 = records[k8];
    if (
      ascii(records[k8 - 1] ?? new Uint8Array(), 0, 8) === "BOUNDARY" &&
      kf8 &&
      ascii(kf8, 16, 4) === "MOBI"
    ) {
      const firstImage = h.firstImage;
      [base, h] = [k8, header(kf8)];
      // Both halves share the images, numbered from the MOBI 6 header's first image (as calibre reads it).
      h.firstImage = firstImage;
    }
  }
  const kf8 = h.version >= 8 && valid(h.skel);
  const format = kf8 ? "KF8" : type === "TEXt" && creator === "REAd" ? "PalmDOC" : "MOBI";
  if (h.encryption !== 0) throw new Unreadable("This book is protected by DRM.", { format });
  const title = new TextDecoder(h.encoding).decode(h.exth.get(503) ?? h.title).trim() || "";
  const raw = textOf(records, base, h);
  const image = (/** @type {number} */ index) => {
    const record = valid(h.firstImage) ? records[h.firstImage + index - 1] : undefined;
    const mime = record && imageType(record);
    return record && mime ? dataUrl(mime, record) : undefined;
  };
  const decode = (/** @type {string} */ part) => new TextDecoder(h.encoding).decode(bytesOf(part));
  // The cover (EXTH 201) is an image record the text does not show; it becomes the first chapter.
  const coverAt = h.exth.get(201) ?? opening.exth.get(201);
  const cover = coverAt && coverAt.length >= 4 ? image(u32(coverAt, 0) + 1) : undefined;
  /** @type {typeof chaptersBook} */
  const make = (o) =>
    cover
      ? chaptersBook({
          ...o,
          parts: [COVER, ...o.parts],
          image: (src) => (src === "cover:book" ? cover : o.image(src)),
          css: (i) => (i === 0 ? Promise.resolve({ css: [], fonts: [] }) : o.css(i - 1)),
          firstTitle: "Cover",
        })
      : chaptersBook(o);
  if (kf8)
    return assembleKf8({
      records,
      base,
      header: h,
      raw,
      image,
      decode,
      format,
      title,
      chaptersBook: make,
    });

  let text = latin1(raw);
  if (!h.mobi)
    text = `<html><body><p>${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\r?\n\s*\r?\n/g, "</p><p>")}</p></body></html>`;
  /** @type {Map<number, string>} */
  const targets = new Map();
  for (const m of text.matchAll(/filepos\s*=\s*["']?0*(\d+)/gi))
    targets.set(Number(m[1]), `filepos${Number(m[1])}`);
  const ncx = valid(h.ncx) ? readIndex(records, base + h.ncx) : { entries: [], cncx: new Map() };
  const toc = ncx.entries.flatMap((entry) => {
    const pos = entry.tags.get(1)?.[0];
    if (pos === undefined) return [];
    targets.set(pos, `filepos${pos}`);
    return [
      {
        title: ncx.cncx.get(entry.tags.get(3)?.[0] ?? -1) ?? "",
        anchor: `filepos${pos}`,
        depth: entry.tags.get(4)?.[0] ?? 0,
      },
    ];
  });
  const marked = anchor(text, targets)
    .replace(/<a([^>]*?)\sfilepos\s*=\s*["']?0*(\d+)["']?/gi, '<a$1 href="#filepos$2"')
    .replace(/<img([^>]*?)\srecindex\s*=\s*["']?(\d+)["']?/gi, '<img$1 src="recindex:$2"');
  const parts = merge(marked.split(/<mbp:pagebreak[^>]*>/i));
  return make({
    format,
    title,
    parts,
    decode: (part) =>
      decode(
        part.startsWith("<html") || /<body/i.test(part)
          ? part
          : `<html><body>${part}</body></html>`,
      ),
    image: (src) => (src.startsWith("recindex:") ? image(Number(src.slice(9))) : undefined),
    link: (href) => (href.startsWith("#") ? href : undefined),
    css: async () => ({ css: [], fonts: [] }),
    toc,
  });
}
