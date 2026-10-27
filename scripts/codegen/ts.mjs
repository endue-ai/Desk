// Model → TypeScript types. Output is unformatted; codegen.mjs pipes it through biome.
import { bridgeMethods } from "./model.mjs";

export function emitTs(model, { header, methods = false, extra = "" }) {
  const body = model.defs.map(emitDef).join("\n");
  return [
    header.map((line) => `// ${line}`).join("\n"),
    "",
    body,
    methods ? emitMethods(model) : "",
    extra,
  ].join("\n");
}

function docs(text, indent = "") {
  if (!text) return "";
  const lines = text.split("\n");
  if (lines.length === 1) return `${indent}/** ${text} */\n`;
  return `${indent}/**\n${lines.map((line) => `${indent} * ${line}`.trimEnd()).join("\n")}\n${indent} */\n`;
}

function emitDef(def) {
  switch (def.kind) {
    case "struct":
      if (def.fields.length === 0)
        return `${docs(def.doc)}export type ${def.name} = Record<string, never>;\n`;
      return [
        docs(def.doc),
        `export interface ${def.name} {\n`,
        ...def.fields.map(
          (field) =>
            `${docs(field.doc, "  ")}  ${property(field.name)}${field.required ? "" : "?"}: ${tsType(field.type)};\n`,
        ),
        "}\n",
      ].join("");
    case "enum":
      return `${docs(def.doc)}export type ${def.name} = ${def.values.map((v) => JSON.stringify(v)).join(" | ")};\n`;
    case "union":
      return `${docs(def.doc)}export type ${def.name} = ${def.variants.join(" | ")};\n`;
    case "alias":
      return `${docs(def.doc)}export type ${def.name} = ${tsType(def.type)};\n`;
    default:
      throw new Error(`unknown definition kind ${def.kind}`);
  }
}

function property(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function tsType(type) {
  switch (type.kind) {
    case "ref":
      return type.name;
    case "const":
      return JSON.stringify(type.value);
    case "string":
      return "string";
    case "integer":
    case "unsigned":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const items = tsType(type.items);
      return /^[A-Za-z0-9_"]+$/.test(items) ? `${items}[]` : `Array<${items}>`;
    }
    case "map":
      return `Record<string, ${tsType(type.values)}>`;
    case "object":
      return "Record<string, unknown>";
    case "any":
      return "unknown";
    default:
      throw new Error(`no TypeScript type for ${type.kind}`);
  }
}

function emitMethods(model) {
  const methods = bridgeMethods(model);
  return [
    "/** Params and result of each bridge method. */\n",
    "export interface BridgeMethodMap {\n",
    ...methods.map(
      (m) => `  ${JSON.stringify(m.method)}: { params: ${m.params}; result: ${m.result} };\n`,
    ),
    "}\n\n",
    "/** A bridge method name. */\n",
    "export type BridgeMethod = keyof BridgeMethodMap;\n\n",
    "/** Every bridge method, in spec order. */\n",
    `export const BRIDGE_METHODS = [${methods.map((m) => JSON.stringify(m.method)).join(", ")}] as const satisfies readonly BridgeMethod[];\n`,
  ].join("");
}
