// Which names hold secrets, and texts with their secrets hidden. A header, query pair, form field
// or JSON key is secret when its name says so (Authorization, Cookie, X-API-Key, Private-Token,
// access_token, clientSecret, password…); what an assistant or an agent reads, and what a copied
// snippet shows, has those values and every secret variable's value swapped for a stand-in.

/** Secret words between separators, after camelCase is split: x-api-key, access_token, clientSecret. */
const WORDS =
  /(^|[-_.\s])(authorization|cookie|token|secret|password|passwd|pwd|apikey|api[-_]key|auth|session|signature|credentials?|jwt)($|[-_.\s])|(^|[-_.\s])key$/i;

/** Whether a header's, parameter's or field's name says it holds a secret. @param {string} name */
export function isSecretName(name) {
  const split = String(name)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return split !== "" && WORDS.test(split);
}

/** Whether a value is only a {{variable}}, which names a secret without holding it. @param {string} v */
const isReference = (v) => /^\{\{[^{}]+\}\}$/.test(v.trim().replace(/^"|"$/g, ""));

/** A name for a variable from a header's or field's name: X-API-Key → xApiKey. @param {string} name */
export function varName(name) {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  return out || "secret";
}

/** What a hidden value reads as. */
export const HIDDEN = "(hidden)";

/** Every secret variable's value in reach, longest first, for hiding where they turn up. @param {import("./vars.js").Scope[]} scopes */
export function secretValues(scopes) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const s of scopes)
    for (const key of s.secret ?? []) {
      const value = s.values.get(key);
      if (value && value.length >= 4) out.add(value);
    }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Scopes without their secrets: what a request an agent wrote may fill in. A name drops out when
 * its scope keeps it secret or when the name itself says secret (a captured `token`); each scope
 * still knows the names it held back. @param {import("./vars.js").Scope[]} scopes
 * @returns {import("./vars.js").Scope[]}
 */
export function withoutSecrets(scopes) {
  return scopes.map((s) => {
    const held = new Set([...s.values.keys()].filter((k) => s.secret?.has(k) || isSecretName(k)));
    if (!held.size) return s;
    return {
      ...s,
      values: new Map([...s.values].filter(([k]) => !held.has(k))),
      secret: new Set([...(s.secret ?? []), ...held]),
    };
  });
}

/** A text with each of `values` replaced by the stand-in. @param {string} text @param {string[]} values */
export function hideValues(text, values) {
  let out = text;
  for (const v of values) out = out.split(v).join(HIDDEN);
  return out;
}

/** A JSON value with the values of secret keys hidden, all the way down. @param {unknown} value @returns {unknown} */
export function hideJson(value) {
  if (Array.isArray(value)) return value.map(hideJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        isSecretName(k) && v !== null && typeof v !== "object" && !isReference(String(v))
          ? HIDDEN
          : hideJson(v),
      ]),
    );
  return value;
}

/** `name=value`, `"name": "value"` and `name: value` pairs whose name is secret. */
const PAIRS =
  /("?)([A-Za-z][\w.-]*)\1([ \t]*[:=][ \t]*)("(?:[^"\\]|\\.)*"|[^\s&,;"'}<]+(?:[ \t]+[^\s&,;"'}<]+)*)/g;

/**
 * A body or other text with its secrets hidden: JSON by its keys, other text by its name=value
 * and name: value pairs, then every known secret value wherever it is.
 * @param {string} text @param {string[]} [values]
 */
export function hideText(text, values = []) {
  let out = text;
  const t = text.trim();
  let json = false;
  if (/^[[{]/.test(t))
    try {
      out = JSON.stringify(hideJson(JSON.parse(t)), null, t.includes("\n") ? 2 : undefined);
      json = true;
    } catch {
      /* not JSON */
    }
  if (!json)
    out = out.replace(PAIRS, (whole, q, name, sep, value) =>
      isSecretName(name) && !isReference(value)
        ? `${q}${name}${q}${sep}${value.startsWith('"') ? `"${HIDDEN}"` : HIDDEN}`
        : whole,
    );
  return hideValues(out, values);
}

/** A URL with the values of its secret query pairs hidden. @param {string} url @param {string[]} [values] */
export function hideUrl(url, values = []) {
  const at = url.indexOf("?");
  const shown =
    at < 0
      ? url
      : `${url.slice(0, at)}?${url
          .slice(at + 1)
          .split("&")
          .map((pair) => {
            const eq = pair.indexOf("=");
            const name = decodeSafe(eq < 0 ? pair : pair.slice(0, eq));
            return eq >= 0 && isSecretName(name) && !isReference(decodeSafe(pair.slice(eq + 1)))
              ? `${pair.slice(0, eq)}=${HIDDEN}`
              : pair;
          })
          .join("&")}`;
  return hideValues(shown, values);
}

/** @param {string} text */
function decodeSafe(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}
