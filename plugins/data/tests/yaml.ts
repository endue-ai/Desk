// Reading YAML in the tests: one document with no errors, or every document's plain value.
import { expect } from "vitest";
import { parseYaml } from "../ui/parse/yaml.js";
import { type DataNode, plainOf } from "../ui/tree.js";

export const one = (text: string) => {
  const doc = parseYaml(text);
  expect(doc.errors).toEqual([]);
  expect(doc.roots).toHaveLength(1);
  return doc.roots[0] as DataNode;
};
export const values = (text: string) => {
  const doc = parseYaml(text);
  expect(doc.errors).toEqual([]);
  return doc.roots.map(plainOf);
};
