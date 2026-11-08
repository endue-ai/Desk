// ARJ: the local headers listed (names, sizes, dates, methods); stored entries read. ARJ's own
// compression is not decoded.
import { dosDate, u16, u32, unixDate } from "../bytes.js";
import { cleanPath, ENCRYPTED } from "./archive.js";
import { listedArchive, oldName } from "./stored.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./stored.js").Placed} Placed */

const NO_ARJ = "ARJ decompression is not available.";
/** Hosts whose ARJ writes times as Unix seconds rather than DOS fields: UNIX and NeXT. */
const UNIX_HOSTS = new Set([2, 8]);

/** A NUL-terminated string at `at`, and where it ends. @param {Uint8Array} b @param {number} at */
function cstring(b, at) {
  const end = b.indexOf(0, at);
  const stop = end < 0 ? b.length : end;
  return { value: oldName(b.subarray(at, stop)), next: stop + 1 };
}

/** @param {Source} source @param {string} _name */
export async function openArj(source, _name) {
  /** @type {Placed[]} */
  const listed = [];
  /** @type {import("./archive.js").Detail[]} */
  const details = [];
  let offset = 0;
  let first = true;
  while (offset + 4 <= source.size) {
    const lead = await source.read(offset, 4);
    if (lead[0] !== 0x60 || lead[1] !== 0xea)
      throw new Error(`The ARJ header at byte ${offset} is damaged.`);
    const size = u16(lead, 2);
    if (size === 0) break;
    if (size > 2600) throw new Error(`The ARJ header at byte ${offset} is damaged.`);
    const b = await source.read(offset + 4, size + 4);
    const firstSize = b[0] ?? 0;
    const host = b[3] ?? 0;
    const flags = b[4] ?? 0;
    const method = b[5] ?? 0;
    const type = b[6] ?? 0;
    const stamp = u32(b, 8);
    const packed = u32(b, 12);
    const original = u32(b, 16);
    const name = cstring(b, firstSize);
    let at = offset + 4 + size + 4;
    // Extended headers: a size, its bytes and their CRC, until a zero size.
    for (;;) {
      const ext = u16(await source.read(at, 2), 0);
      at += 2;
      if (ext === 0) break;
      at += ext + 4;
    }
    const date = UNIX_HOSTS.has(host) ? unixDate(stamp) : dosDate(stamp >>> 16, stamp & 0xffff);
    if (first) {
      first = false;
      details.push({ label: "Archive name", value: name.value });
      if (date)
        details.push({
          label: "Created",
          value: date.toISOString().slice(0, 19).replace("T", " "),
        });
      offset = at;
      continue;
    }
    const folder = type === 3;
    /** @type {Placed} */
    const entry = {
      path: cleanPath(name.value),
      kind: folder ? "folder" : "file",
      size: folder ? 0 : original,
      packed,
      method: folder ? "" : method === 0 ? "Stored" : `Compressed (method ${method})`,
    };
    if (date) entry.date = date;
    if (flags & 1) {
      entry.encrypted = true;
      entry.refusal = ENCRYPTED;
    } else if (method !== 0 && !folder) entry.refusal = NO_ARJ;
    else entry.start = at;
    if (entry.path && type !== 4) listed.push(entry);
    offset = at + (folder ? 0 : packed);
  }
  return listedArchive(source, "ARJ", listed, NO_ARJ, details);
}
