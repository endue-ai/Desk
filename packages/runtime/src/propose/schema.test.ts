import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { type SchemaDocument, Schemas } from "./schema";

const specs = join(import.meta.dirname, "../../../../specs");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
/** The plugin manifest and the specs it references, which reference it back: one set. */
const documents = ["plugin/v0", "item/v0", "view/v0", "connector/v0"].flatMap((folder) =>
  readdirSync(join(specs, folder))
    .filter((name) => name.endsWith(".schema.json"))
    .sort()
    .map((name) => readJson(join(specs, folder, name)) as SchemaDocument),
);
const VIEW = "https://endue.ai/specs/view/v0/view.schema.json#/$defs/View";

type Vector = { file: string; target: string; instance: unknown };
function vectors(spec: string): Vector[] {
  return ["valid", "invalid"].flatMap((kind) => {
    const dir = join(specs, spec, "v0/vectors", kind);
    return readdirSync(dir)
      .sort()
      .map((name) => {
        const { target, instance } = readJson(join(dir, name)) as Omit<Vector, "file">;
        return { file: `${spec}/${kind}/${name}`, target, instance };
      });
  });
}

/** The definition `target` names, as an absolute reference. */
const refOf = (target: string) => {
  const doc = documents.find((d) => d.$defs && target in d.$defs);
  if (!doc) throw new Error(`no definition named ${target}`);
  return `${doc.$id}#/$defs/${target}`;
};

function ajv() {
  const checker = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const doc of documents) checker.addSchema(doc);
  return checker;
}

describe("Schemas", () => {
  it("judges every view, item, plugin and connector vector as Ajv does", () => {
    const schemas = new Schemas(documents);
    const checker = ajv();
    const all = ["view", "item", "plugin", "connector"].flatMap(vectors);
    expect(all.length).toBeGreaterThan(40);
    for (const vector of all) {
      const ref = refOf(vector.target);
      const validate = checker.getSchema(ref);
      if (!validate) throw new Error(`cannot compile ${ref}`);
      const problems = schemas.validate(vector.instance, ref);
      expect(problems.length === 0, `${vector.file}: ${problems.join("; ")}`).toBe(
        validate(vector.instance) === true,
      );
    }
  });

  it("names where a value breaks the schema and how, the closest form of a oneOf included", () => {
    const schemas = new Schemas(documents);
    const view = {
      id: "eris.board",
      version: "0.1.0",
      title: "Board",
      layout: { type: "agenda", range: "fortnight", binding: { kinds: ["event"] } },
    };
    expect(schemas.validate(view, VIEW)).toEqual([
      "/layout/range: must be one of day, week, month",
    ]);
    expect(schemas.validate({ ...view, layout: { type: "board" } }, VIEW)[0]).toMatch(
      /^\/layout\/type: must be one of /,
    );
    expect(schemas.validate({ title: "No id" }, VIEW)).toEqual([
      "/: must have id",
      "/: must have version",
      "/: must have layout",
    ]);
    expect(schemas.validate({ ...view, colour: "red" }, VIEW)).toEqual([
      "/: has colour, which is not allowed here",
    ]);
    expect(schemas.validate("a view", VIEW)).toEqual(["/: must be object"]);
  });

  it("bundles View into one self-contained schema that Ajv compiles, and a compact one under the bridge's 8000 characters with the prompt", () => {
    const schemas = new Schemas(documents);
    const full = schemas.bundle(VIEW);
    expect(JSON.stringify(full)).not.toMatch(/"\$ref":"(?!#\/\$defs\/)/);
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(full);
    for (const vector of vectors("view")) {
      const viaAjv = ajv().getSchema(refOf(vector.target));
      expect(validate(vector.instance), vector.file).toBe(viaAjv?.(vector.instance));
    }
    const answer = schemas.bundle(VIEW, { compact: true, omit: ["id", "version", "provenance"] });
    const text = JSON.stringify(answer);
    expect(text).not.toContain('"description"');
    expect(text).not.toContain("ViewProvenance");
    expect((answer as { required: string[] }).required).toEqual(["title", "layout"]);
    expect(text.length).toBeLessThan(6000);
  });
});
