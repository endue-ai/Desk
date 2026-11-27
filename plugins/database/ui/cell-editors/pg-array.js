import { t } from "../strings/index.js";

// PostgreSQL's array text, as the server writes it and reads it (arrays.html, 8.15.6): elements
// between braces apart by commas, quoted with backslash escapes where they hold a brace, a quote, a
// comma, a backslash or space, are empty or read as NULL; an unquoted NULL is NULL. A nested
// (multi-dimensional) array or one with its bounds written ([1:2]=...) is kept as text, its braces
// checked. Pure.

const BAD = t("cellEditors.pgArray.anArrayIsWrittenBetweenAnd");

/**
 * @param {string} text
 * @returns {{ elements: (string | null)[] } | { nested: true } | { error: string }}
 */
export function parseArray(text) {
  const s = text.trim();
  if (s.startsWith("[")) return { nested: true };
  if (!s.startsWith("{") || !s.endsWith("}")) return { error: BAD };
  const body = s.slice(1, -1);
  /** @type {(string | null)[]} */
  const elements = [];
  if (body.trim() === "") return { elements };
  let i = 0;
  for (;;) {
    while (/\s/u.test(body[i] ?? "")) i++;
    if (body[i] === "{") return { nested: true };
    const n = elements.length + 1;
    if (body[i] === '"') {
      let value = "";
      let closed = false;
      for (i++; i < body.length; i++) {
        const c = body[i];
        if (c === "\\") value += body[++i] ?? "";
        else if (c === '"') {
          closed = true;
          i++;
          break;
        } else value += c;
      }
      if (!closed)
        return { error: t("cellEditors.pgArray.theQuoteOfElementIsNot", { n: String(n) }) };
      while (/\s/u.test(body[i] ?? "")) i++;
      elements.push(value);
    } else {
      let value = "";
      let escaped = false;
      for (; i < body.length && body[i] !== ","; i++) {
        const c = body[i] ?? "";
        if (c === "\\") {
          value += body[++i] ?? "";
          escaped = true;
        } else if (c === '"' || c === "{" || c === "}")
          return {
            error: t("cellEditors.pgArray.elementHoldsPutItBetweenDouble", {
              n: String(n),
              c: String(c),
            }),
          };
        else value += c;
      }
      const trimmed = value.trim();
      if (trimmed === "" && !escaped)
        return { error: t("cellEditors.pgArray.elementIsEmptyWriteForEmpty", { n: String(n) }) };
      elements.push(!escaped && /^null$/iu.test(trimmed) ? null : trimmed);
    }
    if (i >= body.length) return { elements };
    if (body[i] !== ",") return { error: BAD };
    i++;
  }
}

/** Elements as PostgreSQL's array text, quoted where they must be. */
export function formatArray(/** @type {(string | null)[]} */ elements) {
  const one = (/** @type {string | null} */ v) => {
    if (v === null) return "NULL";
    if (v === "" || /[{}",\\\s]/u.test(v) || /^null$/iu.test(v))
      return `"${v.replace(/["\\]/gu, "\\$&")}"`;
    return v;
  };
  return `{${elements.map(one).join(",")}}`;
}

/** Whether a nested array's braces match, outside its quotes. */
export function balanced(/** @type {string} */ text) {
  const s = text.trim().replace(/^(?:\[[^\]]*\])+=/u, "");
  if (!s.startsWith("{")) return false;
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (--depth < 0) return false;
    } else if (depth === 0 && !/\s/u.test(c ?? "")) return false;
  }
  return depth === 0 && !quoted;
}
