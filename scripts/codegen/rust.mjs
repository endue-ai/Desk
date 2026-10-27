// Model → Rust (serde). Output is unformatted; codegen.mjs pipes it through rustfmt.
import { pascal, snake, variantName } from "./model.mjs";

const KEYWORDS = new Set([
  "type",
  "match",
  "use",
  "mod",
  "fn",
  "impl",
  "ref",
  "self",
  "loop",
  "move",
]);

export function emitRust(model, { header, extra = "" }) {
  const consts = [];
  const flags = { map: false, trueType: false, falseType: false };
  const body = model.defs.map((def) => emitDef(def, consts, flags)).join("\n");
  const imports = ["use serde::{Deserialize, Serialize};"];
  if (flags.map) imports.push("use std::collections::BTreeMap;");
  return [
    header.map((line) => `// ${line}`).join("\n"),
    "",
    "#![allow(clippy::large_enum_variant, clippy::enum_variant_names)]",
    "",
    imports.join("\n"),
    "",
    body,
    consts.join("\n"),
    flags.trueType ? boolType("True", true) : "",
    flags.falseType ? boolType("False", false) : "",
    extra,
  ].join("\n");
}

function docs(text, indent = "") {
  if (!text) return "";
  return `${text
    .split("\n")
    .map((line) => `${indent}/// ${line}`.trimEnd())
    .join("\n")}\n`;
}

function emitDef(def, consts, flags) {
  switch (def.kind) {
    case "struct":
      return emitStruct(def, consts, flags);
    case "enum":
      return [
        docs(def.doc),
        "#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]\n",
        `pub enum ${def.name} {\n`,
        ...def.values.map(
          (value) => `    #[serde(rename = ${JSON.stringify(value)})]\n    ${pascal(value)},\n`,
        ),
        "}\n",
      ].join("");
    case "union":
      return [
        docs(def.doc),
        "#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n",
        "#[serde(untagged)]\n",
        `pub enum ${def.name} {\n`,
        ...def.variants.map((variant) => `    ${variantName(def.name, variant)}(${variant}),\n`),
        "}\n",
      ].join("");
    case "alias":
      return `${docs(def.doc)}pub type ${def.name} = ${rustType(def.type, flags)};\n`;
    default:
      throw new Error(`unknown definition kind ${def.kind}`);
  }
}

function emitStruct(def, consts, flags) {
  const lines = [docs(def.doc), "#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n"];
  if (def.closed) lines.push("#[serde(deny_unknown_fields)]\n");
  lines.push(`pub struct ${def.name} {\n`);
  for (const field of def.fields) {
    let type;
    if (field.type.kind === "const") {
      type = constType(def.name, field, consts, flags);
    } else {
      type = rustType(field.type, flags);
    }
    const ident = snake(field.name);
    const attrs = [];
    if (ident !== field.name) attrs.push(`rename = ${JSON.stringify(field.name)}`);
    if (!field.required) {
      attrs.push('default, skip_serializing_if = "Option::is_none"');
      type = `Option<${type}>`;
    }
    lines.push(docs(field.doc, "    "));
    if (attrs.length > 0) lines.push(`    #[serde(${attrs.join(", ")})]\n`);
    lines.push(`    pub ${KEYWORDS.has(ident) ? `r#${ident}` : ident}: ${type},\n`);
  }
  lines.push("}\n");
  return lines.join("");
}

function constType(owner, field, consts, flags) {
  const { value } = field.type;
  if (value === true) {
    flags.trueType = true;
    return "True";
  }
  if (value === false) {
    flags.falseType = true;
    return "False";
  }
  const name = `${owner}${pascal(field.name)}`;
  consts.push(
    [
      `/// The \`${field.name}\` of [\`${owner}\`]: always \`${JSON.stringify(value)}\`.\n`,
      "#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]\n",
      `pub enum ${name} {\n`,
      "    #[default]\n",
      `    #[serde(rename = ${JSON.stringify(value)})]\n`,
      `    ${pascal(value)},\n`,
      "}\n",
    ].join(""),
  );
  return name;
}

function rustType(type, flags) {
  switch (type.kind) {
    case "ref":
      return type.name;
    case "string":
      return "String";
    case "integer":
      return "i64";
    case "unsigned":
      return "u64";
    case "number":
      return "f64";
    case "boolean":
      return "bool";
    case "array":
      return `Vec<${rustType(type.items, flags)}>`;
    case "map":
      flags.map = true;
      return `BTreeMap<String, ${rustType(type.values, flags)}>`;
    case "object":
      return "serde_json::Map<String, serde_json::Value>";
    case "any":
      return "serde_json::Value";
    default:
      throw new Error(`no Rust type for ${type.kind}`);
  }
}

function boolType(name, value) {
  return `
/// The JSON value \`${value}\`, as a type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct ${name};

impl Serialize for ${name} {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(${value})
    }
}

impl<'de> Deserialize<'de> for ${name} {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if ${value ? "" : "!"}bool::deserialize(deserializer)? {
            Ok(${name})
        } else {
            Err(serde::de::Error::custom("expected ${value}"))
        }
    }
}
`;
}
