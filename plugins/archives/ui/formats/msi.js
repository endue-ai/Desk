// MSI: a compound file whose streams carry names packed six bits per character (tables, the
// summary, embedded cabinets). The streams are listed under their decoded names and can be
// previewed (an embedded cabinet opens one level down); extracting them is not offered.
import { openCfb } from "./cfb.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./archive.js").Archive} Archive */

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._";
const NO_MSI = "Extracting MSI streams is not available.";

/** An MSI stream name as Windows Installer means it; control characters as 7-Zip shows them. @param {string} name */
export function msiName(name) {
  let out = "";
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c >= 0x3800 && c < 0x4800) {
      const v = c - 0x3800;
      out += CHARS.charAt(v & 0x3f) + CHARS.charAt((v >> 6) & 0x3f);
    } else if (c >= 0x4800 && c < 0x4840) out += CHARS.charAt(c - 0x4800);
    else if (c === 0x4840) out += "!";
    else if (c < 0x20) out += `[${c}]`;
    else out += ch;
  }
  return out;
}

/** @param {Source} source @param {string} _name */
export async function openMsi(source, _name) {
  const cfb = await openCfb(source);
  /** @type {Map<Entry, import("./cfb.js").CfbStream>} */
  const streams = new Map();
  for (const stream of cfb.streams) {
    const path = stream.path.split("/").map(msiName).join("/");
    streams.set({ path, kind: "file", size: stream.size }, stream);
  }
  const entries = [...streams.keys()];
  return /** @type {Archive} */ ({
    format: "MSI",
    entries,
    details: [{ label: "Streams", value: String(entries.length) }],
    refusal: NO_MSI,
    read: (entry, limit = Number.POSITIVE_INFINITY) => {
      const stream = streams.get(entry);
      if (!stream) return Promise.reject(new Error(NO_MSI));
      return cfb.read(stream, limit);
    },
  });
}
