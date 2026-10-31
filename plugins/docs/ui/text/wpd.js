// WordPerfect (.wpd), text only and best effort: the prefix gives the document area and version;
// WordPerfect 5 and 6+ function codes are skipped by their sizes, hard returns end paragraphs, and
// extended characters in the multinational set become their letters.
import { Reader } from "../bytes.js";
import { DocError, documentOf, ENCRYPTED, paragraphsOf, section } from "../model.js";

/** WordPerfect's multinational character set (1), from index 23: the Latin letters it holds. */
const MULTINATIONAL =
  "ßĸjÁáÂâÄäÀàÅåÆæÇçÉéÊêËëÈèÍíÎîÏïÌìÑñÓóÔôÖöÒòÚúÛûÜüÙùŸÿÃãĐđØøÕõÝýÐðÞþĂăĀāĄąĆćČčĈĉĊċĎďĚěĖėĒēĘęǴǵĞğǦǧĢģĜĝĠġĤĥĦħİiĪīĮįĨĩĲĳĴĵĶķĹĺĽľĻļĿŀŁłŃń";

/** Characters 1 to 32 of WordPerfect 6's single-byte international set. */
const INTERNATIONAL = "åÅæÆäÄáàâãÃçÇëéÉèêíñÑøØõÕöÖüÜúùß";

/** WordPerfect 6 fixed-length functions 0xF0 to 0xFE, by their total size. */
const WP6_FIXED = [4, 5, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 8, 8];
/** WordPerfect 5 fixed-length functions 0xC0 to 0xCF. */
const WP5_FIXED = [4, 9, 11, 3, 3, 5, 6, 7, 4, 5, 6, 6, 8, 10, 10, 12];

const extended = (/** @type {number} */ charset, /** @type {number} */ value) => {
  if (charset === 0 && value >= 32 && value < 127) return String.fromCharCode(value);
  if (charset === 1 && value >= 23) return MULTINATIONAL[value - 23] ?? "";
  if (charset === 4 && value <= 1) return "•";
  return "";
};

/** @param {Uint8Array} bytes */
export function readWpd(bytes) {
  const r = new Reader(bytes);
  const start = r.u32(4);
  const major = r.u8(10);
  if (r.u16(12) !== 0) throw new DocError(ENCRYPTED);
  if (start >= bytes.length || start < 16)
    throw new DocError("This file is damaged: its document area is missing.");
  const text = major === 0 ? wp5(bytes, start) : wp6(bytes, start);
  const blocks = paragraphsOf(text.replace(/\n{3,}/g, "\n\n").trim());
  return documentOf({
    format: "wpd",
    formatName: "WordPerfect document",
    textOnly: true,
    sections: [section({ blocks })],
  });
}

/** WordPerfect 6 and later. */
function wp6(/** @type {Uint8Array} */ b, /** @type {number} */ start) {
  const r = new Reader(b);
  let out = "";
  for (let i = start; i < b.length; ) {
    const c = b[i] ?? 0;
    if (c >= 0x21 && c <= 0x7e) out += String.fromCharCode(c);
    else if (c >= 1 && c <= 32) out += c === 32 ? " " : (INTERNATIONAL[c - 1] ?? "");
    else if (c === 0x80) out += " ";
    else if (c === 0x81) out += " ";
    else if (c === 0x84) out += "-";
    else if (c === 0x87 || c === 0x89 || (c >= 0xb4 && c <= 0xcf && c !== 0xc6)) out += "\n";
    else if (c === 0xc6) out += "\t";
    else if (c >= 0xd0 && c <= 0xef) {
      const sub = b[i + 1] ?? 0;
      const size = r.u16(i + 2);
      if (c === 0xd0 && ((sub >= 4 && sub <= 19) || (sub >= 23 && sub <= 28))) out += "\n";
      else if (c === 0xd0 && sub === 10) out += "\t";
      else if (c === 0xe0) out += "\t";
      i += Math.max(4, size);
      continue;
    } else if (c === 0xf0) {
      out += extended(b[i + 2] ?? 0, b[i + 1] ?? 0);
      i += 4;
      continue;
    } else if (c >= 0xf1 && c <= 0xfe) {
      i += WP6_FIXED[c - 0xf0] ?? 1;
      continue;
    }
    i++;
  }
  return out;
}

/** WordPerfect 5.x. */
function wp5(/** @type {Uint8Array} */ b, /** @type {number} */ start) {
  const r = new Reader(b);
  let out = "";
  for (let i = start; i < b.length; ) {
    const c = b[i] ?? 0;
    if (c >= 0x20 && c <= 0x7e) out += String.fromCharCode(c);
    else if (c === 0x0a || c === 0x0c || c === 0x8c || c === 0x99) out += "\n";
    else if (c === 0x0b || c === 0x0d || (c >= 0x90 && c <= 0x95)) out += " ";
    else if (c === 0xa0) out += " ";
    else if (c >= 0xa9 && c <= 0xab) out += "-";
    else if (c === 0xc0) {
      out += extended(b[i + 2] ?? 0, b[i + 1] ?? 0);
      i += 4;
      continue;
    } else if (c >= 0xc1 && c <= 0xcf) {
      i += WP5_FIXED[c - 0xc0] ?? 1;
      continue;
    } else if (c >= 0xd0) {
      i += 4 + r.u16(i + 2);
      continue;
    }
    i++;
  }
  return out;
}
