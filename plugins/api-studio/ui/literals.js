// Secrets typed as they are (no {{variable}}) into what a request's, a folder's or a collection's
// file holds: the auth's passwords, tokens and keys (when the auth is written: not when it
// inherits), a password in the URL, secret headers, query pairs, fields of the body in use (form,
// multipart, JSON, GraphQL variables) and variables. literal-secrets.js offers to move them out of
// the files when saving; the history keeps none of them in the desk's store.

import { clone } from "./model.js";
import { hideText, isSecretField, isSecretName, varName } from "./secret-names.js";
import { urlFromParams } from "./url.js";

/**
 * @typedef {import("./model.js").Request} Request
 * @typedef {{ label: string, name: string, value: string, put(ref: string): void }} Literal
 *   `put` writes `{{name}}` where the value was.
 */

/** Whether a value is typed as is: not empty and naming no variable. @param {unknown} v */
export const typed = (v) => typeof v === "string" && v.trim() !== "" && !/\{\{[^{}]+\}\}/.test(v);

/**
 * The secrets a request (or a folder's or collection's settings) holds typed as they are.
 * `authDefault` is the auth type its file leaves out (inherit, or none for a collection).
 * @param {Request} req @param {{ authDefault?: string }} [options] @returns {Literal[]}
 */
export function literalSecrets(req, options = {}) {
  /** @type {Literal[]} */
  const out = [];
  const written = (req.auth?.type ?? "inherit") !== (options.authDefault ?? "inherit");
  const a = /** @type {any} */ (written ? (req.auth ?? {}) : {});
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
  const user = /^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]*):([^/?#@]+)@/i.exec(req.url ?? "");
  if (user && typed(user[2]))
    out.push({
      label: "Password in the URL",
      name: "password",
      // As the URL holds it (percent-encoded), so filling it back in gives the same URL.
      value: user[2] ?? "",
      put: (ref) => {
        req.url = req.url.replace(`${user[1]}:${user[2]}@`, `${user[1]}:${ref}@`);
      },
    });
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
  const rowsInUse =
    body?.mode === "form" ? body.form : body?.mode === "multipart" ? body.multipart : [];
  for (const rows of [rowsInUse])
    for (const row of rows ?? [])
      if (/** @type {any} */ (row).kind !== "file" && isSecretName(row.key) && typed(row.value))
        out.push({
          label: `Body field ${row.key}`,
          name: varName(row.key),
          value: row.value,
          put: (ref) => (row.value = ref),
        });
  if (body?.mode === "json")
    out.push(
      ...jsonFields(
        () => body.json,
        (text) => (body.json = text),
        "Body field",
      ),
    );
  if (body?.mode === "graphql")
    out.push(
      ...jsonFields(
        () => body.graphql.variables,
        (text) => (body.graphql.variables = text),
        "GraphQL variable",
      ),
    );
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

/**
 * The secret fields of a JSON text. Moving one rewrites only that value in the text, so the rest
 * (its numbers, order and spacing) stays as typed; nothing when the text is not JSON (one with
 * {{variables}} outside strings, say).
 * @param {() => string} read @param {(text: string) => void} write @param {string} label
 * @returns {Literal[]}
 */
function jsonFields(read, write, label) {
  let doc;
  try {
    doc = JSON.parse(read());
  } catch {
    return [];
  }
  /** @type {Literal[]} */
  const out = [];
  const walk = (/** @type {any} */ node) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && isSecretField(k) && typed(v))
        out.push({
          label: `${label} ${k}`,
          name: varName(k),
          value: v,
          put: (ref) => {
            const text = read();
            const pair = new RegExp(
              `(${literally(JSON.stringify(k))}\\s*:\\s*)${literally(JSON.stringify(v))}`,
            );
            if (pair.test(text))
              write(text.replace(pair, (_m, head) => `${head}${JSON.stringify(ref)}`));
            else {
              node[k] = ref;
              write(JSON.stringify(doc, null, text.includes("\n") ? 2 : undefined));
            }
          },
        });
      else walk(v);
    }
  };
  walk(doc);
  return out;
}

/** A text as a regular expression that matches it as is. @param {string} text */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * A copy of a request with every secret typed as is left empty, and text bodies' secret pairs
 * hidden, for keeping in the history. @param {Request} req
 */
export function withoutLiterals(req) {
  const copy = clone(req);
  const b = copy.body;
  // Every body the request keeps, not only the one in use: the history keeps them all.
  const mode = b?.mode;
  for (const each of /** @type {const} */ (["form", "multipart", "json", "graphql"])) {
    if (!b) break;
    b.mode = each;
    for (const lit of literalSecrets(copy, { authDefault: "" })) lit.put("");
  }
  if (b && mode) b.mode = mode;
  for (const mode of /** @type {const} */ (["text", "xml"]))
    if (b?.[mode]) b[mode] = hideText(b[mode]);
  return copy;
}
