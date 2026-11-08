import { describe, expect, it } from "vitest";
import { parseJson } from "../ui/parse/json.js";
import { parseYaml } from "../ui/parse/yaml.js";
import { validate } from "../ui/schema.js";
import { disk, file, mount } from "./harness";
import { rootOf } from "./nodes";

const check = (text: string, schema: unknown, files: Record<string, unknown> = {}) => {
  const doc =
    text.trimStart().startsWith("{") || text.trimStart().startsWith("[")
      ? parseJson(text, "json")
      : parseYaml(text);
  return validate(rootOf(doc), schema, { files });
};
const brief = (errors: ReturnType<typeof validate>) => errors.map((e) => [e.pointer, e.keyword]);

describe("JSON Schema 2020-12 keywords", () => {
  it("type, enum and const", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "integer" },
        b: { type: ["string", "null"] },
        c: { enum: ["x", 2, null] },
        d: { const: { k: [1] } },
        e: { type: "number" },
      },
    };
    expect(brief(check('{"a": 1.5, "b": 3, "c": "y", "d": {"k": [2]}, "e": 1}', schema))).toEqual([
      ["/a", "type"],
      ["/b", "type"],
      ["/c", "enum"],
      ["/d", "const"],
    ]);
    expect(check('{"a": 2.0, "b": null, "c": 2, "d": {"k": [1]}, "e": 1.5}', schema)).toEqual([]);
  });

  it("properties, required, additionalProperties, patternProperties and dependentRequired", () => {
    const schema = {
      type: "object",
      required: ["id", "name"],
      properties: { id: { type: "integer" } },
      patternProperties: { "^x-": { type: "string" } },
      additionalProperties: false,
      dependentRequired: { id: ["version"] },
    };
    expect(brief(check('{"id": 1, "x-a": 2, "extra": true}', schema))).toEqual([
      ["", "required"],
      ["/x-a", "type"],
      ["/extra", "additionalProperties"],
      ["", "dependentRequired"],
    ]);
  });

  it("items, prefixItems, minItems, maxItems and uniqueItems", () => {
    const schema = {
      type: "array",
      prefixItems: [{ type: "string" }],
      items: { type: "number" },
      minItems: 2,
      maxItems: 3,
      uniqueItems: true,
    };
    expect(brief(check('[1, "two", 3, 3]', schema))).toEqual([
      ["/0", "type"],
      ["/1", "type"],
      ["", "maxItems"],
      ["", "uniqueItems"],
    ]);
    expect(brief(check('["a"]', schema))).toEqual([["", "minItems"]]);
  });

  it("minimum, maximum, the exclusive forms and multipleOf", () => {
    const schema = {
      type: "array",
      items: { minimum: 1, exclusiveMaximum: 10, multipleOf: 0.5 },
      prefixItems: [{ exclusiveMinimum: 0, maximum: 5 }],
    };
    expect(brief(check("[0, 10, 1.25, 4.5]", schema))).toEqual([
      ["/0", "exclusiveMinimum"],
      ["/1", "exclusiveMaximum"],
      ["/2", "multipleOf"],
    ]);
  });

  it("minLength, maxLength and pattern, counted in code points", () => {
    const schema = { type: "array", items: { minLength: 2, maxLength: 3, pattern: "^[a-z😀]+$" } };
    expect(brief(check('["a", "abcd", "AB", "😀😀"]', schema))).toEqual([
      ["/0", "minLength"],
      ["/1", "maxLength"],
      ["/2", "pattern"],
    ]);
  });

  it("allOf, anyOf, oneOf, not and if/then/else", () => {
    const schema = {
      type: "array",
      items: {
        allOf: [{ type: "object" }, { required: ["kind"] }],
        anyOf: [{ required: ["a"] }, { required: ["b"] }],
        oneOf: [{ required: ["a"] }, { required: ["c"] }],
        not: { required: ["forbidden"] },
        if: { required: ["kind"], properties: { kind: { const: "box" } } },
        // biome-ignore lint/suspicious/noThenProperty: a JSON Schema keyword
        then: { required: ["size"] },
        else: { required: ["name"] },
      },
    };
    expect(
      brief(
        check(
          '[{"kind": "box", "a": 1, "size": 2}, {"kind": "box", "b": 1}, {"kind": "x", "a": 1, "c": 1, "forbidden": 1}, {"a": 1, "name": "n"}]',
          schema,
        ),
      ),
    ).toEqual([
      ["/1", "oneOf"],
      ["/1", "then"],
      ["/2", "oneOf"],
      ["/2", "not"],
      ["/2", "else"],
      ["/3", "allOf"],
    ]);
  });

  it("$ref to $defs and to a file in the same folder", () => {
    const schema = {
      $defs: { port: { type: "integer", maximum: 65535 } },
      type: "object",
      properties: {
        port: { $ref: "#/$defs/port" },
        name: { $ref: "common.schema.json#/$defs/name" },
        tags: { $ref: "./common.schema.json" },
      },
    };
    const files = {
      "common.schema.json": { type: "array", $defs: { name: { type: "string", minLength: 1 } } },
    };
    expect(brief(check('{"port": 70000, "name": "", "tags": {}}', schema, files))).toEqual([
      ["/port", "maximum"],
      ["/name", "minLength"],
      ["/tags", "type"],
    ]);
  });

  it("errors carry the pointer, a message and the node's line, in YAML too", () => {
    const text = "name: desk\nports:\n  - 80\n  - http\n";
    const [error] = check(text, {
      properties: { ports: { items: { type: "integer" } } },
    });
    expect(error).toMatchObject({ pointer: "/ports/1", keyword: "type", line: 4, col: 5 });
    expect(error?.message).toBe("Should be integer, not string.");
  });
});

