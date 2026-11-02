/**
 * The JSON Schemas of `specs/` (draft 2020-12) checked in the webview, without compiling code: Ajv
 * builds validators with `new Function`, which the app's CSP (`script-src 'self'`) refuses. It knows
 * the keywords the specs use (type, enum, const, the string, number, array and object keywords, $ref
 * across the spec files by their $id, allOf, anyOf, oneOf, not, if/then/else) and ignores the rest,
 * formats included, as the contract tests' Ajv does. `bundle` gathers one definition and everything
 * it references into a self-contained schema, for a brain that cannot follow references.
 */

type Node = Record<string, unknown>;
type Schema = Node | boolean;

/** One spec file: its `$id` resolves the relative references of the others. */
export interface SchemaDocument {
  $id: string;
  $defs?: Record<string, unknown>;
  [keyword: string]: unknown;
}

export interface BundleOptions {
  /** Leave out descriptions, titles, examples and defaults: what a short prompt can carry. */
  compact?: boolean;
  /** Properties of the root object to leave out, from `properties` and `required`. */
  omit?: string[];
}

const ANNOTATIONS = new Set(["description", "title", "examples", "default", "$comment"]);
/** Keywords whose value maps names to schemas, not a schema itself. */
const MAPS = new Set(["properties", "patternProperties", "$defs", "dependentSchemas"]);
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const pointerOf = (at: string) => at || "/";
const segment = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** The JSON type of a value, as JSON Schema names it ("integer" is also a "number"). */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** JSON equality, for enum, const and uniqueItems. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isNode(a) && isNode(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && same(a[k], b[k]));
  }
  return false;
}

export class Schemas {
  readonly #documents = new Map<string, SchemaDocument>();
  readonly #patterns = new Map<string, RegExp>();

  constructor(documents: SchemaDocument[]) {
    for (const doc of documents) this.#documents.set(doc.$id, doc);
  }

  /**
   * Why `value` does not match the schema at `ref` (an absolute URI with a fragment), each
   * `<pointer>: <what>`, at most `max`; none when it matches.
   */
  validate(value: unknown, ref: string, max = 20): string[] {
    const { schema, base } = this.#resolve(ref, "");
    return this.#check(value, schema, base, "").slice(0, max);
  }

