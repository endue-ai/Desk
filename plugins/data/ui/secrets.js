// Which values are secrets: every dotenv value, and in every format the values whose key looks like
// a secret (password, passwd, secret, token, api_key, apikey, private_key, in any case, with - and _
// alike). Keys are split into words (snake, kebab, dotted and camel case), so max_tokens and
// tokenizer stay visible and DB_PASSWORD, clientSecret and x-api-key do not. Masked values never
// reach the DOM: the view draws dots until the person reveals one.

import { childrenOf, isBranch } from "./tree.js";

/** @typedef {import("./tree.js").DataNode} DataNode */

const WORDS = new Set(["password", "passwd", "secret", "token", "apikey", "privatekey"]);
const PAIRS = new Set(["api key", "private key"]);
/** @type {Map<string, boolean>} */
const known = new Map();

/** @param {string} key */
const words = (key) =>
  key
    .replace(/^@/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Whether a key looks like it names a secret.
 * @param {unknown} key
 */
export function isSecretKey(key) {
  if (typeof key !== "string" || key === "") return false;
  const cached = known.get(key);
  if (cached !== undefined) return cached;
  const parts = words(key);
  const found = parts.some(
    (word, i) => WORDS.has(word) || PAIRS.has(`${word} ${parts[i + 1] ?? ""}`),
  );
  if (known.size > 10_000) known.clear();
  known.set(key, found);
  return found;
}

/**
 * Whether the last node of a chain (root first) shows as dots: a scalar marked secret, or a scalar
 * at or under a key that looks like a secret when the key rule is on.
 * @param {DataNode[]} chain
 * @param {boolean} keys
 */
export function isMasked(chain, keys) {
  const node = chain.at(-1);
  if (!node || isBranch(node)) return false;
  if (node.secret) return true;
  return keys && chain.some((link, i) => i > 0 && isSecretKey(link.key));
}

/**
 * The source ranges the raw view masks, sorted: every secret value, and with the key rule every
 * value under a secret-looking key. JSON's lazy tree brings its own key ranges from its one pass.
 * @param {import("./tree.js").DataDoc} doc
 * @param {boolean} keys
 * @returns {Array<[number, number]>}
 */
export function maskRanges(doc, keys) {
  if (doc.secretRanges) return keys ? [...doc.secretRanges].sort((a, b) => a[0] - b[0]) : [];
  /** @type {Array<[number, number]>} */
  const out = [];
  /** @param {DataNode} node @param {boolean} under */
  const visit = (node, under) => {
    const here = under || (keys && isSecretKey(node.key));
    if (isBranch(node)) {
      for (const child of childrenOf(node)) visit(child, here);
    } else if ((node.secret || here) && node.from !== undefined && node.to !== undefined) {
      out.push([node.from, node.to]);
    }
  };
  for (const root of doc.roots) visit(root, false);
  return out.sort((a, b) => a[0] - b[0]);
}
