// Load the specs: JSON Schema documents, the OpenAPI brain spec (as a JSON Schema bundle) and vectors.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const DRAFT = "https://json-schema.org/draft/2020-12/schema";
export const BRAIN_ID = "https://endue.ai/specs/brain/v0/brain.schema.json";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** All *.schema.json documents of one spec folder, sorted by file name. */
export function loadSchemas(root, folder) {
  const dir = join(root, "specs", folder);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".schema.json"))
    .sort()
    .map((name) => readJson(join(dir, name)));
}

/** The brain OpenAPI document and its component schemas as one JSON Schema document. */
export function loadBrain(root) {
  const openapi = parse(readFileSync(join(root, "specs/brain/v0/openapi.yaml"), "utf8"));
  return { openapi, bundle: brainBundle(openapi) };
}

export function brainBundle(openapi) {
  const rewrite = (node) => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        key === "$ref" && typeof value === "string"
          ? value.replace("#/components/schemas/", "#/$defs/")
          : rewrite(value),
      ]),
    );
  };
  return {
    $schema: DRAFT,
    $id: BRAIN_ID,
    title: `${openapi.info.title} ${openapi.info.version}: component schemas`,
    description: "Generated from specs/brain/v0/openapi.yaml components.schemas.",
    $defs: rewrite(openapi.components.schemas),
  };
}

/**
 * The plugin manifest and the integration specs it references (permissions name item kinds, view
 * plugins carry views, connector plugins their connector block), which reference it back: one set.
 */
export const PLUGIN_FOLDERS = ["plugin/v0", "item/v0", "view/v0", "connector/v0"];

/** Every spec document, keyed by spec name: each set holds what its vectors need to resolve. */
export function loadAll(root = ROOT) {
  const plugin = PLUGIN_FOLDERS.flatMap((folder) => loadSchemas(root, folder));
  const init = [...plugin, ...loadSchemas(root, "init/v0")];
  return {
    bridge: [...init, ...loadSchemas(root, "bridge/v0")],
    plugin,
    item: plugin,
    view: plugin,
    connector: plugin,
    init,
    brain: [loadBrain(root).bundle],
  };
}

/** Each folder's documents (none when it is missing), and every definition by name and folder. */
export function loadDefs(root, folders) {
  const defs = new Map();
  const docs = {};
  for (const folder of folders) {
    docs[folder] = existsSync(join(root, "specs", folder)) ? loadSchemas(root, folder) : [];
    for (const doc of docs[folder])
      for (const [name, schema] of Object.entries(doc.$defs ?? {}))
        defs.set(name, { name, schema, folder, doc });
  }
  return { defs, docs };
}

/** Map each definition name to the URI that names it. Names must be unique within a set. */
export function defIndex(docs) {
  const index = new Map();
  for (const doc of docs) {
    for (const name of Object.keys(doc.$defs ?? {})) {
      if (index.has(name)) throw new Error(`definition ${name} is defined twice`);
      index.set(name, `${doc.$id}#/$defs/${name}`);
    }
  }
  return index;
}

/** Vectors of one spec: [{ file, valid, target, description, instance }]. */
export function loadVectors(root, spec) {
  const out = [];
  for (const kind of ["valid", "invalid"]) {
    const dir = join(root, "specs", spec, "v0", "vectors", kind);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()) {
      const { target, description, instance } = readJson(join(dir, name));
      out.push({
        file: `${spec}/v0/vectors/${kind}/${name}`,
        valid: kind === "valid",
        target,
        description,
        instance,
      });
    }
  }
  return out;
}