describe("finding the schema", () => {
  const PERSON = JSON.stringify({
    type: "object",
    required: ["name"],
    properties: { name: { $ref: "common.schema.json#/$defs/name" }, age: { type: "integer" } },
  });
  const COMMON = JSON.stringify({ $defs: { name: { type: "string" } } });
  const files = () => ({
    "~/data/person.schema.json": PERSON,
    "~/data/common.schema.json": COMMON,
    "~/data/a.json": '{\n  "$schema": "./person.schema.json",\n  "name": 1\n}\n',
    "~/data/b.yaml": "# yaml-language-server: $schema=person.schema.json\nname: desk\nage: old\n",
    "~/data/c.toml": 'name = "desk"\nage = 3\n',
    "~/data/c.schema.json": PERSON,
    "~/data/d.json": '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }',
    "~/data/e.json": '{ "age": 1 }',
  });
  const last = (view: { schemas: Array<{ state: unknown }> }) => view.schemas.at(-1)?.state;

  it("from the document's $schema when it is a relative path", async () => {
    const { host, view, settle } = await mount({ handlers: disk(files()) });
    await host.command("desk.files.visit", file("~/data/a.json"));
    await settle();
    expect(last(view)).toMatchObject({
      state: "invalid",
      how: "$schema",
      source: "~/data/person.schema.json",
      errors: [{ pointer: "/name", line: 3, keyword: "type" }],
    });
  });

  it("from a yaml-language-server comment", async () => {
    const { host, view, settle } = await mount({ handlers: disk(files()) });
    await host.command("desk.files.visit", file("~/data/b.yaml"));
    await settle();
    expect(last(view)).toMatchObject({
      state: "invalid",
      how: "comment",
      errors: [{ pointer: "/age", line: 3 }],
    });
  });

  it("from a sibling <name>.schema.json", async () => {
    const { host, view, settle } = await mount({ handlers: disk(files()) });
    await host.command("desk.files.visit", file("~/data/c.toml"));
    await settle();
    expect(last(view)).toMatchObject({
      state: "valid",
      how: "sibling",
      source: "~/data/c.schema.json",
      errors: [],
    });
  });

  it("never fetches a remote schema, and says so", async () => {
    const { host, view, params, settle } = await mount({ handlers: disk(files()) });
    await host.command("desk.files.visit", file("~/data/d.json"));
    await settle();
    expect(last(view)).toMatchObject({ state: "remote" });
    expect((last(view) as { note: string }).note).toMatch(/not fetched/);
    expect(params("fs.read").map((p) => (p as { path: string }).path)).not.toContain(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("Validate with... picks a schema with the palette and remembers it per file", async () => {
    const picks: unknown[] = [];
    const { host, view, app, params, settle } = await mount({
      handlers: disk(files()),
      commands: {
        "desk.palette.pick": (args) => {
          picks.push(args);
          return "~/data/person.schema.json";
        },
      },
    });
    const e = file("~/data/e.json");
    await host.command("desk.files.visit", e);
    await settle();
    expect(last(view)).toMatchObject({ state: "none" });
    await app.validateWith();
    await settle();
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ free: true });
    expect(last(view)).toMatchObject({
      state: "invalid",
      how: "picked",
      errors: [{ pointer: "", keyword: "required" }],
    });
    expect(params("store.set")).toHaveLength(1);

    await host.command("desk.buffers.closed", e);
    await host.command("desk.files.visit", e);
    await settle();
    expect(last(view)).toMatchObject({ state: "invalid", how: "picked" });
  });
});
