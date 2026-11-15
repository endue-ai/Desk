// desk.login: a data-only policy plugin that declares the start at login (ADR 0225). Its manifest
// is checked against specs/plugin/v0, and the desk's page reads the setting under the name declared here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/login/plugin.json")) as PluginManifest;

describe("desk.login", () => {
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

  it("declares the setting the page reads, off: endue starts at login only when asked to", () => {
    const { kind, contributes } = manifest();
    expect(kind).toBe("policy");
    expect(contributes?.settings?.["desk.login.start"]).toMatchObject({
      kind: "boolean",
      default: false,
    });
    const page = readFileSync(join(root, "apps/desk/src/login.ts"), "utf8");
    expect(page).toContain('export const LOGIN_SETTING = "desk.login.start";');
  });
});
