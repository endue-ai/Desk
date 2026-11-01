// Checking an open file against its JSON Schema: find the schema (schemas.js), read it and the
// schema files its $refs name in its folder, and run schema.js over every document. The panel's
// state says what happened: valid, invalid with errors, remote (never fetched), too large, failed.

import { decodeText } from "./formats.js";
import { parseJson } from "./parse/json.js";
import { parseYaml } from "./parse/yaml.js";
import { validate } from "./schema.js";
import { CHECKED, folderOf, join, pickedKey, referencedFiles, schemaPlace } from "./schemas.js";
import { plainOf } from "./tree.js";

/**
 * @typedef {import("./schema.js").SchemaError} SchemaError
 * @typedef {import("./formats.js").Opened} Opened
 * @typedef {object} SchemaState
 * @property {"none" | "loading" | "valid" | "invalid" | "remote" | "failed" | "too-large"} state
 * @property {import("./schemas.js").SchemaSource} [how]
 * @property {string} [source] The schema's path, or its URL when remote
 * @property {string} [note] Said in the schema panel
 * @property {SchemaError[]} errors
 * @typedef {{ path: string, size: number, opened: Opened }} Checked
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginContext["bridge"], "call">} Bridge
 */

/** Documents larger than this are not checked: it would build the whole tree. */
const MAX_CHECKED = 5 * 1024 * 1024;
const MAX_FILES = 20;

/**
 * @param {Bridge} bridge
 * @param {(path: string) => Promise<Uint8Array>} read
 */
export function createSchemaCheck(bridge, read) {
  /** A schema file as a plain value: JSON (comments allowed), or YAML for .yaml and .yml. */
  const load = async (/** @type {string} */ path) => {
    const decoded = decodeText(await read(path));
    if (decoded.text === undefined) throw new Error(`${path} is not text.`);
    const doc = /\.ya?ml$/i.test(path) ? parseYaml(decoded.text) : parseJson(decoded.text, "jsonc");
    const error = doc.errors[0];
    const root = doc.roots[0];
    if (error || !root) {
      const where = error ? ` (line ${error.line}: ${error.message})` : "";
      throw new Error(`The schema ${path} does not parse${where}.`);
    }
    return plainOf(root);
  };

  /** The schema files a schema refers to in its folder, and theirs, by name. */
  const loadReferenced = async (/** @type {unknown} */ schema, /** @type {string} */ source) => {
    /** @type {Record<string, unknown>} */
    const files = {};
    const queue = referencedFiles(schema);
    while (queue.length > 0 && Object.keys(files).length < MAX_FILES) {
      const name = /** @type {string} */ (queue.shift());
      if (name in files) continue;
      files[name] = undefined;
      try {
        files[name] = await load(join(folderOf(source), name));
        queue.push(...referencedFiles(files[name]));
      } catch {}
    }
    return files;
  };

  /**
   * @param {Checked} file
   * @returns {Promise<SchemaState>}
   */
  return async (file) => {
    const { opened, path } = file;
    const doc = opened.doc;
    if (!CHECKED.has(opened.format) || !doc || doc.roots.length === 0)
      return { state: "none", errors: [] };
    const stored = await bridge.call("store.get", { key: pickedKey(path) }).catch(() => ({}));
    const picked = /** @type {{ value?: { file?: unknown, schema?: unknown } }} */ (stored).value;
    const place =
      picked?.file === path && typeof picked.schema === "string"
        ? { how: /** @type {const} */ ("picked"), path: picked.schema }
        : schemaPlace(path, opened);
    if (!place) return { state: "none", errors: [] };
    const { how } = place;
    if (place.url) {
      const note = `Remote schemas are not fetched: ${place.url}.`;
      return { state: "remote", how, source: place.url, note, errors: [] };
    }
    const source = /** @type {string} */ (place.path);
    if (file.size > MAX_CHECKED) {
      const note = "Files over 5 MB are not checked against a schema.";
      return { state: "too-large", how, source, note, errors: [] };
    }
    let schema;
    try {
      schema = await load(source);
    } catch (error) {
      // A sibling schema is only a guess: when there is none, there is nothing to say.
      if (how === "sibling") return { state: "none", errors: [] };
      const note = error instanceof Error ? error.message : String(error);
      return { state: "failed", how, source, note, errors: [] };
    }
    const files = await loadReferenced(schema, source);
    const errors = doc.roots.flatMap((root, index) =>
      validate(root, schema, { files }).map((error) => ({ ...error, root: index })),
    );
    return { state: errors.length > 0 ? "invalid" : "valid", how, source, errors };
  };
}
