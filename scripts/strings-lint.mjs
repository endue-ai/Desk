#!/usr/bin/env node
// strings-lint: a plugin whose words live in one catalog (the database plugin's ui/strings/, PG-108)
// keeps them there. A view module may not hold a literal a person reads; it names a key of the
// catalog instead (`t("grid.rows", { count })`). No baseline: a target is either clean or fails.
//
//   node scripts/strings-lint.mjs          check every target (just check)
//   node scripts/strings-lint.mjs --list   print every finding, the same as a failure prints
//
// The rule. A view module is a `.js` file under a target's folder, outside `vendor/`, named
// `view.js`, `view-*.js` or `*-view.js`. In it, a string literal or a template literal is the
// person's words when its text (each `${…}` read as a placeholder) holds a word (a letter, then
// lowercase letters or apostrophes, with punctuation around it stripped) and
//   1. a word starts with a capital letter (`Run`, `Not connected`), or
//   2. it holds two words or more (`no rows`), or
//   3. it is a template with a placeholder and a word (`${n} rows`), or
//   4. it is put straight into what the page shows: assigned to `textContent`, `innerText`, `title`,
//      `placeholder`, `alt`, `label` or `ariaLabel`, or the value of a `title`, `aria-label`,
//      `placeholder`, `alt` or `label` key, and it holds any letter (`read-only`).
// Never the person's words: import and export specifiers, object keys, an operand of `==`, `!=`,
// `===` or `!==`, a `case` label, a `class` or `className` value, and a KeyboardEvent key name.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The folders whose view modules read their words from a catalog. */
export const TARGETS = ["plugins/database/ui"];
export const VIEW = /(^|\/)(view\.js|view-[^/]*\.js|[^/]*-view\.js)$/;

const KEYS = new Set(
  "Enter Escape Tab Backspace Delete Home End Insert Shift Control Alt Meta PageUp PageDown Space".split(
    " ",
  ),
);
const SINK_PROPS = new Set([
  "textContent",
  "innerText",
  "title",
  "placeholder",
  "alt",
  "label",
  "ariaLabel",
]);
const SINK_KEYS = new Set(["title", "aria-label", "placeholder", "alt", "label"]);
const CLASS_KEYS = new Set(["class", "className", "value"]);
const COMPARE = new Set(["==", "!=", "===", "!=="]);
const PUNCT = /^[([{"'“‘«]+|[)\]}"'”’»,.:;!?…]+$/gu;
const WORD = /^\p{L}[\p{Ll}'’]+$/u;
/** A CSS unit after a placeholder (`${x}px`) is not a word. */
const UNIT = /(?<=\{\})(px|em|rem|vh|vw|deg|fr|ch)\b/g;

/**
 * The tokens of a JavaScript source that matter here: strings, templates (their text, each `${…}`
 * as `{}`, `holes` counted, `end` the index past their inner tokens), identifiers and punctuators.
 * Comments and regular expressions are skipped. Tokens inside a template's `${…}` follow it and name
 * it as their `parent`. Each token has its `line`.
 * @param {string} src
 */
export function tokens(src) {
  /** @type {{ kind: "str" | "tpl" | "id" | "op", text: string, line: number, holes?: number, end?: number, parent?: number }[]} */
  const out = [];
  /** Per open `${`: the template's index and the braces open inside it. */
  const open = [];
  let i = 0;
  let line = 1;
  const regexAllowed = () => {
    const last = out[out.length - 1];
    if (!last || (last.kind === "tpl" && last.end === undefined)) return true;
    if (last.kind === "str" || last.kind === "tpl") return false;
    if (last.kind === "id")
      return /^(return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/.test(
        last.text,
      );
    return !/^[)\]}]$/.test(last.text);
  };
  const push = (tok) => {
    const parent = open[open.length - 1]?.tpl;
    out.push(parent === undefined ? tok : { ...tok, parent });
  };
  /** Read a template's text from `i` to its end or its next `${`. */
  const quasi = (k) => {
    const tok = out[k];
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") {
        tok.text += src.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        i++;
        tok.end = out.length;
        return;
      } else if (c === "$" && src[i + 1] === "{") {
        i += 2;
        tok.text += "{}";
        tok.holes = (tok.holes ?? 0) + 1;
        open.push({ tpl: k, depth: 0 });
        return;
      } else {
        if (c === "\n") line++;
        tok.text += c;
        i++;
      }
    }
  };
  const quoted = (q) => {
    i++;
    let text = "";
    while (i < src.length && src[i] !== q && src[i] !== "\n") {
      if (src[i] === "\\") {
        text += src.slice(i, i + 2);
        i += 2;
      } else text += src[i++];
    }
    i++;
    return text;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      line += (src.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
    } else if (c === '"' || c === "'") {
      const at = line;
      push({ kind: "str", text: quoted(c), line: at });
    } else if (c === "`") {
      push({ kind: "tpl", text: "", line, holes: 0 });
      i++;
      quasi(out.length - 1);
    } else if (c === "}" && open.length > 0 && open[open.length - 1].depth === 0) {
      const { tpl } = /** @type {{ tpl: number }} */ (open.pop());
      i++;
      quasi(tpl);
    } else if (c === "/" && regexAllowed()) {
      i++;
      let cls = false;
      while (i < src.length && (src[i] !== "/" || cls)) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") cls = true;
        else if (src[i] === "]") cls = false;
        else if (src[i] === "\n") break;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] ?? "")) i++;
    } else if (/[\p{L}_$\d]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}_$\d]/u.test(src[j])) j++;
      push({ kind: "id", text: src.slice(i, j), line });
      i = j;
    } else {
      const op = /^(===|!==|==|!=|\?\?|\?\.|=>|&&|\|\||[^\s])/.exec(src.slice(i, i + 3))?.[0] ?? c;
      const top = open[open.length - 1];
      if (top && op === "{") top.depth++;
      if (top && op === "}") top.depth--;
      push({ kind: "op", text: op, line });
      i += op.length;
    }
  }
  return out;
}

