// Characters XML 1.0 cannot hold, even as references (PG-61): the C0 controls but tab, line feed
// and carriage return, U+FFFE, U+FFFF and a surrogate without its pair. Read a code unit at a time,
// for XML (text.js) and an .xlsx's cells (xlsx.js). No DOM.

/** Each piece of a text that XML cannot hold, replaced; `cr` also replaces a carriage return. */
export function replaceUnsafe(
  /** @type {string} */ text,
  /** @type {(unit: number) => string} */ by,
  cr = false,
) {
  let out = "";
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    } else if (
      !(unit >= 0xdc00 && unit <= 0xdfff) &&
      unit !== 0xfffe &&
      unit !== 0xffff &&
      (unit >= 0x20 || unit === 9 || unit === 10 || (unit === 13 && !cr))
    )
      continue;
    out += text.slice(from, i) + by(unit);
    from = i + 1;
  }
  return from === 0 ? text : out + text.slice(from);
}

/** Whether XML can hold a text as it is. */
export const xmlSafe = (/** @type {string} */ text) => replaceUnsafe(text, () => "\u0000") === text;
