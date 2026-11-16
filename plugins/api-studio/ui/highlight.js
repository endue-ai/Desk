// Syntax colours for bodies and editors: JSON, XML/HTML, JavaScript and plain text cut into
// classed runs, with {{variables}} marked inside any of them (set, dynamic or missing). The runs
// become text nodes in spans, never HTML, so a body cannot inject anything into the page.

import { tokens as varTokens } from "./vars.js";

/** @typedef {{ c: string, s: string }} Run  c: the class ("" for plain), s: the text */

const JSON_RE =
  /("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g;
const XML_RE =
  /(<!--[\s\S]*?-->)|(<!\[CDATA\[[\s\S]*?\]\]>)|(<\/?)([\w:.-]+)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?>)|(&[#\w]+;)/g;
const ATTR_RE = /([\w:.-]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?/g;
const JS_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|function|return|if|else|for|of|in|await|async|new|try|catch|throw|true|false|null|undefined|typeof)\b|\b(req|res|api|test|expect|console)\b/g;

/** @param {RegExp} re @param {string} text @param {(m: RegExpExecArray) => Run[]} each @returns {Run[]} */
function scan(re, text, each) {
  /** @type {Run[]} */
  const out = [];
  let at = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ c: "", s: text.slice(at, m.index) });
    out.push(...each(m));
    at = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (at < text.length) out.push({ c: "", s: text.slice(at) });
  return out;
}

/** @param {string} text @returns {Run[]} */
export function jsonRuns(text) {
  return scan(JSON_RE, text, (m) => {
    if (m[1] !== undefined)
      return m[2] !== undefined
        ? [
            { c: "t-key", s: m[1] },
            { c: "t-punct", s: m[2] },
          ]
        : [{ c: "t-str", s: m[1] }];
    if (m[3] !== undefined) return [{ c: "t-num", s: m[3] }];
    if (m[4] !== undefined) return [{ c: "t-bool", s: m[4] }];
    if (m[5] !== undefined) return [{ c: "t-null", s: m[5] }];
    return [{ c: "t-punct", s: m[0] }];
  });
}

/** @param {string} text @returns {Run[]} */
export function xmlRuns(text) {
  return scan(XML_RE, text, (m) => {
    if (m[1] !== undefined || m[2] !== undefined) return [{ c: "t-comment", s: m[0] }];
    if (m[7] !== undefined) return [{ c: "t-entity", s: m[7] }];
    /** @type {Run[]} */
    const runs = [
      { c: "t-punct", s: m[3] ?? "" },
      { c: "t-tag", s: m[4] ?? "" },
    ];
    const attrs = m[5] ?? "";
    runs.push(
      ...scan(ATTR_RE, attrs, (a) => [
        { c: "t-attr", s: a[1] ?? "" },
        ...(a[2] ? [{ c: "t-punct", s: a[2] }] : []),
        ...(a[3] ? [{ c: "t-str", s: a[3] }] : []),
      ]),
    );
    const gap = m[0].slice(
      (m[3] ?? "").length + (m[4] ?? "").length + attrs.length,
      m[0].length - (m[6] ?? "").length,
    );
    if (gap) runs.push({ c: "", s: gap });
    runs.push({ c: "t-punct", s: m[6] ?? "" });
    return runs;
  });
}

/** @param {string} text @returns {Run[]} */
export function jsRuns(text) {
  return scan(JS_RE, text, (m) => {
    if (m[1] !== undefined) return [{ c: "t-comment", s: m[1] }];
    if (m[2] !== undefined) return [{ c: "t-str", s: m[2] }];
    if (m[3] !== undefined) return [{ c: "t-num", s: m[3] }];
    if (m[4] !== undefined) return [{ c: "t-keyword", s: m[4] }];
    return [{ c: "t-builtin", s: m[5] ?? "" }];
  });
}

/** The runs of a text in a language: json, xml, html, js, or anything else as plain text. @param {string} text @param {string} lang */
export function runs(text, lang) {
  if (lang === "json" || lang === "graphql-vars") return jsonRuns(text);
  if (lang === "xml" || lang === "html") return xmlRuns(text);
  if (lang === "js") return jsRuns(text);
  return [{ c: "", s: text }];
}

/**
 * Runs with {{variables}} split out of them as their own runs (var-set, var-dynamic, var-missing).
 * @param {Run[]} list @param {import("./vars.js").Scope[]} scopes
 */
export function withVars(list, scopes) {
  /** @type {Run[]} */
  const out = [];
  for (const run of list) {
    if (!run.s.includes("{{")) {
      out.push(run);
      continue;
    }
    for (const t of varTokens(run.s, scopes))
      out.push("text" in t ? { c: run.c, s: t.text } : { c: `var var-${t.state}`, s: t.raw });
  }
  return out;
}

/**
 * Draw runs into an element as spans of text. Past `limit` characters the rest goes in plain, so
 * a large body stays quick.
 * @param {Element} el @param {Run[]} list @param {number} [limit]
 */
export function paint(el, list, limit = 400_000) {
  const frag = document.createDocumentFragment();
  let used = 0;
  for (const run of list) {
    if (used > limit) {
      frag.append(document.createTextNode(run.s));
      continue;
    }
    used += run.s.length;
    if (!run.c) frag.append(document.createTextNode(run.s));
    else {
      const span = document.createElement("span");
      span.className = run.c;
      span.textContent = run.s;
      if (run.c.startsWith("var ")) span.dataset.var = run.s.replace(/^\{\{\s*|\s*\}\}$/g, "");
      frag.append(span);
    }
  }
  el.replaceChildren(frag);
}

/** Pretty-print JSON text with two-space indents; text that is not JSON comes back as it was. @param {string} text */
export function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Indent XML/HTML one tag per line, roughly: good enough to read a compact document. @param {string} text */
export function prettyXml(text) {
  if (/\n\s+</.test(text)) return text;
  let depth = 0;
  const lines = text
    .replace(/>\s*</g, ">\n<")
    .split("\n")
    .map((line) => {
      const closing = /^<\//.test(line);
      const selfClosing =
        /\/>$/.test(line) || /^<[!?]/.test(line) || /^<(\w+)[^>]*>.*<\/\1>$/.test(line);
      if (closing) depth = Math.max(0, depth - 1);
      const out = `${"  ".repeat(depth)}${line}`;
      if (!closing && !selfClosing && /^<\w/.test(line)) depth++;
      return out;
    });
  return lines.join("\n");
}
