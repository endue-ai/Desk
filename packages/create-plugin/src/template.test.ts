import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { PluginManifest } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { renderPlugin } from "./template";

const root = join(import.meta.dirname, "../../..");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const name of readdirSync(pluginSpec)
    .filter((n) => n.endsWith(".schema.json"))
    .sort()) {
    ajv.addSchema(readJson(join(pluginSpec, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

const manifestOf = (files: Record<string, string>) =>
  JSON.parse(files["plugin.json"] ?? "null") as PluginManifest;

describe("renderPlugin", () => {
  const validate = manifestValidator();

  it("writes a manifest that specs/plugin v0 accepts", () => {
    const files = renderPlugin({ id: "example.my-plugin", name: "My plugin" });
    const manifest = manifestOf(files);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toEqual({
      id: "example.my-plugin",
      name: "My plugin",
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", title: "My plugin", placement: "center" }],
    });
  });

  it("writes a manifest that can grow commands and keys under its own id (ADR 0017)", () => {
    const files = renderPlugin({ id: "example.my-plugin", name: "My plugin" });
    const manifest = {
      ...manifestOf(files),
      contributes: {
        commands: [{ id: "example.my-plugin.hello", title: "Say hello" }],
        keys: [{ key: "Mod+Shift+H", command: "example.my-plugin.hello" }],
      },
    };
    expect(validate(manifest)).toBe(true);
  });

  it("keeps a description when one is given", () => {
    const files = renderPlugin({ id: "example.notes", name: "Notes", description: "Notes." });
    const manifest = manifestOf(files);
    expect(validate(manifest)).toBe(true);
    expect(manifest.description).toBe("Notes.");
  });

  it("lays out the same files as examples/plugin-hello-ui", () => {
    const files = renderPlugin({ id: "example.my-plugin", name: "My plugin" });
    expect(Object.keys(files).sort()).toEqual(filesUnder(join(root, "examples/plugin-hello-ui")));
    expect(files).toHaveProperty(manifestOf(files).entry ?? "ui/index.html");
  });

  it("loads the SDK through the import map Desk serves", () => {
    const files = renderPlugin({ id: "example.my-plugin", name: "My plugin" });
    expect(files["ui/index.html"]).toContain('"@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js"');
    expect(files["ui/index.html"]).toContain('<script type="module" src="./main.js"></script>');
    expect(files["ui/main.js"]).toContain('import { defineUiPlugin } from "@endue-ai/plugin-sdk";');
  });

  it("escapes the name in the entry page", () => {
    const files = renderPlugin({ id: "example.tags", name: "<Tags> & co" });
    expect(files["ui/index.html"]).toContain("<title>&lt;Tags&gt; &amp; co</title>");
    expect(files["ui/index.html"]).not.toContain("<Tags>");
    expect(manifestOf(files).name).toBe("<Tags> & co");
  });

  it("names the id and the plugin in the README", () => {
    const files = renderPlugin({ id: "example.my-plugin", name: "My plugin" });
    expect(files["README.md"]).toMatch(/^# My plugin\n/);
    expect(files["README.md"]).toContain("`example.my-plugin`");
  });
});
