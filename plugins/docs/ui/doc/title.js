// The title in the "\u0005SummaryInformation" property set ([MS-OLEPS] 2.20 and 2.21, property 2,
// PIDSI_TITLE): an 8-bit string in the set's code page (property 1) or a UTF-16 one.
import { decode, Reader } from "../bytes.js";

const CODE_PAGES = /** @type {Record<number, string>} */ ({
  1200: "utf-16le",
  65001: "utf-8",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  874: "windows-874",
});

/** @param {Uint8Array | undefined} stream @returns {string} */
export function titleOf(stream) {
  if (!stream || stream.length < 48) return "";
  const r = new Reader(stream);
  if (r.u16(0) !== 0xfffe) return "";
  const set = r.u32(44);
  const count = Math.min(r.u32(set + 4), 256);
  /** @type {Map<number, number>} */
  const offsets = new Map();
  for (let i = 0; i < count; i++)
    offsets.set(r.u32(set + 8 + i * 8), set + r.u32(set + 12 + i * 8));
  const codePageAt = offsets.get(1);
  const codePage =
    codePageAt !== undefined && r.u16(codePageAt) === 2 ? r.u16(codePageAt + 4) : 1252;
  const at = offsets.get(2);
  if (at === undefined) return "";
  const type = r.u16(at);
  const size = Math.min(r.u32(at + 4), 4096);
  let text = "";
  if (type === 0x1e) {
    const label =
      CODE_PAGES[codePage] ??
      (codePage >= 1250 && codePage <= 1258 ? `windows-${codePage}` : "windows-1252");
    text = decode(stream.subarray(at + 8, at + 8 + size), label);
  } else if (type === 0x1f) text = decode(stream.subarray(at + 8, at + 8 + size * 2), "utf-16le");
  const nul = text.indexOf("\u0000");
  return (nul < 0 ? text : text.slice(0, nul)).trim();
}
