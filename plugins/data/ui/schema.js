// JSON Schema (draft 2020-12) checked against the typed tree, so every error knows its node's
// pointer, line and column: type, enum, const, the number, string, array and object keywords, $ref
// to #/$defs/... and to schema files in the same folder (loaded beforehand), allOf, anyOf, oneOf,
// not, if/then/else and dependentRequired. Keywords it does not know are ignored.

import { childrenOf, numberOf, plainOf, pointerOf } from "./tree.js";

/**
 * @typedef {import("./tree.js").DataNode} DataNode
 * @typedef {{ pointer: string, message: string, keyword: string, line: number, col: number, root?: number }} SchemaError
 * @typedef {Record<string, any> | boolean} Schema
 * @typedef {{ files: Record<string, unknown>, base: unknown, depth: number }} Context
 */

const MAX_REF_DEPTH = 64;

/**
 * @param {DataNode} root
 * @param {unknown} schema
 * @param {{ files?: Record<string, unknown> }} [options]
 * @returns {SchemaError[]}
 */
export function validate(root, schema, options = {}) {
  return check([root], /** @type {Schema} */ (schema), {
    files: options.files ?? {},
    base: schema,
    depth: 0,
  });
}

/** The JSON Schema type of a node; dates are strings. */
const typeOf = (/** @type {DataNode} */ node) => {
  if (node.kind === "date") return "string";
  if (node.kind === "number") return Number.isInteger(numberOf(node)) ? "integer" : "number";
  return node.kind;
};

/** Whether a node has a JSON Schema type. */
const hasType = (/** @type {DataNode} */ node, /** @type {string} */ type) => {
  const actual = typeOf(node);
  return actual === type || (type === "number" && actual === "integer");
};

