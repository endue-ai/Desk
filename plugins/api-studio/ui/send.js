// One request from the editor to the wire and back: variables filled in, auth applied, the body
// made, headers merged (the body's content type unless one is named), then curl's output read as
// a response a person and the tests can look at.

import { applyAuth, effectiveAuth } from "./auth.js";
import {
  certificate,
  sentHeaders,
  splitErr,
  splitOutput,
  timeline,
  timings,
} from "./curl-parse.js";
import { reasonOf } from "./format.js";
import { active, CONTENT_TYPES } from "./model.js";
import { wireUrl } from "./url.js";
import { resolve } from "./vars.js";

/**
 * @typedef {import("./model.js").Request} Request
 * @typedef {import("./vars.js").Scope} Scope
 * @typedef {import("./curl-config.js").Prepared} Prepared
 * @typedef {{ status: number, reason: string, version: string, headers: [string, string][],
 *   body: Uint8Array, contentType: string, size: number, headerSize: number,
 *   timings: import("./curl-parse.js").Timings, hops: { status: number, reason: string, location: string }[],
 *   timeline: import("./curl-parse.js").TimelineLine[], sent: { method: string, url: string,
 *   headers: [string, string][], body: string }, remote: string, httpVersion: string,
 *   cert?: ReturnType<typeof certificate>, error?: string, cancelled?: boolean, at: number,
 *   missing: string[] }} Response
 */

/** Headers that hold secrets, masked wherever a request is shown or kept. */
export const SECRET_HEADERS =
  /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-amz-security-token)$/i;

/**
 * Turn the editor's request into what curl sends.
 * @param {Request} req
 * @param {{ scopes: Scope[], parentAuth?: import("./model.js").Auth[], parentHeaders?: import("./model.js").Pair[],
 *   tokenFor?: (auth: import("./model.js").Auth) => string, cookies?: (url: string) => string }} ctx
 * @returns {{ prep: Prepared, missing: string[], bodyText: string }}
 */
export function prepare(req, ctx) {
  /** @type {Set<string>} */
  const missing = new Set();
  const fill = (/** @type {string} */ text) => resolve(text, ctx.scopes, missing);
  const { auth } = effectiveAuth(req.auth, ctx.parentAuth ?? []);
  const applied = applyAuth(auth, fill, ctx.tokenFor);
  const query = active(req.params).map((p) => ({ key: fill(p.key), value: fill(p.value) }));
  query.push(...applied.query);
  const path = new Map(active(req.pathParams).map((p) => [p.key, fill(p.value)]));
  const filled = fill(req.url).replace(/\/:([A-Za-z_][\w-]*)/g, (whole, name) =>
    path.has(name) && path.get(name) !== ""
      ? `/${encodeURIComponent(path.get(name) ?? "")}`
      : whole,
  );
  const url = wireUrl(filled, query, req.settings.encodeUrl !== false);

  /** @type {{ key: string, value: string }[]} */
  const headers = [];
  const add = (/** @type {string} */ key, /** @type {string} */ value) => {
    const at = headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
    if (at >= 0) headers.splice(at, 1);
    headers.push({ key, value });
  };
  for (const h of active(ctx.parentHeaders ?? [])) add(fill(h.key), fill(h.value));
  for (const h of active(req.headers)) {
    const key = fill(h.key);
    // A header named twice in the request itself is sent twice (Accept, Cookie…).
    if (req.headers.filter((o) => o.on && o.key.toLowerCase() === h.key.toLowerCase()).length > 1)
      headers.push({ key, value: fill(h.value) });
    else add(key, fill(h.value));
  }
  for (const h of applied.headers) add(h.key, h.value);
  if (req.settings.cookies && ctx.cookies && !headers.some((h) => /^cookie$/i.test(h.key))) {
    const jar = ctx.cookies(url);
    if (jar) headers.push({ key: "Cookie", value: jar });
  }

  const b = req.body;
  /** @type {Prepared["body"]} */
  let body = { kind: "none" };
  let bodyText = "";
  const noBody = req.method === "GET" || req.method === "HEAD";
  if (!(noBody && (b.mode === "none" || isBlank(b)))) {
    if (b.mode === "json" || b.mode === "text" || b.mode === "xml") {
      bodyText = fill(b[b.mode]);
      body = { kind: "raw", text: bodyText };
    } else if (b.mode === "form") {
      bodyText = active(b.form)
        .map((p) => `${formEncode(fill(p.key))}=${formEncode(fill(p.value))}`)
        .join("&");
      body = { kind: "raw", text: bodyText };
    } else if (b.mode === "graphql") {
      /** @type {Record<string, unknown>} */
      const payload = { query: fill(b.graphql.query) };
      const vars = fill(b.graphql.variables).trim();
      if (vars) {
        try {
          payload.variables = JSON.parse(vars);
        } catch {
          payload.variables = vars;
        }
      }
      bodyText = JSON.stringify(payload);
      body = { kind: "raw", text: bodyText };
    } else if (b.mode === "multipart") {
      const parts = active(b.multipart).map((p) => ({
        name: fill(p.key),
        value: fill(p.value),
        file: p.kind === "file",
        ...(p.type ? { type: p.type } : {}),
      }));
      bodyText = parts.map((p) => `${p.name}=${p.file ? `@${p.value}` : p.value}`).join("\n");
      body = { kind: "multipart", parts };
    } else if (b.mode === "file" && b.file.trim()) {
      bodyText = `@${fill(b.file)}`;
      body = { kind: "file", path: fill(b.file).trim() };
    }
  }
  const type = CONTENT_TYPES[b.mode];
  if (
    body.kind !== "none" &&
    body.kind !== "multipart" &&
    type &&
    !headers.some((h) => /^content-type$/i.test(h.key))
  )
    headers.push({ key: "Content-Type", value: type });
  return {
    prep: {
      method: req.method.toUpperCase(),
      url,
      headers,
      body,
      ...(applied.curl ? { auth: applied.curl } : {}),
      settings: req.settings,
    },
    missing: [...missing],
    bodyText,
  };
}

