#!/usr/bin/env node
// spec-docs: render the API reference from specs/ into a folder: every bridge method (params, result,
// errors, the permission that covers it), every event, the permission vocabulary, the plugin manifest
// fields, the brain endpoints and every item, view and connector type. The docs site builds it and it is
// never committed, so specs in open PRs never drift from it (docs/site/README.md). Node 22, yaml only.
//   node scripts/spec-docs.mjs <out> [--root <dir with specs/>]      (just docs-api <out>)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadBrain, loadDefs, PLUGIN_FOLDERS } from "./codegen/load.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Specs whose page lists every type they define: [title, folder]; the page is the title, lowercase. */
const TYPED = Object.entries({ Items: "item/v0", Views: "view/v0", Connectors: "connector/v0" });
const slug = (title) => title.toLowerCase();
const BASE = ["index.md", "bridge.md", "permissions.md", "manifest.md", "brain.md"];
export const PAGES = [...BASE, ...TYPED.map(([title]) => `${slug(title)}.md`)];

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const refName = (ref) => ref.split("/").pop();
const cell = (text) => (text ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
const code = (text) => `\`${text}\``;
const list = (items) => items.map(code).join(", ");
const constOf = (schema) => schema?.properties?.permission?.const;
const table = (head, rows) =>
  [head, head.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");

/** The plugin, item, view, connector, init and bridge schemas, every definition by name and folder. */
const loadSpecs = (root) => loadDefs(root, [...PLUGIN_FOLDERS, "init/v0", "bridge/v0"]);

/** Blocks of a spec README keyed by what starts them: `**name**` paragraphs and `## Heading` parts. */
function blocks(text, split, start) {
  const out = new Map();
  for (const block of text.split(split)) {
    const m = start.exec(block.trim());
    if (m) out.set(m[1].trim(), m[2] === undefined ? block.trim() : m[2].trim());
  }
  return out;
}
const paragraphs = (text) => blocks(text, /\n\s*\n/, /^\*\*([^*\s]+)\*\*/);
const sections = (text) => blocks(text, /\n(?=## )/, /^## (.+)\n([\s\S]*)$/);

/** The vocabulary table of specs/plugin/v0/README.md: permission → its Covers cell and the names in it. */
function coversTable(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    const m = /^`([a-z]+:[a-z]+)`$/.exec(cells[1] ?? "");
    if (!m) continue;
    const text = cells[cells.length - 2];
    const names = [...text.matchAll(/`([a-z][\w.]*)`/g)].map((n) => n[1]);
    out.set(m[1], { text, names });
  }
  return out;
}

/** A schema as a short type for a table cell; `ctx.link(name)` says whether a type has a section. */
function typeOf(schema, ctx) {
  if (!schema || Object.keys(schema).every((k) => k === "description")) return "any JSON";
  if (schema.$ref) {
    const name = refName(schema.$ref);
    const permission = constOf(ctx.defs.get(name)?.schema);
    if (permission) return `${code(permission)} scope`;
    return ctx.link(name) ? `[${name}](#${name.toLowerCase()})` : code(name);
  }
  if ("const" in schema) return code(JSON.stringify(schema.const));
  if (schema.enum) return schema.enum.map((v) => code(JSON.stringify(v))).join(" or ");
  const union = schema.oneOf ?? schema.anyOf;
  if (union) return union.map((s) => typeOf(s, ctx)).join(" or ");
  const types = [schema.type].flat().filter(Boolean);
  if (types.includes("array"))
    return `array of ${typeOf(schema.items, ctx)}${limits(schema, "Items")}`;
  if (types.includes("object") && typeof schema.additionalProperties === "object")
    return `map of ${typeOf(schema.additionalProperties, ctx)}`;
  const format = schema.format ? ` (${schema.format})` : "";
  return `${types.join(" or ") || "any JSON"}${format}${limits(schema, "")}`;
}

function limits(schema, kind) {
  const lo = kind ? schema[`min${kind}`] : (schema.minimum ?? schema.minLength);
  const hi = kind ? schema[`max${kind}`] : (schema.maximum ?? schema.maxLength);
  const unit = kind ? " items" : "minLength" in schema || "maxLength" in schema ? " chars" : "";
  if (lo === 1 && hi === undefined && unit) return ", not empty";
  if (lo !== undefined && hi !== undefined) return `, ${lo} to ${hi}${unit}`;
  if (lo !== undefined) return `, at least ${lo}${unit}`;
  return hi !== undefined ? `, at most ${hi}${unit}` : "";
}

/** The fields of an object schema as a table, or a sentence for anything else. */
function fields(schema, ctx) {
  if (!schema) return "Not defined in the spec.";
  if (schema.$ref) return fields(ctx.defs.get(refName(schema.$ref))?.schema, ctx);
  const union = schema.oneOf ?? schema.anyOf;
  if (union) return `One of: ${union.map((s) => typeOf(s, ctx)).join(", ")}.`;
  if (!schema.properties) return `${typeOf(schema, ctx)}.`;
  const entries = Object.entries(schema.properties);
  if (entries.length === 0) return "None.";
  const required = new Set(schema.required ?? []);
  const rows = entries.map(([name, prop]) => {
    const text = prop.description ?? ctx.defs.get(refName(prop.$ref ?? ""))?.schema?.description;
    return [code(name), cell(typeOf(prop, ctx)), required.has(name) ? "yes" : "no", cell(text)];
  });
  return table(["Field", "Type", "Required", "Description"], rows);
}

/** Definitions a page gives a section, found by following $refs from `starts` within `owns`. */
function reachable(starts, ctx, owns) {
  const seen = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const def = typeof node.$ref === "string" ? ctx.defs.get(refName(node.$ref)) : undefined;
    if (def && owns(def) && !constOf(def.schema) && !seen.has(def.name)) {
      seen.add(def.name);
      visit(def.schema);
    }
    for (const [key, value] of Object.entries(node)) if (key !== "$ref") visit(value);
  };
  starts.forEach(visit);
  return [...seen];
}

function typesSection(names, ctx) {
  const out = names.length > 0 ? ["## Types", ""] : [];
  for (const name of names) {
    const { schema } = ctx.defs.get(name);
    out.push(`### ${name}`, "");
    if (schema.description) out.push(schema.description, "");
    out.push(fields(schema, ctx), "");
    if (schema.pattern) out.push(`Pattern: ${code(schema.pattern)}`, "");
  }
  return out;
}

/** A page context: the definitions `starts` reach inside `owns` get sections and links. */
function context(defs, starts, owns) {
  const types = reachable(starts.filter(Boolean), { defs }, owns);
  return { defs, types, link: (name) => types.includes(name) };
}

const GENERATED = "<!-- GENERATED by scripts/spec-docs.mjs; edit specs/, not this page. -->";
const page = (title, description, body) =>
  [`---\ntitle: ${title}\ndescription: ${description}\n---\n`, GENERATED, "", ...body].join("\n");

/** Bridge methods and events found in the bridge schemas, in file and definition order. */
function bridgeModel(specs) {
  const methods = [];
  const events = [];
  for (const doc of specs.docs["bridge/v0"]) {
    for (const [name, schema] of Object.entries(doc.$defs ?? {})) {
      const { method, event, params, data } = schema.properties ?? {};
      const result = specs.defs.get(`${name.replace(/Request$/, "")}Result`)?.schema;
      const resolved = params?.$ref ? specs.defs.get(refName(params.$ref))?.schema : params;
      if (method?.const) methods.push({ name: method.const, doc, params: resolved, result });
      if (event?.const) events.push({ name: event.const, schema, data });
    }
  }
  return { methods, events };
}

/** The permissions a method's params.scope names, and whether the scope is required. */
function scopeOf(params, defs) {
  const scope = params?.properties?.scope;
  const refs = scope ? (scope.$ref ? [scope] : (scope.oneOf ?? scope.anyOf ?? [])) : [];
  const names = refs.map((s) => constOf(defs.get(refName(s.$ref ?? ""))?.schema)).filter(Boolean);
  return { names, required: (params?.required ?? []).includes("scope") };
}

function permissionLine({ names, required }, covered) {
  const carried = `${list(names)}, carried in \`params.scope\``;
  if (names.length > 0 && required) return `${carried}.`;
  if (names.length > 0) return `${carried} for other callers' data; none for its own.`;
  if (covered.length > 0) return `${list(covered)}.`;
  return "none: the call reaches only the caller's own data.";
}

function renderBridge(root, specs) {
  const readme = read(join(root, "specs/bridge/v0/README.md"));
  const prose = paragraphs(readme);
  const covers = coversTable(read(join(root, "specs/plugin/v0/README.md")));
  const coveredBy = (name) => [...covers].filter(([, c]) => c.names.includes(name)).map(([p]) => p);
  const codes = specs.defs.get("ErrorCode")?.schema?.enum ?? [];
  const { methods, events } = bridgeModel(specs);
  const starts = [...methods.flatMap((m) => [m.params, m.result]), ...events.map((e) => e.data)];
  const ctx = context(specs.defs, starts, (d) => d.folder === "bridge/v0");
  const body = [];
  for (const [heading, text] of sections(readme))
    if (!["Methods", "Vectors"].includes(heading)) body.push(`## ${heading}`, "", text, "");
  body.push("## Errors", "", "A failed call answers `{ id, ok: false, error }` with a code:", "");
  body.push(list(codes), "", "Any call can also fail with `invalid_params` (params that do not");
  body.push(
    "match the schema) or `internal`. Each method lists the other codes its spec names.",
    "",
  );
  let namespace = null;
  for (const method of methods) {
    if (method.doc !== namespace) {
      namespace = method.doc;
      body.push(`## ${(namespace.title ?? "").split(": ").pop() || method.name.split(".")[0]}`, "");
      if (namespace.description) body.push(namespace.description, "");
    }
    const scope = scopeOf(method.params, specs.defs);
    const covered = scope.names.length > 0 ? scope.names : coveredBy(method.name);
    const text = prose.get(method.name) ?? method.params?.description ?? "";
    const own = codes.filter((c) => c !== "invalid_params" && text.includes(code(c)));
    const errors = [...new Set([...(covered.length > 0 ? ["permission_denied"] : []), ...own])];
    body.push(`### ${code(method.name)}`, "", text, "");
    body.push(`**Permission:** ${permissionLine(scope, covered)}`, "");
    body.push("**Params**", "", fields(method.params, ctx), "");
    body.push("**Result**", "", fields(method.result, ctx), "");
    body.push(`**Errors:** ${errors.length > 0 ? `${list(errors)}.` : "none of its own."}`, "");
  }
  body.push("## Events", "", "Messages `{ event, data }` the core sends without being asked.", "");
  const subscribable = specs.defs.get("EventName")?.schema?.enum ?? [];
  for (const event of events) {
    const by = coveredBy(event.name);
    body.push(`### ${code(event.name)}`, "");
    if (event.schema.description) body.push(event.schema.description, "");
    const who = by.length > 0 ? `${list(by)}.` : "none of its own (see Callers and events).";
    body.push(`**Permission:** ${who}`, "");
    if (subscribable.includes(event.name))
      body.push("About other callers too through `events.subscribe` (`events:subscribe`).", "");
    body.push("**Data**", "", fields(event.data, ctx), "");
  }
  body.push(...typesSection(ctx.types, ctx));
  return page("Bridge", "Every Desk bridge v0 method and event, from specs/bridge/v0.", body);
}

function renderPermissions(root, specs) {
  const covers = coversTable(read(join(root, "specs/plugin/v0/README.md")));
  const vocabulary = specs.defs.get("Permission")?.schema;
  const perms = (vocabulary?.oneOf ?? []).map((s) => specs.defs.get(refName(s.$ref))?.schema);
  const ctx = context(specs.defs, perms, (d) => d.folder === "plugin/v0");
  const { methods } = bridgeModel(specs);
  const [rows, parts] = [[], []];
  for (const schema of perms.filter(Boolean)) {
    const name = constOf(schema);
    const scope = Object.keys(schema.properties).filter((k) => k !== "permission");
    const carried = methods.filter((m) => scopeOf(m.params, specs.defs).names.includes(name));
    const text = covers.get(name)?.text || list(carried.map((m) => m.name)) || "nothing yet";
    rows.push([code(name), scope.length > 0 ? list(scope) : "none", cell(text)]);
    parts.push(`### ${code(name)}`, "", schema.description ?? "", "", `**Covers:** ${text}`, "");
    const own = Object.fromEntries(scope.map((k) => [k, schema.properties[k]]));
    parts.push("**Scope**", "", fields({ ...schema, properties: own }, ctx), "");
  }
  const body = [vocabulary?.description ?? "", "", table(["Permission", "Scope", "Covers"], rows)];
  body.push("", "## Permissions", "", ...parts, ...typesSection(ctx.types, ctx));
  return page("Permissions", "The Desk permission vocabulary, from specs/plugin/v0.", body);
}

function manifestRoot(specs) {
  const doc = specs.docs["plugin/v0"].find((d) => d.$id?.endsWith("/plugin.schema.json"));
  return specs.defs.get(refName(doc?.$ref ?? "PluginManifest"))?.schema;
}

function renderManifest(specs) {
  const manifest = manifestRoot(specs);
  const owns = (d) => d.folder === "plugin/v0" && !d.doc.$id?.endsWith("/permission.schema.json");
  const ctx = context(specs.defs, [manifest], owns);
  const body = [manifest?.description ?? "", "", "## Fields", "", fields(manifest, ctx), ""];
  body.push("`permissions` holds entries of the permission vocabulary (see Permissions).", "");
  body.push(...typesSection(ctx.types, ctx));
  return page("Plugin manifest", "Every plugin.json field, from specs/plugin/v0.", body);
}

/** A spec's page: its schemas' descriptions, then every type it defines, in file order. */
function renderTyped(specs, title, folder) {
  const names = specs.docs[folder].flatMap((doc) => Object.keys(doc.$defs ?? {}));
  const intro = specs.docs[folder].flatMap((doc) => [doc.description ?? "", ""]);
  const ctx = { defs: specs.defs, link: (name) => names.includes(name) };
  return page(title, `Every type of specs/${folder}.`, [...intro, ...typesSection(names, ctx)]);
}

function renderBrain(root) {
  const { openapi, bundle } = loadBrain(root);
  const entries = Object.entries(bundle.$defs ?? {});
  const defs = new Map(entries.map(([name, schema]) => [name, { name, schema }]));
  const ctx = { defs, link: (name) => defs.has(name) };
  const parts = openapi.components ?? {};
  const deref = (node, kind) => (node?.$ref ? parts[kind]?.[refName(node.$ref)] : node);
  const bodyOf = (content) => {
    const [media, { schema } = {}] = Object.entries(content ?? {})[0] ?? [];
    return schema ? `${typeOf(schema, ctx)} (${media})` : "";
  };
  const body = [openapi.info?.description ?? "", ""];
  for (const server of openapi.servers ?? [])
    body.push(`Server: ${code(server.url)}. ${server.description ?? ""}`, "");
  for (const [name, auth] of Object.entries(parts.securitySchemes ?? {})) {
    const how = `${auth.scheme ?? auth.type}. ${auth.description ?? ""}`;
    body.push(`Authentication ${code(name)}: ${how}`, "");
  }
  const tags = new Map((openapi.tags ?? []).map((t) => [t.name, { ...t, ops: [] }]));
  for (const [path, item] of Object.entries(openapi.paths ?? {})) {
    for (const verb of ["get", "put", "post", "patch", "delete"].filter((v) => item[v])) {
      const op = item[verb];
      const tag = op.tags?.[0] ?? "other";
      if (!tags.has(tag)) tags.set(tag, { name: tag, ops: [] });
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      tags.get(tag).ops.push({ path, verb, op, params: params.map((p) => deref(p, "parameters")) });
    }
  }
  for (const tag of [...tags.values()].filter((t) => t.ops.length > 0)) {
    body.push(`## ${tag.name}`, "");
    if (tag.description) body.push(tag.description, "");
    for (const { path, verb, op, params } of tag.ops) {
      body.push(`### ${code(op.operationId ?? `${verb} ${path}`)}`, "");
      body.push(`${code(`${verb.toUpperCase()} ${path}`)}: ${op.summary ?? ""}`, "");
      if (op.description) body.push(op.description, "");
      const rows = params
        .filter(Boolean)
        .map((p) => [code(p.name), p.in, cell(typeOf(p.schema, ctx)), cell(p.description)]);
      if (rows.length > 0) body.push(table(["Parameter", "In", "Type", "Description"], rows), "");
      const request = deref(op.requestBody, "requestBodies");
      if (request) body.push(`Request body: ${bodyOf(request.content)}`, "");
      const responses = Object.entries(op.responses ?? {}).map(([status, raw]) => {
        const response = deref(raw, "responses") ?? {};
        return [code(status), cell(response.description), cell(bodyOf(response.content))];
      });
      body.push(table(["Status", "Description", "Body"], responses), "");
    }
  }
  body.push(...typesSection([...defs.keys()], ctx));
  const title = `${openapi.info?.title ?? "Brain API"} ${openapi.info?.version ?? ""}`.trim();
  return page("Brain API", `${title}, from specs/brain/v0/openapi.yaml.`, body);
}

const INDEX = [
  ["[Bridge](bridge/)", "`specs/bridge/v0`", "Methods: params, result, errors, permission; events"],
  ["[Permissions](permissions/)", "`specs/plugin/v0`", "The vocabulary and what each covers"],
  ["[Plugin manifest](manifest/)", "`specs/plugin/v0`", "Every `plugin.json` field"],
  ["[Brain API](brain/)", "`specs/brain/v0/openapi.yaml`", "Endpoints, responses and schemas"],
  ...TYPED.map(([t, f]) => [`[${t}](${slug(t)}/)`, code(`specs/${f}`), "Every type it defines"]),
];
const NOTE =
  "Rendered from `specs/` by `just docs-api <out>`. v0 may break on any minor release (ADR 0004).";

/** The pages for the specs under `root`, by file name. */
export function render(root = ROOT) {
  const specs = loadSpecs(root);
  const index = [NOTE, "", table(["Page", "Spec", "What it holds"], INDEX), ""];
  return {
    "index.md": page("API reference", "Desk's contracts, rendered from specs/.", index),
    "bridge.md": renderBridge(root, specs),
    "permissions.md": renderPermissions(root, specs),
    "manifest.md": renderManifest(specs),
    "brain.md": renderBrain(root),
    ...Object.fromEntries(TYPED.map(([t, f]) => [`${slug(t)}.md`, renderTyped(specs, t, f)])),
  };
}

/** Render into `out` and return the paths written. */
export function write(root, out) {
  mkdirSync(out, { recursive: true });
  const pages = Object.entries(render(root));
  for (const [name, text] of pages) writeFileSync(join(out, name), text);
  return pages.map(([name]) => join(out, name));
}

/**
 * What the specs define and the pages in `out` lack, as `<page>: <kind> <name>`. It scans the spec
 * files itself instead of asking the renderer, so a renderer that drops something cannot hide it.
 */
export function missing(root, out) {
  const scan = (folder, key) => {
    const dir = join(root, "specs", folder);
    const pattern = new RegExp(`"${key}":\\s*\\{\\s*"const":\\s*"([^"]+)"`, "g");
    const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".schema.json")) : [];
    return files.sort().flatMap((n) => [...read(join(dir, n)).matchAll(pattern)].map((m) => m[1]));
  };
  const heading = (file, kind) => (name) => [file, kind, name, `\n### ${code(name)}\n`];
  const fieldNames = Object.keys(manifestRoot(loadSpecs(root))?.properties ?? {});
  const ids = read(join(root, "specs/brain/v0/openapi.yaml")).matchAll(/operationId:\s*(\S+)/g);
  const expected = [
    ...scan("bridge/v0", "method").map(heading("bridge.md", "method")),
    ...scan("bridge/v0", "event").map(heading("bridge.md", "event")),
    ...scan("plugin/v0", "permission").map(heading("permissions.md", "permission")),
    ...[...ids].map((m) => heading("brain.md", "endpoint")(m[1])),
    ...fieldNames.map((f) => ["manifest.md", "field", f, `| ${code(f)} |`]),
  ];
  return expected
    .filter(([file, , , line]) => !read(join(out, file)).includes(line))
    .map(([file, kind, name]) => `${file}: ${kind} ${name}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--root");
  const root = at === -1 ? ROOT : resolve(args.splice(at, 2)[1] ?? "");
  const out = args[0] && resolve(args[0]);
  if (!out) {
    console.error("usage: node scripts/spec-docs.mjs <out> [--root <dir with specs/>]");
    process.exit(2);
  }
  const written = write(root, out);
  const gaps = missing(root, out);
  for (const gap of gaps) console.error(`spec-docs: missing ${gap}`);
  if (gaps.length === 0) console.log(`spec-docs: ${written.length} pages in ${out}`);
  else process.exit(1);
}
