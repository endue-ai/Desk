import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import { parse } from "yaml";
import type { TurnEvent } from "./brain.generated";
import { brainSchema } from "./brain.generated";
import type {
  BridgeMethodMap,
  BridgeRequest,
  FsReadResult,
  InitDocument,
  PluginManifest,
} from "./generated";

type Schema = { $id: string; $defs: Record<string, unknown> };
type Vector = { file: string; valid: boolean; target: string; instance: unknown };

const specs = join(import.meta.dirname, "../../../specs");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function schemas(folder: string): Schema[] {
  return readdirSync(join(specs, folder))
    .filter((name) => name.endsWith(".schema.json"))
    .sort()
    .map((name) => readJson(join(specs, folder, name)) as Schema);
}

function vectors(spec: string): Vector[] {
  return (["valid", "invalid"] as const).flatMap((kind) => {
    const dir = join(specs, spec, "v0/vectors", kind);
    return readdirSync(dir)
      .sort()
      .map((name) => {
        const { target, instance } = readJson(join(dir, name)) as Omit<Vector, "file" | "valid">;
        return { file: `${spec}/${kind}/${name}`, valid: kind === "valid", target, instance };
      });
  });
}

function validatorFor(docs: Schema[]) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const doc of docs) ajv.addSchema(doc);
  return (target: string) => {
    const doc = docs.find((d) => target in d.$defs);
    if (!doc) throw new Error(`no definition named ${target}`);
    const validate = ajv.getSchema(`${doc.$id}#/$defs/${target}`);
    if (!validate) throw new Error(`cannot compile ${target}`);
    return validate;
  };
}

const sets: Record<string, Schema[]> = {
  bridge: [...schemas("plugin/v0"), ...schemas("bridge/v0")],
  plugin: schemas("plugin/v0"),
  init: [...schemas("plugin/v0"), ...schemas("init/v0")],
  brain: [brainSchema as Schema],
};

describe.each(Object.entries(sets))("%s vectors", (spec, docs) => {
  const validator = validatorFor(docs);
  for (const vector of vectors(spec)) {
    it(`${vector.file} is ${vector.valid ? "valid" : "invalid"}`, () => {
      expect(validator(vector.target)(vector.instance)).toBe(vector.valid);
    });
  }
});

describe("generated types agree with the schemas", () => {
  const bridge = validatorFor(sets.bridge ?? []);

  it("a typed fs.read request is valid", () => {
    const request = {
      id: 1,
      method: "fs.read",
      params: { path: "~/notes.md", scope: { permission: "fs:read", paths: ["~/**"] } },
    } satisfies BridgeRequest;
    expect(bridge("BridgeRequest")(request)).toBe(true);
  });

  it("a typed manifest is valid", () => {
    const manifest = {
      id: "example.hello-ui",
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", placement: "center" }],
    } satisfies PluginManifest;
    expect(bridge("PluginManifest")(manifest)).toBe(true);
  });

  it("a typed init document is valid", () => {
    const init = {
      profile: "focus",
      plugins: { disabled: ["endue.sidebar"] },
      settings: { "eris.voice": true },
      sync: { enabled: true },
    } satisfies InitDocument;
    expect(validatorFor(sets.init ?? [])("InitDocument")(init)).toBe(true);
  });

  it("the init.yaml template parses to the template vector", () => {
    const template = parse(readFileSync(join(specs, "init/v0/init.template.yaml"), "utf8"));
    const vector = readJson(join(specs, "init/v0/vectors/valid/template.json")) as Vector;
    expect(template).toEqual(vector.instance);
    expect(parse("# only a comment\n")).toBeNull();
  });

  it("a typed turn event is valid", () => {
    const event = { type: "text.delta", turnId: "t1", text: "hi" } satisfies TurnEvent;
    expect(validatorFor([brainSchema as Schema])("TurnEvent")(event)).toBe(true);
  });

  it("maps each method to its params and result", () => {
    expectTypeOf<BridgeMethodMap["fs.read"]["result"]>().toEqualTypeOf<FsReadResult>();
  });
});