  /** The schema at `ref` with every definition it reaches in its own `$defs`. */
  bundle(ref: string, options: BundleOptions = {}): Node {
    const defs: Record<string, unknown> = {};
    const names = new Map<string, string>();
    const omit = new Set(options.omit ?? []);
    const nameOf = (uri: string) => {
      const known = names.get(uri);
      if (known) return known;
      const wanted = decodeURIComponent(uri.split("/").at(-1) ?? "Schema");
      let name = wanted;
      for (let n = 2; name in defs; n++) name = `${wanted}${n}`;
      names.set(uri, name);
      const { schema, base } = this.#resolve(uri, "");
      defs[name] = {};
      defs[name] = copy(schema, base);
      return name;
    };
    const copy = (schema: unknown, base: string): unknown => {
      if (!isNode(schema)) return schema;
      const out: Node = {};
      for (const [key, value] of Object.entries(schema)) {
        if (key === "$id" || key === "$schema" || key === "$defs") continue;
        if (options.compact && ANNOTATIONS.has(key)) continue;
        if (key === "$ref" && typeof value === "string")
          out.$ref = `#/$defs/${nameOf(new URL(value, base).href)}`;
        else if (MAPS.has(key) && isNode(value))
          out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v, base)]));
        else if (Array.isArray(value)) out[key] = value.map((v) => (isNode(v) ? copy(v, base) : v));
        else out[key] = isNode(value) ? copy(value, base) : value;
      }
      return out;
    };
    const { schema, base } = this.#resolve(ref, "");
    const root = isNode(schema) ? structuredClone(schema) : {};
    if (isNode(root.properties))
      root.properties = Object.fromEntries(
        Object.entries(root.properties).filter(([key]) => !omit.has(key)),
      );
    if (Array.isArray(root.required)) root.required = root.required.filter((k) => !omit.has(k));
    const top = copy(root, base) as Node;
    return { ...top, $defs: defs };
  }

  /** The schema a reference names, and the base its own references resolve against. */
  #resolve(ref: string, base: string): { schema: Schema; base: string } {
    const url = new URL(ref, base || undefined);
    const fragment = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    const doc = this.#documents.get(url.href);
    if (!doc) throw new Error(`no schema ${url.href}`);
    let node: unknown = doc;
    for (const part of fragment.split("/").slice(1)) {
      node = isNode(node) ? node[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
    }
    if (!isNode(node) && typeof node !== "boolean") throw new Error(`no schema at ${ref}`);
    return { schema: node, base: url.href };
  }

  #regex(pattern: string): RegExp {
    let found = this.#patterns.get(pattern);
    if (!found) {
      found = new RegExp(pattern, "u");
      this.#patterns.set(pattern, found);
    }
    return found;
  }

  #check(value: unknown, schema: Schema, base: string, at: string): string[] {
    if (schema === true) return [];
    if (schema === false) return [`${pointerOf(at)}: is not allowed`];
    const s = schema;
    const problems: string[] = [];
    const say = (what: string, where = at) => problems.push(`${pointerOf(where)}: ${what}`);
    if (typeof s.$ref === "string") {
      const target = this.#resolve(s.$ref, base);
      problems.push(...this.#check(value, target.schema, target.base, at));
    }
    const type = typeOf(value);
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      const fits = types.some((t) => t === type || (t === "number" && type === "integer"));
      if (!fits) {
        say(`must be ${types.join(" or ")}`);
        return problems;
      }
    }
    if (Array.isArray(s.enum) && !s.enum.some((v) => same(v, value)))
      say(
        `must be one of ${s.enum.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")}`,
      );
    if ("const" in s && !same(s.const, value)) say(`must be ${JSON.stringify(s.const)}`);
    if (typeof value === "string") problems.push(...this.#string(value, s, at));
    if (typeof value === "number") problems.push(...numberProblems(value, s, at));
    if (Array.isArray(value)) problems.push(...this.#array(value, s, base, at));
    if (isNode(value)) problems.push(...this.#object(value, s, base, at));
    problems.push(...this.#combined(value, s, base, at));
    return problems;
  }

  #string(value: string, s: Node, at: string): string[] {
    const out: string[] = [];
    const length = [...value].length;
    if (typeof s.minLength === "number" && length < s.minLength)
      out.push(`${pointerOf(at)}: must be at least ${s.minLength} characters`);
    if (typeof s.maxLength === "number" && length > s.maxLength)
      out.push(`${pointerOf(at)}: must be at most ${s.maxLength} characters`);
    if (typeof s.pattern === "string" && !this.#regex(s.pattern).test(value))
      out.push(`${pointerOf(at)}: must match ${s.pattern}`);
    return out;
  }

  #array(value: unknown[], s: Node, base: string, at: string): string[] {
    const out: string[] = [];
    const prefix = Array.isArray(s.prefixItems) ? (s.prefixItems as Schema[]) : [];
    value.forEach((item, i) => {
      const schema = prefix[i] ?? (s.items as Schema | undefined);
      if (schema !== undefined) out.push(...this.#check(item, schema, base, `${at}/${i}`));
    });
    if (typeof s.minItems === "number" && value.length < s.minItems)
      out.push(`${pointerOf(at)}: must have at least ${s.minItems} items`);
    if (typeof s.maxItems === "number" && value.length > s.maxItems)
      out.push(`${pointerOf(at)}: must have at most ${s.maxItems} items`);
    if (s.uniqueItems === true && value.some((v, i) => value.findIndex((w) => same(v, w)) !== i))
      out.push(`${pointerOf(at)}: must not repeat an item`);
    return out;
  }

  #object(value: Node, s: Node, base: string, at: string): string[] {
    const out: string[] = [];
    const properties = isNode(s.properties) ? s.properties : {};
    const patterns = isNode(s.patternProperties) ? s.patternProperties : {};
    for (const key of Array.isArray(s.required) ? (s.required as string[]) : [])
      if (!(key in value)) out.push(`${pointerOf(at)}: must have ${key}`);
    for (const [key, child] of Object.entries(value)) {
      const where = `${at}/${segment(key)}`;
      let known = false;
      if (key in properties) {
        known = true;
        out.push(...this.#check(child, properties[key] as Schema, base, where));
      }
      for (const [pattern, schema] of Object.entries(patterns))
        if (this.#regex(pattern).test(key)) {
          known = true;
          out.push(...this.#check(child, schema as Schema, base, where));
        }
      if (s.propertyNames !== undefined)
        for (const why of this.#check(key, s.propertyNames as Schema, base, where))
          out.push(`${pointerOf(at)}: the name ${key} ${why.slice(why.indexOf(": ") + 2)}`);
      if (known || s.additionalProperties === undefined || s.additionalProperties === true)
        continue;
      if (s.additionalProperties === false)
        out.push(`${pointerOf(at)}: has ${key}, which is not allowed here`);
      else out.push(...this.#check(child, s.additionalProperties as Schema, base, where));
    }
    const count = Object.keys(value).length;
    if (typeof s.minProperties === "number" && count < s.minProperties)
      out.push(`${pointerOf(at)}: must have at least ${s.minProperties} properties`);
    if (typeof s.maxProperties === "number" && count > s.maxProperties)
      out.push(`${pointerOf(at)}: must have at most ${s.maxProperties} properties`);
    if (isNode(s.dependentRequired))
      for (const [key, needs] of Object.entries(s.dependentRequired))
        if (key in value)
          for (const need of needs as string[])
            if (!(need in value)) out.push(`${pointerOf(at)}: must have ${need} with ${key}`);
    return out;
  }

  /** allOf, anyOf, oneOf, not and if/then/else; a failed anyOf or oneOf says its closest form. */
  #combined(value: unknown, s: Node, base: string, at: string): string[] {
    const out: string[] = [];
    const each = (list: unknown) =>
      (Array.isArray(list) ? (list as Schema[]) : []).map((schema) =>
        this.#check(value, schema, base, at),
      );
    for (const problems of each(s.allOf)) out.push(...problems);
    const closest = (results: string[][]) =>
      results.reduce((best, next) => (next.length < best.length ? next : best));
    if (Array.isArray(s.anyOf)) {
      const results = each(s.anyOf);
      if (results.length && !results.some((r) => r.length === 0)) out.push(...closest(results));
    }
    if (Array.isArray(s.oneOf)) {
      const results = each(s.oneOf);
      const passed = results.filter((r) => r.length === 0).length;
      if (results.length && passed === 0) out.push(...closest(results));
      if (passed > 1) out.push(`${pointerOf(at)}: must match exactly one of its forms`);
    }
    if (s.not !== undefined && this.#check(value, s.not as Schema, base, at).length === 0)
      out.push(`${pointerOf(at)}: must not match the form it excludes`);
    if (s.if !== undefined) {
      const holds = this.#check(value, s.if as Schema, base, at).length === 0;
      const next = holds ? s.then : s.else;
      if (next !== undefined) out.push(...this.#check(value, next as Schema, base, at));
    }
    return out;
  }
}

function numberProblems(value: number, s: Node, at: string): string[] {
  const out: string[] = [];
  const where = pointerOf(at);
  if (typeof s.minimum === "number" && value < s.minimum)
    out.push(`${where}: must be at least ${s.minimum}`);
  if (typeof s.maximum === "number" && value > s.maximum)
    out.push(`${where}: must be at most ${s.maximum}`);
  if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum)
    out.push(`${where}: must be more than ${s.exclusiveMinimum}`);
  if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum)
    out.push(`${where}: must be less than ${s.exclusiveMaximum}`);
  if (typeof s.multipleOf === "number" && !Number.isInteger(value / s.multipleOf))
    out.push(`${where}: must be a multiple of ${s.multipleOf}`);
  return out;
}
