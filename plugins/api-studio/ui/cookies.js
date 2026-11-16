// The cookie jar: what servers set with Set-Cookie, kept per domain in the desk's store, and sent
// back as a Cookie header to the URLs each cookie matches (domain, path, secure, not expired), as
// a browser would. A request that names its own Cookie header sends that one instead.

/**
 * @typedef {{ name: string, value: string, domain: string, path: string, expires: number | null,
 *   secure: boolean, httpOnly: boolean, sameSite: string, hostOnly: boolean }} Cookie
 */

/** One Set-Cookie line as a cookie for the URL that set it. @param {string} line @param {URL} url @param {number} [now] @returns {Cookie | undefined} */
export function parseSetCookie(line, url, now = Date.now()) {
  const [first = "", ...attrs] = line.split(";");
  const eq = first.indexOf("=");
  if (eq <= 0) return undefined;
  /** @type {Cookie} */
  const cookie = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim(),
    domain: url.hostname.toLowerCase(),
    path: defaultPath(url.pathname),
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: "",
    hostOnly: true,
  };
  for (const attr of attrs) {
    const at = attr.indexOf("=");
    const key = (at >= 0 ? attr.slice(0, at) : attr).trim().toLowerCase();
    const value = at >= 0 ? attr.slice(at + 1).trim() : "";
    if (key === "domain" && value) {
      const d = value.replace(/^\./, "").toLowerCase();
      if (!domainMatch(cookie.domain, d)) return undefined;
      cookie.domain = d;
      cookie.hostOnly = false;
    } else if (key === "path" && value.startsWith("/")) cookie.path = value;
    else if (key === "max-age" && /^-?\d+$/.test(value))
      cookie.expires = now + Number(value) * 1000;
    else if (key === "expires" && cookie.expires === null) {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) cookie.expires = t;
    } else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "samesite") cookie.sameSite = value;
  }
  return cookie;
}

/** @param {string} path */
function defaultPath(path) {
  if (!path.startsWith("/") || path === "/") return "/";
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

/** Whether a host is a domain or below it. @param {string} host @param {string} domain */
export function domainMatch(host, domain) {
  return host === domain || (host.endsWith(`.${domain}`) && !/^\d+\.\d+\.\d+\.\d+$/.test(host));
}

/** @param {string} reqPath @param {string} cookiePath */
function pathMatch(reqPath, cookiePath) {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || reqPath[cookiePath.length] === "/";
}

/** @param {{ load(): Promise<Cookie[] | undefined>, save(list: Cookie[]): void }} store */
export function createJar(store) {
  /** @type {Cookie[]} */
  let list = [];
  const live = (/** @type {number} */ now) =>
    list.filter((c) => c.expires === null || c.expires > now);
  return {
    async start() {
      list = (await store.load()) ?? [];
    },
    get all() {
      return live(Date.now());
    },
    /** Keep what a response set. @param {string} url @param {[string, string][]} headers */
    take(url, headers, now = Date.now()) {
      let u;
      try {
        u = new URL(url);
      } catch {
        return 0;
      }
      let n = 0;
      for (const [k, v] of headers) {
        if (k.toLowerCase() !== "set-cookie") continue;
        const c = parseSetCookie(v, u, now);
        if (!c) continue;
        list = list.filter(
          (o) => !(o.name === c.name && o.domain === c.domain && o.path === c.path),
        );
        if (c.expires === null || c.expires > now) list.push(c);
        n++;
      }
      if (n) store.save(live(now));
      return n;
    },
    /** The Cookie header for a URL, or "". @param {string} url */
    header(url, now = Date.now()) {
      let u;
      try {
        u = new URL(url);
      } catch {
        return "";
      }
      const host = u.hostname.toLowerCase();
      return live(now)
        .filter((c) => (c.hostOnly ? c.domain === host : domainMatch(host, c.domain)))
        .filter((c) => pathMatch(u.pathname || "/", c.path))
        .filter(
          (c) =>
            !c.secure || u.protocol === "https:" || host === "localhost" || host === "127.0.0.1",
        )
        .sort((a, b) => b.path.length - a.path.length)
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
    },
    /** Remove cookies: one, a domain's, or all. @param {{ domain?: string, name?: string }} [which] */
    clear(which = {}) {
      list = list.filter(
        (c) => (which.domain && c.domain !== which.domain) || (which.name && c.name !== which.name),
      );
      store.save(list);
    },
  };
}