/** The words of a literal's text, punctuation around each stripped. */
export function words(text) {
  return text
    .replace(/\\[nt]/g, " ")
    .replace(UNIT, "")
    .replace(/(?<=(^|\s)\p{L}+)\{\}/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(PUNCT, ""))
    .filter((w) => WORD.test(w));
}

const STOP = new Set([";", "=>", "return", "throw", "case", "export", "const", "let", "var"]);
const CLOSE = { ")": "(", "]": "[", "}": "{" };

/**
 * What a literal at token `k` goes into: an assignment to a property (`assign`), an object key's
 * value (`key`), or a call's argument (`arg`, with the callee's name and the argument's index),
 * through ternaries and `||`, `??`, `&&`, `+`; null when nothing names it.
 */
function target(toks, k) {
  const first = toks[k].parent ?? k;
  let depth = 0;
  let commas = 0;
  for (let j = first - 1; j >= 0; j--) {
    const tok = toks[j];
    if (tok.parent !== undefined && tok.parent !== toks[first].parent) continue;
    const t = tok.kind === "op" || tok.kind === "id" ? tok.text : "";
    if (t in CLOSE) depth++;
    else if (t === "(" || t === "[" || t === "{") {
      if (depth > 0) depth--;
      else {
        if (t !== "(") return null;
        const fn = toks[j - 1];
        return fn?.kind === "id" ? { kind: "arg", name: fn.text, index: commas } : null;
      }
    } else if (depth > 0) continue;
    else if (t === ",") {
      // An argument list keeps going; an object's or array's entries do not reach past a comma.
      commas++;
    } else if (t === ":" && (toks[j - 2]?.text === "{" || toks[j - 2]?.text === ",")) {
      const key = toks[j - 1];
      if (commas > 0) return null;
      return { kind: "key", name: key?.text ?? "" };
    } else if (t === "=") {
      if (commas > 0) return null;
      return { kind: "assign", name: toks[j - 1]?.text ?? "" };
    } else if (STOP.has(t)) return null;
  }
  return null;
}

