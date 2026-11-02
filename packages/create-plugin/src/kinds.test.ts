import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { main, USAGE } from "./cli";
import { KINDS, type TemplateKind } from "./kinds";
import { renderPlugin } from "./template";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

// plugin.schema.json references the item, view and connector schemas, which reference it back.
function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const folder of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", folder);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const kinds = Object.keys(KINDS) as TemplateKind[];

describe("the kinds", () => {
  const validate = manifestValidator();

  it("are ui, logic, connector, view, policy and theme, one entry each", () => {
    expect(kinds).toEqual(["ui", "logic", "connector", "view", "policy", "theme"]);
  });

  it.each(kinds)(
    "%s: a manifest of that kind that specs/plugin v0 accepts, and one test",
    (kind) => {
      const files = renderPlugin({ id: "example.my-plugin", name: "My plugin", kind });
      const manifest = JSON.parse(files["plugin.json"] ?? "null") as PluginManifest;
      expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
      expect(manifest.kind).toBe(kind);
      expect(manifest.id).toBe("example.my-plugin");
      const tests = Object.keys(files).filter((path) => path.startsWith("tests/"));
      expect(tests).toHaveLength(1);
      expect(tests[0]).toMatch(/^tests\/[a-z-]+\.test\.(js|ts|json)$/);
      expect(files["README.md"]).toContain("plugin test");
    },
  );

  it.each(kinds)("%s: the usage names it", (kind) => {
    expect(USAGE).toContain(kind);
  });

  it.each(kinds)("%s: --kind writes the folder and prints how to test it", async (kind) => {
    const cwd = mkdtempSync(join(tmpdir(), "create-plugin-kinds-"));
    const out: string[] = [];
    const io = {
      cwd,
      out: (line: string) => out.push(line),
      err: (line: string) => out.push(line),
    };
    expect(await main([`my-${kind}`, "--kind", kind], io)).toBe(0);
    const manifest = readJson(join(cwd, `my-${kind}`, "plugin.json")) as PluginManifest;
    expect(manifest).toMatchObject({ id: `local.my-${kind}`, kind });
    expect(out.find((line) => line.includes("plugin test"))).toContain(join(cwd, `my-${kind}`));
  });
});