/** @param {import("./model.js").Body} b */
function isBlank(b) {
  if (b.mode === "form") return active(b.form).length === 0;
  if (b.mode === "multipart") return active(b.multipart).length === 0;
  if (b.mode === "graphql") return !b.graphql.query.trim();
  if (b.mode === "file") return !b.file.trim();
  if (b.mode === "none") return true;
  return !String(b[b.mode] ?? "").trim();
}

/** application/x-www-form-urlencoded: components encoded, spaces as +. @param {string} text */
export function formEncode(text) {
  return encodeURIComponent(text).replace(/%20/g, "+");
}

/**
 * curl's output as a response. A transfer that failed before any status (no host, refused, TLS,
 * timeout) is a response with `error` and status 0.
 * @param {import("./engine.js").RunResult} run @param {Prepared} prep @param {string} bodyText @param {string[]} missing
 * @returns {Response}
 */
export function readResponse(run, prep, bodyText, missing) {
  const { log, report } = splitErr(run.stderr);
  const lines = timeline(log);
  const { blocks, body } = splitOutput(run.stdout, {
    redirects: Number(report?.num_redirects ?? 0),
    head: prep.method === "HEAD",
  });
  const final = blocks.at(-1);
  const status =
    Number(report?.http_code ?? report?.response_code ?? final?.status ?? 0) || final?.status || 0;
  const header = (/** @type {string} */ name) =>
    final?.headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
  const hops = blocks
    .filter((blk) => blk.status >= 300 && blk.status < 400 && blk !== final)
    .map((blk) => ({
      status: blk.status,
      reason: blk.reason || reasonOf(blk.status),
      location: blk.headers.find(([k]) => k.toLowerCase() === "location")?.[1] ?? "",
    }));
  const errorText = run.cancelled
    ? "Cancelled."
    : run.code && run.code !== 0
      ? String(
          report?.errormsg ??
            (log
              .trim()
              .split("\n")
              .filter((l) => l.startsWith("curl:"))
              .at(-1) ||
              `curl stopped with code ${run.code}.`),
        )
      : undefined;
  return {
    status,
    reason: final?.reason || reasonOf(status),
    version: final?.version ?? "",
    headers: final?.headers ?? [],
    body,
    contentType: String(report?.content_type ?? header("content-type") ?? ""),
    size: body.length,
    headerSize: Number(report?.size_header ?? 0),
    timings: timings(report),
    hops,
    timeline: lines,
    sent: {
      method: prep.method,
      url: String(report?.url_effective ?? prep.url),
      headers: sentHeaders(lines),
      body: bodyText,
    },
    remote: report?.remote_ip ? `${report.remote_ip}:${report.remote_port}` : "",
    httpVersion: report?.http_version ? `HTTP/${report.http_version}` : (final?.version ?? ""),
    cert: certificate(report?.certs),
    ...(errorText ? { error: errorText } : {}),
    ...(run.cancelled ? { cancelled: true } : {}),
    at: Date.now(),
    missing,
  };
}

/** The response's body as text in its charset (UTF-8 unless it says otherwise). @param {Response} res */
export function bodyText(res) {
  const charset =
    /charset=([^;]+)/i.exec(res.contentType)?.[1]?.trim().replace(/"/g, "") || "utf-8";
  try {
    return new TextDecoder(charset).decode(res.body);
  } catch {
    return new TextDecoder().decode(res.body);
  }
}

/** The body as JSON, or undefined when it is not JSON. @param {Response} res */
export function bodyJson(res) {
  const text = bodyText(res).trim();
  if (!text || !/^[[{"\d-]|^(true|false|null)$/.test(text)) return undefined;
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}
