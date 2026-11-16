// A curl command line as a request: the words split as a POSIX shell would (quotes, escapes,
// line continuations), then the options a copied command usually has: the method, headers, the
// body in its forms (-d, --data-raw, --data-binary, --data-urlencode, -F, --json), -u for Basic
// auth, -b for cookies, -A, -e, -G, -I, -L, -k, --compressed, the HTTP version and timeouts.

import { CONTENT_TYPES, newRequest, pair } from "./model.js";
import { paramsFromUrl, splitUrl } from "./url.js";

/** Split a command line into words. @param {string} text */
export function shellWords(text) {
  /** @type {string[]} */
  const words = [];
  let word = "";
  let has = false;
  let i = 0;
  const src = text.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (/\s/.test(ch)) {
      if (has) words.push(word);
      word = "";
      has = false;
      i++;
    } else if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      word += src.slice(i + 1, end < 0 ? src.length : end);
      has = true;
      i = end < 0 ? src.length : end + 1;
    } else if (ch === "$" && src[i + 1] === "'") {
      let j = i + 2;
      while (j < src.length && src[j] !== "'") {
        if (src[j] === "\\" && j + 1 < src.length) {
          const next = src[j + 1] ?? "";
          word += { n: "\n", t: "\t", r: "\r", "'": "'", '"': '"', "\\": "\\" }[next] ?? next;
          j += 2;
        } else word += src[j++];
      }
      has = true;
      i = j + 1;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\" && /["\\$`]/.test(src[j + 1] ?? "")) {
          word += src[j + 1];
          j += 2;
        } else word += src[j++];
      }
      has = true;
      i = j + 1;
    } else if (ch === "\\" && i + 1 < src.length) {
      word += src[i + 1];
      has = true;
      i += 2;
    } else {
      word += ch;
      has = true;
      i++;
    }
  }
  if (has) words.push(word);
  return words;
}

const WITH_VALUE = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "--json",
  "-F",
  "--form",
  "--form-string",
  "-u",
  "--user",
  "-b",
  "--cookie",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "--url",
  "-m",
  "--max-time",
  "--connect-timeout",
  "-x",
  "--proxy",
  "-o",
  "--output",
  "--max-redirs",
  "-w",
  "--write-out",
  "--aws-sigv4",
  "--oauth2-bearer",
  "-c",
  "--cookie-jar",
  "-K",
  "--config",
  "-T",
  "--upload-file",
  "-E",
  "--cert",
  "--key",
  "--cacert",
]);

/**
 * A request from a curl command, or undefined when the text is not one.
 * @param {string} text @returns {{ req: import("./model.js").Request, ignored: string[] } | undefined}
 */
export function fromCurl(text) {
  const words = shellWords(text.trim());
  if (words[0] !== "curl") return undefined;
  const req = newRequest({ name: "Imported request" });
  /** @type {string[]} */
  const data = [];
  /** @type {string[]} */
  const ignored = [];
  let method = "";
  let url = "";
  let get = false;
  let json = false;
  /** @type {import("./model.js").Part[]} */
  const parts = [];
  for (let i = 1; i < words.length; i++) {
    let w = words[i] ?? "";
    let v = "";
    if (w.startsWith("--") && w.includes("=")) {
      v = w.slice(w.indexOf("=") + 1);
      w = w.slice(0, w.indexOf("="));
    } else if (/^-[A-Za-z]./.test(w) && WITH_VALUE.has(w.slice(0, 2))) {
      v = w.slice(2);
      w = w.slice(0, 2);
    } else if (WITH_VALUE.has(w)) v = words[++i] ?? "";
    switch (w) {
      case "-X":
      case "--request":
        method = v.toUpperCase();
        break;
      case "-H":
      case "--header": {
        const colon = v.indexOf(":");
        if (colon > 0)
          req.headers.push(
            pair({ key: v.slice(0, colon).trim(), value: v.slice(colon + 1).trim() }),
          );
        else if (v.endsWith(";")) req.headers.push(pair({ key: v.slice(0, -1).trim(), value: "" }));
        break;
      }
      case "-d":
      case "--data":
      case "--data-ascii":
      case "--data-raw":
      case "--data-binary":
        data.push(v);
        break;
      case "--json":
        data.push(v);
        json = true;
        break;
      case "--data-urlencode": {
        const eq = v.indexOf("=");
        data.push(
          eq >= 0
            ? `${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`
            : encodeURIComponent(v),
        );
        break;
      }
      case "-F":
      case "--form":
      case "--form-string": {
        const eq = v.indexOf("=");
        const name = v.slice(0, eq);
        const value = v.slice(eq + 1);
        const file = w !== "--form-string" && value.startsWith("@");
        parts.push({
          ...pair({ key: name, value: file ? (value.slice(1).split(";")[0] ?? "") : value }),
          kind: file ? "file" : "text",
        });
        break;
      }
      case "-u":
      case "--user": {
        const colon = v.indexOf(":");
        req.auth = {
          type: "basic",
          basic: {
            username: colon >= 0 ? v.slice(0, colon) : v,
            password: colon >= 0 ? v.slice(colon + 1) : "",
          },
        };
        break;
      }
      case "--oauth2-bearer":
        req.auth = { type: "bearer", bearer: { token: v } };
        break;
      case "-b":
      case "--cookie":
        if (v.includes("=")) req.headers.push(pair({ key: "Cookie", value: v }));
        break;
      case "-A":
      case "--user-agent":
        req.headers.push(pair({ key: "User-Agent", value: v }));
        break;
      case "-e":
      case "--referer":
        req.headers.push(pair({ key: "Referer", value: v }));
        break;
      case "--url":
        url = v;
        break;
      case "-G":
      case "--get":
        get = true;
        break;
      case "-I":
      case "--head":
        method = "HEAD";
        break;
      case "-L":
      case "--location":
        req.settings.followRedirects = true;
        break;
      case "-k":
      case "--insecure":
        req.settings.verifyTls = false;
        break;
      case "--compressed":
        req.settings.decompress = true;
        break;
      case "--http1.1":
        req.settings.httpVersion = "1.1";
        break;
      case "--http2":
        req.settings.httpVersion = "2";
        break;
      case "--http3":
        req.settings.httpVersion = "3";
        break;
      case "-m":
      case "--max-time":
        req.settings.timeoutMs = Math.round(Number(v) * 1000) || req.settings.timeoutMs;
        break;
      default:
        if (!w.startsWith("-") && !url) url = w;
        else if (w.startsWith("-")) ignored.push(w);
    }
  }
  if (!url) return undefined;
  if (get && data.length) url += `${url.includes("?") ? "&" : "?"}${data.join("&")}`;
  req.url = url;
  req.params = paramsFromUrl(url, []);
  if (parts.length) {
    req.body.mode = "multipart";
    req.body.multipart = parts;
  } else if (data.length && !get) {
    const body = data.join("&");
    const type = req.headers.find((h) => /^content-type$/i.test(h.key))?.value ?? "";
    const looksJson = json || /json/i.test(type) || /^\s*[[{]/.test(body);
    if (looksJson) {
      req.body.mode = "json";
      try {
        req.body.json = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        req.body.json = body;
      }
      if (json && !type)
        req.headers.push(
          pair({ key: "Content-Type", value: CONTENT_TYPES.json ?? "application/json" }),
        );
    } else if (/xml/i.test(type)) {
      req.body.mode = "xml";
      req.body.xml = body;
    } else if (!type || /x-www-form-urlencoded/i.test(type)) {
      req.body.mode = "form";
      req.body.form = body.split("&").map((kv) => {
        const eq = kv.indexOf("=");
        const dec = (/** @type {string} */ s) => {
          try {
            return decodeURIComponent(s.replace(/\+/g, " "));
          } catch {
            return s;
          }
        };
        return pair({
          key: dec(eq >= 0 ? kv.slice(0, eq) : kv),
          value: dec(eq >= 0 ? kv.slice(eq + 1) : ""),
        });
      });
    } else {
      req.body.mode = "text";
      req.body.text = body;
    }
  }
  req.method = method || (data.length && !get ? "POST" : parts.length ? "POST" : "GET");
  const host =
    splitUrl(url)
      .base.replace(/^[a-z]+:\/\//i, "")
      .split("/")[0] ?? "";
  const path = splitUrl(url).base.replace(/^[a-z]+:\/\/[^/]*/i, "") || "/";
  req.name = (path === "/" ? host : path).slice(0, 60) || "Imported request";
  return { req, ignored };
}
