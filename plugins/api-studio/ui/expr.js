// Reading a value out of a response without running code: `res.status`, `res.time`, `res.size`,
// `res.headers.content-type`, `res.cookies.session`, `res.body.data[0].id`, `res.body["a b"]`,
// or a JSONPath-like `$.data[*].id`. Used by captured variables and by assertions, so a
// collection's files never carry code for these.

import { bodyText } from "./send.js";

/** @typedef {import("./send.js").Response} Response */

/** Split a path after its root: `.a.b[0]["c d"]` → ["a", "b", 0, "c d"]; `[*]` stays "*". @param {string} rest */
export function steps(rest) {
  /** @type {(string | number)[]} */
  const out = [];
  const re =
    /\.([^.[\]]+)|\[\s*(\d+)\s*\]|\[\s*"((?:[^"\\]|\\.)*)"\s*\]|\[\s*'((?:[^'\\]|\\.)*)'\s*\]|\[\s*\*\s*\]/g;
  let at = 0;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    if (m.index !== at) throw new Error(`Cannot read “${rest.slice(at)}”`);
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(Number(m[2]));
    else if (m[3] !== undefined) out.push(m[3]);
    else if (m[4] !== undefined) out.push(m[4]);
    else out.push("*");
    at = m.index + m[0].length;
  }
  if (at !== rest.length) throw new Error(`Cannot read “${rest.slice(at)}”`);
  return out;
}

/** Follow steps into a value; `*` maps over an array. @param {unknown} value @param {(string | number)[]} path @returns {unknown} */
export function follow(value, path) {
  let current = value;
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (step === "*") {
      if (!Array.isArray(current)) return undefined;
      const rest = path.slice(i + 1);
      return current.map((item) => follow(item, rest));
    }
    if (current === null || current === undefined) return undefined;
    if (step === "length" && (Array.isArray(current) || typeof current === "string")) {
      current = current.length;
      continue;
    }
    current = /** @type {any} */ (current)[step];
  }
  return current;
}

/** The body parsed as JSON once per response. @type {WeakMap<object, { value: unknown } | undefined>} */
const parsed = new WeakMap();

/** @param {Response} res */
export function jsonOf(res) {
  if (!parsed.has(res)) {
    try {
      parsed.set(res, { value: JSON.parse(bodyText(res)) });
    } catch {
      parsed.set(res, undefined);
    }
  }
  return parsed.get(res)?.value;
}

/**
 * What an expression reads from a response. Throws with words when the expression is not one
 * the studio knows.
 * @param {string} expr @param {Response} res @param {{ cookies?: Record<string, string> }} [extra]
 * @returns {unknown}
 */
export function read(expr, res, extra = {}) {
  const e = expr.trim();
  if (e.startsWith("$")) return follow(jsonOf(res), steps(e.slice(1)));
  const m = /^res(?:ponse)?\.(\w+)(.*)$/.exec(e);
  if (!m) throw new Error(`Start with res. or $ (got “${e}”)`);
  const [, root = "", rest = ""] = m;
  switch (root) {
    case "status":
      return res.status;
    case "statusText":
    case "reason":
      return res.reason;
    case "time":
    case "responseTime":
      return Math.round(res.timings.total);
    case "size":
      return res.size;
    case "url":
      return res.sent.url;
    case "body": {
      if (!rest) {
        const json = jsonOf(res);
        return json === undefined ? bodyText(res) : json;
      }
      return follow(jsonOf(res), steps(rest));
    }
    case "text":
      return bodyText(res);
    case "headers": {
      const name = rest.replace(/^\.|^\[\s*["']|["']\s*\]$/g, "").toLowerCase();
      if (!name) return Object.fromEntries(res.headers.map(([k, v]) => [k.toLowerCase(), v]));
      const all = res.headers.filter(([k]) => k.toLowerCase() === name).map(([, v]) => v);
      return all.length > 1 ? all : all[0];
    }
    case "cookies": {
      const name = rest.replace(/^\.|^\[\s*["']|["']\s*\]$/g, "");
      const jar = extra.cookies ?? cookieMap(res);
      return name ? jar[name] : jar;
    }
    default:
      throw new Error(`res.${root} is not something a response has`);
  }
}

/** The cookies a response set, name to value. @param {Response} res */
export function cookieMap(res) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of res.headers) {
    if (k.toLowerCase() !== "set-cookie") continue;
    const first = v.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) out[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return out;
}

/** A value as variable text: strings as they are, everything else as JSON. @param {unknown} value */
export function asText(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
