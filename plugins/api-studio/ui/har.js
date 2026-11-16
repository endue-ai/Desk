// A browser's HAR file as a collection of the requests it recorded. A recording holds the
// session it was made in (Authorization, Cookie, API keys, tokens in the query or the form), so
// those values do not go into the request files: each becomes a secret variable of a "Recorded"
// environment, kept in the desk, and the request says {{name}} where the value was.

import { newRequest, pair } from "./model.js";
import { isSecretName, varName } from "./secret-names.js";
import { paramsFromUrl, urlFromParams } from "./url.js";

/** @typedef {import("./openapi.js").Imported} Imported */

/** The secrets of a recording, one variable per distinct value. */
function secretKeeper() {
  /** @type {{ key: string, value: string, secret: boolean }[]} */
  const vars = [];
  /** A {{reference}} for a value seen under a name. @param {string} name @param {string} value */
  const ref = (name, value) => {
    const same = vars.find((v) => v.value === value);
    if (same) return `{{${same.key}}}`;
    const base = varName(name);
    let key = base;
    for (let n = 2; vars.some((v) => v.key === key); n++) key = `${base}${n}`;
    vars.push({ key, value, secret: true });
    return `{{${key}}}`;
  };
  return { vars, ref };
}

/** A collection of the requests a HAR file recorded. @param {any} har @returns {Imported} */
export function fromHar(har) {
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  const keeper = secretKeeper();
  /** @param {string} name @param {string} value */
  const hide = (name, value) =>
    isSecretName(name) && value.trim() && !/\{\{[^{}]+\}\}/.test(value)
      ? keeper.ref(name, value)
      : value;
  /** @type {import("./model.js").Request[]} */
  const requests = [];
  for (const [n, e] of entries.entries()) {
    const r = e.request;
    if (!r?.url || !r.method) continue;
    let path = r.url;
    try {
      const u = new URL(r.url);
      path = `${u.host}${u.pathname}`;
    } catch {
      /* as written */
    }
    const req = newRequest({
      name: `${path}`.slice(0, 80),
      method: String(r.method).toUpperCase(),
      url: r.url,
      seq: n + 1,
    });
    const params = paramsFromUrl(r.url, []);
    req.params = params.map((p) => ({ ...p, value: hide(p.key, p.value) }));
    if (req.params.some((p, i) => p.value !== params[i]?.value))
      req.url = urlFromParams(r.url, req.params);
    for (const h of r.headers ?? [])
      if (!/^(:|content-length$|host$|connection$|accept-encoding$)/i.test(h.name)) {
        const value = String(h.value ?? "");
        const scheme = /^(Bearer|Basic|Token|Digest|Bot)\s+(\S.*)$/i.exec(value);
        const kept =
          scheme && isSecretName(h.name)
            ? `${scheme[1]} ${hide(h.name, scheme[2] ?? "")}`
            : hide(h.name, value);
        req.headers.push(pair({ key: h.name, value: kept }));
      }
    const post = r.postData;
    if (post) {
      if (/json/i.test(post.mimeType ?? "")) {
        req.body.mode = "json";
        try {
          req.body.json = JSON.stringify(hideFields(JSON.parse(post.text ?? ""), hide), null, 2);
        } catch {
          req.body.json = post.text ?? "";
        }
      } else if (Array.isArray(post.params) && post.params.length) {
        req.body.mode = /multipart/i.test(post.mimeType ?? "") ? "multipart" : "form";
        const rows = post.params.map((/** @type {any} */ p) =>
          pair({ key: p.name, value: hide(String(p.name ?? ""), String(p.value ?? "")) }),
        );
        if (req.body.mode === "multipart") req.body.multipart = rows;
        else req.body.form = rows;
      } else if (post.text) {
        req.body.mode = "text";
        req.body.text = post.text;
      }
    }
    requests.push(req);
  }
  return {
    name: "Recorded requests",
    docs: `Imported from a HAR file: ${requests.length} requests.${keeper.vars.length ? ` Its ${keeper.vars.length} secrets are in the Recorded environment, kept in the desk.` : ""}`,
    auth: { type: "none" },
    vars: [],
    folders: [],
    requests,
    envs: keeper.vars.length ? [{ name: "Recorded", vars: keeper.vars }] : [],
  };
}

/** A JSON body with its secret fields' values swapped for references. @param {unknown} v @param {(name: string, value: string) => string} hide @returns {unknown} */
function hideFields(v, hide) {
  if (Array.isArray(v)) return v.map((x) => hideFields(x, hide));
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        typeof x === "string" ? hide(k, x) : hideFields(x, hide),
      ]),
    );
  return v;
}