/** A value's canonical text: equal values give equal text, whatever the key order. */
const canonical = (/** @type {unknown} */ value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/** @param {unknown} value */
const show = (value) => {
  const text = JSON.stringify(value);
  return text && text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

/**
 * Follow a $ref: `#/$defs/x` in the schema it is in, or `file.schema.json#/...` in a loaded file.
 * @param {string} ref
 * @param {Context} ctx
 */
function resolveRef(ref, ctx) {
  const hash = ref.indexOf("#");
  const file = (hash < 0 ? ref : ref.slice(0, hash)).replace(/^\.\//, "");
  const fragment = hash < 0 ? "" : ref.slice(hash + 1);
  const base = file === "" ? ctx.base : ctx.files[file];
  if (base === undefined) return undefined;
  let at = /** @type {any} */ (base);
  if (fragment !== "") {
    for (const raw of fragment.replace(/^\//, "").split("/")) {
      const part = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      if (at === null || typeof at !== "object" || !(part in at)) return undefined;
      at = at[part];
    }
  }
  return { schema: /** @type {Schema} */ (at), base };
}

/**
 * The errors of the last node of `chain` against `schema`.
 * @param {DataNode[]} chain
 * @param {Schema} schema
 * @param {Context} ctx
 * @returns {SchemaError[]}
 */
function check(chain, schema, ctx) {
  const node = /** @type {DataNode} */ (chain.at(-1));
  /** @type {SchemaError[]} */
  const out = [];
  const fail = (/** @type {string} */ keyword, /** @type {string} */ message, at = chain) => {
    const target = /** @type {DataNode} */ (at.at(-1));
    out.push({ pointer: pointerOf(at), message, keyword, line: target.line, col: target.col });
  };
  if (schema === true || schema === undefined || schema === null) return out;
  if (schema === false) {
    fail("false", "Nothing is allowed here.");
    return out;
  }
  if (typeof schema !== "object") return out;
  const s = schema;
  if (typeof s.$ref === "string") {
    const target = resolveRef(s.$ref, ctx);
    if (!target) fail("$ref", `The schema's $ref ${s.$ref} cannot be found.`);
    else if (ctx.depth < MAX_REF_DEPTH)
      out.push(...check(chain, target.schema, { ...ctx, base: target.base, depth: ctx.depth + 1 }));
  }
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((type) => hasType(node, type)))
      fail("type", `Should be ${types.join(" or ")}, not ${typeOf(node)}.`);
  }
  const value = "enum" in s || "const" in s ? canonical(plainOf(node)) : "";
  if (Array.isArray(s.enum) && !s.enum.some((option) => canonical(option) === value))
    fail("enum", `Should be one of ${s.enum.map(show).join(", ")}.`);
  if ("const" in s && canonical(s.const) !== value) fail("const", `Should be ${show(s.const)}.`);
  if (node.kind === "number") numbers(numberOf(node), s, fail);
  if (node.kind === "string" || node.kind === "date") strings(String(node.value ?? ""), s, fail);
  if (node.kind === "array") arrays(chain, s, ctx, out, fail);
  if (node.kind === "object") objects(chain, s, ctx, out, fail);
  combinators(chain, s, ctx, fail);
  return out;
}

/**
 * @param {number} n
 * @param {Record<string, any>} s
 * @param {(keyword: string, message: string) => void} fail
 */
function numbers(n, s, fail) {
  if (typeof s.multipleOf === "number" && s.multipleOf > 0) {
    const q = n / s.multipleOf;
    if (Math.abs(q - Math.round(q)) > 1e-9 * Math.max(1, Math.abs(q)))
      fail("multipleOf", `Should be a multiple of ${s.multipleOf}.`);
  }
  if (typeof s.maximum === "number" && n > s.maximum)
    fail("maximum", `Should be at most ${s.maximum}.`);
  if (typeof s.exclusiveMaximum === "number" && n >= s.exclusiveMaximum)
    fail("exclusiveMaximum", `Should be less than ${s.exclusiveMaximum}.`);
  if (typeof s.minimum === "number" && n < s.minimum)
    fail("minimum", `Should be at least ${s.minimum}.`);
  if (typeof s.exclusiveMinimum === "number" && n <= s.exclusiveMinimum)
    fail("exclusiveMinimum", `Should be more than ${s.exclusiveMinimum}.`);
}

/**
 * @param {string} text
 * @param {Record<string, any>} s
 * @param {(keyword: string, message: string) => void} fail
 */
function strings(text, s, fail) {
  const length = [...text].length;
  if (typeof s.minLength === "number" && length < s.minLength)
    fail("minLength", `Should be at least ${s.minLength} characters long.`);
  if (typeof s.maxLength === "number" && length > s.maxLength)
    fail("maxLength", `Should be at most ${s.maxLength} characters long.`);
  if (typeof s.pattern === "string") {
    let pattern;
    try {
      pattern = new RegExp(s.pattern, "u");
    } catch {
      pattern = undefined;
    }
    if (pattern && !pattern.test(text)) fail("pattern", `Should match ${s.pattern}.`);
  }
}

/**
 * @param {DataNode[]} chain
 * @param {Record<string, any>} s
 * @param {Context} ctx
 * @param {SchemaError[]} out
 * @param {(keyword: string, message: string) => void} fail
 */
function arrays(chain, s, ctx, out, fail) {
  const items = childrenOf(/** @type {DataNode} */ (chain.at(-1)));
  const prefix = Array.isArray(s.prefixItems) ? s.prefixItems : [];
  items.forEach((item, i) => {
    const sub = i < prefix.length ? prefix[i] : s.items;
    if (sub !== undefined) out.push(...check([...chain, item], sub, ctx));
  });
  if (typeof s.minItems === "number" && items.length < s.minItems)
    fail("minItems", `Should have at least ${s.minItems} items.`);
  if (typeof s.maxItems === "number" && items.length > s.maxItems)
    fail("maxItems", `Should have at most ${s.maxItems} items.`);
  if (s.uniqueItems === true) {
    const seen = new Set();
    for (const item of items) {
      const key = canonical(plainOf(item));
      if (seen.has(key)) {
        fail("uniqueItems", `Should not repeat items: ${show(plainOf(item))} is there twice.`);
        break;
      }
      seen.add(key);
    }
  }
}

/**
 * @param {DataNode[]} chain
 * @param {Record<string, any>} s
 * @param {Context} ctx
 * @param {SchemaError[]} out
 * @param {(keyword: string, message: string, at?: DataNode[]) => void} fail
 */
function objects(chain, s, ctx, out, fail) {
  const members = childrenOf(/** @type {DataNode} */ (chain.at(-1)));
  const names = new Set(members.map((m) => String(m.key)));
  if (Array.isArray(s.required)) {
    const missing = s.required.filter((name) => !names.has(name));
    if (missing.length > 0)
      fail(
        "required",
        `Missing ${missing.length === 1 ? "property" : "properties"} ${missing.map(show).join(", ")}.`,
      );
  }
  const properties = s.properties && typeof s.properties === "object" ? s.properties : {};
  for (const [name, sub] of Object.entries(properties)) {
    const member = members.find((m) => m.key === name);
    if (member) out.push(...check([...chain, member], sub, ctx));
  }
  /** @type {Array<[RegExp, Schema]>} */
  const patterns = [];
  for (const [source, sub] of Object.entries(s.patternProperties ?? {})) {
    try {
      patterns.push([new RegExp(source, "u"), sub]);
    } catch {}
  }
  for (const member of members) {
    const name = String(member.key);
    for (const [pattern, sub] of patterns)
      if (pattern.test(name)) out.push(...check([...chain, member], sub, ctx));
  }
  if (s.additionalProperties !== undefined) {
    for (const member of members) {
      const name = String(member.key);
      if (name in properties || patterns.some(([pattern]) => pattern.test(name))) continue;
      if (s.additionalProperties === false)
        fail("additionalProperties", `${show(name)} is not allowed here.`, [...chain, member]);
      else out.push(...check([...chain, member], s.additionalProperties, ctx));
    }
  }
  for (const [name, needs] of Object.entries(s.dependentRequired ?? {})) {
    if (!names.has(name) || !Array.isArray(needs)) continue;
    const missing = needs.filter((need) => !names.has(need));
    if (missing.length > 0)
      fail("dependentRequired", `${show(name)} needs ${missing.map(show).join(", ")} too.`);
  }
}

/**
 * @param {DataNode[]} chain
 * @param {Record<string, any>} s
 * @param {Context} ctx
 * @param {(keyword: string, message: string) => void} fail
 */
function combinators(chain, s, ctx, fail) {
  const errorsOf = (/** @type {Schema} */ sub) => check(chain, sub, ctx);
  if (Array.isArray(s.allOf)) {
    const first = s.allOf.map(errorsOf).find((errors) => errors.length > 0)?.[0];
    if (first) fail("allOf", `Should match every schema in allOf: ${first.message}`);
  }
  if (Array.isArray(s.anyOf) && !s.anyOf.some((sub) => errorsOf(sub).length === 0))
    fail("anyOf", "Should match at least one schema in anyOf.");
  if (Array.isArray(s.oneOf)) {
    const matching = s.oneOf.filter((sub) => errorsOf(sub).length === 0).length;
    if (matching !== 1)
      fail("oneOf", `Should match exactly one schema in oneOf, but matches ${matching}.`);
  }
  if (s.not !== undefined && errorsOf(s.not).length === 0)
    fail("not", "Should not match the schema in not.");
  if (s.if !== undefined) {
    const matches = errorsOf(s.if).length === 0;
    const branch = matches ? "then" : "else";
    const first = s[branch] === undefined ? undefined : errorsOf(s[branch])[0];
    if (first) fail(branch, `${matches ? "Matches" : "Does not match"} if, so: ${first.message}`);
  }
}
