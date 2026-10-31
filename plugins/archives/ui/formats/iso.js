// ISO 9660 images: the volume descriptors at 32 KiB, then each directory's records, read one
// directory at a time; Joliet's UCS-2 names, or Rock Ridge names and links when the image has them.
// A file's data is read only when it is previewed or extracted.
import { at, latin1, u32, utf16be } from "../bytes.js";
import { pause } from "../codecs/index.js";
import { cleanPath, row, withFolders } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {Entry & { extents: Array<[number, number]> }} IsoEntry */

const SECTOR = 2048;

/** A directory record's date: years since 1900 ... and the offset from GMT in 15 minutes. @param {Uint8Array} b @param {number} o */
function recorded(b, o) {
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = b.subarray(o, o + 6);
  if (!mo) return undefined;
  const offset = (((b[o + 6] ?? 0) << 24) >> 24) * 15;
  return new Date(Date.UTC(1900 + y, mo - 1, d, h, mi, s) - offset * 60000);
}

/** Rock Ridge fields in a record's system use area: NM (name), SL (link), PX (mode). @param {Uint8Array} su */
function rockRidge(su) {
  /** @type {{ name?: string, link?: string, mode?: number }} */
  const out = {};
  let name = "";
  /** @type {string[]} */
  const link = [];
  for (let i = 0; i + 4 <= su.length; ) {
    const n = su[i + 2] ?? 0;
    if (n < 4) break;
    const sig = latin1(su.subarray(i, i + 2));
    const d = su.subarray(i + 4, i + n);
    if (sig === "NM" && !((d[0] ?? 0) & 6)) {
      name += latin1(d.subarray(1));
      out.name = name;
    } else if (sig === "PX") out.mode = u32(d, 0);
    else if (sig === "SL") {
      for (let k = 1; k + 2 <= d.length; k += 2 + (d[k + 1] ?? 0)) {
        const flags = d[k] ?? 0;
        link.push(
          flags & 8
            ? ""
            : flags & 4
              ? ".."
              : flags & 2
                ? "."
                : latin1(d.subarray(k + 2, k + 2 + (d[k + 1] ?? 0))),
        );
      }
      out.link = link.join("/") || "/";
    }
    i += n;
  }
  if (out.name)
    out.name = new TextDecoder().decode(Uint8Array.from(out.name, (c) => c.charCodeAt(0)));
  return out;
}

