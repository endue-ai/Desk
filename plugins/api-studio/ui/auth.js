// Auth as what goes on the wire: a header (Basic, Bearer, an API key, an OAuth 2.0 token), a query
// pair (an API key), or credentials curl answers a challenge with itself (Digest, NTLM) or signs
// with (AWS Signature v4). "Inherit" takes the nearest folder's or the collection's auth.

/**
 * @typedef {import("./model.js").Auth} Auth
 * @typedef {{ headers: { key: string, value: string }[], query: { key: string, value: string }[],
 *   curl?: import("./curl-config.js").CurlAuth }} Applied
 */

export const AUTH_TYPES = /** @type {const} */ ([
  ["inherit", "Inherit from parent"],
  ["none", "No auth"],
  ["basic", "Basic"],
  ["bearer", "Bearer token"],
  ["apikey", "API key"],
  ["oauth2", "OAuth 2.0"],
  ["digest", "Digest"],
  ["ntlm", "NTLM"],
  ["awsv4", "AWS Signature v4"],
]);

/** Base64 of a text's UTF-8 bytes. @param {string} text */
export function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The auth that applies: the request's own unless it inherits, then each parent's from the
 * nearest, ending at "none".
 * @param {Auth} own @param {Auth[]} parents nearest first
 * @returns {{ auth: Auth, from: number }} from: -1 for the request's own, else the parent's index
 */
export function effectiveAuth(own, parents) {
  if (own.type !== "inherit") return { auth: own, from: -1 };
  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i];
    if (parent && parent.type !== "inherit") return { auth: parent, from: i };
  }
  return { auth: { type: "none" }, from: parents.length };
}

/**
 * What an auth adds to a request, its texts already resolved by `fill`. `tokenFor` gives the
 * OAuth 2.0 token fetched for an auth, when its own token field is empty.
 * @param {Auth} auth @param {(text: string) => string} fill @param {(auth: Auth) => string} [tokenFor]
 * @returns {Applied}
 */
export function applyAuth(auth, fill, tokenFor = (/** @type {Auth} */ _a) => "") {
  /** @type {Applied} */
  const out = { headers: [], query: [] };
  const f = (/** @type {unknown} */ v) => fill(String(v ?? ""));
  switch (auth.type) {
    case "basic": {
      const user = f(auth.basic?.username);
      const pass = f(auth.basic?.password);
      if (user || pass)
        out.headers.push({ key: "Authorization", value: `Basic ${base64(`${user}:${pass}`)}` });
      break;
    }
    case "bearer": {
      const token = f(auth.bearer?.token).trim();
      const prefix = f(auth.bearer?.prefix ?? "Bearer").trim();
      if (token)
        out.headers.push({ key: "Authorization", value: prefix ? `${prefix} ${token}` : token });
      break;
    }
    case "apikey": {
      const key = f(auth.apikey?.key).trim();
      const value = f(auth.apikey?.value);
      if (key) (auth.apikey?.in === "query" ? out.query : out.headers).push({ key, value });
      break;
    }
    case "oauth2": {
      const token = f(auth.oauth2?.token).trim() || tokenFor(auth);
      const prefix = f(auth.oauth2?.prefix ?? "Bearer").trim();
      if (token)
        out.headers.push({ key: "Authorization", value: prefix ? `${prefix} ${token}` : token });
      break;
    }
    case "digest":
    case "ntlm": {
      const creds = auth.type === "digest" ? auth.digest : auth.ntlm;
      out.curl = { mode: auth.type, user: `${f(creds?.username)}:${f(creds?.password)}` };
      break;
    }
    case "awsv4": {
      const a = auth.awsv4;
      const region = f(a?.region).trim();
      const service = f(a?.service).trim();
      const provider = ["aws", "amz", region, service].filter((part, i) => i < 2 || part).join(":");
      out.curl = { mode: "awsv4", user: `${f(a?.accessKey)}:${f(a?.secretKey)}`, provider };
      const session = f(a?.session).trim();
      if (session) out.headers.push({ key: "X-Amz-Security-Token", value: session });
      break;
    }
    default:
      break;
  }
  return out;
}

/** The fields of each auth type's form: key path, label, and whether it is a secret. */
export const AUTH_FIELDS =
  /** @type {Record<string, { key: string, label: string, secret?: boolean, placeholder?: string }[]>} */ ({
    basic: [
      { key: "basic.username", label: "Username" },
      { key: "basic.password", label: "Password", secret: true },
    ],
    bearer: [
      { key: "bearer.token", label: "Token", secret: true, placeholder: "{{token}}" },
      { key: "bearer.prefix", label: "Prefix", placeholder: "Bearer" },
    ],
    digest: [
      { key: "digest.username", label: "Username" },
      { key: "digest.password", label: "Password", secret: true },
    ],
    ntlm: [
      { key: "ntlm.username", label: "Username", placeholder: "DOMAIN\\user" },
      { key: "ntlm.password", label: "Password", secret: true },
    ],
    awsv4: [
      { key: "awsv4.accessKey", label: "Access key", placeholder: "{{awsAccessKey}}" },
      { key: "awsv4.secretKey", label: "Secret key", secret: true },
      { key: "awsv4.session", label: "Session token", secret: true, placeholder: "Optional" },
      { key: "awsv4.region", label: "Region", placeholder: "us-east-1" },
      { key: "awsv4.service", label: "Service", placeholder: "execute-api" },
    ],
  });

/** Read `a.b` from an auth. @param {any} auth @param {string} path */
export function getPath(auth, path) {
  const [head, tail] = path.split(".");
  return String(auth?.[head ?? ""]?.[tail ?? ""] ?? "");
}

/** Set `a.b` on an auth. @param {any} auth @param {string} path @param {string} value */
export function setPath(auth, path, value) {
  const [head = "", tail = ""] = path.split(".");
  auth[head] = { ...(auth[head] ?? {}), [tail]: value };
}
