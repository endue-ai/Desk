// What the reader says about the files it does not draw yet: CBR (RAR 4 and 5) and CB7 comics and
// DjVu. Their headers give the page count (the images a RAR lists, a DjVu's FORM:DJVU pages) and
// a DjVu's INFO chunks each page's size; nothing is decompressed.
import { ascii, isImage, u16, u16le, u32, u32le } from "./bytes.js";
import { Unreadable } from "./errors.js";

/** @typedef {import("./errors.js").Fact} Fact */

export const NOT_YET =
  "This version reads CBZ and CBT comics and PDF; RAR, 7z and DjVu pages are not read yet.";

const isRar = (/** @type {Uint8Array} */ b) => ascii(b, 0, 6) === "Rar!\x1a\x07";
export const rarVersion = (/** @type {Uint8Array} */ b) => (isRar(b) ? (b[6] === 1 ? 5 : 4) : 0);
export const is7z = (/** @type {Uint8Array} */ b) => ascii(b, 0, 6) === "7z\xbc\xaf\x27\x1c";
export const isDjvu = (/** @type {Uint8Array} */ b) => ascii(b, 0, 8) === "AT&TFORM";

/** A RAR 5 variable-length integer: seven bits a byte, low bits first. */
function vint(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  let value = 0;
  for (let i = 0; i < 10; i++) {
    const byte = b[at + i] ?? 0;
    value += (byte & 0x7f) * 2 ** (7 * i);
    if ((byte & 0x80) === 0) return { value, next: at + i + 1 };
  }
  return { value, next: at + 10 };
}

/** The file names a RAR archive lists, or `encrypted` when its headers are. */
function rarNames(/** @type {Uint8Array} */ b) {
  const names = [];
  if (rarVersion(b) === 5) {
    for (let at = 8; at + 7 < b.length; ) {
      const size = vint(b, at + 4);
      const type = vint(b, size.next);
      const flags = vint(b, type.next);
      let field = flags.next;
      if (flags.value & 1) field = vint(b, field).next;
      let data = 0;
      if (flags.value & 2) ({ value: data, next: field } = vint(b, field));
      if (type.value === 4) return { names, encrypted: true };
      if (type.value === 5 || size.value === 0) break;
      if (type.value === 2) {
        const fileFlags = vint(b, field);
        let f = vint(b, vint(b, fileFlags.next).next).next;
        if (fileFlags.value & 2) f += 4;
        if (fileFlags.value & 4) f += 4;
        f = vint(b, vint(b, f).next).next;
        const length = vint(b, f);
        if (!(fileFlags.value & 1))
          names.push(new TextDecoder().decode(b.subarray(length.next, length.next + length.value)));
      }
      at = size.next + size.value + data;
    }
    return { names, encrypted: false };
  }
  for (let at = 7; at + 7 <= b.length; ) {
    const type = b[at + 2];
    const flags = u16le(b, at + 3);
    const size = u16le(b, at + 5);
    if (size < 7) break;
    let add = flags & 0x8000 ? u32le(b, at + 7) : 0;
    if (type === 0x73 && flags & 0x80) return { names, encrypted: true };
    if (type === 0x74) {
      const large = (flags & 0x100) !== 0;
      if (large) add += u32le(b, at + 32) * 2 ** 32;
      const nameAt = at + (large ? 40 : 32);
      const name = ascii(b, nameAt, u16le(b, at + 26)).split("\0")[0] ?? "";
      if ((flags & 0xe0) !== 0xe0) names.push(name.replace(/\\/g, "/"));
    }
    if (type === 0x7b) break;
    at += size + add;
  }
  return { names, encrypted: false };
}

/** @param {Uint8Array} b @returns {{ format: string, facts: Fact[] }} */
function rar(b) {
  const version = rarVersion(b);
  const { names, encrypted } = rarNames(b);
  /** @type {Fact[]} */
  const facts = [{ label: "Archive", value: `RAR ${version}` }];
  if (encrypted) facts.push({ label: "Listing", value: "Encrypted: the page count is not known" });
  else facts.push({ label: "Pages", value: String(names.filter(isImage).length) });
  return { format: `CBR comic (RAR ${version})`, facts };
}

/** @param {Uint8Array} b @returns {{ format: string, facts: Fact[] }} */
function djvu(b) {
  /** @type {Array<{ width: number, height: number, dpi: number }>} */
  const pages = [];
  /** @type {Fact[]} */
  const facts = [];
  const info = (/** @type {number} */ at, /** @type {number} */ end) => {
    for (let c = at; c + 8 <= end; c += 8 + u32(b, c + 4) + (u32(b, c + 4) % 2)) {
      if (ascii(b, c, 4) === "INFO")
        return { width: u16(b, c + 8), height: u16(b, c + 10), dpi: u16le(b, c + 14) };
    }
    return undefined;
  };
  const kind = ascii(b, 12, 4);
  const end = Math.min(b.length, 12 + u32(b, 8));
  if (kind === "DJVU") {
    const page = info(16, end);
    if (page) pages.push(page);
  } else if (kind === "DJVM") {
    let bundled = true;
    for (let c = 16; c + 8 <= end; c += 8 + u32(b, c + 4) + (u32(b, c + 4) % 2)) {
      const id = ascii(b, c, 4);
      if (id === "DIRM") {
        bundled = ((b[c + 8] ?? 0) & 0x80) !== 0;
        if (!bundled)
          facts.push({
            label: "Files",
            value: `${u16(b, c + 9)}, kept next to this one (an indirect DjVu)`,
          });
      }
      if (id === "FORM" && ascii(b, c + 8, 4) === "DJVU") {
        const page = info(c + 12, c + 8 + u32(b, c + 4));
        if (page) pages.push(page);
      }
    }
    if (!bundled && pages.length === 0) return { format: "DjVu", facts };
  } else throw new Unreadable("The DjVu file is damaged.", { format: "DjVu" });
  facts.unshift({ label: "Pages", value: String(pages.length) });
  const sizes = pages.map((p) => `${p.width} × ${p.height} px at ${p.dpi} dpi`);
  const distinct = [...new Set(sizes)];
  if (distinct.length === 1 && pages.length > 1)
    facts.push({ label: "Page sizes", value: `${distinct[0]}, every page` });
  else if (sizes.length > 0)
    facts.push({
      label: "Page sizes",
      value: sizes.slice(0, 6).join("; ") + (sizes.length > 6 ? "; …" : ""),
    });
  return { format: "DjVu", facts };
}

/**
 * The details of a file the reader recognises but does not draw.
 * @param {Uint8Array} b
 * @returns {{ format: string, facts: Fact[] } | undefined}
 */
export function describe(b) {
  if (isRar(b)) return rar(b);
  if (is7z(b))
    return {
      format: "CB7 comic (7z)",
      facts: [
        {
          label: "Archive",
          value: "7z; its listing is compressed, so the page count is not known",
        },
      ],
    };
  if (isDjvu(b)) return djvu(b);
  return undefined;
}
