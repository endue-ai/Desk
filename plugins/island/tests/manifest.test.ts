// desk.island: a data-only policy plugin that declares the island's settings (ADR 0204). Its manifest
// is checked against specs/plugin/v0, and the shell reads the setting under the name declared here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/island/plugin.json")) as PluginManifest;

describe("desk.island", () => {
  it("is a manifest specs/plugin/v0 accepts", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
    for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0", "memory/v0"]) {
      const dir = join(root, "specs", spec);
      for (const name of readdirSync(dir).filter((n) => n.endsWith(".schema.json")))
        ajv.addSchema(readJson(join(dir, name)) as object);
    }
    const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
    expect(validate, "the plugin schema").toBeDefined();
    expect(validate?.(manifest()), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("declares the setting the shell reads, off until the island replaces the floating Eris", () => {
    const { kind, contributes } = manifest();
    expect(kind).toBe("policy");
    expect(contributes?.settings?.["desk.island.show"]).toMatchObject({
      kind: "boolean",
      default: false,
    });
    const shell = readFileSync(join(root, "apps/desk/shell/src/island.rs"), "utf8");
    expect(shell).toContain('const OWNER: &str = "desk.island";');
    expect(shell).toContain('"params": { "key": "show" }');
  });
});
