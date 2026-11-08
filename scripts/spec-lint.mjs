#!/usr/bin/env node
// Spec lint: every JSON Schema in specs/ (and the brain component schemas) is a valid 2020-12 schema
// that compiles in Ajv strict mode, definition names are unique, and every vector names a real target.
// The platform subset (specs/platform/v0/openapi.yaml, ADR 0122) compiles the same way, and each of
// its vectors is judged as its folder says. The OpenAPI documents themselves are linted by spectral.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { DRAFT, defIndex, loadAll, loadVectors, ROOT } from "./codegen/load.mjs";

const problems = [];
const specs = loadAll(ROOT);
let compiled = 0;

for (const [spec, docs] of Object.entries(specs)) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  let index;
  try {
    for (const doc of docs) ajv.addSchema(doc);
    index = defIndex(docs);
    for (const uri of index.values()) {
      ajv.getSchema(uri);
      compiled++;
    }
  } catch (error) {
    problems.push(`${spec}: ${error.message}`);
    continue;
  }
  const vectors = loadVectors(ROOT, spec);
  for (const kind of [true, false]) {
    const count = vectors.filter((v) => v.valid === kind).length;
    if (count < 5)
      problems.push(`${spec}: only ${count} ${kind ? "valid" : "invalid"} vectors (need 5)`);
  }
  for (const vector of vectors) {
    if (!index.has(vector.target)) problems.push(`${vector.file}: unknown target ${vector.target}`);
    if (!vector.description) problems.push(`${vector.file}: missing description`);
  }
}

compiled += lintPlatform();

if (problems.length > 0) {
  console.error(`spec-lint: FAIL\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`spec-lint: ${compiled} definitions compile in strict mode; vectors name real targets`);

/** The platform contract's component schemas as one JSON Schema document, as the brain's are. */
export function platformBundle(openapi) {
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
    $id: "https://endue.ai/specs/platform/v0/platform.schema.json",
    $defs: rewrite(openapi.components.schemas),
  };
}

/** Compile the platform subset (nullable fields are type unions) and judge its vectors. */
function lintPlatform() {
  const file = join(ROOT, "specs/platform/v0/openapi.yaml");
  const bundle = platformBundle(parse(readFileSync(file, "utf8")));
  const ajv = new Ajv2020({
    strict: true,
    allowUnionTypes: true,
    allErrors: true,
    validateFormats: false,
  });
  const names = Object.keys(bundle.$defs);
  try {
    ajv.addSchema(bundle);
    for (const name of names) ajv.getSchema(`${bundle.$id}#/$defs/${name}`);
  } catch (error) {
    problems.push(`platform: ${error.message}`);
    return 0;
  }
  const vectors = loadVectors(ROOT, "platform");
  for (const kind of [true, false]) {
    const count = vectors.filter((v) => v.valid === kind).length;
    if (count < 5)
      problems.push(`platform: only ${count} ${kind ? "valid" : "invalid"} vectors (need 5)`);
  }
  for (const vector of vectors) {
    if (!vector.description) problems.push(`${vector.file}: missing description`);
    if (!names.includes(vector.target)) {
      problems.push(`${vector.file}: unknown target ${vector.target}`);
      continue;
    }
    const valid = ajv.getSchema(`${bundle.$id}#/$defs/${vector.target}`)(vector.instance);
    if (valid !== vector.valid)
      problems.push(`${vector.file}: judged ${valid ? "valid" : "invalid"}, filed otherwise`);
  }
  return names.length;
}
