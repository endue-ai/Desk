// RPM packages: the lead, the signature header and the main header (name, version, release,
// summary...), then the cpio payload in whatever stream the header names.
import { text, u32be } from "../bytes.js";
import { decodedInput } from "../codecs/index.js";
import { inputSeekable } from "../codecs/input.js";
import { sliceSource } from "../source.js";
import { row } from "./archive.js";
import { openCpioIn } from "./cpio.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */

const TAGS = /** @type {Array<[number, string]>} */ ([
  [1000, "Name"],
  [1001, "Version"],
  [1002, "Release"],
  [1004, "Summary"],
  [1022, "Architecture"],
  [1014, "License"],
  [1020, "URL"],
]);
const PAYLOAD_FORMAT = 1124;
const PAYLOAD_COMPRESSOR = 1125;

/** The codec RPM's payload compressor names. */
const COMPRESSORS = /** @type {Record<string, string>} */ ({
  gzip: "gzip",
  bzip2: "bzip2",
  xz: "xz",
  lzma: "lzma",
  zstd: "zstd",
});

/**
 * One header structure at `offset`: its string values by tag, and where it ends.
 * @param {Source} source @param {number} offset
 */
async function header(source, offset) {
  const intro = await source.read(offset, 16);
  if (intro.length < 16 || u32be(intro, 0) >>> 8 !== 0x8eade8)
    throw new Error(`The RPM header at byte ${offset} is damaged.`);
  const count = u32be(intro, 8);
  const size = u32be(intro, 12);
  if (count > 100000 || size > 64 * 1024 * 1024)
    throw new Error(`The RPM header at byte ${offset} is damaged.`);
  const body = await source.read(offset + 16, count * 16 + size);
  if (body.length < count * 16 + size) throw new Error("The RPM header ends early.");
  const store = body.subarray(count * 16);
  /** @type {Map<number, string>} */
  const values = new Map();
  for (let i = 0; i < count; i++) {
    const tag = u32be(body, i * 16);
    const type = u32be(body, i * 16 + 4);
    const at = u32be(body, i * 16 + 8);
    // STRING, STRING_ARRAY and I18NSTRING: the first string.
    if ((type === 6 || type === 8 || type === 9) && at < store.length) {
      const end = store.indexOf(0, at);
      values.set(tag, text(store.subarray(at, end < 0 ? store.length : end)));
    }
  }
  return { values, end: offset + 16 + count * 16 + size };
}

/** The payload's codec from its first bytes, when the header does not say. @param {Uint8Array} h */
function sniff(h) {
  if (h[0] === 0x1f && h[1] === 0x8b) return "gzip";
  if (h[0] === 0xfd && h[1] === 0x37 && h[2] === 0x7a) return "xz";
  if (h[0] === 0x28 && h[1] === 0xb5 && h[2] === 0x2f && h[3] === 0xfd) return "zstd";
  if (h[0] === 0x42 && h[1] === 0x5a && h[2] === 0x68) return "bzip2";
  if (h[0] === 0x30 && h[1] === 0x37 && h[2] === 0x30) return "";
  return "lzma";
}

/** @param {Source} source @param {string} name @returns {Promise<Archive>} */
export async function openRpm(source, name) {
  if (source.size < 96 + 16) throw new Error(`${name} ends before its RPM header.`);
  const signature = await header(source, 96);
  const main = await header(source, signature.end + ((8 - (signature.end % 8)) % 8));
  const details = TAGS.flatMap(([tag, label]) => {
    const value = main.values.get(tag);
    return value ? [row(label, value)] : [];
  });
  const payload = sliceSource(source, main.end, source.size - main.end);
  const named = COMPRESSORS[main.values.get(PAYLOAD_COMPRESSOR) ?? ""];
  const codec = named ?? sniff(await payload.read(0, 6));
  const kind = main.values.get(PAYLOAD_FORMAT) ?? "cpio";
  details.push(row("Payload", codec ? `${kind} (${codec})` : kind));
  const format = "RPM package";
  const open = () => (codec ? decodedInput(codec, payload) : inputSeekable(payload));
  if (kind !== "cpio")
    throw new Error(`${name} carries a ${kind} payload, which is not read here.`);
  const files = await openCpioIn(open, format);
  return { ...files, format, details };
}
