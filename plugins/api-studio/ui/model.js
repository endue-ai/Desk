// What a request is, without DOM: its method, URL, parameters, headers, body, auth, variables,
// scripts, assertions, docs and settings, with defaults, ids and a deep copy. Every other module
// reads and writes these shapes; collections on disk are these objects as JSON.

/** @typedef {{ id: string, on: boolean, key: string, value: string, desc?: string }} Pair */
/** @typedef {Pair & { kind?: "text" | "file", type?: string }} Part */
/**
 * @typedef {{ mode: BodyMode, json: string, text: string, xml: string, form: Pair[],
 *   multipart: Part[], file: string, graphql: { query: string, variables: string } }} Body
 * @typedef {"none" | "json" | "text" | "xml" | "form" | "multipart" | "file" | "graphql"} BodyMode
 */
/**
 * @typedef {{ type: AuthType, basic?: { username: string, password: string },
 *   bearer?: { token: string, prefix?: string },
 *   apikey?: { key: string, value: string, in: "header" | "query" },
 *   digest?: { username: string, password: string },
 *   ntlm?: { username: string, password: string },
 *   awsv4?: { accessKey: string, secretKey: string, session?: string, region: string, service: string },
 *   oauth2?: { grant: "client_credentials" | "password", tokenUrl: string, clientId: string,
 *     clientSecret: string, scope?: string, username?: string, password?: string,
 *     prefix?: string, token?: string, expires?: number } }} Auth
 * @typedef {"inherit" | "none" | "basic" | "bearer" | "apikey" | "digest" | "ntlm" | "awsv4" | "oauth2"} AuthType
 */
/**
 * @typedef {{ id: string, on: boolean, target: string, op: string, value: string }} Assertion
 * @typedef {{ followRedirects: boolean, maxRedirects: number, verifyTls: boolean,
 *   timeoutMs: number, httpVersion: "auto" | "1.1" | "2" | "3", decompress: boolean,
 *   cookies: boolean, encodeUrl: boolean }} Settings
 * @typedef {{ id: string, name: string, method: string, url: string, params: Pair[],
 *   pathParams: Pair[], headers: Pair[], body: Body, auth: Auth, vars: { pre: Pair[], post: Pair[] },
 *   scripts: { pre: string, post: string }, asserts: Assertion[], tests: string, docs: string,
 *   settings: Settings, seq?: number }} Request
 */

export const METHODS = /** @type {const} */ ([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export const BODY_MODES = /** @type {const} */ ([
  ["none", "No body"],
  ["json", "JSON"],
  ["text", "Text"],
  ["xml", "XML"],
  ["form", "Form URL encoded"],
  ["multipart", "Multipart form"],
  ["file", "File"],
  ["graphql", "GraphQL"],
]);

/** The content type a body mode sends when the request names none. */
export const CONTENT_TYPES = /** @type {Record<string, string>} */ ({
  json: "application/json",
  text: "text/plain",
  xml: "application/xml",
  form: "application/x-www-form-urlencoded",
  graphql: "application/json",
  file: "application/octet-stream",
});

let counter = 0;
/** A short id, unique for this page's life and unlikely to collide across saves. */
export function uid(prefix = "r") {
  counter = (counter + 1) % 1_000_000;
  const time = Date.now().toString(36).slice(-6);
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${prefix}${time}${rand}${counter.toString(36)}`;
}

/** @param {Partial<Pair>} [over] @returns {Pair} */
export function pair(over = {}) {
  return { id: uid("p"), on: true, key: "", value: "", ...over };
}

/** @returns {Settings} */
export function defaultSettings() {
  return {
    followRedirects: true,
    maxRedirects: 10,
    verifyTls: true,
    timeoutMs: 30_000,
    httpVersion: "auto",
    decompress: true,
    cookies: true,
    encodeUrl: true,
  };
}

/** @returns {Body} */
export function emptyBody() {
  return {
    mode: "none",
    json: "",
    text: "",
    xml: "",
    form: [],
    multipart: [],
    file: "",
    graphql: { query: "", variables: "" },
  };
}

/** A new request, GET on nothing unless `over` says more. @param {Partial<Request>} [over] @returns {Request} */
export function newRequest(over = {}) {
  return {
    id: uid("r"),
    name: "New request",
    method: "GET",
    url: "",
    params: [],
    pathParams: [],
    headers: [],
    body: emptyBody(),
    auth: { type: "inherit" },
    vars: { pre: [], post: [] },
    scripts: { pre: "", post: "" },
    asserts: [],
    tests: "",
    docs: "",
    settings: defaultSettings(),
    ...over,
  };
}

/** A request as read from anywhere (a file, an import, old state), with every field there. @param {any} raw @returns {Request} */
export function normalize(raw) {
  const base = newRequest();
  if (!raw || typeof raw !== "object") return base;
  const pairs = (/** @type {unknown} */ list) =>
    Array.isArray(list)
      ? list
          .filter((p) => p && typeof p === "object")
          .map((p) => ({
            ...p,
            id: typeof p.id === "string" ? p.id : uid("p"),
            on: p.on !== false,
            key: String(p.key ?? ""),
            value: String(p.value ?? ""),
          }))
      : [];
  const body = { ...base.body, ...(raw.body ?? {}) };
  body.form = pairs(body.form);
  body.multipart = pairs(body.multipart);
  body.graphql = { query: "", variables: "", ...(raw.body?.graphql ?? {}) };
  return {
    ...base,
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : base.id,
    name: String(raw.name ?? base.name),
    method: String(raw.method ?? "GET").toUpperCase(),
    url: String(raw.url ?? ""),
    params: pairs(raw.params),
    pathParams: pairs(raw.pathParams),
    headers: pairs(raw.headers),
    body,
    auth: raw.auth && typeof raw.auth === "object" ? { ...raw.auth } : { type: "inherit" },
    vars: { pre: pairs(raw.vars?.pre), post: pairs(raw.vars?.post) },
    scripts: { pre: String(raw.scripts?.pre ?? ""), post: String(raw.scripts?.post ?? "") },
    asserts: Array.isArray(raw.asserts)
      ? raw.asserts.map((/** @type {any} */ a) => ({
          id: typeof a.id === "string" ? a.id : uid("a"),
          on: a.on !== false,
          target: String(a.target ?? ""),
          op: String(a.op ?? "eq"),
          value: String(a.value ?? ""),
        }))
      : [],
    tests: String(raw.tests ?? ""),
    docs: String(raw.docs ?? ""),
    settings: { ...defaultSettings(), ...(raw.settings ?? {}) },
  };
}

/** A deep copy through JSON: requests hold only plain data. @template T @param {T} value @returns {T} */
export function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** Whether two requests would save the same. @param {Request} a @param {Request} b */
export function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The class a method's badge is coloured by: get, post, …, or other for a custom method. */
export function methodClass(/** @type {string} */ method) {
  const m = method.toLowerCase();
  return METHODS.some((known) => known.toLowerCase() === m) ? m : "other";
}

/** A method's short form for narrow places: DELETE → DEL, OPTIONS → OPT. */
export function methodShort(/** @type {string} */ method) {
  const short = /** @type {Record<string, string>} */ ({ DELETE: "DEL", OPTIONS: "OPT" });
  return short[method] ?? method;
}

/** The pairs that count: switched on, with a name. @param {Pair[]} list */
export function active(list) {
  return list.filter((p) => p.on && p.key.trim() !== "");
}
