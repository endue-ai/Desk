// XML property lists, as a DMG keeps its partition tables: dict, array, key, string, data
// (base64), integer, real, true, false and date. Comments, the XML declaration and the doctype are
// passed over. A list that does not hold together fails with a sentence.

/** @typedef {string | number | boolean | Uint8Array | PlistValue[] | { [key: string]: PlistValue }} PlistValue */

const ENTITIES = /** @type {Record<string, string>} */ ({
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
});

/** Text with its entities replaced. @param {string} text */
const decodeEntities = (text) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] !== "#") return ENTITIES[name] ?? whole;
    const code =
      name[1] === "x" || name[1] === "X"
        ? Number.parseInt(name.slice(2), 16)
        : Number(name.slice(1));
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

/** Base64 as bytes, its white space ignored. @param {string} text */
export function base64(text) {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  let binary;
  try {
    binary = atob(clean);
  } catch {
    throw new Error("The disk image's property list is damaged: a data value is not base64.");
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Parse an XML property list.
 * @param {string} xml @returns {PlistValue}
 */
export function parsePlist(xml) {
  const damaged = (/** @type {string} */ why) =>
    new Error(`The disk image's property list is damaged: ${why}.`);
  const tag = /<(\/?)([A-Za-z]+)[^>]*?(\/?)>/y;
  let at = 0;
  /** The next tag, comments and declarations skipped; text before it is returned too. */
  const next = () => {
    for (;;) {
      const open = xml.indexOf("<", at);
      if (open < 0) throw damaged("it ends early");
      const text = xml.slice(at, open);
      if (xml.startsWith("<!--", open)) {
        const end = xml.indexOf("-->", open);
        if (end < 0) throw damaged("a comment is not closed");
        at = end + 3;
        continue;
      }
      if (xml.startsWith("<?", open) || xml.startsWith("<!", open)) {
        const end = xml.indexOf(">", open);
        if (end < 0) throw damaged("a declaration is not closed");
        at = end + 1;
        continue;
      }
      tag.lastIndex = open;
      const m = tag.exec(xml);
      if (!m) throw damaged("a tag is not closed");
      at = tag.lastIndex;
      return { close: m[1] === "/", name: /** @type {string} */ (m[2]), empty: m[3] === "/", text };
    }
  };
  /** The text up to the closing tag of `name`. @param {string} name */
  const content = (name) => {
    const end = xml.indexOf(`</${name}>`, at);
    if (end < 0) throw damaged(`a ${name} is not closed`);
    const text = xml.slice(at, end);
    at = end + name.length + 3;
    return text;
  };
  /** @param {{ name: string, empty: boolean }} t @returns {PlistValue} */
  const value = (t) => {
    switch (t.name) {
      case "dict": {
        /** @type {{ [key: string]: PlistValue }} */
        const dict = Object.create(null);
        if (t.empty) return dict;
        for (;;) {
          const k = next();
          if (k.close && k.name === "dict") return dict;
          if (k.name !== "key" || k.close) throw damaged("a dict holds something other than a key");
          const key = k.empty ? "" : decodeEntities(content("key"));
          const v = next();
          if (v.close) throw damaged(`the key “${key}” has no value`);
          dict[key] = value(v);
        }
      }
      case "array": {
        /** @type {PlistValue[]} */
        const list = [];
        if (t.empty) return list;
        for (;;) {
          const v = next();
          if (v.close && v.name === "array") return list;
          if (v.close) throw damaged("an array is not closed");
          list.push(value(v));
        }
      }
      case "true":
      case "false":
        if (!t.empty) content(t.name);
        return t.name === "true";
      case "string":
      case "date":
        return t.empty ? "" : decodeEntities(content(t.name));
      case "data":
        return t.empty ? new Uint8Array(0) : base64(content("data"));
      case "integer":
      case "real": {
        const n = Number(t.empty ? "" : content(t.name).trim());
        if (!Number.isFinite(n)) throw damaged(`an ${t.name} is not a number`);
        return n;
      }
      default:
        throw damaged(`it holds an unknown element <${t.name}>`);
    }
  };
  const root = next();
  if (root.name !== "plist" || root.close) throw damaged("it does not start with <plist>");
  if (root.empty) return "";
  const first = next();
  if (first.close) return "";
  return value(first);
}
