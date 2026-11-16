// The URL bar and the Params table are two views of one thing: typing a query string makes rows,
// editing rows rewrites the query. Values stay as typed ({{variables}} included); encoding happens
// only when the request is sent (`encodeQuery`). Disabled rows live only in the table.

import { pair } from "./model.js";

/** @typedef {import("./model.js").Pair} Pair */

/** Split a URL as typed into what comes before `?`, the query and the fragment. @param {string} url */
export function splitUrl(url) {
  const hash = url.indexOf("#");
  const fragment = hash >= 0 ? url.slice(hash) : "";
  const rest = hash >= 0 ? url.slice(0, hash) : url;
  const q = rest.indexOf("?");
  return {
    base: q >= 0 ? rest.slice(0, q) : rest,
    query: q >= 0 ? rest.slice(q + 1) : undefined,
    fragment,
  };
}

/** Decode a query component as typed; a broken escape stays as it was. @param {string} text */
function decodeLoose(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/** The query's pairs, in order, decoded for reading. @param {string | undefined} query @returns {{ key: string, value: string }[]} */
export function parseQuery(query) {
  if (!query) return [];
  return query
    .split("&")
    .filter((part) => part !== "")
    .map((part) => {
      const eq = part.indexOf("=");
      const key = eq >= 0 ? part.slice(0, eq) : part;
      const value = eq >= 0 ? part.slice(eq + 1) : "";
      return { key: decodeLoose(key), value: decodeLoose(value) };
    });
}

/**
 * The Params rows after the URL was typed: the query's pairs in order, keeping each row's id,
 * description and the disabled rows that were there.
 * @param {string} url @param {Pair[]} previous @returns {Pair[]}
 */
export function paramsFromUrl(url, previous) {
  const parsed = parseQuery(splitUrl(url).query);
  const enabled = previous.filter((p) => p.on);
  /** @type {Pair[]} */
  const out = parsed.map((entry, i) => {
    const old = enabled[i];
    return old
      ? { ...old, key: entry.key, value: entry.value }
      : pair({ key: entry.key, value: entry.value });
  });
  // Disabled rows keep their place relative to the enabled rows before them.
  const result = [];
  let taken = 0;
  for (const row of previous) {
    if (row.on) {
      if (taken < out.length) result.push(out[taken++]);
    } else result.push(row);
  }
  while (taken < out.length) result.push(out[taken++]);
  return result;
}

/**
 * Encode for the URL bar only what would read back differently (%, &, #, +, and = in a name), so
 * a row survives the trip through the URL; spaces and {{variables}} stay as typed.
 * @param {string} text @param {boolean} key
 */
function encodeTyped(text, key) {
  return text.replace(key ? /[%&#+=]/g : /[%&#+]/g, (ch) => encodeURIComponent(ch));
}

/** The URL after the Params rows changed: the enabled rows as its query. @param {string} url @param {Pair[]} params */
export function urlFromParams(url, params) {
  const { base, fragment } = splitUrl(url);
  const parts = params
    .filter((p) => p.on && (p.key !== "" || p.value !== ""))
    .map((p) =>
      p.value === ""
        ? encodeTyped(p.key, true)
        : `${encodeTyped(p.key, true)}=${encodeTyped(p.value, false)}`,
    );
  return `${base}${parts.length ? `?${parts.join("&")}` : ""}${fragment}`;
}

/** Percent-encode a component for the wire, leaving {{…}} out of it (already resolved by then). @param {string} text */
export function encodeComponent(text) {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The URL to send: a scheme added when missing (http for local hosts, https otherwise), the query
 * rebuilt from the rows with every component encoded, and extra query pairs (an API key) added.
 * @param {string} url @param {{ key: string, value: string }[]} params @param {boolean} [encode]
 */
export function wireUrl(url, params, encode = true) {
  let { base, fragment } = splitUrl(url.trim());
  if (base && !/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(base);
    base = `${local ? "http" : "https"}://${base}`;
  }
  const enc = encode ? encodeComponent : (/** @type {string} */ t) => t;
  const query = params
    .map((p) => (p.value === "" && p.key !== "" ? enc(p.key) : `${enc(p.key)}=${enc(p.value)}`))
    .join("&");
  return `${encodeSpaces(base)}${query ? `?${query}` : ""}${fragment}`;
}

/** Spaces in a path are encoded; everything else in it is left as typed. @param {string} text */
function encodeSpaces(text) {
  return text.replace(/ /g, "%20");
}

/** The host of a URL as typed, for labels; empty when there is none yet. @param {string} url */
export function hostOf(url) {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#]+)/i.exec(url.trim());
  return match?.[1] ?? "";
}

/** The path variables a URL names as :name segments, in order. @param {string} url */
export function pathVariables(url) {
  const { base } = splitUrl(url);
  const path = base.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  return [...path.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => m[1] ?? "");
}
