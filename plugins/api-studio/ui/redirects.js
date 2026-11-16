// Redirects for a request that carries a secret. curl itself drops only Authorization and Cookie
// when a redirect leads to another host, and sends every other header there (X-API-Key and the
// like), so such a request does not let curl follow: the studio follows each hop itself. On every
// hop to another origin it drops the secret headers (the jar's cookies for the origin left among
// them), the credentials and the secrets in the query, and takes the jar's cookies for the new
// origin only when the request uses the jar. A 307 or 308 to another origin would send the body
// again, so a body with a secret stops there. The hops, their time and the last answer read as one
// response, as curl's own would.

import { readResponse } from "./send.js";

/**
 * @typedef {import("./curl-config.js").Prepared} Prepared
 * @typedef {import("./engine.js").RunResult} RunResult
 * @typedef {{ status: number, reason: string, location: string }} Hop
 * @typedef {{ run: RunResult, prep: Prepared, hops: Hop[], redirectMs: number }} Followed
 */

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Whether a text holds one of the secrets, as typed or percent-encoded. @param {string} text @param {string[]} secrets */
const holds = (text, secrets) =>
  secrets.some((v) => v && (text.includes(v) || text.includes(encodeURIComponent(v))));

/** Whether a request's body carries a secret. @param {Prepared} prep */
export function bodyHoldsSecret(prep) {
  const secrets = prep.secrets ?? [];
  if (prep.body.kind === "raw") return holds(prep.body.text, secrets);
  if (prep.body.kind === "multipart")
    return prep.body.parts.some((p) => !p.file && holds(p.value, secrets));
  return false;
}

/**
 * Whether a request must follow its redirects in the studio rather than in curl: it follows them,
 * and a header, its credentials, its query or its body carry a secret. @param {Prepared} prep
 */
export function followsItself(prep) {
  return (
    prep.settings.followRedirects &&
    (prep.headers.some((h) => h.secret) ||
      !!prep.auth ||
      holds(prep.url, prep.secrets ?? []) ||
      bodyHoldsSecret(prep))
  );
}

/** The origin of a URL, or the URL itself when it does not parse. @param {string} url */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * The request for the next hop: the method and body a browser and curl would use, and, when the
 * hop goes to another origin (`away`), nothing secret but the new origin's own cookies.
 * @param {Prepared} prep @param {number} status @param {string} next @param {boolean} away
 * @param {((url: string) => string) | undefined} cookies the jar, when the request uses it
 * @returns {Prepared}
 */
export function nextHop(prep, status, next, away, cookies) {
  const toGet =
    (status === 303 && prep.method !== "HEAD") ||
    ((status === 301 || status === 302) && prep.method === "POST");
  let headers = prep.headers;
  if (toGet) headers = headers.filter((h) => !/^content-(type|length)$/i.test(h.key));
  let url = next;
  if (away) {
    headers = headers.filter((h) => !h.secret);
    const jar = cookies?.(next);
    if (jar) headers = [...headers, { key: "Cookie", value: jar, secret: true }];
    url = withoutSecretQuery(next, prep.secrets ?? []);
  }
  const { auth: _auth, ...rest } = prep;
  return {
    ...(away ? rest : prep),
    method: toGet ? "GET" : prep.method,
    url,
    headers,
    body: toGet ? { kind: "none" } : prep.body,
  };
}

/** A URL without the query pairs whose value is a secret. @param {string} url @param {string[]} secrets */
function withoutSecretQuery(url, secrets) {
  if (!secrets.length) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of [...u.searchParams])
      if (secrets.some((s) => v.includes(s))) u.searchParams.delete(k);
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Send a request, following its redirects hop by hop. Gives back the last hop's run with the
 * hops before it, or a cancel that stops the hop in flight and every one after.
 * @param {{ send(prep: Prepared, hooks?: any): import("./engine.js").Running }} engine
 * @param {Prepared} prep @param {{ hooks?: any, cookies?: (url: string) => string }} [options]
 * @returns {{ promise: Promise<Followed>, cancel(): void }}
 */
export function sendFollowing(engine, prep, options = {}) {
  let stopped = false;
  /** @type {import("./engine.js").Running | undefined} */
  let current;
  const promise = (async () => {
    /** @type {Hop[]} */
    const hops = [];
    let redirectMs = 0;
    let at = { ...prep, settings: { ...prep.settings, followRedirects: false } };
    for (;;) {
      current = engine.send(at, options.hooks);
      const run = await current.promise;
      const res = readResponse(run, at, "", []);
      const location = res.headers.find(([k]) => k.toLowerCase() === "location")?.[1];
      if (
        stopped ||
        res.error ||
        !REDIRECTS.has(res.status) ||
        !location ||
        hops.length >= Math.max(0, Math.floor(prep.settings.maxRedirects))
      )
        return { run, prep: at, hops, redirectMs };
      let next;
      try {
        next = new URL(location, at.url).href;
      } catch {
        return { run, prep: at, hops, redirectMs };
      }
      if (!/^https?:/i.test(next)) return { run, prep: at, hops, redirectMs };
      const away = originOf(next) !== originOf(at.url);
      if (away && (res.status === 307 || res.status === 308) && bodyHoldsSecret(at))
        return { run, prep: at, hops, redirectMs };
      hops.push({ status: res.status, reason: res.reason, location });
      redirectMs += res.timings.total;
      at = nextHop(at, res.status, next, away, prep.settings.cookies ? options.cookies : undefined);
    }
  })();
  return {
    promise,
    cancel: () => {
      stopped = true;
      current?.cancel();
    },
  };
}
