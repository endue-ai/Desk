// BitTorrent metainfo (.torrent): the bencoded name, files with sizes, piece length, trackers and
// the info hash, the SHA-1 of the info dictionary's own bytes. A torrent holds no file data.
import { formatSize, text } from "../bytes.js";
import { cleanPath, row, withFolders } from "./archive.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {{ value: unknown, start: number, end: number }} Spanned */

const NO_DATA = "A torrent lists files; it does not hold them.";
const LARGEST = 32 * 1024 * 1024;

/**
 * A bencoded value at `at`: integers as numbers, strings as bytes, lists and dictionaries (whose
 * values keep their byte spans, so the info dictionary can be hashed as written).
 * @param {Uint8Array} b @param {number} at @param {number} depth
 * @returns {Spanned}
 */
function decode(b, at, depth = 0) {
  if (depth > 64) throw new Error("The torrent nests too deeply.");
  const c = b[at];
  if (c === 0x69) {
    const end = b.indexOf(0x65, at);
    if (end < 0) throw new Error("The torrent ends early.");
    return { value: Number(text(b.subarray(at + 1, end))), start: at, end: end + 1 };
  }
  if (c === 0x6c || c === 0x64) {
    /** @type {Spanned[]} */
    const items = [];
    let i = at + 1;
    while (b[i] !== 0x65) {
      if (i >= b.length) throw new Error("The torrent ends early.");
      const item = decode(b, i, depth + 1);
      items.push(item);
      i = item.end;
    }
    if (c === 0x6c) return { value: items.map((x) => x.value), start: at, end: i + 1 };
    /** @type {Map<string, Spanned>} */
    const dict = new Map();
    for (let k = 0; k + 1 < items.length; k += 2) {
      const key = items[k]?.value;
      dict.set(
        key instanceof Uint8Array ? text(key) : String(key),
        /** @type {Spanned} */ (items[k + 1]),
      );
    }
    return { value: dict, start: at, end: i + 1 };
  }
  if (c !== undefined && c >= 0x30 && c <= 0x39) {
    const colon = b.indexOf(0x3a, at);
    const length = Number(text(b.subarray(at, colon)));
    if (colon < 0 || !Number.isFinite(length) || colon + 1 + length > b.length)
      throw new Error("The torrent ends early.");
    return { value: b.subarray(colon + 1, colon + 1 + length), start: at, end: colon + 1 + length };
  }
  throw new Error(`The torrent is damaged at byte ${at}.`);
}

/** @param {unknown} v */
const str = (v) => (v instanceof Uint8Array ? text(v) : typeof v === "number" ? String(v) : "");
/** @param {Map<string, Spanned> | undefined} d @param {string} key */
const get = (d, key) => d?.get(key)?.value;
/** @param {unknown} v */
const dictOf = (v) => (v instanceof Map ? /** @type {Map<string, Spanned>} */ (v) : undefined);

/** @param {ArrayBufferView} bytes @param {"SHA-1" | "SHA-256"} hash */
async function hex(bytes, hash) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(hash, /** @type {BufferSource} */ (bytes)),
  );
  return [...digest].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** @param {Source} source @param {string} _name */
export async function openTorrent(source, _name) {
  if (source.size > LARGEST) throw new Error("The torrent is too large to be a torrent.");
  const bytes = await source.read(0, source.size);
  const top = dictOf(decode(bytes, 0).value);
  const infoSpan = top?.get("info");
  const info = dictOf(infoSpan?.value);
  if (!top || !infoSpan || !info) throw new Error("The torrent has no info dictionary.");
  const name = str(get(info, "name.utf-8") ?? get(info, "name"));
  const details = [row("Name", name)];
  const pieceLength = Number(get(info, "piece length") ?? 0);
  if (pieceLength) details.push(row("Piece length", formatSize(pieceLength)));
  const pieces = get(info, "pieces");
  if (pieces instanceof Uint8Array)
    details.push(row("Pieces", (pieces.length / 20).toLocaleString("en-US")));
  /** @type {string[]} */
  const trackers = [];
  const announce = str(get(top, "announce"));
  if (announce) trackers.push(announce);
  const list = get(top, "announce-list");
  if (Array.isArray(list))
    for (const tier of list)
      for (const url of Array.isArray(tier) ? tier : [tier]) {
        const s = str(url);
        if (s && !trackers.includes(s)) trackers.push(s);
      }
  trackers.forEach((url, i) => {
    details.push(row(`Tracker ${i + 1}`, url));
  });
  const comment = str(get(top, "comment.utf-8") ?? get(top, "comment"));
  if (comment) details.push(row("Comment", comment));
  const by = str(get(top, "created by"));
  if (by) details.push(row("Created by", by));
  const created = Number(get(top, "creation date") ?? 0);
  if (created > 0)
    details.push(
      row("Created", new Date(created * 1000).toISOString().slice(0, 19).replace("T", " ")),
    );
  if (get(info, "private") === 1) details.push(row("Private", "Yes"));
  const raw = bytes.subarray(infoSpan.start, infoSpan.end);
  details.push(row("Info hash", await hex(raw, "SHA-1")));
  if (get(info, "meta version") === 2)
    details.push(row("Info hash (v2)", await hex(raw, "SHA-256")));

  /** @type {Entry[]} */
  const listed = [];
  const files = get(info, "files");
  if (Array.isArray(files)) {
    for (const file of files) {
      const d = dictOf(file);
      const parts = get(d, "path.utf-8") ?? get(d, "path");
      const path = Array.isArray(parts) ? parts.map(str).join("/") : "";
      if (!path) continue;
      listed.push({
        path: cleanPath(`${name}/${path}`),
        kind: "file",
        size: Number(get(d, "length") ?? 0),
        refusal: NO_DATA,
      });
    }
  } else
    listed.push({
      path: cleanPath(name),
      kind: "file",
      size: Number(get(info, "length") ?? 0),
      refusal: NO_DATA,
    });
  details.splice(1, 0, row("Files", listed.length));
  return /** @type {Archive} */ ({
    format: "Torrent",
    entries: withFolders(listed),
    details,
    refusal: NO_DATA,
    read: () => Promise.reject(new Error(NO_DATA)),
  });
}
