// The value viewer's reading of one value: JSON laid out, bytes as a hex dump with their text
// beside, text as it is with its length. NULL and '' are said in words. Pure.

/**
 * @typedef {"text" | "json" | "hex"} ValueView
 * @typedef {{ views: ValueView[], meta: string, text(view: ValueView): string }} Described
 */

const HEX = /^(?:0x|\\x)((?:[0-9a-fA-F]{2})*)$/u;

/**
 * @param {string | null} value
 * @param {string} [type] The column's type, when known.
 * @returns {Described}
 */
export function describeValue(value, type = "") {
  if (value === null)
    return { views: ["text"], meta: `NULL${type ? ` · ${type}` : ""}`, text: () => "" };
  const hex = HEX.exec(value);
  const bytes = hex ? (hex[1] ?? "").length / 2 : new TextEncoder().encode(value).length;
  const json = jsonOf(value);
  /** @type {ValueView[]} */
  const views = [...(json !== undefined ? /** @type {const} */ (["json"]) : []), "text"];
  if (hex) views.unshift("hex");
  const size = hex
    ? `${bytes} byte${bytes === 1 ? "" : "s"}`
    : `${[...value].length} character${[...value].length === 1 ? "" : "s"}, ${bytes} bytes`;
  const meta = [type, value === "" ? "'' (an empty string)" : size].filter(Boolean).join(" · ");
  return {
    views,
    meta,
    text: (view) => {
      if (view === "json" && json !== undefined) return JSON.stringify(json, null, 2);
      if (view === "hex" && hex) return hexDump(hex[1] ?? "");
      return value;
    },
  };
}

/** JSON's value when the text is an object or an array. */
function jsonOf(/** @type {string} */ text) {
  const trimmed = text.trim();
  if (!/^[[{]/u.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Sixteen bytes a line: the offset, the bytes in hex, and those that are printable as text. */
export function hexDump(/** @type {string} */ digits) {
  const lines = [];
  for (let at = 0; at < digits.length; at += 32) {
    const chunk = digits.slice(at, at + 32).toLowerCase();
    const pairs = chunk.match(/../gu) ?? [];
    const text = pairs
      .map((p) => {
        const code = Number.parseInt(p, 16);
        return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : ".";
      })
      .join("");
    lines.push(`${(at / 2).toString(16).padStart(8, "0")}  ${pairs.join(" ").padEnd(47)}  ${text}`);
  }
  return lines.join("\n");
}
