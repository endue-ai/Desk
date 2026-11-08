// Unix ar archives, as Debian packages use them: "!<arch>\n", then 60-byte member headers, each
// member's data padded to an even length.
import { latin1, unixDate } from "../bytes.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {{ name: string, offset: number, size: number, date?: Date }} Member */

/** The members of the ar archive in `source`, in order. @param {Source} source @returns {Promise<Member[]>} */
export async function arMembers(source) {
  /** @type {Member[]} */
  const members = [];
  for (let offset = 8; offset + 60 <= source.size; ) {
    const head = latin1(await source.read(offset, 60));
    if (head.slice(58, 60) !== "`\n")
      throw new Error(`The ar member header at byte ${offset} is damaged.`);
    const size = Number.parseInt(head.slice(48, 58).trim(), 10);
    if (!Number.isFinite(size) || size < 0)
      throw new Error(`The ar member header at byte ${offset} is damaged.`);
    const name = head.slice(0, 16).trim().replace(/\/$/, "");
    /** @type {Member} */
    const member = { name, offset: offset + 60, size };
    const date = unixDate(Number.parseInt(head.slice(16, 28).trim(), 10));
    if (date) member.date = date;
    members.push(member);
    offset += 60 + size + (size % 2);
  }
  return members;
}

/** The codec a member's extension names: "" for none, null for one not read here. @param {string} name */
export function memberCodec(name) {
  const ext = /\.tar(?:\.([a-z0-9]+))?$/.exec(name)?.[1];
  if (ext === undefined) return /\.tar$/.test(name) ? "" : null;
  return (
    /** @type {Record<string, string>} */ ({
      gz: "gzip",
      xz: "xz",
      zst: "zstd",
      bz2: "bzip2",
      lzma: "lzma",
    })[ext] ?? null
  );
}
