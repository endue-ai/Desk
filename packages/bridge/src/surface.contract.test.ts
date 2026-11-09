// Contract: specs/surface/v0, the protocol between the compositor and anything that draws a surface.
// Every vector is judged by the schemas as its folder says, every message of both directions has a
// valid vector, a message's type names its direction, and the generated types write what the
// schemas accept. crates/desk-surface/tests/vectors.rs holds the Rust side to the same vectors.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CompositorMessage as Exported } from "./index";
import type {
  CompositorMessage,
  SurfaceA11yUpdate,
  SurfaceAttach,
  SurfaceCreate,
  SurfaceDragDrop,
  SurfaceImeComposition,
  SurfaceMessage,
  SurfacePointerDown,
} from "./surface.generated";

type Schema = { $id: string; $defs: Record<string, Def> };
type Def = { oneOf?: Array<{ $ref: string }>; properties?: { type?: { const?: string } } };
type Vector = {
  file: string;
  valid: boolean;
  target: string;
  description: string;
  instance: unknown;
};

const spec = join(import.meta.dirname, "../../../specs/surface/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const schemas = readdirSync(spec)
  .filter((name) => name.endsWith(".schema.json"))
  .sort()
  .map((name) => readJson(join(spec, name)) as Schema);

const vectors: Vector[] = (["valid", "invalid"] as const).flatMap((kind) =>
  readdirSync(join(spec, "vectors", kind))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const { target, description, instance } = readJson(
        join(spec, "vectors", kind, name),
      ) as Vector;
      return { file: `${kind}/${name}`, valid: kind === "valid", target, description, instance };
    }),
);

const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
for (const doc of schemas) ajv.addSchema(doc);

function validator(target: string) {
  const doc = schemas.find((d) => target in d.$defs);
  if (!doc) throw new Error(`no definition named ${target}`);
  const validate = ajv.getSchema(`${doc.$id}#/$defs/${target}`);
  if (!validate) throw new Error(`cannot compile ${target}`);
  return validate;
}

function def(name: string): Def {
  const found = schemas.find((d) => name in d.$defs)?.$defs[name];
  if (!found) throw new Error(`no definition named ${name}`);
  return found;
}

/** The `type` of every message one direction's union holds, in spec order. */
function messageTypes(union: string): string[] {
  return (def(union).oneOf ?? []).map(({ $ref }) => {
    const name = $ref.split("/").pop() ?? "";
    const type = def(name).properties?.type?.const;
    if (!type) throw new Error(`${name} has no const type`);
    return type;
  });
}

/** The `type` of every valid vector of one direction. */
function vectorTypes(union: string): Set<string> {
  return new Set(
    vectors
      .filter((v) => v.valid && v.target === union)
      .map((v) => (v.instance as { type: string }).type),
  );
}

describe("surface vectors", () => {
  for (const vector of vectors) {
    it(`${vector.file} is ${vector.valid ? "valid" : "invalid"}`, () => {
      expect(validator(vector.target)(vector.instance)).toBe(vector.valid);
    });
  }

  it("holds five valid and five invalid vectors at least, each with a description", () => {
    const valid = vectors.filter((v) => v.valid).length;
    expect(valid).toBeGreaterThanOrEqual(5);
    expect(vectors.length - valid).toBeGreaterThanOrEqual(5);
    expect(vectors.filter((v) => !v.description).map((v) => v.file)).toEqual([]);
  });
});

