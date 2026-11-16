// Secrets typed as they are (no {{variable}}) into a request, a folder's or a collection's
// settings: the auth's passwords, tokens and keys, secret headers, query pairs, form fields and
// variables. literal-secrets.js offers to move them out of the files when saving; the history
// keeps none of them in the desk's store.

import { clone } from "./model.js";
import { isSecretName, varName } from "./secret-names.js";
import { urlFromParams } from "./url.js";

/**
 * @typedef {import("./model.js").Request} Request
 * @typedef {{ label: string, name: string, value: string, put(ref: string): void }} Literal
 *   `put` writes `{{name}}` where the value was.
 */

/** Whether a value is typed as is: not empty and naming no variable. @param {unknown} v */
export const typed = (v) => typeof v === "string" && v.trim() !== "" && !/\{\{[^{}]+\}\}/.test(v);

/** The secrets a request (or a folder's or collection's settings) holds typed as they are. @param {Request} req @returns {Literal[]} */
export function literalSecrets(req) {
  /** @type {Literal[]} */
  const out = [];
  const a = /** @type {any} */ (req.auth ?? {});
  /** @param {any} obj @param {string} key @param {string} label @param {string} name */
  const field = (obj, key, label, name) => {
    if (obj && typed(obj[key]))
      out.push({ label, name, value: obj[key], put: (ref) => (obj[key] = ref) });
  };
  field(a.basic, "password", "Basic auth password", "password");
  field(a.bearer, "token", "Bearer token", "token");
  field(a.apikey, "value", "API key", "apiKey");
  field(a.digest, "password", "Digest password", "password");
  field(a.ntlm, "password", "NTLM password", "password");
  field(a.awsv4, "secretKey", "AWS secret key", "awsSecretKey");
  field(a.awsv4, "session", "AWS session token", "awsSessionToken");
  field(a.oauth2, "clientSecret", "OAuth 2.0 client secret", "clientSecret");
  field(a.oauth2, "password", "OAuth 2.0 password", "password");
  field(a.oauth2, "token", "OAuth 2.0 token", "accessToken");
  for (const row of req.headers ?? []) {
    if (!isSecretName(row.key) || !typed(row.value)) continue;
    const scheme = /^(Bearer|Basic|Token|Digest|Bot)\s+(\S.*)$/i.exec(row.value);
    out.push({
      label: `Header ${row.key}`,
      name: varName(row.key),
      value: scheme ? (scheme[2] ?? "") : row.value,
      put: (ref) => (row.value = scheme ? `${scheme[1]} ${ref}` : ref),
    });
  }
  for (const row of req.params ?? [])
    if (isSecretName(row.key) && typed(row.value))
      out.push({
        label: `Query ${row.key}`,
        name: varName(row.key),
        value: row.value,
        put: (ref) => {
          row.value = ref;
          req.url = urlFromParams(req.url, req.params);
        },
      });
  const body = req.body;
  for (const rows of body ? [body.form, body.multipart] : [])
    for (const row of rows ?? [])
      if (/** @type {any} */ (row).kind !== "file" && isSecretName(row.key) && typed(row.value))
        out.push({
          label: `Body field ${row.key}`,
          name: varName(row.key),
          value: row.value,
          put: (ref) => (row.value = ref),
        });
  for (const list of [req.vars?.pre ?? []])
    for (const row of [...list])
      if (isSecretName(row.key) && typed(row.value))
        out.push({
          label: `Variable ${row.key}`,
          name: row.key,
          value: row.value,
          // The variable itself moves when the secret keeps its name: its row goes, and the
          // secret of that name takes its place; under another name, the row points to it.
          put: (ref) => {
            if (ref === `{{${row.key}}}`) list.splice(list.indexOf(row), 1);
            else row.value = ref;
          },
        });
  return out;
}

/** A copy of a request with every secret typed as is left empty, for keeping. @param {Request} req */
export function withoutLiterals(req) {
  const copy = clone(req);
  for (const lit of literalSecrets(copy)) lit.put("");
  return copy;
}
