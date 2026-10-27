#!/usr/bin/env node
// Spec lint: every JSON Schema in specs/ (and the brain component schemas) is a valid 2020-12 schema
// that compiles in Ajv strict mode, definition names are unique, and every vector names a real target.
// The OpenAPI document itself is linted by spectral (see justfile).
import Ajv2020 from "ajv/dist/2020.js";
import { defIndex, loadAll, loadVectors, ROOT } from "./codegen/load.mjs";

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

if (problems.length > 0) {
  console.error(`spec-lint: FAIL\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`spec-lint: ${compiled} definitions compile in strict mode; vectors name real targets`);