describe("the surface protocol's messages", () => {
  const down = messageTypes("CompositorMessage");
  const up = messageTypes("SurfaceMessage");

  it("names the lifecycle, input, IME, drag and accessibility messages of both directions", () => {
    for (const type of ["create", "resize", "show", "hide", "sleep", "wake", "destroy"])
      expect(down).toContain(type);
    for (const type of ["release", "pace", "pointer.move", "key.down", "ime.composition"])
      expect(down).toContain(type);
    for (const type of ["focus.in", "drag.enter", "drag.drop", "a11y.action"])
      expect(down).toContain(type);
    for (const type of ["ready", "died", "attach", "rate", "cursor", "ime.caret"])
      expect(up).toContain(type);
    for (const type of ["drag.start", "drag.status", "a11y.update"]) expect(up).toContain(type);
  });

  it("gives every message of both directions a valid vector", () => {
    expect(down.filter((type) => !vectorTypes("CompositorMessage").has(type))).toEqual([]);
    expect(up.filter((type) => !vectorTypes("SurfaceMessage").has(type))).toEqual([]);
  });

  it("never sends one type both ways, so a message's type names its direction", () => {
    expect(down.filter((type) => up.includes(type))).toEqual([]);
    const attach = vectors.find((v) => v.file === "valid/attach-iosurface.json")?.instance;
    expect(validator("SurfaceMessage")(attach)).toBe(true);
    expect(validator("CompositorMessage")(attach)).toBe(false);
  });
});

describe("generated surface types agree with the schemas", () => {
  it("a typed create, pointer press and IME composition are valid compositor messages", () => {
    const create = {
      type: "create",
      surface: "s-7",
      plugin: "example.hello-ui",
      view: "main",
      size: { width: 800, height: 600 },
      scale: 2,
      format: "bgra8",
    } satisfies SurfaceCreate;
    const press = {
      type: "pointer.down",
      surface: "s-7",
      x: 12.5,
      y: 40,
      button: "left",
      buttons: ["left"],
      clicks: 2,
      modifiers: ["shift"],
    } satisfies SurfacePointerDown;
    const composition = {
      type: "ime.composition",
      surface: "s-7",
      text: "한",
      underlines: [{ range: { start: 0, end: 1 }, style: "solid", thick: true }],
      selection: { start: 1, end: 1 },
    } satisfies SurfaceImeComposition;
    for (const message of [create, press, composition] satisfies CompositorMessage[])
      expect(validator("CompositorMessage")(message)).toBe(true);
  });

  it("a typed DMA-BUF attach, drop and tree update are valid", () => {
    const attach = {
      type: "attach",
      surface: "s-7",
      frame: 41,
      texture: {
        id: 1,
        generation: 3,
        width: 1600,
        height: 1200,
        format: "bgra8",
        handle: {
          kind: "dmabuf",
          fourcc: "AR24",
          modifier: "0x0",
          planes: [{ fdIndex: 0, stride: 6400, offset: 0 }],
        },
      },
      damage: [{ x: 0, y: 0, width: 1600, height: 1200 }],
      release: "after-copy",
    } satisfies SurfaceAttach;
    const update = {
      type: "a11y.update",
      surface: "s-7",
      tree: { root: 1 },
      nodes: [
        { id: 1, role: "root-web-area", name: "Notes", children: [2] },
        { id: 2, role: "button", name: "Save", bounds: { x: 8, y: 8, width: 64, height: 24 } },
      ],
      focus: 2,
    } satisfies SurfaceA11yUpdate;
    const drop = {
      type: "drag.drop",
      surface: "s-7",
      x: 100,
      y: 80,
      effect: "copy",
      items: [{ type: "desk/paths", paths: [{ path: "~/notes/plan.md", kind: "file" }] }],
    } satisfies SurfaceDragDrop;
    expect(validator("SurfaceMessage")(attach)).toBe(true);
    expect(validator("SurfaceMessage")(update)).toBe(true);
    expect(validator("CompositorMessage")(drop)).toBe(true);
  });

  it("narrows each direction's union by type, and @endue-ai/bridge exports it", () => {
    expectTypeOf<Extract<CompositorMessage, { type: "create" }>>().toEqualTypeOf<SurfaceCreate>();
    expectTypeOf<Extract<SurfaceMessage, { type: "attach" }>>().toEqualTypeOf<SurfaceAttach>();
    expectTypeOf<Exported>().toEqualTypeOf<CompositorMessage>();
  });
});
