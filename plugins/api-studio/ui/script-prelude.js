// What a script sees, set up inside its worker before its own code runs: `req` (the request,
// changeable before it is sent), `res` (the response, after), `api` (variables, helpers),
// `test(name, fn)` with `expect(value)`, and `console`. This function is turned into text and put
// at the top of the worker's source, so it may use nothing from outside itself.

/** @param {any} ctx what the studio hands over: phase, request, response, variables */
export function prelude(ctx) {
  const out = {
    logs: /** @type {any[]} */ ([]),
    tests: /** @type {any[]} */ ([]),
    vars: /** @type {Record<string, string>} */ ({}),
    env: /** @type {Record<string, string>} */ ({}),
    skip: false,
  };
  const pending = /** @type {Promise<void>[]} */ ([]);
  const scope = /** @type {Record<string, string>} */ ({ ...ctx.vars });
  const g = /** @type {any} */ (globalThis);

  const show = (/** @type {unknown} */ v) => {
    if (typeof v === "string") return JSON.stringify(v);
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s.length > 200 ? `${s.slice(0, 200)}…` : s;
    } catch {
      return String(v);
    }
  };
  const text = (/** @type {unknown[]} */ args) =>
    args.map((a) => (typeof a === "string" ? a : show(a))).join(" ");
  for (const level of ["log", "info", "warn", "error", "debug"])
    g.console[level] = (/** @type {unknown[]} */ ...args) =>
      out.logs.push({ level, text: text(args) });

  const deepEqual = (/** @type {any} */ a, /** @type {any} */ b) => {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== "object")
      return Number.isNaN(a) && Number.isNaN(b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  };
  class AssertionFailed extends Error {}

  /** @param {unknown} actual */
  const expect = (actual) => {
    let negate = false;
    let deep = false;
    const chain = /** @type {any} */ ({});
    const assert = (/** @type {boolean} */ ok, /** @type {string} */ what) => {
      if (ok === negate)
        throw new AssertionFailed(`expected ${show(actual)} ${negate ? "not " : ""}${what}`);
      return chain;
    };
    for (const word of [
      "to",
      "be",
      "been",
      "is",
      "that",
      "which",
      "and",
      "has",
      "have",
      "with",
      "at",
      "of",
      "same",
      "does",
    ])
      Object.defineProperty(chain, word, { get: () => chain });
    Object.defineProperty(chain, "not", {
      get: () => {
        negate = !negate;
        return chain;
      },
    });
    Object.defineProperty(chain, "deep", {
      get: () => {
        deep = true;
        return chain;
      },
    });
    const getters = /** @type {Record<string, () => unknown>} */ ({
      true: () => assert(actual === true, "to be true"),
      false: () => assert(actual === false, "to be false"),
      null: () => assert(actual === null, "to be null"),
      undefined: () => assert(actual === undefined, "to be undefined"),
      ok: () => assert(!!actual, "to be truthy"),
      exist: () => assert(actual !== null && actual !== undefined, "to exist"),
      empty: () =>
        assert(
          actual !== null && typeof actual === "object"
            ? Object.keys(actual).length === 0
            : String(actual ?? "").length === 0,
          "to be empty",
        ),
      NaN: () => assert(Number.isNaN(actual), "to be NaN"),
    });
    for (const [name, fn] of Object.entries(getters))
      Object.defineProperty(chain, name, { get: fn });
    const size = () =>
      typeof actual === "string" || Array.isArray(actual)
        ? actual.length
        : actual && typeof actual === "object"
          ? Object.keys(actual).length
          : undefined;
    const num = (/** @type {unknown} */ v) => Number(v);
    const methods = /** @type {Record<string, (...a: any[]) => unknown>} */ ({
      equal: (v) => assert(deep ? deepEqual(actual, v) : actual === v, `to equal ${show(v)}`),
      eql: (v) => assert(deepEqual(actual, v), `to deeply equal ${show(v)}`),
      a: (type) =>
        assert(
          type === "array"
            ? Array.isArray(actual)
            : type === "null"
              ? actual === null
              : typeof actual === type && !Array.isArray(actual),
          `to be a ${type}`,
        ),
      include: (v) =>
        assert(
          Array.isArray(actual)
            ? actual.some((x) => (deep ? deepEqual(x, v) : x === v))
            : typeof actual === "string"
              ? actual.includes(String(v))
              : actual && typeof actual === "object" && typeof v === "object"
                ? Object.entries(v).every(([k, x]) => deepEqual(/** @type {any} */ (actual)[k], x))
                : false,
          `to include ${show(v)}`,
        ),
      property: (name, ...value) => {
        const has =
          actual !== null && typeof actual === "object" && name in /** @type {object} */ (actual);
        if (!value.length) return assert(has, `to have property ${show(name)}`);
        return assert(
          has && deepEqual(/** @type {any} */ (actual)[name], value[0]),
          `to have property ${show(name)} of ${show(value[0])}`,
        );
      },
      lengthOf: (n) => assert(size() === n, `to have length ${n} (it has ${size()})`),
      above: (n) => assert(num(actual) > n, `to be above ${n}`),
      below: (n) => assert(num(actual) < n, `to be below ${n}`),
      least: (n) => assert(num(actual) >= n, `to be at least ${n}`),
      most: (n) => assert(num(actual) <= n, `to be at most ${n}`),
      within: (lo, hi) =>
        assert(num(actual) >= lo && num(actual) <= hi, `to be within ${lo}..${hi}`),
      match: (re) => assert(new RegExp(re).test(String(actual)), `to match ${String(re)}`),
      oneOf: (list) =>
        assert(
          list.some((/** @type {unknown} */ x) => deepEqual(x, actual)),
          `to be one of ${show(list)}`,
        ),
      status: (code) =>
        assert(/** @type {any} */ (actual)?.status === code, `to have status ${code}`),
      header: (name, ...value) => {
        const got = /** @type {any} */ (actual)?.headers?.[String(name).toLowerCase()];
        return assert(
          value.length ? got === value[0] : got !== undefined,
          `to have header ${name}${value.length ? ` ${show(value[0])}` : ""}`,
        );
      },
    });
    const aliases = {
      equals: "equal",
      eq: "equal",
      eqls: "eql",
      an: "a",
      contain: "include",
      includes: "include",
      contains: "include",
      length: "lengthOf",
      gt: "above",
      greaterThan: "above",
      lt: "below",
      lessThan: "below",
      gte: "least",
      lte: "most",
      matches: "match",
    };
    for (const [name, fn] of Object.entries(methods)) chain[name] = fn;
    for (const [alias, name] of Object.entries(aliases)) chain[alias] = methods[name];
    return chain;
  };

  const test = (/** @type {string} */ name, /** @type {() => unknown} */ fn) => {
    const at = out.tests.length;
    out.tests.push({ name, ok: false, error: "did not finish" });
    const record = (/** @type {unknown} */ error) => {
      out.tests[at] =
        error === undefined
          ? { name, ok: true }
          : {
              name,
              ok: false,
              error:
                error instanceof AssertionFailed
                  ? error.message
                  : `${/** @type {Error} */ (error)?.name ?? "Error"}: ${/** @type {Error} */ (error)?.message ?? String(error)}`,
            };
    };
    try {
      const result = fn();
      if (result && typeof (/** @type {any} */ (result).then) === "function")
        pending.push(
          /** @type {Promise<unknown>} */ (result).then(() => record(undefined), record),
        );
      else record(undefined);
    } catch (error) {
      record(error);
    }
  };

  const headers = (/** @type {[string, string][]} */ list) => {
    const o = /** @type {Record<string, string>} */ ({});
    for (const [k, v] of list)
      o[k.toLowerCase()] = o[k.toLowerCase()] ? `${o[k.toLowerCase()]}, ${v}` : v;
    return o;
  };
  if (ctx.request) {
    const r = ctx.request;
    g.req = {
      get method() {
        return r.method;
      },
      get url() {
        return r.url;
      },
      get headers() {
        return headers(r.headers);
      },
      get body() {
        try {
          return JSON.parse(r.body);
        } catch {
          return r.body;
        }
      },
      header: (/** @type {string} */ name) => headers(r.headers)[name.toLowerCase()],
      setMethod: (/** @type {string} */ m) => {
        r.method = String(m).toUpperCase();
      },
      setUrl: (/** @type {string} */ u) => {
        r.url = String(u);
      },
      setHeader: (/** @type {string} */ name, /** @type {unknown} */ value) => {
        r.headers = r.headers.filter(
          (/** @type {[string, string]} */ [k]) => k.toLowerCase() !== name.toLowerCase(),
        );
        r.headers.push([name, String(value)]);
      },
      removeHeader: (/** @type {string} */ name) => {
        r.headers = r.headers.filter(
          (/** @type {[string, string]} */ [k]) => k.toLowerCase() !== name.toLowerCase(),
        );
      },
      setBody: (/** @type {unknown} */ body) => {
        r.body = typeof body === "string" ? body : JSON.stringify(body);
        r.bodyChanged = true;
      },
    };
  }
  if (ctx.response) {
    const s = ctx.response;
    const h = headers(s.headers);
    let body = s.text;
    try {
      body = JSON.parse(s.text);
    } catch {
      /* text */
    }
    g.res = {
      status: s.status,
      statusText: s.reason,
      headers: h,
      header: (/** @type {string} */ n) => h[n.toLowerCase()],
      body,
      text: s.text,
      time: s.time,
      size: s.size,
      url: s.url,
    };
  }
  g.api = {
    get: (/** @type {string} */ name) => (name in out.vars ? out.vars[name] : scope[name]),
    set: (/** @type {string} */ name, /** @type {unknown} */ value) => {
      out.vars[name] = typeof value === "string" ? value : JSON.stringify(value);
    },
    has: (/** @type {string} */ name) => name in out.vars || name in scope,
    env: {
      get: (/** @type {string} */ name) => (name in out.env ? out.env[name] : scope[name]),
      set: (/** @type {string} */ name, /** @type {unknown} */ value) => {
        out.env[name] = typeof value === "string" ? value : JSON.stringify(value);
      },
    },
    skip: () => {
      out.skip = true;
    },
    sleep: (/** @type {number} */ ms) =>
      new Promise((r) => setTimeout(r, Math.min(Number(ms) || 0, 10000))),
    uuid: () => crypto.randomUUID(),
    base64: (/** @type {string} */ t) => btoa(String.fromCharCode(...new TextEncoder().encode(t))),
    fromBase64: (/** @type {string} */ t) =>
      new TextDecoder().decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0))),
    sha256: async (/** @type {string} */ t) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    hmac256: async (/** @type {string} */ key, /** @type {string} */ t) => {
      const k = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(t)))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
    phase: ctx.phase,
    name: ctx.name,
  };
  g.test = test;
  g.expect = expect;
  g.__finish = async (/** @type {unknown} */ error) => {
    await Promise.all(pending);
    postMessage({
      ...out,
      request: ctx.request,
      error:
        error === undefined
          ? undefined
          : `${/** @type {Error} */ (error)?.name ?? "Error"}: ${/** @type {Error} */ (error)?.message ?? String(error)}`,
    });
  };
}
