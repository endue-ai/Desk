// A book's own CSS, made safe for the chapter's shadow root: no @import, @font-face rules taken out
// (their fonts load through the FontFace API), url()s to files in the book become data: URLs and
// every other url() goes, `html` and `body` selectors aim at the shadow root and its body wrapper,
// and `position: fixed` stays inside the reading pane.

/**
 * @typedef {{ url(href: string): string | undefined, font(href: string): Uint8Array | undefined }} CssResolver
 * @typedef {{ family: string, bytes: Uint8Array }} Font
 */

/** Strip comments, keeping strings intact. */
const uncomment = (/** @type {string} */ css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The url()s of a value, unquoted. */
const URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** Top-level blocks: [prelude, body] pairs, and the statements (`@import ...;`) between them. */
function blocks(/** @type {string} */ css) {
  /** @type {Array<{ prelude: string, body?: string }>} */
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const end = css.indexOf(c, i + 1);
      i = end < 0 ? css.length : end;
    } else if (c === "{") {
      if (depth++ === 0) open = i;
    } else if (c === "}") {
      if (depth === 0) continue;
      if (--depth === 0) {
        out.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) {
      out.push({ prelude: css.slice(start, i).trim() });
      start = i + 1;
    }
  }
  return out;
}

/** `html` and `body` as type selectors become the shadow root and the chapter's body wrapper. */
export function scopeSelectors(/** @type {string} */ prelude) {
  return prelude
    .split(",")
    .map((selector) =>
      selector
        .replace(/(^|[\s>+~(])(?:html|:root)(?=$|[\s>+~.:#[)])/gi, "$1:host")
        .replace(/(^|[\s>+~(])body(?=$|[\s>+~.:#[)])/gi, "$1.body")
        .replace(/:host\s+\.body/g, ":host .body"),
    )
    .join(",");
}

/** @param {string} body @param {CssResolver} resolve */
function declarations(body, resolve) {
  return body
    .replace(URL_PATTERN, (_, a, b, c) => {
      const inlined = resolve.url(a ?? b ?? c ?? "");
      return inlined ? `url("${inlined}")` : "none";
    })
    .replace(/position\s*:\s*fixed/gi, "position: absolute")
    .replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:/gi, "x-blocked:");
}

/**
 * @param {string} css
 * @param {CssResolver} resolve
 * @returns {{ css: string, fonts: Font[] }}
 */
export function sanitizeCss(css, resolve) {
  /** @type {Font[]} */
  const fonts = [];
  /** @returns {string} */
  const walk = (/** @type {string} */ text) =>
    blocks(text)
      .map(({ prelude, body }) => {
        const at = prelude.toLowerCase();
        if (body === undefined)
          return at.startsWith("@charset") || at.startsWith("@namespace") ? `${prelude};` : "";
        if (at.startsWith("@font-face")) {
          const family = /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))/i.exec(body);
          const name = (family?.[1] ?? family?.[2] ?? family?.[3] ?? "").trim();
          for (const match of body.matchAll(URL_PATTERN)) {
            const bytes = resolve.font(match[1] ?? match[2] ?? match[3] ?? "");
            if (name && bytes) {
              fonts.push({ family: name, bytes });
              break;
            }
          }
          return "";
        }
        if (at.startsWith("@import")) return "";
        if (/^@(media|supports|layer|container|document)/.test(at))
          return `${prelude} {\n${walk(body)}\n}`;
        if (at.startsWith("@"))
          return /^@(keyframes|-webkit-keyframes|page)/.test(at) ? `${prelude} {${body}}` : "";
        return `${scopeSelectors(prelude)} {${declarations(body, resolve)}}`;
      })
      .filter(Boolean)
      .join("\n");
  return { css: walk(uncomment(css)), fonts };
}

/** A style="" attribute's declarations, with the same url() and position rules. */
export const sanitizeStyle = (/** @type {string} */ style, /** @type {CssResolver} */ resolve) =>
  declarations(uncomment(style), resolve).replace(/[<>]/g, "");
