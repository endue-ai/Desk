// An API description (OpenAPI 3 or Swagger 2, JSON or YAML) as a collection: a folder per tag, a
// request per operation with its path, query and header parameters, an example body made from
// the schema, the auth its security scheme asks for, the servers as environments, and the
// descriptions as docs. A browser's HAR file becomes a collection of the requests it recorded.

import { newRequest, pair } from "./model.js";
import { paramsFromUrl } from "./url.js";
import { parseYaml } from "./yaml.js";

/**
 * @typedef {import("./model.js").Request} Request
 * @typedef {{ name: string, docs: string, auth: import("./model.js").Auth, vars: import("./model.js").Pair[],
 *   folders: { name: string, docs: string, requests: Request[] }[], requests: Request[],
 *   envs: { name: string, vars: { key: string, value: string, secret?: boolean }[] }[] }} Imported
 */

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/** Read a description's text as JSON or YAML. @param {string} text */
export function readSpec(text) {
  const t = text.trim();
  const doc = t.startsWith("{") ? JSON.parse(t) : parseYaml(t);
  if (!doc || typeof doc !== "object") throw new Error("That is not an API description.");
  return /** @type {any} */ (doc);
}

/** @param {any} doc */
export function isSpec(doc) {
  return (
    !!doc &&
    (typeof doc.openapi === "string" || doc.swagger === "2.0") &&
    typeof doc.paths === "object"
  );
}

/** Follow local $refs, at most 20 deep. @param {any} doc @param {any} node @param {number} [depth] @returns {any} */
function deref(doc, node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 20) return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    const target = node.$ref
      .slice(2)
      .split("/")
      .reduce(
        (/** @type {any} */ o, /** @type {string} */ k) =>
          o?.[k.replace(/~1/g, "/").replace(/~0/g, "~")],
        doc,
      );
    return deref(doc, target, depth + 1);
  }
  return node;
}

/** An example value for a schema. @param {any} doc @param {any} schema @param {number} [depth] @returns {unknown} */
export function exampleOf(doc, schema, depth = 0) {
  const s = deref(doc, schema);
  if (!s || typeof s !== "object" || depth > 8) return null;
  if (s.example !== undefined) return s.example;
  if (s.examples && Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.allOf))
    return Object.assign(
      {},
      ...s.allOf.map((x) => exampleOf(doc, x, depth + 1)).filter((x) => x && typeof x === "object"),
    );
  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf))
    return exampleOf(doc, (s.oneOf ?? s.anyOf)[0], depth + 1);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  if (type === "object" || s.properties) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(s.properties ?? {}))
      if (!deref(doc, v)?.readOnly) out[k] = exampleOf(doc, v, depth + 1);
    return out;
  }
  if (type === "array") return [exampleOf(doc, s.items, depth + 1)];
  if (type === "integer" || type === "number") return s.minimum ?? 0;
  if (type === "boolean") return true;
  if (type === "string") {
    const f = s.format;
    if (f === "date-time") return "2026-01-01T00:00:00Z";
    if (f === "date") return "2026-01-01";
    if (f === "email") return "user@example.com";
    if (f === "uuid") return "{{$uuid}}";
    if (f === "uri" || f === "url") return "https://example.com";
    if (f === "password") return "{{password}}";
    return "string";
  }
  return null;
}

/** The auth a security scheme asks for, with variables standing in for secrets. @param {any} scheme */
export function authOf(scheme) {
  if (!scheme) return { type: /** @type {const} */ ("none") };
  if (scheme.type === "http" && /bearer/i.test(scheme.scheme))
    return { type: /** @type {const} */ ("bearer"), bearer: { token: "{{token}}" } };
  if ((scheme.type === "http" && /basic/i.test(scheme.scheme)) || scheme.type === "basic")
    return {
      type: /** @type {const} */ ("basic"),
      basic: { username: "{{username}}", password: "{{password}}" },
    };
  if (scheme.type === "apiKey" && (scheme.in === "header" || scheme.in === "query"))
    return {
      type: /** @type {const} */ ("apikey"),
      apikey: {
        key: String(scheme.name ?? "X-Api-Key"),
        value: "{{apiKey}}",
        in: /** @type {"header" | "query"} */ (scheme.in),
      },
    };
  if (scheme.type === "oauth2") {
    const cc =
      scheme.flows?.clientCredentials ?? (scheme.flow === "application" ? scheme : undefined);
    const pw = scheme.flows?.password ?? (scheme.flow === "password" ? scheme : undefined);
    const f = cc ?? pw;
    if (f)
      return {
        type: /** @type {const} */ ("oauth2"),
        oauth2: {
          grant: /** @type {const} */ (cc ? "client_credentials" : "password"),
          tokenUrl: String(f.tokenUrl ?? ""),
          clientId: "{{clientId}}",
          clientSecret: "{{clientSecret}}",
          scope: Object.keys(f.scopes ?? {}).join(" "),
        },
      };
  }
  return { type: /** @type {const} */ ("none") };
}

