// KF8 (AZW3, and the KF8 half of a joint MOBI): the text's flows (FDST), parts assembled from the
// skeleton (SKEL) and fragment (FRAG) tables, kindle:pos links turned into anchors, kindle:embed
// images and fonts, kindle:flow stylesheets, and the NCX for the contents panel.
import { ascii, u32 } from "./bytes.js";
import { sanitizeCss } from "./css.js";
import { Unreadable } from "./errors.js";
import { readIndex } from "./indx.js";
import { inflate } from "./zip.js";

/** @typedef {import("./css.js").Font} Font */

const POS = /kindle:pos:fid:([0-9A-V]{4}):off:([0-9A-V]{10})/gi;
const base32 = (/** @type {string} */ s) => Number.parseInt(s, 32);

/** A FONT record: zlib-compressed and/or XOR-obfuscated font data. */
async function fontOf(/** @type {Uint8Array} */ record) {
  if (ascii(record, 0, 4) !== "FONT") return record;
  const flags = u32(record, 8);
  const offset = u32(record, 12);
  const keyLength = u32(record, 16);
  const keyOffset = u32(record, 20);
  let data = record.slice(offset);
  if (flags & 2 && keyLength > 0) {
    const key = record.subarray(keyOffset, keyOffset + keyLength);
    for (let i = 0; i < Math.min(1040, data.length); i++)
      data[i] = (data[i] ?? 0) ^ (key[i % keyLength] ?? 0);
  }
  if (flags & 1) data = await inflate(data.subarray(2));
  return data;
}

/**
 * @param {{ records: Uint8Array[], base: number, header: any, raw: Uint8Array, image(index: number): string | undefined,
 *   decode(part: string): string, format: string, title: string, chaptersBook: typeof import("./mobi.js").chaptersBook }} o
 */
export async function assembleKf8(o) {
  const { records, base, header: h } = o;
  const { latin1, anchor } = await import("./mobi.js");
  const text = latin1(o.raw);
  /** @type {string[]} */
  const flows = [];
  const fdst = records[base + h.fdst];
  if (fdst && ascii(fdst, 0, 4) === "FDST") {
    const count = u32(fdst, 8);
    for (let i = 0; i < count; i++)
      flows.push(text.slice(u32(fdst, 12 + i * 8), u32(fdst, 16 + i * 8)));
  } else flows.push(text);
  const main = flows[0] ?? "";
  const skeletons = readIndex(records, base + h.skel).entries;
  const frag = readIndex(records, base + h.frag);
  const fragments = frag.entries.map((e) => ({
    insert: Number.parseInt(e.name, 10),
    length: e.tags.get(6)?.[1] ?? 0,
  }));
  if (skeletons.length === 0)
    throw new Unreadable("The KF8 book is damaged: it has no skeleton table.", { format: "KF8" });

  /** @type {Array<{ start: number, end: number, html: string }>} */
  const parts = [];
  let next = 0;
  for (const skeleton of skeletons) {
    const [start = 0, length = 0] = skeleton.tags.get(6) ?? [];
    const count = skeleton.tags.get(1)?.[0] ?? 0;
    let html = main.slice(start, start + length);
    let at = start + length;
    for (let i = 0; i < count; i++, next++) {
      const fragment = fragments[next];
      if (!fragment) break;
      const piece = main.slice(at, at + fragment.length);
      let insert = fragment.insert - start;
      // Some books' insert positions land inside a tag; then the fragment goes after that tag.
      const head = html.slice(0, insert);
      if (head.lastIndexOf("<") > head.lastIndexOf(">")) insert = html.indexOf(">", insert) + 1;
      html = html.slice(0, insert) + piece + html.slice(insert);
      at += fragment.length;
    }
    parts.push({ start, end: start + html.length, html });
  }

  /** A kindle:pos position as the part it is in and the anchor that marks it. */
  /** @type {Array<Map<number, string>>} */
  const marks = parts.map(() => new Map());
  const mark = (/** @type {number} */ fid, /** @type {number} */ off) => {
    const pos = (fragments[fid]?.insert ?? 0) + off;
    const unit = Math.max(
      0,
      parts.findIndex((p) => pos >= p.start && pos < p.end),
    );
    const id = `kpos${fid}-${off}`;
    marks[unit]?.set(pos - (parts[unit]?.start ?? 0), id);
    return id;
  };
  for (const part of parts)
    for (const m of part.html.matchAll(POS)) mark(base32(m[1] ?? "0"), base32(m[2] ?? "0"));
  const ncx =
    h.ncx !== 0xffffffff ? readIndex(records, base + h.ncx) : { entries: [], cncx: new Map() };
  const toc = ncx.entries.flatMap((entry) => {
    const [fid, off] = entry.tags.get(6) ?? [];
    if (fid === undefined) return [];
    return [
      {
        title: ncx.cncx.get(entry.tags.get(3)?.[0] ?? -1) ?? "",
        anchor: mark(fid, off ?? 0),
        depth: entry.tags.get(4)?.[0] ?? 0,
      },
    ];
  });
  const html = parts.map((p, i) =>
    anchor(p.html, marks[i] ?? new Map()).replace(
      POS,
      (_, fid, off) => `#kpos${base32(fid)}-${base32(off)}`,
    ),
  );

  /** Fonts the stylesheets embed, read once. */
  /** @type {Map<number, Uint8Array>} */
  const fonts = new Map();
  const embedded = (/** @type {string} */ href) => /kindle:embed:([0-9A-V]{4})/i.exec(href)?.[1];
  const sheets = async (/** @type {number} */ i) => {
    const part = html[i] ?? "";
    const css = [];
    /** @type {Font[]} */
    const loaded = [];
    const links = [...part.matchAll(/kindle:flow:([0-9A-V]{4})\?mime=text\/css/gi)].map(
      (m) => flows[base32(m[1] ?? "0")] ?? "",
    );
    const inline = [...part.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "");
    for (const sheet of [...links, ...inline].map((s) => o.decode(s))) {
      for (const m of sheet.matchAll(/kindle:embed:([0-9A-V]{4})/gi)) {
        const index = base32(m[1] ?? "0");
        const record = records[h.firstImage + index - 1];
        if (record && !fonts.has(index) && ascii(record, 0, 4) === "FONT")
          fonts.set(index, await fontOf(record).catch(() => new Uint8Array()));
      }
      const safe = sanitizeCss(sheet, {
        url: (href) => {
          const id = embedded(href);
          return id ? o.image(base32(id)) : undefined;
        },
        font: (href) => {
          const id = embedded(href);
          return id ? fonts.get(base32(id)) : undefined;
        },
      });
      css.push(safe.css);
      loaded.push(...safe.fonts);
    }
    return { css, fonts: loaded };
  };

  return o.chaptersBook({
    format: o.format,
    title: o.title,
    parts: html,
    decode: o.decode,
    image: (src) => {
      const id = embedded(src);
      return id ? o.image(base32(id)) : undefined;
    },
    link: (href) => (href.startsWith("#") ? href : undefined),
    css: sheets,
    toc,
  });
}
