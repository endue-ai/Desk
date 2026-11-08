// Turn JSON Schema documents into a small model both emitters share.
//
// Supported subset (anything else is an error, so specs stay generator-friendly):
//   definitions: object with properties (struct), string enum, oneOf of $refs (union), anything else (alias)
//   types: $ref, const (string or boolean, fields only), string, integer, number, boolean, array,
//          object with additionalProperties (map), object without properties (free object), {} (any)
// Validation-only keywords (pattern, minimum, if/then, ...) are ignored by the generator.

/** @returns {{ defs: object[], byName: Map<string, object> }} */
export function buildModel(docs) {
  const known = new Set();
  for (const doc of docs) for (const name of Object.keys(doc.$defs ?? {})) known.add(name);
  const defs = [];
  for (const doc of docs) {
    for (const [name, schema] of Object.entries(doc.$defs ?? {})) {
      defs.push(defOf(name, schema, doc.$id, known));
    }
  }
  return { defs, byName: new Map(defs.map((def) => [def.name, def])) };
}

function defOf(name, schema, base, known) {
  const doc = schema.description ?? "";
  if (schema.oneOf) {
    const variants = schema.oneOf.map((branch) => {
      if (!branch.$ref) throw new Error(`${name}: oneOf branches must be $refs`);
      return refName(branch.$ref, base, known, name);
    });
    return { kind: "union", name, doc, variants };
  }
  if (schema.type === "string" && Array.isArray(schema.enum)) {
    return { kind: "enum", name, doc, values: schema.enum };
  }
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties).map(([field, prop]) => ({
      name: field,
      doc: prop.description ?? "",
      required: required.has(field),
      type: typeOf(prop, base, known, `${name}.${field}`),
    }));
    return { kind: "struct", name, doc, fields, closed: schema.additionalProperties === false };
  }
  return { kind: "alias", name, doc, type: typeOf(schema, base, known, name) };
}

function typeOf(schema, base, known, where) {
  if (schema.$ref) return { kind: "ref", name: refName(schema.$ref, base, known, where) };
  if ("const" in schema) {
    if (typeof schema.const !== "string" && typeof schema.const !== "boolean") {
      throw new Error(`${where}: only string and boolean consts are supported`);
    }
    return { kind: "const", value: schema.const };
  }
  if (schema.oneOf || schema.anyOf || schema.allOf)
    throw new Error(`${where}: name inline unions in $defs`);
  switch (schema.type) {
    case "string":
      if (schema.enum) throw new Error(`${where}: name inline enums in $defs`);
      return { kind: "string" };
    case "integer":
      return {
        kind: typeof schema.minimum === "number" && schema.minimum >= 0 ? "unsigned" : "integer",
      };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "array":
      return { kind: "array", items: typeOf(schema.items ?? {}, base, known, `${where}[]`) };
    case "object":
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        throw new Error(`${where}: name inline objects in $defs`);
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return {
          kind: "map",
          values: typeOf(schema.additionalProperties, base, known, `${where}{}`),
        };
      }
      return { kind: "object" };
    case undefined:
      return { kind: "any" };
    default:
      throw new Error(`${where}: unsupported type ${JSON.stringify(schema.type)}`);
  }
}

function refName(ref, base, known, where) {
  const url = new URL(ref, base);
  const match = /^#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/.exec(url.hash);
  if (!match) throw new Error(`${where}: unsupported $ref ${ref}`);
  const name = match[1];
  if (!known.has(name)) throw new Error(`${where}: $ref to unknown definition ${name}`);
  return name;
}

/** "fs.read" → "FsRead", "fs:read" → "FsRead", "turn.started" → "TurnStarted". */
export function pascal(text) {
  return String(text)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

/** "createDirs" → "create_dirs". */
export function snake(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

/** Union variant name: drop the union's last word when the variant ends with it (FsReadRequest → FsRead). */
export function variantName(union, variant) {
  const last = /[A-Z][a-z0-9]*$/.exec(union)?.[0] ?? "";
  return last && variant.endsWith(last) && variant !== last
    ? variant.slice(0, -last.length)
    : variant;
}

/** Bridge methods: for each BridgeRequest variant, its method, params type and result type. */
export function bridgeMethods(model) {
  const union = model.byName.get("BridgeRequest");
  if (!union) return [];
  return union.variants.map((variant) => {
    const def = model.byName.get(variant);
    const method = def.fields.find((f) => f.name === "method")?.type;
    const params = def.fields.find((f) => f.name === "params")?.type;
    const result = variant.replace(/Request$/, "Result");
    if (method?.kind !== "const" || params?.kind !== "ref" || !model.byName.has(result)) {
      throw new Error(`${variant}: needs a const method, a params $ref and a ${result} definition`);
    }
    return { method: method.value, params: params.name, result, request: variant };
  });
}
