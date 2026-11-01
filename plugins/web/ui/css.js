// The page's CSS, cleaned for the shadow root: every URL goes through the policy (a data: URL the
// page's resources became, a local #reference, or nothing), @import is inlined or dropped,
// @font-face and unknown at-rules are dropped, expression() and bindings never survive, rules
// that would style the shadow host are dropped, and html, body and :root become the wrappers.
import { pairs, tokenize } from "./css-tokens.js";

/**
 * @typedef {import("./css-tokens.js").Token} Token
 * @typedef {{ url(ref: string): string | null, imported?(ref: string): string | null }} CssPolicy
 */

const BAD_PROPERTIES = new Set(["behavior", "-moz-binding", "binding", "-ms-behavior"]);
const URL_STRING_FUNCTIONS = new Set([
  "image-set",
  "-webkit-image-set",
  "image",
  "cross-fade",
  "-webkit-cross-fade",
]);
const BLOCK_RULES = new Set(["media", "supports", "container", "layer", "scope", "starting-style"]);
const DECLARATION_RULES = new Set([
  "page",
  "counter-style",
  "property",
  "font-feature-values",
  "font-palette-values",
  "view-transition",
  "position-try",
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "left-top",
  "left-middle",
  "left-bottom",
  "right-top",
  "right-middle",
  "right-bottom",
  "top-left-corner",
  "top-right-corner",
  "bottom-left-corner",
  "bottom-right-corner",
  "swash",
  "annotation",
  "ornaments",
  "stylistic",
  "styleset",
  "character-variant",
]);
const WRAPPERS = /** @type {Record<string, string>} */ ({ html: "web-html", body: "web-body" });

