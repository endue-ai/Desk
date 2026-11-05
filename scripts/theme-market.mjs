#!/usr/bin/env node
// theme-market: check a look market folder (ADR 0060, ADR 0091), this repository's market/themes and
// market/design-systems by default. A design system's entry has kind design-system and its bundle is a
// .desk-design: a design-system plugin with no files.
// Its index.json must be a ThemeIndex (specs/plugin/v0/theme-index.schema.json) whose ids are unique;
// every entry's bundle must sit beside it with the sha256 and size the index names, be a .desk-theme
// whose manifest is a valid theme plugin with the entry's id, name, version, author and licence, and
// carry exactly the font and image files its theme block names, within the asset limits. A bundle the
// index does not list is a problem too. `just check` runs it. Node 22; Ajv as spec-lint uses it.
//
//   node scripts/theme-market.mjs [folder]

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { loadSchemas, PLUGIN_FOLDERS, ROOT } from "./codegen/load.mjs";

export const MARKET = join(ROOT, "market/themes");
export const DESIGN_MARKET = join(ROOT, "market/design-systems");
const PLUGIN = "https://endue.ai/specs/plugin/v0/";
/** A theme's asset files: 2 MiB each and 8 MiB together, as `desk plugin validate` holds them. */
const ASSET_MAX = 2 << 20;
const ASSETS_MAX = 8 << 20;

let validators;
function validator(name) {
  if (!validators) {
    const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
    for (const doc of PLUGIN_FOLDERS.flatMap((folder) => loadSchemas(ROOT, folder)))
      ajv.addSchema(doc);
    validators = {
      index: ajv.getSchema(`${PLUGIN}theme-index.schema.json#/$defs/ThemeIndex`),
      bundle: ajv.getSchema(`${PLUGIN}theme.schema.json#/$defs/ThemeBundle`),
      manifest: ajv.getSchema(`${PLUGIN}plugin.schema.json`),
    };
  }
  return validators[name];
}

/** Schema errors as lines, `<prefix><where> <what>`, leaving out those under `skip`. */
function schemaProblems(validate, value, prefix, skip) {
  if (validate(value)) return [];
  const shown = validate.errors.filter((e) => !skip || !e.instancePath.startsWith(skip));
  return shown.map((e) => `${prefix}${e.instancePath} ${e.message}`);
}

/** The font and image files a theme block names, each once. */
function namedFiles(theme) {
  const fonts = (theme?.type?.fonts ?? []).map((font) => font.src);
  const images = [theme?.light, theme?.dark].map((v) => v?.backdrop?.image);
  return new Set([...fonts, ...images].filter((path) => typeof path === "string"));
}

/** Problems of one listed theme's bundle file. */
function checkBundle(dir, entry) {
  const at = (why) => `${entry.id}: ${why}`;
  if (/^https:\/\//.test(entry.url))
    return [at(`${entry.url}: this market's bundles sit beside index.json`)];
  const file = join(dir, entry.url);
  if (!existsSync(file)) return [at(`${entry.url} is missing`)];
  const bytes = readFileSync(file);
  const problems = [];
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== entry.sha256)
    problems.push(at(`sha256 ${sha256}, the index says ${entry.sha256}`));
  if (bytes.length !== entry.size)
    problems.push(at(`size ${bytes.length}, the index says ${entry.size}`));
  let bundle;
  try {
    bundle = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return [...problems, at(`${entry.url} is not JSON: ${error.message}`)];
  }
  const manifest = bundle?.manifest;
  const kind = entry.kind ?? "theme";
  if (manifest?.kind !== kind)
    problems.push(at(`the bundle is a ${manifest?.kind}, the index says ${kind}`));
  const ext = kind === "design-system" ? ".desk-design" : ".desk-theme";
  if (!entry.url.endsWith(ext)) problems.push(at(`a ${kind}'s bundle is a ${ext}`));
  problems.push(...schemaProblems(validator("manifest"), manifest, at("plugin.json")));
  // The manifest's own problems are told once, as plugin.json's.
  problems.push(...schemaProblems(validator("bundle"), bundle, at(entry.url), "/manifest"));
  if (manifest?.id !== entry.id) problems.push(at(`the bundle's id is ${manifest?.id}`));
  for (const field of ["name", "version"])
    if (manifest?.[field] !== entry[field])
      problems.push(
        at(`the bundle's ${field} is ${manifest?.[field]}, the index says ${entry[field]}`),
      );
  const theme = kind === "design-system" ? manifest?.designSystem : manifest?.theme;
  const block = kind === "design-system" ? "designSystem" : "theme";
  if (!theme?.license) problems.push(at(`the ${kind} names no licence (${block}.license)`));
  for (const field of ["author", "license"])
    if (theme?.[field] && entry[field] && theme[field] !== entry[field])
      problems.push(at(`the theme's ${field} is ${theme[field]}, the index says ${entry[field]}`));
  const named = kind === "design-system" ? new Set() : namedFiles(theme);
  const files = Object.entries(bundle?.files ?? {});
  let total = 0;
  for (const [path, base64] of files) {
    const size = typeof base64 === "string" ? Buffer.from(base64, "base64").length : 0;
    total += size;
    if (!named.has(path)) problems.push(at(`files: ${path} is not a file the theme names`));
    if (size > ASSET_MAX) problems.push(at(`files: ${path} is ${size} bytes, over ${ASSET_MAX}`));
  }
  for (const path of named)
    if (!files.some(([given]) => given === path)) problems.push(at(`files: ${path} is missing`));
  if (total > ASSETS_MAX) problems.push(at(`files: ${total} bytes together, over ${ASSETS_MAX}`));
  return problems;
}

/** Every problem of the market in `dir`, as lines; none when it checks out. */
export function checkMarket(dir = MARKET) {
  const path = join(dir, "index.json");
  if (!existsSync(path)) return ["index.json is missing"];
  let index;
  try {
    index = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return [`index.json is not JSON: ${error.message}`];
  }
  const problems = schemaProblems(validator("index"), index, "index.json: ");
  const themes = Array.isArray(index?.themes) ? index.themes : [];
  const seen = new Set();
  for (const entry of themes) {
    if (typeof entry?.id !== "string" || typeof entry.url !== "string") continue;
    if (seen.has(entry.id)) problems.push(`${entry.id}: listed twice`);
    seen.add(entry.id);
    problems.push(...checkBundle(dir, entry));
  }
  const listed = new Set(themes.map((entry) => entry?.url));
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".desk-theme") || n.endsWith(".desk-design"))
    .sort())
    if (!listed.has(name)) problems.push(`${name}: not in index.json`);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dirs = process.argv[2] ? [process.argv[2]] : [MARKET, DESIGN_MARKET];
  let failed = false;
  for (const dir of dirs) {
    const problems = checkMarket(dir);
    for (const problem of problems) console.error(`theme-market: ${problem}`);
    failed ||= problems.length > 0;
    if (problems.length > 0) continue;
    const count = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).themes.length;
    console.log(`theme-market: ${dir.slice(ROOT.length)}: ${count} check out`);
  }
  if (failed) process.exit(1);
}