/** @param {string} url */
const serverVar = (url) => url.replace(/\{([^}]+)\}/g, "{{$1}}");

/** A collection from an API description. @param {any} doc @returns {Imported} */
export function fromSpec(doc) {
  const v2 = doc.swagger === "2.0";
  const schemes = v2 ? (doc.securityDefinitions ?? {}) : (doc.components?.securitySchemes ?? {});
  const firstScheme = (/** @type {any[] | undefined} */ security) => {
    const name = Object.keys(security?.[0] ?? {})[0];
    return name ? deref(doc, schemes[name]) : undefined;
  };
  /** @type {Imported["envs"]} */
  const envs = [];
  if (v2)
    envs.push({
      name: "Default",
      vars: [
        {
          key: "baseUrl",
          value:
            `${doc.schemes?.[0] ?? "https"}://${doc.host ?? "localhost"}${doc.basePath ?? ""}`.replace(
              /\/$/,
              "",
            ),
        },
      ],
    });
  else
    for (const [n, server] of (doc.servers ?? [{ url: "/" }]).entries()) {
      const vars = [
        { key: "baseUrl", value: serverVar(String(server.url ?? "/")).replace(/\/$/, "") },
      ];
      for (const [k, sv] of Object.entries(server.variables ?? {}))
        vars.push({ key: k, value: String(/** @type {any} */ (sv).default ?? "") });
      envs.push({
        name: String(server.description ?? (n === 0 ? "Default" : `Server ${n + 1}`)).slice(0, 40),
        vars,
      });
    }
  const globalAuth = authOf(firstScheme(doc.security));
  const secretNames = new Set(["token", "password", "apiKey", "clientSecret"]);
  for (const env of envs)
    for (const name of ["token", "apiKey", "clientId", "clientSecret", "username", "password"])
      if (JSON.stringify(globalAuth).includes(`{{${name}}}`))
        env.vars.push({ key: name, value: "", ...(secretNames.has(name) ? { secret: true } : {}) });

  /** @type {Map<string, Request[]>} */
  const byTag = new Map();
  /** @type {Request[]} */
  const loose = [];
  let seq = 0;
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const pathItem = deref(doc, item);
    for (const method of METHODS) {
      const op = pathItem?.[method];
      if (!op) continue;
      const params = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map((p) =>
        deref(doc, p),
      );
      const url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, ":$1")}`;
      const req = newRequest({
        name: String(op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`).slice(
          0,
          80,
        ),
        method: method.toUpperCase(),
        url,
        seq: ++seq,
      });
      const val = (/** @type {any} */ p) => {
        const x =
          p.example ??
          p.schema?.example ??
          p.default ??
          p.schema?.default ??
          (Array.isArray(p.schema?.enum ?? p.enum) ? (p.schema?.enum ?? p.enum)[0] : undefined);
        return x === undefined ? "" : typeof x === "string" ? x : JSON.stringify(x);
      };
      for (const p of params) {
        if (p.in === "query")
          req.params.push(
            pair({
              key: p.name,
              value: val(p),
              on: !!p.required,
              ...(p.description ? { desc: String(p.description).slice(0, 120) } : {}),
            }),
          );
        else if (p.in === "path") req.pathParams.push(pair({ key: p.name, value: val(p) }));
        else if (p.in === "header")
          req.headers.push(pair({ key: p.name, value: val(p), on: !!p.required }));
      }
      if (req.params.some((p) => p.on))
        req.url = `${url}?${req.params
          .filter((p) => p.on)
          .map((p) => `${p.key}=${p.value}`)
          .join("&")}`;
      req.params = paramsFromUrl(req.url, req.params);
      // The body: OpenAPI 3's requestBody, or Swagger 2's body and formData parameters.
      const content = deref(doc, op.requestBody)?.content ?? {};
      const bodyParam = params.find((p) => p.in === "body");
      const formParams = params.filter((p) => p.in === "formData");
      const json = Object.keys(content).find((t) => /json/i.test(t));
      if (json || bodyParam) {
        const media = json ? content[json] : bodyParam;
        const ex =
          media?.example ??
          Object.values(media?.examples ?? {}).map((e) => deref(doc, e)?.value)[0] ??
          exampleOf(doc, media?.schema);
        req.body.mode = "json";
        req.body.json = JSON.stringify(ex ?? {}, null, 2);
      } else if (
        content["application/x-www-form-urlencoded"] ||
        content["multipart/form-data"] ||
        formParams.length
      ) {
        const multi = !!content["multipart/form-data"] || formParams.some((p) => p.type === "file");
        const schema = deref(
          doc,
          (content["multipart/form-data"] ?? content["application/x-www-form-urlencoded"])?.schema,
        );
        const fields = schema?.properties
          ? Object.entries(schema.properties).map(([k, s]) => ({
              name: k,
              file: deref(doc, s)?.format === "binary",
              value: exampleOf(doc, s),
            }))
          : formParams.map((p) => ({
              name: p.name,
              file: p.type === "file",
              value: p.default ?? "",
            }));
        req.body.mode = multi ? "multipart" : "form";
        const rows = fields.map((f) => ({
          ...pair({
            key: f.name,
            value: f.file
              ? ""
              : typeof f.value === "string"
                ? f.value
                : JSON.stringify(f.value ?? ""),
          }),
          kind: /** @type {"file" | "text"} */ (f.file ? "file" : "text"),
        }));
        if (multi) req.body.multipart = rows;
        else req.body.form = rows;
      } else if (Object.keys(content).length) {
        req.body.mode = Object.keys(content).some((t) => /xml/.test(t)) ? "xml" : "text";
      }
      const security = op.security ?? doc.security;
      const own = authOf(firstScheme(security));
      req.auth =
        Array.isArray(op.security) && op.security.length === 0
          ? { type: "none" }
          : JSON.stringify(own) === JSON.stringify(globalAuth)
            ? { type: "inherit" }
            : own;
      req.docs = [
        op.description ? String(op.description) : "",
        params.length
          ? `\n**Parameters**\n\n| Name | In | Required | About |\n|---|---|---|---|\n${params.map((p) => `| ${p.name} | ${p.in} | ${p.required ? "yes" : "no"} | ${String(p.description ?? "").replace(/\n/g, " ")} |`).join("\n")}`
          : "",
      ]
        .join("\n")
        .trim();
      const tag = String(op.tags?.[0] ?? "");
      if (tag) byTag.set(tag, [...(byTag.get(tag) ?? []), req]);
      else loose.push(req);
    }
  }
  const tagDocs = new Map(
    (doc.tags ?? []).map((/** @type {any} */ t) => [String(t.name), String(t.description ?? "")]),
  );
  return {
    name: String(doc.info?.title ?? "Imported API"),
    docs: [
      `# ${doc.info?.title ?? "API"}${doc.info?.version ? ` ${doc.info.version}` : ""}`,
      String(doc.info?.description ?? ""),
    ]
      .join("\n\n")
      .trim(),
    auth: globalAuth,
    vars: [],
    folders: [...byTag].map(([name, requests]) => ({
      name,
      docs: tagDocs.get(name) ?? "",
      requests,
    })),
    requests: loose,
    envs,
  };
}

/** A collection of the requests a HAR file recorded. @param {any} har @returns {Imported} */
export function fromHar(har) {
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  /** @type {Request[]} */
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
    req.params = paramsFromUrl(r.url, []);
    for (const h of r.headers ?? [])
      if (!/^(:|content-length$|host$|connection$|accept-encoding$)/i.test(h.name))
        req.headers.push(pair({ key: h.name, value: String(h.value ?? "") }));
    const post = r.postData;
    if (post) {
      if (/json/i.test(post.mimeType ?? "")) {
        req.body.mode = "json";
        try {
          req.body.json = JSON.stringify(JSON.parse(post.text ?? ""), null, 2);
        } catch {
          req.body.json = post.text ?? "";
        }
      } else if (Array.isArray(post.params) && post.params.length) {
        req.body.mode = /multipart/i.test(post.mimeType ?? "") ? "multipart" : "form";
        const rows = post.params.map((/** @type {any} */ p) =>
          pair({ key: p.name, value: String(p.value ?? "") }),
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
    docs: `Imported from a HAR file: ${requests.length} requests.`,
    auth: { type: "none" },
    vars: [],
    folders: [],
    requests,
    envs: [],
  };
}