/** A CSS string for a replacement URL. */
const quoted = (/** @type {string} */ url) =>
  `"${url.replace(/[\\"\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

/**
 * @param {string} src
 * @param {CssPolicy} policy
 * @param {"sheet" | "declarations"} as
 */
function clean(src, policy, as) {
  const tokens = tokenize(src);
  const close = pairs(tokens);
  const raw = (/** @type {number} */ a, /** @type {number} */ b) =>
    a < b ? src.slice(tokens[a]?.start ?? src.length, tokens[b - 1]?.end ?? src.length) : "";
  const kind = (/** @type {number} */ i) => tokens[i]?.type;
  const lower = (/** @type {number} */ i) => tokens[i]?.value.toLowerCase() ?? "";
  /** Past the token at i, and past what it opens. */
  const skip = (/** @type {number} */ i) => ((close[i] ?? -1) >= 0 ? (close[i] ?? i) + 1 : i + 1);

  /** A selector list, rewritten, or null when it reaches outside the shadow root. */
  const selector = (/** @type {number} */ a, /** @type {number} */ b) => {
    let out = "";
    let brackets = 0;
    for (let i = a; i < b; i++) {
      const token = /** @type {Token} */ (tokens[i]);
      const text = src.slice(token.start, token.end);
      if (token.type === "[") brackets++;
      else if (token.type === "]") brackets--;
      else if (token.type === "comment") {
        out += " ";
        continue;
      } else if (token.type === ":" && brackets === 0) {
        const next = kind(i + 1) === ":" ? i + 2 : i + 1;
        const name = lower(next);
        if (/^(host|host-context|slotted|part)$/.test(name)) return null;
        if (next === i + 1 && kind(next) === "ident" && name === "root") {
          out += "web-html";
          i = next;
          continue;
        }
      } else if (token.type === "ident" && brackets === 0 && WRAPPERS[lower(i)]) {
        const prev = tokens[i - 1];
        const attached =
          i > a &&
          prev &&
          (prev.type === ":" ||
            (prev.type === "delim" && (prev.value === "." || prev.value === "|")));
        if (!attached) {
          out += WRAPPERS[lower(i)];
          continue;
        }
      }
      out += text;
    }
    return out;
  };

  /**
   * A declaration's value: URLs replaced, null when the declaration must go.
   * @param {number} a @param {number} b @param {boolean} stringsAreUrls inside image-set() and the like
   * @returns {string | null}
   */
  const value = (a, b, stringsAreUrls) => {
    let out = "";
    for (let i = a; i < b; i++) {
      const token = /** @type {Token} */ (tokens[i]);
      if (token.type === "bad-url" || token.type === "bad-string") return null;
      if (token.type === "comment") out += " ";
      else if (token.type === "url") {
        const url = policy.url(token.value);
        out += url === null ? "none" : `url(${quoted(url)})`;
      } else if (token.type === "string" && stringsAreUrls) {
        const url = policy.url(token.value);
        if (url === null) return null;
        out += quoted(url);
      } else if (token.type === "function") {
        const name = token.value.toLowerCase();
        const end = close[i] ?? b;
        if (name.includes("expression")) return null;
        if (name === "url" || name === "src") {
          const ref = tokens.slice(i + 1, end).find((t) => t.type === "string");
          const url = ref ? policy.url(ref.value) : null;
          out += url === null ? "none" : `url(${quoted(url)})`;
        } else {
          const inner = value(
            i + 1,
            Math.min(end, b),
            stringsAreUrls || URL_STRING_FUNCTIONS.has(name),
          );
          if (inner === null) return null;
          out += `${src.slice(token.start, token.end)}${inner}${end < b ? ")" : ""}`;
        }
        i = end;
      } else out += src.slice(token.start, token.end);
    }
    return out;
  };

  /** One declaration, `name: value`, or "" when it must go. */
  const declaration = (/** @type {number} */ a, /** @type {number} */ b) => {
    let i = a;
    while (kind(i) === "ws" || kind(i) === "comment") i++;
    if (kind(i) !== "ident") return "";
    const name = lower(i);
    let colon = i + 1;
    while (kind(colon) === "ws" || kind(colon) === "comment") colon++;
    if (kind(colon) !== ":" || BAD_PROPERTIES.has(name)) return "";
    const rest = value(colon + 1, b, false);
    return rest === null ? "" : `${raw(a, colon + 1)}${rest}`;
  };

  /** A declaration list, with nested rules and at-rules (CSS nesting) inside. */
  const declarations = (/** @type {number} */ a, /** @type {number} */ b) => {
    let out = "";
    for (let i = a; i < b; ) {
      const type = kind(i);
      if (type === "ws" || type === ";") {
        out += raw(i, i + 1);
        i++;
        continue;
      }
      if (type === "comment") {
        i++;
        continue;
      }
      if (type === "at") {
        const [text, next] = atRule(i, b, true, false);
        out += text;
        i = next;
        continue;
      }
      let j = i;
      while (j < b && kind(j) !== ";" && kind(j) !== "{") j = skip(j);
      if (j < b && kind(j) === "{") {
        const end = Math.min(close[j] ?? b, b);
        const sel = selector(i, j);
        if (sel !== null) out += `${sel}{${declarations(j + 1, end)}}`;
        i = end + 1;
        continue;
      }
      out += declaration(i, Math.min(j, b));
      i = j;
    }
    return out;
  };

  /**
   * One at-rule from i: [its cleaned text, where the next item starts].
   * @param {number} i @param {number} b @param {boolean} inStyle @param {boolean} canImport
   * @returns {[string, number]}
   */
  const atRule = (i, b, inStyle, canImport) => {
    const name = lower(i).replace(/^-(webkit|moz|o|ms)-(?=keyframes)/, "");
    let j = i + 1;
    while (j < b && kind(j) !== ";" && kind(j) !== "{") j = skip(j);
    const block = j < b && kind(j) === "{";
    const end = block ? Math.min(close[j] ?? b, b) : j;
    const next = Math.min(end + 1, b);
    const head = raw(i, j);
    if (!block) {
      if (name === "namespace" || (name === "layer" && !inStyle)) return [`${head};`, next];
      if (name !== "import" || !canImport || !policy.imported) return ["", next];
      let ref;
      let media = "";
      for (let k = i + 1; k < j; k = skip(k)) {
        const token = /** @type {Token} */ (tokens[k]);
        if (ref === undefined && (token.type === "string" || token.type === "url"))
          ref = token.value;
        else if (ref === undefined && token.type === "function" && lower(k) === "url")
          ref = tokens.slice(k + 1, close[k] ?? j).find((t) => t.type === "string")?.value;
        else if (
          ref !== undefined &&
          !(token.type === "function" && /^(layer|supports)$/.test(lower(k))) &&
          !(token.type === "ident" && lower(k) === "layer")
        )
          media += raw(k, skip(k));
      }
      const css = ref === undefined ? null : policy.imported(ref);
      if (css === null) return ["", next];
      return [media.trim() ? `@media ${media.trim()} {${css}}` : css, next];
    }
    if (name === "keyframes") return [`${head}{${rules(j + 1, end, "keyframes")}}`, next];
    if (DECLARATION_RULES.has(name)) return [`${head}{${declarations(j + 1, end)}}`, next];
    if (BLOCK_RULES.has(name))
      return [`${head}{${inStyle ? declarations(j + 1, end) : rules(j + 1, end, "rules")}}`, next];
    return ["", next];
  };

  /** A rule list: style rules, at-rules, keyframes. */
  const rules = (
    /** @type {number} */ a,
    /** @type {number} */ b,
    /** @type {"top" | "rules" | "keyframes"} */ mode,
  ) => {
    let out = "";
    let canImport = mode === "top";
    for (let i = a; i < b; ) {
      const type = kind(i);
      if (type === "ws") {
        out += raw(i, i + 1);
        i++;
        continue;
      }
      if (type === "comment" || type === "cdo" || type === "cdc" || type === ";" || type === "}") {
        i++;
        continue;
      }
      if (type === "at") {
        const name = lower(i);
        const [text, next] = atRule(i, b, false, canImport);
        if (!/^(import|charset|layer|namespace)$/.test(name)) canImport = false;
        out += text;
        i = next;
        continue;
      }
      canImport = false;
      let j = i;
      while (j < b && kind(j) !== "{") j = skip(j);
      if (j >= b) break;
      const end = Math.min(close[j] ?? b, b);
      if (mode === "keyframes") out += `${raw(i, j)}{${declarations(j + 1, end)}}`;
      else {
        const sel = selector(i, j);
        if (sel !== null) out += `${sel}{${declarations(j + 1, end)}}`;
      }
      i = end + 1;
    }
    return out;
  };

  return as === "sheet" ? rules(0, tokens.length, "top") : declarations(0, tokens.length);
}

/** A cleaned style sheet. */
export const cleanSheet = (/** @type {string} */ css, /** @type {CssPolicy} */ policy) =>
  clean(css, policy, "sheet");

/** A cleaned style attribute. */
export const cleanStyle = (/** @type {string} */ css, /** @type {CssPolicy} */ policy) =>
  clean(css, policy, "declarations").trim();

/**
 * What a sheet or a style attribute refers to: its @import references (a sheet's own, at the top)
 * and every URL in its values, in order.
 * @param {string} css @param {"sheet" | "declarations"} as
 */
export function cssRefs(css, as = "sheet") {
  /** @type {string[]} */
  const imports = [];
  /** @type {string[]} */
  const urls = [];
  const record = (/** @type {string[]} */ list) => (/** @type {string} */ ref) => {
    list.push(ref);
    return null;
  };
  clean(css, { url: record(urls), imported: record(imports) }, as);
  return { imports, urls };
}
