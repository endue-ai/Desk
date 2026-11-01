// Where a document's JSON Schema comes from: the schema picked with "Validate with..." (kept per
// file in the store), the document's own `$schema` when it is a relative path, a
// `# yaml-language-server: $schema=` comment, or a sibling `<name>.schema.json`. Remote URLs are
// never fetched. Paths stay as the desk writes them (`~/...`).

import { childrenOf } from "./tree.js";

/**
 * @typedef {import("./formats.js").Opened} Opened
 * @typedef {"picked" | "$schema" | "comment" | "sibling"} SchemaSource
 * @typedef {{ how: SchemaSource, path?: string, url?: string }} SchemaPlace
 */

/** Formats a schema can check. */
export const CHECKED = new Set(["json", "jsonc", "json5", "yaml", "toml"]);
const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i;
const COMMENT = /^#\s*yaml-language-server:\s*\$schema=(\S+)/m;

export const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "." : path.slice(0, slash);
};

export const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** `ref` against `folder`, with `.` and `..` resolved; `~/` and `/` paths stay as they are. */
export function join(/** @type {string} */ folder, /** @type {string} */ ref) {
  if (ref.startsWith("/") || ref.startsWith("~/") || ref === "~") return ref;
  const parts = folder.split("/");
  for (const part of ref.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 1 && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/**
 * Where the schema for `path` is said to be, before a picked one is considered.
 * @param {string} path
 * @param {Opened} opened
 * @returns {SchemaPlace | undefined}
 */
export function schemaPlace(path, opened) {
  const folder = folderOf(path);
  const said = (/** @type {string} */ ref, /** @type {SchemaSource} */ how) =>
    URL_LIKE.test(ref) && !/^[a-z]:[\\/]/i.test(ref)
      ? { how, url: ref }
      : { how, path: join(folder, ref) };
  const root = opened.doc?.roots[0];
  if (root?.kind === "object") {
    const own = childrenOf(root).find((child) => child.key === "$schema");
    if (own?.kind === "string" && typeof own.value === "string" && own.value !== "")
      return said(own.value, "$schema");
  }
  if (opened.format === "yaml") {
    const m = COMMENT.exec(opened.text ?? "");
    if (m?.[1]) return said(m[1], "comment");
  }
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  if (stem.endsWith(".schema")) return undefined;
  return { how: "sibling", path: `${folder}/${stem}.schema.json` };
}

/**
 * The schema files a schema's $refs name in its folder: `common.schema.json#/$defs/x` or
 * `./common.schema.json`. Paths into other folders and URLs are left out.
 * @param {unknown} schema
 * @returns {string[]}
 */
export function referencedFiles(schema) {
  const found = new Set();
  /** @param {unknown} value */
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "$ref" && typeof inner === "string") {
          const file = inner.split("#")[0]?.replace(/^\.\//, "") ?? "";
          if (file !== "" && !file.includes("/") && !URL_LIKE.test(file)) found.add(file);
        } else walk(inner);
      }
    }
  };
  walk(schema);
  return [...found];
}

/** The store key for a file's picked schema: store keys are short, so the path is hashed. */
export function pickedKey(/** @type {string} */ path) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `schema.${hash.toString(16).padStart(8, "0")}`;
}
