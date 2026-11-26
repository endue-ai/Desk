// Which names hold secrets, and texts with their secrets hidden. A header, query pair, form field
// or JSON key is secret when its name says so (Authorization, Cookie, X-API-Key, Private-Token,
// access_token, clientSecret, password…); what an assistant or an agent reads, and what a copied
// snippet shows, has those values and every secret variable's value swapped for a stand-in.

const SEP = "[-_.\\s]";
/**
 * Secret words between separators, after camelCase is split: x-api-key, access_token, clientSecret.
 * Any name ending in a key is secret (X-Functions-Key, DD-Application-Key, encryption_key, `?key=`)
 * but the keys that only name or order something; a session only as itself or its id or token; a
 * token not when it pages through results or names a token's URL or type.
 */
const WORDS = new RegExp(
  [
    `(^|${SEP})(authorization|cookie|token|secret|password|passwd|pwd|apikey|signature|credentials?|jwt|bearer)($|${SEP})`,
    `(^|${SEP})(api|access|secret|private|client|subscription|license|master|signing|auth)${SEP}?key($|${SEP})`,
    `(^|${SEP})key$`,
    `(^|${SEP})session(${SEP}?(id|token|key))?$`,
    `(^|${SEP})auth$`,
    "^sid$",
  ].join("|"),
  "i",
);
/** Names that only look secret: paging tokens, a token's URL or type, keys that name or order things. */
const NOT_SECRET = new RegExp(
  [
    `(page|next|continuation|cursor|sync)${SEP}?(page${SEP}?)?token$`,
    `token${SEP}(url|uri|endpoint|type|ttl|expires?(${SEP}(in|at))?)$`,
    `(^|${SEP})(idempotency|websocket|socket|sort|partition|primary|foreign|cache|routing|group|object|lookup|unique|index|hash|range|row|composite|public|issue|project|item|message|dedup|deduplication)${SEP}key$`,
    `key${SEP}id$`,
  ].join("|"),
  "i",
);

/** Whether a header's, parameter's or field's name says it holds a secret. @param {string} name */
export function isSecretName(name) {
  const split = String(name)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return split !== "" && WORDS.test(split) && !NOT_SECRET.test(split);
}

/**
 * Whether a field of a JSON body is secret: as a name is, but a bare `key`, `auth` or `sid` there
 * is mostly an identifier (`{"project": {"key": "PROJ"}}`), so it is not taken for one.
 * @param {string} name
 */
export function isSecretField(name) {
  return isSecretName(name) && !/^(key|auth|sid)$/i.test(String(name).trim());
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

/**
 * A text with each of `values` replaced by the stand-in, as typed and as a URL or a form would
 * carry it (percent-encoded, spaces as +). @param {string} text @param {string[]} values
 */
export function hideValues(text, values) {
  let out = text;
  for (const v of values) {
    const encoded = encodeURIComponent(v);
    for (const form of new Set([v, encoded, encoded.replace(/%20/g, "+")]))
      out = out.split(form).join(HIDDEN);
  }
  return out;
}

/**
 * A check's or test's failure as an agent or the assistant may read it: hidden whole when what it
 * checks is a secret (res.body.access_token, res.headers.authorization), else with secret values
 * and pairs hidden. @param {string} target @param {string} message @param {string[]} values
 */
export function hideFailure(target, message, values) {
  const last =
    target
      .split(/[.[\]'"]+/)
      .filter(Boolean)
      .pop() ?? "";
  return isSecretName(last) ? `${target}: failed (its value is hidden)` : hideText(message, values);
}

/** A JSON value with the values of secret keys hidden, all the way down. @param {unknown} value @returns {unknown} */
export function hideJson(value) {
  if (Array.isArray(value)) return value.map(hideJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        isSecretName(k) && v !== null && (typeof v === "object" || !isReference(String(v)))
          ? HIDDEN
          : hideJson(v),
      ]),
    );
  return value;
}

/**
 * Whether a body's text has a secret field with a value in it: a JSON field (as isSecretField
 * reads it) or a `name=value` pair. @param {string} text
 */
export function hasSecretFields(text) {
  const t = text.trim();
  if (/^[[{]/.test(t))
    try {
      /** @param {unknown} v @returns {boolean} */
      const walk = (v) =>
        !!v &&
        typeof v === "object" &&
        Object.entries(v).some(([k, x]) =>
          typeof x === "string" ? isSecretField(k) && x !== "" : walk(x),
        );
      return walk(JSON.parse(t));
    } catch {
      /* not JSON */
    }
  return [...text.matchAll(/(?:^|[&\s])([A-Za-z][\w.-]*)=([^&\s]+)/g)].some(([, k]) =>
    isSecretName(k ?? ""),
  );
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