/** @param {Source} source @param {string} _name @param {{ label: string }} [kind] */
export async function openIso(source, _name, kind) {
  /** @type {Uint8Array | undefined} */
  let primary;
  /** @type {Uint8Array | undefined} */
  let joliet;
  for (let sector = 16; sector < 64; sector++) {
    const d = await source.read(sector * SECTOR, SECTOR);
    if (d.length < SECTOR || !at(d, 1, "CD001")) break;
    if (d[0] === 1) primary ??= d;
    if (d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && [0x40, 0x43, 0x45].includes(d[90] ?? 0))
      joliet ??= d;
    if (d[0] === 255) break;
  }
  if (!primary) throw new Error("The image has no ISO 9660 volume descriptor.");
  const block = u32(primary, 128) & 0xffff || SECTOR;

  /** The records of the directory at `extent`, `length` bytes long. @param {number} extent @param {number} length */
  const records = async (extent, length) => {
    const data = await source.read(extent * block, length);
    /** @type {Uint8Array[]} */
    const out = [];
    for (let i = 0; i < data.length; ) {
      const n = data[i] ?? 0;
      if (n === 0) {
        i = (Math.floor(i / SECTOR) + 1) * SECTOR;
        continue;
      }
      if (n < 34 || i + n > data.length) break;
      out.push(data.subarray(i, i + n));
      i += n;
    }
    return out;
  };

  // Rock Ridge when the primary tree carries names in it; otherwise Joliet when there is one.
  const root = (/** @type {Uint8Array} */ d) => d.subarray(156, 190);
  const rootDot = (await records(u32(root(primary), 2), u32(root(primary), 10)))[0];
  const susp = rootDot
    ? rootDot.subarray(34 + (rootDot[32] ?? 0) + (((rootDot[32] ?? 0) + 1) % 2))
    : new Uint8Array(0);
  const hasSusp = at(susp, 0, "SP");
  const firstChildren = hasSusp ? await records(u32(root(primary), 2), u32(root(primary), 10)) : [];
  const rr =
    hasSusp &&
    firstChildren
      .slice(2)
      .some((r) => rockRidge(r.subarray(34 + (r[32] ?? 0) + (((r[32] ?? 0) + 1) % 2))).name);
  const volume = !rr && joliet ? joliet : primary;
  const names = rr ? "Rock Ridge" : volume === joliet ? "Joliet" : "ISO 9660";

  /** @type {IsoEntry[]} */
  const listed = [];
  const seen = new Set();
  /** @type {Array<[number, number, string, number]>} */
  const todo = [[u32(root(volume), 2), u32(root(volume), 10), "", 0]];
  let count = 0;
  while (todo.length) {
    const [extent, length, folder, depth] = /** @type {[number, number, string, number]} */ (
      todo.shift()
    );
    if (seen.has(extent) || depth > 64) continue;
    seen.add(extent);
    /** @type {IsoEntry | undefined} */
    let pending;
    for (const r of await records(extent, length)) {
      const nameLength = r[32] ?? 0;
      const id = r.subarray(33, 33 + nameLength);
      if (nameLength === 1 && (id[0] === 0 || id[0] === 1)) continue;
      const flags = r[25] ?? 0;
      const extra = rr ? rockRidge(r.subarray(34 + nameLength + ((nameLength + 1) % 2))) : {};
      let name = volume === joliet ? utf16be(id) : latin1(id);
      name = extra.name ?? name.replace(/;\d+$/, "").replace(/\.$/, "");
      const path = folder ? `${folder}/${name}` : name;
      const isDir = (flags & 2) !== 0;
      const isLink = extra.mode !== undefined && (extra.mode & 0o170000) === 0o120000;
      const span = /** @type {[number, number]} */ ([u32(r, 2), u32(r, 10)]);
      if (pending && pending.path === cleanPath(path)) {
        // A file over 4 GiB is several records with the same name, all but the last marked.
        pending.extents.push(span);
        pending.size += span[1];
        if (!(flags & 0x80)) pending = undefined;
        continue;
      }
      /** @type {IsoEntry} */
      const entry = {
        path: cleanPath(path),
        kind: isDir ? "folder" : isLink ? "link" : "file",
        size: isDir || isLink ? 0 : span[1],
        extents: [span],
      };
      const date = recorded(r, 18);
      if (date) entry.date = date;
      if (isLink && extra.link !== undefined) entry.link = extra.link;
      listed.push(entry);
      pending = flags & 0x80 ? entry : undefined;
      if (isDir) todo.push([span[0], span[1], entry.path, depth + 1]);
      if (++count % 2000 === 0) await pause();
    }
  }

  /** @param {IsoEntry} entry @param {number} limit */
  const read = async (entry, limit) => {
    /** @type {Uint8Array[]} */
    const parts = [];
    let left = Math.min(entry.size, limit);
    for (const [extent, length] of entry.extents) {
      if (left <= 0) break;
      const part = await source.read(extent * block, Math.min(length, left));
      parts.push(part);
      left -= part.length;
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  const label = (/** @type {Uint8Array} */ d) =>
    (d === joliet ? utf16be(d.subarray(40, 72)) : latin1(d.subarray(40, 72))).replace(
      /[\s\0]+$/,
      "",
    );
  return {
    format: kind?.label ?? "ISO 9660",
    entries: withFolders(listed),
    details: [row("Volume", label(volume) || label(primary)), row("Names", names)],
    read: (/** @type {Entry} */ entry, limit = Number.POSITIVE_INFINITY) =>
      read(/** @type {IsoEntry} */ (entry), limit),
  };
}
