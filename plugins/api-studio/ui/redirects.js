// Redirects for a request that carries a secret. curl itself drops only Authorization and Cookie
// when a redirect leads to another host, and sends every other header there (X-API-Key and the
// like), so such a request does not let curl follow: the studio follows each hop itself, and from
// the first hop to another origin on it sends no secret header, no credentials and no secret in
// the query. The hops, their time and the last answer read as one response, as curl's own would.

import { readResponse } from "./send.js";

/**
 * @typedef {import("./curl-config.js").Prepared} Prepared
 * @typedef {import("./engine.js").RunResult} RunResult
 * @typedef {{ status: number, reason: string, location: string }} Hop
 * @typedef {{ run: RunResult, prep: Prepared, hops: Hop[], redirectMs: number }} Followed
 */

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Whether a request must follow its redirects in the studio rather than in curl: it follows them,
 * and a header, its credentials or its query carry a secret. @param {Prepared} prep
 */
export function followsItself(prep) {
  return (
    prep.settings.followRedirects &&
    (prep.headers.some((h) => h.secret) ||
      !!prep.auth ||
      (prep.secrets ?? []).some(
        (v) => prep.url.includes(v) || prep.url.includes(encodeURIComponent(v)),
      ))
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
 * The request for the next hop: the method and body a browser and curl would use, and, once the
 * hop leaves the first origin, nothing secret.
 * @param {Prepared} prep @param {number} status @param {string} next @param {boolean} away
 * @param {((url: string) => string) | undefined} cookies
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
    // Once away, nothing secret is left to guard, so the rest of the way may follow as usual.
    ...(away ? { secrets: [] } : {}),
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
    const first = originOf(prep.url);
    let away = false;
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
      hops.push({ status: res.status, reason: res.reason, location });
      redirectMs += res.timings.total;
      const leaving = !away && originOf(next) !== first;
      at = nextHop(at, res.status, next, leaving, options.cookies);
      if (leaving) away = true;
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