const SELECTOR_FNS = new Set([
  "querySelector",
  "querySelectorAll",
  "closest",
  "matches",
  "getElementById",
]);
const STYLE = new Set(["style", "cssText"]);

/** Whether a literal at token `k` sits where no words go: a specifier, a key, a comparison. */
function exempt(toks, k) {
  const tok = toks[k];
  const prev = toks[k - 1];
  const next = toks[tok.end ?? k + 1];
  const before = toks[k - 2];
  if (prev?.kind === "id" && (prev.text === "from" || prev.text === "import")) return true;
  if (prev?.text === "(" && before?.text === "import") return true;
  if (next?.text === ":" && (prev?.text === "{" || prev?.text === ",")) return true;
  if (prev?.text === "case") return true;
  if (COMPARE.has(prev?.text ?? "") || COMPARE.has(next?.text ?? "")) return true;
  if (next?.kind === "id" && next.text === "in") return true;
  return KEYS.has(tok.text);
}

/** Whether a literal's text, at token `k` of `toks`, is the person's words. */
function reads(toks, k) {
  const tok = toks[k];
  if (exempt(toks, k)) return false;
  const to = target(toks, k);
  if (to && (to.kind === "key" || to.kind === "assign")) {
    if (CLASS_KEYS.has(to.name) || STYLE.has(to.name)) return false;
  }
  if (to?.kind === "arg" && SELECTOR_FNS.has(to.name)) return false;
  if (to?.kind === "arg" && to.name === "setAttribute" && to.index === 0) return false;
  const found = words(tok.text);
  const sink =
    (to?.kind === "assign" && SINK_PROPS.has(to.name)) ||
    (to?.kind === "key" && SINK_KEYS.has(to.name.replace(/^["']|["']$/g, "")));
  if (sink && /\p{L}[\p{L}-]*\p{Ll}/u.test(tok.text.replace(/\{\}/g, " "))) return true;
  if (found.length === 0) return false;
  if (found.some((w) => /^\p{Lu}/u.test(w))) return true;
  if (found.length >= 2) return true;
  return tok.kind === "tpl" && (tok.holes ?? 0) > 0;
}

/** Each literal of a source that is the person's words: its line and text. */
export function findings(src) {
  const toks = tokens(src);
  const out = [];
  /** Templates found to be words: a literal inside one that holds a word is a part of them. */
  const flagged = new Set();
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.kind !== "str" && tok.kind !== "tpl") continue;
    const part =
      tok.parent !== undefined &&
      flagged.has(tok.parent) &&
      words(tok.text).length > 0 &&
      !exempt(toks, k);
    if (part || reads(toks, k)) {
      if (tok.kind === "tpl") flagged.add(k);
      out.push({ line: tok.line, text: tok.text });
    }
  }
  return out;
}

/** Every view module under the targets, by its path from `root` with forward slashes. */
export function views(root = ROOT, targets = TARGETS) {
  const found = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) {
        if (name !== "vendor" && name !== "node_modules") walk(path);
      } else {
        const rel = relative(root, path).split(sep).join("/");
        if (VIEW.test(rel)) found.push(rel);
      }
    }
  };
  for (const target of targets) if (existsSync(join(root, target))) walk(join(root, target));
  return found;
}

/** Every finding under the targets, as `path:line: "text"` lines. */
export function scan(root = ROOT, targets = TARGETS) {
  return views(root, targets).flatMap((file) =>
    findings(readFileSync(join(root, file), "utf8")).map(
      (f) => `${file}:${f.line}: ${JSON.stringify(f.text)}`,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = scan();
  if (process.argv.includes("--list")) {
    for (const p of problems) console.log(p);
    process.exit(0);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    console.error(
      `strings-lint: ${problems.length} literal(s) a person reads in view modules; name a key of the catalog (plugins/database/ui/strings/en.json) with t() instead`,
    );
    process.exit(1);
  }
  console.log(`strings-lint: ${views().length} view modules read their words from the catalog`);
}
